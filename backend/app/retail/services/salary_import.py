"""Recognize the simple salary tables that arrive as General File uploads."""

import io
import pandas as pd

from app.retail.services.branch_mapping import normalize_ats_branch


def _cell_text(value: object) -> str:
    return "" if pd.isna(value) else str(value).strip()


def _column_name(value: object) -> str:
    return _cell_text(value).casefold().replace(" ", "")


def parse_salary_upload(contents: bytes, filename: str | None) -> list[dict]:
    """Return normalized rows, or an empty list when this isn't a salary workbook.

    General uploads must continue accepting arbitrary files, so parsing is deliberately
    best-effort and never turns an unrelated daily-cost document into an upload failure.
    """
    if not (filename or "").lower().endswith((".xlsx", ".xls")):
        return []
    try:
        workbook = pd.ExcelFile(io.BytesIO(contents))
    except Exception:
        return []

    records: list[dict] = []
    for sheet_name in workbook.sheet_names:
        try:
            frame = pd.read_excel(workbook, sheet_name=sheet_name)
        except Exception:
            continue
        columns = {_column_name(column): column for column in frame.columns}
        required = {"name", "shop", "salary", "bonus"}
        if not required.issubset(columns):
            continue
        for index, row in frame.iterrows():
            name = _cell_text(row[columns["name"]])
            branch = normalize_ats_branch(_cell_text(row[columns["shop"]]))
            salary = pd.to_numeric(row[columns["salary"]], errors="coerce")
            bonus = pd.to_numeric(row[columns["bonus"]], errors="coerce")
            if not name or branch is None or pd.isna(salary):
                continue
            records.append(
                {
                    "name": name,
                    "branch": branch,
                    "salary": float(salary),
                    "bonus": None if pd.isna(bonus) else float(bonus),
                    # DataFrame index is zero-based after its header row.
                    "source_sheet": str(sheet_name),
                    "source_row": int(index) + 2,
                }
            )
    return records
