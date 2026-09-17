from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.wholesale.models.entities import CustomerOrder
from app.wholesale.schemas.orders import OrderIn, OrderLineAllocationIn, OrderPaymentIn
from app.wholesale.schemas.write_offs import WriteOffIn
from app.services.branches import resolve_wholesale_branch_id
from app.wholesale.services.orders import (
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
    order_status,
)
from app.wholesale.services.lifecycle import get_allowed_order_actions
from app.wholesale.services.money import order_totals
from app.wholesale.services.inventory import (
    color_pairs_breakdown,
    delivered_color_pairs_by_order,
    delivered_pairs_by_order,
    effective_allocated_color_pairs,
)
from app.wholesale.services.references import allocate_reference
from app.wholesale.services.write_offs import write_off_order_line, write_off_to_dict
from app.wholesale.routers.common import paginate, require_wholesale

router = APIRouter(prefix="/api/wholesale/orders", tags=["wholesale"])


def _visible_branch_id(user: User, branch_id: str | None) -> str | None:
    """For a read: a branch-scoped account's own branch always wins; an admin with no
    branch_id filter sees every branch (None = unrestricted), same as every other
    wholesale list endpoint. Unlike resolve_wholesale_branch_id, this never raises —
    "show me everything" is a perfectly good answer for admin on a read, just not on a
    write, which needs to say which branch owns the new row."""
    return user.branch_id if user.branch_id is not None else branch_id


def _out(
    order,
    delivered_by_stock: dict[str, int] | None = None,
    delivered_colors_by_stock: dict[str, dict[str, int]] | None = None,
) -> dict:
    delivered_by_stock = delivered_by_stock or {}
    delivered_colors_by_stock = delivered_colors_by_stock or {}
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
            "unit_conversions": line.unit_conversions,
            "quantity_pairs": line.quantity_pairs,
            "allocated_quantity_pairs": sum(effective_colors.values()),
            "allocated_color_breakdown": (
                line.allocated_color_breakdown
                if effective_colors == stored_colors
                else color_pairs_breakdown(effective_colors)
            ),
            "delivered_quantity_pairs": min(
                delivered_by_stock.get(line.stock_code, 0), line.quantity_pairs
            ),
            # What has gone out, by colour. The screen needs this to know how much of a
            # single colour is still owed — the ordered colours alone only give it the
            # line total, which let a per-colour over-delivery be typed and then refused
            # by the server. A stock code can only appear on one line of an order, so
            # this maps to exactly this line.
            "delivered_color_breakdown": color_pairs_breakdown(
                delivered_colors_by_stock.get(line.stock_code) or {}
            ),
            "lost_quantity_pairs": line.lost_quantity_pairs,
            "remaining_quantity_pairs": max(
                0,
                line.quantity_pairs
                - min(delivered_by_stock.get(line.stock_code, 0), line.quantity_pairs)
                - line.lost_quantity_pairs,
            ),
            "selling_price": float(line.selling_price),
            "currency_code": line.currency_code,
            "original_selling_price": float(line.original_selling_price) if line.original_selling_price is not None else None,
            "exchange_rate": float(line.exchange_rate) if line.exchange_rate is not None else None,
        })
    payments = [
        {
            "payment_id": payment.id,
            "paid_on": payment.paid_on,
            "amount": float(payment.amount),
            "paid_quantity_pairs": payment.paid_quantity_pairs,
            "note": payment.note,
        }
        for payment in order.payments
    ]
    totals = order_totals(order)
    received = sum(line["delivered_quantity_pairs"] for line in lines)
    total_wanted = sum(line["quantity_pairs"] for line in lines)
    allocated = sum(line["allocated_quantity_pairs"] for line in lines)
    lost = sum(line["lost_quantity_pairs"] for line in lines)
    status_value = order_status(total_wanted, received, allocated, order.cancelled, lost)
    allowed_actions = get_allowed_order_actions(
        status_value,
        has_payments=len(payments) > 0,
        has_movements=received > 0,
    )
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
        "lost_quantity_pairs": lost,
        "remaining_quantity_pairs": max(0, total_wanted - received - lost),
        "order_status": status_value,
        "allowed_actions": allowed_actions,
        "version_id": getattr(order, "version_id", 1),
        "lines": lines,
        "payment": {"account_id": order.id, "payments": payments},
        "total_amount": totals["total"],
        "paid_amount": totals["paid"],
        "balance_due": totals["balance_due"],
    }


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
    require_wholesale(user)
    resolved_branch_id = _visible_branch_id(user, branch_id)
    orders = list_orders(db, resolved_branch_id)
    delivered = delivered_pairs_by_order(db, [order.id for order in orders], resolved_branch_id)
    rows = [
        _out(
            order,
            delivered.get(order.id),
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
            if ("paid" if row["balance_due"] <= 0 else "partial" if row["paid_amount"] > 0 else "unpaid") == payment_status
        ]
    return paginate(rows, page, page_size, response)


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
    require_wholesale(user)
    resolved_branch_id = _visible_branch_id(user, branch_id)
    events = paginate(list_allocation_events(db, resolved_branch_id, search), page, page_size, response)
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
            "unit_conversions": event.unit_conversions,
            "previous_color_breakdown": event.previous_color_breakdown,
            "previous_quantity_pairs": event.previous_quantity_pairs,
            "color_breakdown": event.color_breakdown,
            "quantity_pairs": event.quantity_pairs,
            "recorded_by_user_id": event.recorded_by_user_id,
            "created_at": event.created_at,
        }
        for event in events
    ]


@router.get("/next-no")
def next_order_no(
    branch_id: Annotated[str | None, Query()] = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    resolved_branch_id = _visible_branch_id(user, branch_id)
    return {"order_no": allocate_reference(db, CustomerOrder.order_no, resolved_branch_id, "ORD", date.today())}


@router.get("/{order_id}")
def read_customer_order(order_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    require_wholesale(user)
    order = get_order(db, order_id, user.branch_id)
    return _out(
        order,
        delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id),
        _delivered_colors(db, order, user.branch_id),
    )


@router.post("", status_code=status.HTTP_201_CREATED)
def create_customer_order(payload: OrderIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    require_wholesale(user)
    branch_id = resolve_wholesale_branch_id(user, payload.branch_id, db)
    order = create_order(db, branch_id, payload, operator_id=user.id)
    return _out(order, None, _delivered_colors(db, order, branch_id))


@router.put("/{order_id}")
def update_customer_order(order_id: str, payload: OrderIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    require_wholesale(user)
    order = update_order(db, order_id, user.branch_id, payload, operator_id=user.id)
    return _out(
        order,
        delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id),
        _delivered_colors(db, order, user.branch_id),
    )


@router.post("/{order_id}/cancel")
def cancel_customer_order(order_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    require_wholesale(user)
    order = cancel_order(db, order_id, user.branch_id, operator_id=user.id)
    return _out(
        order,
        delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id),
        delivered_colors_by_stock=_delivered_colors(db, order, user.branch_id),
    )


@router.delete("/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_customer_order(order_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    require_wholesale(user)
    delete_order(db, order_id, user.branch_id, operator_id=user.id)


@router.post("/{order_id}/payments", status_code=status.HTTP_201_CREATED)
def create_customer_payment(order_id: str, payload: OrderPaymentIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    require_wholesale(user)
    payment = add_payment(db, order_id, user.branch_id, user.id, payload)
    return {
        "payment_id": payment.id,
        "paid_on": payment.paid_on,
        "amount": float(payment.amount),
        "paid_quantity_pairs": payment.paid_quantity_pairs,
        "note": payment.note,
    }


@router.put("/lines/{order_line_id}/allocation")
def update_customer_order_line_allocation(
    order_line_id: str,
    payload: OrderLineAllocationIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    line = allocate_order_line(db, order_line_id, user.branch_id, payload.color_breakdown, user.id)
    order = get_order(db, line.order_id, user.branch_id)
    return _out(
        order,
        delivered_pairs_by_order(db, [order.id], user.branch_id).get(order.id),
        _delivered_colors(db, order, user.branch_id),
    )


@router.post("/lines/{line_id}/write-off", status_code=status.HTTP_201_CREATED)
def write_off_customer_order_line(
    line_id: str,
    payload: WriteOffIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    entry = write_off_order_line(
        db, line_id, payload.quantity, payload.reason, payload.note, user.id,
        branch_id=user.branch_id,
    )
    return write_off_to_dict(entry)


@router.delete("/{order_id}/payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_customer_payment(order_id: str, payment_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    require_wholesale(user)
    delete_payment(db, order_id, payment_id, user.branch_id)
