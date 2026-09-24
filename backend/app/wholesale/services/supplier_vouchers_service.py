from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.wholesale.models.entities import (
    Receiving,
    ReceivingItem,
    ReceivingPackage,
    Shipment,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesalePayment,
)
from app.wholesale.services.audit import record_audit_log
from app.wholesale.services.colors import color_qty_pairs, color_qty_problem, colors_as_json
from app.wholesale.services.currency import resolve_money
from app.wholesale.services.lifecycle import (
    VoucherAction,
    VoucherStatus,
    assert_can_perform_voucher_action,
    get_allowed_voucher_actions,
    voucher_status,
)
from app.wholesale.services.master_data import get_or_create_product
from app.wholesale.services.money import voucher_totals
from app.wholesale.services.references import allocate_reference, retry_on_reference_collision

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


def voucher_lifecycle_info(
    db: Session,
    voucher: SupplierVoucher,
    branch_id: str | None,
) -> tuple[str, bool, bool, bool]:
    total_quantity_pairs = sum(line.quantity_pairs for line in voucher.lines)
    lost_quantity_pairs = sum(line.lost_quantity_pairs for line in voucher.lines)
    received_quantity_pairs = received_pairs_by_voucher_no(
        db, [voucher.voucher_no], branch_id
    ).get(voucher.voucher_no, 0)
    balance_due = voucher_totals(voucher)["balance_due"]

    has_shipments_q = db.query(Shipment.id).filter(
        Shipment.voucher_no == voucher.voucher_no
    )
    if branch_id is not None:
        has_shipments_q = has_shipments_q.filter(Shipment.branch_id == branch_id)
    has_shipments = has_shipments_q.first() is not None

    has_receivings_q = db.query(Receiving.id).filter(
        Receiving.voucher_no == voucher.voucher_no
    )
    if branch_id is not None:
        has_receivings_q = has_receivings_q.filter(Receiving.branch_id == branch_id)
    has_receivings = received_quantity_pairs > 0 or has_receivings_q.first() is not None

    has_payments = len(voucher.payments) > 0

    status_str = voucher_status(
        total_quantity_pairs=total_quantity_pairs,
        received_quantity_pairs=received_quantity_pairs,
        lost_quantity_pairs=lost_quantity_pairs,
        balance_due=balance_due,
        has_shipments=has_shipments,
    )
    return status_str, has_shipments, has_receivings, has_payments


def _line(db: Session, line_in) -> SupplierVoucherLine:
    color_breakdown = line_in.color_breakdown.strip()
    problem = color_qty_problem(color_breakdown)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)
    currency_code, buying_price, original_buying_price, exchange_rate = resolve_money(
        line_in.currency_code, line_in.buying_price, line_in.original_buying_price, line_in.exchange_rate,
    )
    get_or_create_product(
        db, line_in.stock_code, line_in.description, line_in.product_group, line_in.unit, line_in.unit_conversions,
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


def create_voucher(
    db: Session,
    branch_id: str | None,
    payload,
    operator_id: str | None = None,
) -> SupplierVoucher:
    _check_no_duplicate_stock_codes(payload.lines)

    def attempt() -> SupplierVoucher:
        voucher = SupplierVoucher(
            branch_id=branch_id,
            voucher_no=allocate_reference(db, SupplierVoucher.voucher_no, branch_id, "VCH", date.today()),
            supplier_name=payload.supplier_name.strip(),
            voucher_date=payload.voucher_date,
            carrier_name=payload.carrier_name.strip(),
            total_packages=payload.total_packages,
            lines=[_line(db, line) for line in payload.lines],
        )
        db.add(voucher)
        db.flush()
        record_audit_log(
            db,
            branch_id=branch_id,
            entity_type="voucher",
            entity_id=voucher.id,
            action="create",
            operator_id=operator_id,
            summary=f"Created supplier voucher {voucher.voucher_no} for {voucher.supplier_name}",
            payload={
                "voucher_no": voucher.voucher_no,
                "supplier_name": voucher.supplier_name,
                "line_count": len(voucher.lines),
            },
        )
        db.commit()
        return _load(db, voucher.id, branch_id)

    return retry_on_reference_collision(db, attempt)


def update_voucher(
    db: Session,
    voucher_id: str,
    branch_id: str | None,
    payload,
    operator_id: str | None = None,
) -> SupplierVoucher:
    _check_no_duplicate_stock_codes(payload.lines)
    voucher = _load(db, voucher_id, branch_id)
    status_str, has_shipments, has_receivings, has_payments = voucher_lifecycle_info(db, voucher, branch_id)
    assert_can_perform_voucher_action(
        VoucherAction.EDIT,
        status_str,
        has_shipments=has_shipments,
        has_receivings=has_receivings,
        has_payments=has_payments,
    )

    received_by_stock = received_pairs_by_voucher_stock(db, [voucher.voucher_no], branch_id)
    replacement_lines = [_line(db, line) for line in payload.lines]
    new_quantities = {line.stock_code: line.quantity_pairs for line in replacement_lines}
    for (v_no, stock_code), rec_pairs in received_by_stock.items():
        if v_no == voucher.voucher_no and rec_pairs > 0:
            if new_quantities.get(stock_code, 0) < rec_pairs:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    f"Cannot reduce quantity of '{stock_code}' below already received quantity ({rec_pairs} pairs).",
                )

    existing_losses = {line.stock_code: line.lost_quantity_pairs for line in voucher.lines}
    voucher.supplier_name = payload.supplier_name.strip()
    voucher.voucher_date = payload.voucher_date
    voucher.carrier_name = payload.carrier_name.strip()
    voucher.total_packages = payload.total_packages
    for line in replacement_lines:
        line.lost_quantity_pairs = min(existing_losses.get(line.stock_code, 0), line.quantity_pairs)
    voucher.lines = replacement_lines
    voucher.updated_at = func.now()

    record_audit_log(
        db,
        branch_id=voucher.branch_id,
        entity_type="voucher",
        entity_id=voucher.id,
        action="edit",
        operator_id=operator_id,
        summary=f"Updated supplier voucher {voucher.voucher_no}",
        payload={
            "voucher_no": voucher.voucher_no,
            "supplier_name": voucher.supplier_name,
            "line_count": len(voucher.lines),
        },
    )
    db.commit()
    return _load(db, voucher_id, branch_id)


def delete_voucher(
    db: Session,
    voucher_id: str,
    branch_id: str | None,
    operator_id: str | None = None,
) -> None:
    voucher = _load(db, voucher_id, branch_id)
    status_str, has_shipments, has_receivings, has_payments = voucher_lifecycle_info(db, voucher, branch_id)
    assert_can_perform_voucher_action(
        VoucherAction.DELETE,
        status_str,
        has_shipments=has_shipments,
        has_receivings=has_receivings,
        has_payments=has_payments,
    )
    record_audit_log(
        db,
        branch_id=voucher.branch_id,
        entity_type="voucher",
        entity_id=voucher.id,
        action="delete",
        operator_id=operator_id,
        summary=f"Deleted supplier voucher {voucher.voucher_no}",
        payload={"voucher_no": voucher.voucher_no, "supplier_name": voucher.supplier_name},
    )
    db.delete(voucher)
    db.commit()


def add_payment(
    db: Session,
    voucher_id: str,
    branch_id: str | None,
    user_id: str,
    payload,
) -> WholesalePayment:
    voucher = _load(db, voucher_id, branch_id)
    status_str, has_shipments, has_receivings, has_payments = voucher_lifecycle_info(db, voucher, branch_id)
    assert_can_perform_voucher_action(
        VoucherAction.ADD_PAYMENT,
        status_str,
        has_shipments=has_shipments,
        has_receivings=has_receivings,
        has_payments=has_payments,
    )
    total = voucher_totals(voucher)["total"]
    paid = sum(float(payment.amount) for payment in voucher.payments)
    if paid + payload.amount > total:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Payment cannot exceed the voucher balance")
    payment = WholesalePayment(
        branch_id=voucher.branch_id,
        voucher_id=voucher.id,
        paid_on=payload.paid_on,
        amount=payload.amount,
        note=payload.note.strip(),
        recorded_by_user_id=user_id,
    )
    voucher.updated_at = func.now()
    db.add(payment)
    record_audit_log(
        db,
        branch_id=voucher.branch_id,
        entity_type="voucher",
        entity_id=voucher.id,
        action="add_payment",
        operator_id=user_id,
        summary=f"Added payment {payload.amount} to voucher {voucher.voucher_no}",
        payload={
            "amount": float(payload.amount),
            "paid_on": str(payload.paid_on),
            "voucher_no": voucher.voucher_no,
        },
    )
    db.commit()
    db.refresh(payment)
    return payment


def delete_payment(
    db: Session,
    voucher_id: str,
    payment_id: str,
    branch_id: str | None,
    operator_id: str | None = None,
) -> None:
    voucher = _load(db, voucher_id, branch_id)
    status_str, has_shipments, has_receivings, has_payments = voucher_lifecycle_info(db, voucher, branch_id)
    assert_can_perform_voucher_action(
        VoucherAction.DELETE_PAYMENT,
        status_str,
        has_shipments=has_shipments,
        has_receivings=has_receivings,
        has_payments=has_payments,
    )
    payment = next((entry for entry in voucher.payments if entry.id == payment_id), None)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    voucher.updated_at = func.now()
    record_audit_log(
        db,
        branch_id=voucher.branch_id,
        entity_type="voucher",
        entity_id=voucher.id,
        action="delete_payment",
        operator_id=operator_id,
        summary=f"Deleted payment {payment.amount} from voucher {voucher.voucher_no}",
        payload={
            "amount": float(payment.amount),
            "payment_id": payment.id,
            "voucher_no": voucher.voucher_no,
        },
    )
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

