"""Computed wholesale stock and the outgoing deliveries that reduce it."""

from collections import defaultdict

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.wholesale.models.entities import (
    CustomerOrder,
    CustomerOrderLine,
    Receiving,
    ReceivingItem,
    ReceivingPackage,
    WholesaleUnit,
    WholesaleStockMovement,
)
from app.wholesale.services.audit import record_audit_log
from app.wholesale.services.colors import (
    color_qty_pairs,
    color_qty_pairs_by_color,
    color_qty_problem,
    colors_as_json,
)


def _orders_query(db: Session, branch_id: str | None):
    query = db.query(CustomerOrder).options(selectinload(CustomerOrder.lines))
    return query.filter(CustomerOrder.branch_id == branch_id) if branch_id is not None else query


def _receivings(db: Session, branch_id: str | None) -> list[Receiving]:
    query = db.query(Receiving).options(
        selectinload(Receiving.packages).selectinload(ReceivingPackage.items)
    )
    if branch_id is not None:
        query = query.filter(Receiving.branch_id == branch_id)
    return query.all()


def incoming_movements(db: Session, branch_id: str | None) -> list[dict]:
    rows: list[dict] = []
    for receiving in _receivings(db, branch_id):
        for package in receiving.packages:
            if not package.opened:
                continue
            for item in package.items:
                if item.stock_code.strip() == "" or item.quantity_pairs <= 0:
                    continue
                rows.append({
                    "movement_id": f"in-{package.id}-{item.id}", "movement_type": "in",
                    "stock_code": item.stock_code, "description": item.description,
                    "product_group": item.product_group.value, "color_breakdown": item.color_breakdown,
                    "quantity_pairs": item.quantity_pairs, "unit_conversions": item.unit_conversions,
                    "location": receiving.gate,
                    "moved_on": package.received_on or receiving.received_on,
                    "reference": receiving.receiving_no, "counterparty_name": receiving.supplier_name,
                    "note": package.note,
                })
    return rows


def outgoing_movements(db: Session, branch_id: str | None) -> list[dict]:
    query = db.query(WholesaleStockMovement).options(selectinload(WholesaleStockMovement.order))
    if branch_id is not None:
        query = query.filter(WholesaleStockMovement.branch_id == branch_id)
    return [
        {
            "movement_id": movement.id, "movement_type": "out", "stock_code": movement.stock_code,
            "description": movement.description, "product_group": movement.product_group.value,
            "color_breakdown": movement.color_breakdown, "quantity_pairs": movement.quantity_pairs,
            "unit_conversions": movement.unit_conversions,
            "location": movement.location, "moved_on": movement.delivered_on,
            "reference": movement.order.order_no, "counterparty_name": movement.order.customer_name,
            "note": movement.note, "order_id": movement.order_id,
            "delivery_address": movement.delivery_address,
        }
        for movement in query.order_by(WholesaleStockMovement.delivered_on.desc()).all()
    ]


def allocated_movements(db: Session, branch_id: str | None) -> list[dict]:
    query = _orders_query(db, branch_id).filter(CustomerOrder.cancelled.is_(False))
    orders = query.all()
    if not orders:
        return []
    rows: list[dict] = []
    for order in orders:
        for line in order.lines:
            effective_colors = effective_allocated_color_pairs(
                line,
                delivered_color_pairs_by_order(db, order.id, line.stock_code, branch_id),
            )
            allocated_pairs = sum(effective_colors.values())
            if allocated_pairs <= 0:
                continue
            color_text = ",".join(
                f"{color}{pairs // 6}s" if pairs % 6 == 0 else f"{color}{pairs}p"
                for color, pairs in sorted(effective_colors.items())
                if pairs > 0
            )
            rows.append({
                "movement_id": f"alloc-{order.id}-{line.id}",
                "movement_type": "allocated",
                "stock_code": line.stock_code,
                "description": line.description,
                "product_group": line.product_group.value,
                "color_breakdown": color_text or (line.allocated_color_breakdown or ""),
                "quantity_pairs": allocated_pairs,
                "unit_conversions": line.unit_conversions,
                "location": "Allocated",
                "moved_on": order.order_date,
                "reference": order.order_no,
                "counterparty_name": order.customer_name,
                "note": f"Allocated to order {order.order_no}",
                "order_id": order.id,
            })
    return rows


def movements(db: Session, branch_id: str | None) -> list[dict]:
    return [
        *incoming_movements(db, branch_id),
        *outgoing_movements(db, branch_id),
        *allocated_movements(db, branch_id),
    ]


def net_pairs_by_stock_code(db: Session, branch_id: str | None) -> dict[str, int]:
    """Net opened receiving quantity less outgoing deliveries, grouped by stock code."""
    incoming_query = (
        db.query(ReceivingItem.stock_code, func.coalesce(func.sum(ReceivingItem.quantity_pairs), 0))
        .join(ReceivingPackage, ReceivingItem.package_id == ReceivingPackage.id)
        .join(Receiving, ReceivingPackage.receiving_id == Receiving.id)
        .filter(ReceivingPackage.opened.is_(True))
    )
    if branch_id is not None:
        incoming_query = incoming_query.filter(Receiving.branch_id == branch_id)
    net: dict[str, int] = defaultdict(int)
    for stock_code, quantity in incoming_query.group_by(ReceivingItem.stock_code).all():
        net[stock_code] += int(quantity or 0)

    outgoing_query = db.query(
        WholesaleStockMovement.stock_code,
        func.coalesce(func.sum(WholesaleStockMovement.quantity_pairs), 0),
    )
    if branch_id is not None:
        outgoing_query = outgoing_query.filter(WholesaleStockMovement.branch_id == branch_id)
    for stock_code, quantity in outgoing_query.group_by(WholesaleStockMovement.stock_code).all():
        net[stock_code] -= int(quantity or 0)
    return dict(net)


def delivered_pairs_by_order(db: Session, order_ids: list[str], branch_id: str | None) -> dict[str, dict[str, int]]:
    if not order_ids:
        return {}
    query = db.query(WholesaleStockMovement).filter(WholesaleStockMovement.order_id.in_(order_ids))
    if branch_id is not None:
        query = query.filter(WholesaleStockMovement.branch_id == branch_id)
    result: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for movement in query.all():
        result[movement.order_id][movement.stock_code] += movement.quantity_pairs
    return {order_id: dict(by_stock) for order_id, by_stock in result.items()}


def delivered_color_pairs_by_orders(
    db: Session, order_ids: list[str], branch_id: str | None
) -> dict[str, dict[str, dict[str, int]]]:
    """Batched form of delivered_color_pairs_by_order for a whole list of orders.

    One query for every order in `order_ids` instead of one query per (order, stock
    code) pair. list_customer_orders and the monitoring snapshot both need this once
    per order line, so at list-endpoint scale the per-call version was O(order lines)
    queries; this is the same shape as delivered_pairs_by_order, just keyed one level
    deeper by colour.
    """
    if not order_ids:
        return {}
    query = db.query(WholesaleStockMovement).filter(WholesaleStockMovement.order_id.in_(order_ids))
    if branch_id is not None:
        query = query.filter(WholesaleStockMovement.branch_id == branch_id)
    result: dict[str, dict[str, dict[str, int]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for movement in query.all():
        for color, pairs in color_qty_pairs_by_color(
            movement.color_breakdown, WholesaleUnit.SET, movement.unit_conversions
        ).items():
            result[movement.order_id][movement.stock_code][color] += pairs
    return {
        order_id: {stock_code: dict(colors) for stock_code, colors in by_stock.items()}
        for order_id, by_stock in result.items()
    }


def delivered_color_pairs_by_order(
    db: Session,
    order_id: str,
    stock_code: str,
    branch_id: str | None,
    excluding_id: str | None = None,
) -> dict[str, int]:
    query = db.query(WholesaleStockMovement).filter(
        WholesaleStockMovement.order_id == order_id,
        WholesaleStockMovement.stock_code == stock_code,
    )
    if branch_id is not None:
        query = query.filter(WholesaleStockMovement.branch_id == branch_id)
    if excluding_id is not None:
        query = query.filter(WholesaleStockMovement.id != excluding_id)

    result: dict[str, int] = defaultdict(int)
    for movement in query.all():
        for color, pairs in color_qty_pairs_by_color(movement.color_breakdown, WholesaleUnit.SET, movement.unit_conversions).items():
            result[color] += pairs
    return dict(result)


def effective_allocated_color_pairs(
    line: CustomerOrderLine,
    delivered_colors: dict[str, int] | None = None,
) -> dict[str, int]:
    """Return the allocation that still reserves stock for an order line.

    Allocation columns are intentionally kept as the audit-friendly last value staff
    entered.  Delivery is a separate source of truth, so a read must not continue to
    reserve pairs that have already reached the customer.  Clamping by colour also
    prevents a delivery of one colour from incorrectly consuming another colour's
    reservation.
    """
    delivered_colors = delivered_colors or {}
    ordered_colors = color_qty_pairs_by_color(line.color_breakdown, line.unit, line.unit_conversions)
    stored_colors = color_qty_pairs_by_color(line.allocated_color_breakdown, line.unit, line.unit_conversions)
    return {
        color: max(
            0,
            min(
                pairs - delivered_colors.get(color, 0),
                ordered_colors.get(color, 0) - delivered_colors.get(color, 0),
            ),
        )
        for color, pairs in stored_colors.items()
        if max(
            0,
            min(
                pairs - delivered_colors.get(color, 0),
                ordered_colors.get(color, 0) - delivered_colors.get(color, 0),
            ),
        ) > 0
    }


def color_pairs_breakdown(color_pairs: dict[str, int]) -> str:
    """Serialize effective pair counts without inventing a set-sized remainder."""
    return ",".join(
        f"{color}{pairs}p"
        for color, pairs in color_pairs.items()
        if pairs > 0
    )


def _available_pairs(db: Session, branch_id: str | None, stock_code: str, location: str, excluding_id: str | None = None) -> int:
    incoming_query = (
        db.query(func.coalesce(func.sum(ReceivingItem.quantity_pairs), 0))
        .join(ReceivingPackage, ReceivingItem.package_id == ReceivingPackage.id)
        .join(Receiving, ReceivingPackage.receiving_id == Receiving.id)
        .filter(
            ReceivingPackage.opened.is_(True),
            ReceivingItem.stock_code == stock_code,
            ReceivingItem.quantity_pairs > 0,
            Receiving.gate == location,
        )
    )
    if branch_id is not None:
        incoming_query = incoming_query.filter(Receiving.branch_id == branch_id)
    incoming = incoming_query.scalar() or 0
    query = db.query(WholesaleStockMovement).filter(
        WholesaleStockMovement.stock_code == stock_code,
        WholesaleStockMovement.location == location,
    )
    if branch_id is not None:
        query = query.filter(WholesaleStockMovement.branch_id == branch_id)
    if excluding_id is not None:
        query = query.filter(WholesaleStockMovement.id != excluding_id)
    return incoming - sum(entry.quantity_pairs for entry in query.all())


def _available_color_pairs(
    db: Session,
    branch_id: str | None,
    stock_code: str,
    location: str,
    excluding_id: str | None = None,
) -> dict[str, int]:
    available: dict[str, int] = defaultdict(int)
    for receiving in _receivings(db, branch_id):
        if receiving.gate != location:
            continue
        for package in receiving.packages:
            if not package.opened:
                continue
            for item in package.items:
                if item.stock_code != stock_code:
                    continue
                for color, pairs in color_qty_pairs_by_color(item.color_breakdown, item.unit, item.unit_conversions).items():
                    available[color] += pairs

    query = db.query(WholesaleStockMovement).filter(
        WholesaleStockMovement.stock_code == stock_code,
        WholesaleStockMovement.location == location,
    )
    if branch_id is not None:
        query = query.filter(WholesaleStockMovement.branch_id == branch_id)
    if excluding_id is not None:
        query = query.filter(WholesaleStockMovement.id != excluding_id)
    for movement in query.all():
        for color, pairs in color_qty_pairs_by_color(movement.color_breakdown, WholesaleUnit.SET, movement.unit_conversions).items():
            available[color] -= pairs
    return dict(available)


def available_color_pairs_for_stock_code(
    db: Session,
    branch_id: str | None,
    stock_code: str,
) -> dict[str, int]:
    """Available colour quantities across every controlled location.

    Allocations reserve a product before a delivery location is chosen, so the
    allocation endpoint needs the same stock calculation without a location filter.
    """
    locations = {
        receiving.gate
        for receiving in _receivings(db, branch_id)
    }
    movement_query = db.query(WholesaleStockMovement.location).filter(
        WholesaleStockMovement.stock_code == stock_code,
    )
    if branch_id is not None:
        movement_query = movement_query.filter(WholesaleStockMovement.branch_id == branch_id)
    locations.update(location for (location,) in movement_query.distinct().all())
    available: dict[str, int] = defaultdict(int)
    for location in locations:
        for color, pairs in _available_color_pairs(db, branch_id, stock_code, location).items():
            available[color] += pairs
    return dict(available)


def allocated_color_pairs_for_stock_code(
    db: Session,
    branch_id: str | None,
    stock_code: str,
    excluding_line_id: str | None = None,
    excluding_order_id: str | None = None,
) -> dict[str, int]:
    """Colour quantities reserved by customer-order-line allocations for this stock
    code, across every open (non-cancelled) order.

    Allocation only means something if the stock it reserves is actually off-limits to
    everyone else: `allocate_order_line` (app/wholesale/services/orders.py) uses this
    (excluding the line being changed) to stop one order from reserving stock another
    order already holds, and `_validate_delivery` below uses it (excluding the order
    being delivered to, since an order is always free to draw on its own reservation)
    to stop a delivery from handing out stock reserved for someone else.
    """
    query = (
        db.query(CustomerOrderLine)
        .join(CustomerOrder)
        .filter(CustomerOrderLine.stock_code == stock_code, CustomerOrder.cancelled.is_(False))
    )
    if branch_id is not None:
        query = query.filter(CustomerOrder.branch_id == branch_id)
    delivered_by_order: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    movement_query = db.query(WholesaleStockMovement).filter(
        WholesaleStockMovement.stock_code == stock_code,
    )
    if branch_id is not None:
        movement_query = movement_query.filter(WholesaleStockMovement.branch_id == branch_id)
    for movement in movement_query.all():
        for color, pairs in color_qty_pairs_by_color(movement.color_breakdown, WholesaleUnit.SET, movement.unit_conversions).items():
            delivered_by_order[movement.order_id][color] += pairs
    reserved: dict[str, int] = defaultdict(int)
    for line in query.all():
        if excluding_line_id is not None and line.id == excluding_line_id:
            continue
        if excluding_order_id is not None and line.order_id == excluding_order_id:
            continue
        for color, pairs in effective_allocated_color_pairs(
            line,
            delivered_by_order.get(line.order_id),
        ).items():
            reserved[color] += pairs
    return dict(reserved)


def _load_delivery(db: Session, movement_id: str, branch_id: str | None) -> WholesaleStockMovement:
    movement = db.query(WholesaleStockMovement).options(selectinload(WholesaleStockMovement.order).selectinload(CustomerOrder.lines)).filter(WholesaleStockMovement.id == movement_id).first()
    if movement is None or (branch_id is not None and movement.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer delivery not found")
    return movement


def _load_order(db: Session, order_id: str, branch_id: str | None) -> CustomerOrder:
    order = _orders_query(db, branch_id).filter(CustomerOrder.id == order_id).first()
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Customer order not found")
    if order.cancelled:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "A cancelled order cannot receive a delivery")
    return order


def _validate_delivery(
    db: Session,
    order: CustomerOrder,
    payload,
    branch_id: str | None,
    stock_code: str,
    excluding_id: str | None = None,
) -> tuple[int, object]:
    problem = color_qty_problem(payload.color_breakdown.strip())
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)
    code = stock_code.strip()
    ordered_lines = [line for line in order.lines if line.stock_code == code]
    ordered = sum(line.quantity_pairs for line in ordered_lines)
    if ordered == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This product is not on the customer order")
    source = next(line for line in ordered_lines)
    pairs = color_qty_pairs(payload.color_breakdown.strip(), payload.unit, source.unit_conversions)
    ordered_colors: dict[str, int] = defaultdict(int)
    for line in ordered_lines:
        for color, color_pairs in color_qty_pairs_by_color(line.color_breakdown, line.unit, line.unit_conversions).items():
            ordered_colors[color] += color_pairs
    delivered_colors = delivered_color_pairs_by_order(
        db, order.id, code, branch_id, excluding_id=excluding_id,
    )
    still_owed_colors = {
        color: max(0, color_pairs - delivered_colors.get(color, 0))
        for color, color_pairs in ordered_colors.items()
    }
    requested_colors = color_qty_pairs_by_color(payload.color_breakdown.strip(), payload.unit, source.unit_conversions)
    for color, requested in requested_colors.items():
        if ordered_colors.get(color, 0) <= 0:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f'Color "{color}" is not on the customer order',
            )
        if requested > still_owed_colors.get(color, 0):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f'Color "{color}" exceeds what the customer is still owed',
            )

    # Goods may only leave against this order's own allocation. Allocation is the step
    # that decides whose stock this is, so handing over anything that was not set aside
    # would let one customer walk off with what another is waiting for. What is still
    # reserved is what was allocated less what has already gone out, which is exactly
    # what effective_allocated_color_pairs returns.
    allocated_here: dict[str, int] = defaultdict(int)
    for line in ordered_lines:
        line_delivered = delivered_color_pairs_by_order(
            db, order.id, line.stock_code, branch_id, excluding_id=excluding_id,
        )
        for color, color_pairs in effective_allocated_color_pairs(line, line_delivered).items():
            allocated_here[color] += color_pairs
    for color, requested in requested_colors.items():
        if requested > allocated_here.get(color, 0):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f'Color "{color}" has not been allocated to this order — allocate it first'
                if allocated_here.get(color, 0) <= 0
                else f'Only {allocated_here[color]} pairs of "{color}" are allocated to this order',
            )

    # Stock allocated to another open order is off-limits here — this order can still
    # draw on its own allocation (excluding_order_id), but a reservation made for
    # someone else has to hold.
    reserved_colors = allocated_color_pairs_for_stock_code(
        db, branch_id, code, excluding_order_id=order.id,
    )
    available_colors = _available_color_pairs(
        db, branch_id, code, payload.location.strip(), excluding_id=excluding_id,
    )
    for color, requested in requested_colors.items():
        available_for_color = max(0, available_colors.get(color, 0) - reserved_colors.get(color, 0))
        if requested > available_for_color:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                f'Color "{color}" is reserved for another customer order' if reserved_colors.get(color, 0) > 0
                else f'Color "{color}" is not available in this stock location',
            )

    delivered = delivered_pairs_by_order(db, [order.id], branch_id).get(order.id, {}).get(code, 0)
    if excluding_id is not None:
        current = _load_delivery(db, excluding_id, branch_id)
        delivered -= current.quantity_pairs
    still_owed = max(0, ordered - delivered)
    available = _available_pairs(db, branch_id, code, payload.location.strip(), excluding_id)
    available = max(0, available - sum(reserved_colors.values()))
    if pairs > still_owed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Delivery cannot exceed what the customer is still owed")
    if pairs > available:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Delivery cannot exceed what is in stock at this place, once stock reserved for other orders is set aside"
            if reserved_colors
            else "Delivery cannot exceed what is in stock at this place",
        )
    return pairs, source


def create_delivery(db: Session, branch_id: str | None, user_id: str, payload) -> WholesaleStockMovement:
    order = _load_order(db, payload.order_id, branch_id)
    pairs, source = _validate_delivery(db, order, payload, branch_id, payload.stock_code)
    movement = WholesaleStockMovement(
        branch_id=order.branch_id, order_id=order.id, stock_code=payload.stock_code.strip(),
        description=source.description, product_group=source.product_group,
        color_breakdown=payload.color_breakdown.strip(), colors=colors_as_json(payload.color_breakdown.strip()),
        unit_conversions=source.unit_conversions,
        quantity_pairs=pairs, location=payload.location.strip(), delivered_on=payload.delivered_on,
        note=payload.note.strip(), recorded_by_user_id=user_id,
    )
    db.add(movement)
    db.commit()
    return _load_delivery(db, movement.id, branch_id)


def create_delivery_batch(
    db: Session,
    branch_id: str | None,
    user_id: str,
    payload,
) -> list[WholesaleStockMovement]:
    """Record every product handed over to one customer in one transaction.

    A delivery form can contain many products, but a product can only appear once: one
    row owns its colour quantity and source location. That lets each line be checked
    against both the order and the physical shelf without accidentally counting the
    same stock twice within the batch.
    """
    order = _load_order(db, payload.order_id, branch_id)
    seen_codes: set[str] = set()
    prepared: list[tuple[object, int, object]] = []
    for line in payload.lines:
        code = line.stock_code.strip().lower()
        if code in seen_codes:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "Each product can only appear once in a customer delivery",
            )
        seen_codes.add(code)
        pairs, source = _validate_delivery(db, order, line, branch_id, line.stock_code)
        prepared.append((line, pairs, source))

    movements = [
        WholesaleStockMovement(
            branch_id=order.branch_id,
            order_id=order.id,
            stock_code=line.stock_code.strip(),
            description=source.description,
            product_group=source.product_group,
            color_breakdown=line.color_breakdown.strip(),
            colors=colors_as_json(line.color_breakdown.strip()),
            unit_conversions=source.unit_conversions,
            quantity_pairs=pairs,
            location=line.location.strip(),
            delivery_address=payload.delivery_address.strip(),
            delivered_on=payload.delivered_on,
            note=payload.note.strip(),
            recorded_by_user_id=user_id,
        )
        for line, pairs, source in prepared
    ]
    db.add_all(movements)
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    # Bump the parent order's version_id so concurrent writers see the change.
    order.updated_at = func.now()
    record_audit_log(
        db,
        branch_id=order.branch_id,
        entity_type="customer_order",
        entity_id=order.id,
        action="deliver",
        operator_id=user_id,
        payload={
            "stock_codes": [line.stock_code.strip() for line in payload.lines],
            "delivery_address": payload.delivery_address.strip(),
        },
    )
    db.commit()
    return [_load_delivery(db, movement.id, branch_id) for movement in movements]


def update_delivery(db: Session, movement_id: str, branch_id: str | None, payload, user_id: str = "") -> WholesaleStockMovement:
    movement = _load_delivery(db, movement_id, branch_id)
    order = movement.order
    pairs, _ = _validate_delivery(
        db, order, payload, branch_id, movement.stock_code, excluding_id=movement.id,
    )
    movement.location = payload.location.strip()
    movement.color_breakdown = payload.color_breakdown.strip()
    movement.colors = colors_as_json(movement.color_breakdown)
    movement.quantity_pairs = pairs
    movement.delivered_on = payload.delivered_on
    movement.note = payload.note.strip()
    db.commit()
    order.updated_at = func.now()
    record_audit_log(
        db,
        branch_id=order.branch_id,
        entity_type="customer_order",
        entity_id=order.id,
        action="update_delivery",
        operator_id=user_id,
        payload={"movement_id": movement_id, "stock_code": movement.stock_code},
    )
    db.commit()
    return _load_delivery(db, movement.id, branch_id)


def delete_delivery(db: Session, movement_id: str, branch_id: str | None, user_id: str = "") -> None:
    movement = _load_delivery(db, movement_id, branch_id)
    order = movement.order
    order_id = order.id
    order_branch_id = order.branch_id
    stock_code = movement.stock_code
    db.delete(movement)
    db.commit()
    order.updated_at = func.now()
    record_audit_log(
        db,
        branch_id=order_branch_id,
        entity_type="customer_order",
        entity_id=order_id,
        action="delete_delivery",
        operator_id=user_id,
        payload={"movement_id": movement_id, "stock_code": stock_code},
    )
    db.commit()


def auto_allocate_arrivals(db: Session, branch_id: str | None, stock_codes: set[str]) -> int:
    """Share newly-counted stock out to the customers already waiting for it.

    The decision this makes has effectively been made once already: a supplier voucher is
    raised from the open customer-order lines it is meant to cover, so by the time the
    boxes are opened the app knows who the goods are for. Asking somebody to reopen the
    Fulfill screen and retype the same colours is doing that work a second time, so it is
    done here instead, the moment a package is counted in.

    Oldest order first, colour by colour, and never more than a line is still owed. What
    cannot be covered is simply left unallocated — the day a shipment arrives short, the
    Allocate screen is where a person decides who goes without, and that judgement is not
    one to take away from them.

    Returns the number of lines whose reservation grew, so the caller can say whether
    anything happened.
    """
    touched = 0
    for stock_code in sorted(code for code in stock_codes if code and code.strip()):
        code = stock_code.strip()
        free = dict(available_color_pairs_for_stock_code(db, branch_id, code))
        for color, taken in allocated_color_pairs_for_stock_code(db, branch_id, code).items():
            free[color] = max(0, free.get(color, 0) - taken)
        if not any(pairs > 0 for pairs in free.values()):
            continue

        query = (
            db.query(CustomerOrderLine)
            .join(CustomerOrder)
            .options(selectinload(CustomerOrderLine.order))
            .filter(CustomerOrderLine.stock_code == code, CustomerOrder.cancelled.is_(False))
        )
        if branch_id is not None:
            query = query.filter(CustomerOrder.branch_id == branch_id)
        lines = sorted(
            query.all(),
            key=lambda line: (line.order.order_date, line.order.order_no),
        )

        for line in lines:
            delivered_colors = delivered_color_pairs_by_order(
                db, line.order_id, line.stock_code, branch_id,
            )
            ordered = color_qty_pairs_by_color(line.color_breakdown, line.unit, line.unit_conversions)
            reserved = effective_allocated_color_pairs(line, delivered_colors)
            stored = color_qty_pairs_by_color(
                line.allocated_color_breakdown, line.unit, line.unit_conversions,
            )
            grew = False
            for color, wanted in ordered.items():
                # Still owed of this colour, less whatever is already set aside for it.
                room = max(0, wanted - delivered_colors.get(color, 0) - reserved.get(color, 0))
                take = min(room, free.get(color, 0))
                if take <= 0:
                    continue
                stored[color] = stored.get(color, 0) + take
                free[color] = free.get(color, 0) - take
                grew = True
            if not grew:
                continue

            line.allocated_color_breakdown = color_pairs_breakdown(stored)
            line.allocated_quantity_pairs = sum(stored.values())
            touched += 1
    if touched:
        db.commit()
    return touched
