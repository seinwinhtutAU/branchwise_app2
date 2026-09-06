"""Early Warning engine — the alert half of the Overview tab (see docs/branch_health.md).

The Branch Health Score answers "which part of this branch is unhealthy." This answers
the next question: **"what specifically is wrong, and what should I do about it?"** —
a severity-ranked list of named problems, each with the numbers behind it, a
recommended action, and the tab holding the evidence.

Three things shape the design:

**Rules are data, not control flow.** Each rule is a small pure function of
`(BranchSnapshot, Thresholds) -> list[Alert]`, registered in one `RULES` tuple.
Adding a check means appending a function; nothing else in the file changes. That is
also what makes the rule set presentable as a table rather than as a pile of ifs.

**One rule owns one subject.** A falling margin and a margin below the floor are the
same conversation, so a single margin rule reports whichever is worse rather than two
rules firing about one number and burying everything else. An alert list a manager
learns to skim is worthless.

**Three severities, only two of which ask for anything.** `critical` is act today,
`warning` is act soon, and `normal` is a movement drifting the wrong way that is not
worth doing anything about yet — a margin down a point, a product with a fortnight of
cover left. The reason a third level does not turn the page into noise is that nothing
counts it: the nav badge, the branch tiles and the Overview cards all count criticals
and warnings only, so the number a manager reacts to still means "things to act on",
while the list itself can show the drift that produced no alert at all before.

**Data-integrity alerts delegate to app/services/data_quality.py entirely**, down to
that check's own title and severity (carried on the snapshot as `data_issue_sections`).
This engine holds no second opinion about what counts as a data problem or how bad one
is — it just surfaces what the Warning page already found, scoped to this branch and
period, and links back to it.

Alerts are computed, never generated: every sentence below is a template filled with
figures from the snapshot. Nothing here asks a model what it thinks.
"""

from dataclasses import asdict, dataclass
from typing import Callable

from app.services import explanation
from app.services.branch_health import MIN_COST_COVERAGE_PCT, BranchSnapshot
from app.services.dashboard import (
    CRITICAL_DAYS_OF_STOCK,
    DEAD_STOCK_WINDOW_DAYS,
    LOW_DAYS_OF_STOCK,
    WATCH_DAYS_OF_STOCK,
)

CRITICAL = "critical"
WARNING = "warning"
NORMAL = "normal"

# Sort order only, not a score: act today, then act soon, then the notices that ask for
# nothing. `normal` earns its place because it is never counted — see the module
# docstring — so the list can carry a drift without inflating the number beside the nav
# item, which is what a third level usually breaks.
_SEVERITY_RANK = {CRITICAL: 0, WARNING: 1, NORMAL: 2}


@dataclass(frozen=True)
class Alert:
    id: str
    severity: str  # critical | warning | normal
    dimension: str  # matches a branch_health DIMENSIONS key
    title: str
    # A few words for the collapsed one-line row and the all-branches card — the Overview
    # page shows five to seven alerts at once, and `what_happened` is a full sentence, so
    # a list built from those is a wall of text nobody reads. This is the number that
    # matters, not a shortened version of the sentence.
    summary: str
    what_happened: str
    recommended_action: str
    # Which tab holds the evidence: revenue | cost | inventory | customer | warnings.
    # Same targets the Overview tab's dimension cards link to.
    link: str
    # The `SubMetric.key` this alert is about, so the Overview branch page can show it
    # inside that measure's own row — the alert explains the number sitting right there.
    # It can name a measure from a different dimension than the alert scores under:
    # traffic_decline is a Customer alert about the Sales dimension's transaction count,
    # and it belongs next to the figure it is talking about.
    measure: str
    # Why it happened, from app/services/explanation.py — arithmetic, not a model's
    # opinion. Left None by the rules with nothing to decompose (a dead-stock count has
    # no two components to split it into, and inventing a cause for one would be worse
    # than staying quiet).
    driver: str | None = None
    interpretation: str | None = None
    # The measured figures the sentences above were built from, carried out as data so
    # the UI can show them as chips and as a split — the same numbers, never a second
    # computation on the client (see docs/branch_health.md's "nothing is measured twice").
    # `chips`: the two or three figures that make the alert legible at a glance.
    # `evidence`: the decomposition behind it, for the "How this was worked out" panel —
    # None on the rules with nothing to decompose, exactly like `driver`.
    chips: tuple[dict, ...] = ()
    evidence: dict | None = None


@dataclass(frozen=True)
class Thresholds:
    """Every number a rule fires on, in one place.

    A frozen dataclass rather than loose module constants so Phase 5 can build one from
    `app_settings` and pass it straight through — the rules already take it as an
    argument, so making the thresholds business-tunable needs no change to any rule.
    """

    revenue_decline_normal_pct: float = -5.0
    revenue_decline_warning_pct: float = -10.0
    revenue_decline_critical_pct: float = -20.0
    low_margin_normal_pct: float = 15.0
    low_margin_warning_pct: float = 10.0
    low_margin_critical_pct: float = 5.0
    margin_slip_normal_pp: float = -1.0
    margin_slip_warning_pp: float = -3.0
    dead_stock_normal_share_pct: float = 5.0
    dead_stock_warning_share_pct: float = 10.0
    dead_stock_critical_share_pct: float = 25.0
    traffic_decline_warning_pct: float = -10.0
    single_item_basket_normal_share_pct: float = 45.0
    single_item_basket_warning_share_pct: float = 60.0


DEFAULT_THRESHOLDS = Thresholds()


def _products(count: int) -> str:
    """"1 product has" / "3 products have" — an alert that says "1 product(s) have" reads
    like a form letter, and a manager is being asked to act on it."""
    return "1 product has" if count == 1 else f"{count} products have"


def _count_products(count: int) -> str:
    """Just the noun phrase — `_products` bakes in a verb, which reads wrong in the
    few-word alert summary."""
    return "1 product" if count == 1 else f"{count} products"


def _its_their(count: int) -> str:
    return "its" if count == 1 else "their"


# One line per severity rather than a ternary chain inside the alert: the three titles
# are the same sentence at three strengths, and reading them together is how you check
# they still are.
_REVENUE_TITLE = {
    CRITICAL: "Revenue has fallen sharply",
    WARNING: "Revenue is falling",
    NORMAL: "Revenue is drifting down",
}


def _period_phrase(snapshot: BranchSnapshot) -> str:
    if snapshot.period_days == 1:
        return "the day before"
    return f"the previous {snapshot.period_days} days"


def _chip(label: str, value: float | None, unit: str) -> dict | None:
    """One figure for the row of chips. `unit` tells the UI how to render and colour it:
    `pct_change`/`pct_points` are movements (signed, with a direction), `pct` and `count`
    are levels. A value that could not be measured produces no chip at all rather than a
    zero — the same rule the score itself follows."""
    if value is None:
        return None
    return {"label": label, "value": round(float(value), 2), "unit": unit}


def _chips(*chips: dict | None) -> tuple[dict, ...]:
    return tuple(chip for chip in chips if chip is not None)


def _revenue_evidence(change: explanation.RevenueChange, snapshot: BranchSnapshot) -> dict:
    """The revenue split as data. The three parts sum to `total_change` exactly (there is
    a test on that property in test_explanation.py), which is the whole reason this can be
    shown as evidence rather than as an opinion."""
    return {
        "kind": "revenue_split",
        "from_total": snapshot.previous_net_revenue,
        "to_total": snapshot.net_revenue,
        "total_change": change.revenue_change,
        "parts": [
            {"label": "Fewer transactions" if change.transaction_effect < 0 else "More transactions",
             "amount": round(change.transaction_effect, 2)},
            {"label": "Smaller average sale" if change.basket_effect < 0 else "Bigger average sale",
             "amount": round(change.basket_effect, 2)},
            {"label": "Both at once", "amount": round(change.interaction_effect, 2)},
        ],
    }


# --- Rules ----------------------------------------------------------------------------


def revenue_rule(snapshot: BranchSnapshot, thresholds: Thresholds) -> list[Alert]:
    """Revenue movement, including the case that matters most and looks least like a
    business problem: nothing at all was recorded."""
    # A period with no sales at all, after a period that had them, is almost always a
    # missing import rather than a branch that sold nothing — so it says that, instead
    # of reporting a 100% collapse and sending someone to investigate the shop floor.
    if snapshot.net_revenue == 0 and snapshot.previous_net_revenue > 0:
        return [
            Alert(
                id="no_sales_recorded",
                measure="revenue_growth_pct",
                summary=f"No sales in the last {snapshot.period_days} days",
                severity=CRITICAL,
                dimension="sales",
                title="No sales recorded in this period",
                what_happened=(
                    f"Not a single sale is recorded for this branch in this period, after "
                    f"{_period_phrase(snapshot)} had sales."
                ),
                recommended_action=(
                    "Check Import History for this branch — this period's sales file has most "
                    "likely not been imported yet. If it was imported and later reverted, "
                    "confirm the corrected file again."
                ),
                link="revenue",
            )
        ]

    if not snapshot.previous_net_revenue:
        return []
    growth = (snapshot.net_revenue - snapshot.previous_net_revenue) / snapshot.previous_net_revenue * 100
    if growth > thresholds.revenue_decline_normal_pct:
        return []

    if growth <= thresholds.revenue_decline_critical_pct:
        severity = CRITICAL
    elif growth <= thresholds.revenue_decline_warning_pct:
        severity = WARNING
    else:
        severity = NORMAL
    # Revenue = transactions x average basket, and that identity decomposes exactly —
    # so the alert can say which of the two actually caused the fall instead of leaving
    # the manager to guess. The two cases call for completely different responses.
    decomposed = explanation.decompose_revenue_change(
        snapshot.net_revenue,
        snapshot.previous_net_revenue,
        snapshot.transaction_count,
        snapshot.previous_transaction_count,
    )
    driver, interpretation = (
        explanation.describe_revenue_change(decomposed) if decomposed else (None, None)
    )
    return [
        Alert(
            id="revenue_decline",
            measure="revenue_growth_pct",
            summary=f"Revenue down {abs(growth):.1f}%",
            severity=severity,
            dimension="sales",
            title=_REVENUE_TITLE[severity],
            what_happened=(
                f"Net revenue is down {abs(growth):.1f}% against {_period_phrase(snapshot)}."
                + (
                    " That is a drift rather than a drop — it stays under the "
                    f"{abs(thresholds.revenue_decline_warning_pct):.0f}% fall this business treats "
                    "as a warning."
                    if severity == NORMAL
                    else ""
                )
            ),
            recommended_action=(
                "Nothing to act on yet. Worth reading the Revenue tab's daily trend to see whether "
                "this is one quiet week or the start of a run."
                if severity == NORMAL
                else "Open the Revenue tab and read the daily trend for when the drop started, then "
                "compare the top products against the previous period to see what stopped selling."
            ),
            link="revenue",
            driver=driver,
            interpretation=interpretation,
            chips=_chips(
                _chip("Transactions", decomposed.transaction_growth_pct if decomposed else None, "pct_change"),
                _chip("Average sale", decomposed.basket_growth_pct if decomposed else None, "pct_change"),
                _chip("Revenue", growth, "pct_change"),
            ),
            evidence=_revenue_evidence(decomposed, snapshot) if decomposed else None,
        )
    ]


def margin_rule(snapshot: BranchSnapshot, thresholds: Thresholds) -> list[Alert]:
    """One alert for the whole margin conversation — below the floor, or slipping."""
    # Same coverage gate the Profit score uses: an estimate covering a minority of
    # revenue isn't solid enough to raise an alarm a manager would act on.
    if snapshot.cost_coverage_pct < MIN_COST_COVERAGE_PCT or snapshot.gross_margin_pct is None:
        return []

    margin = snapshot.gross_margin_pct
    if margin < thresholds.low_margin_normal_pct:
        if margin < thresholds.low_margin_critical_pct:
            severity = CRITICAL
        elif margin < thresholds.low_margin_warning_pct:
            severity = WARNING
        else:
            severity = NORMAL
        # A low margin is a level, not a movement, so the useful "why" is whether it is
        # new: a margin thin for months is a pricing decision to revisit, one that was
        # healthy last period is an event to investigate.
        level_driver, level_interpretation = explanation.describe_margin_level(
            margin,
            snapshot.previous_gross_margin_pct
            if snapshot.previous_cost_coverage_pct >= MIN_COST_COVERAGE_PCT
            else None,
        )
        return [
            Alert(
                id="low_margin",
                measure="gross_margin_pct",
                summary=f"Margin at {margin:.1f}%",
                severity=severity,
                dimension="profit",
                title=(
                    "Margin is on the low side"
                    if severity == NORMAL
                    else "Margin is below a healthy level"
                ),
                what_happened=(
                    f"Estimated gross margin is {margin:.1f}%, on the low side but still above the "
                    f"{thresholds.low_margin_warning_pct:.0f}% level this business treats as a warning."
                    if severity == NORMAL
                    else f"Estimated gross margin is {margin:.1f}%, under the "
                    f"{thresholds.low_margin_warning_pct:.0f}% level this business treats as healthy."
                ),
                recommended_action=(
                    "Nothing to act on yet. Worth a look at the Cost tab's profit ranking to see "
                    "which products are holding it down."
                    if severity == NORMAL
                    else "Open the Cost tab's profit ranking — it is sorted by estimated profit, so the "
                    "products dragging the margin down sit at the bottom."
                ),
                link="cost",
                driver=level_driver,
                interpretation=level_interpretation,
                chips=_chips(
                    _chip("Gross margin", margin, "pct"),
                    _chip(
                        "Change",
                        margin - snapshot.previous_gross_margin_pct
                        if snapshot.previous_gross_margin_pct is not None
                        and snapshot.previous_cost_coverage_pct >= MIN_COST_COVERAGE_PCT
                        else None,
                        "pct_points",
                    ),
                ),
            )
        ]

    if (
        snapshot.previous_gross_margin_pct is None
        or snapshot.previous_cost_coverage_pct < MIN_COST_COVERAGE_PCT
    ):
        return []
    change = margin - snapshot.previous_gross_margin_pct
    if change > thresholds.margin_slip_normal_pp:
        return []
    slip_severity = WARNING if change <= thresholds.margin_slip_warning_pp else NORMAL
    # Margin is a ratio, so what moved it is a race between two growth rates: what the
    # branch sold for, and what it paid for what it sold.
    decomposed = explanation.decompose_margin_change(
        margin,
        snapshot.previous_gross_margin_pct,
        snapshot.net_revenue,
        snapshot.previous_net_revenue,
        snapshot.estimated_cogs,
        snapshot.previous_estimated_cogs,
    )
    driver, interpretation = (
        explanation.describe_margin_change(decomposed) if decomposed else (None, None)
    )
    return [
        Alert(
            id="margin_slipping",
            measure="margin_growth_pp",
            summary=f"Margin down {abs(change):.1f} points",
            severity=slip_severity,
            dimension="profit",
            title="Margin is slipping" if slip_severity == WARNING else "Margin has edged down",
            what_happened=(
                f"Estimated gross margin fell {abs(change):.1f} percentage points against "
                f"{_period_phrase(snapshot)}, from {snapshot.previous_gross_margin_pct:.1f}% to "
                f"{margin:.1f}%."
            ),
            recommended_action=(
                "Nothing to act on yet. The Cost tab's revenue-versus-cost chart shows whether it "
                "was costs rising or selling prices falling, if it keeps moving."
                if slip_severity == NORMAL
                else "Open the Cost tab's revenue-versus-cost chart to see whether costs rose or "
                "selling prices fell — the gap between the two lines is the margin."
            ),
            link="cost",
            driver=driver,
            interpretation=interpretation,
            chips=_chips(
                _chip("Gross margin", margin, "pct"),
                _chip("Change", change, "pct_points"),
            ),
        )
    ]


def stockout_rule(snapshot: BranchSnapshot, thresholds: Thresholds) -> list[Alert]:
    # Days left = on hand ÷ recent selling rate, so this decomposes like revenue does:
    # a product hits the threshold either because its stock fell or because its sales
    # rose, and the two call for different responses (reorder sooner vs. reorder more).
    risk = explanation.classify_stock_risk(
        snapshot.at_risk_count, snapshot.at_risk_demand_driven_count, snapshot.at_risk_leading_item
    )
    driver, interpretation = explanation.describe_stock_risk(risk) if risk else (None, None)

    if snapshot.critical_count > 0:
        return [
            Alert(
                id="stockout_risk",
                measure="stockout_risk_share_pct",
                summary=f"{_count_products(snapshot.critical_count)} nearly out of stock",
                severity=CRITICAL,
                dimension="inventory",
                title="Products are about to run out",
                what_happened=(
                    f"{_products(snapshot.critical_count)} {CRITICAL_DAYS_OF_STOCK} days of stock "
                    f"or less left at {_its_their(snapshot.critical_count)} recent selling rate."
                ),
                recommended_action=(
                    "Open the Inventory tab's low-stock table — it is sorted by days left, so the "
                    "products to reorder first are at the top."
                ),
                link="inventory",
                driver=driver,
                interpretation=interpretation,
                chips=_chips(
                    _chip("Products at risk", snapshot.critical_count, "count"),
                    _chip("Days of stock left", CRITICAL_DAYS_OF_STOCK, "days"),
                ),
            )
        ]
    if snapshot.low_count > 0:
        return [
            Alert(
                id="low_stock",
                measure="stockout_risk_share_pct",
                summary=f"{_count_products(snapshot.low_count)} running low",
                severity=WARNING,
                dimension="inventory",
                title="Stock is running low",
                what_happened=(
                    f"{_products(snapshot.low_count)} under {LOW_DAYS_OF_STOCK} days of stock left "
                    f"at {_its_their(snapshot.low_count)} recent selling rate."
                ),
                recommended_action="Open the Inventory tab's low-stock table and plan the next order.",
                link="inventory",
                driver=driver,
                interpretation=interpretation,
                chips=_chips(
                    _chip("Products running low", snapshot.low_count, "count"),
                    _chip("Days of stock left", LOW_DAYS_OF_STOCK, "days"),
                ),
            )
        ]
    if snapshot.watch_count > 0:
        return [
            Alert(
                id="watch_stock",
                measure="stockout_risk_share_pct",
                summary=f"{_count_products(snapshot.watch_count)} worth watching",
                severity=NORMAL,
                dimension="inventory",
                title="Stock worth keeping an eye on",
                what_happened=(
                    f"{_products(snapshot.watch_count)} between {LOW_DAYS_OF_STOCK} and "
                    f"{WATCH_DAYS_OF_STOCK} days of stock left at "
                    f"{_its_their(snapshot.watch_count)} recent selling rate — enough cover for now."
                ),
                recommended_action=(
                    "Nothing to order today. These are the products to include in the next "
                    "regular order rather than a special one."
                ),
                link="inventory",
                driver=driver,
                interpretation=interpretation,
                chips=_chips(
                    _chip("Products to watch", snapshot.watch_count, "count"),
                    _chip("Days of stock left", WATCH_DAYS_OF_STOCK, "days"),
                ),
            )
        ]
    return []


def dead_stock_rule(snapshot: BranchSnapshot, thresholds: Thresholds) -> list[Alert]:
    if not snapshot.sku_count or snapshot.dead_stock_count == 0:
        return []
    share = snapshot.dead_stock_count / snapshot.sku_count * 100
    if share < thresholds.dead_stock_normal_share_pct:
        return []
    if share >= thresholds.dead_stock_critical_share_pct:
        severity = CRITICAL
    elif share >= thresholds.dead_stock_warning_share_pct:
        severity = WARNING
    else:
        severity = NORMAL
    return [
        Alert(
            id="dead_stock",
            measure="dead_stock_share_pct",
            summary=f"{snapshot.dead_stock_count} of {snapshot.sku_count} products not moving",
            severity=severity,
            dimension="inventory",
            title=(
                "Some stock is not moving" if severity == NORMAL else "Too much stock is not moving"
            ),
            what_happened=(
                f"{snapshot.dead_stock_count} of {snapshot.sku_count} products ({share:.0f}%) still "
                f"have stock on the shelf but have not sold once in {DEAD_STOCK_WINDOW_DAYS} days."
                + (
                    " Every shop carries some, and this is within the share this business treats "
                    "as ordinary."
                    if severity == NORMAL
                    else ""
                )
            ),
            recommended_action=(
                "Nothing to act on yet. The Inventory tab's dead-stock table is worth a look "
                "before the next order, so these are not reordered."
                if severity == NORMAL
                else "Open the Inventory tab's dead-stock table. These are the candidates for a "
                "clearance price, and the ones not to reorder."
            ),
            link="inventory",
            chips=_chips(
                _chip("Not moving", snapshot.dead_stock_count, "count"),
                _chip("Share of products", share, "pct"),
            ),
        )
    ]


def traffic_rule(snapshot: BranchSnapshot, thresholds: Thresholds) -> list[Alert]:
    """Lost footfall that the revenue line is hiding.

    Fires only when revenue itself stayed quiet enough not to raise its own alert. When
    revenue *is* visibly falling, `revenue_rule` already decomposes it and says whether
    transactions or the average sale caused it — a second card repeating that same explanation would
    be the exact duplication this engine avoids elsewhere. What is left here is the
    genuinely hidden case: the headline looks fine because a bigger average sale covered for
    the customers who stopped coming.
    """
    if not snapshot.previous_transaction_count or not snapshot.previous_avg_basket:
        return []
    if not snapshot.previous_net_revenue:
        return []
    revenue_growth = (
        (snapshot.net_revenue - snapshot.previous_net_revenue) / snapshot.previous_net_revenue * 100
    )
    # Quiet means quiet enough that revenue_rule said nothing at all — including its
    # normal tier. Below that the fall is already on the page, decomposed into exactly
    # this explanation, and a second card repeating it is the duplication this engine
    # avoids everywhere else.
    if revenue_growth <= thresholds.revenue_decline_normal_pct:
        return []
    transaction_growth = (
        (snapshot.transaction_count - snapshot.previous_transaction_count)
        / snapshot.previous_transaction_count
        * 100
    )
    basket_growth = (snapshot.avg_basket - snapshot.previous_avg_basket) / snapshot.previous_avg_basket * 100
    if transaction_growth > thresholds.traffic_decline_warning_pct or basket_growth <= 0:
        return []
    # The headline says what the two movements did to revenue on net, and the
    # decomposition below says which of them won — otherwise this alert would just
    # restate its own driver line.
    decomposed = explanation.decompose_revenue_change(
        snapshot.net_revenue,
        snapshot.previous_net_revenue,
        snapshot.transaction_count,
        snapshot.previous_transaction_count,
    )
    driver, interpretation = (
        explanation.describe_revenue_change(decomposed) if decomposed else (None, None)
    )
    return [
        Alert(
            id="traffic_decline",
            measure="transaction_growth_pct",
            summary=f"Transactions down {abs(transaction_growth):.1f}%",
            severity=WARNING,
            dimension="customer",
            title="Losing customers behind a steady revenue line",
            what_happened=(
                f"Net revenue is {'up' if revenue_growth >= 0 else 'down'} "
                f"{abs(revenue_growth):.1f}% against {_period_phrase(snapshot)}, so the headline "
                "doesn't look alarming — but the two movements underneath it are pulling in "
                "opposite directions."
            ),
            recommended_action=(
                "Open the Customer tab's busy-hours heatmap to see which days and hours lost "
                "footfall — the shop is serving fewer people, not smaller orders."
            ),
            link="customer",
            driver=driver,
            interpretation=interpretation,
            chips=_chips(
                _chip("Transactions", transaction_growth, "pct_change"),
                _chip("Average sale", basket_growth, "pct_change"),
                _chip("Revenue", revenue_growth, "pct_change"),
            ),
            evidence=_revenue_evidence(decomposed, snapshot) if decomposed else None,
        )
    ]


def single_item_basket_rule(snapshot: BranchSnapshot, thresholds: Thresholds) -> list[Alert]:
    if not snapshot.transaction_count:
        return []
    share = snapshot.single_item_basket_share_pct
    if share < thresholds.single_item_basket_normal_share_pct:
        return []
    severity = (
        WARNING if share >= thresholds.single_item_basket_warning_share_pct else NORMAL
    )
    # Like a low margin, this is a level rather than a movement, so the "why" that
    # changes the decision is whether it is new: a branch that has always sold this way
    # has a layout question, one that jumped has an event to find.
    driver, interpretation = explanation.describe_basket_composition(
        share,
        snapshot.previous_single_item_basket_share_pct
        if snapshot.previous_transaction_count
        else None,
    )
    return [
        Alert(
            id="single_item_baskets",
            measure="single_item_basket_share_pct",
            summary=f"{share:.0f}% of transactions have one item",
            severity=severity,
            dimension="customer",
            title=(
                "Many transactions are a single item"
                if severity == NORMAL
                else "Most transactions are a single item"
            ),
            what_happened=f"{share:.0f}% of transactions in this period were a single line item.",
            recommended_action=(
                "Nothing to act on yet. The Customer tab's items-per-transaction histogram shows "
                "whether this is how the branch has always sold."
                if severity == NORMAL
                else "Open the Customer tab's items-per-transaction histogram. A high single-item share is "
                "usually a placement or bundling opportunity rather than a demand problem."
            ),
            link="customer",
            driver=driver,
            interpretation=interpretation,
            chips=_chips(
                _chip("Single-item transactions", share, "pct"),
                _chip(
                    "Change",
                    share - snapshot.previous_single_item_basket_share_pct
                    if snapshot.previous_transaction_count
                    else None,
                    "pct_points",
                ),
            ),
        )
    ]


def data_quality_rule(snapshot: BranchSnapshot, thresholds: Thresholds) -> list[Alert]:
    """One alert per Warning-page check that found something, carrying that check's own
    title and severity. See the module docstring: this engine holds no second opinion
    about what counts as a data problem."""
    return [
        Alert(
            id=f"data_quality_{section['id']}",
            severity=section["severity"],
            dimension="data_quality",
            title=section["title"],
            # A stock mismatch is the critical-count measure; everything else the Warning
            # page finds lands in the issue rate.
            measure=(
                "critical_data_issue_count"
                if section["severity"] == CRITICAL
                else "data_issue_rate_per_100"
            ),
            summary=f"{section['count']} row flagged" if section["count"] == 1 else f"{section['count']} rows flagged",
            what_happened=(
                f"{section['count']} {'row' if section['count'] == 1 else 'rows'} flagged. "
                f"{section['description']}"
            ),
            recommended_action=(
                "Open the Warning page for the affected rows. Most of these are fixed by reverting "
                "the import that carried them and confirming a corrected file."
            ),
            link="warnings",
        )
        for section in snapshot.data_issue_sections
    ]


Rule = Callable[[BranchSnapshot, Thresholds], list[Alert]]

# Registration order is the tiebreak within a severity, so it reads roughly worst-first
# for a manager: money, then stock, then shoppers, then the data underneath it all.
RULES: tuple[Rule, ...] = (
    revenue_rule,
    margin_rule,
    stockout_rule,
    dead_stock_rule,
    traffic_rule,
    single_item_basket_rule,
    data_quality_rule,
)


def evaluate(snapshot: BranchSnapshot, thresholds: Thresholds = DEFAULT_THRESHOLDS) -> list[Alert]:
    alerts = [alert for rule in RULES for alert in rule(snapshot, thresholds)]
    # Stable sort on severity alone, so registration order survives as the tiebreak.
    return sorted(alerts, key=lambda alert: _SEVERITY_RANK[alert.severity])


def build_alerts(snapshot: BranchSnapshot, thresholds: Thresholds = DEFAULT_THRESHOLDS) -> list[dict]:
    return [asdict(alert) for alert in evaluate(snapshot, thresholds)]
