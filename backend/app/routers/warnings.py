from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.services import data_quality

router = APIRouter(prefix="/api/warnings", tags=["warnings"])


@router.get("")
def get_warnings(
    days: int = Query(1, ge=1, le=365, description="How many days back (including today) to check Sale/Purchase numeric issues"),
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> dict:
    # Inventory only ever checks the latest snapshot (see inventory_numeric_warnings), and
    # the daily reconciliation check is inherently scoped to the gap between two snapshots
    # — neither grows with total history, so only the two per-transaction checks below need
    # this window to stay fast as sale/purchase history accumulates.
    since = date.today() - timedelta(days=days - 1)
    reconciliation_mismatch, reconciliation_uom = data_quality.inventory_reconciliation_warnings(db, user)

    sections = [
        {
            "id": "sale_numeric",
            "title": "Sale — fix these numbers",
            "description": "A price, quantity, or amount looks wrong on these sale lines — check the slip and re-import if needed.",
            "severity": "warning",
            "rows": data_quality.sale_numeric_warnings(db, user, since=since),
        },
        {
            "id": "inventory_numeric",
            "title": "Inventory — fix these numbers",
            "description": (
                "A quantity or price looks wrong on the latest stock snapshot for these — recount or re-import the corrected file."
            ),
            "severity": "warning",
            "rows": data_quality.inventory_numeric_warnings(db, user),
        },
        {
            "id": "purchase_numeric",
            "title": "Purchase — fix these numbers",
            "description": "A quantity or price looks wrong on these purchase lines — check the invoice and re-import if needed.",
            "severity": "warning",
            "rows": data_quality.purchase_numeric_warnings(db, user, since=since),
        },
        {
            "id": "sale_missing_product",
            "title": "Inventory — add missing records (found via Sale)",
            "description": "These stock codes have been sold but have no inventory record yet — add one so stock levels stay accurate.",
            "severity": "warning",
            "rows": data_quality.sale_missing_product_warnings(db, user),
        },
        {
            "id": "purchase_missing_product",
            "title": "Inventory — add missing records (found via Purchase)",
            "description": "These stock codes have been purchased but have no inventory record yet — add one so stock levels stay accurate.",
            "severity": "warning",
            "rows": data_quality.purchase_missing_product_warnings(db, user),
        },
        {
            "id": "reconciliation_uom",
            "title": "Daily inventory check — verify by hand",
            "description": (
                "These were sold or purchased in more than one unit since the last inventory snapshot, "
                "so the automatic mismatch check may not be reliable for them — worth a manual look."
            ),
            "severity": "warning",
            "rows": reconciliation_uom,
        },
        {
            "id": "reconciliation_mismatch",
            "title": "Daily inventory check — recount these",
            "description": (
                "The latest inventory snapshot doesn't match what it should be (previous snapshot + "
                "purchases − sales since then) — recount the stock or check for a missing import."
            ),
            "severity": "critical",
            "rows": reconciliation_mismatch,
        },
    ]
    return {"sections": sections}
