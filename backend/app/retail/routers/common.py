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


def require_retail_management(user: User = Depends(get_current_app_user)) -> None:
    """Restricts an action to the roles trusted to decide a missing import day was a
    genuine branch closure rather than a forgotten upload — plain retail/wholesale
    accounts can see the gap but not sign off on it."""
    if user.role not in (UserRole.DEVELOPMENT, UserRole.ADMIN, UserRole.RETAIL_MANAGEMENT):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account cannot mark a day as closed")
