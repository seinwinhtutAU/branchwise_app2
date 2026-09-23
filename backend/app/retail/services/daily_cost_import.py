"""Normalize the daily General Usage workbooks uploaded through General File."""

import io
import re
from collections.abc import Iterable

import pandas as pd


BRANCH_BY_FILENAME = {
    "bogyoke": "Bogyoke",
    "bhs": "BHS1",
    "bsh": "BHS1",
    "ashley": "Ashley",
    "thukitha": "Aung Thit Sar",
}

_DIGITAL_NAMES = {"kpay", "ukpay", "ukapy", "ntkpay", "wave", "auntywave", "kbzpay"}


def _text(value: object) -> str:
    return "" if pd.isna(value) else str(value).strip()


def _clean_name(value: object) -> str:
    return re.sub(r"[.\s:_-]+", "", _text(value)).casefold()


def _amount(value: object) -> float | None:
    parsed = pd.to_numeric(value, errors="coerce")
    return None if pd.isna(parsed) else float(parsed)


def _branch_from_filename(filename: str | None) -> str | None:
    lowered = (filename or "").casefold()
    return next((branch for key, branch in BRANCH_BY_FILENAME.items() if key in lowered), None)


def _is_usage_header(value: object) -> bool:
    text = _text(value)
    compact = _clean_name(value)
    return ("အသုံး" in text or "အသံုး" in text) and ("စာရ" in text or "စရိတ်" in text or compact in {"အသုံး", "အသံုး"})


def _usage_columns(data: pd.DataFrame) -> tuple[int, int, int] | None:
    """Find the rightmost cost-table heading; left-side cash summaries use the same word."""
    candidates: list[tuple[int, int]] = []
    for row_index in range(min(len(data), 8)):
        for column_index, value in enumerate(data.iloc[row_index]):
            if _is_usage_header(value) and column_index + 1 < data.shape[1]:
                candidates.append((row_index, column_index))
    if not candidates:
        return None
    row_index, item_column = max(candidates, key=lambda item: item[1])
    return row_index, item_column, item_column + 1


def _is_capital_item(item: str) -> bool:
    normalized = _clean_name(item)
    return normalized in {"ဆိုင်းဘုတ်ခွံ", "ဆိုင္းဘုတ္ခြံ"} or "signboard" in normalized


def _is_excluded_operating_item(item: str) -> bool:
    normalized = _clean_name(item)
    return (
        "လစာ" in item
        or "စျေးဖိုး" in item
        or "ဈေးဖိုး" in item
        or "ဆေး" in item
        or "ဘောနပ်" in item
        or "bonus" in normalized
        or "bonous" in normalized
        or "ကြိုငွေ" in item
    )


def _display(items: Iterable[tuple[str, float]]) -> str | None:
    result = ", ".join(f"{item}={amount:g}" for item, amount in items)
    return result or None


def parse_daily_cost_upload(contents: bytes, filename: str | None) -> list[dict]:
    """Return one daily summary per date sheet, or [] when this is not a cost workbook."""
    branch = _branch_from_filename(filename)
    if branch is None or not (filename or "").lower().endswith((".xlsx", ".xls")):
        return []
    try:
        workbook = pd.ExcelFile(io.BytesIO(contents))
    except Exception:
        return []

    records: list[dict] = []
    for sheet_name in workbook.sheet_names:
        parsed_date = pd.to_datetime(sheet_name, dayfirst=True, format="mixed", errors="coerce")
        if pd.isna(parsed_date) or not 2020 <= parsed_date.year <= 2100:
            continue
        try:
            data = pd.read_excel(workbook, sheet_name=sheet_name, header=None)
        except Exception:
            continue
        columns = _usage_columns(data)
        if columns is None:
            continue
        header_row, item_column, amount_column = columns
        usage_items: list[tuple[str, float]] = []
        digital_items: list[tuple[str, float]] = []
        return_items: list[tuple[str, float]] = []
        capital_items: list[tuple[str, float]] = []
        for row_index in range(header_row + 1, len(data)):
            item = _text(data.iloc[row_index, item_column])
            amount = _amount(data.iloc[row_index, amount_column])
            if not item or amount is None or amount == 0 or _clean_name(item) == "total":
                continue
            normalized = _clean_name(item)
            if normalized in _DIGITAL_NAMES:
                digital_items.append((item, amount))
            elif normalized == "return":
                return_items.append((item, amount))
            elif _is_capital_item(item):
                capital_items.append((item, amount))
            elif not _is_excluded_operating_item(item):
                usage_items.append((item, amount))
        records.append(
            {
                "cost_date": parsed_date.date(),
                "branch": branch,
                "usage": _display(usage_items),
                "usage_total": sum(amount for _, amount in usage_items),
                "digital_income": _display(digital_items),
                "digital_income_total": sum(amount for _, amount in digital_items),
                "return_items": _display(return_items),
                "return_total": sum(amount for _, amount in return_items),
                "capital_expenditure": _display(capital_items),
                "capital_total": sum(amount for _, amount in capital_items),
                "source_sheet": str(sheet_name).strip(),
            }
        )
    return records
