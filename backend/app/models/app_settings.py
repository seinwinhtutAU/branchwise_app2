from typing import Any

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

# Every business-wide setting this store knows about, with its default — the single
# source of truth for both "what does a key return before anyone's saved a row for it"
# and "which keys is a PUT allowed to write." Adding a new setting means adding it here
# and reading it via app.services.settings.get_setting; no schema migration needed.
DEFAULT_SETTINGS: dict[str, Any] = {
    "stock_forward_fallback_window_days": 30,
    "purchase_lookback_window_days": 14,
    "stock_lookback_window_days": 7,
    # Business-wide UI preferences — previously per-device localStorage values, moved
    # here so every account (and every device) sees the same theme, check windows, list
    # windows, and column visibility rather than each picking their own.
    "theme": "system",
    "sale_warning_window_days": 1,
    "purchase_warning_window_days": 1,
    "sale_list_window_days": 90,
    "purchase_list_window_days": 90,
    "show_buying_price_source": True,
    # Branch Health scoring and Early Warning firing points (see docs/branch_health.md).
    # Stored as one nested value each rather than fourteen flat keys, since they are
    # each edited as a set — the weights only mean anything relative to one another, and
    # a half-saved threshold set would fire alerts nobody chose. The value column is
    # JSON, so nesting costs nothing; a partially-saved dict is merged over these
    # defaults on read, so a key added here later works without a data migration.
    "branch_health_weights": {
        "sales": 0.25,
        "profit": 0.25,
        "inventory": 0.25,
        "customer": 0.15,
        "data_quality": 0.10,
    },
    "early_warning_thresholds": {
        # Three levels per rule wherever a rule has a milder tier: `normal` is the drift
        # that asks for nothing today, `warning` is act soon, `critical` is act now.
        "revenue_decline_normal_pct": -5.0,
        "revenue_decline_warning_pct": -10.0,
        "revenue_decline_critical_pct": -20.0,
        "low_margin_normal_pct": 15.0,
        "low_margin_warning_pct": 10.0,
        "low_margin_critical_pct": 5.0,
        "margin_slip_normal_pp": -1.0,
        "margin_slip_warning_pp": -3.0,
        "dead_stock_normal_share_pct": 5.0,
        "dead_stock_warning_share_pct": 10.0,
        "dead_stock_critical_share_pct": 25.0,
        "traffic_decline_warning_pct": -10.0,
    },
    # Today's MMK rate for each non-MMK currency the wholesale screens deal in — MMK
    # per 1 unit of that currency, e.g. {"THB": "120.000000000000"}. Only prefills a
    # new foreign-currency order/voucher line or receiving cost (see
    # app/wholesale/services/currency.py); a saved line keeps its own rate forever, so
    # changing this later never rewrites a historical amount. Empty by default — there
    # is no safe placeholder rate, so a currency has no prefill until an admin sets one.
    "today_exchange_rates": {},
    # Purchasing / Reorder target buffer stock months per ABC classification tier.
    # A-tier (core fast-movers): higher buffer (e.g. 3.0 months) to prevent out-of-stock.
    # B-tier (mid-tier steady sellers): moderate buffer (e.g. 2.5 months).
    # C-tier (slow-moving/long-tail): lean buffer (e.g. 1.0 month) to avoid tying up working capital.
    "purchasing_buffer_months": {
        "a": 3.0,
        "b": 2.5,
        "c": 1.0,
    },
}


class AppSetting(Base):
    """A key-value store for business-wide settings — one row per key, rather than a
    fixed column per setting — so a new setting can be introduced by adding an entry to
    DEFAULT_SETTINGS instead of a schema migration. As opposed to the per-device
    preferences the frontend already keeps in localStorage (e.g. the Warning page's
    check window), which are personal viewing choices, not shared business rules.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON, nullable=False)
