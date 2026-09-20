"""Migrate existing historical import preview data from PostgreSQL to Cloudflare R2.

Usage:
    python backend/scripts/migrate_preview_data_to_r2.py [--dry-run] [--prune-db]

Options:
    --dry-run   Simulate migration without modifying DB or uploading files.
    --prune-db  Clear batch.preview_data in the database after successful R2 upload
                to shrink the database size.
"""

import argparse
import io
import json
import logging
import sys
from pathlib import Path

# Add backend directory to sys.path so app imports work
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import pandas as pd
from app.db.session import SessionLocal
from app.models.branch import Branch  # noqa: F401
from app.models.user import User  # noqa: F401
from app.retail.models.import_batch import ImportBatch
from app.services.storage import get_storage_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("migrate_r2")

try:
    sys.stdout.reconfigure(line_buffering=True)
except Exception:
    pass


def run_migration(dry_run: bool = False, prune_db: bool = False) -> None:
    storage = get_storage_service()
    if not storage.is_configured:
        logger.error(
            "Cloudflare R2 is not configured. Please verify R2_ACCOUNT_ID, "
            "R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET in your .env file."
        )
        sys.exit(1)

    db = SessionLocal()
    try:
        batch_ids = [
            row[0]
            for row in db.query(ImportBatch.id)
            .filter(ImportBatch.storage_key.is_(None))
            .order_by(ImportBatch.created_at.asc())
            .all()
        ]

        logger.info("Found %d batches without storage_key", len(batch_ids))

        migrated_count = 0
        skipped_count = 0

        for batch_id in batch_ids:
            batch = db.get(ImportBatch, batch_id)
            if not batch:
                continue
            preview = batch.preview_data or {}
            origin = preview.get("origin", {})
            origin_rows = origin.get("rows", [])

            if not origin_rows:
                logger.info("Batch %s (%s) has no origin rows; skipping", batch.id, batch.filename)
                skipped_count += 1
                continue

            filename = batch.filename or f"import_{batch.id}.xlsx"
            if not filename.endswith((".xlsx", ".xls", ".csv")):
                filename = f"{filename}.xlsx"

            storage_key = f"imports/{batch.id}/{filename}"
            json_storage_key = f"imports/{batch.id}/preview_data.json"

            logger.info("Processing batch %s (%s) with %d origin rows", batch.id, filename, len(origin_rows))

            if dry_run:
                logger.info("[DRY RUN] Would upload %s and %s to R2", storage_key, json_storage_key)
                migrated_count += 1
                continue

            # 1. Generate Excel file from origin rows
            output = io.BytesIO()
            df = pd.DataFrame(origin_rows)
            with pd.ExcelWriter(output, engine="openpyxl") as writer:
                df.to_excel(writer, index=False)
            excel_bytes = output.getvalue()

            # 2. Upload Excel file to R2
            uploaded_excel = storage.upload_file_bytes(
                excel_bytes,
                storage_key,
                content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )

            # 3. Upload JSON preview snapshot to R2
            preview_json_bytes = json.dumps(preview).encode("utf-8")
            storage.upload_file_bytes(
                preview_json_bytes,
                json_storage_key,
                content_type="application/json",
            )

            if uploaded_excel:
                batch.storage_key = storage_key
                if prune_db:
                    batch.preview_data = {}
                db.commit()
                migrated_count += 1
                logger.info("Successfully migrated batch %s to %s", batch.id, storage_key)
            else:
                logger.error("Failed to upload batch %s to R2", batch.id)

        logger.info(
            "Migration complete: %d migrated, %d skipped, %d total batches processed.",
            migrated_count,
            skipped_count,
            len(batch_ids),
        )

    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate import preview data to Cloudflare R2")
    parser.add_argument("--dry-run", action="store_true", help="Simulate without writing to R2 or DB")
    parser.add_argument("--prune-db", action="store_true", help="Clear preview_data in DB to free space")
    args = parser.parse_args()

    run_migration(dry_run=args.dry_run, prune_db=args.prune_db)
