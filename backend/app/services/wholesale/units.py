"""The one conversion every wholesale figure is stored under: a pair is the thing
itself, a set is 6 pairs, a dozen is 12. Ports
frontend/renderer/src/components/features/wholesale/units.ts exactly, because a mismatch
here would silently turn ten sets into ten pairs — a sixfold error — on whichever side is
wrong."""

from app.models.wholesale import WholesaleUnit

PAIRS_PER: dict[WholesaleUnit, int] = {
    WholesaleUnit.PAIR: 1,
    WholesaleUnit.SET: 6,
    WholesaleUnit.DOZEN: 12,
}


def to_pairs(qty: int, unit: WholesaleUnit) -> int:
    """Turns a figure typed in some unit into pairs."""
    return qty * PAIRS_PER[unit]


def from_pairs(pairs: int, unit: WholesaleUnit) -> float:
    """Turns pairs back into a unit. Can come out fractional — 9 pairs is one and a
    half sets — so the caller decides how to show it."""
    return pairs / PAIRS_PER[unit]


def priced_amount(
    quantity_pairs: int | float,
    unit: WholesaleUnit,
    price: int | float,
    conversions: dict[str, int] | None = None,
) -> float:
    """Returns the amount for pairs stored at a price quoted in ``unit``.

    Quantities are persisted in pairs, while staff enter a price per pair, set, or
    dozen. Keeping that conversion here ensures every total respects the unit the
    line was quoted in.
    """
    rates = conversions or {entry.value: pairs for entry, pairs in PAIRS_PER.items()}
    return quantity_pairs / rates[unit.value] * price
