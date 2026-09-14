"""Customer orders and their customer-side payments.

The quantities delivered to a customer are not written here: Inventory will own those
outgoing movements. Until that phase is connected, an order truthfully reports zero
received pairs. Payments, however, already have a real source of truth and are kept in
``wholesale_payments`` alongside supplier payments.
"""

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.models.wholesale import AllocationEvent, CustomerOrder, CustomerOrderLine, WholesalePayment
from app.services.wholesale.colors import (
    color_qty_pairs,
    color_qty_pairs_by_color,
    color_qty_problem,
    colors_as_json,
)
from app.services.wholesale.inventory import (
    allocated_color_pairs_for_stock_code,
    available_color_pairs_for_stock_code,
    delivered_pairs_by_order,
)
from app.services.wholesale.references import allocate_reference, retry_on_reference_collision

_LOAD_OPTIONS = (selectinload(CustomerOrder.lines), selectinload(CustomerOrder.payments))


def order_status(total_wanted: int, received: int, allocated: int, cancelled: bool) -> str:
    if cancelled:
        return "cancelled"
    if total_wanted > 0 and received >= total_wanted:
        return "fulfilled"
    if received > 0:
        return "partly_delivered"
    if allocated >= total_wanted and total_wanted > 0:
        return "ready_to_deliver"
    if allocated > 0:
        return "allocating"
    return "new"


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


def _line(line_in) -> CustomerOrderLine:
    color_breakdown = line_in.color_breakdown.strip()
    problem = color_qty_problem(color_breakdown)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)
    return CustomerOrderLine(
        stock_code=line_in.stock_code.strip(), description=line_in.description.strip(),
        product_group=line_in.product_group, supplier_name=line_in.supplier_name.strip(),
        color_breakdown=color_breakdown, colors=colors_as_json(color_breakdown), unit=line_in.unit,
        quantity_pairs=color_qty_pairs(color_breakdown, line_in.unit), selling_price=line_in.selling_price,
    )


def _check_no_duplicate_stock_codes(lines) -> None:
    # A delivery only records a stock code and a quantity, never which order line it
    # satisfies — two lines for the same stock code would make delivered-quantity
    # attribution ambiguous (see _out in the router). Put the extra quantity on the
    # existing line instead.
    seen = {line.stock_code.strip().lower() for line in lines}
    if len(seen) != len(lines):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Each stock code can only appear on one line per order")


def create_order(db: Session, branch_id: str | None, payload) -> CustomerOrder:
    _check_no_duplicate_stock_codes(payload.lines)

    def attempt() -> CustomerOrder:
        order = CustomerOrder(
            branch_id=branch_id,
            order_no=allocate_reference(db, CustomerOrder.order_no, branch_id, "ORD", date.today()),
            customer_name=payload.customer_name.strip(), customer_phone=payload.customer_phone.strip(),
            customer_address=payload.customer_address.strip(), order_date=payload.order_date,
            lines=[_line(line) for line in payload.lines],
        )
        db.add(order)
        db.commit()
        return _load(db, order.id, branch_id)

    return retry_on_reference_collision(db, attempt)


def update_order(db: Session, order_id: str, branch_id: str | None, payload) -> CustomerOrder:
    _check_no_duplicate_stock_codes(payload.lines)
    order = _load(db, order_id, branch_id)
    existing_allocations = {
        line.stock_code: (
            line.allocated_quantity_pairs,
            line.allocated_color_breakdown,
            line.unit,
        )
        for line in order.lines
    }
    order.customer_name = payload.customer_name.strip()
    order.customer_phone = payload.customer_phone.strip()
    order.customer_address = payload.customer_address.strip()
    order.order_date = payload.order_date
    replacement_lines = [_line(line) for line in payload.lines]
    for line in replacement_lines:
        allocated = existing_allocations.get(line.stock_code)
        if allocated is None or allocated[0] > line.quantity_pairs:
            continue
        allocated_pairs, allocated_colors, allocated_unit = allocated
        order_colors = color_qty_pairs_by_color(line.color_breakdown, line.unit)
        allocation_colors = color_qty_pairs_by_color(allocated_colors, allocated_unit)
        if any(pairs > order_colors.get(color, 0) for color, pairs in allocation_colors.items()):
            continue
        line.allocated_quantity_pairs = allocated_pairs
        line.allocated_color_breakdown = allocated_colors
    order.lines = replacement_lines
    db.commit()
    return _load(db, order_id, branch_id)


def cancel_order(db: Session, order_id: str, branch_id: str | None) -> CustomerOrder:
    order = _load(db, order_id, branch_id)
    order.cancelled = True
    db.commit()
    return _load(db, order_id, branch_id)


def delete_order(db: Session, order_id: str, branch_id: str | None) -> None:
    order = _load(db, order_id, branch_id)
    db.delete(order)
    db.commit()


def add_payment(db: Session, order_id: str, branch_id: str | None, user_id: str, payload) -> WholesalePayment:
    order = _load(db, order_id, branch_id)
    total = sum(float(line.quantity_pairs) * float(line.selling_price) for line in order.lines)
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
    if line.order.cancelled:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A cancelled order cannot be allocated")

    value = color_breakdown.strip()
    if value:
        problem = color_qty_problem(value)
        if problem:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)

    requested_pairs = color_qty_pairs(value, line.unit) if value else 0
    delivered = delivered_pairs_by_order(db, [line.order_id], branch_id).get(line.order_id, {}).get(line.stock_code, 0)
    remaining = max(0, line.quantity_pairs - delivered)
    if requested_pairs > remaining:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Allocation cannot exceed what the customer is still owed")

    requested_colors = color_qty_pairs_by_color(value, line.unit)
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
