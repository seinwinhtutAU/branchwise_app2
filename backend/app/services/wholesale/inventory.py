"""Computed wholesale stock and the outgoing deliveries that reduce it."""

from collections import defaultdict

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.models.wholesale import (
    CustomerOrder,
    Receiving,
    ReceivingPackage,
    WholesaleStockMovement,
)
from app.services.wholesale.colors import color_qty_pairs, color_qty_problem, colors_as_json


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
                if item.stock_code.strip() == "" or item.qty_pairs <= 0:
                    continue
                rows.append({
                    "movement_id": f"in-{package.id}-{item.id}", "kind": "in",
                    "stock_code": item.stock_code, "description": item.description,
                    "group": item.product_group.value, "color_qty": item.color_qty,
                    "pairs": item.qty_pairs, "location": receiving.gate,
                    "date": package.received_date or receiving.received_date,
                    "reference": receiving.receiving_no, "party": receiving.supplier_name,
                    "note": package.note,
                })
    return rows


def outgoing_movements(db: Session, branch_id: str | None) -> list[dict]:
    query = db.query(WholesaleStockMovement).options(selectinload(WholesaleStockMovement.order))
    if branch_id is not None:
        query = query.filter(WholesaleStockMovement.branch_id == branch_id)
    return [
        {
            "movement_id": movement.id, "kind": "out", "stock_code": movement.stock_code,
            "description": movement.description, "group": movement.product_group.value,
            "color_qty": movement.color_qty, "pairs": movement.qty_pairs,
            "location": movement.location, "date": movement.delivered_on,
            "reference": movement.order.order_no, "party": movement.order.customer_name,
            "note": movement.note, "order_id": movement.order_id,
        }
        for movement in query.order_by(WholesaleStockMovement.delivered_on.desc()).all()
    ]


def movements(db: Session, branch_id: str | None) -> list[dict]:
    return [*incoming_movements(db, branch_id), *outgoing_movements(db, branch_id)]


def delivered_pairs_by_order(db: Session, order_ids: list[str], branch_id: str | None) -> dict[str, dict[str, int]]:
    if not order_ids:
        return {}
    query = db.query(WholesaleStockMovement).filter(WholesaleStockMovement.order_id.in_(order_ids))
    if branch_id is not None:
        query = query.filter(WholesaleStockMovement.branch_id == branch_id)
    result: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for movement in query.all():
        result[movement.order_id][movement.stock_code] += movement.qty_pairs
    return {order_id: dict(by_stock) for order_id, by_stock in result.items()}


def _available_pairs(db: Session, branch_id: str | None, stock_code: str, location: str, excluding_id: str | None = None) -> int:
    incoming = sum(
        row["pairs"] for row in incoming_movements(db, branch_id)
        if row["stock_code"] == stock_code and row["location"] == location
    )
    query = db.query(WholesaleStockMovement).filter(
        WholesaleStockMovement.stock_code == stock_code,
        WholesaleStockMovement.location == location,
    )
    if branch_id is not None:
        query = query.filter(WholesaleStockMovement.branch_id == branch_id)
    if excluding_id is not None:
        query = query.filter(WholesaleStockMovement.id != excluding_id)
    return incoming - sum(entry.qty_pairs for entry in query.all())


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


def _validate_delivery(db: Session, order: CustomerOrder, payload, branch_id: str | None, excluding_id: str | None = None) -> tuple[int, object]:
    problem = color_qty_problem(payload.color_qty.strip())
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, problem)
    pairs = color_qty_pairs(payload.color_qty.strip(), payload.unit)
    ordered = sum(line.wanted_pairs for line in order.lines if line.stock_code == payload.stock_code.strip())
    if ordered == 0:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "This product is not on the customer order")
    delivered = delivered_pairs_by_order(db, [order.id], branch_id).get(order.id, {}).get(payload.stock_code.strip(), 0)
    if excluding_id is not None:
        current = _load_delivery(db, excluding_id, branch_id)
        delivered -= current.qty_pairs
    still_owed = max(0, ordered - delivered)
    available = _available_pairs(db, branch_id, payload.stock_code.strip(), payload.location.strip(), excluding_id)
    if pairs > still_owed:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Delivery cannot exceed what the customer is still owed")
    if pairs > available:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Delivery cannot exceed what is in stock at this place")
    source = next(line for line in order.lines if line.stock_code == payload.stock_code.strip())
    return pairs, source


def create_delivery(db: Session, branch_id: str | None, user_id: str, payload) -> WholesaleStockMovement:
    order = _load_order(db, payload.order_id, branch_id)
    pairs, source = _validate_delivery(db, order, payload, branch_id)
    movement = WholesaleStockMovement(
        branch_id=order.branch_id, order_id=order.id, stock_code=payload.stock_code.strip(),
        description=source.description, product_group=source.product_group,
        color_qty=payload.color_qty.strip(), colors=colors_as_json(payload.color_qty.strip()),
        qty_pairs=pairs, location=payload.location.strip(), delivered_on=payload.delivered_on,
        note=payload.note.strip(), recorded_by_user_id=user_id,
    )
    db.add(movement)
    db.commit()
    return _load_delivery(db, movement.id, branch_id)


def update_delivery(db: Session, movement_id: str, branch_id: str | None, payload) -> WholesaleStockMovement:
    movement = _load_delivery(db, movement_id, branch_id)
    pairs, _ = _validate_delivery(db, movement.order, payload, branch_id, excluding_id=movement.id)
    movement.location = payload.location.strip()
    movement.color_qty = payload.color_qty.strip()
    movement.colors = colors_as_json(movement.color_qty)
    movement.qty_pairs = pairs
    movement.delivered_on = payload.delivered_on
    movement.note = payload.note.strip()
    db.commit()
    return _load_delivery(db, movement.id, branch_id)


def delete_delivery(db: Session, movement_id: str, branch_id: str | None) -> None:
    db.delete(_load_delivery(db, movement_id, branch_id))
    db.commit()
