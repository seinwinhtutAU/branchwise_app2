"""app/wholesale/services/references.py — the PREFIX-YYMMDD-NNNN numbering, scoped per
branch and per day."""

from datetime import date

from app.wholesale.services.references import next_reference


def test_the_first_reference_of_the_day_is_0001() -> None:
    assert next_reference("SHP", [], date(2026, 8, 27)) == "SHP-260827-0001"


def test_the_next_reference_follows_the_highest_already_used() -> None:
    existing = ["SHP-260827-0001", "SHP-260827-0002"]
    assert next_reference("SHP", existing, date(2026, 8, 27)) == "SHP-260827-0003"


def test_a_different_day_starts_again_at_0001() -> None:
    existing = ["SHP-260827-0001", "SHP-260827-0002"]
    assert next_reference("SHP", existing, date(2026, 8, 28)) == "SHP-260828-0001"


def test_a_reference_for_a_different_prefix_is_ignored() -> None:
    existing = ["RCV-260827-0005"]
    assert next_reference("SHP", existing, date(2026, 8, 27)) == "SHP-260827-0001"


def test_a_gap_in_the_sequence_is_not_reused() -> None:
    # Numbers 1 and 3 exist (2 was perhaps on a deleted shipment) — the next one is 4,
    # not the gap.
    existing = ["SHP-260827-0001", "SHP-260827-0003"]
    assert next_reference("SHP", existing, date(2026, 8, 27)) == "SHP-260827-0004"
