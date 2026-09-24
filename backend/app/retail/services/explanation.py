"""Why a number moved — the explanation layer behind the Overview tab's alerts.

An alert that says "revenue is down 11.3%" tells a manager something they could have
read off a chart. What they actually need is the next sentence: *fewer people came in,
and the ones who did spent more*. That is a different decision (marketing, opening
hours, staffing) from *the same people bought less each* (pricing, placement, stock).

Every explanation here is **arithmetic**. Revenue decomposes exactly:

    revenue = transactions x average basket

    Δrevenue = (ΔT x B₀)  +  (ΔB x T₀)  +  (ΔT x ΔB)
               transactions   basket        interaction
               effect         effect

The three terms sum to the actual change with no residual, so whichever of the first
two is larger *is* the driver — it is measured, not inferred, and not a model's
opinion. That distinction is the whole reason this module exists rather than a prompt:
a decomposition can be checked by hand, and it cannot be confidently wrong.

Money figures never appear in the sentences these functions produce — only percentages
and directions. The effects are computed in Kyat internally to decide which term
dominates, but a manager reading "transactions are down 17.8%" does not need the
Ks 17,800 that represents, and printing it would invite comparing it against a revenue
total it is not directly comparable to.
"""

from dataclasses import dataclass

# How lopsided the two effects must be before one is called "the" driver. At 65% of the
# combined movement, the larger term is clearly carrying the change; between 35% and
# 65% the honest answer is that both are contributing, and saying so is more useful
# than picking a winner by a nose.
DOMINANCE_SHARE = 0.65

# Below this, a margin is "roughly unchanged" rather than moved — sub-percentage-point
# drift on an estimated figure is noise, and calling it a fall would be overreading.
MARGIN_DRIFT_PP = 1.0


def _direction(pct: float) -> str:
    return "up" if pct >= 0 else "down"


@dataclass(frozen=True)
class RevenueChange:
    """The exact split of a revenue movement into its two causes.

    `transaction_effect + basket_effect + interaction_effect` equals the actual change
    in revenue exactly — there is no residual to explain away.
    """

    revenue_change: float
    revenue_growth_pct: float
    transaction_growth_pct: float
    basket_growth_pct: float
    transaction_effect: float
    basket_effect: float
    interaction_effect: float
    # transactions | basket | both — which term carries the movement.
    dominant: str


def decompose_revenue_change(
    net_revenue: float,
    previous_net_revenue: float,
    transaction_count: int,
    previous_transaction_count: int,
) -> RevenueChange | None:
    """None when there is nothing to decompose — no previous revenue or no previous
    transactions means there is no movement to attribute, and inventing an attribution
    for a branch's first measured period would be worse than staying quiet."""
    if not previous_net_revenue or not previous_transaction_count or not transaction_count:
        return None

    basket = net_revenue / transaction_count
    previous_basket = previous_net_revenue / previous_transaction_count
    if not previous_basket:
        return None

    transaction_delta = transaction_count - previous_transaction_count
    basket_delta = basket - previous_basket

    transaction_effect = transaction_delta * previous_basket
    basket_effect = basket_delta * previous_transaction_count
    interaction_effect = transaction_delta * basket_delta

    combined = abs(transaction_effect) + abs(basket_effect)
    if combined == 0:
        dominant = "both"
    else:
        transaction_share = abs(transaction_effect) / combined
        if transaction_share >= DOMINANCE_SHARE:
            dominant = "transactions"
        elif transaction_share <= 1 - DOMINANCE_SHARE:
            dominant = "basket"
        else:
            dominant = "both"

    return RevenueChange(
        revenue_change=net_revenue - previous_net_revenue,
        revenue_growth_pct=(net_revenue - previous_net_revenue) / previous_net_revenue * 100,
        transaction_growth_pct=transaction_delta / previous_transaction_count * 100,
        basket_growth_pct=basket_delta / previous_basket * 100,
        transaction_effect=transaction_effect,
        basket_effect=basket_effect,
        interaction_effect=interaction_effect,
        dominant=dominant,
    )


def describe_revenue_change(change: RevenueChange) -> tuple[str, str]:
    """(driver, interpretation) for a revenue movement.

    The interpretation branches on the *signs* of the two effects, not just on which is
    bigger: when they pull in opposite directions, naming the larger one as "the cause"
    while ignoring that the other partly cancelled it would misdescribe what happened.
    """
    driver = (
        f"Transactions are {_direction(change.transaction_growth_pct)} "
        f"{abs(change.transaction_growth_pct):.1f}% and the average sale is "
        f"{_direction(change.basket_growth_pct)} {abs(change.basket_growth_pct):.1f}%."
    )

    transactions_hurt = change.transaction_effect < 0
    basket_hurt = change.basket_effect < 0

    # When the two effects oppose each other, revenue can still end up anywhere — so
    # these branches check the overall direction rather than assuming a fall. A branch
    # whose revenue held up purely because a bigger average sale covered for lost footfall is
    # in a genuinely different position from one whose revenue fell, and calling both
    # "the fall" would hide that.
    if transactions_hurt and not basket_hurt:
        interpretation = (
            "The fall is driven by fewer transactions — a larger average sale partly offset it. The branch "
            "served fewer people, rather than the same people spending less."
            if change.revenue_change < 0
            else "Revenue held up only because a larger average sale made up for the lost transactions — the "
            "branch is serving fewer people than it was."
        )
    elif basket_hurt and not transactions_hurt:
        interpretation = (
            "The fall is driven by a smaller average sale — more transactions partly offset it. Roughly as "
            "many people came in, but each spent less."
            if change.revenue_change < 0
            else "Revenue held up only because more transactions made up for a smaller average sale — each "
            "visit is worth less than it was."
        )
    elif transactions_hurt and basket_hurt:
        if change.dominant == "transactions":
            interpretation = (
                "Both are down, but fewer transactions account for most of the fall — this is a "
                "footfall problem first and an average-sale problem second."
            )
        elif change.dominant == "basket":
            interpretation = (
                "Both are down, but the smaller average sale accounts for most of the fall — people are "
                "still coming in, they are buying less each time."
            )
        else:
            interpretation = (
                "Fewer transactions and a smaller average sale are contributing roughly equally, so neither "
                "one on its own explains the fall."
            )
    else:
        interpretation = "Both transactions and the average sale moved in the branch's favour this period."

    return driver, interpretation


@dataclass(frozen=True)
class MarginChange:
    margin_change_pp: float
    revenue_growth_pct: float
    cogs_growth_pct: float
    # costs_rose_while_sales_fell | costs_outpaced_sales | sales_fell_faster_than_costs |
    # mixed — which side of the margin moved.
    cause: str


def decompose_margin_change(
    gross_margin_pct: float | None,
    previous_gross_margin_pct: float | None,
    net_revenue: float,
    previous_net_revenue: float,
    estimated_cogs: float,
    previous_estimated_cogs: float,
) -> MarginChange | None:
    """Margin is a ratio, so "what moved it" is really a race between two growth rates:
    what the branch sold for, and what it paid for what it sold. Comparing those two
    directly says more than any algebraic split of the ratio itself would."""
    if (
        gross_margin_pct is None
        or previous_gross_margin_pct is None
        or not previous_net_revenue
        or not previous_estimated_cogs
    ):
        return None

    revenue_growth = (net_revenue - previous_net_revenue) / previous_net_revenue * 100
    cogs_growth = (estimated_cogs - previous_estimated_cogs) / previous_estimated_cogs * 100

    if cogs_growth > 0 and revenue_growth <= 0:
        cause = "costs_rose_while_sales_fell"
    elif cogs_growth > revenue_growth > 0:
        cause = "costs_outpaced_sales"
    elif cogs_growth <= 0 and revenue_growth < cogs_growth:
        cause = "sales_fell_faster_than_costs"
    else:
        cause = "mixed"

    return MarginChange(
        margin_change_pp=gross_margin_pct - previous_gross_margin_pct,
        revenue_growth_pct=revenue_growth,
        cogs_growth_pct=cogs_growth,
        cause=cause,
    )


_MARGIN_INTERPRETATION = {
    "costs_rose_while_sales_fell": (
        "Both sides moved against the margin: what the branch pays for stock went up while what "
        "it sells went down."
    ),
    "costs_outpaced_sales": (
        "Costs grew faster than sales, so the branch is selling more without keeping more of it — "
        "that points at buying prices or the mix of what sold, not at demand."
    ),
    "sales_fell_faster_than_costs": (
        "Costs came down too, just not as fast — that points at selling prices or the mix of what "
        "sold, rather than at what the branch is paying suppliers."
    ),
    "mixed": "Revenue and cost of goods both moved, without either side clearly leading.",
}


def describe_margin_change(change: MarginChange) -> tuple[str, str]:
    driver = (
        f"Revenue is {_direction(change.revenue_growth_pct)} {abs(change.revenue_growth_pct):.1f}% "
        f"and cost of goods is {_direction(change.cogs_growth_pct)} {abs(change.cogs_growth_pct):.1f}%."
    )
    return driver, _MARGIN_INTERPRETATION[change.cause]


def describe_margin_level(
    gross_margin_pct: float, previous_gross_margin_pct: float | None
) -> tuple[str | None, str | None]:
    """Why a margin *level* is low — a different question from why one moved.

    The useful distinction for a manager is whether this is new. A margin that has been
    thin for months is a pricing or product-mix decision to revisit; one that was
    healthy last period is an event to investigate.
    """
    if previous_gross_margin_pct is None:
        return None, None
    change = gross_margin_pct - previous_gross_margin_pct
    if abs(change) < MARGIN_DRIFT_PP:
        return (
            f"Margin was {previous_gross_margin_pct:.1f}% on the same days last year as well.",
            "This is a standing level rather than a new drop — it points at pricing and product "
            "mix rather than at anything that happened this period.",
        )
    if change < 0:
        return (
            f"Margin fell {abs(change):.1f}%, from "
            f"{previous_gross_margin_pct:.1f}% to {gross_margin_pct:.1f}%.",
            "This is a recent move, so it is worth finding what changed this period rather than "
            "treating it as the branch's normal level.",
        )
    return (
        f"Margin has risen {change:.1f}% from {previous_gross_margin_pct:.1f}%.",
        "It is improving, but still below the level this business treats as healthy.",
    )


# --- Stock risk -----------------------------------------------------------------------

# How much faster than its own earlier rate a product must be selling before the risk is
# called demand-driven. Set above 1.0 with room to spare: retail sales are lumpy, and a
# product 5% above its two-month average has not had a demand change worth a different
# reorder decision.
DEMAND_SPIKE_RATIO = 1.3


@dataclass(frozen=True)
class StockRisk:
    at_risk_count: int
    demand_driven_count: int
    leading_stock_code: str
    leading_description: str
    leading_days_left: float
    # None when the product sold nothing at all in the earlier window — demand that is
    # entirely new, rather than demand that grew.
    leading_demand_ratio: float | None
    # demand | drawdown | mixed
    cause: str


def classify_stock_risk(
    at_risk_count: int, demand_driven_count: int, leading_item: dict | None
) -> StockRisk | None:
    """Why products are about to run out: days left = on hand ÷ recent selling rate, so
    a product hits the threshold either because its stock fell or because its sales
    rose. Those call for different responses — reorder sooner, versus reorder more —
    which is the whole reason this distinction is worth computing."""
    if at_risk_count <= 0 or leading_item is None:
        return None

    share = demand_driven_count / at_risk_count
    if share >= DOMINANCE_SHARE:
        cause = "demand"
    elif share <= 1 - DOMINANCE_SHARE:
        cause = "drawdown"
    else:
        cause = "mixed"

    return StockRisk(
        at_risk_count=at_risk_count,
        demand_driven_count=demand_driven_count,
        leading_stock_code=leading_item["stock_code"],
        leading_description=leading_item["description"],
        leading_days_left=leading_item["days_left"],
        leading_demand_ratio=leading_item["demand_ratio"],
        cause=cause,
    )


_STOCK_RISK_INTERPRETATION = {
    "demand": (
        "Stock is running out because sales sped up, not because it was left to run down — so "
        "reorder in larger quantities, not just sooner."
    ),
    "drawdown": (
        "Sales are at their usual rate and the stock has simply been allowed to run down, so this "
        "is a reorder-timing problem rather than a change in demand."
    ),
    "mixed": (
        "Some are selling faster than they were and some have simply run down, so the reorder "
        "quantities are worth checking product by product rather than as one batch."
    ),
}


def describe_stock_risk(risk: StockRisk) -> tuple[str, str]:
    if risk.leading_demand_ratio is None:
        pace = "with nothing sold at all in the two months before that"
    else:
        pace = f"selling {risk.leading_demand_ratio:.1f}× its earlier rate"
    # "0 of the 1 at-risk products are" is technically the count and reads like a
    # spreadsheet. Each of these says the same fact in the way a person would — and with
    # only one product at risk there is no tally worth stating and nothing to be "most
    # urgent" than.
    if risk.at_risk_count == 1:
        return (
            f"{risk.leading_stock_code} ({risk.leading_description}) has "
            f"{risk.leading_days_left:.1f} days left, {pace}.",
            _STOCK_RISK_INTERPRETATION[risk.cause],
        )
    if risk.demand_driven_count == 0:
        tally = f"None of the {risk.at_risk_count} at-risk products are selling faster than before."
    elif risk.demand_driven_count == risk.at_risk_count:
        tally = f"All {risk.at_risk_count} at-risk products are selling faster than they were."
    else:
        verb = "is" if risk.demand_driven_count == 1 else "are"
        tally = (
            f"{risk.demand_driven_count} of the {risk.at_risk_count} at-risk products {verb} "
            "selling faster than before."
        )
    driver = (
        f"{tally} The most urgent is {risk.leading_stock_code} ({risk.leading_description}), "
        f"{risk.leading_days_left:.1f} days left and {pace}."
    )

    return driver, _STOCK_RISK_INTERPRETATION[risk.cause]
