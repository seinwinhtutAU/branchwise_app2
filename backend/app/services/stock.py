"""The shared "current stock" query.

stock_levels is append-only (every confirmed inventory import adds new snapshot
rows), so "current stock" is defined as whichever row has the newest snapshot_at
per (product_id, branch_id) pair. GET /api/inventory, the chatbot's
get_current_stock tool, and the Warning page's inventory-numeric check all use
this same definition — keeping the query in one place keeps them in sync.
"""

from sqlalchemy import func
from sqlalchemy.orm import Query, Session

from app.models.branch import Branch
from app.models.product import Product
from app.models.stock_level import StockLevel


def latest_stock_query(db: Session) -> Query:
    """(StockLevel, Product, Branch) rows for the latest snapshot per
    product+branch, unordered and unscoped — callers add their own branch
    filters/ordering. branch_id is nullable, so the join back uses a null-safe
    comparison rather than `==` (NULL = NULL is never true in SQL)."""
    latest = (
        db.query(
            StockLevel.product_id,
            StockLevel.branch_id,
            func.max(StockLevel.snapshot_at).label("snapshot_at"),
        )
        .group_by(StockLevel.product_id, StockLevel.branch_id)
        .subquery()
    )
    return (
        db.query(StockLevel, Product, Branch)
        .join(Product, StockLevel.product_id == Product.id)
        .outerjoin(Branch, StockLevel.branch_id == Branch.id)
        .join(
            latest,
            (StockLevel.product_id == latest.c.product_id)
            & StockLevel.branch_id.is_not_distinct_from(latest.c.branch_id)
            & (StockLevel.snapshot_at == latest.c.snapshot_at),
        )
    )
