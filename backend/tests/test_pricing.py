from datetime import date

from app.services.pricing import point_in_time_buying_price

PRODUCT_ID = "product-1"

# Fixed windows for these tests, independent of whatever the AppSetting defaults are —
# call sites always pass explicit values fetched from app.services.settings, so tests
# should too rather than relying on pricing.py's fallback constants.
PURCHASE_WINDOW = 14
STOCK_WINDOW = 7
FORWARD_WINDOW = 30


def _price(as_of: date, purchase_history=None, stock_history=None):
    return point_in_time_buying_price(
        purchase_history or {},
        stock_history or {},
        PRODUCT_ID,
        as_of,
        FORWARD_WINDOW,
        PURCHASE_WINDOW,
        STOCK_WINDOW,
    )


def test_purchase_price_within_lookback_window_is_used():
    sale_date = date(2026, 1, 15)
    purchase_history = {PRODUCT_ID: [(date(2026, 1, 5), 100.0)]}  # 10 days back

    price, source = _price(sale_date, purchase_history=purchase_history)

    assert (price, source) == (100.0, "purchase")


def test_purchase_price_older_than_lookback_window_falls_through_to_stock():
    sale_date = date(2026, 1, 15)
    purchase_history = {PRODUCT_ID: [(date(2025, 12, 1), 100.0)]}  # 45 days back
    stock_history = {PRODUCT_ID: [(date(2026, 1, 10), 90.0)]}  # 5 days back

    price, source = _price(
        sale_date, purchase_history=purchase_history, stock_history=stock_history
    )

    assert (price, source) == (90.0, "stock")


def test_stock_price_older_than_lookback_window_falls_through_to_forward_fill():
    sale_date = date(2026, 1, 15)
    stock_history = {
        PRODUCT_ID: [
            (date(2025, 12, 1), 90.0),  # 45 days back — too old for the 7-day window
            (date(2026, 1, 25), 95.0),  # 10 days forward — within the 30-day window
        ]
    }

    price, source = _price(sale_date, stock_history=stock_history)

    assert (price, source) == (95.0, "stock_forward_fill")


def test_nothing_within_any_window_returns_none():
    sale_date = date(2026, 1, 15)
    purchase_history = {PRODUCT_ID: [(date(2025, 11, 1), 100.0)]}  # too old
    stock_history = {PRODUCT_ID: [(date(2025, 11, 1), 90.0)]}  # too old, and no forward entry

    price, source = _price(
        sale_date, purchase_history=purchase_history, stock_history=stock_history
    )

    assert (price, source) == (None, None)


def test_purchase_price_exactly_at_window_boundary_is_used():
    sale_date = date(2026, 1, 15)
    purchase_history = {PRODUCT_ID: [(date(2026, 1, 1), 100.0)]}  # exactly 14 days back

    price, source = _price(sale_date, purchase_history=purchase_history)

    assert (price, source) == (100.0, "purchase")


def test_purchase_price_one_day_past_window_boundary_is_not_used():
    sale_date = date(2026, 1, 15)
    purchase_history = {PRODUCT_ID: [(date(2025, 12, 31), 100.0)]}  # 15 days back

    price, source = _price(sale_date, purchase_history=purchase_history)

    assert price is None


def test_purchase_within_window_beats_more_recent_stock_price():
    sale_date = date(2026, 1, 15)
    purchase_history = {PRODUCT_ID: [(date(2026, 1, 5), 100.0)]}
    stock_history = {PRODUCT_ID: [(date(2026, 1, 12), 90.0)]}

    price, source = _price(
        sale_date, purchase_history=purchase_history, stock_history=stock_history
    )

    assert (price, source) == (100.0, "purchase")
