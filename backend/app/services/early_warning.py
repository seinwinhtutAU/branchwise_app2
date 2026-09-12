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

**Three severities, only two of which ask for anything.** The axis is whether the alert
**requires a decision**, not how fast someone should move. `critical` requires a decision
now, `warning` requires one but the business chooses when to make it, and `normal`
requires no decision at all — a movement drifting the wrong way that is only there so it
can be seen starting: a margin down a point, a product with a fortnight of cover left.
The reason a third level does not turn the page into noise is that nothing counts it: the
nav badge, the branch tiles and the Overview cards all count criticals and warnings only,
so the number a manager reacts to still means "decisions waiting", while the list itself
can show the drift that produced no alert at all before.

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
    STOCK_VELOCITY_WINDOW_DAYS,
    WATCH_DAYS_OF_STOCK,
)

CRITICAL = "critical"
WARNING = "warning"
NORMAL = "normal"

# Sort order only, not a score: a decision now, then a decision whose timing is yours,
# then the notices that require no decision at all. `normal` earns its place because it is never counted — see the module
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
    # The alert detail panel, as data.
    #
    # `chips` above was built for a glanceable summary; what the business
    # actually asked for is the figures themselves, laid out and labelled, so the reader
    # can check the claim rather than take it. These three carry that:
    #
    # `context`: the days behind the alert — "9 Aug – 7 Sep 2026 vs 10 Jul – 8 Aug 2026",
    #   or, for the stock rules, the count date and the sales window, because those
    #   rules deliberately ignore the period on screen.
    # `facts`: labelled rows. Either a single value ({label, value}) or a movement
    #   ({label, before, after, change}). Preformatted strings, because the sentences
    #   beside them are built here too and the two must never disagree about rounding.
    # `table`: the products behind an alert that is about a list rather than a number —
    #   {columns: [{label, align}], rows: [[cell, ...]], note}.
    context: str | None = None
    facts: tuple[dict, ...] = ()
    table: dict | None = None


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


# --- The detail panel's figures -------------------------------------------------------
#
# Everything here formats for a shop owner, not a developer: whole Kyat, whole units, one
# decimal on a percentage, and no per-day rates — this business sells shoes, so "0.17 a
# day" describes nothing anyone in the shop would recognise.

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _ks(amount: float) -> str:
    return f"Ks {amount:,.0f}"


def _ks_change(amount: float) -> str:
    """The sign goes in front of the whole amount — "−Ks 1,175,057" — rather than inside
    it, where "Ks -1,175,057" reads like a typo."""
    return f"{'−' if amount < 0 else '+'}{_ks(abs(amount))}"


def _minus(text: str) -> str:
    """A real minus sign, not a hyphen. Both appear in the same column of the same table
    ("−Ks 1,175,057" beside "-5.6%") and the difference is visible."""
    return text.replace("-", "\u2212")


def _pct(value: float) -> str:
    return _minus(f"{value:.1f}%")


def _signed_pct(value: float) -> str:
    return _minus(f"{value:+.1f}%")


def _day(iso: str) -> str:
    """"2026-09-07" -> "7 Sep". The year is stated once, at the end of the range."""
    year, month, day = (int(part) for part in iso.split("-"))
    return f"{day} {_MONTHS[month - 1]}"


def _date_range(start: str | None, end: str | None) -> str | None:
    if not start or not end:
        return None
    return f"{_day(start)} – {_day(end)} {end.split('-')[0]}"


def _period_context(snapshot: BranchSnapshot) -> str | None:
    """The two stretches being compared, for the rules that follow the period on screen."""
    current = _date_range(snapshot.date_from, snapshot.date_to)
    previous = _date_range(snapshot.previous_date_from, snapshot.previous_date_to)
    if current is None:
        return None
    return f"{current} vs {previous}" if previous else current


def _stock_context(snapshot: BranchSnapshot) -> str:
    """Stock rules read the latest count and a fixed sales window, so they say so —
    they are the alerts the period control does *not* move, and a reader comparing them
    against a July period would otherwise have no way to know that."""
    counted_phrase = f"stock count of {_day(snapshot.stock_as_of[:10])}" if snapshot.stock_as_of else "latest stock count"
    return f"{counted_phrase} · sold in the last {STOCK_VELOCITY_WINDOW_DAYS} days"


def _fact(label: str, value: str | None) -> dict | None:
    """One labelled figure. None value means it could not be measured, and an unmeasured
    figure is left out rather than shown as a zero — the same rule the score follows."""
    return None if value is None else {"label": label, "value": value}


def _movement(
    label: str,
    before: str | None,
    after: str,
    change: str | None,
    delta: float | None = None,
    higher_is_better: bool = True,
) -> dict:
    """A figure and what it was before it moved, plus whether the move was good news.

    The direction alone cannot be coloured: sales rising is good, cost of goods rising is
    not, and a panel that paints "+14.1%" green because it is positive tells the reader
    the opposite of what happened. Only the rule knows which way is up for its own figure,
    so it says so here and the UI just renders the verdict.
    """
    tone = None
    direction = None
    if delta is not None and change is not None and delta != 0:
        tone = "good" if (delta > 0) == higher_is_better else "bad"
        # Which way it moved, kept separate from whether that was good: the panel draws an
        # arrow for the direction and colours it by the verdict, so cost of goods rising
        # reads as an up arrow in red rather than as a plus sign in green.
        direction = "up" if delta > 0 else "down"
    return {
        "label": label,
        "before": before,
        "after": after,
        "change": change,
        "tone": tone,
        "direction": direction,
    }


def _facts(*facts: dict | None) -> tuple[dict, ...]:
    return tuple(fact for fact in facts if fact is not None)


def _low_stock_table(snapshot: BranchSnapshot) -> dict | None:
    """The products behind a stock alert, with the two numbers the shop can verify on the
    shelf and one it cannot: how many are there, how many sold, how long that lasts.

    Days left is rounded to whole days on purpose. Half a day is below the precision of a
    once-a-day stock count, and nobody orders differently for 6.4 days than for 6.
    """
    if not snapshot.at_risk_top_items:
        return None
    rows = [
        [
            f"{item['stock_code']} · {item['description']}",
            f"{item['on_hand_qty']:,.0f}",
            f"{item['sold_recent_qty']:,.0f}",
            f"{item['days_left']:.0f} days",
        ]
        for item in snapshot.at_risk_top_items
    ]
    hidden = snapshot.at_risk_count - len(rows)
    return {
        "columns": [
            {"label": "Product", "align": "left"},
            {"label": "In shop", "align": "right"},
            {"label": f"Sold {STOCK_VELOCITY_WINDOW_DAYS}d", "align": "right"},
            {"label": "Lasts", "align": "right"},
        ],
        "rows": rows,
        # The shortlist is capped, and a manager who sees five rows under a count of
        # eighty should be told the rest are on the Inventory tab, not left to assume.
        "note": f"{hidden} more on the Inventory tab" if hidden > 0 else None,
    }


def _sales_facts(snapshot: BranchSnapshot) -> tuple[dict, ...]:
    """What a sales or footfall alert is made of: the money, the people, and what each
    person spent. Every one of the three is a movement, because that is the claim."""
    revenue_growth = _growth(snapshot.net_revenue, snapshot.previous_net_revenue)
    transaction_growth = _growth(snapshot.transaction_count, snapshot.previous_transaction_count)
    basket_growth = _growth(snapshot.avg_basket, snapshot.previous_avg_basket)
    return _facts(
        _movement(
            "Sales",
            _ks(snapshot.previous_net_revenue) if snapshot.previous_net_revenue else None,
            _ks(snapshot.net_revenue),
            _signed_pct(revenue_growth) if revenue_growth is not None else None,
            revenue_growth,
        ),
        _movement(
            "Customers served",
            f"{snapshot.previous_transaction_count:,}" if snapshot.previous_transaction_count else None,
            f"{snapshot.transaction_count:,}",
            _signed_pct(transaction_growth) if transaction_growth is not None else None,
            transaction_growth,
        ),
        _movement(
            "Average sale",
            _ks(snapshot.previous_avg_basket) if snapshot.previous_avg_basket else None,
            _ks(snapshot.avg_basket),
            _signed_pct(basket_growth) if basket_growth is not None else None,
            basket_growth,
        ),
    )


def _margin_facts(snapshot: BranchSnapshot) -> tuple[dict, ...]:
    """The margin, shown as the subtraction it is: what came in, what the goods cost, and
    what was left. A percentage alone is the one number a shop owner cannot check."""
    kept = snapshot.net_revenue - snapshot.estimated_cogs
    previous_kept = snapshot.previous_net_revenue - snapshot.previous_estimated_cogs
    comparable = (
        snapshot.previous_gross_margin_pct is not None
        and snapshot.previous_cost_coverage_pct >= MIN_COST_COVERAGE_PCT
    )
    revenue_growth = _growth(snapshot.net_revenue, snapshot.previous_net_revenue)
    cogs_growth = _growth(snapshot.estimated_cogs, snapshot.previous_estimated_cogs)
    return _facts(
        _movement(
            "Sales",
            _ks(snapshot.previous_net_revenue) if comparable else None,
            _ks(snapshot.net_revenue),
            _signed_pct(revenue_growth) if comparable and revenue_growth is not None else None,
            revenue_growth if comparable else None,
        ),
        _movement(
            "Cost of goods",
            _ks(snapshot.previous_estimated_cogs) if comparable else None,
            _ks(snapshot.estimated_cogs),
            _signed_pct(cogs_growth) if comparable and cogs_growth is not None else None,
            cogs_growth if comparable else None,
            higher_is_better=False,
        ),
        _movement(
            "You keep",
            _ks(previous_kept) if comparable else None,
            _ks(kept),
            _ks_change(kept - previous_kept) if comparable else None,
            kept - previous_kept if comparable else None,
        ),
        _movement(
            "Margin",
            _pct(snapshot.previous_gross_margin_pct) if comparable else None,
            _pct(snapshot.gross_margin_pct or 0.0),
            _minus(f"{(snapshot.gross_margin_pct or 0.0) - snapshot.previous_gross_margin_pct:+.1f}%")
            if comparable
            else None,
            (snapshot.gross_margin_pct or 0.0) - snapshot.previous_gross_margin_pct
            if comparable
            else None,
        ),
    )


def _growth(current: float, previous: float) -> float | None:
    """None rather than 0 when there is nothing to grow from — see branch_health."""
    if not previous:
        return None
    return (current - previous) / previous * 100


def _stock_facts(snapshot: BranchSnapshot, count: int, days_threshold: int) -> tuple[dict, ...]:
    """The two lines above a stock table: how many products, and which one goes first."""
    leading = snapshot.at_risk_leading_item
    return _facts(
        _fact("Products affected", f"{count:,} of {snapshot.sku_count:,}"),
        _fact("We flag under", f"{days_threshold} days"),
        _fact(
            "Soonest to run out",
            f"{leading['stock_code']} · {leading['description']} — {leading['days_left']:.0f} days"
            if leading and count > 1
            else None,
        ),
    )


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
            context=_period_context(snapshot),
            facts=_sales_facts(snapshot),
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
                context=_period_context(snapshot),
                facts=_margin_facts(snapshot),
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
            summary=f"Margin down {abs(change):.1f}%",
            severity=slip_severity,
            dimension="profit",
            title=(
                "Margin lower than last period"
                if slip_severity == WARNING
                else "Margin a little lower than last period"
            ),
            what_happened=(
                f"Estimated gross margin fell {abs(change):.1f}% against "
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
            context=_period_context(snapshot),
            facts=_margin_facts(snapshot),
        )
    ]


def _stock_why(count: int, days_threshold: int) -> tuple[str, None]:
    """Why a stock alert fired, in one sentence.

    This deliberately does *not* split the products into "selling faster" and "simply run
    down". The engine can measure that split and once said it here, but the business asked
    for it to go: with shoe-shop volumes the comparison rests on a handful of sales, and
    the sentence it produced ("selling 0.6× its earlier rate") read as a claim far firmer
    than the evidence under it. What is left is the part that is solidly measured — how
    much is on the shelf, how much sold, and how long that lasts.
    """
    subject = "this has" if count == 1 else "each of these has"
    return (
        f"At the rate they sold this month, {subject} less than {days_threshold} days of "
        "stock left — the point where a product is worth putting on the next order.",
        None,
    )


def stockout_rule(snapshot: BranchSnapshot, thresholds: Thresholds) -> list[Alert]:

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
                driver=_stock_why(snapshot.critical_count, CRITICAL_DAYS_OF_STOCK)[0],
                interpretation=None,
                context=_stock_context(snapshot),
                facts=_stock_facts(snapshot, snapshot.critical_count, CRITICAL_DAYS_OF_STOCK),
                table=_low_stock_table(snapshot),
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
                driver=_stock_why(snapshot.low_count, LOW_DAYS_OF_STOCK)[0],
                interpretation=None,
                context=_stock_context(snapshot),
                facts=_stock_facts(snapshot, snapshot.low_count, LOW_DAYS_OF_STOCK),
                table=_low_stock_table(snapshot),
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
                driver=_stock_why(snapshot.watch_count, WATCH_DAYS_OF_STOCK)[0],
                interpretation=None,
                context=_stock_context(snapshot),
                facts=_stock_facts(snapshot, snapshot.watch_count, WATCH_DAYS_OF_STOCK),
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
            driver=(
                f"Stock that has not sold in {DEAD_STOCK_WINDOW_DAYS} days is money sitting "
                "still instead of turning over — and it is the stock most likely to be "
                "reordered out of habit."
            ),
            context=(
                f"stock count of {_day(snapshot.stock_as_of[:10])} · sales of the last "
                f"{DEAD_STOCK_WINDOW_DAYS} days"
                if snapshot.stock_as_of
                else f"latest stock count · sales of the last {DEAD_STOCK_WINDOW_DAYS} days"
            ),
            facts=_facts(
                _fact("Products not moving", f"{snapshot.dead_stock_count:,} of {snapshot.sku_count:,}"),
                _fact("Share of your products", _pct(share)),
                _fact("Not sold in", f"{DEAD_STOCK_WINDOW_DAYS} days or more"),
                _fact(
                    "Stock on hand worth",
                    f"{_ks(snapshot.estimated_stock_value)} (whole branch)"
                    if snapshot.estimated_stock_value
                    else None,
                ),
                _fact(
                    "Stock will last",
                    f"{snapshot.days_of_inventory_on_hand:,.0f} days at today's selling rate"
                    if snapshot.days_of_inventory_on_hand
                    else None,
                ),
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
            title="Fewer customers than before",
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
            # No revenue split on this one, at the business's request: this alert is about
            # people, and a bar chart of where the Kyat came from answers a question the
            # reader is not asking here. The four rows below carry what it is about —
            # sales, customers, average sale, items per sale.
            context=_period_context(snapshot),
            facts=_sales_facts(snapshot)
            + _facts(
                _movement(
                    "Items per sale",
                    f"{snapshot.previous_avg_items_per_basket:.2f}"
                    if snapshot.previous_avg_items_per_basket
                    else None,
                    f"{snapshot.avg_items_per_basket:.2f}",
                    _signed_pct(
                        _growth(snapshot.avg_items_per_basket, snapshot.previous_avg_items_per_basket)
                    )
                    if _growth(snapshot.avg_items_per_basket, snapshot.previous_avg_items_per_basket)
                    is not None
                    else None,
                    _growth(snapshot.avg_items_per_basket, snapshot.previous_avg_items_per_basket),
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
    data_quality_rule,
)


def evaluate(snapshot: BranchSnapshot, thresholds: Thresholds = DEFAULT_THRESHOLDS) -> list[Alert]:
    alerts = [alert for rule in RULES for alert in rule(snapshot, thresholds)]
    # Stable sort on severity alone, so registration order survives as the tiebreak.
    return sorted(alerts, key=lambda alert: _SEVERITY_RANK[alert.severity])


def build_alerts(snapshot: BranchSnapshot, thresholds: Thresholds = DEFAULT_THRESHOLDS) -> list[dict]:
    return [asdict(alert) for alert in evaluate(snapshot, thresholds)]
