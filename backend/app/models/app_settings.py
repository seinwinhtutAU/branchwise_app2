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
