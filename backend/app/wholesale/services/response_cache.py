"""Wholesale's own "data version" for the shared response cache in app.services.

app.services.response_cache.cached(key, compute) is domain-agnostic — it just needs an
opaque key and a callable. import_data_version (also in app.services.response_cache) is
retail-specific (it reads ImportBatch), so wholesale gets its own version function here
instead of teaching the shared cache module about wholesale's tables, keeping the
retail/wholesale package boundary intact (see CLAUDE.md's "Backend: a shared core plus
retail/ and wholesale/ packages").

Same idea as import_data_version: a cheap aggregate over whichever tables the caller
actually reads, so a write naturally changes the version and the next request misses
the cache instead of serving stale figures. Monitoring and Reports both read shipments,
receivings, supplier vouchers, customer orders and customer deliveries, so all five are
included. WholesaleStockMovement (the delivery log) has no updated_at column and
create_delivery (the single-item delivery endpoint, as opposed to create_delivery_batch)
does not bump its parent order's updated_at either — so the movement table's own
max(created_at)+count is tracked directly rather than only via CustomerOrder.updated_at.
"""

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.wholesale.models.entities import (
    CustomerOrder,
    Receiving,
    Shipment,
    SupplierVoucher,
    WholesaleStockMovement,
)


def wholesale_data_version(db: Session, branch_id: str | None) -> str:
    parts: list[str] = []
    for model in (Shipment, Receiving, SupplierVoucher, CustomerOrder):
        query = db.query(func.max(model.updated_at), func.count(model.id))
        if branch_id is not None:
            query = query.filter(model.branch_id == branch_id)
        updated_at, row_count = query.one()
        parts.append(f"{updated_at or ''}:{row_count}")

    movement_query = db.query(
        func.max(WholesaleStockMovement.created_at), func.count(WholesaleStockMovement.id)
    )
    if branch_id is not None:
        movement_query = movement_query.filter(WholesaleStockMovement.branch_id == branch_id)
    movement_created_at, movement_count = movement_query.one()
    parts.append(f"{movement_created_at or ''}:{movement_count}")

    return "|".join(parts)
