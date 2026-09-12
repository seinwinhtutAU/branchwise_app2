"""Owns the transactions for the Delivery screen's shipments: creating a shipment with
its legs, updating either, and the flow re-clamp (normalise_flow) that runs after every
write so an impossible route — a leg holding more than the stop before it sent — can
never be stored, matching the guarantee
frontend/renderer/src/components/features/wholesale/shipments.ts::normaliseFlow makes on
every edit.
"""

from datetime import date

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.models.wholesale import Receiving, Shipment, ShipmentLeg
from app.services.wholesale.references import allocate_reference, retry_on_reference_collision
from app.services.wholesale.shipments import LegInput, normalise_flow


def _load(db: Session, shipment_id: str, branch_id: str | None) -> Shipment:
    shipment = (
        db.query(Shipment)
        .options(selectinload(Shipment.legs))
        .filter(Shipment.id == shipment_id)
        .first()
    )
    if shipment is None or (branch_id is not None and shipment.branch_id != branch_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Shipment not found")
    return shipment


def list_shipments(db: Session, branch_id: str | None) -> list[Shipment]:
    query = db.query(Shipment).options(selectinload(Shipment.legs))
    if branch_id is not None:
        query = query.filter(Shipment.branch_id == branch_id)
    return query.order_by(Shipment.sent_date.desc(), Shipment.shipment_no.desc()).all()


def get_shipment(db: Session, shipment_id: str, branch_id: str | None) -> Shipment:
    return _load(db, shipment_id, branch_id)


def _apply_normalised_flow(
    shipment: Shipment,
    total_packages: int,
    packages_sent_by_cargo: int,
    legs: list[LegInput],
    final_received_packages: int,
) -> list[ShipmentLeg]:
    clamped_cargo, settled_legs, clamped_final = normalise_flow(
        total_packages, packages_sent_by_cargo, legs, final_received_packages
    )
    shipment.total_packages = total_packages
    shipment.packages_sent_by_cargo = clamped_cargo
    shipment.final_received_packages = clamped_final
    return [
        ShipmentLeg(
            leg_order=index + 1,
            stop_name=leg.stop_name,
            carrier_name=leg.carrier_name,
            packages_received=leg.packages_received,
            packages_sent=leg.packages_sent,
        )
        for index, leg in enumerate(settled_legs)
    ]


def create_shipment(db: Session, branch_id: str | None, payload) -> Shipment:
    def attempt() -> Shipment:
        shipment_no = allocate_reference(db, Shipment.shipment_no, branch_id, "SHP", date.today())
        shipment = Shipment(
            branch_id=branch_id,
            shipment_no=shipment_no,
            voucher_no=payload.voucher_no,
            supplier_name=payload.supplier_name,
            cargo_name=payload.cargo_name,
            final_location=payload.final_location,
            sent_date=payload.sent_date,
            total_pairs=payload.total_pairs,
            total_unit=payload.total_unit,
            total_packages=0,
            packages_sent_by_cargo=0,
            final_received_packages=0,
        )
        legs = _apply_normalised_flow(
            shipment,
            payload.total_packages,
            payload.packages_sent_by_cargo,
            [
                LegInput(
                    stop_name=leg.stop_name,
                    carrier_name=leg.carrier_name,
                    packages_received=leg.packages_received,
                    packages_sent=leg.packages_sent,
                )
                for leg in payload.legs
            ],
            payload.final_received_packages,
        )
        shipment.legs = legs
        db.add(shipment)
        db.commit()
        db.refresh(shipment)
        return shipment

    return retry_on_reference_collision(db, attempt)


def update_shipment(db: Session, shipment_id: str, branch_id: str | None, payload) -> Shipment:
    shipment = _load(db, shipment_id, branch_id)
    data = payload.model_dump(exclude_unset=True)

    legs_input = data.pop("legs", None)
    for field, value in data.items():
        setattr(shipment, field, value)

    current_legs = (
        [
            LegInput(
                stop_name=leg["stop_name"],
                carrier_name=leg["carrier_name"],
                packages_received=leg["packages_received"],
                packages_sent=leg["packages_sent"],
            )
            for leg in legs_input
        ]
        if legs_input is not None
        else [
            LegInput(
                stop_name=leg.stop_name,
                carrier_name=leg.carrier_name,
                packages_received=leg.packages_received,
                packages_sent=leg.packages_sent,
            )
            for leg in shipment.legs
        ]
    )

    new_legs = _apply_normalised_flow(
        shipment,
        shipment.total_packages,
        shipment.packages_sent_by_cargo,
        current_legs,
        shipment.final_received_packages,
    )
    if legs_input is not None:
        # Cleared and flushed before the replacements are added: assigning the new list
        # directly can interleave the delete-orphan removals with the inserts within one
        # flush, and a new leg sharing a leg_order with one still being deleted trips the
        # (shipment_id, leg_order) uniqueness constraint.
        shipment.legs.clear()
        db.flush()
        shipment.legs = new_legs
    else:
        # Nothing about the legs changed shape, but a lowered total_packages or cargo
        # figure can still trim what is already there.
        for leg, settled in zip(shipment.legs, new_legs):
            leg.packages_received = settled.packages_received
            leg.packages_sent = settled.packages_sent

    db.commit()
    db.refresh(shipment)
    return shipment


def delete_shipment(db: Session, shipment_id: str, branch_id: str | None) -> None:
    shipment = _load(db, shipment_id, branch_id)
    has_receiving = db.query(Receiving.id).filter(Receiving.shipment_id == shipment.id).first()
    if has_receiving is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "This shipment has a receiving against it — remove that first.",
        )
    db.delete(shipment)
    db.commit()
