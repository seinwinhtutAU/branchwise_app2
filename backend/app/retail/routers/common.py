"""Shared access guard for retail endpoints."""

from fastapi import Depends, HTTPException, status

from app.core.security import get_current_app_user
from app.models.user import User, UserRole


def require_retail(user: User = Depends(get_current_app_user)) -> None:
    """Allow retail access, including admins' read-only dashboard and health views."""
    if user.role not in (
        UserRole.DEVELOPMENT,
        UserRole.ADMIN,
        UserRole.RETAIL_MANAGEMENT,
        UserRole.RETAIL,
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use the retail workspace")


def require_retail_operations(user: User = Depends(get_current_app_user)) -> None:
    """Allow every retail operational role; wholesale remains isolated."""
    if user.role not in (
        UserRole.DEVELOPMENT,
        UserRole.ADMIN,
        UserRole.RETAIL_MANAGEMENT,
        UserRole.RETAIL,
    ):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use retail operations")


def require_advanced_dashboard(user: User = Depends(get_current_app_user)) -> None:
    """Keep the four high-information dashboard tabs out of the admin role."""
    if user.role not in (UserRole.DEVELOPMENT, UserRole.RETAIL_MANAGEMENT, UserRole.RETAIL):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot use this dashboard view")
