from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.product import Product
from app.models.stock_level import StockLevel
from app.models.user import User
from app.services.stock import latest_stock_query

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("")
def list_inventory(user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> list[dict]:
    """Current stock: the latest snapshot per product+branch, not full import
    history (see app/services/stock.py) — this is exactly what the
    ix_stock_levels_product_branch_snapshot index is for."""
    query = latest_stock_query(db).order_by(Product.stock_code)
    if user.branch_id is not None:
        query = query.filter(StockLevel.branch_id == user.branch_id)

    return [
        {
            "Branch": branch.name if branch else None,
            "Snapshot_At": stock_level.snapshot_at.isoformat(),
            "StockCode": product.stock_code,
            "Description": product.description,
            "Group": product.group_name,
            "On_Hand_Qty": stock_level.on_hand_qty,
            "Buying_Price": stock_level.buying_price,
            "Selling_Price": stock_level.selling_price,
            "Location": stock_level.location_raw,
        }
        for stock_level, product, branch in query.all()
    ]
