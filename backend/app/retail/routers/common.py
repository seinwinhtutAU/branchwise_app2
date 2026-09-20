"""Shared access guard for retail endpoints."""

from fastapi import Depends, HTTPException, status

from app.core.security import get_current_app_user
from app.models.user import User, UserRole


def require_retail(user: User = Depends(get_current_app_user)) -> None:
    """Allow the admin and both retail roles, but keep wholesale data isolated."""
    if user.role not in (UserRole.ADMIN, UserRole.RETAIL_MANAGEMENT, UserRole.RETAIL):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the retail workspace")
