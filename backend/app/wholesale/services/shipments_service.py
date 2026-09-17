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

from app.wholesale.models.entities import Receiving, Shipment, ShipmentLeg, WholesaleWriteOff, WholesaleWriteOffReason
from app.wholesale.services.audit import record_audit_log
from app.wholesale.services.lifecycle import (
    ShipmentAction,
    assert_can_perform_shipment_action,
)
from app.wholesale.services.references import allocate_reference, retry_on_reference_collision
from app.wholesale.services.shipments import LegInput, cargo_remaining, leg_remaining, normalise_flow


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
    return query.order_by(Shipment.sent_on.desc(), Shipment.shipment_no.desc()).all()


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


def _restore_leg_losses(shipment: Shipment, legs: list[ShipmentLeg], losses_by_stop: dict[str, int]) -> None:
    """Carry existing loss explanations through a route edit when a stop remains."""
    available = shipment.packages_sent_by_cargo
    for leg in legs:
        leg.lost_packages = min(losses_by_stop.get(leg.stop_name, 0), max(0, available - leg.packages_sent))
        available = leg.packages_sent


def create_shipment(db: Session, branch_id: str | None, payload) -> Shipment:
    def attempt() -> Shipment:
        shipment_no = allocate_reference(db, Shipment.shipment_no, branch_id, "SHP", date.today())
        shipment = Shipment(
            branch_id=branch_id,
            shipment_no=shipment_no,
            voucher_no=payload.voucher_no,
            supplier_name=payload.supplier_name,
            carrier_name=payload.carrier_name,
            final_destination=payload.final_destination,
            sent_on=payload.sent_on,
            total_quantity_pairs=payload.total_quantity_pairs,
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


def update_shipment(
    db: Session,
    shipment_id: str,
    branch_id: str | None,
    payload,
    operator_id: str | None = None,
) -> Shipment:
    shipment = _load(db, shipment_id, branch_id)
    from app.wholesale.services.receivings_service import final_received_by_shipment

    has_receiving = db.query(Receiving.id).filter(Receiving.shipment_id == shipment.id).first() is not None
    overrides = final_received_by_shipment(db, [shipment.id])
    final_received = overrides.get(shipment.id, shipment.final_received_packages)
    assert_can_perform_shipment_action(
        shipment,
        ShipmentAction.EDIT,
        final_received,
        has_receiving=has_receiving,
    )
    existing_losses = {leg.stop_name: leg.lost_packages for leg in shipment.legs}
    repackaged_rows = (
        db.query(WholesaleWriteOff)
        .filter(
            WholesaleWriteOff.subject_type == "shipment_leg",
            WholesaleWriteOff.subject_id.in_([leg.id for leg in shipment.legs]),
            WholesaleWriteOff.reason == WholesaleWriteOffReason.REPACKAGED,
        )
        .order_by(WholesaleWriteOff.created_at.desc())
        .all()
    )
    repackaged_by_leg = {
        row.subject_id: row.quantity
        for row in reversed(repackaged_rows)
    }
    repackaged_by_stop = {
        leg.stop_name: repackaged_by_leg[leg.id]
        for leg in shipment.legs
        if leg.id in repackaged_by_leg
    }
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
        for leg in new_legs:
            if leg.stop_name in repackaged_by_stop:
                corrected = repackaged_by_stop[leg.stop_name]
                leg.packages_received = corrected
                leg.packages_sent = corrected
        _restore_leg_losses(shipment, new_legs, existing_losses)
    else:
        # Nothing about the legs changed shape, but a lowered total_packages or cargo
        # figure can still trim what is already there.
        for leg, settled in zip(shipment.legs, new_legs):
            leg.packages_received = settled.packages_received
            leg.packages_sent = settled.packages_sent
            if leg.id in repackaged_by_leg:
                corrected = repackaged_by_leg[leg.id]
                leg.packages_received = corrected
                leg.packages_sent = corrected
        _restore_leg_losses(shipment, shipment.legs, existing_losses)

    record_audit_log(
        db,
        branch_id=shipment.branch_id,
        entity_type="shipment",
        entity_id=shipment.id,
        action="update",
        operator_id=operator_id,
        summary=f"Updated shipment {shipment.shipment_no}",
        payload=payload.model_dump(exclude_unset=True),
    )
    db.commit()
    db.refresh(shipment)
    return shipment


def _split_leg_index(original: Shipment, split_leg_order: int | None) -> int | None:
    """None means the cargo stage. Otherwise resolves the 1-based `split_leg_order` to
    an index into `original.legs`, raising if that stop no longer exists."""
    if split_leg_order is None:
        return None
    index = split_leg_order - 1
    if index < 0 or index >= len(original.legs):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "That stop no longer exists on this shipment")
    return index


def split_shipment(
    db: Session,
    shipment_id: str,
    branch_id: str | None,
    packages: int,
    quantity_pairs: int | None,
    final_destination: str,
    carrier_name: str,
    split_leg_order: int | None = None,
    operator_id: str | None = None,
) -> tuple[Shipment, Shipment]:
    """Carves `packages` (and, if known, `quantity_pairs`) out of a shipment's
    still-undispatched remainder into a brand-new shipment of its own — the case where
    the cargo company only sends part of a voucher one way and holds the rest for a
    different destination. By default that remainder is the cargo company's own
    still-undispatched packages; `split_leg_order` instead names a stop further along the
    route whose own leftover (physically arrived there, not yet sent on) is being redirected
    somewhere new. Either way, only an undispatched remainder can move: packages already
    sent onward from wherever they are now belong to the journey already in progress —
    `packages` is strictly capped at that remainder (cargo_remaining, or physical available
    packages for the chosen stop) precisely so a split can never rewrite an already-sent
    figure a Receiving may already refer to.

    `quantity_pairs` gets a looser rule: it's optional, and when given is only checked
    against the shipment's own total, not against a per-stop share of it. Quantity isn't
    tracked per stop the way packages are, and what's actually inside a box isn't known
    for certain until it's opened and counted at the receiving gate, so this doesn't try
    to pin it down — the original's own quantity is simply left untouched when it's left
    unset.

    A leg-stage split carries the new shipment's already-travelled route with it rather
    than starting it blank: every stop up to and including the split point is copied
    across (at `packages`), so its journey still shows where it has actually been, and
    the same amount is subtracted from the original's matching stops.

    Both the reduction on the original and the new shipment are written in the same
    transaction — via the same allocate-reference-and-commit retry `create_shipment`
    uses — so the two totals can never drift out of sync with each other."""
    original = _load(db, shipment_id, branch_id)
    leg_index = _split_leg_index(original, split_leg_order)
    from app.wholesale.services.receivings_service import final_received_by_shipment

    has_receiving = db.query(Receiving.id).filter(Receiving.shipment_id == original.id).first() is not None
    overrides = final_received_by_shipment(db, [original.id])
    final_received = overrides.get(original.id, original.final_received_packages)

    assert_can_perform_shipment_action(
        original,
        ShipmentAction.SPLIT,
        final_received,
        has_receiving=has_receiving,
    )
    if leg_index is None:
        available = cargo_remaining(original)
        stage_description = "still undispatched at cargo"
    else:
        leg = original.legs[leg_index]
        available = max(0, leg.packages_received - leg.packages_sent - getattr(leg, "lost_packages", 0))
        stage_description = f"still sitting at {leg.stop_name}"

    if packages <= 0:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Split packages must be at least 1",
        )
    if packages > available:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"Only {available} packages are {stage_description} and can be split off",
        )
    if quantity_pairs is not None and quantity_pairs > original.total_quantity_pairs:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Split quantity cannot exceed the shipment's own total quantity",
        )

    def attempt() -> Shipment:
        # Reloaded fresh each attempt: a prior try's rollback (on a reference collision)
        # expires this session's objects, so the pending subtraction below must be
        # re-applied against the current committed state, not a stale in-memory value.
        current = _load(db, shipment_id, branch_id)
        current.total_packages = max(0, current.total_packages - packages)
        if quantity_pairs is not None:
            current.total_quantity_pairs = max(0, current.total_quantity_pairs - quantity_pairs)

        travelled_legs: list[ShipmentLeg] = []
        new_packages_sent_by_cargo = 0
        new_cargo_carrier = carrier_name.strip() or current.carrier_name

        if leg_index is not None:
            # Every stop strictly before the split point forwarded these packages in
            # full — that is what let them reach the split stop at all — so both sides
            # of its figures move across. The split stop itself only had them arrive,
            # not go out, which is exactly why they were free to redirect.
            new_cargo_carrier = current.carrier_name
            current.packages_sent_by_cargo = max(0, current.packages_sent_by_cargo - packages)
            new_packages_sent_by_cargo = packages
            for index, leg in enumerate(current.legs):
                if index < leg_index:
                    leg.packages_received = max(0, leg.packages_received - packages)
                    leg.packages_sent = max(0, leg.packages_sent - packages)
                    travelled_legs.append(
                        ShipmentLeg(
                            leg_order=index + 1,
                            stop_name=leg.stop_name,
                            carrier_name=leg.carrier_name,
                            packages_received=packages,
                            packages_sent=packages,
                        )
                    )
                elif index == leg_index:
                    leg.packages_received = max(0, leg.packages_received - packages)
                    split_leg_carrier = carrier_name.strip() or leg.carrier_name
                    travelled_legs.append(
                        ShipmentLeg(
                            leg_order=index + 1,
                            stop_name=leg.stop_name,
                            carrier_name=split_leg_carrier,
                            packages_received=packages,
                            packages_sent=0,
                        )
                    )

        shipment_no = allocate_reference(db, Shipment.shipment_no, current.branch_id, "SHP", date.today())
        new_shipment = Shipment(
            branch_id=current.branch_id,
            shipment_no=shipment_no,
            voucher_no=current.voucher_no,
            supplier_name=current.supplier_name,
            carrier_name=new_cargo_carrier,
            final_destination=final_destination,
            sent_on=current.sent_on,
            total_packages=packages,
            total_quantity_pairs=quantity_pairs or 0,
            total_unit=current.total_unit,
            packages_sent_by_cargo=new_packages_sent_by_cargo,
            final_received_packages=0,
            split_from_shipment_id=current.id,
            legs=travelled_legs,
        )
        db.add(new_shipment)
        record_audit_log(
            db,
            branch_id=current.branch_id,
            entity_type="shipment",
            entity_id=current.id,
            action="split",
            operator_id=operator_id,
            summary=f"Split {packages} packages into {new_shipment.shipment_no} to {final_destination}",
            payload={
                "new_shipment_id": new_shipment.id,
                "new_shipment_no": new_shipment.shipment_no,
                "packages": packages,
                "quantity_pairs": quantity_pairs,
                "final_destination": final_destination,
                "carrier_name": carrier_name,
                "split_leg_order": split_leg_order,
            },
        )
        db.commit()
        db.refresh(new_shipment)
        return new_shipment

    new_shipment = retry_on_reference_collision(db, attempt)
    return _load(db, shipment_id, branch_id), new_shipment


def delete_shipment(
    db: Session,
    shipment_id: str,
    branch_id: str | None,
    operator_id: str | None = None,
) -> None:
    shipment = _load(db, shipment_id, branch_id)
    from app.wholesale.services.receivings_service import final_received_by_shipment

    has_receiving = db.query(Receiving.id).filter(Receiving.shipment_id == shipment.id).first() is not None
    overrides = final_received_by_shipment(db, [shipment.id])
    final_received = overrides.get(shipment.id, shipment.final_received_packages)
    assert_can_perform_shipment_action(
        shipment,
        ShipmentAction.DELETE,
        final_received,
        has_receiving=has_receiving,
    )
    record_audit_log(
        db,
        branch_id=shipment.branch_id,
        entity_type="shipment",
        entity_id=shipment.id,
        action="delete",
        operator_id=operator_id,
        summary=f"Deleted shipment {shipment.shipment_no}",
        payload={"shipment_no": shipment.shipment_no},
    )
    db.delete(shipment)
    db.commit()
