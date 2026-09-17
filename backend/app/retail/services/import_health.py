"""Checks backing the "Import Health" nav page — whether the cleaning/confirm step
itself behaved correctly for a given upload, as opposed to `data_quality.py`'s checks,
which look at data that's already been saved. See docs/import_health.md for the full
design rationale (this module implements it).

Each import type fails differently at confirm time, so each has its own check:
Sales can silently *skip* a real sale (its slip_id collided with another branch's —
see the 2026-08-30 incident this feature exists because of), Purchase has no dedup
at all so it can silently *double-count* a re-uploaded invoice, and Inventory keeps
full history by design so the risk is a *partial/bad parse* rather than a duplicate.

Every check below returns only the batches/rows worth a look — same convention as
`data_quality.py`'s warning checks — not an "everything is fine" row per batch.
"""

from datetime import date, datetime, timedelta
from statistics import median

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.retail.models.import_batch import ImportBatch, ImportBatchStatus, ImportType
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.stock_level import StockLevel
from app.models.user import User
from app.services.branches import list_retail_branches

# A skip rate this high is well outside the 0-4% normal range seen on real re-uploads
# (see docs/import_health.md) — the incident that motivated this check was 41%. A
# minimum skipped count keeps a tiny file (e.g. 1 of 6 slips = 17%) from flagging on
# noise alone.
SALES_SKIP_RATE_THRESHOLD = 0.15
SALES_SKIP_MIN_COUNT = 5

# How far back to look for a possible duplicate of a Purchase batch, and how close two
# batches' totals need to be (as a fraction of the larger) to call them a likely match.
PURCHASE_DUPLICATE_LOOKBACK_DAYS = 60
PURCHASE_DUPLICATE_AMOUNT_TOLERANCE_PCT = 0.02

# An Inventory batch's product count is compared against the median of that branch's
# last N completed Inventory batches; flagged if it falls below half that baseline. At
# least MIN prior batches are required before a baseline is trusted at all — a brand
# new branch's first few imports have nothing meaningful to compare against yet.
INVENTORY_BASELINE_LOOKBACK_BATCHES = 10
INVENTORY_BASELINE_MIN_BATCHES = 3
INVENTORY_ANOMALY_RATIO = 0.5

# A manual data-recovery replay (re-running a historical batch's stored preview_data
# through persist_sales to catch slips a since-fixed bug wrongly skipped — see
# docs/import_health.md's "Known simplifications", there is no in-page recovery
# action yet) is *expected* to skip most of its rows: that's it correctly avoiding
# re-creating what's already there, not a sign of anything wrong. Flagging it would
# be a false positive, so any batch whose filename carries this convention's prefix
# (the 2026-08-30 incident recovery used exactly this) is excluded from the skip-rate
# check. Whoever formalizes an in-page recovery action should keep tagging its
# resulting batches this way, or give this check a more structural signal to key off.
RECOVERY_REPLAY_FILENAME_PREFIX = "[recovery replay] "


def _branch_names(db: Session) -> dict[str, str]:
    return {b.id: b.name for b in list_retail_branches(db).all()}


def _branch_scoped_batches(db: Session, user: User, import_type: ImportType, since: date):
    query = db.query(ImportBatch).filter(
        ImportBatch.import_type == import_type,
        ImportBatch.status == ImportBatchStatus.COMPLETED,
        ImportBatch.created_at >= since,
        ImportBatch.health_dismissed_at.is_(None),
    )
    if user.branch_id is not None:
        query = query.filter(ImportBatch.branch_id == user.branch_id)
    return query.order_by(ImportBatch.created_at.desc()).all()


def _can_access_batch(user: User, batch: ImportBatch) -> bool:
    """Same rule as imports.py's history endpoints: admin (no fixed branch) can act on
    any batch, everyone else only their own branch's."""
    return user.branch_id is None or batch.branch_id == user.branch_id


def dismiss_batch(db: Session, batch_id: str, user: User) -> ImportBatch:
    batch = db.get(ImportBatch, batch_id)
    if batch is None or not _can_access_batch(user, batch):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")
    batch.health_dismissed_at = datetime.now()
    batch.health_dismissed_by = user.id
    db.commit()
    return batch


def undismiss_batch(db: Session, batch_id: str, user: User) -> ImportBatch:
    batch = db.get(ImportBatch, batch_id)
    if batch is None or not _can_access_batch(user, batch):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import batch not found")
    batch.health_dismissed_at = None
    batch.health_dismissed_by = None
    db.commit()
    return batch


def _review_row(batch: ImportBatch, branch_names: dict[str, str], note: str, status: str) -> dict:
    return {
        "batch_id": batch.id,
        "import_type": batch.import_type.value,
        "branch_id": batch.branch_id,
        "branch_name": branch_names.get(batch.branch_id, "—"),
        "filename": batch.filename,
        "confirmed_at": batch.created_at.isoformat(),
        "note": note,
        "status": status,
    }


def sales_skip_rate_reviews(db: Session, user: User, since: date) -> list[dict]:
    branch_names = _branch_names(db)
    rows = []
    for batch in _branch_scoped_batches(db, user, ImportType.SALES, since):
        if (batch.filename or "").startswith(RECOVERY_REPLAY_FILENAME_PREFIX):
            continue
        summary = batch.summary or {}
        created = summary.get("sales_created", 0)
        skipped = summary.get("sales_skipped_duplicate", 0)
        total = created + skipped
        if total == 0 or skipped < SALES_SKIP_MIN_COUNT:
            continue
        skip_rate = skipped / total
        if skip_rate < SALES_SKIP_RATE_THRESHOLD:
            continue
        rows.append(
            _review_row(
                batch,
                branch_names,
                f"{skipped:,} of {total:,} slips skipped ({skip_rate:.0%}) — higher than the "
                "usual 0-4% seen on a normal re-upload",
                "review",
            )
        )
    return rows


def purchase_duplicate_reviews(db: Session, user: User, since: date) -> list[dict]:
    lookback = since - timedelta(days=PURCHASE_DUPLICATE_LOOKBACK_DAYS)
    query = (
        db.query(ImportBatch)
        .filter(
            ImportBatch.import_type == ImportType.PURCHASE,
            ImportBatch.status == ImportBatchStatus.COMPLETED,
            ImportBatch.created_at >= lookback,
        )
    )
    if user.branch_id is not None:
        query = query.filter(ImportBatch.branch_id == user.branch_id)
    batches = query.order_by(ImportBatch.created_at).all()
    if len(batches) < 2:
        return []

    totals = dict(
        db.query(Purchase.import_batch_id, func.sum(PurchaseLine.quantity * PurchaseLine.buying_price))
        .join(PurchaseLine, PurchaseLine.purchase_id == Purchase.id)
        .filter(Purchase.import_batch_id.in_([b.id for b in batches]))
        .group_by(Purchase.import_batch_id)
        .all()
    )

    branch_names = _branch_names(db)
    rows = []
    for batch in batches:
        if batch.created_at.date() < since or batch.health_dismissed_at is not None:
            continue  # only flag non-dismissed batches confirmed within the requested window
        total = totals.get(batch.id)
        if not total:
            continue
        for other in batches:
            if other.id == batch.id or other.branch_id != batch.branch_id:
                continue
            other_total = totals.get(other.id)
            if not other_total:
                continue
            larger = max(total, other_total)
            if larger == 0 or abs(total - other_total) / larger > PURCHASE_DUPLICATE_AMOUNT_TOLERANCE_PCT:
                continue
            rows.append(
                _review_row(
                    batch,
                    branch_names,
                    f"Total {total:,.2f} closely matches {other.filename or 'another batch'}'s "
                    f"total from {other.created_at.date().isoformat()} — check this isn't the "
                    "same invoice confirmed twice",
                    "possible_duplicate",
                )
            )
            break
    return rows


def inventory_anomaly_reviews(db: Session, user: User, since: date) -> list[dict]:
    branch_names = _branch_names(db)
    rows = []
    for batch in _branch_scoped_batches(db, user, ImportType.INVENTORY, since):
        baseline_batches = (
            db.query(ImportBatch.id)
            .filter(
                ImportBatch.import_type == ImportType.INVENTORY,
                ImportBatch.status == ImportBatchStatus.COMPLETED,
                ImportBatch.branch_id == batch.branch_id,
                ImportBatch.created_at < batch.created_at,
            )
            .order_by(ImportBatch.created_at.desc())
            .limit(INVENTORY_BASELINE_LOOKBACK_BATCHES)
            .all()
        )
        if len(baseline_batches) < INVENTORY_BASELINE_MIN_BATCHES:
            continue

        baseline_ids = [b.id for b in baseline_batches] + [batch.id]
        counts = dict(
            db.query(StockLevel.import_batch_id, func.count(func.distinct(StockLevel.product_id)))
            .filter(StockLevel.import_batch_id.in_(baseline_ids))
            .group_by(StockLevel.import_batch_id)
            .all()
        )
        this_count = counts.get(batch.id, 0)
        baseline_counts = [counts.get(b.id, 0) for b in baseline_batches]
        baseline_median = median(baseline_counts)
        if baseline_median == 0 or this_count >= baseline_median * INVENTORY_ANOMALY_RATIO:
            continue
        rows.append(
            _review_row(
                batch,
                branch_names,
                f"Only {this_count:,} stock codes counted vs. this branch's usual "
                f"~{round(baseline_median):,} — file may have been cut off",
                "review",
            )
        )
    return rows


def slip_total_mismatches(db: Session, user: User, since: date) -> list[dict]:
    branch_names = _branch_names(db)
    rows = []
    for batch in _branch_scoped_batches(db, user, ImportType.SALES, since):
        mismatches = (batch.preview_data or {}).get("slip_subtotal_mismatches", [])
        for mismatch in mismatches:
            rows.append(
                {
                    "batch_id": batch.id,
                    "branch_id": batch.branch_id,
                    "branch_name": branch_names.get(batch.branch_id, "—"),
                    "slip_id": mismatch.get("SlipID"),
                    "slip_number": mismatch.get("SlipNumber"),
                    "date": mismatch.get("Date"),
                    "line_total": mismatch.get("LineTotal"),
                    "subtotal_on_slip": mismatch.get("SubtotalOnSlip"),
                    "difference": mismatch.get("Difference"),
                }
            )
    return rows


def build_import_health(db: Session, user: User, days: int) -> dict:
    since = date.today() - timedelta(days=days - 1)

    sales_reviews = sales_skip_rate_reviews(db, user, since)
    purchase_reviews = purchase_duplicate_reviews(db, user, since)
    inventory_reviews = inventory_anomaly_reviews(db, user, since)
    batches_to_review = sorted(
        [*sales_reviews, *purchase_reviews, *inventory_reviews],
        key=lambda r: r["confirmed_at"],
        reverse=True,
    )

    total_batches_query = db.query(func.count(ImportBatch.id)).filter(
        ImportBatch.status == ImportBatchStatus.COMPLETED,
        ImportBatch.created_at >= since,
    )
    if user.branch_id is not None:
        total_batches_query = total_batches_query.filter(ImportBatch.branch_id == user.branch_id)
    total_batches_checked = total_batches_query.scalar() or 0

    return {
        "since": since.isoformat(),
        "batches_checked": total_batches_checked,
        "batches_to_review": batches_to_review,
        "slip_total_mismatches": slip_total_mismatches(db, user, since),
    }
