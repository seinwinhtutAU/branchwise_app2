"""The Receiving screen's business rules: what is due to arrive at a gate, and what
actually turned up once the packages are opened. Ports
frontend/renderer/src/components/features/wholesale/receivings.ts's pure functions —
the gap between what was promised and what the business really has is worked out here
identically to how the screen already works it out.
"""

from dataclasses import dataclass, field

from app.wholesale.services.shared import share_pct

RECEIVING_STATUSES = ["recorded", "checking", "checked", "issue"]


@dataclass
class ItemLike:
    quantity_pairs: int


@dataclass
class PackageLike:
    opened: bool
    items: list[ItemLike] = field(default_factory=list)


def package_pairs(items: list[ItemLike]) -> int:
    """Everything found in one package, in pairs — whatever units its products were
    counted in. Pairs are the one thing every screen agrees on."""
    return sum(item.quantity_pairs for item in items)


def opened_count(packages: list[PackageLike]) -> int:
    return sum(1 for package in packages if package.opened)


def counted_pairs(packages: list[PackageLike]) -> int:
    """Pairs actually found, across every package opened so far."""
    return sum(package_pairs(package.items) for package in packages if package.opened)


def pairs_difference(packages: list[PackageLike], expected_pairs: int) -> int:
    return counted_pairs(packages) - expected_pairs


def checked_pct(packages: list[PackageLike]) -> int:
    return share_pct(opened_count(packages), len(packages))


def receiving_status(packages: list[PackageLike], expected_pairs: int) -> str:
    opened = opened_count(packages)
    if opened == 0:
        return "recorded"
    if opened < len(packages):
        return "checking"
    return "checked" if pairs_difference(packages, expected_pairs) == 0 else "issue"


def cost_by_stage(
    costs: list[tuple[str, float]], stages: list[str]
) -> list[dict]:
    """What each stage of the journey has cost, in the order the packages passed through
    it. Stages with nothing spent on them are left out — an empty row says nothing.
    `costs` is a list of (stage, amount) pairs."""
    totals: dict[str, float] = {}
    for stage, amount in costs:
        key = stage if stage.strip() != "" else "Not said where"
        totals[key] = totals.get(key, 0) + amount

    ordered = [stage for stage in [*stages, "Not said where"] if stage in totals]
    extras = [stage for stage in totals if stage not in ordered]
    return [{"stage": stage, "amount": totals[stage]} for stage in [*ordered, *extras]]
