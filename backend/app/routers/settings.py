from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.services.settings import get_all_settings, get_setting, set_setting

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


class EarlyWarningThresholds(BaseModel):
    """The firing point for each Early Warning rule. Bounds are sanity caps rather than
    business rules — the point of exposing these is that the business decides what
    counts as a problem — but a decline threshold above zero would fire on every growing
    branch, and a margin floor above 100% would fire on every branch there is."""

    revenue_decline_normal_pct: float = Field(ge=-100, le=0)
    revenue_decline_warning_pct: float = Field(ge=-100, le=0)
    revenue_decline_critical_pct: float = Field(ge=-100, le=0)
    low_margin_normal_pct: float = Field(ge=0, le=100)
    low_margin_warning_pct: float = Field(ge=0, le=100)
    low_margin_critical_pct: float = Field(ge=0, le=100)
    margin_slip_normal_pp: float = Field(ge=-100, le=0)
    margin_slip_warning_pp: float = Field(ge=-100, le=0)
    dead_stock_normal_share_pct: float = Field(ge=0, le=100)
    dead_stock_warning_share_pct: float = Field(ge=0, le=100)
    dead_stock_critical_share_pct: float = Field(ge=0, le=100)
    traffic_decline_warning_pct: float = Field(ge=-100, le=0)
    single_item_basket_normal_share_pct: float = Field(ge=0, le=100)
    single_item_basket_warning_share_pct: float = Field(ge=0, le=100)


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
    # See docs/branch_health.md. Whole-set updates (see each model's docstring).
    branch_health_weights: BranchHealthWeights | None = None
    early_warning_thresholds: EarlyWarningThresholds | None = None


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
    # Business-wide, not per-device — every account (and every device) sees the same
    # value for all of these, so only an admin account can change them (mirrors
    # orders.py's second-commit-qty restriction).
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an admin account can change business-wide settings",
        )

    # model_dump turns the two nested models into plain dicts, which is exactly what the
    # JSON value column stores — no special-casing needed for them here.
    for key, value in payload.model_dump(exclude_none=True).items():
        set_setting(db, key, value)
    return get_all_settings(db)
