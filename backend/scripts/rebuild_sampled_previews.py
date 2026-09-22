"""One-off: rebuild the stored preview for any import batch that was confirmed while
row-sampling was live in `_build_preview` (added and then removed again on 2026-09-22).

A batch confirmed in that window has its preview permanently capped at the first 500
clean rows plus any rows with a validation issue — both in the `import_batches.preview_data`
column and in the paged copies on R2 — so Import History can never page past that sample
for it, even though sampling itself is gone from new imports. This re-downloads each such
batch's original file, re-parses and re-cleans it exactly as confirm did, and rebuilds its
preview in full via the (now unsampled) `_build_preview`, then writes it back to both places.

Dry run by default — it only reports which batches it would touch.

    uv run --directory backend python scripts/rebuild_sampled_previews.py
    uv run --directory backend python scripts/rebuild_sampled_previews.py --apply
"""

import argparse
import logging
import sys
from pathlib import Path

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.db.session import SessionLocal  # noqa: E402
from app.models.branch import Branch  # noqa: E402
from app.retail.models.import_batch import (  # noqa: E402
    ImportBatch,
    ImportBatchStatus,
    ImportType,
)
from app.retail.routers.imports import _build_preview, _parse_or_400  # noqa: E402
from app.retail.services.inventory_import import (  # noqa: E402
    OUTPUT_COLUMNS as INVENTORY_OUTPUT_COLUMNS,
)
from app.retail.services.inventory_import import (  # noqa: E402
    VALIDATION_RULES as INVENTORY_VALIDATION_RULES,
)
from app.retail.services.inventory_import import parse_inventory_upload  # noqa: E402
from app.retail.services.pos_import import OUTPUT_COLUMNS as SALES_OUTPUT_COLUMNS  # noqa: E402
from app.retail.services.pos_import import VALIDATION_RULES as SALES_VALIDATION_RULES  # noqa: E402
from app.retail.services.pos_import import parse_pos_sale_upload  # noqa: E402
from app.retail.services.preview_storage import upload_preview_pages  # noqa: E402
from app.retail.services.purchase_import import (  # noqa: E402
    OUTPUT_COLUMNS as PURCHASE_OUTPUT_COLUMNS,
)
from app.retail.services.purchase_import import (  # noqa: E402
    VALIDATION_RULES as PURCHASE_VALIDATION_RULES,
)
from app.retail.services.purchase_import import parse_purchase_upload  # noqa: E402
from app.services.storage import get_storage_service  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("rebuild_sampled_previews")


def _was_sampled(preview_data: dict) -> bool:
    clean = preview_data.get("clean") or {}
    origin = preview_data.get("origin") or {}
    return bool(clean.get("is_sampled")) or bool(origin.get("is_sampled"))


def _rebuild_one(db, storage, batch: ImportBatch) -> dict | None:
    if not batch.storage_key or not storage.is_configured:
        logger.warning("Batch %s has no stored original file in R2 — skipping", batch.id)
        return None
    downloaded = storage.download_file_bytes(batch.storage_key)
    if downloaded is None:
        logger.warning("Could not download original file for batch %s — skipping", batch.id)
        return None
    contents, _content_type = downloaded
    branch = db.get(Branch, batch.branch_id) if batch.branch_id else None

    if batch.import_type == ImportType.SALES:
        origin_rows, clean_df = _parse_or_400(
            parse_pos_sale_upload,
            contents,
            batch.filename,
            "sale",
            branch.sale_date_format if branch else "MDY",
        )
        return _build_preview(
            batch.filename, origin_rows, clean_df, SALES_OUTPUT_COLUMNS, SALES_VALIDATION_RULES
        )
    if batch.import_type == ImportType.INVENTORY:
        origin_rows, clean_df = _parse_or_400(
            parse_inventory_upload,
            contents,
            batch.filename,
            "inventory",
            branch.inventory_date_format if branch else "MDY",
        )
        return _build_preview(
            batch.filename,
            origin_rows,
            clean_df,
            INVENTORY_OUTPUT_COLUMNS,
            INVENTORY_VALIDATION_RULES,
        )
    if batch.import_type == ImportType.PURCHASE:
        origin_rows, clean_df = _parse_or_400(
            parse_purchase_upload, contents, batch.filename, "purchase"
        )
        return _build_preview(
            batch.filename,
            origin_rows,
            clean_df,
            PURCHASE_OUTPUT_COLUMNS,
            PURCHASE_VALIDATION_RULES,
        )
    return None


def run(*, apply: bool) -> tuple[int, int, int]:
    storage = get_storage_service()
    db = SessionLocal()
    rebuilt = skipped = failed = 0
    try:
        batches = (
            db.query(ImportBatch)
            .filter(
                ImportBatch.import_type.in_(
                    [ImportType.SALES, ImportType.INVENTORY, ImportType.PURCHASE]
                )
            )
            .filter(ImportBatch.status == ImportBatchStatus.COMPLETED)
            .order_by(ImportBatch.created_at.asc())
            .all()
        )
        for batch in batches:
            if not _was_sampled(batch.preview_data or {}):
                skipped += 1
                continue
            try:
                new_preview = _rebuild_one(db, storage, batch)
            except Exception:
                logger.exception("Failed to rebuild preview for batch %s", batch.id)
                failed += 1
                continue
            if new_preview is None:
                failed += 1
                continue
            if not apply:
                logger.info(
                    "Would rebuild batch %s (%s, %s clean rows)",
                    batch.id,
                    batch.import_type.value,
                    new_preview["total_clean_rows"],
                )
                rebuilt += 1
                continue
            batch.preview_data = new_preview
            db.commit()
            upload_preview_pages(storage, batch.id, new_preview)
            rebuilt += 1
            logger.info("Rebuilt batch %s", batch.id)
        return rebuilt, skipped, failed
    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Rebuild sampled import previews in full")
    parser.add_argument("--apply", action="store_true", help="Write the rebuilt previews")
    args = parser.parse_args()

    rebuilt, skipped, failed = run(apply=args.apply)
    action = "Rebuilt" if args.apply else "Would rebuild"
    logger.info("%s %d; skipped %d (not sampled); failed %d.", action, rebuilt, skipped, failed)
    raise SystemExit(1 if failed else 0)
