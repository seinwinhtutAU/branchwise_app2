from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.services.settings import get_all_settings, get_setting, set_setting
from app.wholesale.services.currency import DEFAULT_CURRENCY, SUPPORTED_CURRENCIES

router = APIRouter(prefix="/api/settings", tags=["settings"])


class BranchHealthWeights(BaseModel):
    """How much each dimension counts toward the Branch Health Score.

    Sent as a complete set, not per-field: a weight only means anything relative to the
    other four, so letting one arrive on its own would silently reweight the whole score
    in a way nobody chose. Deliberately *not* required to sum to 1 — the scorer already
    re-normalises over whichever dimensions were measurable, so a set summing to 0.9
    still yields a sound 0-100 score, and rejecting it would block a legitimate
    in-progress edit in the Settings form.
    """

    sales: float = Field(ge=0, le=1)
    profit: float = Field(ge=0, le=1)
    inventory: float = Field(ge=0, le=1)
    customer: float = Field(ge=0, le=1)
    data_quality: float = Field(ge=0, le=1)


class PurchasingBufferMonths(BaseModel):
    """The target stock buffer in months for each ABC classification tier."""

    a: float = Field(ge=0.1, le=24.0)
    b: float = Field(ge=0.1, le=24.0)
    c: float = Field(ge=0.1, le=24.0)


class AppSettingsUpdate(BaseModel):
    # Every field is optional so a PUT can update just one setting without having to
    # resend every other one — omitted fields are left untouched.
    # Upper bound is a sanity cap, not a business rule — a window measured in years would
    # defeat the whole point of "as of," which is to avoid pricing a sale from data that's
    # clearly from a different point in time.
    stock_forward_fallback_window_days: int | None = Field(default=None, ge=0, le=365)
    purchase_lookback_window_days: int | None = Field(default=None, ge=0, le=365)
    stock_lookback_window_days: int | None = Field(default=None, ge=0, le=365)
    # Business-wide UI preferences (see app_settings.py's DEFAULT_SETTINGS comment).
    theme: Literal["light", "dark", "system"] | None = None
    sale_warning_window_days: int | None = Field(default=None, ge=1, le=365)
    purchase_warning_window_days: int | None = Field(default=None, ge=1, le=365)
    sale_list_window_days: int | None = Field(default=None, ge=1, le=365)
    purchase_list_window_days: int | None = Field(default=None, ge=1, le=365)
    show_buying_price_source: bool | None = None
    daily_check_cutoff_time: str | None = Field(
        default=None, pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$"
    )
    # See docs/retail/branch_health.md. Whole-set updates (see each model's docstring).
    branch_health_weights: BranchHealthWeights | None = None
    purchasing_buffer_months: PurchasingBufferMonths | None = None
    # Today's MMK rate for each non-MMK currency the wholesale screens deal in — MMK
    # per 1 unit of that currency, e.g. {"THB": "120.000000000000"}. A whole-set update,
    # same as the two settings above: a currency left out of the payload simply has no
    # current rate to prefill a new order/voucher line or receiving cost with, though
    # one can still be saved with a hand-typed rate. Values are decimal strings, not
    # floats, so a precise rate survives the round trip exactly — see
    # app/wholesale/services/currency.py for where a line's own saved rate is used
    # instead of this "current" one once the line exists.
    today_exchange_rates: dict[str, str] | None = None

    @field_validator("today_exchange_rates")
    @classmethod
    def _validate_exchange_rates(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        if value is None:
            return value
        validated: dict[str, str] = {}
        for code, rate in value.items():
            upper = code.strip().upper()
            if upper == DEFAULT_CURRENCY or upper not in SUPPORTED_CURRENCIES:
                raise ValueError(f'"{code}" is not a supported non-MMK currency')
            try:
                parsed = Decimal(str(rate))
            except InvalidOperation:
                raise ValueError(f'"{rate}" is not a valid exchange rate for {upper}')
            if parsed <= 0:
                raise ValueError(f"Exchange rate for {upper} must be greater than zero")
            validated[upper] = str(parsed)
        return validated


@router.get("/theme")
def get_theme(db: Session = Depends(get_db)) -> dict[str, str]:
    """The business-wide theme, and nothing else — the one setting the app needs before
    anyone has signed in.

    Deliberately unauthenticated. Every other setting sits behind a token, but the sign-in
    screen itself has to be painted before there is a token to send, and until this
    existed it could only guess: the last theme this device happened to cache, or the
    operating system's, which is wrong on a fresh install and on any device where someone
    changed the theme elsewhere. A colour preference is not information worth protecting,
    and exposing only this one key — rather than opening GET /api/settings — keeps that
    true no matter what settings are added later.
    """
    return {"theme": get_setting(db, "theme")}


@router.get("")
def get_settings(
    user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> dict[str, Any]:
    return get_all_settings(db)


@router.put("")
def update_settings(
    payload: AppSettingsUpdate,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    updates = payload.model_dump(exclude_none=True)
    if user.role not in (UserRole.ADMIN, UserRole.DEVELOPMENT):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an admin or development account can change business-wide settings",
        )
    # model_dump turns the two nested models into plain dicts, which is exactly what the
    # JSON value column stores — no special-casing needed for them here.
    for key, value in updates.items():
        set_setting(db, key, value)
    return get_all_settings(db)
