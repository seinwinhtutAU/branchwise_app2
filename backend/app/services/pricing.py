from bisect import bisect_right
from datetime import date
from typing import Literal

from sqlalchemy.orm import Session

from app.models.app_settings import DEFAULT_SETTINGS
from app.models.purchase import Purchase, PurchaseLine
from app.models.stock_level import StockLevel

PriceHistory = dict[str, list[tuple[date, float]]]

# A stock take is manual, physical work on its own cadence, not part of the sale
# transaction the way a purchase is — so a recount often lands a few days or weeks
# after the sales it would otherwise price. Purchase price has no equivalent forward
# fallback below since it's timely enough that "as of" the sale date is trustworthy.
# These defaults only apply when a caller doesn't pass its own window (tests, scripts,
# or any code not going through the matching app.services.settings getter) — real
# request paths fetch the business-wide, admin-configurable value from the AppSetting
# store instead of relying on these constants.
STOCK_FORWARD_FALLBACK_WINDOW_DAYS = DEFAULT_SETTINGS[
    "stock_forward_fallback_window_days"
]
PURCHASE_LOOKBACK_WINDOW_DAYS = DEFAULT_SETTINGS["purchase_lookback_window_days"]
STOCK_LOOKBACK_WINDOW_DAYS = DEFAULT_SETTINGS["stock_lookback_window_days"]


def purchase_price_history(db: Session, product_ids: set[str]) -> PriceHistory:
    """Every known purchase buying price per product, oldest first.

    One bulk query for however many products are asked about, rather than one query per
    product — same batching reason as import_common.get_or_create_products.
    """
    if not product_ids:
        return {}

    rows = (
        db.query(
            PurchaseLine.product_id, Purchase.purchase_date, PurchaseLine.buying_price
        )
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .filter(
            PurchaseLine.product_id.in_(product_ids),
            PurchaseLine.buying_price.isnot(None),
        )
        .order_by(PurchaseLine.product_id, Purchase.purchase_date)
        .all()
    )
    history: PriceHistory = {}
    for product_id, purchase_date, buying_price in rows:
        history.setdefault(product_id, []).append((purchase_date, buying_price))
    return history


def stock_level_price_history(db: Session, product_ids: set[str]) -> PriceHistory:
    """Every known inventory-snapshot buying price per product, oldest first. See
    purchase_price_history for why this is a bulk query rather than per-product."""
    if not product_ids:
        return {}

    rows = (
        db.query(StockLevel.product_id, StockLevel.snapshot_at, StockLevel.buying_price)
        .filter(
            StockLevel.product_id.in_(product_ids), StockLevel.buying_price.isnot(None)
        )
        .order_by(StockLevel.product_id, StockLevel.snapshot_at)
        .all()
    )
    history: PriceHistory = {}
    for product_id, snapshot_at, buying_price in rows:
        history.setdefault(product_id, []).append((snapshot_at.date(), buying_price))
    return history


def price_as_of(
    history: PriceHistory, product_id: str, as_of: date, window_days: int
) -> float | None:
    """The most recent price on record for a product that was already known by `as_of`
    — never a price recorded after that date, and only if it's no older than
    `window_days` — a price from further back is treated as too stale to trust rather
    than used anyway. Each product's list is sorted ascending by date, so this is a
    binary search rather than a scan; comparing against (as_of, inf) finds the cutoff
    after every entry dated exactly `as_of` too, not just before it.
    """
    events = history.get(product_id)
    if not events:
        return None
    idx = bisect_right(events, (as_of, float("inf"))) - 1
    if idx < 0:
        return None
    event_date, price = events[idx]
    if (as_of - event_date).days > window_days:
        return None
    return price


def _stock_price_soon_after(
    history: PriceHistory, product_id: str, as_of: date, window_days: int
) -> float | None:
    """The next stock-level price recorded after `as_of`, only if it lands within
    `window_days` — the bounded exception to "never look forward" for the one source
    (inventory recounts) that's expected to lag the sale it prices. Reuses the same
    (as_of, inf) cutoff price_as_of does; that index, before subtracting 1, is the first
    entry dated after as_of.
    """
    events = history.get(product_id)
    if not events:
        return None
    idx = bisect_right(events, (as_of, float("inf")))
    if idx >= len(events):
        return None
    event_date, price = events[idx]
    if (event_date - as_of).days > window_days:
        return None
    return price


#: What point_in_time_buying_price actually matched against, so a caller can flag a
#: forward-filled price rather than let it look identical to an exact point-in-time
#: match. "purchase"/"stock" are priced as of the sale's own date or earlier; only
#: "stock_forward_fill" reaches past it (see point_in_time_buying_price).
BuyingPriceSource = Literal["purchase", "stock", "stock_forward_fill"]


def point_in_time_buying_price(
    purchase_history: PriceHistory,
    stock_history: PriceHistory,
    product_id: str,
    as_of: date,
    stock_forward_fallback_window_days: int = STOCK_FORWARD_FALLBACK_WINDOW_DAYS,
    purchase_lookback_window_days: int = PURCHASE_LOOKBACK_WINDOW_DAYS,
    stock_lookback_window_days: int = STOCK_LOOKBACK_WINDOW_DAYS,
) -> tuple[float | None, BuyingPriceSource | None]:
    """The buying price that was actually in effect on `as_of` (a sale's own date), not
    whatever the latest price happens to be today — using "latest" for every historical
    sale silently re-prices old sales every time a new purchase comes in, distorting any
    margin trend over time. Purchase price is preferred over a stock-snapshot price when
    both are known as of the same date, matching the old latest_buying_prices preference.

    Each backward-looking source only counts if it's no older than its own lookback
    window (`purchase_lookback_window_days`, `stock_lookback_window_days`) — a price
    that's technically on record but far older than the sale is treated the same as no
    price at all, rather than used anyway, so it falls through to the next source (and
    ultimately to `(None, None)`) instead of pricing a sale off stale data.

    If neither backward source has a usably-recent price by `as_of`, falls back to a
    stock-level price recorded shortly *after* — bounded by
    `stock_forward_fallback_window_days` (an admin-configurable business setting; see
    app.services.settings.get_stock_forward_fallback_window_days) — since a
    missing-stock-code fix is usually "recount it," and that recount is often the only
    cost this product will ever get for sales just before it. Purchase price gets no
    such forward look: it's timely enough that reaching into the future would only
    reintroduce the distortion this function exists to avoid.

    Returns `(price, source)` rather than just `price` so callers can tell a forward-filled
    estimate apart from an exact point-in-time match instead of the two looking identical.
    """
    price = price_as_of(purchase_history, product_id, as_of, purchase_lookback_window_days)
    if price is not None:
        return price, "purchase"
    price = price_as_of(stock_history, product_id, as_of, stock_lookback_window_days)
    if price is not None:
        return price, "stock"
    price = _stock_price_soon_after(
        stock_history, product_id, as_of, stock_forward_fallback_window_days
    )
    if price is not None:
        return price, "stock_forward_fill"
    return None, None


def compute_profit(
    buying_price: float | None, qty: float | None, net_amount: float | None
) -> tuple[float | None, float | None]:
    """Profit and profit-margin % for one sale line, given its point-in-time cost. Shared
    by every place that renders a Profit column (GET /api/sales, /api/data-overview, the
    Warning page's sale-numeric check) so all three price a sale line identically."""
    if buying_price is None or qty is None or net_amount is None:
        return None, None
    profit = round(float(net_amount) - float(buying_price) * float(qty), 2)
    profit_margin_pct = (
        round(profit / float(net_amount) * 100, 2) if net_amount else None
    )
    return profit, profit_margin_pct
