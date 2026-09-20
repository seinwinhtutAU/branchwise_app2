import pandas as pd
from sqlalchemy.orm import Session

from app.retail.models.import_batch import ImportType
from app.retail.models.stock_level import StockLevel
from app.retail.services.import_common import (
    count_preview_issues,
    get_or_create_products,
    new_import_batch,
    pluralize,
    product_summary_messages,
)


def persist_inventory(
    db: Session,
    df: pd.DataFrame,
    *,
    branch_id: str | None,
    location_raw: str | None,
    source_file: str | None,
    uploaded_by: str | None = None,
    preview_data: dict | None = None,
    storage_key: str | None = None,
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
        preview_data=preview_data,
        storage_key=storage_key,
    )
    db.add(batch)

    summary = {
        "batch_id": batch.id,
        "stock_levels_created": 0,
        "products_created": 0,
        "products_updated": 0,
    }
    if preview_data is not None:
        summary["issue_count"] = count_preview_issues(preview_data)

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

    # Plain dicts, not iterrows() — same reasoning as validate_rows in import_common.
    for row in df.to_dict(orient="records"):
        stock_level = StockLevel(
            branch_id=branch_id,
            import_batch_id=batch.id,
            location_raw=location_raw,
            product_id=products[row["StockCode"]].id,
            on_hand_qty=row["On_Hand_Qty"],
            buying_price=row["Buying_Price"],
            selling_price=row["Selling_Price"],
            source_file=source_file,
        )
        if printed_at is not None:
            stock_level.snapshot_at = printed_at
        db.add(stock_level)
        summary["stock_levels_created"] += 1

    messages = [f"Inventory updated for {pluralize(summary['stock_levels_created'], 'product')}"]
    messages.extend(product_summary_messages(summary["products_created"], summary["products_updated"]))
    if printed_at is not None:
        messages[0] += f" (as of {printed_at.strftime('%b %-d, %Y, %-I:%M %p')})"
    summary["messages"] = messages

    batch.summary = summary
    db.commit()
    return summary
