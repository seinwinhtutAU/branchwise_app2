"""Checks that imported retail data is complete, not merely recently uploaded."""

import re
from collections import defaultdict
from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.retail.models.purchase import Purchase
from app.retail.models.sale import Sale
from app.retail.models.stock_level import StockLevel


_PURCHASE_NUMBER_PATTERN = re.compile(r"^(.*?)(\d+)$")


def latest_daily_data_dates(
    db: Session, branch_id: str
) -> tuple[date | None, date | None]:
    """Return the latest business dates represented by sale and inventory data.

    These dates deliberately come from the imported records rather than ImportBatch's
    creation time: a file confirmed today can still contain yesterday's POS report.
    """
    sales_date = (
        db.query(func.max(Sale.sale_date)).filter(Sale.branch_id == branch_id).scalar()
    )
    inventory_snapshot = (
        db.query(func.max(StockLevel.snapshot_at))
        .filter(StockLevel.branch_id == branch_id)
        .scalar()
    )
    return sales_date, inventory_snapshot.date() if inventory_snapshot else None


def imported_data_date_ranges(
    db: Session, branch_id: str
) -> dict[str, tuple[date | None, date | None]]:
    """Return each import type's earliest and latest business dates.

    These are coverage ranges for Import Health, so they use the records' business
    dates rather than ImportBatch.created_at: a file confirmed today can contain an
    older report.
    """
    query_ranges = {
        "sales": db.query(func.min(Sale.sale_date), func.max(Sale.sale_date))
        .filter(Sale.branch_id == branch_id)
        .one(),
        "inventory": db.query(
            func.min(StockLevel.snapshot_at), func.max(StockLevel.snapshot_at)
        )
        .filter(StockLevel.branch_id == branch_id)
        .one(),
        "purchase": db.query(
            func.min(Purchase.purchase_date), func.max(Purchase.purchase_date)
        )
        .filter(Purchase.branch_id == branch_id)
        .one(),
    }

    def as_date(value: date | None) -> date | None:
        return value.date() if hasattr(value, "date") else value

    return {
        import_type: (as_date(earliest), as_date(latest))
        for import_type, (earliest, latest) in query_ranges.items()
    }


def purchase_number_integrity(db: Session, branch_id: str) -> dict:
    """Find internal gaps in each purchase-number prefix sequence.

    A sequence is only checked between the smallest and largest number already in the
    system. We cannot know whether the first or next supplier number exists elsewhere,
    but a gap such as STR00049 -> STR00111 is conclusive evidence that records are
    missing from this branch's import history.
    """
    sequences: dict[str, set[int]] = defaultdict(set)
    widths: dict[str, int] = defaultdict(int)

    rows = (
        db.query(Purchase.purchase_number)
        .filter(
            Purchase.branch_id == branch_id,
            Purchase.purchase_number.is_not(None),
        )
        .all()
    )
    for (raw_number,) in rows:
        value = raw_number.strip() if raw_number else ""
        match = _PURCHASE_NUMBER_PATTERN.fullmatch(value)
        if not match:
            continue
        prefix, digits = match.groups()
        sequences[prefix].add(int(digits))
        widths[prefix] = max(widths[prefix], len(digits))

    gaps: list[dict] = []
    for prefix, numbers in sequences.items():
        ordered = sorted(numbers)
        for previous, current in zip(ordered, ordered[1:]):
            if current == previous + 1:
                continue
            start, end = previous + 1, current - 1
            width = widths[prefix]
            gaps.append(
                {
                    "prefix": prefix,
                    "start": start,
                    "end": end,
                    "start_number": f"{prefix}{start:0{width}d}",
                    "end_number": f"{prefix}{end:0{width}d}",
                    "missing_count": end - start + 1,
                }
            )

    gaps.sort(key=lambda gap: (gap["prefix"], gap["start"]))
    return {
        "numbered_purchase_count": sum(len(numbers) for numbers in sequences.values()),
        "gap_count": len(gaps),
        "missing_number_count": sum(gap["missing_count"] for gap in gaps),
        "gaps": gaps,
    }
