"""Branch Health Score — the scoring half of the Overview tab (see docs/retail/branch_health.md).

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
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Callable

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.retail.services import data_quality, explanation
from app.retail.services.import_common import sql_rule_failure
from app.retail.services.pos_import import VALIDATION_RULES as SALES_VALIDATION_RULES
from app.retail.services.purchase_import import VALIDATION_RULES as PURCHASE_VALIDATION_RULES
from app.retail.services.import_integrity import (
    latest_daily_data_dates,
    purchase_number_integrity,
)
from app.services.branches import list_retail_branches
from app.services.settings import get_branch_health_weights
from app.services.dashboard import (
    DEAD_STOCK_WINDOW_DAYS,
    LOW_DAYS_OF_STOCK,
    STOCK_VELOCITY_WINDOW_DAYS,
    PeriodKey,
    PeriodRange,
    _basket_stats,
    _conversion_stats,
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

# Stock last bought more than this many days ago counts as aged (the Inventory alert and the
# Inventory score's "Aged stock" both use it).
AGED_STOCK_DAYS = 180

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


# Growth bands are shared by the revenue and transaction measures on purpose: a 10% fall in
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
                definition="How much money the branch took in, against the same days last year.",
                calculation=lambda s: f"{_ks(s.net_revenue)} this period, against {_ks(s.previous_net_revenue)} last year.",
            ),
            SubMetric(
                "avg_basket_growth_pct",
                "Average sale value",
                "pct_change",
                0.3,
                _GENTLE_GROWTH_BANDS,
                definition="How much a customer spends in one transaction, against the same days last year.",
                calculation=lambda s: (
                    f"{_ks(s.avg_basket)} per transaction this period, against {_ks(s.previous_avg_basket)} last year."
                ),
            ),
            # Revenue can hold up on a shrinking handful of products, which is a different
            # situation from holding up across the shop; only this tells them apart.
            SubMetric(
                "products_sold_growth_pct",
                "Products sold",
                "pct_change",
                0.2,
                _GENTLE_GROWTH_BANDS,
                definition="How many different products actually sold, against the same days last year.",
                calculation=lambda s: (
                    f"{s.products_sold:,} different products sold this period, against "
                    f"{s.previous_products_sold:,} last year."
                ),
            ),
        ),
    ),
    Dimension(
        key="profit",
        label="Profit",
        weight=0.25,
        description="Is what the branch sells actually making money?",
        sub_metrics=(
            SubMetric(
                "gross_margin_pct",
                "Gross margin",
                "pct",
                1.0,
                ((0.0, 0.0), (10.0, 40.0), (20.0, 80.0), (30.0, 100.0)),
                definition="The share of each sale the branch keeps after paying for the goods it sold.",
                calculation=lambda s: (
                    f"{_ks(s.net_revenue - s.estimated_cogs)} kept out of {_ks(s.net_revenue)} sold "
                    f"(goods cost {_ks(s.estimated_cogs)})."
                    if s.net_revenue
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
                "Dead stock",
                "pct",
                0.4,
                ((20.0, 100.0), (35.0, 85.0), (50.0, 60.0), (65.0, 30.0), (80.0, 0.0)),
                definition=(
                    f"How much of the shop is products that are still on the shelf but have not sold "
                    f"once in {DEAD_STOCK_WINDOW_DAYS} days."
                ),
                calculation=lambda s: (
                    f"{s.dead_stock_count:,} of {s.sku_count:,} products with stock."
                    if s.sku_count
                    else None
                ),
            ),
            SubMetric(
                "stockout_risk_share_pct",
                "Stockout risk",
                "pct",
                0.35,
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
                "aged_stock_share_pct",
                "Aged stock share",
                "pct",
                0.25,
                ((0.0, 100.0), (10.0, 80.0), (25.0, 50.0), (40.0, 20.0), (60.0, 0.0)),
                definition=(
                    f"How much of the shop has been on the shelf for more than {AGED_STOCK_DAYS} days "
                    "since it was last bought. Products with no purchase on file are left out, "
                    "since their age is unknown."
                ),
                calculation=lambda s: (
                    f"{s.aged_stock_count:,} of {s.aged_stock_judged_count:,} products with stock "
                    "and a purchase record."
                    if s.aged_stock_judged_count
                    else None
                ),
            ),
        ),
    ),
    Dimension(
        key="customer",
        label="Customer",
        weight=0.15,
        description="Are customers still coming in, and do they buy when they do?",
        # Basket composition (items per transaction, single-item share) used to live here
        # and was dropped: this business sells shoes, and a customer buying one pair and
        # leaving is how the shop normally sells, not a problem to score.
        #
        # Two sub-metrics: whether as many people are buying as a year ago (transaction
        # growth), and how many of the people who came in bought something (conversion).
        sub_metrics=(
            SubMetric(
                "transaction_growth_pct",
                "Transaction growth",
                "pct_change",
                0.5,
                _GROWTH_BANDS,
                definition="How many transactions the branch made, against the same days last year.",
                calculation=lambda s: (
                    f"{s.transaction_count:,} transactions this period, against "
                    f"{s.previous_transaction_count:,} last year."
                ),
            ),
            SubMetric(
                "conversion_rate_pct",
                "Conversion rate",
                "pct",
                0.5,
                ((30.0, 0.0), (45.0, 40.0), (60.0, 70.0), (75.0, 85.0), (85.0, 100.0)),
                definition="Share of store visits that resulted in a sale, on days zero-selling was tracked.",
                calculation=lambda s: (
                    f"{s.conversion_sales_slips:,} sales ÷ ({s.conversion_sales_slips:,} sales + "
                    f"{s.conversion_zero_count:,} walkouts) over {s.conversion_days_recorded:,} tracked days."
                    if s.conversion_rate_pct is not None
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
    # 7 Business Alerts Extensions
    has_today_sales: bool = True
    has_today_inventory: bool = True
    sales_data_date: str | None = None
    inventory_data_date: str | None = None
    purchase_number_integrity: dict = field(default_factory=dict)
    is_after_8pm: bool = False
    daily_check_cutoff_time: str = "20:00"
    stock_allocations: tuple[dict, ...] = ()
    urgent_reorders: tuple[dict, ...] = ()
    aged_footwear: tuple[dict, ...] = ()
    seasonal_spikes: tuple[dict, ...] = ()
    weekly_pattern: dict | None = None
    sale_data_quality_issues: dict = field(default_factory=dict)
    purchase_data_quality_issues: dict = field(default_factory=dict)
    conversion_rate_pct: float | None = None
    conversion_sales_slips: int = 0
    conversion_zero_count: int = 0
    conversion_days_recorded: int = 0
    # How many days back from today the period reaches — so the Warning page can open on
    # the same stretch of days an alert's counts came from.
    warning_window_days: int | None = None
    # Every product held past AGED_STOCK_DAYS — the count behind the Inventory score,
    # where `aged_footwear` above is only the alert's shortlist.
    aged_stock_count: int = 0
    # Of the products with stock, how many have a purchase on file and so could be judged.
    aged_stock_judged_count: int = 0


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
        .filter(
            Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end
        )
        .scalar()
        or 0
    )


def _products_sold(db: Session, branch_id: str, start: date, end: date) -> int:
    """Distinct products with at least one sale line in the window — the breadth of what
    the branch actually sold, not how much of it."""
    return (
        db.query(func.count(func.distinct(SaleLine.product_id)))
        .join(Sale, SaleLine.sale_id == Sale.id)
        .filter(
            Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end
        )
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
        .filter(
            Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end
        )
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
    at_risk = [
        item for item in low_stock_items if item["status"] in {"Critical", "Low"}
    ]
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
                    "sold_recent_qty": round(
                        item["daily_velocity"] * STOCK_VELOCITY_WINDOW_DAYS
                    ),
                    "demand_ratio": ratio,
                    # Carried as a decided fact rather than left to the reader to work
                    # out from the ratio, so the shortlist and the count above it can
                    # never disagree about which products are selling faster.
                    "selling_faster": selling_faster,
                }
            )
    return len(at_risk), demand_driven, leading, tuple(shortlist)


def _check_daily_import_status(
    db: Session,
    branch_id: str,
    now: datetime | None = None,
    cutoff_time: str | None = None,
) -> tuple[bool, bool, bool]:
    now = now or datetime.now()
    today = now.date()

    if cutoff_time is None:
        from app.services.settings import get_daily_check_cutoff_time

        cutoff_time = get_daily_check_cutoff_time(db)

    try:
        parts = cutoff_time.split(":")
        cutoff_h, cutoff_m = int(parts[0]), int(parts[1]) if len(parts) > 1 else 0
    except Exception:
        cutoff_h, cutoff_m = 20, 0

    is_after_cutoff = (now.hour > cutoff_h) or (
        now.hour == cutoff_h and now.minute >= cutoff_m
    )

    has_today_sales = (
        db.query(Sale.id)
        .filter(Sale.branch_id == branch_id, Sale.sale_date == today)
        .first()
        is not None
    )
    has_today_inventory = (
        db.query(StockLevel.id)
        .filter(
            StockLevel.branch_id == branch_id,
            func.date(StockLevel.snapshot_at) == today,
        )
        .first()
        is not None
    )
    return has_today_sales, has_today_inventory, is_after_cutoff


def _find_stock_allocations(
    db: Session, branch_id: str, dead_stock_items: list[dict], lookback_days: int = 90
) -> tuple[dict, ...]:
    if not dead_stock_items:
        return ()

    since = date.today() - timedelta(days=lookback_days)
    dead_codes = [
        item["stock_code"]
        for item in dead_stock_items
        if item.get("on_hand_qty", 0) > 0
    ]
    if not dead_codes:
        return ()

    retail_branches = list_retail_branches(db).all()
    other_branch_ids = [b.id for b in retail_branches if b.id != branch_id]
    if not other_branch_ids:
        return ()

    sales = (
        db.query(
            Product.stock_code,
            Sale.branch_id,
            Branch.name.label("branch_name"),
            func.sum(SaleLine.qty).label("total_qty"),
        )
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .join(Branch, Sale.branch_id == Branch.id)
        .filter(
            Sale.branch_id.in_(other_branch_ids),
            Sale.sale_date >= since,
            Product.stock_code.in_(dead_codes),
        )
        .group_by(Product.stock_code, Sale.branch_id, Branch.name)
        .having(func.sum(SaleLine.qty) > 0)
        .order_by(func.sum(SaleLine.qty).desc())
        .all()
    )

    if not sales:
        return ()

    dead_lookup = {item["stock_code"]: item for item in dead_stock_items}
    best_per_code: dict[str, dict] = {}
    for stock_code, other_b_id, other_b_name, total_qty in sales:
        if stock_code not in best_per_code:
            dead_info = dead_lookup.get(stock_code, {})
            on_hand = float(dead_info.get("on_hand_qty", 0))
            sold = float(total_qty)
            best_per_code[stock_code] = {
                "stock_code": stock_code,
                "description": dead_info.get("description", ""),
                "on_hand_qty": on_hand,
                "target_branch_id": other_b_id,
                "target_branch_name": other_b_name,
                "target_sales_90d": round(sold),
                "recommended_transfer_qty": min(round(on_hand), round(sold)),
            }

    return tuple(list(best_per_code.values())[:10])


def _find_urgent_reorders(low_stock_items: list[dict]) -> tuple[dict, ...]:
    critical_items = [
        item
        for item in low_stock_items
        if item.get("status") == "Critical" and item.get("daily_velocity", 0) > 0
    ]
    critical_items.sort(
        key=lambda x: (x.get("days_left", 999), -x.get("daily_velocity", 0))
    )
    result = []
    for item in critical_items[:10]:
        v = item.get("daily_velocity", 0)
        on_hand = item.get("on_hand_qty", 0)
        reorder_qty = max(1, round(v * 30 - on_hand))
        result.append(
            {
                "stock_code": item["stock_code"],
                "description": item["description"],
                "days_left": round(item["days_left"]),
                "on_hand_qty": round(on_hand),
                "daily_velocity": v,
                "recommended_reorder_qty": reorder_qty,
            }
        )
    return tuple(result)


def _find_aged_footwear(
    db: Session, branch_id: str, aging_days: int = AGED_STOCK_DAYS, today: date | None = None
) -> tuple[dict, ...]:
    """The oldest few aged products, for the alert's shortlist."""
    return tuple(_aged_stock(db, branch_id, aging_days, today)[0][:15])


def _aged_stock(
    db: Session, branch_id: str, aging_days: int = AGED_STOCK_DAYS, today: date | None = None
) -> tuple[list[dict], int]:
    """`(aged products, products that could be judged)`.

    Aged = on the shelf now and last bought more than `aging_days` ago, oldest first.
    Only products with a purchase on file can be judged: a stock file says when this app
    first saw a product, not when it was bought, so without a purchase record the age is
    unknown and the product is left out of both numbers rather than guessed at. The
    Inventory score wants both counts (aged ÷ judged); the alert only lists a shortlist."""
    today = today or date.today()
    cutoff_date = today - timedelta(days=aging_days)

    latest_snapshot_subq = (
        db.query(func.max(StockLevel.snapshot_at))
        .filter(StockLevel.branch_id == branch_id)
        .scalar()
    )
    if not latest_snapshot_subq:
        return [], 0

    current_stocks = (
        db.query(
            StockLevel.product_id,
            StockLevel.on_hand_qty,
            Product.stock_code,
            Product.description,
        )
        .join(Product, StockLevel.product_id == Product.id)
        .filter(
            StockLevel.branch_id == branch_id,
            StockLevel.snapshot_at == latest_snapshot_subq,
            StockLevel.on_hand_qty > 0,
        )
        .all()
    )
    if not current_stocks:
        return [], 0

    product_ids = [s[0] for s in current_stocks]

    purchases = (
        db.query(
            PurchaseLine.product_id,
            func.max(Purchase.purchase_date).label("latest_purchase"),
        )
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .filter(
            Purchase.branch_id == branch_id,
            PurchaseLine.product_id.in_(product_ids),
        )
        .group_by(PurchaseLine.product_id)
        .all()
    )
    purchase_map = {p[0]: p[1] for p in purchases}

    aged_items = []
    judged = 0
    for pid, on_hand, code, desc in current_stocks:
        p_date = purchase_map.get(pid)
        if not p_date:
            continue
        judged += 1
        if p_date > cutoff_date:
            continue

        age = (today - p_date).days
        batch_label = f"Last purchased: {p_date.strftime('%d %b %Y')}"
        aged_items.append(
            {
                "stock_code": code,
                "description": desc,
                "on_hand_qty": round(float(on_hand)),
                "age_days": age,
                "purchase_date": p_date.isoformat(),
                "batch_label": batch_label,
            }
        )

    aged_items.sort(key=lambda x: -x["age_days"])
    return aged_items, judged


def _find_seasonal_spikes(
    db: Session, branch_id: str, today: date | None = None
) -> tuple[dict, ...]:
    today = today or date.today()
    target_month = today.month
    month_names = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
    ]
    month_name = month_names[target_month - 1]

    prior_year = today.year - 1
    prior_sales = (
        db.query(
            Product.stock_code,
            Product.description,
            func.sum(SaleLine.qty).label("sold_qty"),
        )
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .filter(
            Sale.branch_id == branch_id,
            func.extract("year", Sale.sale_date) == prior_year,
            func.extract("month", Sale.sale_date) == target_month,
        )
        .group_by(Product.stock_code, Product.description)
        .having(func.sum(SaleLine.qty) >= 5)
        .order_by(func.sum(SaleLine.qty).desc())
        .limit(10)
        .all()
    )
    if not prior_sales:
        return ()

    return tuple(
        {
            "stock_code": s[0],
            "description": s[1],
            "prior_year_qty": round(float(s[2])),
            "month_name": month_name,
        }
        for s in prior_sales
    )


def _find_weekly_patterns(
    db: Session, branch_id: str, start: date, end: date
) -> dict | None:
    dow_counts = (
        db.query(
            func.extract("dow", Sale.sale_date).label("dow"),
            func.sum(SaleLine.qty).label("qty"),
            func.count(func.distinct(Sale.id)).label("txns"),
        )
        .join(SaleLine, SaleLine.sale_id == Sale.id)
        .filter(
            Sale.branch_id == branch_id,
            Sale.sale_date >= start,
            Sale.sale_date <= end,
        )
        .group_by(func.extract("dow", Sale.sale_date))
        .all()
    )
    if not dow_counts:
        return None

    total_qty = sum(float(r[1] or 0) for r in dow_counts)
    if total_qty < 10:
        return None

    # DOW convention (both Postgres and SQLite): 0=Sunday, 1=Monday, ..., 6=Saturday
    dow_names = {
        0: "Sunday",
        1: "Monday",
        2: "Tuesday",
        3: "Wednesday",
        4: "Thursday",
        5: "Friday",
        6: "Saturday",
    }
    by_dow = {int(r[0]): float(r[1] or 0) for r in dow_counts}

    weekend_qty = by_dow.get(0, 0) + by_dow.get(6, 0)
    weekend_share_pct = (weekend_qty / total_qty) * 100 if total_qty > 0 else 0

    peak_dow = max(by_dow.keys(), key=lambda d: by_dow[d])
    peak_qty = by_dow[peak_dow]
    weekday_qtys = [by_dow.get(d, 0) for d in range(1, 6)]
    weekday_avg = sum(weekday_qtys) / 5 if weekday_qtys else 0

    if weekend_share_pct >= 35.0 or (weekday_avg > 0 and peak_qty >= 1.8 * weekday_avg):
        return {
            "peak_day": dow_names.get(peak_dow, "Weekend"),
            "weekend_share_pct": round(weekend_share_pct, 1),
            "peak_day_qty": round(peak_qty),
            "weekday_avg_qty": round(weekday_avg, 1),
        }
    return None


# Shared by both checks below: a blank or placeholder description, the same set of
# placeholder strings ("—", "-", "?", "None", "NULL") either check has always treated as
# "no real description", trimmed the same way Python's str.strip() would.
def _blank_description_condition():
    return data_quality.blank_description_condition()


def _sale_numeric_invalid_condition():
    # The Warning page's own sale rules (pos_import.VALIDATION_RULES), so this alert and
    # that page always agree on which lines are bad.
    return sql_rule_failure(
        {
            "Selling_Price": SaleLine.selling_price,
            "Qty": SaleLine.qty,
            "Discount_Amount": SaleLine.discount_amount,
            "Amount": SaleLine.amount,
            "Net_Amount": SaleLine.net_amount,
        },
        SALES_VALIDATION_RULES,
    )


def _check_sale_data_quality(
    db: Session, branch_id: str, date_from: date, date_to: date
) -> dict:
    """Checks sale lines for zero/negative/invalid numbers and missing product descriptions.
    Note: Missing buying price is ignored per requirements.

    Counts are a single SQL aggregate rather than pulling every line and classifying it
    in Python — on a branch with a lot of sale lines in the period, `query.all()` used to
    mean loading and converting every row just to throw almost all of them away. The
    sample rows the response actually shows are then fetched with their own `LIMIT 5`
    query, only for the rows that failed."""
    base = (
        db.query(SaleLine, Sale, Product)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .filter(
            Sale.branch_id == branch_id,
            Sale.sale_date >= date_from,
            Sale.sale_date <= date_to,
        )
    )
    numeric_invalid = _sale_numeric_invalid_condition()
    missing_desc = _blank_description_condition()

    invalid_numeric_count, missing_description_count = base.with_entities(
        func.count(case((numeric_invalid, 1))),
        func.count(case((missing_desc, 1))),
    ).one()

    sample_numeric = (
        [
            {
                "slip_id": sale.slip_id,
                "slip_number": sale.slip_number,
                "stock_code": product.stock_code,
                "qty": float(line.qty) if line.qty is not None else None,
                "selling_price": float(line.selling_price)
                if line.selling_price is not None
                else None,
                "net_amount": float(line.net_amount)
                if line.net_amount is not None
                else None,
                "discount_amount": float(line.discount_amount)
                if line.discount_amount is not None
                else None,
            }
            for line, sale, product in base.filter(numeric_invalid).limit(5).all()
        ]
        if invalid_numeric_count
        else []
    )
    sample_missing_desc = (
        [
            {
                "slip_id": sale.slip_id,
                "slip_number": sale.slip_number,
                "stock_code": product.stock_code,
            }
            for line, sale, product in base.filter(missing_desc).limit(5).all()
        ]
        if missing_description_count
        else []
    )

    return {
        "invalid_numeric_count": invalid_numeric_count,
        "missing_description_count": missing_description_count,
        "total_issues": invalid_numeric_count + missing_description_count,
        "sample_numeric": sample_numeric,
        "sample_missing_desc": sample_missing_desc,
    }


def _purchase_numeric_invalid_condition():
    # Same idea as the sale one above, on purchase_import.VALIDATION_RULES.
    return sql_rule_failure(
        {"Quantity": PurchaseLine.quantity, "Buying_Price": PurchaseLine.buying_price},
        PURCHASE_VALIDATION_RULES,
    )


def _check_purchase_data_quality(
    db: Session, branch_id: str, date_from: date, date_to: date
) -> dict:
    """Checks purchase lines for zero/negative/invalid quantities or unit costs (buying prices),
    and missing product descriptions. Same SQL-aggregate approach as
    _check_sale_data_quality above, for the same reason."""
    base = (
        db.query(PurchaseLine, Purchase, Product)
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .join(Product, PurchaseLine.product_id == Product.id)
        .filter(
            Purchase.purchase_date >= date_from,
            Purchase.purchase_date <= date_to,
            (Purchase.branch_id == branch_id) | (Purchase.branch_id.is_(None)),
        )
    )
    numeric_invalid = _purchase_numeric_invalid_condition()
    missing_desc = _blank_description_condition()

    invalid_numeric_count, missing_description_count = base.with_entities(
        func.count(case((numeric_invalid, 1))),
        func.count(case((missing_desc, 1))),
    ).one()

    sample_numeric = (
        [
            {
                "purchase_number": purchase.purchase_number,
                "stock_code": product.stock_code,
                "quantity": float(line.quantity) if line.quantity is not None else None,
                "buying_price": float(line.buying_price)
                if line.buying_price is not None
                else None,
            }
            for line, purchase, product in base.filter(numeric_invalid).limit(5).all()
        ]
        if invalid_numeric_count
        else []
    )
    sample_missing_desc = (
        [
            {
                "purchase_number": purchase.purchase_number,
                "stock_code": product.stock_code,
            }
            for line, purchase, product in base.filter(missing_desc).limit(5).all()
        ]
        if missing_description_count
        else []
    )

    return {
        "invalid_numeric_count": invalid_numeric_count,
        "missing_description_count": missing_description_count,
        "total_issues": invalid_numeric_count + missing_description_count,
        "sample_numeric": sample_numeric,
        "sample_missing_desc": sample_missing_desc,
    }


def build_snapshot(
    db: Session, branch_id: str, period_range: PeriodRange
) -> BranchSnapshot:
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
    # shelf — noted in docs/retail/branch_health.md rather than silently implied.
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
        section["count"]
        for section in data_issue_sections
        if section["severity"] == "critical"
    )

    from app.services.settings import get_daily_check_cutoff_time

    cutoff_time = get_daily_check_cutoff_time(db)
    has_today_sales, has_today_inventory, is_after_8pm = _check_daily_import_status(
        db, branch_id, cutoff_time=cutoff_time
    )
    sales_data_date, inventory_data_date = latest_daily_data_dates(db, branch_id)
    purchase_integrity = purchase_number_integrity(db, branch_id)
    stock_allocations = _find_stock_allocations(
        db, branch_id, stock.get("dead_stock_items", [])
    )
    urgent_reorders = _find_urgent_reorders(stock.get("low_stock_items", []))
    aged_stock, aged_judged = _aged_stock(db, branch_id)
    aged_footwear = tuple(aged_stock[:15])
    seasonal_spikes = _find_seasonal_spikes(db, branch_id)
    weekly_pattern = _find_weekly_patterns(
        db, branch_id, period_range.start, period_range.end
    )
    sale_data_quality_issues = _check_sale_data_quality(
        db, branch_id, period_range.start, period_range.end
    )
    purchase_data_quality_issues = _check_purchase_data_quality(
        db, branch_id, period_range.start, period_range.end
    )
    (
        conversion_rate,
        conversion_sales,
        conversion_zero,
        conversion_days,
    ) = _conversion_stats(db, branch_id, period_range.start, period_range.end)

    return BranchSnapshot(
        net_revenue=net_revenue,
        previous_net_revenue=prev_net_revenue,
        transaction_count=transaction_count,
        previous_transaction_count=prev_transaction_count,
        avg_basket=net_revenue / transaction_count if transaction_count else 0.0,
        previous_avg_basket=prev_net_revenue / prev_transaction_count
        if prev_transaction_count
        else 0.0,
        estimated_cogs=cogs,
        previous_estimated_cogs=prev_cogs,
        gross_margin_pct=_margin_pct(net_revenue, cogs),
        previous_gross_margin_pct=_margin_pct(prev_net_revenue, prev_cogs),
        cost_coverage_pct=_coverage_pct(priced_net_revenue, net_revenue),
        previous_cost_coverage_pct=_coverage_pct(
            prev_priced_net_revenue, prev_net_revenue
        ),
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
        products_sold=_products_sold(
            db, branch_id, period_range.start, period_range.end
        ),
        previous_products_sold=_products_sold(
            db, branch_id, period_range.previous_start, period_range.previous_end
        ),
        data_issue_count=data_issue_count,
        critical_data_issue_count=critical_data_issue_count,
        data_issue_sections=data_issue_sections,
        records_checked=_line_counts(
            db, branch_id, period_range.start, period_range.end
        )
        + stock["sku_count"],
        period_days=period_days,
        date_from=period_range.start.isoformat(),
        date_to=period_range.end.isoformat(),
        previous_date_from=period_range.previous_start.isoformat(),
        previous_date_to=period_range.previous_end.isoformat(),
        has_today_sales=has_today_sales,
        has_today_inventory=has_today_inventory,
        sales_data_date=sales_data_date.isoformat() if sales_data_date else None,
        inventory_data_date=inventory_data_date.isoformat()
        if inventory_data_date
        else None,
        purchase_number_integrity=purchase_integrity,
        is_after_8pm=is_after_8pm,
        daily_check_cutoff_time=cutoff_time,
        stock_allocations=stock_allocations,
        urgent_reorders=urgent_reorders,
        aged_footwear=aged_footwear,
        aged_stock_count=len(aged_stock),
        aged_stock_judged_count=aged_judged,
        seasonal_spikes=seasonal_spikes,
        weekly_pattern=weekly_pattern,
        sale_data_quality_issues=sale_data_quality_issues,
        purchase_data_quality_issues=purchase_data_quality_issues,
        warning_window_days=max((date.today() - period_range.start).days + 1, 1),
        conversion_rate_pct=conversion_rate,
        conversion_sales_slips=conversion_sales,
        conversion_zero_count=conversion_zero,
        conversion_days_recorded=conversion_days,
    )


# --- Snapshot -> sub-metric values ----------------------------------------------------


def sub_metric_values(snapshot: BranchSnapshot) -> dict[str, float | None]:
    """The raw value behind each sub-metric key, or None where it can't be measured.

    Kept as one flat mapping (rather than a method per dimension) so the scoring loop
    below stays a plain walk over DIMENSIONS and adding a sub-metric means adding one
    entry here plus one to the table above.
    """
    profit_measurable = snapshot.cost_coverage_pct >= MIN_COST_COVERAGE_PCT

    return {
        "revenue_growth_pct": _growth_pct(
            snapshot.net_revenue, snapshot.previous_net_revenue
        ),
        "transaction_growth_pct": _growth_pct(
            float(snapshot.transaction_count),
            float(snapshot.previous_transaction_count),
        ),
        "products_sold_growth_pct": _growth_pct(
            float(snapshot.products_sold), float(snapshot.previous_products_sold)
        ),
        "avg_basket_growth_pct": _growth_pct(
            snapshot.avg_basket, snapshot.previous_avg_basket
        ),
        "conversion_rate_pct": snapshot.conversion_rate_pct,
        "gross_margin_pct": snapshot.gross_margin_pct if profit_measurable else None,
        "dead_stock_share_pct": (
            snapshot.dead_stock_count / snapshot.sku_count * 100
            if snapshot.sku_count
            else None
        ),
        "stockout_risk_share_pct": (
            (snapshot.critical_count + snapshot.low_count) / snapshot.sku_count * 100
            if snapshot.sku_count
            else None
        ),
        "aged_stock_share_pct": (
            snapshot.aged_stock_count / snapshot.aged_stock_judged_count * 100
            if snapshot.aged_stock_judged_count
            else None
        ),
        "data_issue_rate_per_100": (
            snapshot.data_issue_count / snapshot.records_checked * 100
            if snapshot.records_checked
            else None
        ),
        "critical_data_issue_count": (
            float(snapshot.critical_data_issue_count)
            if snapshot.records_checked
            else None
        ),
    }


def _unavailable_reason(dimension_key: str, snapshot: BranchSnapshot) -> str:
    """Plain English for why a dimension couldn't be scored. Shown on the tile in place
    of a number, so an unmeasured dimension reads as a gap to fix (usually: import the
    missing data) rather than as a mysterious blank."""
    if dimension_key == "sales":
        return "No sales on the same days last year to compare against — this branch may not have that history yet."
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
        return "No transactions in this period, or none on the same days last year to compare against."
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
                    sub_metric.calculation(snapshot)
                    if value is not None and sub_metric.calculation
                    else None
                ),
                "bands": [
                    [band_value, band_score]
                    for band_value, band_score in sub_metric.bands
                ],
            }
        )

    if available_weight == 0:
        return None, sub_metric_payload
    # Re-normalised over what was actually measurable, so a dropped sub-metric lowers
    # confidence in the dimension rather than silently dragging its score down.
    return weighted_total / available_weight, sub_metric_payload


def score_branch(
    snapshot: BranchSnapshot, weights: dict[str, float] | None = None
) -> dict:
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
                    None
                    if score is not None
                    else _unavailable_reason(dimension.key, snapshot)
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
    month: str | None = None,
) -> dict:
    # Imported here rather than at module scope because app/retail/services/early_warning.py
    # reads this module's BranchSnapshot and MIN_COST_COVERAGE_PCT — the dependency
    # runs scores -> alerts, and this one call is the only place it points back.
    from app.retail.services import early_warning

    # Growth is judged against the same dates one year earlier, not the window right
    # before: this business's sales follow the calendar (festivals, rainy season, school
    # term), so last month is a noisy baseline. It is also the comparison the Revenue,
    # Cost and Customer tabs use, so the Overview and those pages agree.
    period_range = resolve_period(
        period, date_from=date_from, date_to=date_to, month=month, comparison="year_ago"
    )
    snapshot = build_snapshot(db, branch_id, period_range)
    scored = score_branch(snapshot, get_branch_health_weights(db))
    return {
        "branch_id": branch_id,
        "branch_name": branch_name,
        "period": _period_label(period, date_from, date_to),
        "date_from": period_range.start.isoformat(),
        "date_to": period_range.end.isoformat(),
        "previous_date_from": period_range.previous_start.isoformat(),
        "previous_date_to": period_range.previous_end.isoformat(),
        **scored,
        "alerts": early_warning.build_alerts(snapshot),
        "metrics": asdict(snapshot),
    }
