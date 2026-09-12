"""app/services/wholesale/receivings.py — the derived figures a receiving is judged
by: how much has been opened, what it adds up to, and whether that agrees with what the
voucher promised."""

from app.services.wholesale.receivings import (
    ItemLike,
    PackageLike,
    checked_pct,
    counted_pairs,
    opened_count,
    package_pairs,
    pairs_difference,
    receiving_status,
)


def test_a_package_nobody_has_opened_contributes_nothing() -> None:
    packages = [PackageLike(opened=False, items=[ItemLike(qty_pairs=100)])]
    assert counted_pairs(packages) == 0


def test_counted_pairs_sums_only_opened_packages() -> None:
    packages = [
        PackageLike(opened=True, items=[ItemLike(qty_pairs=18), ItemLike(qty_pairs=6)]),
        PackageLike(opened=False, items=[ItemLike(qty_pairs=24)]),
    ]
    assert counted_pairs(packages) == 24
    assert package_pairs(packages[0].items) == 24


def test_status_is_recorded_when_nothing_is_opened_yet() -> None:
    packages = [PackageLike(opened=False, items=[])] * 3
    assert receiving_status(packages, expected_pairs=100) == "recorded"


def test_status_is_checking_while_some_packages_are_still_shut() -> None:
    packages = [
        PackageLike(opened=True, items=[ItemLike(qty_pairs=50)]),
        PackageLike(opened=False, items=[]),
    ]
    assert receiving_status(packages, expected_pairs=100) == "checking"


def test_status_is_checked_when_everything_opened_matches_the_voucher() -> None:
    packages = [PackageLike(opened=True, items=[ItemLike(qty_pairs=50)])]
    assert receiving_status(packages, expected_pairs=50) == "checked"


def test_status_is_issue_when_the_count_does_not_match() -> None:
    packages = [PackageLike(opened=True, items=[ItemLike(qty_pairs=42)])]
    assert receiving_status(packages, expected_pairs=50) == "issue"
    assert pairs_difference(packages, expected_pairs=50) == -8


def test_opened_count_and_checked_pct() -> None:
    packages = [
        PackageLike(opened=True, items=[]),
        PackageLike(opened=True, items=[]),
        PackageLike(opened=False, items=[]),
        PackageLike(opened=False, items=[]),
    ]
    assert opened_count(packages) == 2
    assert checked_pct(packages) == 50
