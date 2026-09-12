from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.wholesale import CustomerOrder
from app.schemas.wholesale_orders import OrderIn, OrderPaymentIn
from app.services.branches import resolve_branch_id
from app.services.wholesale.orders import (
    add_payment,
    cancel_order,
    create_order,
    delete_order,
    delete_payment,
    get_order,
    list_orders,
    update_order,
)
from app.services.wholesale.inventory import delivered_pairs_by_order
from app.services.wholesale.references import allocate_reference

router = APIRouter(prefix="/api/wholesale/orders", tags=["wholesale"])


def _require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


def _out(order, delivered_by_stock: dict[str, int] | None = None) -> dict:
    delivered_by_stock = delivered_by_stock or {}
    remaining_deliveries = dict(delivered_by_stock)
    lines = [
        {
            "order_line_id": line.id,
            "stock_code": line.stock_code,
            "description": line.description,
            "group": line.product_group.value,
            "supplier_name": line.supplier_name,
            "color_qty": line.color_qty,
            "unit": line.unit.value,
            "wanted_qty": line.wanted_pairs,
            "received_qty": min(
                remaining_deliveries.get(line.stock_code, 0), line.wanted_pairs
            ),
            "selling_price": float(line.selling_price),
        }
        for line in order.lines
    ]
    for line in lines:
        remaining_deliveries[line["stock_code"]] = max(
            0, remaining_deliveries.get(line["stock_code"], 0) - line["received_qty"]
        )
    payments = [
        {"payment_id": payment.id, "date": payment.paid_on, "amount": float(payment.amount), "note": payment.note}
        for payment in order.payments
    ]
    total = sum(line["wanted_qty"] * line["selling_price"] for line in lines)
    paid = sum(payment["amount"] for payment in payments)
    received = sum(line["received_qty"] for line in lines)
    if order.cancelled:
        order_status = "cancelled"
    elif received == 0:
        order_status = "created"
    else:
        order_status = "processing" if received < sum(line["wanted_qty"] for line in lines) else "completed"
    return {
        "order_id": order.id,
        "branch_id": order.branch_id,
        "order_no": order.order_no,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "customer_address": order.customer_address,
        "order_date": order.order_date,
        "total_qty": sum(line["wanted_qty"] for line in lines),
        "received_qty": received,
        "order_status": order_status,
        "lines": lines,
        "payment": {"account_id": order.id, "payments": payments},
        "total_amount": total,
        "paid_amount": paid,
        "balance": max(0, total - paid),
    }


@router.get("")
def list_customer_orders(
    branch_id: Annotated[str | None, Query()] = None,
    search: Annotated[str, Query(max_length=100)] = "",
    order_status: Annotated[str | None, Query()] = None,
    payment_status: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    _require_wholesale(user)
    resolved_branch_id = resolve_branch_id(user, branch_id, db)
    orders = list_orders(db, resolved_branch_id)
    delivered = delivered_pairs_by_order(db, [order.id for order in orders], resolved_branch_id)
    rows = [_out(order, delivered.get(order.id)) for order in orders]
    query = search.strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in row["order_no"].lower()
            or query in row["customer_name"].lower()
            or any(query in line["stock_code"].lower() or query in line["description"].lower() for line in row["lines"])
        ]
    if order_status:
        rows = [row for row in rows if row["order_status"] == order_status]
    if payment_status:
        rows = [
            row for row in rows
            if ("paid" if row["balance"] == 0 else "partial" if row["paid_amount"] > 0 else "unpaid") == payment_status
        ]
    response.headers["X-Total-Count"] = str(len(rows))
    start = (page - 1) * page_size
    return rows[start : start + page_size]


@router.get("/next-no")
def next_order_no(
    branch_id: Annotated[str | None, Query()] = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_wholesale(user)
    resolved_branch_id = resolve_branch_id(user, branch_id, db)
    return {"order_no": allocate_reference(db, CustomerOrder.order_no, resolved_branch_id, "ORD", date.today())}


@router.get("/{order_id}")
def read_customer_order(order_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    order = get_order(db, order_id, user.branch_id)
    return _out(order, delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_customer_order(payload: OrderIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    order = create_order(db, resolve_branch_id(user, payload.branch_id, db), payload)
    return _out(order)


@router.put("/{order_id}")
def update_customer_order(order_id: str, payload: OrderIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    order = update_order(db, order_id, user.branch_id, payload)
    return _out(order, delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id))


@router.post("/{order_id}/cancel")
def cancel_customer_order(order_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    order = cancel_order(db, order_id, user.branch_id)
    return _out(order, delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id))


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_customer_order(order_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user)
    delete_order(db, order_id, user.branch_id)


@router.post("/{order_id}/payments", status_code=status.HTTP_201_CREATED)
def create_customer_payment(order_id: str, payload: OrderPaymentIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    payment = add_payment(db, order_id, user.branch_id, user.id, payload)
    return {"payment_id": payment.id, "date": payment.paid_on, "amount": float(payment.amount), "note": payment.note}


@router.delete("/{order_id}/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_customer_payment(order_id: str, payment_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user)
    delete_payment(db, order_id, payment_id, user.branch_id)
