from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.retail.models.product import Product
from app.retail.models.sale import Sale, SaleLine
from app.models.user import User
from app.retail.services.pricing import compute_profit, sale_line_pricer
from app.services.settings import get_sale_list_window_days
from app.retail.routers.common import require_retail

router = APIRouter(prefix="/api/sales", tags=["sales"], dependencies=[Depends(require_retail)])

# Mirrors Data Overview's PAGE_SIZE — a page of results here is exactly one page of the
# table on screen, so SimpleDataTable never has to hold more than that in memory either.
PAGE_SIZE = 20


@router.get("/date-bounds")
def sales_date_bounds(
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    query = db.query(func.min(Sale.sale_date))
    if user.branch_id is not None:
        query = query.filter(Sale.branch_id == user.branch_id)
    earliest_date = query.scalar()
    return {"earliest_date": earliest_date.isoformat() if earliest_date else None}


@router.get("")
def list_sales(
    date_from: date | None = Query(
        None, description="Only include sales on/after this date"
    ),
    date_to: date | None = Query(
        None, description="Only include sales on/before this date"
    ),
    search: str | None = Query(None, description="Matches stock code or description"),
    branch: str | None = Query(None, description="Branch name"),
    page: int = Query(1, ge=1),
    page_size: int = Query(PAGE_SIZE, ge=1, le=500),
    export: bool = Query(
        False, description="Ignore paging and return every matching row, for CSV/Excel download"
    ),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    if date_from is None:
        # Sale history only ever grows (daily imports across 4 branches), so an unbounded
        # "select everything" would get slower every day. Bound the default query to the
        # business-wide sale_list_window_days setting; an explicit date_from widens or
        # removes this bound.
        date_from = (date_to or date.today()) - timedelta(days=get_sale_list_window_days(db) - 1)

    query = (
        db.query(SaleLine, Sale, Product, Branch)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .outerjoin(Branch, Sale.branch_id == Branch.id)
        .filter(Sale.sale_date >= date_from)
    )
    if date_to is not None:
        query = query.filter(Sale.sale_date <= date_to)
    if user.branch_id is not None:
        query = query.filter(Sale.branch_id == user.branch_id)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (Product.stock_code.ilike(like)) | (Product.description.ilike(like))
        )
    if branch:
        query = query.filter(Branch.name == branch)

    total = query.count()

    query = query.order_by(Sale.sale_date.desc(), Sale.slip_number, SaleLine.line_no)
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
                "Time": sale.sale_time,
                "SlipID": sale.slip_id,
                "SlipNumber": sale.slip_number,
                "LineNo": sale_line.line_no,
                "LineID": sale_line.line_id,
                "StockCode": product.stock_code,
                "Description": product.description,
                "Selling_Price": sale_line.selling_price,
                "Qty": sale_line.qty,
                "UOM": sale_line.uom,
                "Discount_Amount": sale_line.discount_amount,
                "Amount": sale_line.amount,
                "Net_Amount": sale_line.net_amount,
                "Location": sale.location_raw,
                "Buying_Price": buying_price,
                "Buying_Price_Source": buying_price_source,
                "Profit": profit,
                "Profit_Margin_Pct": profit_margin_pct,
            }
        )

    return {"rows": rows, "total": total}
