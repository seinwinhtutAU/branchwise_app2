from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.app_settings import DEFAULT_SETTINGS, AppSetting


def get_setting(db: Session, key: str) -> Any:
    """A setting's current value, falling back to its default (DEFAULT_SETTINGS) if
    nobody's saved a row for it yet — so a brand-new setting works immediately, with no
    data migration needed to seed it."""
    row = db.get(AppSetting, key)
    return row.value if row is not None else DEFAULT_SETTINGS[key]


def get_all_settings(db: Session) -> dict[str, Any]:
    """Every known setting's current value, default-filled — backs GET /api/settings.

    Also backfills a row for any key that's never been explicitly saved, so the
    app_settings table itself becomes (and stays) a complete, inspectable record of
    every known setting rather than only ever containing the ones somebody has changed —
    a fresh install's table fills in the first time anyone loads the app, and a setting
    added later fills in the first time anyone loads Settings after that deploy.
    """
    saved = {row.key: row.value for row in db.query(AppSetting).all()}
    missing = {key: default for key, default in DEFAULT_SETTINGS.items() if key not in saved}
    if missing:
        for key, default in missing.items():
            db.add(AppSetting(key=key, value=default))
        try:
            db.commit()
        except IntegrityError:
            # Another concurrent request backfilled the same keys first — fine, just
            # re-read what's actually there now instead of erroring.
            db.rollback()
        saved = {row.key: row.value for row in db.query(AppSetting).all()}
    return {key: saved.get(key, default) for key, default in DEFAULT_SETTINGS.items()}


def set_setting(db: Session, key: str, value: Any) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value
    db.commit()


def get_stock_forward_fallback_window_days(db: Session) -> int:
    """Typed convenience wrapper — keeps call sites free of a repeated, typo-prone
    string key while `get_setting`/`set_setting` stay generic underneath for whatever
    setting comes next."""
    return get_setting(db, "stock_forward_fallback_window_days")


def get_purchase_lookback_window_days(db: Session) -> int:
    """Typed convenience wrapper. See get_stock_forward_fallback_window_days."""
    return get_setting(db, "purchase_lookback_window_days")


def get_stock_lookback_window_days(db: Session) -> int:
    """Typed convenience wrapper. See get_stock_forward_fallback_window_days."""
    return get_setting(db, "stock_lookback_window_days")


def get_sale_warning_window_days(db: Session) -> int:
    """Typed convenience wrapper. See get_stock_forward_fallback_window_days."""
    return get_setting(db, "sale_warning_window_days")


def get_purchase_warning_window_days(db: Session) -> int:
    """Typed convenience wrapper. See get_stock_forward_fallback_window_days."""
    return get_setting(db, "purchase_warning_window_days")


def get_sale_list_window_days(db: Session) -> int:
    """Typed convenience wrapper. See get_stock_forward_fallback_window_days."""
    return get_setting(db, "sale_list_window_days")


def get_purchase_list_window_days(db: Session) -> int:
    """Typed convenience wrapper. See get_stock_forward_fallback_window_days."""
    return get_setting(db, "purchase_list_window_days")


def _merged_over_default(db: Session, key: str) -> dict:
    """A nested setting's saved value laid over its defaults, so a dict saved before a
    new sub-key existed still returns a complete set rather than a hole that whatever
    reads it has to guard against. Unknown keys in the saved value are dropped for the
    same reason — the defaults define the shape."""
    default = DEFAULT_SETTINGS[key]
    saved = get_setting(db, key)
    if not isinstance(saved, dict):
        return dict(default)
    return {name: saved.get(name, fallback) for name, fallback in default.items()}


def get_branch_health_weights(db: Session) -> dict[str, float]:
    """How much each dimension counts toward the Branch Health Score. Deliberately not
    forced to sum to 1: the scorer already re-normalises over whichever dimensions were
    measurable, so a set that sums to 0.9 or 1.1 still produces a sound 0-100 score, and
    rejecting it would block a legitimate half-finished edit in the Settings form."""
    return {name: float(value) for name, value in _merged_over_default(db, "branch_health_weights").items()}


def get_today_exchange_rates(db: Session) -> dict[str, str]:
    """Today's MMK rate for each non-MMK currency, as saved (see DEFAULT_SETTINGS'
    today_exchange_rates comment) — only used to prefill a new wholesale order/voucher
    line or receiving cost; not merged over a fixed key set the way
    _merged_over_default's callers are, since the set of currencies is open-ended."""
    saved = get_setting(db, "today_exchange_rates")
    return dict(saved) if isinstance(saved, dict) else {}


def get_early_warning_thresholds(db: Session) -> dict[str, float]:
    """The firing points for every Early Warning rule, as a plain dict — the caller
    turns it into an early_warning.Thresholds. Returning the dataclass from here would
    make this module import early_warning, which already reaches back into settings
    through branch_health."""
    return {
        name: float(value) for name, value in _merged_over_default(db, "early_warning_thresholds").items()
    }


def get_purchasing_buffer_months(db: Session) -> dict[str, float]:
    """The target inventory buffer months for each ABC classification tier."""
    return {
        name: float(value) for name, value in _merged_over_default(db, "purchasing_buffer_months").items()
    }

