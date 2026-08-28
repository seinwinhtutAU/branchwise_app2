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
