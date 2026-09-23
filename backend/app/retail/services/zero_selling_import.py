"""Recognize and normalize zero-selling log workbooks uploaded as general files."""

import io
from datetime import time

import pandas as pd

from app.retail.services.branch_mapping import normalize_ats_branch


def _cell_text(value: object) -> str:
    return "" if pd.isna(value) else str(value).strip()


def _column_name(value: object) -> str:
    return _cell_text(value).casefold().replace(" ", "")


def _time_text(value: object) -> str | None:
    if pd.isna(value):
        return None
    if isinstance(value, time):
        return value.strftime("%H:%M:%S")
    if isinstance(value, (int, float)) and 0 <= float(value) < 1:
        seconds = round(float(value) * 24 * 60 * 60)
        return f"{seconds // 3600:02d}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"
    parsed = pd.to_datetime(value, errors="coerce")
    return parsed.strftime("%H:%M:%S") if not pd.isna(parsed) else _cell_text(value) or None


def parse_zero_selling_upload(contents: bytes, filename: str | None) -> list[dict]:
    """Return normalized zero-selling rows, or [] for unrelated General File uploads."""
    if not (filename or "").lower().endswith((".xlsx", ".xls")):
        return []
    try:
        workbook = pd.ExcelFile(io.BytesIO(contents))
    except Exception:
        return []

    records: list[dict] = []
    required = {"date", "time", "shop", "category", "reason"}
    for sheet_name in workbook.sheet_names:
        try:
            raw = pd.read_excel(workbook, sheet_name=sheet_name, header=None)
        except Exception:
            continue
        header_index = next(
            (
                index
                for index in range(min(10, len(raw)))
                if required.issubset({_column_name(value) for value in raw.iloc[index]})
            ),
            None,
        )
        if header_index is None:
            continue
        headers = {_column_name(value): position for position, value in enumerate(raw.iloc[header_index])}
        for row_index in range(header_index + 1, len(raw)):
            row = raw.iloc[row_index]
            branch = normalize_ats_branch(_cell_text(row.iloc[headers["shop"]]))
            sale_date = pd.to_datetime(row.iloc[headers["date"]], dayfirst=True, errors="coerce")
            if branch is None or pd.isna(sale_date):
                continue
            records.append(
                {
                    "sale_date": sale_date.date(),
                    "sale_time": _time_text(row.iloc[headers["time"]]),
                    "branch": branch,
                    "category": _cell_text(row.iloc[headers["category"]]) or None,
                    "reason": _cell_text(row.iloc[headers["reason"]]) or None,
                    "source_sheet": str(sheet_name).strip(),
                    "source_row": row_index + 1,
                }
            )
    return records
