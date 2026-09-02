from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.product import Product
from app.models.stock_level import StockLevel
from app.models.user import User
from app.services.dashboard import compute_stock_health
from app.services.stock import latest_stock_query

router = APIRouter(prefix="/api/inventory", tags=["inventory"])

# Matches the other list endpoints' page size. Low/dead stock are bounded by product x
# branch count rather than transaction volume, so this is for a consistent page size —
# not because either table grows unbounded the way sales/purchases do.
PAGE_SIZE = 50


def _filter_and_page(
    rows: list[dict],
    *,
    search: str | None,
    branch: str | None,
    page: int,
    page_size: int,
    export: bool,
) -> dict:
    """Filters/paginates an already-built list of response rows (PascalCase keys, same
    shape returned to the client) — these come from compute_stock_health's Python list,
    not a SQL query, so this is where search/branch/paging apply instead of `.filter()`."""
    if search:
        needle = search.lower()
        rows = [
            row
            for row in rows
            if needle in row["StockCode"].lower() or needle in (row["Description"] or "").lower()
        ]
    if branch:
        rows = [row for row in rows if row["Branch"] == branch]

    total = len(rows)
    page_rows = rows if export else rows[(page - 1) * page_size : (page - 1) * page_size + page_size]
    return {"rows": page_rows, "total": total}


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


@router.get("/low-stock")
def list_low_stock(
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
    """Every product estimated to run out soon (Critical/Low/Watch), uncapped — the
    Inventory dashboard tab shows the same figures but only its top
    LOW_STOCK_ITEMS_LIMIT; this is the "view all" page it links to. See
    compute_stock_health for the shared status/days-left computation."""
    low_stock_items, _ = compute_stock_health(db, user.branch_id)
    rows = [
        {
            "Branch": item["branch"],
            "StockCode": item["stock_code"],
            "Description": item["description"],
            "Status": item["status"],
            "On_Hand_Qty": item["on_hand_qty"],
            "Days_Left": item["days_left"],
        }
        for item in low_stock_items
    ]
    return _filter_and_page(rows, search=search, branch=branch, page=page, page_size=page_size, export=export)


@router.get("/dead-stock")
def list_dead_stock(
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
    """Every product still on the shelf with no sale in DEAD_STOCK_WINDOW_DAYS,
    uncapped — the Inventory dashboard tab shows the same figures but only its top
    DEAD_STOCK_ITEMS_LIMIT; this is the "view all" page it links to."""
    _, dead_stock_items = compute_stock_health(db, user.branch_id)
    rows = [
        {
            "Branch": item["branch"],
            "StockCode": item["stock_code"],
            "Description": item["description"],
            "Category": item["category"],
            "On_Hand_Qty": item["on_hand_qty"],
            "Last_Sold_At": item["last_sold_at"],
            "Days_Since_Last_Sale": item["days_since_last_sale"],
        }
        for item in dead_stock_items
    ]
    return _filter_and_page(rows, search=search, branch=branch, page=page, page_size=page_size, export=export)
