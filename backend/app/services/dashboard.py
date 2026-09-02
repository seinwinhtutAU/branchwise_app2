"""Aggregation for the per-branch retail dashboard (see docs/retail_dashboard.md).

One branch at a time, never a cross-branch rollup, for every tab except Inventory's
stock-health figures — the caller resolves which branch first (see
app/routers/dashboard.py), and every query here is scoped to that one branch_id
directly rather than reusing the nullable-branch_id pattern the row-level list
endpoints (GET /api/sales etc.) use for admin's "every branch" view, since that view
doesn't apply to a period-scoped tab like Revenue or Cost. compute_stock_health is the
one exception: current stock has no period control (see STOCK_VELOCITY_WINDOW_DAYS's
comment), and its figures are also the source of truth for the standalone Low Stock /
Dead Stock list pages, which do need an "every branch" view — see its own docstring.
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from types import SimpleNamespace
from typing import Literal

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.product import Product
from app.models.sale import Sale, SaleLine
from app.models.stock_level import StockLevel
from app.services import data_quality
from app.services.pricing import sale_line_pricer
from app.services.settings import (
    get_purchase_warning_window_days,
    get_sale_warning_window_days,
)
from app.services.stock import latest_stock_query

PeriodKey = Literal["today", "yesterday", "7d", "30d"]
VALID_PERIODS: frozenset[str] = frozenset({"today", "yesterday", "7d", "30d"})

TOP_PRODUCTS_LIMIT = 10
# Sales/footfall-by-day-&-hour heatmap columns — one column per hour, business hours
# only (7am-10pm). A retail shop's overnight hours are always empty, so a 24-hour grid
# just wastes columns on dead space; a sale outside this window (rare — a bad sale_time
# parse, or a genuine after-hours entry) simply doesn't appear on the heatmap at all,
# same tolerant-drop stance _parse_hour already takes for an unparseable time.
HEATMAP_START_HOUR = 7
HEATMAP_END_HOUR = 22  # exclusive — the last column covers 21:00-22:00

# Inventory tab has no period control (current stock is a point-in-time fact), so its
# sales-velocity estimate for "days of stock left" uses its own fixed trailing window
# instead of whatever period another tab happens to have selected.
STOCK_VELOCITY_WINDOW_DAYS = 30
CRITICAL_DAYS_OF_STOCK = 3
LOW_DAYS_OF_STOCK = 7
WATCH_DAYS_OF_STOCK = 14
LOW_STOCK_ITEMS_LIMIT = 50

# Dead stock uses its own, longer window than the days-of-stock velocity above — 30
# days with no sale is routine for a slow-but-fine product; 90 days with no sale at all
# (while still sitting on the shelf) is a much stronger "this isn't moving" signal.
DEAD_STOCK_WINDOW_DAYS = 90
DEAD_STOCK_ITEMS_LIMIT = 50

# The stretch of time *before* the recent velocity window, derived from the two windows
# above rather than declared separately so it can never drift out of step with them.
# Comparing the recent daily rate against this earlier one is what separates "demand
# went up" from "stock was left to run down" for a product about to run out — the two
# call for different responses (reorder more, versus reorder sooner).
BASELINE_VELOCITY_WINDOW_DAYS = DEAD_STOCK_WINDOW_DAYS - STOCK_VELOCITY_WINDOW_DAYS

# sale_time is free text (see app/models/sale.py) — whatever the POS export happened
# to print, not a validated time type — so parsing is best-effort: try common shapes,
# and a row that doesn't match any of them is simply left out of the heatmap rather
# than raising, the same tolerant-parsing stance the rest of the import pipeline takes.
_TIME_FORMATS = ["%H:%M:%S", "%H:%M", "%I:%M:%S %p", "%I:%M %p"]


@dataclass(frozen=True)
class PeriodRange:
    start: date
    end: date
    previous_start: date
    previous_end: date


def resolve_period(
    period: PeriodKey,
    today: date | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> PeriodRange:
    """The selected window, plus the immediately-preceding window of the same
    length — used for every KPI's vs-previous-period delta.

    A caller-chosen `date_from`/`date_to` (both required together) overrides `period`
    entirely — "the previous period" then just means the same number of days
    immediately before `date_from`, the same rule the four named presets already use.
    """
    today = today or date.today()
    if date_from is not None and date_to is not None:
        if date_from > date_to:
            raise ValueError("date_from must be on or before date_to")
        window_days = (date_to - date_from).days + 1
        previous_end = date_from - timedelta(days=1)
        previous_start = previous_end - timedelta(days=window_days - 1)
        return PeriodRange(date_from, date_to, previous_start, previous_end)
    if period == "today":
        start = end = today
        previous_start = previous_end = today - timedelta(days=1)
    elif period == "yesterday":
        start = end = today - timedelta(days=1)
        previous_start = previous_end = today - timedelta(days=2)
    elif period == "7d":
        start = today - timedelta(days=6)
        end = today
        previous_end = start - timedelta(days=1)
        previous_start = previous_end - timedelta(days=6)
    elif period == "30d":
        start = today - timedelta(days=29)
        end = today
        previous_end = start - timedelta(days=1)
        previous_start = previous_end - timedelta(days=29)
    else:
        raise ValueError(f"Unknown period: {period!r}")
    return PeriodRange(start, end, previous_start, previous_end)


def _period_label(period: PeriodKey, date_from: date | None, date_to: date | None) -> str:
    """What the response's own `period` field says — "custom" whenever the caller
    picked an explicit range, regardless of what (if anything) the `period` query
    param happened to also carry."""
    return "custom" if date_from is not None and date_to is not None else period


def _revenue_totals(db: Session, branch_id: str, start: date, end: date) -> tuple[float, int]:
    net_revenue, transaction_count = (
        db.query(
            func.coalesce(func.sum(SaleLine.net_amount), 0),
            func.count(func.distinct(Sale.id)),
        )
        .join(Sale, SaleLine.sale_id == Sale.id)
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .one()
    )
    return float(net_revenue), int(transaction_count)


def _kpi(value: float, previous_value: float) -> dict:
    delta_pct = ((value - previous_value) / previous_value * 100) if previous_value else None
    return {"value": value, "previous_value": previous_value, "delta_pct": delta_pct}


def _each_day(start: date, end: date):
    """Every date in [start, end] — the zero-fill backbone of each daily trend: a
    day with no sales imported yet should read as an actual 0 on the chart, not
    silently disappear."""
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def _daily_trend(db: Session, branch_id: str, start: date, end: date) -> list[dict]:
    rows = (
        db.query(Sale.sale_date, func.coalesce(func.sum(SaleLine.net_amount), 0))
        .join(SaleLine, SaleLine.sale_id == Sale.id)
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .group_by(Sale.sale_date)
        .all()
    )
    by_date = {sale_date: float(total) for sale_date, total in rows}
    return [
        {"date": day.isoformat(), "net_revenue": by_date.get(day, 0.0)}
        for day in _each_day(start, end)
    ]


def _top_products(
    db: Session, branch_id: str, start: date, end: date, limit: int = TOP_PRODUCTS_LIMIT
) -> list[dict]:
    rows = (
        db.query(
            Product.stock_code,
            Product.description,
            func.coalesce(func.sum(SaleLine.qty), 0),
            func.coalesce(func.sum(SaleLine.net_amount), 0),
            # Qty-weighted, not a plain average of the line-level prices — a product
            # sold 1 unit at one price and 100 units at another should read close to
            # that second price, not halfway between the two.
            func.coalesce(func.sum(SaleLine.selling_price * SaleLine.qty), 0),
        )
        .join(SaleLine, SaleLine.product_id == Product.id)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .group_by(Product.id, Product.stock_code, Product.description)
        .order_by(func.sum(SaleLine.net_amount).desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "stock_code": code,
            "description": description,
            "qty": float(qty),
            "net_revenue": float(net),
            "avg_selling_price": float(weighted_price) / float(qty) if qty else None,
        }
        for code, description, qty, net, weighted_price in rows
    ]


def _parse_hour(raw: str | None) -> int | None:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in _TIME_FORMATS:
        try:
            return datetime.strptime(raw, fmt).hour
        except ValueError:
            continue
    return None


def _hour_band_label(hour: int) -> str | None:
    """One column per hour, business hours only — None outside [HEATMAP_START_HOUR,
    HEATMAP_END_HOUR), meaning "leave this row out of the heatmap entirely" rather
    than lumping it into an edge bucket that would misrepresent when it happened."""
    if hour < HEATMAP_START_HOUR or hour >= HEATMAP_END_HOUR:
        return None
    return f"{hour:02d}-{hour + 1:02d}"


def _bucket_heatmap(rows, value_key: str) -> list[dict]:
    """Sum (sale_date, sale_time, value) rows into the weekday × hour-band grid both
    heatmaps share; a row whose time can't be parsed or falls outside business hours
    is left out entirely (see _hour_band_label)."""
    totals: dict[tuple[int, str], float] = {}
    for sale_date, sale_time, value in rows:
        hour = _parse_hour(sale_time)
        band = _hour_band_label(hour) if hour is not None else None
        if band is None:
            continue
        key = (sale_date.weekday(), band)
        totals[key] = totals.get(key, 0) + value
    return [
        {"weekday": weekday, "hour_band": hour_band, value_key: total}
        for (weekday, hour_band), total in sorted(totals.items())
    ]


def _revenue_heatmap(db: Session, branch_id: str, start: date, end: date) -> list[dict]:
    rows = (
        db.query(Sale.sale_date, Sale.sale_time, SaleLine.net_amount)
        .join(SaleLine, SaleLine.sale_id == Sale.id)
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .all()
    )
    return _bucket_heatmap(
        ((sale_date, sale_time, float(net_amount or 0)) for sale_date, sale_time, net_amount in rows),
        "net_revenue",
    )


def build_revenue_dashboard(
    db: Session,
    branch_id: str,
    branch_name: str,
    period: PeriodKey,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    period_range = resolve_period(period, date_from=date_from, date_to=date_to)
    net_revenue, transaction_count = _revenue_totals(
        db, branch_id, period_range.start, period_range.end
    )
    prev_net_revenue, prev_transaction_count = _revenue_totals(
        db, branch_id, period_range.previous_start, period_range.previous_end
    )
    avg_basket = net_revenue / transaction_count if transaction_count else 0.0
    prev_avg_basket = prev_net_revenue / prev_transaction_count if prev_transaction_count else 0.0

    # sale_numeric_warnings only reads user.branch_id (see data_quality.py's
    # _branch_filter) — a plain namespace stands in for the real caller so this
    # reuses the exact same check the Warning page runs, scoped to the branch this
    # dashboard is showing rather than the caller's own (an admin viewing a branch
    # that isn't their own has no branch_id of their own to reuse here).
    sale_warnings = data_quality.sale_numeric_warnings(
        db, SimpleNamespace(branch_id=branch_id), since=period_range.start
    )

    return {
        "branch_id": branch_id,
        "branch_name": branch_name,
        "period": _period_label(period, date_from, date_to),
        "date_from": period_range.start.isoformat(),
        "date_to": period_range.end.isoformat(),
        "net_revenue": _kpi(net_revenue, prev_net_revenue),
        "transaction_count": _kpi(float(transaction_count), float(prev_transaction_count)),
        "avg_basket": _kpi(avg_basket, prev_avg_basket),
        "trend": _daily_trend(db, branch_id, period_range.start, period_range.end),
        "top_products": _top_products(db, branch_id, period_range.start, period_range.end),
        "heatmap": _revenue_heatmap(db, branch_id, period_range.start, period_range.end),
        "sale_warnings": sale_warnings,
    }


# --- Cost -------------------------------------------------------------------------


def _cost_totals_and_products(
    db: Session, branch_id: str, start: date, end: date
) -> tuple[float, float, float, int, list[dict], list[dict]]:
    """One pass over the period's sale lines that produces both the branch-wide
    COGS/revenue totals and the per-product cost breakdown, reusing the exact same
    point-in-time cost lookup (app/services/pricing.py) the Sale tab and Warning page
    already use — rather than a second, differently-computed cost figure.

    Returns (net_revenue, cogs, priced_net_revenue, transaction_count, products, trend).
    `priced_net_revenue` is the slice of net_revenue whose line actually had a cost
    estimate — the denominator for "how much of this margin figure is real," which the
    branch health score needs before it will score Profit at all (see
    app/services/branch_health.py). COGS alone can't answer that: a small COGS means
    either genuinely cheap goods or mostly-unpriced lines, and those are opposite facts.
    """
    rows = (
        db.query(SaleLine, Sale, Product)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .all()
    )
    price_for = sale_line_pricer(db, {product.id for _, _, product in rows})

    net_revenue_total = 0.0
    cogs_total = 0.0
    priced_net_revenue_total = 0.0
    transaction_ids: set[str] = set()
    per_product: dict[str, dict] = {}
    per_day: dict[date, dict] = {}

    for sale_line, sale, product in rows:
        net_amount = float(sale_line.net_amount or 0)
        qty = float(sale_line.qty or 0)
        net_revenue_total += net_amount
        transaction_ids.add(sale.id)

        buying_price, _source = price_for(product.id, sale.sale_date)
        cost = float(buying_price) * qty if buying_price is not None else None
        if cost is not None:
            cogs_total += cost
            priced_net_revenue_total += net_amount

        bucket = per_product.setdefault(
            product.id,
            {
                "stock_code": product.stock_code,
                "description": product.description,
                "qty": 0.0,
                "net_revenue": 0.0,
                "estimated_cost": 0.0,
                "priced_qty": 0.0,
            },
        )
        bucket["qty"] += qty
        bucket["net_revenue"] += net_amount
        if cost is not None:
            bucket["estimated_cost"] += cost
            bucket["priced_qty"] += qty

        day_bucket = per_day.setdefault(
            sale.sale_date, {"net_revenue": 0.0, "estimated_cost": 0.0, "priced_qty": 0.0}
        )
        day_bucket["net_revenue"] += net_amount
        if cost is not None:
            day_bucket["estimated_cost"] += cost
            day_bucket["priced_qty"] += qty

    products = []
    for bucket in per_product.values():
        # A product with zero priced lines has no cost estimate at all — None (shown as
        # "—"), never a silent 0, since 0 would read as "this costs nothing."
        has_cost = bucket["priced_qty"] > 0
        estimated_cost = bucket["estimated_cost"] if has_cost else None
        estimated_margin = (bucket["net_revenue"] - estimated_cost) if has_cost else None
        margin_pct = (
            (estimated_margin / bucket["net_revenue"] * 100)
            if has_cost and bucket["net_revenue"]
            else None
        )
        products.append(
            {
                "stock_code": bucket["stock_code"],
                "description": bucket["description"],
                "qty": bucket["qty"],
                "net_revenue": bucket["net_revenue"],
                "estimated_cost": estimated_cost,
                "estimated_margin": estimated_margin,
                "margin_pct": margin_pct,
            }
        )
    # Ranked by estimated profit, not revenue — a high-volume, thin-margin product
    # should not crowd out a lower-revenue product that's actually more profitable. A
    # product with no cost estimate at all can't be ranked by profit, so it's left out
    # of this list entirely rather than sorted as if its margin were 0.
    products = [p for p in products if p["estimated_margin"] is not None]
    products.sort(key=lambda p: p["estimated_margin"], reverse=True)

    # Zero-fill every day in the window, same convention _daily_trend uses — a day
    # with no sales reads as an actual 0, not a gap. A day with sales but no priced
    # line at all (no purchase/stock record to cost it against) reports cost/margin
    # as None ("—" on the frontend) rather than a misleading 0, same rule the
    # per-product breakdown above already follows.
    trend = []
    for current in _each_day(start, end):
        day_bucket = per_day.get(current, {"net_revenue": 0.0, "estimated_cost": 0.0, "priced_qty": 0.0})
        if day_bucket["net_revenue"] == 0:
            day_cost: float | None = 0.0
            day_margin_pct = None
        elif day_bucket["priced_qty"] > 0:
            day_cost = day_bucket["estimated_cost"]
            day_margin_pct = (day_bucket["net_revenue"] - day_cost) / day_bucket["net_revenue"] * 100
        else:
            day_cost = None
            day_margin_pct = None
        trend.append(
            {
                "date": current.isoformat(),
                "net_revenue": day_bucket["net_revenue"],
                "estimated_cost": day_cost,
                "margin_pct": day_margin_pct,
            }
        )

    return (
        net_revenue_total,
        cogs_total,
        priced_net_revenue_total,
        len(transaction_ids),
        products[:TOP_PRODUCTS_LIMIT],
        trend,
    )


def build_cost_dashboard(
    db: Session,
    branch_id: str,
    branch_name: str,
    period: PeriodKey,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    period_range = resolve_period(period, date_from=date_from, date_to=date_to)
    net_revenue, cogs, _priced, transaction_count, products, trend = _cost_totals_and_products(
        db, branch_id, period_range.start, period_range.end
    )
    prev_net_revenue, prev_cogs, _prev_priced, prev_transaction_count, _, _ = _cost_totals_and_products(
        db, branch_id, period_range.previous_start, period_range.previous_end
    )

    gross_margin_pct = ((net_revenue - cogs) / net_revenue * 100) if net_revenue else 0.0
    prev_gross_margin_pct = (
        (prev_net_revenue - prev_cogs) / prev_net_revenue * 100 if prev_net_revenue else 0.0
    )
    margin_per_basket = (net_revenue - cogs) / transaction_count if transaction_count else 0.0
    prev_margin_per_basket = (
        (prev_net_revenue - prev_cogs) / prev_transaction_count if prev_transaction_count else 0.0
    )

    # Reuses the exact same Purchase-numeric check the Warning page runs, scoped to
    # this dashboard's branch and period — see build_revenue_dashboard's sale_warnings
    # for why a SimpleNamespace stands in for the real caller here.
    day_count = (period_range.end - period_range.start).days + 1
    warning_sections = data_quality.build_warning_sections(
        db, SimpleNamespace(branch_id=branch_id), day_count, day_count, {"purchase_numeric"}
    )
    purchase_warnings = next(
        (section["rows"] for section in warning_sections if section["id"] == "purchase_numeric"), []
    )

    return {
        "branch_id": branch_id,
        "branch_name": branch_name,
        "period": _period_label(period, date_from, date_to),
        "date_from": period_range.start.isoformat(),
        "date_to": period_range.end.isoformat(),
        "estimated_cogs": _kpi(cogs, prev_cogs),
        "estimated_gross_margin_pct": _kpi(gross_margin_pct, prev_gross_margin_pct),
        "estimated_margin_per_basket": _kpi(margin_per_basket, prev_margin_per_basket),
        "trend": trend,
        "products": products,
        "purchase_warnings": purchase_warnings,
    }


# --- Inventory ----------------------------------------------------------------------


def _latest_stock_levels(
    db: Session, branch_id: str | None
) -> list[tuple[StockLevel, Product, Branch | None]]:
    """`branch_id=None` covers every branch at once — the nullable-branch_id convention
    GET /api/sales etc. use, and what the standalone Low Stock / Dead Stock pages need
    for admin's "all branches" view (see compute_stock_health). The dashboard's own
    caller, _stock_summary, always passes a concrete branch_id — see the module
    docstring for why that stays true."""
    query = latest_stock_query(db)
    if branch_id is not None:
        query = query.filter(StockLevel.branch_id == branch_id)
    return query.all()


def _sales_velocity(
    db: Session,
    branch_id: str | None,
    product_ids: set[str] | None = None,
    window_days: int = STOCK_VELOCITY_WINDOW_DAYS,
) -> dict[tuple[str, str | None], float]:
    """Average daily qty sold per (product, branch) pair over a fixed trailing window —
    the basis for each product's "days of stock left" estimate below. Keyed by branch
    too (not just product) so the same stock code in two different branches gets its own
    velocity rather than one blended figure — this matters once branch_id can be None."""
    if product_ids is not None and not product_ids:
        return {}
    since = date.today() - timedelta(days=window_days - 1)
    query = (
        db.query(SaleLine.product_id, Sale.branch_id, func.coalesce(func.sum(SaleLine.qty), 0))
        .join(Sale, SaleLine.sale_id == Sale.id)
        .filter(Sale.sale_date >= since)
    )
    if branch_id is not None:
        query = query.filter(Sale.branch_id == branch_id)
    if product_ids is not None:
        query = query.filter(SaleLine.product_id.in_(product_ids))
    rows = query.group_by(SaleLine.product_id, Sale.branch_id).all()
    return {
        (product_id, sale_branch_id): float(total) / window_days
        for product_id, sale_branch_id, total in rows
    }


def _last_sale_dates(
    db: Session, branch_id: str | None, product_ids: set[str]
) -> dict[tuple[str, str | None], date]:
    """Most recent sale_date per (product, branch), with no trailing-window filter —
    unlike _sales_velocity, dead stock needs to say exactly how long it's been since a
    sale, not just "not within the last 90 days"."""
    if not product_ids:
        return {}
    query = (
        db.query(SaleLine.product_id, Sale.branch_id, func.max(Sale.sale_date))
        .join(Sale, SaleLine.sale_id == Sale.id)
        .filter(SaleLine.product_id.in_(product_ids))
    )
    if branch_id is not None:
        query = query.filter(Sale.branch_id == branch_id)
    rows = query.group_by(SaleLine.product_id, Sale.branch_id).all()
    return {(product_id, sale_branch_id): last_date for product_id, sale_branch_id, last_date in rows}


def _stock_status(days_left: float | None) -> str | None:
    """None means "healthy" (or "no recent sales to estimate from") — either way, not
    worth a row in the low-stock table. Thresholds are a reasonable default, not a
    business-configured setting yet — see docs/retail_dashboard.md."""
    if days_left is None:
        return None
    if days_left <= CRITICAL_DAYS_OF_STOCK:
        return "Critical"
    if days_left <= LOW_DAYS_OF_STOCK:
        return "Low"
    if days_left <= WATCH_DAYS_OF_STOCK:
        return "Watch"
    return None


def _stock_health_from_rows(
    rows: list[tuple[StockLevel, Product, Branch | None]],
    velocity: dict[tuple[str, str | None], float],
    dead_stock_velocity: dict[tuple[str, str | None], float],
    last_sale_dates: dict[tuple[str, str | None], date],
) -> tuple[list[dict], list[dict]]:
    """The actual low-stock/dead-stock item-building loop, given rows and both velocity
    windows already fetched — split out from compute_stock_health so _stock_summary can
    reuse it against rows it already has, rather than querying stock levels twice."""
    low_stock_items: list[dict] = []
    dead_stock_items: list[dict] = []
    today = date.today()

    for stock_level, product, branch in rows:
        on_hand_qty = float(stock_level.on_hand_qty or 0)
        key = (product.id, stock_level.branch_id)
        branch_name = branch.name if branch else None

        daily_velocity = velocity.get(key, 0.0)
        days_left = on_hand_qty / daily_velocity if daily_velocity > 0 else None
        status = _stock_status(days_left)
        if status:
            # The earlier window's daily rate, backed out of the two velocity figures
            # already computed above rather than queried again: the 90-day window
            # contains the 30-day one, so the difference is exactly what sold in the 60
            # days before it. Clamped at 0 because float subtraction of two averages can
            # land a hair below zero when nothing sold in that stretch.
            recent_qty = daily_velocity * STOCK_VELOCITY_WINDOW_DAYS
            window_qty = dead_stock_velocity.get(key, 0.0) * DEAD_STOCK_WINDOW_DAYS
            baseline_daily_velocity = max(
                0.0, (window_qty - recent_qty) / BASELINE_VELOCITY_WINDOW_DAYS
            )
            low_stock_items.append(
                {
                    "stock_code": product.stock_code,
                    "description": product.description,
                    "branch": branch_name,
                    "on_hand_qty": on_hand_qty,
                    "days_left": round(days_left, 1),
                    "status": status,
                    "daily_velocity": daily_velocity,
                    "baseline_daily_velocity": baseline_daily_velocity,
                }
            )

        # Dead stock: still on the shelf, but hasn't sold at all in DEAD_STOCK_WINDOW_DAYS
        # — on_hand_qty <= 0 is excluded since there's nothing sitting there to flag.
        if on_hand_qty > 0 and dead_stock_velocity.get(key, 0.0) == 0.0:
            last_sold = last_sale_dates.get(key)
            dead_stock_items.append(
                {
                    "stock_code": product.stock_code,
                    "description": product.description,
                    "branch": branch_name,
                    "on_hand_qty": on_hand_qty,
                    "category": product.group_name or "Uncategorized",
                    "last_sold_at": last_sold.isoformat() if last_sold else None,
                    # None means never sold at all (no Sale row ever, not just none
                    # recently) — worth keeping distinct from a large day count rather
                    # than collapsing both into one number.
                    "days_since_last_sale": (today - last_sold).days if last_sold else None,
                }
            )

    low_stock_items.sort(key=lambda item: item["days_left"])
    dead_stock_items.sort(key=lambda item: item["on_hand_qty"], reverse=True)
    return low_stock_items, dead_stock_items


def compute_stock_health(db: Session, branch_id: str | None) -> tuple[list[dict], list[dict]]:
    """Every low-stock and dead-stock item, uncapped (unlike the Inventory tab's own
    LOW_STOCK_ITEMS_LIMIT/DEAD_STOCK_ITEMS_LIMIT slice) — the shared computation behind
    both that dashboard tab and the standalone Low Stock / Dead Stock pages
    (GET /api/inventory/low-stock, /dead-stock), which page through the rest. One
    function so the two views can never disagree on which products are flagged — see
    _stock_summary's docstring for why that consistency matters for the branch health
    score too.

    `branch_id=None` covers every branch at once, for admin's "all branches" list view
    — see the module docstring for why this is the one exception to "always one branch."
    """
    rows = _latest_stock_levels(db, branch_id)
    product_ids = {product.id for _, product, _ in rows}
    velocity = _sales_velocity(db, branch_id, product_ids)
    # A second, longer-window velocity check purely to decide "has this sold at all
    # recently" for dead stock — see DEAD_STOCK_WINDOW_DAYS.
    dead_stock_velocity = _sales_velocity(db, branch_id, product_ids, window_days=DEAD_STOCK_WINDOW_DAYS)
    last_sale_dates = _last_sale_dates(db, branch_id, product_ids)
    return _stock_health_from_rows(rows, velocity, dead_stock_velocity, last_sale_dates)


def _stock_summary(db: Session, branch_id: str) -> dict:
    """Everything the Inventory tab reports about current stock, minus the
    data-quality warnings — split out so the branch health score (see
    app/services/branch_health.py) can read the exact same SKU/dead-stock/low-stock
    figures the tab shows without also paying for a second warnings pass over a
    window it doesn't want. If Overview and the Inventory tab ever disagreed on the
    dead-stock count the whole score would lose its credibility, so there is
    deliberately only one place that counts it.
    """
    rows = _latest_stock_levels(db, branch_id)
    product_ids = {product.id for _, product, _ in rows}
    velocity = _sales_velocity(db, branch_id, product_ids)
    dead_stock_velocity = _sales_velocity(db, branch_id, product_ids, window_days=DEAD_STOCK_WINDOW_DAYS)
    last_sale_dates = _last_sale_dates(db, branch_id, product_ids)
    low_stock_items, dead_stock_items = _stock_health_from_rows(
        rows, velocity, dead_stock_velocity, last_sale_dates
    )

    estimated_stock_value = 0.0
    qty_by_category: dict[str, float] = {}
    status_counts = {"Critical": 0, "Low": 0, "Watch": 0}
    latest_snapshot_at = None

    for stock_level, product, _branch in rows:
        on_hand_qty = float(stock_level.on_hand_qty or 0)
        buying_price = float(stock_level.buying_price) if stock_level.buying_price is not None else None
        value = on_hand_qty * buying_price if buying_price is not None else 0.0
        estimated_stock_value += value
        category = product.group_name or "Uncategorized"
        # Quantity, not value, for the per-category breakdown — it comes straight from
        # the inventory import every time, unlike value, which silently reads as 0 for
        # any product missing a buying_price on its latest snapshot (see
        # estimated_stock_value above) and would otherwise make a category look
        # artificially small.
        qty_by_category[category] = qty_by_category.get(category, 0.0) + on_hand_qty

        if latest_snapshot_at is None or stock_level.snapshot_at > latest_snapshot_at:
            latest_snapshot_at = stock_level.snapshot_at

    for item in low_stock_items:
        status_counts[item["status"]] += 1

    stock_qty_by_category = sorted(
        ({"category": category, "qty": qty} for category, qty in qty_by_category.items()),
        key=lambda row: row["qty"],
        reverse=True,
    )

    # branch is only meaningful for the standalone all-branches list pages — every item
    # here is already scoped to this one dashboard's branch_id, so it's dropped rather
    # than sent to the frontend redundantly on every row.
    def _drop_branch(item: dict) -> dict:
        return {k: v for k, v in item.items() if k != "branch"}

    return {
        "as_of": latest_snapshot_at.isoformat() if latest_snapshot_at else None,
        "sku_count": len(rows),
        "critical_count": status_counts["Critical"],
        "low_count": status_counts["Low"],
        "watch_count": status_counts["Watch"],
        "estimated_stock_value": estimated_stock_value,
        "dead_stock_count": len(dead_stock_items),
        "stock_qty_by_category": stock_qty_by_category,
        "low_stock_items": [_drop_branch(item) for item in low_stock_items[:LOW_STOCK_ITEMS_LIMIT]],
        "dead_stock_items": [_drop_branch(item) for item in dead_stock_items[:DEAD_STOCK_ITEMS_LIMIT]],
    }


def build_inventory_dashboard(db: Session, branch_id: str, branch_name: str) -> dict:
    summary = _stock_summary(db, branch_id)

    # Reuses the exact same Inventory/Daily-check checks the Warning page runs, using
    # the business-wide check-window settings (there's no period control here to derive
    # a window from) — scoped to this dashboard's branch, same SimpleNamespace approach
    # as build_revenue_dashboard's sale_warnings.
    relevant_section_ids = {"inventory_numeric", "missing_product", "reconciliation_uom", "reconciliation_mismatch"}
    warning_sections = data_quality.build_warning_sections(
        db,
        SimpleNamespace(branch_id=branch_id),
        get_sale_warning_window_days(db),
        get_purchase_warning_window_days(db),
        relevant_section_ids,
    )
    warnings = [row for section in warning_sections for row in section["rows"]]

    return {
        "branch_id": branch_id,
        "branch_name": branch_name,
        **summary,
        "warnings": warnings,
    }


# --- Customer -------------------------------------------------------------------------


def _basket_stats(
    db: Session, branch_id: str, start: date, end: date
) -> tuple[float, float, int, dict[int, int]]:
    """Basket shape (not money) for the period: avg line-items per basket, the % of
    baskets with exactly one line item, the transaction count, and a line-item-count
    histogram (buckets 1-5, 6 meaning "6+")."""
    rows = (
        db.query(Sale.id, func.count(SaleLine.id))
        .join(SaleLine, SaleLine.sale_id == Sale.id)
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .group_by(Sale.id)
        .all()
    )
    line_counts = [count for _, count in rows]
    transaction_count = len(line_counts)
    avg_items_per_basket = sum(line_counts) / transaction_count if transaction_count else 0.0
    single_item_count = sum(1 for count in line_counts if count == 1)
    single_item_share_pct = (
        single_item_count / transaction_count * 100 if transaction_count else 0.0
    )
    histogram: dict[int, int] = {}
    for count in line_counts:
        bucket = count if count < 6 else 6
        histogram[bucket] = histogram.get(bucket, 0) + 1
    return avg_items_per_basket, single_item_share_pct, transaction_count, histogram


def _footfall_heatmap(db: Session, branch_id: str, start: date, end: date) -> list[dict]:
    """The same weekday × hour-band grid as Revenue's heatmap, bucketed by transaction
    count instead of revenue — a busy-but-low-ticket hour and a quiet-but-high-ticket
    one can diverge, so this is queried directly from Sale rather than derived from the
    revenue heatmap."""
    rows = (
        db.query(Sale.sale_date, Sale.sale_time)
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .all()
    )
    return _bucket_heatmap(
        ((sale_date, sale_time, 1) for sale_date, sale_time in rows),
        "transaction_count",
    )


def _transaction_count_trend(db: Session, branch_id: str, start: date, end: date) -> list[dict]:
    """Daily transaction (basket) count over the period — the day-by-day footfall trend
    that complements the weekday x hour Busy Hours heatmap, which shows the recurring
    pattern but not how the whole period actually moved day to day."""
    rows = (
        db.query(Sale.sale_date, func.count(func.distinct(Sale.id)))
        .filter(Sale.branch_id == branch_id, Sale.sale_date >= start, Sale.sale_date <= end)
        .group_by(Sale.sale_date)
        .all()
    )
    by_date = {sale_date: int(count) for sale_date, count in rows}
    return [
        {"date": day.isoformat(), "transaction_count": by_date.get(day, 0)}
        for day in _each_day(start, end)
    ]


def build_customer_dashboard(
    db: Session,
    branch_id: str,
    branch_name: str,
    period: PeriodKey,
    date_from: date | None = None,
    date_to: date | None = None,
) -> dict:
    period_range = resolve_period(period, date_from=date_from, date_to=date_to)
    avg_items, single_share, _txn_count, histogram = _basket_stats(
        db, branch_id, period_range.start, period_range.end
    )
    prev_avg_items, prev_single_share, _, _ = _basket_stats(
        db, branch_id, period_range.previous_start, period_range.previous_end
    )

    footfall = _footfall_heatmap(db, branch_id, period_range.start, period_range.end)
    # No vs-previous-period delta for this one — it names a bucket (a day/time), not a
    # number that moves, so "up/down vs last period" wouldn't mean anything.
    busiest_hour = max(footfall, key=lambda cell: cell["transaction_count"], default=None)

    # Same sale_numeric check as Revenue's tile — the two tabs share one source of rows.
    sale_warnings = data_quality.sale_numeric_warnings(
        db, SimpleNamespace(branch_id=branch_id), since=period_range.start
    )

    return {
        "branch_id": branch_id,
        "branch_name": branch_name,
        "period": _period_label(period, date_from, date_to),
        "date_from": period_range.start.isoformat(),
        "date_to": period_range.end.isoformat(),
        "avg_items_per_basket": _kpi(avg_items, prev_avg_items),
        "single_item_basket_share_pct": _kpi(single_share, prev_single_share),
        "busiest_hour": busiest_hour,
        "footfall_heatmap": footfall,
        "transaction_count_trend": _transaction_count_trend(db, branch_id, period_range.start, period_range.end),
        "items_per_basket_histogram": [
            {"items": items, "count": count} for items, count in sorted(histogram.items())
        ],
        "sale_warnings": sale_warnings,
    }
