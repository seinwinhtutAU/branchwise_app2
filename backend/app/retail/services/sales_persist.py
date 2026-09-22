import datetime
import uuid

import pandas as pd
from sqlalchemy.orm import Session

from app.retail.models.import_batch import ImportType
from app.retail.models.sale import Sale, SaleLine
from app.retail.services.import_common import (
    count_preview_issues,
    get_or_create_products,
    new_import_batch,
    pluralize,
)


def persist_sales(
    db: Session,
    df: pd.DataFrame,
    *,
    branch_id: str | None,
    location_raw: str | None,
    source_file: str | None,
    uploaded_by: str | None = None,
    preview_data: dict | None = None,
    storage_key: str | None = None,
    request_key: str | None = None,
) -> dict:
    batch = new_import_batch(
        ImportType.SALES,
        branch_id=branch_id,
        uploaded_by=uploaded_by,
        source_file=source_file,
        preview_data=preview_data,
        storage_key=storage_key,
        request_key=request_key,
    )
    db.add(batch)

    summary = {
        "batch_id": batch.id,
        "sales_created": 0,
        "sales_skipped_duplicate": 0,
        "sale_lines_created": 0,
        "products_created": 0,
        "products_updated": 0,
    }
    if preview_data is not None:
        summary["issue_count"] = count_preview_issues(preview_data)

    if df.empty:
        summary["messages"] = ["No sales were found in this file — nothing was imported."]
        batch.summary = summary
        db.commit()
        return summary

    slip_ids = df["SlipID"].unique().tolist()
    existing_slip_ids = {
        row[0]
        for row in db.query(Sale.slip_id)
        .filter(Sale.branch_id == branch_id, Sale.slip_id.in_(slip_ids))
        .all()
    }

    products, created, updated = get_or_create_products(
        db, [(code, desc, None) for code, desc in zip(df["StockCode"], df["Description"])]
    )
    summary["products_created"] = created
    summary["products_updated"] = updated

    for slip_id, group in df.groupby("SlipID", sort=False):
        if slip_id in existing_slip_ids:
            summary["sales_skipped_duplicate"] += 1
            continue

        first = group.iloc[0]
        sale = Sale(
            id=str(uuid.uuid4()),
            branch_id=branch_id,
            import_batch_id=batch.id,
            location_raw=location_raw,
            slip_id=slip_id,
            slip_number=str(first["SlipNumber"]),
            sale_date=datetime.date.fromisoformat(first["Date"]),
            sale_time=first["Time"],
            source_file=source_file,
        )
        db.add(sale)
        summary["sales_created"] += 1

        # Plain dicts, not iterrows() — same reasoning as validate_rows in import_common.
        for row in group.to_dict(orient="records"):
            db.add(
                SaleLine(
                    sale_id=sale.id,
                    line_id=row["LineID"],
                    line_no=int(row["LineNo"]),
                    product_id=products[row["StockCode"]].id,
                    selling_price=row["Selling_Price"],
                    qty=row["Qty"],
                    uom=row["UOM"],
                    discount_amount=row["Discount_Amount"],
                    amount=row["Amount"],
                    net_amount=row["Net_Amount"],
                )
            )
            summary["sale_lines_created"] += 1

    total_lines = len(df)
    messages = [
        f"{total_lines:,} total sale lines in file",
        f"{summary['sales_created']:,} sales recorded ({summary['sale_lines_created']:,} items)",
    ]
    if summary["sales_skipped_duplicate"]:
        messages.append(
            f"{pluralize(summary['sales_skipped_duplicate'], 'sale')} skipped — already imported earlier"
        )
    issue_count = summary.get("issue_count", 0)
    if issue_count > 0:
        messages.append(f"⚠️ Alert: {pluralize(issue_count, 'sale item')} recorded with invalid values")
    if not summary["sales_created"] and not summary["sales_skipped_duplicate"]:
        messages = ["No new sales were found in this file."]
    summary["messages"] = messages

    batch.summary = summary
    db.commit()
    return summary
