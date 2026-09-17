from datetime import date
from types import SimpleNamespace
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.wholesale_reports import CostReport, CustomerReport, InventoryReport, RevenueReport
from app.services import dashboard as dashboard_service
from app.services.wholesale import reports
from app.routers.wholesale_common import require_wholesale

router = APIRouter(prefix="/api/wholesale/reports", tags=["wholesale"])


def _resolve_window(period: str, date_from: date | None, date_to: date | None):
    if (date_from is None) != (date_to is None):
        raise HTTPException(400, "date_from and date_to must be provided together")
    if period not in dashboard_service.VALID_PERIODS:
        raise HTTPException(400, f"period must be one of {sorted(dashboard_service.VALID_PERIODS)}")
    try:
        resolved = dashboard_service.resolve_period(period, date_from=date_from, date_to=date_to)
        # PeriodRange is deliberately a pure date-maths value object shared with the
        # retail dashboard. Keep the selected preset beside it for the report payload
        # without changing that shared public type.
        return SimpleNamespace(
            start=resolved.start,
            end=resolved.end,
            previous_start=resolved.previous_start,
            previous_end=resolved.previous_end,
            period="custom" if date_from is not None else period,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


PeriodQuery = Annotated[str, Query(description="today, yesterday, 7d or 30d")]
DateFromQuery = Annotated[date | None, Query()]
DateToQuery = Annotated[date | None, Query()]


@router.get("/revenue", response_model=RevenueReport)
def get_revenue_report(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    return reports.revenue_report(db, user.branch_id, _resolve_window(period, date_from, date_to))


@router.get("/cost", response_model=CostReport)
def get_cost_report(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    return reports.cost_report(db, user.branch_id, _resolve_window(period, date_from, date_to))


@router.get("/inventory", response_model=InventoryReport)
def get_inventory_report(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    return reports.inventory_report(db, user.branch_id, _resolve_window(period, date_from, date_to))


@router.get("/customer", response_model=CustomerReport)
def get_customer_report(
    period: PeriodQuery = "30d",
    date_from: DateFromQuery = None,
    date_to: DateToQuery = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    require_wholesale(user)
    return reports.customer_report(db, user.branch_id, _resolve_window(period, date_from, date_to))
