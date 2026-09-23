import pandas as pd
from sqlalchemy.orm import Session

from app.retail.models.import_batch import ImportType
from app.retail.models.stock_level import StockLevel
from app.retail.services.import_common import (
    get_or_create_products,
    new_import_batch,
    pluralize,
)


def persist_inventory(
    db: Session,
    df: pd.DataFrame,
    *,
    branch_id: str | None,
    location_raw: str | None,
    source_file: str | None,
    uploaded_by: str | None = None,
    issue_count: int = 0,
    storage_key: str | None = None,
    request_key: str | None = None,
) -> dict:
    """Persist an inventory import as a new batch of StockLevel snapshots.

    Every confirmed import adds new rows (never overwrites) — stock_levels
    keeps full history, so "current stock" for a product+branch is the row
    with the latest snapshot_at.
    """
    batch = new_import_batch(
        ImportType.INVENTORY,
        branch_id=branch_id,
        uploaded_by=uploaded_by,
        source_file=source_file,
        storage_key=storage_key,
        request_key=request_key,
    )
    db.add(batch)

    summary = {
        "batch_id": batch.id,
        "stock_levels_created": 0,
        "products_created": 0,
        "products_updated": 0,
        "issue_count": issue_count,
    }

    if df.empty:
        summary["messages"] = ["No inventory data was found in this file — nothing was imported."]
        batch.summary = summary
        db.commit()
        return summary

    products, created, updated = get_or_create_products(
        db, list(df[["StockCode", "Description", "Group"]].itertuples(index=False, name=None))
    )
    summary["products_created"] = created
    summary["products_updated"] = updated

    # Date the snapshot to when the POS report was printed, not when someone
    # got around to uploading it — falls back to the DB's insert-time default
    # (server_default=func.now()) when the file has no readable "Printed"
    # line, so this is left unset rather than passed as None.
    printed_at = df.attrs.get("printed_at")

    zero_stock_skipped = 0
    negative_stock_count = 0

    # Plain dicts, not iterrows() — same reasoning as validate_rows in import_common.
    for row in df.to_dict(orient="records"):
        qty = row["On_Hand_Qty"]
        # Skip zero-stock items from append-only snapshot table to avoid database bloat.
        # Master product catalog is already updated above via get_or_create_products.
        if qty == 0:
            zero_stock_skipped += 1
            continue

        if qty is not None and qty < 0:
            negative_stock_count += 1

        stock_level = StockLevel(
            branch_id=branch_id,
            import_batch_id=batch.id,
            location_raw=location_raw,
            product_id=products[row["StockCode"]].id,
            on_hand_qty=qty,
            buying_price=row["Buying_Price"],
            selling_price=row["Selling_Price"],
            source_file=source_file,
        )
        if printed_at is not None:
            stock_level.snapshot_at = printed_at
        db.add(stock_level)
        summary["stock_levels_created"] += 1

    summary["zero_stock_skipped"] = zero_stock_skipped
    summary["negative_stock_count"] = negative_stock_count

    total_products = len(df)
    recorded_msg = f"{summary['stock_levels_created']:,} product stocks recorded"
    if printed_at is not None:
        recorded_msg += f" (as of {printed_at.strftime('%b %-d, %Y, %-I:%M %p')})"

    messages = [
        f"{total_products:,} total products in file",
        recorded_msg,
    ]
    if zero_stock_skipped > 0:
        messages.append(f"{zero_stock_skipped:,} products with 0 stock")
    issue_count = summary.get("issue_count", 0)
    total_issues = max(negative_stock_count, issue_count)
    if total_issues > 0:
        messages.append(f"⚠️ Alert: {pluralize(total_issues, 'product')} recorded with invalid values")

    summary["messages"] = messages

    batch.summary = summary
    db.commit()
    return summary
