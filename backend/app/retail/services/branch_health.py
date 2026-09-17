"""Branch Health Score — the scoring half of the Overview tab (see docs/branch_health.md).

Turns the numbers the four existing dashboard pillars already compute into one
0-100 score per dimension and one overall score, so a manager reads "Inventory 54,
critical" instead of opening four tabs and interpreting them by hand.

Two rules govern everything here:

1. **Nothing is measured twice.** Every raw number comes from the helpers in
   app/services/dashboard.py (and app/retail/services/data_quality.py) that the Revenue /
   Cost / Inventory / Customer tabs themselves use. Overview is a second reading of
   the same figures, never a second computation of them — if the score disagreed
   with the tab it links to, neither would be trusted again.

2. **A number that can't be known is None, never 0.** A branch with no
   previous-period sales has no computable growth; a branch whose products have no
   buying price has no computable margin. Scoring those as 0 would tell a manager
   their branch is failing when the truth is that it hasn't been measured. Instead
   the sub-metric drops out, the remaining weights in its dimension are
   re-normalised, and the response says which dimensions were dropped and why.

The bands and weights below are deliberately plain data rather than logic, so they
can be printed as a table, argued about, and (Phase 5) moved into app_settings for
the business to tune without a code change.
"""

from dataclasses import asdict, dataclass, field
from datetime import date
from types import SimpleNamespace
from typing import Callable

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.services import data_quality, explanation
from app.services.settings import get_branch_health_weights, get_early_warning_thresholds
from app.services.dashboard import (
    DEAD_STOCK_WINDOW_DAYS,
    LOW_DAYS_OF_STOCK,
    STOCK_VELOCITY_WINDOW_DAYS,
    PeriodKey,
    PeriodRange,
    _basket_stats,
    _cost_totals_and_products,
    _period_label,
    _revenue_totals,
    _stock_summary,
    resolve_period,
)

# Score >= HEALTHY reads green, >= NEEDS_ATTENTION amber, below that red. One place,
# so the gauge, the dimension bars and (later) the alerts can never disagree about
# what colour a 60 is.
HEALTHY_SCORE = 80.0
NEEDS_ATTENTION_SCORE = 60.0

# Profit is 25% of the overall score, and it rests entirely on estimated costs
# (app/retail/services/pricing.py's point-in-time buying price). Below this share of period
# revenue having any cost estimate at all, the margin figure describes a minority of
# the business and is not worth a quarter of the score — the dimension is dropped and
# the reason surfaced, rather than quietly scoring a guess.
MIN_COST_COVERAGE_PCT = 50.0

# How many at-risk products an alert names outright. Five is what fits in the alert panel
# without turning it into the Inventory tab's low-stock table, which is where the rest of
# them live and where the alert's own button goes.
AT_RISK_SHORTLIST_LIMIT = 5


def _ks(amount: float) -> str:
    """Money in the sentences below. Myanmar Kyat, no decimals — a shop manager reading
    "Ks 9,255,850" does not need the pyas."""
    return f"Ks {amount:,.0f}"


def health_status(score: float | None) -> str | None:
    if score is None:
        return None
    if score >= HEALTHY_SCORE:
        return "healthy"
    if score >= NEEDS_ATTENTION_SCORE:
        return "needs_attention"
    return "critical"


# --- The scoring table ---------------------------------------------------------------


@dataclass(frozen=True)
class SubMetric:
    """One measurable input to a dimension's score.

    `bands` is a list of (raw value, score) breakpoints in ascending value order;
    a value between two breakpoints is linearly interpolated, and a value outside
    the ends is clamped to the nearest one. Because the score is stated per
    breakpoint rather than derived from the value's direction, the same mechanism
    expresses "higher is better" (revenue growth), "lower is better" (dead stock)
    and "there is a healthy middle" (days of inventory on hand — too little stock
    is a stockout risk, too much is dead capital) without a special case for any
    of them.
    """

    key: str
    label: str
    unit: str  # pct | pct_change | pct_points | days | count | rate — how the frontend
    # formats it. pct_change is signed ("+12.3%") because a growth figure is only
    # readable with its direction attached; pct is a level ("30.0%"), which isn't.
    weight: float
    bands: tuple[tuple[float, float], ...]
    # One sentence saying what this measures, in the words a shop manager would use.
    # Shown on the Overview page next to the number, because a score nobody can trace
    # back to a definition is a number they have to take on faith.
    definition: str = ""
    # The same number again, as the figures it was worked out from — "312 of 629
    # products", "Ks 77,000,000 of stock ÷ Ks 687,000 sold per day". Returns None when
    # the inputs weren't measurable. Together with `bands` (which the page renders
    # directly, so the explanation is generated from the very table the score is
    # computed with) this answers all three questions a reader has: what it means, where
    # the number came from, and why that number scores what it does.
    calculation: Callable[["BranchSnapshot"], str | None] | None = field(
        default=None, compare=False
    )


@dataclass(frozen=True)
class Dimension:
    key: str
    label: str
    weight: float
    description: str
    sub_metrics: tuple[SubMetric, ...]


# Growth bands are shared by the three sales sub-metrics on purpose: a 10% fall in
# revenue and a 10% fall in transactions are equally bad news, so they should score
# the same. 0% growth scores 70, not 100 — flat is acceptable, not excellent.
_GROWTH_BANDS = ((-20.0, 0.0), (-10.0, 40.0), (0.0, 70.0), (10.0, 100.0))
_GENTLE_GROWTH_BANDS = ((-15.0, 0.0), (-5.0, 50.0), (0.0, 75.0), (5.0, 100.0))

DIMENSIONS: tuple[Dimension, ...] = (
    Dimension(
        key="sales",
        label="Sales",
        weight=0.25,
        description="Is the branch selling more than it was, and still selling across its range?",
        sub_metrics=(
            SubMetric(
                "revenue_growth_pct",
                "Revenue growth",
                "pct_change",
                0.5,
                _GROWTH_BANDS,
                definition="How much money the branch took in, against the period before it.",
                calculation=lambda s: f"{_ks(s.net_revenue)} this period, against {_ks(s.previous_net_revenue)} before.",
            ),
            SubMetric(
                "transaction_growth_pct",
                "Transaction growth",
                "pct_change",
                0.3,
                _GROWTH_BANDS,
                definition="How many transactions the branch made, against the period before it.",
                calculation=lambda s: (
                    f"{s.transaction_count:,} transactions this period, against "
                    f"{s.previous_transaction_count:,} before."
                ),
            ),
            # Related to the transaction count above but not the same question, and the
            # Customer dimension's transactions-per-open-day is a third: that one asks
            # how busy a normal day is, the one above asks whether the branch sold more
            # in total, and this asks whether it is still selling across its range.
            # Revenue holding up on a shrinking handful of products is a different
            # situation from revenue holding up across the shop, and only this tells
            # them apart.
            SubMetric(
                "products_sold_growth_pct",
                "Products sold",
                "pct_change",
                0.2,
                _GENTLE_GROWTH_BANDS,
                definition="How many different products actually sold, against the period before it.",
                calculation=lambda s: (
                    f"{s.products_sold:,} different products sold this period, against "
                    f"{s.previous_products_sold:,} before."
                ),
            ),
        ),
    ),
    Dimension(
        key="profit",
        label="Profit",
        weight=0.25,
        description="Is what the branch sells actually making money, and is that improving?",
        sub_metrics=(
            SubMetric(
                "gross_margin_pct",
                "Gross margin",
                "pct",
                0.6,
                ((0.0, 0.0), (10.0, 40.0), (20.0, 80.0), (30.0, 100.0)),
                definition="The share of each sale the branch keeps after paying for the goods it sold.",
                calculation=lambda s: (
                    f"{_ks(s.net_revenue - s.estimated_cogs)} kept out of {_ks(s.net_revenue)} sold "
                    f"(goods cost {_ks(s.estimated_cogs)})."
                    if s.net_revenue
                    else None
                ),
            ),
            SubMetric(
                "margin_growth_pp",
                "Margin change",
                "pct_points",
                0.4,
                ((-10.0, 0.0), (-3.0, 50.0), (0.0, 75.0), (3.0, 100.0)),
                definition="Whether the branch is keeping more or less of each sale than it was before.",
                calculation=lambda s: (
                    f"{s.gross_margin_pct:.1f}% this period, against {s.previous_gross_margin_pct:.1f}% before."
                    if s.gross_margin_pct is not None and s.previous_gross_margin_pct is not None
                    else None
                ),
            ),
        ),
    ),
    Dimension(
        key="inventory",
        label="Inventory",
        weight=0.25,
        description="Is stock moving, and is the branch about to run out of anything that sells?",
        sub_metrics=(
            SubMetric(
                "dead_stock_share_pct",
                "Dead stock share",
                "pct",
                0.4,
                ((0.0, 100.0), (5.0, 80.0), (15.0, 40.0), (30.0, 0.0)),
                definition=(
                    f"How much of the shop is products that are still on the shelf but have not sold "
                    f"once in {DEAD_STOCK_WINDOW_DAYS} days."
                ),
                calculation=lambda s: (
                    f"{s.dead_stock_count:,} of {s.sku_count:,} products with stock." if s.sku_count else None
                ),
            ),
            SubMetric(
                "stockout_risk_share_pct",
                "Stockout risk share",
                "pct",
                0.3,
                ((0.0, 100.0), (2.0, 85.0), (5.0, 60.0), (10.0, 20.0), (20.0, 0.0)),
                definition=(
                    f"How much of the shop is about to run out — under {LOW_DAYS_OF_STOCK} days of stock "
                    "left at how fast it has been selling."
                ),
                calculation=lambda s: (
                    f"{s.critical_count + s.low_count:,} of {s.sku_count:,} products "
                    f"({s.critical_count:,} critical, {s.low_count:,} low)."
                    if s.sku_count
                    else None
                ),
            ),
            SubMetric(
                "days_of_inventory_on_hand",
                "Days of inventory on hand",
                "days",
                0.3,
                # Both ends are bad: under two weeks of cover is a stockout waiting to
                # happen, over two months is cash sitting on a shelf.
                ((0.0, 50.0), (15.0, 90.0), (30.0, 100.0), (45.0, 85.0), (60.0, 60.0), (90.0, 30.0), (120.0, 0.0)),
                definition="How long the stock now on the shelf would last at the rate the branch is selling.",
                calculation=lambda s: (
                    f"{_ks(s.estimated_stock_value)} of stock ÷ "
                    f"{_ks(s.estimated_cogs / s.period_days)} of goods sold per day."
                    if s.period_days and s.estimated_cogs > 0 and s.estimated_stock_value > 0
                    else None
                ),
            ),
        ),
    ),
    Dimension(
        key="customer",
        label="Customer",
        weight=0.15,
        description="How busy is a normal trading day, and is a visit worth more than it was?",
        # Basket composition (items per transaction, single-item share) used to live here
        # and was dropped: this business sells shoes, and a customer buying one pair and
        # leaving is how the shop normally sells, not a problem to score.
        #
        # The two that replaced it are deliberately a pair. On its own, what a visit is
        # worth swung the whole dimension on one figure that moves with the mix of what
        # happened to sell that fortnight. Half each means neither a quiet spell of
        # cheaper pairs nor a slow week can take the dimension down alone.
        #
        # Still no raw transaction-count sub-metric: that is already 40% of the Sales
        # dimension. Sales *per open day* is a different question — how busy a normal
        # day is — and it is the half of it that survives a closed week or an import
        # that never arrived.
        sub_metrics=(
            SubMetric(
                "avg_basket_growth_pct",
                "Average sale value",
                "pct_change",
                0.5,
                _GENTLE_GROWTH_BANDS,
                definition="How much a customer spends in one transaction, against the period before.",
                calculation=lambda s: (
                    f"{_ks(s.avg_basket)} per transaction this period, against {_ks(s.previous_avg_basket)} before."
                ),
            ),
            SubMetric(
                "avg_daily_sales_growth_pct",
                "Transactions per day",
                "pct_change",
                0.5,
                _GENTLE_GROWTH_BANDS,
                definition="How many transactions the branch makes on a day it is open, against the period before.",
                calculation=lambda s: (
                    f"{s.transaction_count / s.trading_days:.1f} transactions a day this period "
                    f"({s.transaction_count:,} over {s.trading_days:,} open days), against "
                    f"{s.previous_transaction_count / s.previous_trading_days:.1f} before."
                    if s.trading_days and s.previous_trading_days
                    else None
                ),
            ),
        ),
    ),
    Dimension(
        key="data_quality",
        label="Data Quality",
        weight=0.10,
        description="Can the four scores above be trusted — is the underlying imported data clean?",
        sub_metrics=(
            SubMetric(
                "data_issue_rate_per_100",
                "Issues per 100 records",
                "rate",
                0.7,
                ((0.0, 100.0), (1.0, 80.0), (3.0, 50.0), (10.0, 10.0), (20.0, 0.0)),
                definition="How many of the imported records the Warning page found something wrong with.",
                calculation=lambda s: (
                    f"{s.data_issue_count:,} problems across {s.records_checked:,} sale, purchase and "
                    "stock records."
                    if s.records_checked
                    else None
                ),
            ),
            SubMetric(
                "critical_data_issue_count",
                "Stock mismatches",
                "count",
                0.3,
                ((0.0, 100.0), (1.0, 70.0), (5.0, 30.0), (20.0, 0.0)),
                definition=(
                    "Products whose counted stock doesn't match what it should be "
                    "(last count + purchases − sales)."
                ),
                calculation=lambda s: f"{s.critical_data_issue_count:,} products don't add up.",
            ),
        ),
    ),
)


def score_from_bands(value: float, bands: tuple[tuple[float, float], ...]) -> float:
    """Linear interpolation between breakpoints, clamped at both ends."""
    if value <= bands[0][0]:
        return bands[0][1]
    if value >= bands[-1][0]:
        return bands[-1][1]
    for (low_value, low_score), (high_value, high_score) in zip(bands, bands[1:]):
        if low_value <= value <= high_value:
            span = high_value - low_value
            if span == 0:
                return high_score
            return low_score + (high_score - low_score) * (value - low_value) / span
    return bands[-1][1]  # unreachable given the clamps above, but never return None


# --- The snapshot --------------------------------------------------------------------


@dataclass(frozen=True)
class BranchSnapshot:
    """Every raw number the scores and (Phase 3) the alerts are derived from.

    Returned to the client alongside the scores so that no figure on the Overview
    page is unexplained — "Inventory 54" is only useful if you can see the 323
    dead-stock SKUs behind it.
    """

    # Sales
    net_revenue: float
    previous_net_revenue: float
    transaction_count: int
    previous_transaction_count: int
    avg_basket: float
    previous_avg_basket: float
    # Profit
    estimated_cogs: float
    previous_estimated_cogs: float
    gross_margin_pct: float | None
    previous_gross_margin_pct: float | None
    cost_coverage_pct: float
    previous_cost_coverage_pct: float
    # Inventory
    sku_count: int
    critical_count: int
    low_count: int
    watch_count: int
    dead_stock_count: int
    estimated_stock_value: float
    days_of_inventory_on_hand: float | None
    stock_as_of: str | None
    # Days left = on hand ÷ recent selling rate, so a product about to run out got there
    # either because its stock fell or because its sales rose. These three carry enough
    # to tell those apart (see explanation.classify_stock_risk) without putting the
    # whole low-stock table on this payload — that table already belongs to the
    # Inventory tab, and the Overview only needs to explain it, not repeat it.
    at_risk_count: int
    at_risk_demand_driven_count: int
    at_risk_leading_item: dict | None
    # The few most urgent of those, so an alert can hand over a shortlist instead of a
    # count: "80 products are low" is true and unactionable, and nobody reorders eighty
    # lines off one sentence. Capped at AT_RISK_SHORTLIST_LIMIT — the rest stay on the
    # Inventory tab, which is what the alert's button opens.
    at_risk_top_items: tuple[dict, ...]
    # Customer
    avg_items_per_basket: float
    previous_avg_items_per_basket: float
    single_item_basket_share_pct: float
    previous_single_item_basket_share_pct: float
    # Days the branch actually sold anything, not days on the calendar. Sales ÷ trading
    # days is what makes "how busy is a normal day here" comparable across periods that
    # contain a different number of closed days — and it is why a week the shop was shut
    # doesn't read as customers walking away.
    trading_days: int
    previous_trading_days: int
    # Distinct products that actually sold. A branch can hold its revenue while its
    # range quietly narrows to a few lines, and nothing else on the snapshot notices.
    products_sold: int
    previous_products_sold: int
    # Data quality
    data_issue_count: int
    critical_data_issue_count: int
    # One entry per Warning-page check that actually found something, carrying that
    # check's own id, title and severity rather than a re-description of it — so the
    # early-warning rules can raise a data-integrity alert without a second opinion
    # about what counts as an integrity problem or how bad it is. Counts only; the
    # rows themselves belong to the Warning page.
    data_issue_sections: tuple[dict, ...]
    records_checked: int
    period_days: int
    # The days behind every figure above, as ISO dates. Carried so an alert can say
    # which stretch it is describing and which one it compares against — a manager
    # reading "margin fell 3.5%" needs to know 3.5% since *when*.
    # Optional so a hand-built snapshot (the tests, and any caller that only wants a
    # score) stays a few keywords rather than a date-keeping exercise; an alert with no
    # dates simply omits the line naming them.
    date_from: str | None = None
    date_to: str | None = None
    previous_date_from: str | None = None
    previous_date_to: str | None = None


def _growth_pct(current: float, previous: float) -> float | None:
    """None, not 0, when there is no previous figure to grow from — see the module
    docstring. A branch's first-ever imported week has no growth, and saying "0%"
    would score it as merely flat rather than unmeasured."""
    if not previous:
        return None
    return (current - previous) / previous * 100


def _margin_pct(net_revenue: float, cogs: float) -> float | None:
    if not net_revenue:
        return None
    return (net_revenue - cogs) / net_revenue * 100


def _coverage_pct(priced_net_revenue: float, net_revenue: float) -> float:
    if not net_revenue:
        return 0.0
    return priced_net_revenue / net_revenue * 100


def _trading_days(db: Session, branch_id: str, start: date, end: date) -> int:
    """Days in the window that carry at least one sale. Deliberately not the calendar
    length of the period: a branch closed for a public holiday, or one whose file for a
    day was never imported, should not look like a branch nobody visited."""
    return (
        db.query(func.count(func.distinct(Sale.sale_date)))
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .scalar()
        or 0
    )


def _products_sold(db: Session, branch_id: str, start: date, end: date) -> int:
    """Distinct products with at least one sale line in the window — the breadth of what
    the branch actually sold, not how much of it."""
    return (
        db.query(func.count(func.distinct(SaleLine.product_id)))
        .join(Sale, SaleLine.sale_id == Sale.id)
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .scalar()
        or 0
    )


def _line_counts(db: Session, branch_id: str, start: date, end: date) -> int:
    """Sale + purchase lines imported for this branch in the window — the denominator
    that turns a raw warning count into a rate. 40 warnings out of 200 rows and 40 out
    of 40,000 are very different situations, and only the rate distinguishes them."""
    sale_lines = (
        db.query(func.count(SaleLine.id))
        .join(Sale, SaleLine.sale_id == Sale.id)
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .scalar()
        or 0
    )
    purchase_lines = (
        db.query(func.count(PurchaseLine.id))
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .filter(
            Purchase.branch_id == branch_id,
            Purchase.purchase_date >= start,
            Purchase.purchase_date <= end,
        )
        .scalar()
        or 0
    )
    return int(sale_lines) + int(purchase_lines)


def _summarise_stock_risk(
    low_stock_items: list[dict],
) -> tuple[int, int, dict | None, tuple[dict, ...]]:
    """Count how many products at risk of running out are doing so because they sped up,
    name the most urgent one, and keep the first few as a shortlist.

    "At risk" is Critical or Low, not Watch — Watch is a two-week heads-up that raises
    no alert, so including it would let a comfortable product dilute the ratio that
    decides how the alert reads. The list arrives sorted by days left, so the first
    match is the most urgent; above the low-stock table's own item cap this measures the
    most urgent products rather than all of them, which is the right sample anyway.
    """
    at_risk = [item for item in low_stock_items if item["status"] in {"Critical", "Low"}]
    if not at_risk:
        return 0, 0, None, ()

    demand_driven = 0
    leading: dict | None = None
    shortlist: list[dict] = []
    for item in at_risk:
        baseline = item["baseline_daily_velocity"]
        # No baseline sales at all means demand that is entirely new rather than demand
        # that grew — a ratio would divide by zero, and "new" is the stronger signal of
        # the two anyway.
        ratio = item["daily_velocity"] / baseline if baseline > 0 else None
        selling_faster = ratio is None or ratio >= explanation.DEMAND_SPIKE_RATIO
        if selling_faster:
            demand_driven += 1
        if leading is None:
            leading = {
                "stock_code": item["stock_code"],
                "description": item["description"],
                "days_left": item["days_left"],
                "status": item["status"],
                "demand_ratio": ratio,
            }
        if len(shortlist) < AT_RISK_SHORTLIST_LIMIT:
            shortlist.append(
                {
                    "stock_code": item["stock_code"],
                    "description": item["description"],
                    "days_left": item["days_left"],
                    "status": item["status"],
                    # What the shop can see for itself — how many are on the shelf, and
                    # how many left it over the window the days-left figure is based on.
                    # Sent as whole units rather than the per-day rate behind them: this
                    # business sells shoes, and "0.17 a day" describes nothing anyone in
                    # the shop recognises.
                    "on_hand_qty": item["on_hand_qty"],
                    "sold_recent_qty": round(item["daily_velocity"] * STOCK_VELOCITY_WINDOW_DAYS),
                    "demand_ratio": ratio,
                    # Carried as a decided fact rather than left to the reader to work
                    # out from the ratio, so the shortlist and the count above it can
                    # never disagree about which products are selling faster.
                    "selling_faster": selling_faster,
                }
            )
    return len(at_risk), demand_driven, leading, tuple(shortlist)


def build_snapshot(db: Session, branch_id: str, period_range: PeriodRange) -> BranchSnapshot:
    """The single gathering pass. Everything below delegates to the helper the
    matching dashboard tab already uses — see the module docstring's first rule."""
    net_revenue, transaction_count = _revenue_totals(
        db, branch_id, period_range.start, period_range.end
    )
    prev_net_revenue, prev_transaction_count = _revenue_totals(
        db, branch_id, period_range.previous_start, period_range.previous_end
    )

    _, cogs, priced_net_revenue, _, _, _ = _cost_totals_and_products(
        db, branch_id, period_range.start, period_range.end
    )
    _, prev_cogs, prev_priced_net_revenue, _, _, _ = _cost_totals_and_products(
        db, branch_id, period_range.previous_start, period_range.previous_end
    )

    # Current stock is a point-in-time fact with no period control on its own tab, so
    # these figures describe today regardless of which period the Overview is showing.
    # A custom range set months back still scores its Inventory dimension on today's
    # shelf — noted in docs/branch_health.md rather than silently implied.
    stock = _stock_summary(db, branch_id)

    period_days = (period_range.end - period_range.start).days + 1
    daily_cogs = cogs / period_days if period_days else 0.0
    days_of_inventory = (
        stock["estimated_stock_value"] / daily_cogs
        if daily_cogs > 0 and stock["estimated_stock_value"] > 0
        else None
    )

    (
        at_risk_count,
        at_risk_demand_driven_count,
        at_risk_leading_item,
        at_risk_top_items,
    ) = _summarise_stock_risk(stock["low_stock_items"])

    avg_items, single_share, _txn, _hist = _basket_stats(
        db, branch_id, period_range.start, period_range.end
    )
    prev_avg_items, prev_single_share, _, _ = _basket_stats(
        db, branch_id, period_range.previous_start, period_range.previous_end
    )

    # Same checks the Warning page runs, scoped to this branch and to the Overview's
    # own period rather than the business-wide check-window settings — the score is
    # about the period on screen. The SimpleNamespace stand-in for the caller is the
    # same approach build_revenue_dashboard already uses.
    warning_sections = data_quality.build_warning_sections(
        db, SimpleNamespace(branch_id=branch_id), period_days, period_days
    )
    data_issue_sections = tuple(
        {
            "id": section["id"],
            "title": section["title"],
            "description": section["description"],
            "severity": section["severity"],
            "count": len(section["rows"]),
        }
        for section in warning_sections
        if section["rows"]
    )
    data_issue_count = sum(section["count"] for section in data_issue_sections)
    critical_data_issue_count = sum(
        section["count"] for section in data_issue_sections if section["severity"] == "critical"
    )

    return BranchSnapshot(
        net_revenue=net_revenue,
        previous_net_revenue=prev_net_revenue,
        transaction_count=transaction_count,
        previous_transaction_count=prev_transaction_count,
        avg_basket=net_revenue / transaction_count if transaction_count else 0.0,
        previous_avg_basket=prev_net_revenue / prev_transaction_count if prev_transaction_count else 0.0,
        estimated_cogs=cogs,
        previous_estimated_cogs=prev_cogs,
        gross_margin_pct=_margin_pct(net_revenue, cogs),
        previous_gross_margin_pct=_margin_pct(prev_net_revenue, prev_cogs),
        cost_coverage_pct=_coverage_pct(priced_net_revenue, net_revenue),
        previous_cost_coverage_pct=_coverage_pct(prev_priced_net_revenue, prev_net_revenue),
        sku_count=stock["sku_count"],
        critical_count=stock["critical_count"],
        low_count=stock["low_count"],
        watch_count=stock["watch_count"],
        dead_stock_count=stock["dead_stock_count"],
        estimated_stock_value=stock["estimated_stock_value"],
        days_of_inventory_on_hand=days_of_inventory,
        stock_as_of=stock["as_of"],
        at_risk_count=at_risk_count,
        at_risk_demand_driven_count=at_risk_demand_driven_count,
        at_risk_leading_item=at_risk_leading_item,
        at_risk_top_items=at_risk_top_items,
        avg_items_per_basket=avg_items,
        previous_avg_items_per_basket=prev_avg_items,
        single_item_basket_share_pct=single_share,
        previous_single_item_basket_share_pct=prev_single_share,
        trading_days=_trading_days(db, branch_id, period_range.start, period_range.end),
        previous_trading_days=_trading_days(
            db, branch_id, period_range.previous_start, period_range.previous_end
        ),
        products_sold=_products_sold(db, branch_id, period_range.start, period_range.end),
        previous_products_sold=_products_sold(
            db, branch_id, period_range.previous_start, period_range.previous_end
        ),
        data_issue_count=data_issue_count,
        critical_data_issue_count=critical_data_issue_count,
        data_issue_sections=data_issue_sections,
        records_checked=_line_counts(db, branch_id, period_range.start, period_range.end)
        + stock["sku_count"],
        period_days=period_days,
        date_from=period_range.start.isoformat(),
        date_to=period_range.end.isoformat(),
        previous_date_from=period_range.previous_start.isoformat(),
        previous_date_to=period_range.previous_end.isoformat(),
    )


# --- Snapshot -> sub-metric values ----------------------------------------------------


def sub_metric_values(snapshot: BranchSnapshot) -> dict[str, float | None]:
    """The raw value behind each sub-metric key, or None where it can't be measured.

    Kept as one flat mapping (rather than a method per dimension) so the scoring loop
    below stays a plain walk over DIMENSIONS and adding a sub-metric means adding one
    entry here plus one to the table above.
    """
    profit_measurable = snapshot.cost_coverage_pct >= MIN_COST_COVERAGE_PCT
    previous_profit_measurable = snapshot.previous_cost_coverage_pct >= MIN_COST_COVERAGE_PCT

    margin_growth_pp = None
    if (
        profit_measurable
        and previous_profit_measurable
        and snapshot.gross_margin_pct is not None
        and snapshot.previous_gross_margin_pct is not None
    ):
        margin_growth_pp = snapshot.gross_margin_pct - snapshot.previous_gross_margin_pct

    return {
        "revenue_growth_pct": _growth_pct(snapshot.net_revenue, snapshot.previous_net_revenue),
        "transaction_growth_pct": _growth_pct(
            float(snapshot.transaction_count), float(snapshot.previous_transaction_count)
        ),
        "products_sold_growth_pct": _growth_pct(
            float(snapshot.products_sold), float(snapshot.previous_products_sold)
        ),
        "avg_basket_growth_pct": _growth_pct(snapshot.avg_basket, snapshot.previous_avg_basket),
        # Sales per open day rather than raw sales: the Sales dimension already scores the
        # raw movement, and dividing by the days the shop actually traded is what stops a
        # short month, a holiday or a missing day's import from reading as lost customers.
        "avg_daily_sales_growth_pct": (
            _growth_pct(
                snapshot.transaction_count / snapshot.trading_days,
                snapshot.previous_transaction_count / snapshot.previous_trading_days,
            )
            if snapshot.trading_days and snapshot.previous_trading_days
            else None
        ),
        "gross_margin_pct": snapshot.gross_margin_pct if profit_measurable else None,
        "margin_growth_pp": margin_growth_pp,
        "dead_stock_share_pct": (
            snapshot.dead_stock_count / snapshot.sku_count * 100 if snapshot.sku_count else None
        ),
        "stockout_risk_share_pct": (
            (snapshot.critical_count + snapshot.low_count) / snapshot.sku_count * 100
            if snapshot.sku_count
            else None
        ),
        "days_of_inventory_on_hand": snapshot.days_of_inventory_on_hand,
        "data_issue_rate_per_100": (
            snapshot.data_issue_count / snapshot.records_checked * 100
            if snapshot.records_checked
            else None
        ),
        "critical_data_issue_count": (
            float(snapshot.critical_data_issue_count) if snapshot.records_checked else None
        ),
    }


def _unavailable_reason(dimension_key: str, snapshot: BranchSnapshot) -> str:
    """Plain English for why a dimension couldn't be scored. Shown on the tile in place
    of a number, so an unmeasured dimension reads as a gap to fix (usually: import the
    missing data) rather than as a mysterious blank."""
    if dimension_key == "sales":
        return "No sales in the previous period to compare against."
    if dimension_key == "profit":
        if snapshot.cost_coverage_pct < MIN_COST_COVERAGE_PCT:
            return (
                f"Only {snapshot.cost_coverage_pct:.0f}% of this period's revenue has a known buying "
                f"price, below the {MIN_COST_COVERAGE_PCT:.0f}% needed to score margin — import the "
                "missing purchase or inventory records."
            )
        return "No sales in this period to calculate a margin from."
    if dimension_key == "inventory":
        return "No inventory snapshot imported for this branch yet."
    if dimension_key == "customer":
        return "No transactions in this period, or none in the previous one to compare against."
    if dimension_key == "data_quality":
        return "No sale, purchase, or inventory records in this period to check."
    return "Not enough data to score this dimension."


# --- Scoring -------------------------------------------------------------------------


def _score_dimension(
    dimension: Dimension, values: dict[str, float | None], snapshot: BranchSnapshot
) -> tuple[float | None, list[dict]]:
    sub_metric_payload: list[dict] = []
    weighted_total = 0.0
    available_weight = 0.0

    for sub_metric in dimension.sub_metrics:
        value = values.get(sub_metric.key)
        score = None if value is None else score_from_bands(value, sub_metric.bands)
        if score is not None:
            weighted_total += score * sub_metric.weight
            available_weight += sub_metric.weight
        sub_metric_payload.append(
            {
                "key": sub_metric.key,
                "label": sub_metric.label,
                "unit": sub_metric.unit,
                "weight": sub_metric.weight,
                "value": value,
                "score": None if score is None else round(score, 1),
                "definition": sub_metric.definition,
                # The figures this number was worked out from, and the very band table it
                # was scored against — so the page can answer "where did this come from"
                # and "why does that score what it does" without either explanation being
                # written down a second time and left to drift.
                "calculation": (
                    sub_metric.calculation(snapshot) if value is not None and sub_metric.calculation else None
                ),
                "bands": [[band_value, band_score] for band_value, band_score in sub_metric.bands],
            }
        )

    if available_weight == 0:
        return None, sub_metric_payload
    # Re-normalised over what was actually measurable, so a dropped sub-metric lowers
    # confidence in the dimension rather than silently dragging its score down.
    return weighted_total / available_weight, sub_metric_payload


def score_branch(snapshot: BranchSnapshot, weights: dict[str, float] | None = None) -> dict:
    """The whole scoring step: sub-metric values -> dimension scores -> overall score.

    `weights` overrides the DIMENSIONS table's defaults, so the business can decide that
    Inventory matters more here than Sales without a code change (see
    app/services/settings.py's get_branch_health_weights). Omitted keys keep their
    default. The set does not have to sum to 1 — the re-normalisation below already
    divides by whatever was actually measurable, so an in-progress edit still yields a
    sound 0-100 score rather than an error.

    Pure — no database, no clock. Everything time- or query-dependent already happened
    in build_snapshot, which is what makes the scoring rules directly unit-testable
    (and printable as a table in a report) rather than only observable through an
    endpoint.
    """
    weights = weights or {}
    values = sub_metric_values(snapshot)
    dimensions: list[dict] = []
    weighted_total = 0.0
    available_weight = 0.0

    for dimension in DIMENSIONS:
        weight = weights.get(dimension.key, dimension.weight)
        score, sub_metric_payload = _score_dimension(dimension, values, snapshot)
        if score is not None:
            weighted_total += score * weight
            available_weight += weight
        dimensions.append(
            {
                "key": dimension.key,
                "label": dimension.label,
                "description": dimension.description,
                # The weight actually used, which is the configured one when the
                # business has set it — the page must never explain a score with the
                # code's default while the score itself came from a different number.
                "weight": weight,
                "score": None if score is None else round(score, 1),
                "status": health_status(score),
                "insufficient_data_reason": (
                    None if score is not None else _unavailable_reason(dimension.key, snapshot)
                ),
                "sub_metrics": sub_metric_payload,
            }
        )

    overall = weighted_total / available_weight if available_weight else None
    for dimension in dimensions:
        # What each dimension actually contributed once unscoreable ones were dropped —
        # so the page can show "Sales 25% -> 33% of this score" instead of leaving the
        # reader to wonder why five weights that sum to 100% produced this number.
        dimension["effective_weight"] = (
            round(dimension["weight"] / available_weight, 4)
            if available_weight and dimension["score"] is not None
            else None
        )

    return {
        "overall_score": None if overall is None else round(overall, 1),
        "status": health_status(overall),
        "scored_weight": round(available_weight, 4),
        "dimensions": dimensions,
    }


def build_overview_dashboard(
    db: Session,
    branch_id: str,
    branch_name: str,
    period: PeriodKey,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    # Imported here rather than at module scope because app/retail/services/early_warning.py
    # reads this module's BranchSnapshot and MIN_COST_COVERAGE_PCT — the dependency
    # runs scores -> alerts, and this one call is the only place it points back.
    from app.retail.services import early_warning

    period_range = resolve_period(period, date_from=date_from, date_to=date_to)
    snapshot = build_snapshot(db, branch_id, period_range)
    scored = score_branch(snapshot, get_branch_health_weights(db))
    thresholds = early_warning.Thresholds(**get_early_warning_thresholds(db))
    return {
        "branch_id": branch_id,
        "branch_name": branch_name,
        "period": _period_label(period, date_from, date_to),
        "date_from": period_range.start.isoformat(),
        "date_to": period_range.end.isoformat(),
        "previous_date_from": period_range.previous_start.isoformat(),
        "previous_date_to": period_range.previous_end.isoformat(),
        **scored,
        "alerts": early_warning.build_alerts(snapshot, thresholds),
        "metrics": asdict(snapshot),
    }
