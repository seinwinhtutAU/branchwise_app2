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
