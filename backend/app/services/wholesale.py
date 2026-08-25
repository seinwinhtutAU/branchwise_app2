from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.wholesale import CustomerOrder, FactoryVoucher, OrderStatus


def colors_total(colors: list[dict]) -> Decimal:
    return sum((Decimal(str(c["qty"])) for c in colors), Decimal("0"))


def next_order_no(db: Session) -> int:
    return (db.query(func.max(CustomerOrder.order_no)).scalar() or 0) + 1


def next_voucher_no(db: Session) -> int:
    return (db.query(func.max(FactoryVoucher.voucher_no)).scalar() or 0) + 1


def latest_voucher_for(db: Session, branch_id: str | None, product_code: str) -> FactoryVoucher | None:
    return (
        db.query(FactoryVoucher)
        .filter(FactoryVoucher.branch_id == branch_id, FactoryVoucher.product_code == product_code)
        .order_by(FactoryVoucher.created_at.desc())
        .first()
    )


def apply_voucher_to_orders(db: Session, voucher: FactoryVoucher) -> list[CustomerOrder]:
    """Price every still-open order matching this voucher's (branch, product_code).

    A voucher usually fulfills several customer orders for the same product at once (that's
    how wholesale MOQs work), so this deliberately updates every match, not a single order.
    Orders already `complete` are left untouched — "latest voucher wins" only applies to
    orders still in flight.
    """
    orders = (
        db.query(CustomerOrder)
        .filter(
            CustomerOrder.branch_id == voucher.branch_id,
            CustomerOrder.product_code == voucher.product_code,
            CustomerOrder.status != OrderStatus.COMPLETE,
        )
        .all()
    )
    for order in orders:
        order.buying_price = voucher.buying_price
        order.matched_voucher_id = voucher.id
        if order.status == OrderStatus.NOT_START:
            order.status = OrderStatus.WAITING
    return orders


def apply_existing_voucher_to_order(db: Session, order: CustomerOrder) -> None:
    """Symmetric to apply_voucher_to_orders: pick up an already-existing voucher on order
    create, or when an order's product_code is corrected to match one, instead of only
    reacting to newly-created vouchers."""
    if order.status == OrderStatus.COMPLETE:
        return
    voucher = latest_voucher_for(db, order.branch_id, order.product_code)
    if voucher is None:
        return
    order.buying_price = voucher.buying_price
    order.matched_voucher_id = voucher.id
    if order.status == OrderStatus.NOT_START:
        order.status = OrderStatus.WAITING


def validate_received_qty(received_qty: float | None, total_qty: float) -> None:
    if received_qty is not None and Decimal(str(received_qty)) > Decimal(str(total_qty)):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "received_qty cannot be greater than total_qty"
        )
