from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.product import Product
from app.models.sale import Sale, SaleLine
from app.models.user import User
from app.services.pricing import (
    compute_profit,
    point_in_time_buying_price,
    purchase_price_history,
    stock_level_price_history,
)
from app.services.settings import (
    get_purchase_lookback_window_days,
    get_sale_list_window_days,
    get_stock_forward_fallback_window_days,
    get_stock_lookback_window_days,
)

router = APIRouter(prefix="/api/sales", tags=["sales"])


@router.get("")
def list_sales(
    date_from: date | None = Query(
        None, description="Only include sales on/after this date"
    ),
    date_to: date | None = Query(
        None, description="Only include sales on/before this date"
    ),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> list[dict]:
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
        .order_by(Sale.sale_date.desc(), Sale.slip_number, SaleLine.line_no)
    )
    if date_to is not None:
        query = query.filter(Sale.sale_date <= date_to)
    if user.branch_id is not None:
        query = query.filter(Sale.branch_id == user.branch_id)

    line_rows = query.all()
    product_ids = {product.id for _, _, product, _ in line_rows}
    purchase_history = purchase_price_history(db, product_ids)
    stock_history = stock_level_price_history(db, product_ids)
    forward_fallback_window_days = get_stock_forward_fallback_window_days(db)
    purchase_lookback_window_days = get_purchase_lookback_window_days(db)
    stock_lookback_window_days = get_stock_lookback_window_days(db)

    result = []
    for sale_line, sale, product, branch in line_rows:
        buying_price, buying_price_source = point_in_time_buying_price(
            purchase_history,
            stock_history,
            product.id,
            sale.sale_date,
            forward_fallback_window_days,
            purchase_lookback_window_days,
            stock_lookback_window_days,
        )
        profit, profit_margin_pct = compute_profit(
            buying_price, sale_line.qty, sale_line.net_amount
        )

        result.append(
            {
                "Branch": branch.name if branch else None,
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

    return result
