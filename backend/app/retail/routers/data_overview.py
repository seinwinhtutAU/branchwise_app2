from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Query as ORMQuery
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.retail.models.product import Product
from app.retail.models.sale import Sale, SaleLine
from app.models.user import User
from app.retail.services.pricing import compute_profit, sale_line_pricer
from app.retail.routers.common import require_retail_operations

router = APIRouter(prefix="/api/data-overview", tags=["data-overview"], dependencies=[Depends(require_retail_operations)])

# Matches the frontend's usePagination default, so a page of results here is exactly
# one page of the table on screen.
PAGE_SIZE = 20


def _scoped_query(db: Session, user: User) -> ORMQuery:
    query = (
        db.query(SaleLine, Sale, Product, Branch)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .outerjoin(Branch, Sale.branch_id == Branch.id)
    )
    if user.branch_id is not None:
        query = query.filter(Sale.branch_id == user.branch_id)
    return query


@router.get("/date-bounds")
def data_overview_date_bounds(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    earliest_date = _scoped_query(db, user).with_entities(func.min(Sale.sale_date)).scalar()
    return {"earliest_date": earliest_date.isoformat() if earliest_date else None}


@router.get("")
def get_data_overview(
    search: str | None = Query(None, description="Matches stock code or description"),
    branch: str | None = Query(None, description="Branch name"),
    group: str | None = Query(None, description="Product group"),
    date_from: date | None = Query(None, description="Only include sales on/after this date"),
    date_to: date | None = Query(None, description="Only include sales on/before this date"),
    page: int = Query(1, ge=1),
    page_size: int = Query(PAGE_SIZE, ge=1, le=1000),
    export: bool = Query(
        False, description="Ignore paging and return every matching row, for CSV/Excel download"
    ),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    # This table has no natural date bound the way Sale/Warning windows do — a user
    # legitimately wants to search or export any historical slip. So rather than capping
    # the range, this fetches one page of matching rows at a time (mirroring the table's
    # on-screen pagination) instead of every sale line ever imported on every load, which
    # is what used to make this endpoint the single biggest source of Supabase egress.
    query = _scoped_query(db, user)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (Product.stock_code.ilike(like)) | (Product.description.ilike(like))
        )
    if branch:
        query = query.filter(Branch.name == branch)
    if group:
        query = query.filter(Product.group_name == group)
    if date_from:
        query = query.filter(Sale.sale_date >= date_from)
    if date_to:
        query = query.filter(Sale.sale_date <= date_to)

    total = query.count()

    query = query.order_by(
        Sale.sale_date.desc(), Sale.slip_number.desc(), SaleLine.line_no.desc()
    )
    if not export:
        query = query.offset((page - 1) * page_size).limit(page_size)
    line_rows = query.all()
    price_for = sale_line_pricer(db, {product.id for _, _, product, _ in line_rows})

    rows = []
    for sale_line, sale, product, branch_row in line_rows:
        buying_price, buying_price_source = price_for(product.id, sale.sale_date)
        profit, profit_margin_pct = compute_profit(
            buying_price, sale_line.qty, sale_line.net_amount
        )
        rows.append(
            {
                "Branch": branch_row.name if branch_row else None,
                "Date": sale.sale_date.isoformat(),
                "SlipID": sale.slip_id,
                "SlipNumber": sale.slip_number,
                "LineNo": sale_line.line_no,
                "LineID": sale_line.line_id,
                "StockCode": product.stock_code,
                "Description": product.description,
                "Location": sale.location_raw,
                "Selling_Price": sale_line.selling_price,
                "Qty": sale_line.qty,
                "UOM": sale_line.uom,
                "Discount_Amount": sale_line.discount_amount,
                "Amount": sale_line.amount,
                "Net_Amount": sale_line.net_amount,
                "Time": sale.sale_time,
                "Buying_Price": buying_price,
                "Buying_Price_Source": buying_price_source,
                "Group": product.group_name,
                "profit": profit,
                "profit_margin_pct": profit_margin_pct,
            }
        )

    # Cheap (just distinct branch/group names, no sale-line data) — sent alongside every
    # page so the filter dropdowns always list every option, not just what's on this page.
    groups = [
        row[0]
        for row in _scoped_query(db, user)
        .with_entities(Product.group_name)
        .filter(Product.group_name.isnot(None))
        .distinct()
        .order_by(Product.group_name)
        .all()
    ]
    branches = [
        row[0]
        for row in _scoped_query(db, user)
        .with_entities(Branch.name)
        .filter(Branch.name.isnot(None))
        .distinct()
        .order_by(Branch.name)
        .all()
    ]

    return {"rows": rows, "total": total, "groups": groups, "branches": branches}
