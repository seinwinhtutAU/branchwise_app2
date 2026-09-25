import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.user import User
from app.retail.services import branch_health as branch_health_service
from app.services import dashboard as dashboard_service
from app.services import response_cache
from app.services.settings import get_purchase_warning_window_days, get_sale_warning_window_days
from app.services.branches import list_retail_branches, resolve_branch_id
from app.retail.routers.common import require_advanced_dashboard, require_retail

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(require_retail)])

DATE_FROM_DESCRIPTION = "Custom range start (inclusive) — overrides `period` when both date_from and date_to are given"
DATE_TO_DESCRIPTION = "Custom range end (inclusive) — overrides `period` when both date_from and date_to are given"
MONTH_DESCRIPTION = "Which calendar month period=monthly means, as YYYY-MM — defaults to the current month"

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


def _resolve_retail_branch(user: User, branch_id: str | None, db: Session) -> Branch:
    """Same rule as every other write/scoped endpoint (a branch-scoped account's own
    branch wins; admin must say which one). Resolves any valid retail branch (wholesale
    branches are excluded from the retail dashboard)."""
    resolved_id = resolve_branch_id(user, branch_id, db)
    branch = list_retail_branches(db).filter(Branch.id == resolved_id).first()
    if branch is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown or non-retail branch_id: {resolved_id}",
        )
    return branch


def _validate_period_or_dates(
    period: str,
    date_from: date | None,
    date_to: date | None,
    month: str | None = None,
) -> None:
    """A custom range must be a real pair — one date with no other is ambiguous rather
    than "half a custom range plus the preset." Only once both are absent does `period`
    (and, for period=monthly, `month`) matter at all."""
    if (date_from is None) != (date_to is None):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "date_from and date_to must both be provided together"
        )
    if date_from is not None and date_to is not None:
        if date_from > date_to:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "date_from must be on or before date_to")
        return
    if period not in dashboard_service.VALID_PERIODS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"period must be one of {sorted(dashboard_service.VALID_PERIODS)}",
        )
    if period == "monthly" and month is not None:
        if not _MONTH_RE.match(month):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "month must be YYYY-MM")
        if month > date.today().strftime("%Y-%m"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "month cannot be in the future")


@router.get("/overview")
def get_overview_dashboard(
    # Defaults to 30d, not today, unlike every other tab. Overview is built on
    # vs-previous-period growth, and one day against the day before is mostly noise —
    # a single quiet Tuesday would read as a critical sales collapse. The other tabs
    # keep their today default because they report levels, not movement.
    #
    # "7d"/"30d" still work here even though the Dashboard's own picker no longer
    # offers them (see dashboard/usePeriodRange.ts) — the Business Alerts page and its nav
    # badge request "30d" by default. The alerts themselves ignore the period.
    period: str = Query("30d", description="today | yesterday | 7d | 30d | monthly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _validate_period_or_dates(period, date_from, date_to, month)
    branch = _resolve_retail_branch(user, branch_id, db)
    # Branch Health's Overview is one of the two most expensive dashboard reads (see
    # response_cache's own docstring) and, on the admin Multi-Branch view, gets
    # requested once per branch on every page load — cached per branch/period/day so
    # that repeat requests before anything actually changes don't recompute it.
    cache_key = (
        "dashboard_overview",
        branch.id,
        period,
        date_from,
        date_to,
        month,
        date.today(),
        response_cache.import_data_version(db, branch.id),
        # The alerts' data-quality checks use these two Settings windows, which can change
        # without any import happening.
        get_sale_warning_window_days(db),
        get_purchase_warning_window_days(db),
    )
    return response_cache.cached(
        cache_key,
        lambda: branch_health_service.build_overview_dashboard(
            db, branch.id, branch.name, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/revenue")
def get_revenue_dashboard(
    period: str = Query("today", description="today | yesterday | monthly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    _validate_period_or_dates(period, date_from, date_to, month)
    branch = _resolve_retail_branch(user, branch_id, db)
    cache_key = (
        "dashboard_revenue",
        branch.id,
        period,
        date_from,
        date_to,
        month,
        date.today(),
        response_cache.import_data_version(db, branch.id),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_revenue_dashboard(
            db, branch.id, branch.name, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/cost")
def get_cost_dashboard(
    period: str = Query("today", description="today | yesterday | monthly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    _validate_period_or_dates(period, date_from, date_to, month)
    branch = _resolve_retail_branch(user, branch_id, db)
    cache_key = (
        "dashboard_cost",
        branch.id,
        period,
        date_from,
        date_to,
        month,
        date.today(),
        response_cache.import_data_version(db, branch.id),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_cost_dashboard(
            db, branch.id, branch.name, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/inventory")
def get_inventory_dashboard(
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    # No period param — current stock is a point-in-time fact, not a date-range query.
    branch = _resolve_retail_branch(user, branch_id, db)
    cache_key = (
        "dashboard_inventory",
        branch.id,
        date.today(),
        response_cache.import_data_version(db, branch.id),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_inventory_dashboard(db, branch.id, branch.name),
    )


@router.get("/customer")
def get_customer_dashboard(
    period: str = Query("today", description="today | yesterday | monthly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    _: None = Depends(require_advanced_dashboard),
    db: Session = Depends(get_db),
) -> dict:
    _validate_period_or_dates(period, date_from, date_to, month)
    branch = _resolve_retail_branch(user, branch_id, db)
    cache_key = (
        "dashboard_customer",
        branch.id,
        period,
        date_from,
        date_to,
        month,
        date.today(),
        response_cache.import_data_version(db, branch.id),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_customer_dashboard(
            db, branch.id, branch.name, period, date_from=date_from, date_to=date_to, month=month
        ),
    )


@router.get("/summary")
def get_summary_dashboard(
    period: str = Query("yesterday", description="today | yesterday | monthly"),
    date_from: date | None = Query(None, description=DATE_FROM_DESCRIPTION),
    date_to: date | None = Query(None, description=DATE_TO_DESCRIPTION),
    month: str | None = Query(None, description=MONTH_DESCRIPTION),
    branch_id: str | None = Query(
        None, description="Required for an admin account (no fixed branch); ignored otherwise"
    ),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    _validate_period_or_dates(period, date_from, date_to, month)
    branch = _resolve_retail_branch(user, branch_id, db)
    cache_key = (
        "dashboard_summary",
        branch.id,
        period,
        date_from,
        date_to,
        month,
        date.today(),
        response_cache.import_data_version(db, branch.id),
    )
    return response_cache.cached(
        cache_key,
        lambda: dashboard_service.build_summary_dashboard(
            db, branch.id, branch.name, period, date_from=date_from, date_to=date_to, month=month
        ),
    )
