"""Owns the transactions for the Receiving screen: a delivery landing at a gate, the
packages it is due to arrive in, and what is actually found once each is opened. See
app/services/wholesale/receivings.py for the derived figures and
app/services/wholesale/colors.py for the colour grammar every item's color_qty is
checked against.
"""

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.models.wholesale import Receiving, ReceivingCost, ReceivingItem, ReceivingPackage
from app.services.wholesale.colors import color_qty_problem, colors_as_json
from app.services.wholesale.references import allocate_reference, retry_on_reference_collision
from app.services.wholesale.units import to_pairs
from app.services.wholesale_shipments import get_shipment

_LOAD_OPTIONS = (
    selectinload(Receiving.packages).selectinload(ReceivingPackage.items),
    selectinload(Receiving.costs),
)


def _load(db: Session, receiving_id: str, branch_id: str | None) -> Receiving:
    receiving = (
        db.query(Receiving).options(*_LOAD_OPTIONS).filter(Receiving.id == receiving_id).first()
    )
    if receiving is None or (branch_id is not None and receiving.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Receiving not found")
    return receiving


def list_receivings(db: Session, branch_id: str | None) -> list[Receiving]:
    query = db.query(Receiving).options(*_LOAD_OPTIONS)
    if branch_id is not None:
        query = query.filter(Receiving.branch_id == branch_id)
    return query.order_by(Receiving.received_date.desc(), Receiving.receiving_no.desc()).all()


def get_receiving(db: Session, receiving_id: str, branch_id: str | None) -> Receiving:
    return _load(db, receiving_id, branch_id)


def _empty_packages(count: int) -> list[ReceivingPackage]:
    return [ReceivingPackage(package_no=index + 1) for index in range(max(0, count))]


def create_receiving(db: Session, branch_id: str | None, payload) -> Receiving:
    # The shipment supplies the denormalised supplier_name/voucher_no/shipment_no, the
    # same way picking a stock code fills a line's description in elsewhere — a
    # receiving still reads correctly if the shipment is edited afterwards.
    shipment = get_shipment(db, payload.shipment_id, branch_id)

    def attempt() -> Receiving:
        receiving_no = allocate_reference(db, Receiving.receiving_no, branch_id, "RCV", date.today())
        receiving = Receiving(
            branch_id=branch_id,
            receiving_no=receiving_no,
            shipment_id=shipment.id,
            shipment_no=shipment.shipment_no,
            voucher_no=shipment.voucher_no,
            supplier_name=shipment.supplier_name,
            gate=payload.gate,
            received_date=payload.received_date,
            total_packages=payload.total_packages,
            total_pairs=payload.total_pairs,
            total_unit=payload.total_unit,
            packages=_empty_packages(payload.total_packages),
        )
        db.add(receiving)
        db.commit()
        db.refresh(receiving)
        return receiving

    return retry_on_reference_collision(db, attempt)


def _resize_packages(db: Session, receiving: Receiving, count: int) -> None:
    """Keeps the package rows in step with total_packages: extra boxes gain empty rows,
    a lowered count drops rows from the end — but never one that has already been
    opened, since that would silently discard a real count."""
    current = sorted(receiving.packages, key=lambda entry: entry.package_no)
    if count == len(current):
        return
    if count > len(current):
        receiving.packages.extend(
            ReceivingPackage(package_no=len(current) + offset + 1) for offset in range(count - len(current))
        )
        return

    to_remove = current[count:]
    already_opened = [entry for entry in to_remove if entry.opened]
    if already_opened:
        numbers = ", ".join(str(entry.package_no) for entry in already_opened)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            f"Package {numbers} has already been opened — remove its products first, or keep the package count as is.",
        )
    for entry in to_remove:
        receiving.packages.remove(entry)
        db.delete(entry)


def update_receiving(db: Session, receiving_id: str, branch_id: str | None, payload) -> Receiving:
    receiving = _load(db, receiving_id, branch_id)
    data = payload.model_dump(exclude_unset=True)
    total_packages = data.pop("total_packages", None)
    for field, value in data.items():
        setattr(receiving, field, value)
    if total_packages is not None:
        receiving.total_packages = total_packages
        _resize_packages(db, receiving, total_packages)
    db.commit()
    db.refresh(receiving)
    return receiving


def delete_receiving(db: Session, receiving_id: str, branch_id: str | None) -> None:
    receiving = _load(db, receiving_id, branch_id)
    db.delete(receiving)
    db.commit()


def _item_from_payload(item_in) -> ReceivingItem:
    color_qty = item_in.color_qty.strip()
    problem = color_qty_problem(color_qty)
    if problem:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, problem)
    return ReceivingItem(
        stock_code=item_in.stock_code.strip(),
        description=item_in.description.strip(),
        product_group=item_in.product_group,
        color_qty=color_qty,
        colors=colors_as_json(color_qty),
        unit=item_in.unit,
        qty_pairs=to_pairs(item_in.qty, item_in.unit),
    )


def update_package(
    db: Session,
    receiving_id: str,
    package_id: str,
    branch_id: str | None,
    payload,
) -> Receiving:
    receiving = _load(db, receiving_id, branch_id)
    package = next((entry for entry in receiving.packages if entry.id == package_id), None)
    if package is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Package not found")

    # Keep nested Pydantic objects intact: model_dump() turns them into dictionaries,
    # while _item_from_payload deliberately reads their validated attributes.
    data = payload.model_dump(exclude_unset=True, exclude={"items"})
    items_in = payload.items if "items" in payload.model_fields_set else None
    for field, value in data.items():
        setattr(package, field, value)
    if items_in is not None:
        package.items = [_item_from_payload(item) for item in items_in]

    db.commit()
    db.refresh(receiving)
    return receiving


def replace_costs(db: Session, receiving_id: str, branch_id: str | None, costs_in) -> Receiving:
    receiving = _load(db, receiving_id, branch_id)
    receiving.costs = [
        ReceivingCost(
            stage=cost.stage.strip(),
            carrier=cost.carrier.strip(),
            kind=cost.kind.strip(),
            amount=cost.amount,
            note=cost.note.strip(),
        )
        for cost in costs_in
    ]
    db.commit()
    db.refresh(receiving)
    return receiving


def final_received_by_shipment(db: Session, shipment_ids: list[str]) -> dict[str, int]:
    """How many packages have actually been recorded at the gate for each shipment —
    across every receiving raised against it, whether or not each package has been
    opened yet. A shipment with no receiving at all is simply absent from the result;
    the caller falls back to the shipment's own stored figure in that case, the same
    rule store.ts::settleShipment follows."""
    if not shipment_ids:
        return {}
    # Outer join, not inner: a receiving raised with no packages yet must still count
    # as "0 received", not fall back to the shipment's stored figure as if no receiving
    # existed at all.
    rows = (
        db.query(Receiving.shipment_id, func.count(ReceivingPackage.id))
        .outerjoin(ReceivingPackage, ReceivingPackage.receiving_id == Receiving.id)
        .filter(Receiving.shipment_id.in_(shipment_ids))
        .group_by(Receiving.shipment_id)
        .all()
    )
    return {shipment_id: count for shipment_id, count in rows}
