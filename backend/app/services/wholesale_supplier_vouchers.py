from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.models.wholesale import Receiving, ReceivingItem, ReceivingPackage, SupplierVoucher, SupplierVoucherLine, WholesalePayment
from app.services.wholesale.colors import color_qty_pairs, color_qty_problem, colors_as_json
from app.services.wholesale.currency import resolve_money
from app.services.wholesale.money import voucher_totals
from app.services.wholesale.references import allocate_reference, retry_on_reference_collision

_LOAD_OPTIONS = (selectinload(SupplierVoucher.lines), selectinload(SupplierVoucher.payments))


def _load(db: Session, voucher_id: str, branch_id: str | None) -> SupplierVoucher:
    voucher = db.query(SupplierVoucher).options(*_LOAD_OPTIONS).filter(SupplierVoucher.id == voucher_id).first()
    if voucher is None or (branch_id is not None and voucher.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Supplier voucher not found")
    return voucher


def list_vouchers(db: Session, branch_id: str | None) -> list[SupplierVoucher]:
    query = db.query(SupplierVoucher).options(*_LOAD_OPTIONS)
    if branch_id is not None:
        query = query.filter(SupplierVoucher.branch_id == branch_id)
    return query.order_by(SupplierVoucher.voucher_date.desc(), SupplierVoucher.voucher_no.desc()).all()


def get_voucher(db: Session, voucher_id: str, branch_id: str | None) -> SupplierVoucher:
    return _load(db, voucher_id, branch_id)


def _line(line_in) -> SupplierVoucherLine:
    color_breakdown = line_in.color_breakdown.strip()
    problem = color_qty_problem(color_breakdown)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)
    currency_code, buying_price, original_buying_price, exchange_rate = resolve_money(
        line_in.currency_code, line_in.buying_price, line_in.original_buying_price, line_in.exchange_rate,
    )
    return SupplierVoucherLine(
        stock_code=line_in.stock_code.strip(), description=line_in.description.strip(),
        product_group=line_in.product_group, color_breakdown=color_breakdown, colors=colors_as_json(color_breakdown),
        unit=line_in.unit, unit_conversions=line_in.unit_conversions,
        quantity_pairs=color_qty_pairs(color_breakdown, line_in.unit, line_in.unit_conversions),
        buying_price=buying_price, currency_code=currency_code,
        original_buying_price=original_buying_price, exchange_rate=exchange_rate,
    )


def _check_no_duplicate_stock_codes(lines) -> None:
    # A receiving item only records a stock code and a quantity, never which voucher
    # line it satisfies — two lines for the same stock code would make received-quantity
    # attribution ambiguous (see _out in the router). Put the extra quantity on the
    # existing line instead.
    seen = {line.stock_code.strip().lower() for line in lines}
    if len(seen) != len(lines):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Each stock code can only appear on one line per voucher")


def create_voucher(db: Session, branch_id: str | None, payload) -> SupplierVoucher:
    _check_no_duplicate_stock_codes(payload.lines)

    def attempt() -> SupplierVoucher:
        voucher = SupplierVoucher(
            branch_id=branch_id, voucher_no=allocate_reference(db, SupplierVoucher.voucher_no, branch_id, "VCH", date.today()),
            supplier_name=payload.supplier_name.strip(), voucher_date=payload.voucher_date,
            carrier_name=payload.carrier_name.strip(), total_packages=payload.total_packages,
            lines=[_line(line) for line in payload.lines],
        )
        db.add(voucher)
        db.commit()
        db.refresh(voucher)
        return voucher
    return retry_on_reference_collision(db, attempt)


def update_voucher(db: Session, voucher_id: str, branch_id: str | None, payload) -> SupplierVoucher:
    _check_no_duplicate_stock_codes(payload.lines)
    voucher = _load(db, voucher_id, branch_id)
    existing_losses = {line.stock_code: line.lost_quantity_pairs for line in voucher.lines}
    voucher.supplier_name = payload.supplier_name.strip()
    voucher.voucher_date = payload.voucher_date
    voucher.carrier_name = payload.carrier_name.strip()
    voucher.total_packages = payload.total_packages
    replacement_lines = [_line(line) for line in payload.lines]
    for line in replacement_lines:
        line.lost_quantity_pairs = min(existing_losses.get(line.stock_code, 0), line.quantity_pairs)
    voucher.lines = replacement_lines
    db.commit()
    db.refresh(voucher)
    return voucher


def delete_voucher(db: Session, voucher_id: str, branch_id: str | None) -> None:
    voucher = _load(db, voucher_id, branch_id)
    db.delete(voucher)
    db.commit()


def add_payment(db: Session, voucher_id: str, branch_id: str | None, user_id: str, payload) -> WholesalePayment:
    voucher = _load(db, voucher_id, branch_id)
    total = voucher_totals(voucher)["total"]
    paid = sum(float(payment.amount) for payment in voucher.payments)
    if paid + payload.amount > total:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Payment cannot exceed the voucher balance")
    payment = WholesalePayment(branch_id=voucher.branch_id, voucher_id=voucher.id, paid_on=payload.paid_on,
                               amount=payload.amount, note=payload.note.strip(), recorded_by_user_id=user_id)
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def delete_payment(db: Session, voucher_id: str, payment_id: str, branch_id: str | None) -> None:
    voucher = _load(db, voucher_id, branch_id)
    payment = next((entry for entry in voucher.payments if entry.id == payment_id), None)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    db.delete(payment)
    db.commit()


def received_pairs_by_voucher_no(db: Session, voucher_nos: list[str], branch_id: str | None) -> dict[str, int]:
    if not voucher_nos:
        return {}
    query = (db.query(Receiving.voucher_no, func.coalesce(func.sum(ReceivingItem.quantity_pairs), 0))
            .join(ReceivingPackage, ReceivingPackage.receiving_id == Receiving.id)
            .join(ReceivingItem, ReceivingItem.package_id == ReceivingPackage.id)
            .filter(Receiving.voucher_no.in_(voucher_nos), ReceivingPackage.opened.is_(True)))
    if branch_id is not None:
        query = query.filter(Receiving.branch_id == branch_id)
    rows = query.group_by(Receiving.voucher_no).all()
    return {voucher_no: int(pairs) for voucher_no, pairs in rows}


def received_pairs_by_voucher_stock(
    db: Session,
    voucher_nos: list[str],
    branch_id: str | None,
) -> dict[tuple[str, str], int]:
    """Return opened receiving quantities grouped by voucher and stock code.

    Voucher line received quantities must come from the same opened package items as
    the Receiving screen. Keeping this aggregation here prevents the voucher detail
    from inventing a separate received-quantity source in the frontend.
    """
    if not voucher_nos:
        return {}
    query = (
        db.query(
            Receiving.voucher_no,
            ReceivingItem.stock_code,
            func.coalesce(func.sum(ReceivingItem.quantity_pairs), 0),
        )
        .join(ReceivingPackage, ReceivingPackage.receiving_id == Receiving.id)
        .join(ReceivingItem, ReceivingItem.package_id == ReceivingPackage.id)
        .filter(
            Receiving.voucher_no.in_(voucher_nos),
            ReceivingPackage.opened.is_(True),
        )
    )
    if branch_id is not None:
        query = query.filter(Receiving.branch_id == branch_id)
    rows = query.group_by(Receiving.voucher_no, ReceivingItem.stock_code).all()
    return {
        (voucher_no, stock_code): int(pairs)
        for voucher_no, stock_code, pairs in rows
    }


def stock_codes_with_open_vouchers(
    db: Session,
    branch_id: str | None,
    stock_codes: set[str],
) -> set[str]:
    """Which of these stock codes already have a supplier voucher naming them —
    existence only, regardless of whether the goods it describes have arrived yet.
    A customer order reads this as "we have started buying it," the same way its own
    received_quantity_pairs says "we have started delivering it": the order itself never records
    which voucher it came from, so this is worked out by stock code, not a stored link.
    """
    if not stock_codes:
        return set()
    query = (
        db.query(SupplierVoucherLine.stock_code)
        .join(SupplierVoucher, SupplierVoucherLine.voucher_id == SupplierVoucher.id)
        .filter(SupplierVoucherLine.stock_code.in_(stock_codes))
        .distinct()
    )
    if branch_id is not None:
        query = query.filter(SupplierVoucher.branch_id == branch_id)
    return {row[0] for row in query.all()}
