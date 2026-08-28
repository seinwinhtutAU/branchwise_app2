from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User, UserRole
from app.services.settings import get_all_settings, set_setting

router = APIRouter(prefix="/api/settings", tags=["settings"])


class AppSettingsUpdate(BaseModel):
    # Every field is optional so a PUT can update just one setting without having to
    # resend every other one — omitted fields are left untouched.
    # Upper bound is a sanity cap, not a business rule — a window measured in years would
    # defeat the whole point of "as of," which is to avoid pricing a sale from data that's
    # clearly from a different point in time.
    stock_forward_fallback_window_days: int | None = Field(default=None, ge=0, le=365)


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
    # Business-wide, not per-device — unlike the Warning page's check-window preference,
    # these feed calculations everyone sees the same result for, so only an admin
    # account can change them (mirrors orders.py's second-commit-qty restriction).
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only an admin account can change business-wide settings",
        )

    for key, value in payload.model_dump(exclude_none=True).items():
        set_setting(db, key, value)
    return get_all_settings(db)
