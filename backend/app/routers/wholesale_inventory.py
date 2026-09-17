from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.wholesale_inventory import DeliveryBatchIn, DeliveryIn, DeliveryUpdate
from app.schemas.wholesale_stock_records import StockRecord
from app.services.wholesale.inventory import (
    create_delivery_batch,
    create_delivery,
    delete_delivery,
    movements,
    outgoing_movements,
    update_delivery,
)
from app.services.wholesale.stock_records import stock_records
from app.routers.wholesale_common import paginate, require_wholesale

router = APIRouter(prefix="/api/wholesale/inventory", tags=["wholesale"])


@router.get("")
def list_inventory(
    search: Annotated[str, Query(max_length=100)] = "",
    location: Annotated[str | None, Query(max_length=255)] = None,
    movement_type: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    require_wholesale(user)
    rows = movements(db, user.branch_id)
    query = search.strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in row["stock_code"].lower() or query in row["description"].lower()
            or query in row["location"].lower() or query in row["color_breakdown"].lower()
        ]
    if location:
        rows = [row for row in rows if row["location"] == location]
    if movement_type:
        rows = [row for row in rows if row["movement_type"] == movement_type]
    return paginate(rows, page, page_size, response)


@router.get("/stock", response_model=list[StockRecord])
def list_stock_records(
    search: Annotated[str, Query(max_length=100)] = "",
    location: Annotated[str | None, Query(max_length=255)] = None,
    status: Annotated[str | None, Query()] = None,
    source: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    require_wholesale(user)
    rows = stock_records(db, user.branch_id)
    query = search.strip().casefold()
    if query:
        rows = [
            row for row in rows
            if query in row["stock_code"].casefold()
            or query in row["description"].casefold()
            or query in row["colors"].casefold()
            or any(query in entry["location"].casefold() for entry in row["locations"])
            or any(query in reference.casefold() for key in ("voucher_nos", "shipment_nos", "order_nos", "receiving_nos") for reference in row[key])
        ]
    if location:
        rows = [row for row in rows if any(entry["location"] == location for entry in row["locations"])]
    if status:
        rows = [row for row in rows if row["status"] == status]
    if source:
        rows = [row for row in rows if source in row["sources"]]
    rows.sort(key=lambda row: row["stock_code"].casefold())
    return paginate(rows, page, page_size, response)


@router.get("/movements/{stock_code}")
def list_product_movements(
    stock_code: str,
    location: Annotated[str | None, Query(max_length=255)] = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    require_wholesale(user)
    return [
        movement for movement in movements(db, user.branch_id)
        if movement["stock_code"] == stock_code
        and (location is None or movement["location"] == location)
    ]


@router.post("/deliveries", status_code=status.HTTP_201_CREATED)
def create_customer_delivery(payload: DeliveryIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    require_wholesale(user)
    created = create_delivery(db, user.branch_id, user.id, payload)
    return next(movement for movement in outgoing_movements(db, user.branch_id) if movement["movement_id"] == created.id)


@router.post("/deliveries/batch", status_code=status.HTTP_201_CREATED)
def create_customer_delivery_batch(
    payload: DeliveryBatchIn,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    require_wholesale(user)
    created = create_delivery_batch(db, user.branch_id, user.id, payload)
    by_id = {
        movement["movement_id"]: movement
        for movement in outgoing_movements(db, user.branch_id)
    }
    return [by_id[movement.id] for movement in created]


@router.put("/deliveries/{movement_id}")
def correct_customer_delivery(movement_id: str, payload: DeliveryUpdate, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    require_wholesale(user)
    changed = update_delivery(db, movement_id, user.branch_id, payload, user_id=user.id)
    return next(movement for movement in outgoing_movements(db, user.branch_id) if movement["movement_id"] == changed.id)


@router.delete("/deliveries/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_customer_delivery(movement_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    require_wholesale(user)
    delete_delivery(db, movement_id, user.branch_id, user_id=user.id)
