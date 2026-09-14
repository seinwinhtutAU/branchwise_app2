"""The Delivery screen's business rules — one supplier voucher travelling as freight
through zero or more stops to a receiving gate. Ports
frontend/renderer/src/components/features/wholesale/shipments.ts, including the fix
already made there: a stop's remaining is measured against what was sent *to* it, not
against what it happens to have received, so a stop that took in 7 of the 10 sent to it
and forwarded all 7 correctly shows 3 still owed rather than reading as finished.
"""

from dataclasses import dataclass

from app.models.wholesale import Shipment, ShipmentLeg, WholesaleUnit
from app.services.wholesale.shared import share_pct
from app.services.wholesale.units import to_pairs

SHIPMENT_STATUSES = ["waiting_at_cargo", "in_transit", "partly_delivered", "completed"]


@dataclass
class LegInput:
    stop_name: str
    carrier_name: str
    packages_received: int
    packages_sent: int


def shipment_pairs(total_quantity_pairs: int) -> int:
    """total_quantity_pairs is already stored in pairs — this exists so callers read one name for
    the figure regardless of which table it comes from, matching shipmentPairs on the
    front end (which converts total_quantity_pairs via total_unit; here total_quantity_pairs already is that
    conversion, computed once on write)."""
    return total_quantity_pairs


def cargo_remaining(shipment: Shipment) -> int:
    """Packages the cargo company still has not sent."""
    return max(0, shipment.total_packages - shipment.packages_sent_by_cargo)


def max_for_leg(shipment: Shipment, index: int) -> int:
    """The most a stop could have received — whatever the place before it sent on."""
    if index == 0:
        return shipment.packages_sent_by_cargo
    return shipment.legs[index - 1].packages_sent


def leg_remaining(shipment: Shipment, index: int) -> int:
    """What a stop still owes the rest of the journey: everything sent to it, less what
    it has sent on. Measured against what was sent to it, not against what it happens to
    have received — if the cargo company sends 10 to Yangon, only 7 turn up there and
    Yangon forwards all 7, Yangon is not finished: 3 are still missing between the two
    places. Same rule as the gate at the end of the route."""
    return max(0, max_for_leg(shipment, index) - shipment.legs[index].packages_sent)


def into_final(shipment: Shipment) -> int:
    """What is heading to us: the last stop's send, or the cargo's if there are no
    stops."""
    if shipment.legs:
        return shipment.legs[-1].packages_sent
    return shipment.packages_sent_by_cargo


def final_remaining(shipment: Shipment, final_received_packages: int) -> int:
    """Packages of this shipment that have still not reached us, measured against
    everything the shipment set out with — not against what the last stop happened to
    send on."""
    return max(0, shipment.total_packages - final_received_packages)


def shipment_status(shipment: Shipment, final_received_packages: int) -> str:
    if shipment.packages_sent_by_cargo <= 0:
        return "waiting_at_cargo"
    if shipment.total_packages > 0 and final_received_packages >= shipment.total_packages:
        return "completed"
    if final_received_packages > 0:
        return "partly_delivered"
    return "in_transit"


def destination_count(shipment: Shipment) -> int:
    """Every place the packages arrive at on the way here: the cargo company, each stop
    in between, and our own place at the end. The supplier is not counted — that is
    where the goods start out, not somewhere they are delivered to."""
    return len(shipment.legs) + 2


def arrived_pct(shipment: Shipment, final_received_packages: int) -> int:
    return share_pct(final_received_packages, shipment.total_packages)


def normalise_flow(
    total_packages: int,
    packages_sent_by_cargo: int,
    legs: list[LegInput],
    final_received_packages: int,
) -> tuple[int, list[LegInput], int]:
    """Re-settles the whole chain after a destination is added or removed, or a figure is
    edited. A stop can only hold what the stop before it sent on, so taking one out of the
    middle (or lowering an earlier figure) can leave a later one holding more than now
    reaches it; this walks the route and trims each figure down to what is actually
    possible, rather than leaving impossible numbers in the database.

    Returns the clamped (packages_sent_by_cargo, legs, final_received_packages)."""
    available = min(packages_sent_by_cargo, total_packages)
    settled_legs: list[LegInput] = []
    for leg in legs:
        received = min(leg.packages_received, available)
        sent = min(leg.packages_sent, received)
        available = sent
        settled_legs.append(
            LegInput(
                stop_name=leg.stop_name,
                carrier_name=leg.carrier_name,
                packages_received=received,
                packages_sent=sent,
            )
        )
    clamped_cargo = min(packages_sent_by_cargo, total_packages)
    clamped_final = min(final_received_packages, available)
    return clamped_cargo, settled_legs, clamped_final


def shipment_derived(shipment: Shipment, final_received_override: int | None = None) -> dict:
    """Every worked-out figure for one shipment, as its API response includes them.

    final_received_override is the count of packages actually recorded at the gate,
    computed by app/services/wholesale_receivings.py::final_received_by_shipment once a
    receiving exists for this shipment; None means no receiving has been raised for it
    yet, so the shipment's own stored figure is the only word anyone has — the same
    fallback rule store.ts::settleShipment follows on the front end."""
    final_received = (
        final_received_override if final_received_override is not None else shipment.final_received_packages
    )
    legs = shipment.legs
    return {
        "total_quantity_pairs": shipment_pairs(shipment.total_quantity_pairs),
        "final_received_packages": final_received,
        "cargo_remaining": cargo_remaining(shipment),
        "final_remaining": final_remaining(shipment, final_received),
        "shipment_status": shipment_status(shipment, final_received),
        "destination_count": destination_count(shipment),
        "arrived_pct": arrived_pct(shipment, final_received),
        "legs": [
            {
                "max_for_leg": max_for_leg(shipment, index),
                "leg_remaining": leg_remaining(shipment, index),
            }
            for index in range(len(legs))
        ],
    }
