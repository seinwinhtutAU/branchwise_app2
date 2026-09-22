"""One-off: bring every already-confirmed sale/inventory/purchase import batch in line
with the R2/database storage layout introduced on 2026-09-22.

Two independent, dry-run-by-default passes:

  1. `relocate_original_files` — move each batch's original file to
     `imports/{batch_id}/original/{filename}` (it used to live under an unrelated random
     folder picked before the batch existed), updating `storage_key` and removing the old
     object once the move is confirmed.
  2. `shrink_db_previews` — cap the `import_batches.preview_data` column at
     DB_PREVIEW_ROW_CAP rows per tab for batches that still hold a full, uncapped copy.
     Only touches a batch once its R2 preview is confirmed to already hold the same total
     row count, so nothing is ever thrown away before a full copy exists elsewhere.

Each batch gets its own short-lived database session, opened and closed right around
that one batch's read/write. Neon's pooled Postgres drops an idle-but-checked-out
connection out from under a session that holds it open across a long loop with lots of
R2 network I/O in between — this ran into that mid-batch twice before switching to a
session per batch let `pool_pre_ping` catch it at the next checkout instead. A couple of
retries per batch absorb anything pre_ping doesn't.

    uv run --directory backend python scripts/reorganize_existing_imports.py            # report only
    uv run --directory backend python scripts/reorganize_existing_imports.py --apply    # do it
"""

import argparse
import logging
import sys
import time
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from sqlalchemy.exc import OperationalError  # noqa: E402

from app.db.session import SessionLocal  # noqa: E402
from app.retail.models.import_batch import (  # noqa: E402
    ImportBatch,
    ImportBatchStatus,
    ImportType,
)
from app.retail.routers.imports import DB_PREVIEW_ROW_CAP, _preview_for_db  # noqa: E402
from app.retail.services.preview_storage import read_preview_page  # noqa: E402
from app.services.storage import get_storage_service  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("reorganize_existing_imports")

RETAIL_IMPORT_TYPES = [ImportType.SALES, ImportType.INVENTORY, ImportType.PURCHASE]
RETRY_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 2.0


def _with_retry(batch_id: str, work) -> str:
    """Run `work(db, batch)` in its own session, retrying a dropped connection.

    `work` returns `(result, after_commit)`: `result` is one of
    "moved"/"shrunk"/"skipped"/"failed", and `after_commit` is either None or a
    zero-arg callback for an action that must only happen once the DB write is
    durable — e.g. deleting the old R2 object a storage_key update just replaced.
    Running that callback before the commit is confirmed is exactly what left one
    batch's storage_key pointing at an already-deleted object the first time this
    ran: attempt 1 deleted the old file, then the commit itself dropped mid-flight,
    so the retry re-read the still-old storage_key and tried to move a file that no
    longer existed. Returns "failed" if every attempt hits an OperationalError.
    """
    last_exc: Exception | None = None
    for attempt in range(1, RETRY_ATTEMPTS + 1):
        db = SessionLocal()
        try:
            batch = db.get(ImportBatch, batch_id)
            if batch is None:
                return "skipped"
            result, after_commit = work(db, batch)
            db.commit()
            if after_commit is not None:
                after_commit()
            return result
        except OperationalError as exc:
            db.rollback()
            last_exc = exc
            logger.warning(
                "Batch %s: db error on attempt %d/%d (%s) — retrying",
                batch_id,
                attempt,
                RETRY_ATTEMPTS,
                exc.__class__.__name__,
            )
            time.sleep(RETRY_DELAY_SECONDS)
        finally:
            db.close()
    logger.error("Batch %s: giving up after %d attempts (%s)", batch_id, RETRY_ATTEMPTS, last_exc)
    return "failed"


def _list_batch_ids(status_filter: ImportBatchStatus | None = None) -> list[str]:
    db = SessionLocal()
    try:
        query = db.query(ImportBatch.id).filter(ImportBatch.import_type.in_(RETAIL_IMPORT_TYPES))
        if status_filter is not None:
            query = query.filter(ImportBatch.status == status_filter)
        query = query.order_by(ImportBatch.created_at.asc())
        return [batch_id for (batch_id,) in query.all()]
    finally:
        db.close()


def relocate_original_files(storage, *, apply: bool) -> tuple[int, int, int]:
    moved = skipped = failed = 0

    def work(db, batch: ImportBatch):
        if not batch.storage_key or not batch.filename:
            return "skipped", None
        expected = f"imports/{batch.id}/original/{batch.filename}"
        if batch.storage_key == expected:
            return "skipped", None
        if not apply:
            logger.info("Would move batch %s: %s -> %s", batch.id, batch.storage_key, expected)
            return "moved", None

        downloaded = storage.download_file_bytes(batch.storage_key)
        if downloaded is None:
            logger.error("Could not download %s for batch %s — skipping", batch.storage_key, batch.id)
            return "failed", None
        contents, content_type = downloaded

        if storage.upload_file_bytes(contents, expected, content_type) is None:
            logger.error("Failed to upload %s for batch %s — skipping", expected, batch.id)
            return "failed", None

        old_key = batch.storage_key
        batch.storage_key = expected
        logger.info("Moved batch %s: %s -> %s", batch.id, old_key, expected)
        # Only delete the old object once this batch's storage_key update is
        # actually committed — see _with_retry's docstring for why.
        return "moved", lambda: storage.delete_file(old_key)

    for batch_id in _list_batch_ids():
        result = _with_retry(batch_id, work)
        if result == "moved":
            moved += 1
        elif result == "failed":
            failed += 1
        else:
            skipped += 1
    return moved, skipped, failed


def shrink_db_previews(storage, *, apply: bool, cap: int = DB_PREVIEW_ROW_CAP) -> tuple[int, int, int]:
    shrunk = skipped = failed = 0

    def work(db, batch: ImportBatch):
        preview = batch.preview_data or {}
        clean = preview.get("clean", {})
        origin = preview.get("origin", {})
        # A capped tab keeps every issue row on top of `cap`, so an already-shrunk batch
        # can sit slightly above `cap` on a re-check — `is_sampled` (only set by
        # _preview_for_db's capping, never by a normal small file) is what actually says
        # "already handled," not the row count.
        if clean.get("is_sampled") or origin.get("is_sampled"):
            return "skipped", None
        if len(clean.get("rows", [])) <= cap and len(origin.get("rows", [])) <= cap:
            return "skipped", None

        if not storage.is_configured:
            logger.warning("R2 not configured — leaving batch %s's full DB copy alone", batch.id)
            return "failed", None
        r2_result = read_preview_page(storage, batch.id, "clean", 1)
        if r2_result is None:
            logger.warning("Batch %s has no R2 preview yet — leaving its full DB copy alone", batch.id)
            return "failed", None
        manifest, _page = r2_result
        # Compare against the actual row count in the DB's own (uncapped) rows list, not
        # the `total_rows` field — batches from before that field existed leave it unset
        # even though their `rows` list is already the true, full one.
        if manifest.get("clean", {}).get("total_rows") != len(clean.get("rows", [])):
            logger.warning(
                "Batch %s: R2 manifest row count doesn't match the database copy — skipping to be safe",
                batch.id,
            )
            return "failed", None

        if not apply:
            logger.info(
                "Would shrink batch %s (%s clean rows, %s origin rows in DB today)",
                batch.id,
                len(clean.get("rows", [])),
                len(origin.get("rows", [])),
            )
            return "shrunk", None

        batch.preview_data = _preview_for_db(preview, cap)
        logger.info("Shrunk batch %s", batch.id)
        return "shrunk", None

    for batch_id in _list_batch_ids(ImportBatchStatus.COMPLETED):
        result = _with_retry(batch_id, work)
        if result == "shrunk":
            shrunk += 1
        elif result == "failed":
            failed += 1
        else:
            skipped += 1
    return shrunk, skipped, failed


def run(*, apply: bool) -> None:
    storage = get_storage_service()
    moved, rel_skipped, rel_failed = relocate_original_files(storage, apply=apply)
    shrunk, shr_skipped, shr_failed = shrink_db_previews(storage, apply=apply)

    action = "Moved" if apply else "Would move"
    logger.info("%s %d original files; skipped %d; failed %d.", action, moved, rel_skipped, rel_failed)
    action = "Shrunk" if apply else "Would shrink"
    logger.info("%s %d db previews; skipped %d; failed %d.", action, shrunk, shr_skipped, shr_failed)
    if rel_failed or shr_failed:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Reorganize existing import batches' storage")
    parser.add_argument("--apply", action="store_true", help="Actually move/shrink, not just report")
    args = parser.parse_args()
    run(apply=args.apply)
