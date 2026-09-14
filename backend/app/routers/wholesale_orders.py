from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.wholesale import CustomerOrder
from app.schemas.wholesale_orders import OrderIn, OrderLineAllocationIn, OrderPaymentIn
from app.services.branches import resolve_branch_id
from app.services.wholesale.orders import (
    add_payment,
    allocate_order_line,
    cancel_order,
    create_order,
    delete_order,
    delete_payment,
    get_order,
    list_allocation_events,
    list_orders,
    update_order,
)
from app.services.wholesale.inventory import (
    color_pairs_breakdown,
    delivered_color_pairs_by_order,
    delivered_pairs_by_order,
    effective_allocated_color_pairs,
)
from app.services.wholesale.references import allocate_reference
from app.services.wholesale_supplier_vouchers import stock_codes_with_open_vouchers

router = APIRouter(prefix="/api/wholesale/orders", tags=["wholesale"])


def _require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


def _out(
    order,
    delivered_by_stock: dict[str, int] | None = None,
    procuring_stock_codes: set[str] | None = None,
    delivered_colors_by_stock: dict[str, dict[str, int]] | None = None,
) -> dict:
    delivered_by_stock = delivered_by_stock or {}
    procuring_stock_codes = procuring_stock_codes or set()
    delivered_colors_by_stock = delivered_colors_by_stock or {}
    remaining_deliveries = dict(delivered_by_stock)
    lines = []
    for line in order.lines:
        effective_colors = effective_allocated_color_pairs(
            line,
            delivered_colors_by_stock.get(line.stock_code),
        )
        stored_colors = effective_allocated_color_pairs(line)
        lines.append({
            "order_line_id": line.id,
            "stock_code": line.stock_code,
            "description": line.description,
            "product_group": line.product_group.value,
            "supplier_name": line.supplier_name,
            "color_breakdown": line.color_breakdown,
            "unit": line.unit.value,
            "quantity_pairs": line.quantity_pairs,
            "allocated_quantity_pairs": sum(effective_colors.values()),
            "allocated_color_breakdown": (
                line.allocated_color_breakdown
                if effective_colors == stored_colors
                else color_pairs_breakdown(effective_colors)
            ),
            "delivered_quantity_pairs": min(
                remaining_deliveries.get(line.stock_code, 0), line.quantity_pairs
            ),
            "selling_price": float(line.selling_price),
        })
    for line in lines:
        remaining_deliveries[line["stock_code"]] = max(
            0, remaining_deliveries.get(line["stock_code"], 0) - line["delivered_quantity_pairs"]
        )
    payments = [
        {"payment_id": payment.id, "paid_on": payment.paid_on, "amount": float(payment.amount), "note": payment.note}
        for payment in order.payments
    ]
    total = sum(line["quantity_pairs"] * line["selling_price"] for line in lines)
    paid = sum(payment["amount"] for payment in payments)
    received = sum(line["delivered_quantity_pairs"] for line in lines)
    total_wanted = sum(line["quantity_pairs"] for line in lines)
    # "Processing" says buying has started — a supplier voucher exists for something
    # this order still needs — before any of it has actually reached the customer.
    # Once something has, the status is about delivery instead: see
    # app/services/wholesale_supplier_vouchers.py::stock_codes_with_open_vouchers.
    if order.cancelled:
        order_status = "cancelled"
    elif received > 0:
        order_status = "partly_delivered" if received < total_wanted else "completed"
    elif any(line["stock_code"] in procuring_stock_codes for line in lines):
        order_status = "processing"
    else:
        order_status = "created"
    return {
        "order_id": order.id,
        "branch_id": order.branch_id,
        "order_no": order.order_no,
        "customer_name": order.customer_name,
        "customer_phone": order.customer_phone,
        "customer_address": order.customer_address,
        "order_date": order.order_date,
        "total_quantity_pairs": total_wanted,
        "delivered_quantity_pairs": received,
        "order_status": order_status,
        "lines": lines,
        "payment": {"account_id": order.id, "payments": payments},
        "total_amount": total,
        "paid_amount": paid,
        "balance_due": max(0, total - paid),
    }


def _procuring(db: Session, branch_id: str | None, orders: list[CustomerOrder]) -> set[str]:
    stock_codes = {line.stock_code for order in orders for line in order.lines}
    return stock_codes_with_open_vouchers(db, branch_id, stock_codes)


def _delivered_colors(db: Session, order: CustomerOrder, branch_id: str | None) -> dict[str, dict[str, int]]:
    return {
        line.stock_code: delivered_color_pairs_by_order(
            db, order.id, line.stock_code, branch_id,
        )
        for line in order.lines
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
    procuring = _procuring(db, resolved_branch_id, orders)
    rows = [
        _out(
            order,
            delivered.get(order.id),
            procuring,
            _delivered_colors(db, order, resolved_branch_id),
        )
        for order in orders
    ]
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
            if ("paid" if row["balance_due"] == 0 else "partial" if row["paid_amount"] > 0 else "unpaid") == payment_status
        ]
    response.headers["X-Total-Count"] = str(len(rows))
    start = (page - 1) * page_size
    return rows[start : start + page_size]


@router.get("/allocations")
def list_customer_order_allocations(
    branch_id: Annotated[str | None, Query()] = None,
    search: Annotated[str, Query(max_length=100)] = "",
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    _require_wholesale(user)
    resolved_branch_id = resolve_branch_id(user, branch_id, db)
    events = list_allocation_events(db, resolved_branch_id, search)
    response.headers["X-Total-Count"] = str(len(events))
    start = (page - 1) * page_size
    return [
        {
            "event_id": event.id,
            "order_id": event.order_id,
            "order_line_id": event.order_line_id,
            "order_no": event.order_no,
            "customer_name": event.customer_name,
            "stock_code": event.stock_code,
            "description": event.description,
            "product_group": event.product_group.value,
            "unit": event.unit.value,
            "previous_color_breakdown": event.previous_color_breakdown,
            "previous_quantity_pairs": event.previous_quantity_pairs,
            "color_breakdown": event.color_breakdown,
            "quantity_pairs": event.quantity_pairs,
            "recorded_by_user_id": event.recorded_by_user_id,
            "created_at": event.created_at,
        }
        for event in events[start : start + page_size]
    ]


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
    return _out(
        order,
        delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id),
        _procuring(db, user.branch_id, [order]),
        _delivered_colors(db, order, user.branch_id),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_customer_order(payload: OrderIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    branch_id = resolve_branch_id(user, payload.branch_id, db)
    order = create_order(db, branch_id, payload)
    return _out(order, None, _procuring(db, branch_id, [order]), _delivered_colors(db, order, branch_id))


@router.put("/{order_id}")
def update_customer_order(order_id: str, payload: OrderIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    order = update_order(db, order_id, user.branch_id, payload)
    return _out(
        order,
        delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id),
        _procuring(db, user.branch_id, [order]),
        _delivered_colors(db, order, user.branch_id),
    )


@router.post("/{order_id}/cancel")
def cancel_customer_order(order_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    order = cancel_order(db, order_id, user.branch_id)
    return _out(
        order,
        delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id),
        delivered_colors_by_stock=_delivered_colors(db, order, user.branch_id),
    )


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_customer_order(order_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user)
    delete_order(db, order_id, user.branch_id)


@router.post("/{order_id}/payments", status_code=status.HTTP_201_CREATED)
def create_customer_payment(order_id: str, payload: OrderPaymentIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    payment = add_payment(db, order_id, user.branch_id, user.id, payload)
    return {"payment_id": payment.id, "paid_on": payment.paid_on, "amount": float(payment.amount), "note": payment.note}


@router.put("/lines/{order_line_id}/allocation")
def update_customer_order_line_allocation(
    order_line_id: str,
    payload: OrderLineAllocationIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_wholesale(user)
    line = allocate_order_line(db, order_line_id, user.branch_id, payload.color_breakdown, user.id)
    order = get_order(db, line.order_id, user.branch_id)
    return _out(
        order,
        delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id),
        _procuring(db, user.branch_id, [order]),
        _delivered_colors(db, order, user.branch_id),
    )


@router.delete("/{order_id}/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_customer_payment(order_id: str, payment_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user)
    delete_payment(db, order_id, payment_id, user.branch_id)
