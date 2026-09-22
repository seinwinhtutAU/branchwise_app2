"""Finds calendar days with no Sale or Inventory data at all for a retail branch, as
opposed to import_health.py (was this upload parsed/confirmed correctly?) or the
freshness endpoint (is today's file in yet?). A gap here means either the branch was
genuinely closed that day or someone forgot to import — the check can't tell which, so
it lists every gap and lets a BranchClosure row (marked by a human) explain the ones
that were closures. Purchase is excluded: it only happens when a branch restocks, so a
day with no purchase import is normal, not a gap (see docs' "purchases are not daily").
"""

from datetime import date, datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User
from app.retail.models.branch_closure import BranchClosure
from app.retail.models.import_batch import ImportType
from app.retail.models.sale import Sale
from app.retail.models.stock_level import StockLevel
from app.services.branches import list_retail_branches

# The two daily-expected import types this check covers.
CHECKED_TYPES = (ImportType.SALES, ImportType.INVENTORY)


def _existing_sale_dates(db: Session) -> dict[str, set[date]]:
    """One query for every branch's distinct sale dates — not one query per branch."""
    rows = db.query(Sale.branch_id, Sale.sale_date).distinct().all()
    result: dict[str, set[date]] = {}
    for branch_id, sale_date in rows:
        if branch_id is None or sale_date is None:
            continue
        result.setdefault(branch_id, set()).add(sale_date)
    return result


def _existing_inventory_dates(db: Session) -> dict[str, set[date]]:
    """StockLevel keeps full history (many snapshots can land on the same day), so this
    reads the raw timestamps and truncates to a date in Python rather than doing a
    second aggregate query — the whole database is small enough that this is cheap,
    and it sidesteps a date-truncation function behaving differently across the
    Postgres/SQLite dialects this app runs against (production vs. tests)."""
    rows = db.query(StockLevel.branch_id, StockLevel.snapshot_at).all()
    result: dict[str, set[date]] = {}
    for branch_id, snapshot_at in rows:
        if branch_id is None or snapshot_at is None:
            continue
        result.setdefault(branch_id, set()).add(snapshot_at.date())
    return result


def _missing_days(existing: set[date], through: date) -> list[date]:
    """Every day from this branch's first-ever record through `through` (inclusive)
    that isn't in `existing`. Diffed as sets, not checked one day at a time."""
    if not existing:
        return []
    start = min(existing)
    if start > through:
        return []
    all_days = {start + timedelta(days=n) for n in range((through - start).days + 1)}
    return sorted(all_days - existing)


def _active_closures(db: Session, branch_ids: list[str]) -> dict[tuple[str, ImportType, date], BranchClosure]:
    rows = (
        db.query(BranchClosure)
        .filter(
            BranchClosure.branch_id.in_(branch_ids),
            BranchClosure.closure_type.in_(CHECKED_TYPES),
            BranchClosure.closed_at.is_not(None),
        )
        .all()
    )
    return {(row.branch_id, row.closure_type, row.closure_date): row for row in rows}


def _day_entry(day: date, closure: BranchClosure | None) -> dict:
    if closure is None:
        return {"date": day.isoformat(), "status": "open", "note": None, "closed_at": None, "closed_by_name": None}
    return {
        "date": day.isoformat(),
        "status": "closed",
        "note": closure.note,
        "closed_at": closure.closed_at.isoformat() if closure.closed_at else None,
        "closed_by_name": closure.closed_by_user.name if closure.closed_by_user else None,
    }


def build_import_completeness(db: Session, user: User) -> dict:
    branches_query = list_retail_branches(db)
    if user.branch_id is not None:
        branches_query = branches_query.filter(Branch.id == user.branch_id)
    branches = branches_query.all()

    through = date.today() - timedelta(days=1)
    sale_dates_by_branch = _existing_sale_dates(db)
    inventory_dates_by_branch = _existing_inventory_dates(db)
    closures = _active_closures(db, [b.id for b in branches])

    results: list[dict] = []
    for branch in branches:
        sales_missing = _missing_days(sale_dates_by_branch.get(branch.id, set()), through)
        inventory_missing = _missing_days(inventory_dates_by_branch.get(branch.id, set()), through)
        sales_days = [
            _day_entry(day, closures.get((branch.id, ImportType.SALES, day))) for day in sales_missing
        ]
        inventory_days = [
            _day_entry(day, closures.get((branch.id, ImportType.INVENTORY, day))) for day in inventory_missing
        ]
        results.append(
            {
                "branch_id": branch.id,
                "branch_name": branch.name,
                "sales": {
                    "days": sales_days,
                    "open_count": sum(1 for d in sales_days if d["status"] == "open"),
                },
                "inventory": {
                    "days": inventory_days,
                    "open_count": sum(1 for d in inventory_days if d["status"] == "open"),
                },
            }
        )

    return {"checked_through": through.isoformat(), "branches": results}


def _parse_closure_type(import_type: str) -> ImportType:
    try:
        parsed = ImportType(import_type)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown import type: {import_type}") from None
    if parsed not in CHECKED_TYPES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Only sales or inventory days can be marked as closed"
        )
    return parsed


def _get_or_create_closure(
    db: Session, branch_id: str, closure_type: ImportType, closure_date: date
) -> BranchClosure:
    closure = (
        db.query(BranchClosure)
        .filter(
            BranchClosure.branch_id == branch_id,
            BranchClosure.closure_type == closure_type,
            BranchClosure.closure_date == closure_date,
        )
        .one_or_none()
    )
    if closure is None:
        closure = BranchClosure(branch_id=branch_id, closure_type=closure_type, closure_date=closure_date)
        db.add(closure)
    return closure


def close_missing_day(
    db: Session, branch_id: str, import_type: str, closure_date: date, note: str | None, user: User
) -> BranchClosure:
    if db.get(Branch, branch_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown branch")
    closure_type = _parse_closure_type(import_type)
    closure = _get_or_create_closure(db, branch_id, closure_type, closure_date)
    closure.note = note
    closure.closed_at = datetime.now()
    closure.closed_by = user.id
    db.commit()
    return closure


def reopen_missing_day(db: Session, branch_id: str, import_type: str, closure_date: date, user: User) -> None:
    closure_type = _parse_closure_type(import_type)
    closure = (
        db.query(BranchClosure)
        .filter(
            BranchClosure.branch_id == branch_id,
            BranchClosure.closure_type == closure_type,
            BranchClosure.closure_date == closure_date,
        )
        .one_or_none()
    )
    if closure is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "This day was never marked as closed")
    closure.closed_at = None
    closure.closed_by = None
    db.commit()
