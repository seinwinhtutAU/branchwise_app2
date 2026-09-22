"""One-off: delete R2 objects under imports/{id}/ where {id} doesn't match any
import_batches row.

Every real batch's data — original file and preview pages — lives under
imports/{batch_id}/. A folder that doesn't match any row is one of two things: the
original file from a confirm that uploaded to R2 (under a random id, before
2026-09-22's fix filed it under the batch's own id) but never finished persisting, so
no row was ever created to reference it; or a batch whose row genuinely doesn't exist
for the same reason under the newer key layout. Either way nothing in the app ever
reads it — it's dead weight, not a fallback for anything.

Dry run by default — it only reports what it would delete:

    uv run --directory backend python scripts/cleanup_orphaned_r2_imports.py
    uv run --directory backend python scripts/cleanup_orphaned_r2_imports.py --apply
"""

import argparse
import logging
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

import app.models  # noqa: E402, F401  (registers every model so ImportBatch's relationships resolve)
from app.db.session import SessionLocal  # noqa: E402
from app.retail.models.import_batch import ImportBatch  # noqa: E402
from app.services.storage import get_storage_service  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("cleanup_orphaned_r2_imports")


def _known_batch_ids() -> set[str]:
    db = SessionLocal()
    try:
        return {batch_id for (batch_id,) in db.query(ImportBatch.id).all()}
    finally:
        db.close()


def _list_top_level_ids(client, bucket: str) -> list[str]:
    ids = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix="imports/", Delimiter="/"):
        for common_prefix in page.get("CommonPrefixes", []):
            # "imports/<id>/" -> "<id>"
            ids.append(common_prefix["Prefix"].split("/")[1])
    return ids


def _delete_prefix(client, bucket: str, prefix: str) -> int:
    deleted = 0
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        keys = [{"Key": obj["Key"]} for obj in page.get("Contents", [])]
        if not keys:
            continue
        client.delete_objects(Bucket=bucket, Delete={"Objects": keys})
        deleted += len(keys)
    return deleted


def run(*, apply: bool) -> tuple[int, int]:
    storage = get_storage_service()
    if not storage.is_configured:
        raise RuntimeError("Cloudflare R2 is not configured.")
    client = storage._get_client()
    bucket = storage.settings.r2_bucket

    known_ids = _known_batch_ids()
    top_level_ids = _list_top_level_ids(client, bucket)
    orphans = [folder_id for folder_id in top_level_ids if folder_id not in known_ids]

    logger.info("Total folders under imports/: %d", len(top_level_ids))
    logger.info("Orphaned folders (no matching import batch): %d", len(orphans))

    deleted_objects = 0
    for folder_id in orphans:
        prefix = f"imports/{folder_id}/"
        if not apply:
            logger.info("Would delete %s", prefix)
            continue
        count = _delete_prefix(client, bucket, prefix)
        deleted_objects += count
        logger.info("Deleted %s (%d objects)", prefix, count)

    return len(orphans), deleted_objects


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Delete orphaned R2 import folders")
    parser.add_argument("--apply", action="store_true", help="Actually delete, not just report")
    args = parser.parse_args()

    orphan_count, deleted_objects = run(apply=args.apply)
    if args.apply:
        logger.info("Deleted %d objects across %d orphaned folders.", deleted_objects, orphan_count)
    else:
        logger.info(
            "Dry run: %d orphaned folders would be deleted. Re-run with --apply to actually delete.",
            orphan_count,
        )
