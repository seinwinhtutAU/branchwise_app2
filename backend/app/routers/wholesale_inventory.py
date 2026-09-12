from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.schemas.wholesale_inventory import DeliveryIn, DeliveryUpdate
from app.services.wholesale.inventory import (
    create_delivery,
    delete_delivery,
    movements,
    outgoing_movements,
    update_delivery,
)

router = APIRouter(prefix="/api/wholesale/inventory", tags=["wholesale"])


def _require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


@router.get("")
def list_inventory(
    search: Annotated[str, Query(max_length=100)] = "",
    location: Annotated[str | None, Query(max_length=255)] = None,
    movement_kind: Annotated[str | None, Query(alias="kind")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    _require_wholesale(user)
    rows = movements(db, user.branch_id)
    query = search.strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in row["stock_code"].lower() or query in row["description"].lower()
            or query in row["location"].lower() or query in row["color_qty"].lower()
        ]
    if location:
        rows = [row for row in rows if row["location"] == location]
    if movement_kind:
        rows = [row for row in rows if row["kind"] == movement_kind]
    response.headers["X-Total-Count"] = str(len(rows))
    start = (page - 1) * page_size
    return rows[start : start + page_size]


@router.get("/movements/{stock_code}")
def list_product_movements(stock_code: str, location: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> list[dict]:
    _require_wholesale(user)
    return [
        movement for movement in movements(db, user.branch_id)
        if movement["stock_code"] == stock_code and movement["location"] == location
    ]


@router.post("/deliveries", status_code=status.HTTP_201_CREATED)
def create_customer_delivery(payload: DeliveryIn, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    created = create_delivery(db, user.branch_id, user.id, payload)
    return next(movement for movement in outgoing_movements(db, user.branch_id) if movement["movement_id"] == created.id)


@router.put("/deliveries/{movement_id}")
def correct_customer_delivery(movement_id: str, payload: DeliveryUpdate, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> dict:
    _require_wholesale(user)
    changed = update_delivery(db, movement_id, user.branch_id, payload)
    return next(movement for movement in outgoing_movements(db, user.branch_id) if movement["movement_id"] == changed.id)


@router.delete("/deliveries/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_customer_delivery(movement_id: str, user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> None:
    _require_wholesale(user)
    delete_delivery(db, movement_id, user.branch_id)
