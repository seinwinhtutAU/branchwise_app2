from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.retail.models.daily_cost import DailyCostRecord
from app.retail.routers.common import require_retail_operations

router = APIRouter(
    prefix="/api/daily-costs",
    tags=["daily-costs"],
    dependencies=[Depends(require_retail_operations)],
)

PAGE_SIZE = 20


@router.get("/date-bounds")
def daily_costs_date_bounds(
    branch: str | None = Query(None, description="Branch name"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    query = db.query(func.min(DailyCostRecord.cost_date), func.max(DailyCostRecord.cost_date))
    if user.branch_id is not None:
        query = query.filter(DailyCostRecord.branch_id == user.branch_id)
    elif branch:
        query = query.filter(DailyCostRecord.branch == branch)
    earliest_date, latest_date = query.first() or (None, None)
    return {
        "earliest_date": earliest_date.isoformat() if earliest_date else None,
        "latest_date": latest_date.isoformat() if latest_date else None,
    }


@router.get("")
def list_daily_costs(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    branch: str | None = Query(None, description="Branch name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(PAGE_SIZE, ge=1, le=500),
    export: bool = Query(False),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    query = db.query(DailyCostRecord)
    if user.branch_id is not None:
        query = query.filter(DailyCostRecord.branch_id == user.branch_id)
    if branch:
        query = query.filter(DailyCostRecord.branch == branch)
    if date_from:
        query = query.filter(DailyCostRecord.cost_date >= date_from)
    if date_to:
        query = query.filter(DailyCostRecord.cost_date <= date_to)
    total = query.count()
    query = query.order_by(DailyCostRecord.cost_date.desc(), DailyCostRecord.branch)
    if not export:
        query = query.offset((page - 1) * page_size).limit(page_size)
    return {
        "rows": [
            {
                "Date": record.cost_date.isoformat(),
                "Branch": record.branch,
                "DailyUsage": record.usage,
                "UsageTotal": float(record.usage_total),
                "DigitalIncome": record.digital_income,
                "DigitalIncomeTotal": float(record.digital_income_total),
                "Return": record.return_items,
                "ReturnTotal": float(record.return_total),
                "CapitalExpenditure": record.capital_expenditure,
                "CapitalTotal": float(record.capital_total),
            }
            for record in query.all()
        ],
        "total": total,
    }
