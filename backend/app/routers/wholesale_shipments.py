"""The Delivery screen's backend: a supplier voucher travelling as freight, and the
stops it passes through on the way to a receiving gate. See
app/services/wholesale_shipments.py for the transactions and
app/services/wholesale/shipments.py for the derived figures."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.wholesale import Shipment
from app.schemas.wholesale_shipments import ShipmentCreate, ShipmentUpdate
from app.services.branches import resolve_wholesale_branch_id
from app.services.wholesale.shipments import shipment_derived
from app.services.wholesale_receivings import final_received_by_shipment
from app.services.wholesale_shipments import (
    create_shipment,
    delete_shipment,
    get_shipment,
    list_shipments,
    update_shipment,
)

router = APIRouter(prefix="/api/wholesale/shipments", tags=["wholesale"])


def _require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


def _leg_out(leg, index: int, derived_legs: list[dict]) -> dict:
    return {
        "leg_id": leg.id,
        "leg_order": leg.leg_order,
        "stop_name": leg.stop_name,
        "carrier_name": leg.carrier_name,
        "packages_received": leg.packages_received,
        "packages_sent": leg.packages_sent,
        **derived_legs[index],
    }


def _shipment_out(shipment: Shipment, final_received_override: int | None = None) -> dict:
    derived = shipment_derived(shipment, final_received_override)
    return {
        "shipment_id": shipment.id,
        "branch_id": shipment.branch_id,
        "shipment_no": shipment.shipment_no,
        "voucher_no": shipment.voucher_no,
        "supplier_name": shipment.supplier_name,
        "carrier_name": shipment.carrier_name,
        "final_destination": shipment.final_destination,
        "sent_on": shipment.sent_on,
        "total_packages": shipment.total_packages,
        "total_quantity_pairs": shipment.total_quantity_pairs,
        "total_unit": shipment.total_unit.value,
        "packages_sent_by_cargo": shipment.packages_sent_by_cargo,
        # Overridden by whatever the gate has actually recorded, once a receiving
        # exists for this shipment — see shipment_derived's docstring.
        "final_received_packages": derived["final_received_packages"],
        "cargo_remaining": derived["cargo_remaining"],
        "final_remaining": derived["final_remaining"],
        "shipment_status": derived["shipment_status"],
        "destination_count": derived["destination_count"],
        "arrived_pct": derived["arrived_pct"],
        "legs": [_leg_out(leg, index, derived["legs"]) for index, leg in enumerate(shipment.legs)],
        "created_at": shipment.created_at,
        "updated_at": shipment.updated_at,
    }


@router.get("")
def list_shipments_endpoint(
    search: Annotated[str, Query(max_length=100)] = "",
    shipment_status: Annotated[str | None, Query()] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    _require_wholesale(user)
    shipments = list_shipments(db, user.branch_id)
    overrides = final_received_by_shipment(db, [shipment.id for shipment in shipments])
    rows = [_shipment_out(shipment, overrides.get(shipment.id)) for shipment in shipments]
    query = search.strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in row["shipment_no"].lower() or query in row["voucher_no"].lower()
            or query in row["supplier_name"].lower() or query in row["carrier_name"].lower()
            or any(query in leg["stop_name"].lower() for leg in row["legs"])
        ]
    if shipment_status:
        rows = [row for row in rows if row["shipment_status"] == shipment_status]
    response.headers["X-Total-Count"] = str(len(rows))
    start = (page - 1) * page_size
    return rows[start : start + page_size]


@router.get("/{shipment_id}")
def get_shipment_endpoint(
    shipment_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_wholesale(user)
    shipment = get_shipment(db, shipment_id, user.branch_id)
    override = final_received_by_shipment(db, [shipment.id]).get(shipment.id)
    return _shipment_out(shipment, override)


@router.post("", status_code=status.HTTP_201_CREATED)
def create_shipment_endpoint(
    payload: ShipmentCreate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_wholesale(user)
    branch_id = resolve_wholesale_branch_id(user, payload.branch_id, db)
    shipment = create_shipment(db, branch_id, payload)
    return _shipment_out(shipment)


@router.patch("/{shipment_id}")
def update_shipment_endpoint(
    shipment_id: str,
    payload: ShipmentUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_wholesale(user)
    shipment = update_shipment(db, shipment_id, user.branch_id, payload)
    override = final_received_by_shipment(db, [shipment.id]).get(shipment.id)
    return _shipment_out(shipment, override)


@router.delete("/{shipment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shipment_endpoint(
    shipment_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    _require_wholesale(user)
    delete_shipment(db, shipment_id, user.branch_id)
