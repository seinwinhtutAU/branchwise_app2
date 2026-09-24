"""The "Cleaned data" of a general-file import batch, read back from the records it created.

A general file is stored unchanged, but when it is recognised as a salary sheet, a
zero-selling log or a daily cost sheet, those rows are also saved as real records tied
to the batch (`import_batch_id`). Those saved records ARE the cleaned data — the same
idea as `clean_rows.py` for sales/inventory/purchase — and one workbook can hold more
than one kind, so this module stitches the kinds together into one paginated table.
"""

from dataclasses import dataclass
from typing import Callable

from sqlalchemy.orm import Query, Session

from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.salary import SalaryRecord
from app.retail.models.zero_selling import ZeroSellingRecord

RECORD_TYPE_COLUMN = "Record type"


def _num(value) -> float | None:
    return float(value) if value is not None else None


def _date(value) -> str | None:
    return value.isoformat() if value else None


@dataclass(frozen=True)
class _Kind:
    label: str
    columns: list[str]
    build_query: Callable[[Session, str], Query]
    row_to_dict: Callable[..., dict]


def _salary_query(db: Session, batch_id: str) -> Query:
    return (
        db.query(SalaryRecord)
        .filter(SalaryRecord.import_batch_id == batch_id)
        .order_by(SalaryRecord.source_sheet, SalaryRecord.source_row)
    )


def _salary_row(record: SalaryRecord) -> dict:
    return {
        "Name": record.name,
        "Branch": record.branch,
        "Salary": _num(record.salary),
        "Bonus": _num(record.bonus),
    }


def _zero_selling_query(db: Session, batch_id: str) -> Query:
    return (
        db.query(ZeroSellingRecord)
        .filter(ZeroSellingRecord.import_batch_id == batch_id)
        .order_by(ZeroSellingRecord.source_sheet, ZeroSellingRecord.source_row)
    )


def _zero_selling_row(record: ZeroSellingRecord) -> dict:
    return {
        "Date": _date(record.sale_date),
        "Time": record.sale_time or "",
        "Branch": record.branch,
        "Category": record.category or "",
        "Reason": record.reason or "",
    }


def _daily_cost_query(db: Session, batch_id: str) -> Query:
    return (
        db.query(DailyCostRecord)
        .filter(DailyCostRecord.import_batch_id == batch_id)
        .order_by(DailyCostRecord.cost_date, DailyCostRecord.source_sheet)
    )


def _daily_cost_row(record: DailyCostRecord) -> dict:
    return {
        "Date": _date(record.cost_date),
        "Branch": record.branch,
        "Usage": record.usage or "",
        "Usage total": _num(record.usage_total),
        "Digital income": record.digital_income or "",
        "Digital income total": _num(record.digital_income_total),
        "Return items": record.return_items or "",
        "Return total": _num(record.return_total),
        "Capital expenditure": record.capital_expenditure or "",
        "Capital total": _num(record.capital_total),
    }


_KINDS = [
    _Kind("Salary", ["Name", "Branch", "Salary", "Bonus"], _salary_query, _salary_row),
    _Kind(
        "Zero selling",
        ["Date", "Time", "Branch", "Category", "Reason"],
        _zero_selling_query,
        _zero_selling_row,
    ),
    _Kind(
        "Daily cost",
        [
            "Date",
            "Branch",
            "Usage",
            "Usage total",
            "Digital income",
            "Digital income total",
            "Return items",
            "Return total",
            "Capital expenditure",
            "Capital total",
        ],
        _daily_cost_query,
        _daily_cost_row,
    ),
]


def _present_kinds(db: Session, batch_id: str) -> list[tuple[_Kind, int]]:
    counted = [(kind, kind.build_query(db, batch_id).count()) for kind in _KINDS]
    return [(kind, count) for kind, count in counted if count > 0]


def _columns_for(kinds: list[_Kind]) -> list[str]:
    if len(kinds) == 1:
        return list(kinds[0].columns)
    # Several kinds in one file: one table with a column saying which kind each row is,
    # then every column any of them uses, in order of first appearance.
    columns = [RECORD_TYPE_COLUMN]
    for kind in kinds:
        columns.extend(c for c in kind.columns if c not in columns)
    return columns


def _rows_of(kind: _Kind, records: list, multiple: bool) -> list[dict]:
    rows = [kind.row_to_dict(record) for record in records]
    if multiple:
        for row in rows:
            row[RECORD_TYPE_COLUMN] = kind.label
    return rows


def general_clean_table(
    db: Session, batch_id: str, offset: int, limit: int | None
) -> tuple[list[str], list[dict], int]:
    """(columns, rows for this page, total rows). `limit=None` returns every row."""
    present = _present_kinds(db, batch_id)
    columns = _columns_for([kind for kind, _ in present])
    total = sum(count for _, count in present)
    multiple = len(present) > 1
    rows: list[dict] = []
    skip = offset
    for kind, count in present:
        if skip >= count:
            skip -= count
            continue
        wanted = None if limit is None else limit - len(rows)
        if wanted is not None and wanted <= 0:
            break
        query = kind.build_query(db, batch_id).offset(skip)
        if wanted is not None:
            query = query.limit(wanted)
        rows.extend(_rows_of(kind, query.all(), multiple))
        skip = 0
    return columns, rows, total
