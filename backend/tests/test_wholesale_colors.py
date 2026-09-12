"""Checks the server's colour grammar (app/services/wholesale/colors.py) against the
fixture shared with the front-end's copy of the same rules
(frontend/renderer/src/components/features/wholesale/shared.ts). Both copies must
produce the same messages and the same parse — see the fixture's own comment."""

import json
from pathlib import Path

import pytest

from app.models.wholesale import WholesaleUnit
from app.services.wholesale.colors import color_qty_pairs, color_qty_problem, parse_color_qty

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "color_qty_cases.json").read_text())


@pytest.mark.parametrize("case", FIXTURE["problems"], ids=lambda case: repr(case["text"]))
def test_color_qty_problem_matches_the_shared_fixture(case: dict) -> None:
    assert color_qty_problem(case["text"]) == case["problem"]


@pytest.mark.parametrize("case", FIXTURE["parses"], ids=lambda case: repr(case["text"]))
def test_parse_color_qty_matches_the_shared_fixture(case: dict) -> None:
    entries = parse_color_qty(case["text"])
    assert [
        {"color": entry.color, "qty": entry.qty, "unit": entry.unit.value if entry.unit else None}
        for entry in entries
    ] == case["colors"]


@pytest.mark.parametrize("case", FIXTURE["parses"], ids=lambda case: repr(case["text"]))
def test_color_qty_pairs_matches_the_shared_fixture(case: dict) -> None:
    row_unit = WholesaleUnit(case["row_unit"])
    assert color_qty_pairs(case["text"], row_unit) == case["pairs"]


def test_a_colour_missing_its_unit_is_rejected() -> None:
    assert color_qty_problem("black10") == '"black10" needs a unit — s for sets, p for pairs, d for dozens.'


def test_an_unknown_letter_is_rejected() -> None:
    assert (
        color_qty_problem("black10x")
        == '"black10x" ends in "x" — use s for sets, p for pairs, d for dozens.'
    )


def test_mixed_units_on_one_line_are_summed_correctly() -> None:
    # black1s,black2p,pink1s — one set of black, two pairs of black, one set of pink.
    assert color_qty_pairs("black1s,black2p,pink1s", WholesaleUnit.SET) == 6 + 2 + 6
