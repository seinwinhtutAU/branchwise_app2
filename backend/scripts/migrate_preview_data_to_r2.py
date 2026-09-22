"""Backfill Import Detail preview pages to Cloudflare R2.

Usage:
    python backend/scripts/migrate_preview_data_to_r2.py          # report only
    python backend/scripts/migrate_preview_data_to_r2.py --apply  # upload missing previews

The database snapshot is deliberately retained as a fallback and for Import Health;
this script only adds the R2 manifest/page objects that make Import Detail fast.
"""

import argparse
import logging
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.db.session import SessionLocal
from app.models.branch import Branch  # noqa: F401
from app.models.user import User  # noqa: F401
from app.retail.models.import_batch import ImportBatch
from app.retail.services.preview_storage import read_preview_page, upload_preview_pages
from app.services.storage import get_storage_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("migrate_preview_data_to_r2")


def run_migration(*, apply: bool, limit: int | None = None) -> tuple[int, int, int]:
    storage = get_storage_service()
    if not storage.is_configured:
        raise RuntimeError(
            "Cloudflare R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, "
            "R2_SECRET_ACCESS_KEY, and R2_BUCKET first."
        )

    db = SessionLocal()
    try:
        query = db.query(ImportBatch.id).order_by(ImportBatch.created_at.asc())
        if limit is not None:
            query = query.limit(limit)
        batch_ids = [batch_id for (batch_id,) in query.all()]

        uploaded = 0
        skipped = 0
        failed = 0
        for batch_id in batch_ids:
            batch = db.get(ImportBatch, batch_id)
            preview_data = batch.preview_data or {} if batch else {}
            if not preview_data.get("clean") and not preview_data.get("origin"):
                skipped += 1
                continue
            if read_preview_page(storage, batch_id, "clean", 1) is not None:
                skipped += 1
                continue

            if not apply:
                logger.info("Would upload preview pages for batch %s", batch_id)
                uploaded += 1
                continue
            if upload_preview_pages(storage, batch_id, preview_data):
                uploaded += 1
                logger.info("Uploaded preview pages for batch %s", batch_id)
            else:
                failed += 1
                logger.error("Failed to upload preview pages for batch %s", batch_id)

        return uploaded, skipped, failed
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill paged import previews to R2")
    parser.add_argument("--apply", action="store_true", help="Upload missing preview objects to R2")
    parser.add_argument("--limit", type=int, help="Process at most this many batches")
    args = parser.parse_args()
    try:
        uploaded, skipped, failed = run_migration(apply=args.apply, limit=args.limit)
    except RuntimeError as error:
        logger.error("%s", error)
        raise SystemExit(1) from error

    action = "Uploaded" if args.apply else "Would upload"
    logger.info("%s %d; skipped %d; failed %d.", action, uploaded, skipped, failed)
    raise SystemExit(1 if failed else 0)
