from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.retail.models.sale import Sale
from app.retail.models.zero_selling import ZeroSellingRecord
from app.retail.routers.common import require_retail_operations

router = APIRouter(
    prefix="/api/zero-selling",
    tags=["zero-selling"],
    dependencies=[Depends(require_retail_operations)],
)

PAGE_SIZE = 20


def _filter_records(query, user: User, branch: str | None, date_from: date | None, date_to: date | None):
    if user.branch_id is not None:
        query = query.filter(ZeroSellingRecord.branch_id == user.branch_id)
    if branch:
        query = query.filter(ZeroSellingRecord.branch == branch)
    if date_from:
        query = query.filter(ZeroSellingRecord.sale_date >= date_from)
    if date_to:
        query = query.filter(ZeroSellingRecord.sale_date <= date_to)
    return query


@router.get("/date-bounds")
@router.get("/conversion/date-bounds")
def zero_selling_date_bounds(
    branch: str | None = Query(None, description="Branch name"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    query = _filter_records(
        db.query(func.min(ZeroSellingRecord.sale_date), func.max(ZeroSellingRecord.sale_date)),
        user,
        branch,
        None,
        None,
    )
    earliest_date, latest_date = query.first() or (None, None)
    return {
        "earliest_date": earliest_date.isoformat() if earliest_date else None,
        "latest_date": latest_date.isoformat() if latest_date else None,
    }


@router.get("")
def list_zero_selling_records(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    search: str | None = Query(None, description="Matches category or reason"),
    branch: str | None = Query(None, description="Branch name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(PAGE_SIZE, ge=1, le=500),
    export: bool = Query(False),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    query = _filter_records(db.query(ZeroSellingRecord), user, branch, date_from, date_to)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (ZeroSellingRecord.category.ilike(like)) | (ZeroSellingRecord.reason.ilike(like))
        )
    total = query.count()
    query = query.order_by(ZeroSellingRecord.sale_date.desc(), ZeroSellingRecord.sale_time.desc())
    if not export:
        query = query.offset((page - 1) * page_size).limit(page_size)
    rows = [
        {
            "Date": record.sale_date.isoformat(),
            "Time": record.sale_time,
            "Branch": record.branch,
            "Category": record.category,
            "Reason": record.reason,
        }
        for record in query.all()
    ]
    return {"rows": rows, "total": total}


@router.get("/conversion")
def list_conversion_rates(
    date_from: date | None = Query(None),
    date_to: date | None = Query(None),
    branch: str | None = Query(None, description="Branch name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(PAGE_SIZE, ge=1, le=500),
    export: bool = Query(False),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    grouped = _filter_records(
        db.query(
            ZeroSellingRecord.sale_date,
            ZeroSellingRecord.branch_id,
            ZeroSellingRecord.branch,
            func.count(ZeroSellingRecord.id).label("zero_selling"),
        ),
        user,
        branch,
        date_from,
        date_to,
    ).group_by(ZeroSellingRecord.sale_date, ZeroSellingRecord.branch_id, ZeroSellingRecord.branch)
    zero_rows = grouped.all()
    branch_ids = {row.branch_id for row in zero_rows if row.branch_id is not None}
    sales_counts: dict[tuple[date, str], int] = {}
    if branch_ids:
        sales_query = db.query(
            Sale.sale_date,
            Sale.branch_id,
            func.count(Sale.id).label("sales_slips"),
        ).filter(Sale.branch_id.in_(branch_ids))
        if date_from:
            sales_query = sales_query.filter(Sale.sale_date >= date_from)
        if date_to:
            sales_query = sales_query.filter(Sale.sale_date <= date_to)
        sales_counts = {
            (sale_date, branch_id): int(sales_slips)
            for sale_date, branch_id, sales_slips in sales_query.group_by(Sale.sale_date, Sale.branch_id).all()
        }

    rows = []
    for sale_date, branch_id, branch_name, zero_selling in zero_rows:
        sales_slips = sales_counts.get((sale_date, branch_id), 0) if branch_id else 0
        zero_count = int(zero_selling)
        denominator = sales_slips + zero_count
        rows.append(
            {
                "Date": sale_date.isoformat(),
                "Branch": branch_name,
                "SalesSlips": sales_slips,
                "ZeroSelling": zero_count,
                "ConversionRate": round((sales_slips / denominator) * 100, 2) if denominator else None,
            }
        )
    rows.sort(key=lambda row: (row["Date"], row["Branch"]), reverse=True)
    total = len(rows)
    if not export:
        start = (page - 1) * page_size
        rows = rows[start : start + page_size]
    return {"rows": rows, "total": total}
