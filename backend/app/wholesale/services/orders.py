"""Customer orders and their customer-side payments.

The quantities delivered to a customer are not written here: Inventory will own those
outgoing movements. Until that phase is connected, an order truthfully reports zero
received pairs. Payments, however, already have a real source of truth and are kept in
``wholesale_payments`` alongside supplier payments.
"""

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.wholesale.models.entities import AllocationEvent, CustomerOrder, CustomerOrderLine, WholesalePayment
from app.wholesale.services.colors import (
    color_qty_pairs,
    color_qty_pairs_by_color,
    color_qty_problem,
    colors_as_json,
)
from app.wholesale.services.currency import resolve_money
from app.wholesale.services.master_data import get_or_create_product
from app.wholesale.services.inventory import (
    color_pairs_breakdown,
    delivered_color_pairs_by_order,
    allocated_color_pairs_for_stock_code,
    available_color_pairs_for_stock_code,
    delivered_pairs_by_order,
)
from app.wholesale.services.money import order_totals
from app.wholesale.services.references import allocate_reference, retry_on_reference_collision

_LOAD_OPTIONS = (selectinload(CustomerOrder.lines), selectinload(CustomerOrder.payments))


def order_status(total_wanted: int, received: int, allocated: int, cancelled: bool, lost: int = 0) -> str:
    """Where this order's goods are, in words a shop owner uses.

    Named after the goods rather than after a step somebody performs: arriving stock is
    allocated to waiting orders by itself now (see auto_allocate_arrivals), so a status
    like "allocating" described an activity nobody was doing. "Part of it has arrived"
    and "all of it has arrived" both come out as ready_to_deliver, because the job they
    ask for is the same one — go and hand over what is here — and how much that is is a
    question the quantities answer.
    """
    if cancelled:
        return "cancelled"
    if total_wanted > 0 and received + lost >= total_wanted:
        return "fulfilled"
    if received > 0:
        return "partly_delivered"
    if allocated > 0:
        return "ready_to_deliver"
    return "waiting_for_stock"


def _load(db: Session, order_id: str, branch_id: str | None) -> CustomerOrder:
    order = db.query(CustomerOrder).options(*_LOAD_OPTIONS).filter(CustomerOrder.id == order_id).first()
    if order is None or (branch_id is not None and order.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer order not found")
    return order


def list_orders(db: Session, branch_id: str | None) -> list[CustomerOrder]:
    query = db.query(CustomerOrder).options(*_LOAD_OPTIONS)
    if branch_id is not None:
        query = query.filter(CustomerOrder.branch_id == branch_id)
    return query.order_by(CustomerOrder.order_date.desc(), CustomerOrder.order_no.desc()).all()


def get_order(db: Session, order_id: str, branch_id: str | None) -> CustomerOrder:
    return _load(db, order_id, branch_id)


def _line(db: Session, line_in) -> CustomerOrderLine:
    color_breakdown = line_in.color_breakdown.strip()
    problem = color_qty_problem(color_breakdown)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)
    currency_code, selling_price, original_selling_price, exchange_rate = resolve_money(
        line_in.currency_code, line_in.selling_price, line_in.original_selling_price, line_in.exchange_rate,
    )
    get_or_create_product(
        db, line_in.stock_code, line_in.description, line_in.product_group, line_in.unit, line_in.unit_conversions,
    )
    return CustomerOrderLine(
        stock_code=line_in.stock_code.strip(), description=line_in.description.strip(),
        product_group=line_in.product_group, supplier_name=line_in.supplier_name.strip(),
        color_breakdown=color_breakdown, colors=colors_as_json(color_breakdown), unit=line_in.unit,
        unit_conversions=line_in.unit_conversions,
        quantity_pairs=color_qty_pairs(color_breakdown, line_in.unit, line_in.unit_conversions),
        selling_price=selling_price, currency_code=currency_code,
        original_selling_price=original_selling_price, exchange_rate=exchange_rate,
    )


def _check_no_duplicate_stock_codes(lines) -> None:
    # A delivery only records a stock code and a quantity, never which order line it
    # satisfies — two lines for the same stock code would make delivered-quantity
    # attribution ambiguous (see _out in the router). Put the extra quantity on the
    # existing line instead.
    seen = {line.stock_code.strip().lower() for line in lines}
    if len(seen) != len(lines):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Each stock code can only appear on one line per order")


from app.wholesale.services.audit import record_audit_log
from app.wholesale.services.lifecycle import (
    OrderAction,
    assert_can_perform_order_action,
)


def order_lifecycle_info(db: Session, order: CustomerOrder, branch_id: str | None) -> tuple[str, bool, bool]:
    delivered = delivered_pairs_by_order(db, [order.id], branch_id).get(order.id, {})
    total_delivered = sum(delivered.values())
    total_wanted = sum(line.quantity_pairs for line in order.lines)
    total_allocated = sum(line.allocated_quantity_pairs for line in order.lines)
    total_lost = sum(line.lost_quantity_pairs for line in order.lines)
    status_str = order_status(total_wanted, total_delivered, total_allocated, order.cancelled, total_lost)
    has_payments = len(order.payments) > 0
    has_movements = total_delivered > 0
    return status_str, has_payments, has_movements


def create_order(
    db: Session,
    branch_id: str | None,
    payload,
    operator_id: str | None = None,
) -> CustomerOrder:
    _check_no_duplicate_stock_codes(payload.lines)

    def attempt() -> CustomerOrder:
        order = CustomerOrder(
            branch_id=branch_id,
            order_no=allocate_reference(db, CustomerOrder.order_no, branch_id, "ORD", date.today()),
            customer_name=payload.customer_name.strip(), customer_phone=payload.customer_phone.strip(),
            customer_address=payload.customer_address.strip(), order_date=payload.order_date,
            lines=[_line(db, line) for line in payload.lines],
        )
        db.add(order)
        db.flush()
        record_audit_log(
            db,
            branch_id=branch_id,
            entity_type="order",
            entity_id=order.id,
            action="create",
            operator_id=operator_id,
            summary=f"Created order {order.order_no} for {order.customer_name}",
            payload={
                "order_no": order.order_no,
                "customer_name": order.customer_name,
                "line_count": len(order.lines),
            },
        )
        db.commit()
        return _load(db, order.id, branch_id)

    return retry_on_reference_collision(db, attempt)


def update_order(
    db: Session,
    order_id: str,
    branch_id: str | None,
    payload,
    operator_id: str | None = None,
) -> CustomerOrder:
    _check_no_duplicate_stock_codes(payload.lines)
    order = _load(db, order_id, branch_id)
    status_str, has_payments, has_movements = order_lifecycle_info(db, order, branch_id)
    assert_can_perform_order_action(
        OrderAction.EDIT,
        status_str,
        has_payments=has_payments,
        has_movements=has_movements,
    )
    existing_allocations = {
        line.stock_code: (
            line.allocated_quantity_pairs,
            line.allocated_color_breakdown,
            line.unit,
        )
        for line in order.lines
    }
    existing_losses = {line.stock_code: line.lost_quantity_pairs for line in order.lines}
    order.customer_name = payload.customer_name.strip()
    order.customer_phone = payload.customer_phone.strip()
    order.customer_address = payload.customer_address.strip()
    order.order_date = payload.order_date
    replacement_lines = [_line(db, line) for line in payload.lines]
    for line in replacement_lines:
        line.lost_quantity_pairs = min(existing_losses.get(line.stock_code, 0), line.quantity_pairs)
        allocated = existing_allocations.get(line.stock_code)
        if allocated is None or allocated[0] > line.quantity_pairs:
            continue
        allocated_pairs, allocated_colors, allocated_unit = allocated
        order_colors = color_qty_pairs_by_color(line.color_breakdown, line.unit, line.unit_conversions)
        allocation_colors = color_qty_pairs_by_color(allocated_colors, allocated_unit, line.unit_conversions)
        if any(pairs > order_colors.get(color, 0) for color, pairs in allocation_colors.items()):
            continue
        line.allocated_quantity_pairs = allocated_pairs
        line.allocated_color_breakdown = allocated_colors
    order.lines = replacement_lines
    record_audit_log(
        db,
        branch_id=order.branch_id,
        entity_type="order",
        entity_id=order.id,
        action="edit",
        operator_id=operator_id,
        summary=f"Updated order {order.order_no}",
        payload={
            "customer_name": order.customer_name,
            "customer_phone": order.customer_phone,
            "customer_address": order.customer_address,
            "line_count": len(order.lines),
        },
    )
    db.commit()
    return _load(db, order_id, branch_id)


def cancel_order(
    db: Session,
    order_id: str,
    branch_id: str | None,
    operator_id: str | None = None,
) -> CustomerOrder:
    order = _load(db, order_id, branch_id)
    status_str, has_payments, has_movements = order_lifecycle_info(db, order, branch_id)
    assert_can_perform_order_action(
        OrderAction.CANCEL,
        status_str,
        has_payments=has_payments,
        has_movements=has_movements,
    )
    order.cancelled = True
    for line in order.lines:
        line.allocated_quantity_pairs = 0
        line.allocated_color_breakdown = ""
    record_audit_log(
        db,
        branch_id=order.branch_id,
        entity_type="order",
        entity_id=order.id,
        action="cancel",
        operator_id=operator_id,
        summary=f"Cancelled order {order.order_no}",
        payload={"order_no": order.order_no},
    )
    db.commit()
    return _load(db, order_id, branch_id)


def delete_order(
    db: Session,
    order_id: str,
    branch_id: str | None,
    operator_id: str | None = None,
) -> None:
    order = _load(db, order_id, branch_id)
    status_str, has_payments, has_movements = order_lifecycle_info(db, order, branch_id)
    assert_can_perform_order_action(
        OrderAction.DELETE,
        status_str,
        has_payments=has_payments,
        has_movements=has_movements,
    )
    record_audit_log(
        db,
        branch_id=order.branch_id,
        entity_type="order",
        entity_id=order.id,
        action="delete",
        operator_id=operator_id,
        summary=f"Deleted order {order.order_no}",
        payload={"order_no": order.order_no, "customer_name": order.customer_name},
    )
    db.delete(order)
    db.commit()


def add_payment(db: Session, order_id: str, branch_id: str | None, user_id: str, payload) -> WholesalePayment:
    order = _load(db, order_id, branch_id)
    total = order_totals(order)["total"]
    paid = sum(float(payment.amount) for payment in order.payments)
    if paid + payload.amount > total:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Payment cannot exceed the order balance")
    if payload.paid_quantity_pairs is not None:
        already_paid_pairs = sum(payment.paid_quantity_pairs or 0 for payment in order.payments)
        delivered = delivered_pairs_by_order(db, [order.id], branch_id).get(order.id, {})
        delivered_pairs = sum(delivered.values())
        if already_paid_pairs + payload.paid_quantity_pairs > delivered_pairs:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Paid pairs cannot exceed delivered pairs.",
            )
    payment = WholesalePayment(
        branch_id=order.branch_id, order_id=order.id, paid_on=payload.paid_on,
        amount=payload.amount, paid_quantity_pairs=payload.paid_quantity_pairs,
        note=payload.note.strip(), recorded_by_user_id=user_id,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)
    return payment


def delete_payment(db: Session, order_id: str, payment_id: str, branch_id: str | None) -> None:
    order = _load(db, order_id, branch_id)
    payment = next((entry for entry in order.payments if entry.id == payment_id), None)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Payment not found")
    db.delete(payment)
    db.commit()


def allocate_order_line(
    db: Session,
    order_line_id: str,
    branch_id: str | None,
    color_breakdown: str,
    user_id: str,
) -> CustomerOrderLine:
    """Reserve physical stock against one customer-order line.

    The allocation is stored on the line so it survives navigation and a new session.
    The server derives pairs from the colour shorthand and checks both the order's
    remaining demand and stock available after reservations made for other lines.
    """
    line = (
        db.query(CustomerOrderLine)
        .join(CustomerOrder)
        .options(selectinload(CustomerOrderLine.order))
        .filter(CustomerOrderLine.id == order_line_id)
        .with_for_update()
        .first()
    )
    if line is None or (branch_id is not None and line.order.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer order line not found")
    status_str, has_payments, has_movements = order_lifecycle_info(db, line.order, branch_id)
    assert_can_perform_order_action(
        OrderAction.ALLOCATE,
        status_str,
        has_payments=has_payments,
        has_movements=has_movements,
    )

    value = color_breakdown.strip()
    if value:
        problem = color_qty_problem(value)
        if problem:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)

    requested_pairs = color_qty_pairs(value, line.unit, line.unit_conversions) if value else 0
    delivered = delivered_pairs_by_order(db, [line.order_id], branch_id).get(line.order_id, {}).get(line.stock_code, 0)
    remaining = max(0, line.quantity_pairs - delivered - line.lost_quantity_pairs)
    if requested_pairs > remaining:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Allocation cannot exceed what the customer is still owed")

    requested_colors = color_qty_pairs_by_color(value, line.unit, line.unit_conversions)
    available_colors = available_color_pairs_for_stock_code(db, branch_id, line.stock_code)
    reserved_colors = allocated_color_pairs_for_stock_code(
        db, branch_id, line.stock_code, excluding_line_id=line.id,
    )
    for color, requested in requested_colors.items():
        available = max(0, available_colors.get(color, 0) - reserved_colors.get(color, 0))
        if requested > available:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f'Color "{color}" is not available for allocation in stock',
            )
    reserved_pairs = sum(reserved_colors.values())
    total_available = max(0, sum(available_colors.values()) - reserved_pairs)
    if requested_pairs > total_available:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Allocation cannot exceed available stock")

    # What the caller sent is what should be set aside *from now on* — the same figure
    # the API hands out, which already has the delivered pairs taken off it. The column
    # underneath keeps the older, cumulative meaning, so the delivered pairs go back on
    # before it is written. Without this the two meanings meet in one field: reading gave
    # the net figure, writing stored it as the gross one, and the next read subtracted
    # the deliveries a second time — so pressing Save on the allocation screen after a
    # part delivery quietly ate the rest of the reservation.
    delivered_colors = delivered_color_pairs_by_order(
        db, line.order_id, line.stock_code, branch_id,
    )
    if delivered_colors:
        stored_colors: dict[str, int] = dict(delivered_colors)
        for color, pairs in requested_colors.items():
            stored_colors[color] = stored_colors.get(color, 0) + pairs
        value = color_pairs_breakdown(stored_colors)
        requested_pairs = sum(stored_colors.values())
    # Nothing delivered yet means the two meanings coincide, so the shorthand the user
    # actually typed is kept as it is — "black1s" reads better than "black6p" everywhere
    # it is shown back to them.

    previous_pairs = line.allocated_quantity_pairs
    previous_colors = line.allocated_color_breakdown
    if requested_pairs != previous_pairs or value != previous_colors:
        db.add(
            AllocationEvent(
                branch_id=line.order.branch_id,
                order_id=line.order_id,
                order_line_id=line.id,
                order_no=line.order.order_no,
                customer_name=line.order.customer_name,
                stock_code=line.stock_code,
                description=line.description,
                product_group=line.product_group,
                unit=line.unit,
                unit_conversions=line.unit_conversions,
                previous_color_breakdown=previous_colors,
                previous_quantity_pairs=previous_pairs,
                color_breakdown=value,
                quantity_pairs=requested_pairs,
                recorded_by_user_id=user_id,
            )
        )
    line.allocated_quantity_pairs = requested_pairs
    line.allocated_color_breakdown = value
    db.commit()
    db.refresh(line)
    return line


def list_allocation_events(
    db: Session,
    branch_id: str | None,
    search: str = "",
) -> list[AllocationEvent]:
    query = db.query(AllocationEvent)
    if branch_id is not None:
        query = query.filter(AllocationEvent.branch_id == branch_id)
    events = query.order_by(AllocationEvent.created_at.desc()).all()
    query_text = search.strip().lower()
    if query_text:
        events = [
            event
            for event in events
            if query_text in event.order_no.lower()
            or query_text in event.customer_name.lower()
            or query_text in event.stock_code.lower()
            or query_text in event.description.lower()
        ]
    return events
