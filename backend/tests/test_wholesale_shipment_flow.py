"""app/services/wholesale/shipments.py's normalise_flow — the rule that keeps a
shipment's journey physically possible after any edit: a leg can never hold more than
the stop before it actually sent."""

from app.services.wholesale.shipments import LegInput, leg_remaining, max_for_leg, normalise_flow


def test_a_leg_that_received_more_than_was_sent_to_it_is_trimmed() -> None:
    # Cargo sends 10; Yangon claims to have received 10 (fine) and sent on 12 (impossible
    # — it can only send at most what it received).
    cargo_sent = 10
    legs = [LegInput(stop_name="Yangon", carrier_name="U Hla", packages_received=10, packages_sent=12)]
    _, settled, _ = normalise_flow(total_packages=10, packages_sent_by_cargo=cargo_sent, legs=legs, final_received_packages=0)
    assert settled[0].packages_sent == 10


def test_lowering_an_earlier_figure_trims_every_leg_after_it() -> None:
    # Cargo originally sent 10 and both legs assumed that; cargo's own figure is then
    # corrected down to 6.
    legs = [
        LegInput(stop_name="Yangon", carrier_name="U Hla", packages_received=10, packages_sent=8),
        LegInput(stop_name="Mandalay", carrier_name="Daw Aye", packages_received=8, packages_sent=8),
    ]
    cargo, settled, final = normalise_flow(
        total_packages=10, packages_sent_by_cargo=6, legs=legs, final_received_packages=8
    )
    assert cargo == 6
    assert settled[0].packages_received == 6
    assert settled[0].packages_sent == 6
    assert settled[1].packages_received == 6
    assert settled[1].packages_sent == 6
    assert final == 6


def test_a_valid_chain_is_left_untouched() -> None:
    legs = [LegInput(stop_name="Yangon", carrier_name="U Hla", packages_received=10, packages_sent=7)]
    cargo, settled, final = normalise_flow(
        total_packages=10, packages_sent_by_cargo=10, legs=legs, final_received_packages=7
    )
    assert cargo == 10
    assert settled[0].packages_received == 10
    assert settled[0].packages_sent == 7
    assert final == 7


def test_leg_remaining_is_measured_against_what_was_sent_to_it_not_what_it_received() -> None:
    # Cargo sends 10 to Yangon; only 7 turn up and Yangon forwards all 7. Yangon is not
    # finished — 3 are still missing between the two places, and legRemaining must say
    # so rather than reading 0 because 7 received minus 7 sent is 0.
    class FakeShipment:
        packages_sent_by_cargo = 10
        legs = [LegInput(stop_name="Yangon", carrier_name="U Hla", packages_received=7, packages_sent=7)]

    shipment = FakeShipment()
    assert max_for_leg(shipment, 0) == 10
    assert leg_remaining(shipment, 0) == 3
