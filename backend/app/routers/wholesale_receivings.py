"""The Receiving screen's backend: what is due to arrive at a gate, and what actually
turned up once the packages are opened. See app/services/wholesale_receivings.py for the
transactions and app/services/wholesale/receivings.py for the derived figures."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.wholesale import Receiving, ReceivingCost, ReceivingItem, ReceivingPackage
from app.schemas.wholesale_receivings import (
    PackageUpdate,
    ReceivingCostIn,
    ReceivingCreate,
    ReceivingUpdate,
)
from app.services.branches import resolve_wholesale_branch_id
from app.services.wholesale.receivings import (
    ItemLike,
    PackageLike,
    checked_pct,
    cost_by_stage,
    counted_pairs,
    opened_count,
    receiving_status,
)
from app.services.wholesale_receivings import (
    create_receiving,
    delete_receiving,
    get_receiving,
    list_receivings,
    replace_costs,
    update_package,
    update_receiving,
)
from app.services.wholesale.units import from_pairs

router = APIRouter(prefix="/api/wholesale/receivings", tags=["wholesale"])


def _require_wholesale(user: User) -> None:
    if user.role not in (UserRole.WHOLESALE, UserRole.ADMIN):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the wholesale workspace")


def _item_out(item: ReceivingItem) -> dict:
    return {
        "item_id": item.id,
        "stock_code": item.stock_code,
        "description": item.description,
        "product_group": item.product_group.value,
        "color_breakdown": item.color_breakdown,
        "colors": item.colors,
        "quantity": item.quantity_pairs / item.unit_conversions[item.unit.value],
        "unit": item.unit.value,
        "unit_conversions": item.unit_conversions,
        "quantity_pairs": item.quantity_pairs,
    }


def _package_out(package: ReceivingPackage) -> dict:
    items_like = [ItemLike(quantity_pairs=item.quantity_pairs) for item in package.items]
    return {
        "package_id": package.id,
        "package_no": package.package_no,
        "opened": package.opened,
        "received_on": package.received_on,
        "note": package.note,
        "items": [_item_out(item) for item in package.items],
        "quantity_pairs": sum(item.quantity_pairs for item in items_like),
    }


def _cost_out(cost: ReceivingCost) -> dict:
    return {
        "cost_id": cost.id,
        "cost_date": cost.cost_date,
        "stage": cost.stage,
        "carrier": cost.carrier,
        "kind": cost.kind,
        "amount": float(cost.amount),
        "currency_code": cost.currency_code,
        "original_amount": float(cost.original_amount) if cost.original_amount is not None else None,
        "exchange_rate": float(cost.exchange_rate) if cost.exchange_rate is not None else None,
        "note": cost.note,
    }


def _receiving_out(receiving: Receiving) -> dict:
    packages = sorted(receiving.packages, key=lambda entry: entry.package_no)
    packages_like = [
        PackageLike(opened=package.opened, items=[ItemLike(quantity_pairs=item.quantity_pairs) for item in package.items])
        for package in packages
    ]
    expected = receiving.total_quantity_pairs
    counted = counted_pairs(packages_like)
    costs = [(cost.stage, float(cost.amount)) for cost in receiving.costs]

    return {
        "receiving_id": receiving.id,
        "branch_id": receiving.branch_id,
        "receiving_no": receiving.receiving_no,
        "shipment_id": receiving.shipment_id,
        "shipment_no": receiving.shipment_no,
        "voucher_no": receiving.voucher_no,
        "supplier_name": receiving.supplier_name,
        "gate": receiving.gate,
        "received_on": receiving.received_on,
        "total_packages": receiving.total_packages,
        "total_quantity_pairs": receiving.total_quantity_pairs,
        "total_unit": receiving.total_unit.value,
        "packages": [_package_out(package) for package in packages],
        "costs": [_cost_out(cost) for cost in receiving.costs],
        "counted_quantity_pairs": counted,
        "expected_quantity_pairs": expected,
        "quantity_difference_pairs": counted - expected,
        "opened_package_count": opened_count(packages_like),
        "checked_pct": checked_pct(packages_like),
        "receiving_status": receiving_status(packages_like, expected),
        "total_cost": sum(float(cost.amount) for cost in receiving.costs),
        "cost_by_stage": cost_by_stage(costs, stages=[]),
        "created_at": receiving.created_at,
        "updated_at": receiving.updated_at,
    }


@router.get("")
def list_receivings_endpoint(
    search: Annotated[str, Query(max_length=100)] = "",
    receiving_status_filter: Annotated[str | None, Query(alias="receiving_status")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 100,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
    response: Response = None,
) -> list[dict]:
    _require_wholesale(user)
    rows = [_receiving_out(receiving) for receiving in list_receivings(db, user.branch_id)]
    query = search.strip().lower()
    if query:
        rows = [
            row for row in rows
            if query in row["receiving_no"].lower() or query in row["shipment_no"].lower()
            or query in row["voucher_no"].lower() or query in row["supplier_name"].lower()
            or query in row["gate"].lower()
        ]
    if receiving_status_filter:
        rows = [row for row in rows if row["receiving_status"] == receiving_status_filter]
    response.headers["X-Total-Count"] = str(len(rows))
    start = (page - 1) * page_size
    return rows[start : start + page_size]


@router.get("/{receiving_id}")
def get_receiving_endpoint(
    receiving_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_wholesale(user)
    return _receiving_out(get_receiving(db, receiving_id, user.branch_id))


@router.post("", status_code=status.HTTP_201_CREATED)
def create_receiving_endpoint(
    payload: ReceivingCreate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_wholesale(user)
    branch_id = resolve_wholesale_branch_id(user, payload.branch_id, db)
    return _receiving_out(create_receiving(db, branch_id, payload))


@router.patch("/{receiving_id}")
def update_receiving_endpoint(
    receiving_id: str,
    payload: ReceivingUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_wholesale(user)
    return _receiving_out(update_receiving(db, receiving_id, user.branch_id, payload))


@router.delete("/{receiving_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_receiving_endpoint(
    receiving_id: str,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> None:
    _require_wholesale(user)
    delete_receiving(db, receiving_id, user.branch_id)


@router.patch("/{receiving_id}/packages/{package_id}")
def update_package_endpoint(
    receiving_id: str,
    package_id: str,
    payload: PackageUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_wholesale(user)
    return _receiving_out(update_package(db, receiving_id, package_id, user.branch_id, payload))


@router.put("/{receiving_id}/costs")
def replace_costs_endpoint(
    receiving_id: str,
    payload: list[ReceivingCostIn],
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _require_wholesale(user)
    return _receiving_out(replace_costs(db, receiving_id, user.branch_id, payload))
