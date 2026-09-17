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

from app.models.wholesale import Receiving, Shipment, ShipmentLeg, WholesaleWriteOff, WholesaleWriteOffReason
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


def update_shipment(db: Session, shipment_id: str, branch_id: str | None, payload) -> Shipment:
    shipment = _load(db, shipment_id, branch_id)
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
) -> tuple[Shipment, Shipment]:
    """Carves `packages` (and, if known, `quantity_pairs`) out of a shipment into a
    brand-new shipment of its own — the case where the cargo company only sends part of
    a voucher one way and holds the rest for a different destination. By default that's
    the cargo company's own still-undispatched packages; `split_leg_order` instead names
    a stop further along the route whose own leftover is being redirected somewhere new.

    Neither figure is pinned to what a stop's own records show it is holding, only
    checked against the shipment's own current totals: a split is often also a
    repackaging (one box becomes two for two different places, or several become one),
    so the box count moving doesn't have to match what any one stop was last recorded
    with, and what's actually inside a box isn't known for certain until it's opened and
    counted at the receiving gate — `quantity_pairs` is optional for exactly that reason,
    and the original's own quantity is left untouched when it's left unset.

    A leg-stage split carries the new shipment's already-travelled route with it rather
    than starting it blank: every stop up to and including the split point is copied
    across (at `packages`), so its journey still shows where it has actually been, and
    the same amount is subtracted (never below zero — see the note above on why this
    isn't pinned to exact stop figures) from the original's matching stops.

    Both the reduction on the original and the new shipment are written in the same
    transaction — via the same allocate-reference-and-commit retry `create_shipment`
    uses — so the two totals can never drift out of sync with each other."""
    original = _load(db, shipment_id, branch_id)
    leg_index = _split_leg_index(original, split_leg_order)
    if packages > original.total_packages:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Split packages cannot exceed the shipment's own total packages",
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
        existing_losses = {leg.stop_name: leg.lost_packages for leg in current.legs}
        if quantity_pairs is not None:
            current.total_quantity_pairs = max(0, current.total_quantity_pairs - quantity_pairs)

        travelled_legs: list[ShipmentLeg] = []
        new_packages_sent_by_cargo = 0
        raw_cargo_sent = current.packages_sent_by_cargo
        raw_legs = [
            LegInput(
                stop_name=leg.stop_name,
                carrier_name=leg.carrier_name,
                packages_received=leg.packages_received,
                packages_sent=leg.packages_sent,
            )
            for leg in current.legs
        ]
        if leg_index is not None:
            # Every stop strictly before the split point forwarded these packages in
            # full — that is what let them reach the split stop at all — so both sides
            # of its figures move across. The split stop itself only had them arrive,
            # not go out, which is exactly why they were free to redirect.
            raw_cargo_sent -= packages
            new_packages_sent_by_cargo = packages
            for index, leg in enumerate(current.legs):
                if index < leg_index:
                    raw_legs[index].packages_received -= packages
                    raw_legs[index].packages_sent -= packages
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
                    raw_legs[index].packages_received -= packages
                    travelled_legs.append(
                        ShipmentLeg(
                            leg_order=index + 1,
                            stop_name=leg.stop_name,
                            carrier_name=leg.carrier_name,
                            packages_received=packages,
                            packages_sent=0,
                        )
                    )

        # A repackaging split doesn't have to fit neatly inside what any one stop's own
        # figures show it holding (see the docstring above) — rather than rejecting an
        # input that doesn't, this runs it through the same re-clamp every other edit
        # goes through (normalise_flow) so the original settles back to something
        # possible, never a negative or otherwise impossible number.
        settled_legs = _apply_normalised_flow(
            current,
            max(0, current.total_packages - packages),
            max(0, raw_cargo_sent),
            raw_legs,
            current.final_received_packages,
        )
        # Cleared and flushed before the replacements are added — see update_shipment's
        # identical dance, done for the identical reason (the (shipment_id, leg_order)
        # uniqueness constraint).
        current.legs.clear()
        db.flush()
        current.legs = settled_legs
        _restore_leg_losses(current, settled_legs, existing_losses)

        shipment_no = allocate_reference(db, Shipment.shipment_no, current.branch_id, "SHP", date.today())
        new_shipment = Shipment(
            branch_id=current.branch_id,
            shipment_no=shipment_no,
            voucher_no=current.voucher_no,
            supplier_name=current.supplier_name,
            carrier_name=carrier_name.strip() or current.carrier_name,
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
        db.commit()
        db.refresh(new_shipment)
        return new_shipment

    new_shipment = retry_on_reference_collision(db, attempt)
    return _load(db, shipment_id, branch_id), new_shipment


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
