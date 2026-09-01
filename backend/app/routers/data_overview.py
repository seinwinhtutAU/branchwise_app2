from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.product import Product
from app.models.sale import Sale, SaleLine
from app.models.user import User
from app.services.pricing import compute_profit, sale_line_pricer

router = APIRouter(prefix="/api/data-overview", tags=["data-overview"])


@router.get("")
def get_data_overview(
    user: User = Depends(get_current_app_user), db: Session = Depends(get_db)
) -> list[dict]:
    query = (
        db.query(SaleLine, Sale, Product, Branch)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .outerjoin(Branch, Sale.branch_id == Branch.id)
        .order_by(Sale.sale_date.desc(), Sale.slip_number.desc(), SaleLine.line_no.desc())
    )
    if user.branch_id is not None:
        query = query.filter(Sale.branch_id == user.branch_id)

    line_rows = query.all()
    price_for = sale_line_pricer(db, {product.id for _, _, product, _ in line_rows})

    result = []
    for sale_line, sale, product, branch in line_rows:
        buying_price, buying_price_source = price_for(product.id, sale.sale_date)
        profit, profit_margin_pct = compute_profit(
            buying_price, sale_line.qty, sale_line.net_amount
        )

        result.append(
            {
                "Branch": branch.name if branch else None,
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

    return result
