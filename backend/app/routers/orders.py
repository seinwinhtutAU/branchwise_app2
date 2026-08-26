from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.user import User
from app.models.wholesale import CustomerOrder, CustomerOrderLine
from app.schemas.wholesale import (
    CustomerOrderCreate,
    CustomerOrderLineCreate,
    CustomerOrderLineOut,
    CustomerOrderLineUpdate,
    CustomerOrderOut,
    CustomerOrderUpdate,
)
from app.services.branches import resolve_branch_id
from app.services.wholesale import (
    apply_existing_voucher_to_line,
    colors_total,
    next_order_no,
    validate_received_qty,
)

router = APIRouter(prefix="/api/orders", tags=["orders"])


def _line_to_out(line: CustomerOrderLine) -> CustomerOrderLineOut:
    voucher_line = line.matched_voucher_line
    return CustomerOrderLineOut(
        id=line.id,
        order_id=line.order_id,
        product_code=line.product_code,
        description=line.description,
        factory_name=line.factory_name,
        first_commit_qty=line.first_commit_qty,
        second_commit_qty=line.second_commit_qty,
        colors=line.colors,
        total_qty=line.total_qty,
        received_qty=line.received_qty,
        unit=line.unit,
        buying_price=line.buying_price,
        status=line.status,
        matched_voucher_id=line.matched_voucher_id,
        matched_voucher_no=voucher_line.voucher.voucher_no if voucher_line else None,
    )


def _order_to_out(order: CustomerOrder, branch_name: str | None) -> CustomerOrderOut:
    return CustomerOrderOut(
        id=order.id,
        order_no=order.order_no,
        branch_id=order.branch_id,
        branch_name=branch_name,
        order_date=order.order_date,
        customer_name=order.customer_name,
        remark=order.remark,
        created_at=order.created_at,
        lines=[_line_to_out(line) for line in order.lines],
    )


def _get_owned_order(order_id: str, user: User, db: Session) -> CustomerOrder:
    order = db.get(CustomerOrder, order_id)
    if order is None or (user.branch_id is not None and order.branch_id != user.branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order not found")
    return order


def _get_owned_line(order_id: str, line_id: str, user: User, db: Session) -> tuple[CustomerOrder, CustomerOrderLine]:
    order = _get_owned_order(order_id, user, db)
    line = db.get(CustomerOrderLine, line_id)
    if line is None or line.order_id != order.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Order line not found")
    return order, line


def _new_line(payload: CustomerOrderLineCreate) -> CustomerOrderLine:
    colors = [c.model_dump() for c in payload.colors]
    total_qty = colors_total(colors)
    validate_received_qty(payload.received_qty, total_qty)
    return CustomerOrderLine(
        product_code=payload.product_code,
        description=payload.description,
        factory_name=payload.factory_name,
        first_commit_qty=payload.first_commit_qty,
        second_commit_qty=payload.second_commit_qty,
        colors=colors,
        total_qty=total_qty,
        received_qty=payload.received_qty,
        unit=payload.unit,
        status=payload.status,
    )


@router.get("")
def list_orders(user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> list[CustomerOrderOut]:
    query = db.query(CustomerOrder, Branch).outerjoin(Branch, CustomerOrder.branch_id == Branch.id)
    if user.branch_id is not None:
        query = query.filter(CustomerOrder.branch_id == user.branch_id)
    query = query.order_by(CustomerOrder.order_no.desc())

    return [_order_to_out(order, branch.name if branch else None) for order, branch in query.all()]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_order(
    payload: CustomerOrderCreate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> CustomerOrderOut:
    branch_id = resolve_branch_id(user, payload.branch_id, db)

    order = CustomerOrder(
        order_no=next_order_no(db),
        branch_id=branch_id,
        order_date=payload.order_date,
        customer_name=payload.customer_name,
        remark=payload.remark,
    )
    line = _new_line(payload.line)
    order.lines.append(line)
    db.add(order)
    db.flush()
    apply_existing_voucher_to_line(db, order, line)
    db.commit()
    db.refresh(order)

    branch = db.get(Branch, branch_id) if branch_id else None
    return _order_to_out(order, branch.name if branch else None)


@router.patch("/{order_id}")
def update_order(
    order_id: str,
    payload: CustomerOrderUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> CustomerOrderOut:
    order = _get_owned_order(order_id, user, db)
    updates = payload.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(order, field, value)

    db.commit()
    db.refresh(order)

    branch = db.get(Branch, order.branch_id) if order.branch_id else None
    return _order_to_out(order, branch.name if branch else None)


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order(
    order_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> None:
    order = _get_owned_order(order_id, user, db)
    db.delete(order)
    db.commit()


@router.post("/{order_id}/lines", status_code=status.HTTP_201_CREATED)
def add_order_line(
    order_id: str,
    payload: CustomerOrderLineCreate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> CustomerOrderOut:
    order = _get_owned_order(order_id, user, db)
    line = _new_line(payload)
    order.lines.append(line)
    db.flush()
    apply_existing_voucher_to_line(db, order, line)
    db.commit()
    db.refresh(order)

    branch = db.get(Branch, order.branch_id) if order.branch_id else None
    return _order_to_out(order, branch.name if branch else None)


@router.patch("/{order_id}/lines/{line_id}")
def update_order_line(
    order_id: str,
    line_id: str,
    payload: CustomerOrderLineUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> CustomerOrderOut:
    order, line = _get_owned_line(order_id, line_id, user, db)
    updates = payload.model_dump(exclude_unset=True)

    if "colors" in updates:
        colors = [c if isinstance(c, dict) else c.model_dump() for c in updates.pop("colors")]
        line.colors = colors
        line.total_qty = colors_total(colors)

    for field, value in updates.items():
        setattr(line, field, value)

    validate_received_qty(line.received_qty, line.total_qty)

    if payload.product_code is not None:
        apply_existing_voucher_to_line(db, order, line)

    db.commit()
    db.refresh(order)

    branch = db.get(Branch, order.branch_id) if order.branch_id else None
    return _order_to_out(order, branch.name if branch else None)


@router.delete("/{order_id}/lines/{line_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_order_line(
    order_id: str,
    line_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    order, line = _get_owned_line(order_id, line_id, user, db)
    db.delete(line)
    db.flush()
    # A product line is the unit of an order — an order with none left behind has nothing to show.
    remaining = db.query(CustomerOrderLine).filter(CustomerOrderLine.order_id == order.id).count()
    if remaining == 0:
        db.delete(order)
    db.commit()
