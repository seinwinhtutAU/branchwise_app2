from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.product import Product
from app.models.purchase import Purchase, PurchaseLine
from app.models.user import User
from app.services.settings import get_purchase_list_window_days

router = APIRouter(prefix="/api/purchases", tags=["purchases"])


@router.get("")
def list_purchases(
    date_from: date | None = Query(None, description="Only include purchases on/after this date"),
    date_to: date | None = Query(None, description="Only include purchases on/before this date"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    if date_from is None:
        # Mirrors sales.py: purchase history only ever grows, so bound the default query
        # to the business-wide purchase_list_window_days setting; an explicit date_from
        # widens or removes this bound.
        date_from = (date_to or date.today()) - timedelta(days=get_purchase_list_window_days(db) - 1)

    query = (
        db.query(PurchaseLine, Purchase, Product, Branch)
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .join(Product, PurchaseLine.product_id == Product.id)
        .outerjoin(Branch, Purchase.branch_id == Branch.id)
        .filter(Purchase.purchase_date >= date_from)
        .order_by(Purchase.purchase_date.desc())
    )
    if date_to is not None:
        query = query.filter(Purchase.purchase_date <= date_to)
    if user.branch_id is not None:
        query = query.filter(Purchase.branch_id == user.branch_id)

    return [
        {
            "Branch": branch.name if branch else None,
            "Date": purchase.purchase_date.isoformat(),
            "StockCode": product.stock_code,
            "Description": product.description,
            "Quantity": purchase_line.quantity,
            "UOM": purchase_line.uom,
            "Buying_Price": purchase_line.buying_price,
            "Location": purchase.location_raw,
        }
        for purchase_line, purchase, product, branch in query.all()
    ]
