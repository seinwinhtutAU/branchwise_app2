from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.product import Product
from app.models.purchase import Purchase, PurchaseLine
from app.models.user import User

router = APIRouter(prefix="/api/purchases", tags=["purchases"])


@router.get("")
def list_purchases(user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> list[dict]:
    query = (
        db.query(PurchaseLine, Purchase, Product, Branch)
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .join(Product, PurchaseLine.product_id == Product.id)
        .outerjoin(Branch, Purchase.branch_id == Branch.id)
        .order_by(Purchase.purchase_date.desc())
    )
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
