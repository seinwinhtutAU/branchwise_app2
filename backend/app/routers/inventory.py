from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.branch import Branch
from app.models.product import Product
from app.models.stock_level import StockLevel
from app.models.user import User

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.get("")
def list_inventory(user: User = Depends(get_current_app_user), db: Session = Depends(get_db)) -> list[dict]:
    """Current stock: the latest snapshot per product+branch, not full import history.

    stock_levels is append-only (every confirmed inventory import adds new
    rows), so "current stock" is defined as whichever row has the newest
    snapshot_at for a given (product_id, branch_id) pair — this is exactly
    what the ix_stock_levels_product_branch_snapshot index is for. branch_id
    is nullable, so the join back uses a null-safe comparison rather than
    `==` (NULL = NULL is never true in SQL).
    """
    latest = (
        db.query(
            StockLevel.product_id,
            StockLevel.branch_id,
            func.max(StockLevel.snapshot_at).label("snapshot_at"),
        )
        .group_by(StockLevel.product_id, StockLevel.branch_id)
        .subquery()
    )

    query = (
        db.query(StockLevel, Product, Branch)
        .join(Product, StockLevel.product_id == Product.id)
        .outerjoin(Branch, StockLevel.branch_id == Branch.id)
        .join(
            latest,
            (StockLevel.product_id == latest.c.product_id)
            & StockLevel.branch_id.is_not_distinct_from(latest.c.branch_id)
            & (StockLevel.snapshot_at == latest.c.snapshot_at),
        )
        .order_by(Product.stock_code)
    )
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
