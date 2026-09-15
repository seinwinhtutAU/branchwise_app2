"""The colour shorthand staff write by hand — "black10s,pink2p" — parsed and validated
here so the server is the one place that can say a figure is wrong. Ports
frontend/renderer/src/components/features/wholesale/shared.ts's parseColorQty and
colorQtyProblem word for word, including the exact sentences, because the client still
shows this text while someone is typing and a copy that drifts would tell staff something
different from what the server then rejects.

The client's copy stays only for instant feedback; every write here re-validates and this
module's message wins. backend/tests/test_wholesale_colors.py checks every sentence
against backend/tests/fixtures/color_qty_cases.json, which is the shared contract between
the two copies.
"""

import re
from dataclasses import dataclass

from fastapi import HTTPException, status
from app.models.wholesale import WholesaleUnit

UNIT_LETTERS: dict[str, WholesaleUnit] = {
    "p": WholesaleUnit.PAIR,
    "s": WholesaleUnit.SET,
    "d": WholesaleUnit.DOZEN,
}

_PARSE_RE = re.compile(r"^(.*?)(\d+)\s*([psd])?$", re.IGNORECASE)
_PROBLEM_RE = re.compile(r"^([A-Za-z ]+?)\s*(\d+)\s*([A-Za-z])?$")


@dataclass
class ColorEntry:
    color: str
    qty: int
    # None while a colour is still being typed with no letter yet; a saved line always
    # has one, since color_qty_problem rejects a missing letter.
    unit: WholesaleUnit | None


def parse_color_qty(text: str) -> list[ColorEntry]:
    """Every colour carries its own unit letter — black1s,black2p,pink1s — so one line
    can mix them. A colour with no letter yet falls back to None; the caller decides what
    that means (color_qty_problem rejects it outright before a line is ever saved)."""
    entries: list[ColorEntry] = []
    for raw in re.split(r"[+,]", text):
        part = raw.strip()
        if not part:
            continue
        collapsed = re.sub(r"\s+", " ", part)
        match = _PARSE_RE.match(collapsed)
        if not match:
            entries.append(ColorEntry(color=part, qty=0, unit=None))
            continue
        letter = match.group(3).lower() if match.group(3) else None
        entry = ColorEntry(
            color=match.group(1).strip(),
            qty=int(match.group(2)),
            unit=UNIT_LETTERS.get(letter) if letter else None,
        )
        if entry.color != "" or entry.qty > 0:
            entries.append(entry)
    return entries


def color_qty_problem(text: str) -> str | None:
    """Checks a colour line reads the way the business writes them, and says plainly
    what is wrong when it does not. Returns None when the line is fine."""
    trimmed = text.strip()
    if trimmed == "":
        return None

    for raw in re.split(r"[+,]", trimmed):
        part = raw.strip()
        if part == "":
            return "There is an empty piece — check the commas."

        match = _PROBLEM_RE.match(part)
        if not match:
            if re.fullmatch(r"\d+", part):
                return f'"{part}" has no color in front of it.'
            if re.fullmatch(r"[A-Za-z ]+", part):
                return f'"{part}" has no count after it.'
            return f'"{part}" is not a color, a count and a unit, like black10s.'

        if int(match.group(2)) <= 0:
            return f'"{part}" counts nothing.'

        letter = match.group(3).lower() if match.group(3) else None
        if not letter:
            return f'"{part}" needs a unit — s for sets, p for pairs, d for dozens.'
        if letter not in UNIT_LETTERS:
            return f'"{part}" ends in "{match.group(3)}" — use s for sets, p for pairs, d for dozens.'

    return None


def conversion_rates(conversions: dict[str, int] | None) -> dict[str, int]:
    """Validate the immutable conversion snapshot carried by a saved line."""
    rates = conversions or {"pair": 1, "set": 6, "dozen": 12}
    required = {unit.value for unit in WholesaleUnit}
    if (
        set(rates) != required
        or rates.get("pair") != 1
        or any(not isinstance(value, int) or value <= 0 for value in rates.values())
    ):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "Unit conversions must define positive whole-pair rates for pair, set and dozen, with pair equal to 1",
        )
    return rates


def color_qty_pairs(text: str, row_unit: WholesaleUnit, conversions: dict[str, int] | None = None) -> int:
    """What a colour line comes to in pairs. Every saved colour carries its own letter;
    a colour halfway through being typed falls back to the row's unit so a running total
    still shows something."""
    rates = conversion_rates(conversions)
    return sum(entry.qty * rates[(entry.unit or row_unit).value] for entry in parse_color_qty(text))


def color_qty_pairs_by_color(
    text: str,
    row_unit: WholesaleUnit,
    conversions: dict[str, int] | None = None,
) -> dict[str, int]:
    """Returns the pair count for each normalized colour in a shorthand value."""
    rates = conversion_rates(conversions)
    pairs: dict[str, int] = {}
    for entry in parse_color_qty(text):
        color = " ".join(entry.color.split()).casefold()
        if not color or entry.qty <= 0:
            continue
        pairs[color] = pairs.get(color, 0) + entry.qty * rates[(entry.unit or row_unit).value]
    return pairs


def colors_as_json(text: str) -> list[dict]:
    """The parsed form written alongside the raw string, so a reader never has to
    re-parse color_breakdown. This is a cache of the parse, not a second source of truth —
    color_breakdown is what a later edit is validated against."""
    return [
        {"color": entry.color, "qty": entry.qty, "unit": entry.unit.value if entry.unit else None}
        for entry in parse_color_qty(text)
    ]
