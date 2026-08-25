from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.user import User
from app.models.wholesale import CustomerOrder, FactoryVoucher, OrderStatus
from app.schemas.wholesale import CustomerOrderCreate, CustomerOrderOut, CustomerOrderUpdate
from app.services.branches import resolve_branch_id
from app.services.wholesale import (
    apply_existing_voucher_to_order,
    colors_total,
    next_order_no,
    validate_received_qty,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _to_out(order: CustomerOrder, branch_name: str | None, matched_voucher_no: int | None) -> CustomerOrderOut:
    return CustomerOrderOut(
        id=order.id,
        order_no=order.order_no,
        branch_id=order.branch_id,
        branch_name=branch_name,
        order_date=order.order_date,
        product_code=order.product_code,
        factory_name=order.factory_name,
        customer_name=order.customer_name,
        first_commit_qty=order.first_commit_qty,
        second_commit_qty=order.second_commit_qty,
        colors=order.colors,
        total_qty=order.total_qty,
        received_qty=order.received_qty,
        unit=order.unit,
        buying_price=order.buying_price,
        status=order.status,
        matched_voucher_id=order.matched_voucher_id,
        matched_voucher_no=matched_voucher_no,
        remark=order.remark,
        created_at=order.created_at,
    )


def _get_owned_order(order_id: str, user: User, db: Session) -> CustomerOrder:
    order = db.get(CustomerOrder, order_id)
    if order is None or (user.branch_id is not None and order.branch_id != user.branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


@router.get("")
def list_orders(user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> list[CustomerOrderOut]:
    query = db.query(CustomerOrder, Branch, FactoryVoucher.voucher_no).outerjoin(
        Branch, CustomerOrder.branch_id == Branch.id
    ).outerjoin(FactoryVoucher, CustomerOrder.matched_voucher_id == FactoryVoucher.id)
    if user.branch_id is not None:
        query = query.filter(CustomerOrder.branch_id == user.branch_id)
    query = query.order_by(CustomerOrder.order_no.desc())

    return [_to_out(order, branch.name if branch else None, voucher_no) for order, branch, voucher_no in query.all()]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_order(
    payload: CustomerOrderCreate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> CustomerOrderOut:
    branch_id = resolve_branch_id(user, payload.branch_id, db)
    colors = [c.model_dump() for c in payload.colors]
    total_qty = colors_total(colors)
    validate_received_qty(payload.received_qty, total_qty)

    order = CustomerOrder(
        order_no=next_order_no(db),
        branch_id=branch_id,
        order_date=payload.order_date,
        product_code=payload.product_code,
        factory_name=payload.factory_name,
        customer_name=payload.customer_name,
        first_commit_qty=payload.first_commit_qty,
        second_commit_qty=payload.second_commit_qty,
        colors=colors,
        total_qty=total_qty,
        received_qty=payload.received_qty,
        unit=payload.unit,
        remark=payload.remark,
        status=OrderStatus.NOT_START,
    )
    apply_existing_voucher_to_order(db, order)
    db.add(order)
    db.commit()
    db.refresh(order)

    branch = db.get(Branch, branch_id) if branch_id else None
    voucher_no = db.get(FactoryVoucher, order.matched_voucher_id).voucher_no if order.matched_voucher_id else None
    return _to_out(order, branch.name if branch else None, voucher_no)


@router.patch("/{order_id}")
def update_order(
    order_id: str,
    payload: CustomerOrderUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> CustomerOrderOut:
    order = _get_owned_order(order_id, user, db)
    updates = payload.model_dump(exclude_unset=True)

    if "colors" in updates:
        colors = [c if isinstance(c, dict) else c.model_dump() for c in updates.pop("colors")]
        order.colors = colors
        order.total_qty = colors_total(colors)

    for field, value in updates.items():
        setattr(order, field, value)

    validate_received_qty(order.received_qty, order.total_qty)

    if payload.product_code is not None:
        apply_existing_voucher_to_order(db, order)

    db.commit()
    db.refresh(order)

    branch = db.get(Branch, order.branch_id) if order.branch_id else None
    voucher_no = db.get(FactoryVoucher, order.matched_voucher_id).voucher_no if order.matched_voucher_id else None
    return _to_out(order, branch.name if branch else None, voucher_no)


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(
    order_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> None:
    order = _get_owned_order(order_id, user, db)
    db.delete(order)
    db.commit()
