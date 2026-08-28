from typing import Any

from sqlalchemy.orm import Session

from app.models.app_settings import DEFAULT_SETTINGS, AppSetting


def get_setting(db: Session, key: str) -> Any:
    """A setting's current value, falling back to its default (DEFAULT_SETTINGS) if
    nobody's saved a row for it yet — so a brand-new setting works immediately, with no
    data migration needed to seed it."""
    row = db.get(AppSetting, key)
    return row.value if row is not None else DEFAULT_SETTINGS[key]


def get_all_settings(db: Session) -> dict[str, Any]:
    """Every known setting's current value, default-filled — backs GET /api/settings."""
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
    """Typed convenience wrapper for the one setting callers actually need today — keeps
    call sites free of a repeated, typo-prone string key while `get_setting`/`set_setting`
    stay generic underneath for whatever setting comes next."""
    return get_setting(db, "stock_forward_fallback_window_days")
