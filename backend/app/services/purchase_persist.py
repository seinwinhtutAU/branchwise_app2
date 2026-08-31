import datetime
import uuid

import pandas as pd
from sqlalchemy.orm import Session

from app.models.import_batch import ImportBatch, ImportType
from app.models.purchase import Purchase, PurchaseLine
from app.services.import_common import get_or_create_products, pluralize, product_summary_messages


def persist_purchases(
    db: Session,
    df: pd.DataFrame,
    *,
    branch_id: str | None,
    location_raw: str | None,
    source_file: str | None,
    uploaded_by: str | None = None,
    preview_data: dict | None = None,
    purchase_date: datetime.date | None = None,
) -> dict:
    """Persist a purchase import as one new Purchase batch per call.

    purchase.csv has no natural batch/date key in the source data, so every
    confirmed import creates a fresh Purchase header with a PurchaseLine per
    row. purchase_date applies to the whole batch (there's no per-line date
    in the source data either) — it defaults to today but the confirm
    endpoint lets the importer override it, e.g. when uploading a file for a
    purchase that happened on an earlier day. Known limitation: re-confirming
    the same file twice creates duplicate purchase records — there's no
    source data to detect that with yet.
    """
    batch = ImportBatch(
        id=str(uuid.uuid4()),
        import_type=ImportType.PURCHASE,
        branch_id=branch_id,
        uploaded_by=uploaded_by,
        filename=source_file,
        summary={},
        preview_data=preview_data or {},
    )
    db.add(batch)

    summary = {
        "batch_id": batch.id,
        "purchase_id": None,
        "purchase_lines_created": 0,
        "products_created": 0,
        "products_updated": 0,
    }

    if df.empty:
        summary["messages"] = ["No purchase items were found in this file — nothing was imported."]
        batch.summary = summary
        db.commit()
        return summary

    products, created, updated = get_or_create_products(
        db, [(code, desc, None) for code, desc in zip(df["StockCode"], df["Description"])]
    )
    summary["products_created"] = created
    summary["products_updated"] = updated

    purchase = Purchase(
        id=str(uuid.uuid4()),
        branch_id=branch_id,
        import_batch_id=batch.id,
        location_raw=location_raw,
        purchase_date=purchase_date or datetime.date.today(),
        source_file=source_file,
    )
    db.add(purchase)
    summary["purchase_id"] = purchase.id

    # Plain dicts, not iterrows() — same reasoning as validate_rows in import_common.
    for row in df.to_dict(orient="records"):
        db.add(
            PurchaseLine(
                purchase_id=purchase.id,
                product_id=products[row["StockCode"]].id,
                quantity=row["Quantity"],
                uom=row["UOM"],
                buying_price=row["Buying_Price"],
            )
        )
        summary["purchase_lines_created"] += 1

    messages = [f"{pluralize(summary['purchase_lines_created'], 'item')} added to your purchase record"]
    messages.extend(product_summary_messages(summary["products_created"], summary["products_updated"]))
    summary["messages"] = messages

    batch.summary = summary
    db.commit()
    return summary
