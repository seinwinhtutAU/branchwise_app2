from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.wholesale.schemas.dashboard import (
    CostDashboard,
    CustomerDashboard,
    InventoryDashboard,
    RevenueDashboard,
)
from app.services import response_cache
from app.wholesale.services import dashboard as dashboard_tabs
from app.wholesale.services.response_cache import wholesale_data_version
from app.wholesale.routers.common import require_wholesale, resolve_window

router = APIRouter(prefix="/api/wholesale/dashboard", tags=["wholesale"])


PeriodQuery = Annotated[str, Query(description="today, yesterday, 7d or 30d")]
DateFromQuery = Annotated[date | None, Query()]
DateToQuery = Annotated[date | None, Query()]
MonthQuery = Annotated[str | None, Query(description="Which calendar month period=monthly means, as YYYY-MM")]


def _cache_key(name: str, branch_id: str | None, db: Session, window) -> tuple:
    # window.start/window.end are already resolved concrete dates (see _resolve_window
    # above), so unlike the retail dashboard's cache key there is no separate need for
    # date.today() to invalidate a "today"/"30d" preset after midnight — a calendar
    # rollover already changes window.start/window.end before this key is built.
    return (name, branch_id, window.period, window.start, window.end, wholesale_data_version(db, branch_id))


@router.get("/revenue", response_model=RevenueDashboard)
def get_revenue_dashboard(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    month: MonthQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    window = resolve_window(period, date_from, date_to, month)
    return response_cache.cached(
        _cache_key("wholesale_dashboard_revenue", user.branch_id, db, window),
        lambda: dashboard_tabs.revenue_dashboard(db, user.branch_id, window),
    )


@router.get("/inventory", response_model=InventoryDashboard)
def get_inventory_dashboard(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    """Where the stock is now — a point in time, so there is no period to choose."""
    require_wholesale(user)
    return response_cache.cached(
        ("wholesale_dashboard_inventory", user.branch_id, date.today(), wholesale_data_version(db, user.branch_id)),
        lambda: dashboard_tabs.inventory_dashboard(db, user.branch_id),
    )


@router.get("/customer", response_model=CustomerDashboard)
def get_customer_dashboard(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    month: MonthQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    window = resolve_window(period, date_from, date_to, month)
    return response_cache.cached(
        _cache_key("wholesale_dashboard_customer", user.branch_id, db, window),
        lambda: dashboard_tabs.customer_dashboard(db, user.branch_id, window),
    )


@router.get("/cost", response_model=CostDashboard)
def get_cost_dashboard(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    month: MonthQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    window = resolve_window(period, date_from, date_to, month)
    return response_cache.cached(
        _cache_key("wholesale_dashboard_cost", user.branch_id, db, window),
        lambda: dashboard_tabs.cost_dashboard(db, user.branch_id, window),
    )
