from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.wholesale import (
    CustomerOrder,
    CustomerOrderLine,
    FactoryVoucher,
    FactoryVoucherLine,
    OrderStatus,
    WarehouseReceipt,
)


def colors_total(colors: list[dict]) -> Decimal:
    return sum((Decimal(str(c["qty"])) for c in colors), Decimal("0"))


def next_order_no(db: Session) -> int:
    return (db.query(func.max(CustomerOrder.order_no)).scalar() or 0) + 1


def next_voucher_no(db: Session) -> int:
    return (db.query(func.max(FactoryVoucher.voucher_no)).scalar() or 0) + 1


def latest_voucher_line_for(db: Session, branch_id: str | None, product_code: str) -> FactoryVoucherLine | None:
    return (
        db.query(FactoryVoucherLine)
        .join(FactoryVoucher, FactoryVoucherLine.voucher_id == FactoryVoucher.id)
        .filter(FactoryVoucher.branch_id == branch_id, FactoryVoucherLine.product_code == product_code)
        .order_by(FactoryVoucherLine.created_at.desc())
        .first()
    )


def apply_voucher_line_to_orders(db: Session, voucher_line: FactoryVoucherLine, branch_id: str | None) -> list[CustomerOrderLine]:
    """Price every still-open order line matching this voucher line's (branch, product_code).

    A voucher line usually fulfills several customer order lines for the same product at once
    (that's how wholesale MOQs work), so this deliberately updates every match, not a single
    line. Lines already `complete` are left untouched — "latest voucher wins" only applies to
    lines still in flight.
    """
    lines = (
        db.query(CustomerOrderLine)
        .join(CustomerOrder, CustomerOrderLine.order_id == CustomerOrder.id)
        .filter(
            CustomerOrder.branch_id == branch_id,
            CustomerOrderLine.product_code == voucher_line.product_code,
            CustomerOrderLine.status != OrderStatus.COMPLETE,
        )
        .all()
    )
    for line in lines:
        line.buying_price = voucher_line.buying_price
        line.matched_voucher_id = voucher_line.id
        if line.status == OrderStatus.NOT_START:
            line.status = OrderStatus.WAITING
    return lines


def apply_existing_voucher_to_line(db: Session, order: CustomerOrder, line: CustomerOrderLine) -> None:
    """Symmetric to apply_voucher_line_to_orders: pick up an already-existing voucher line on
    order-line create, or when a line's product_code is corrected to match one, instead of
    only reacting to newly-created vouchers."""
    if line.status == OrderStatus.COMPLETE:
        return
    voucher_line = latest_voucher_line_for(db, order.branch_id, line.product_code)
    if voucher_line is None:
        return
    line.buying_price = voucher_line.buying_price
    line.matched_voucher_id = voucher_line.id
    if line.status == OrderStatus.NOT_START:
        line.status = OrderStatus.WAITING


def validate_received_qty(received_qty: float | None, total_qty: float) -> None:
    if received_qty is not None and Decimal(str(received_qty)) > Decimal(str(total_qty)):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "received_qty cannot be greater than total_qty"
        )


def find_voucher_line_for_arrival(db: Session, branch_id: str | None, product_code: str) -> FactoryVoucherLine | None:
    """Warehouse floor staff record a stock code + qty arrival without knowing which factory
    voucher it belongs to — this is what resolves that on their behalf.

    Prefers the oldest voucher (by voucher_date) that still has qty remaining, so a stock code
    split across several open vouchers fills the earliest one first. If every voucher for this
    product code is already fully received, falls back to the most recently created one instead
    of failing — an over-delivery is still worth recording against the voucher it most likely
    belongs to, rather than being rejected outright.
    """
    lines = (
        db.query(FactoryVoucherLine)
        .join(FactoryVoucher, FactoryVoucherLine.voucher_id == FactoryVoucher.id)
        .filter(FactoryVoucher.branch_id == branch_id, FactoryVoucherLine.product_code == product_code)
        .order_by(FactoryVoucher.voucher_date.asc(), FactoryVoucherLine.created_at.asc())
        .all()
    )
    if not lines:
        return None
    for line in lines:
        if Decimal(str(line.received_qty)) < Decimal(str(line.qty)):
            return line
    return lines[-1]


def record_warehouse_receipt(
    db: Session,
    *,
    branch_id: str | None,
    product_code: str,
    warehouse: str,
    qty_received: float,
    received_date,
) -> WarehouseReceipt:
    voucher_line = find_voucher_line_for_arrival(db, branch_id, product_code)
    if voucher_line is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"No factory voucher found for stock code {product_code}",
        )
    voucher_line.received_qty = Decimal(str(voucher_line.received_qty)) + Decimal(str(qty_received))
    receipt = WarehouseReceipt(
        voucher_line_id=voucher_line.id,
        product_code=product_code,
        warehouse=warehouse,
        qty_received=qty_received,
        received_date=received_date,
    )
    db.add(receipt)
    return receipt
