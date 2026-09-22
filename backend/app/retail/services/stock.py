"""The shared "current stock" query.

stock_levels is append-only — every confirmed inventory import adds a fresh set of
snapshot rows, all stamped with that import's `snapshot_at` — so "current stock" has to
be defined against those snapshots. It is defined here as **the rows belonging to a
branch's most recent snapshot**: one count, one moment, one set of numbers.

It used to be the newest row *per product*, which sounds like the same thing and is not.
An inventory export is a full stock list, so a product that stops appearing in it has
stopped being stocked — but per-product-latest kept resurrecting its last known figure
and showing it as current. On 2026-09-05 that put 33 of AungThitSar's products on the
Inventory page carrying an older date than the count itself (the 5 Sep file had 911 rows;
those 33 were last seen on 4 Sep or earlier), and it quietly fed the dashboard too: stock
value counted goods no longer on the list, and dead stock counted products that could
never sell again because they were gone.

Rows from earlier snapshots are still there — this is a question of what "current" means,
not of deleting history. GET /api/inventory, the dashboard's stock summary, the chatbot's
get_current_stock tool and the Warning page's inventory-numeric check all read this one
query, so the definition cannot drift between them.
"""

from sqlalchemy import func
from sqlalchemy.orm import Query, Session

from app.models.branch import Branch
from app.retail.models.product import Product
from app.retail.models.stock_level import StockLevel


def latest_stock_query(db: Session, branch_id: str | None = None) -> Query:
    """(StockLevel, Product, Branch) rows from each branch's latest snapshot, ordered
    by nothing in particular — callers add their own ordering.

    `branch_id=None` (the default) is unscoped: every branch's latest snapshot, for a
    caller that genuinely needs all of them (an admin's "all branches" view) or that
    applies its own filter afterwards for a reason that can't be expressed here (e.g.
    data_quality.py's `_branch_filter`, shared across several differently-shaped
    queries). Passing a concrete `branch_id` filters *before* the grouping subquery
    runs, not just on the result — so Postgres only aggregates that one branch's rows
    instead of every branch's just to throw the rest away. Callers that already know
    which single branch they want should always pass it.

    `StockLevel.branch_id` is nullable, so the join back uses a null-safe comparison
    rather than `==` (NULL = NULL is never true in SQL).
    """
    latest_base = db.query(
        StockLevel.branch_id,
        func.max(StockLevel.snapshot_at).label("snapshot_at"),
    )
    if branch_id is not None:
        latest_base = latest_base.filter(StockLevel.branch_id == branch_id)
    latest = latest_base.group_by(StockLevel.branch_id).subquery()

    query = (
        db.query(StockLevel, Product, Branch)
        .join(Product, StockLevel.product_id == Product.id)
        .outerjoin(Branch, StockLevel.branch_id == Branch.id)
        .join(
            latest,
            StockLevel.branch_id.is_not_distinct_from(latest.c.branch_id)
            & (StockLevel.snapshot_at == latest.c.snapshot_at),
        )
    )
    if branch_id is not None:
        query = query.filter(StockLevel.branch_id == branch_id)
    return query
