from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.product import Product
from app.models.sale import Sale, SaleLine
from app.models.user import User
from app.services.pricing import latest_purchase_buying_prices, latest_stock_level_buying_prices

router = APIRouter(prefix="/api/sales", tags=["sales"])


@router.get("")
def list_sales(user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> list[dict]:
    query = (
        db.query(SaleLine, Sale, Product, Branch)
        .join(Sale, SaleLine.sale_id == Sale.id)
        .join(Product, SaleLine.product_id == Product.id)
        .outerjoin(Branch, Sale.branch_id == Branch.id)
        .order_by(Sale.sale_date.desc(), Sale.slip_number, SaleLine.line_no)
    )
    if user.branch_id is not None:
        query = query.filter(Sale.branch_id == user.branch_id)

    line_rows = query.all()
    product_ids = {product.id for _, _, product, _ in line_rows}
    purchase_prices = latest_purchase_buying_prices(db, product_ids)
    stock_level_prices = latest_stock_level_buying_prices(db, product_ids)

    result = []
    for sale_line, sale, product, branch in line_rows:
        buying_price = purchase_prices.get(product.id, stock_level_prices.get(product.id))
        qty = sale_line.qty
        net_amount = sale_line.net_amount
        profit = None
        profit_margin_pct = None
        if buying_price is not None and qty is not None and net_amount is not None:
            profit = round(float(net_amount) - float(buying_price) * float(qty), 2)
            profit_margin_pct = round(profit / float(net_amount) * 100, 2) if net_amount else None

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
                "Profit": profit,
                "Profit_Margin_Pct": profit_margin_pct,
            }
        )

    return result
