import datetime as dt
from pathlib import Path

import pandas as pd

from app.services.import_common import NumericRule, clean_description, clean_text, parse_number, read_raw_grid

OUTPUT_COLUMNS = [
    "StockCode",
    "Description",
    "Location",
    "Group",
    "On_Hand_Qty",
    "Buying_Price",
    "Selling_Price",
]

VALIDATION_RULES: list[NumericRule] = [
    ("On_Hand_Qty", 0),
    ("Buying_Price", None),
    ("Selling_Price", None),
]


_PRINTED_AT_FORMATS = {
    "MDY": "%m/%d/%Y %I:%M:%S%p",
    "DMY": "%d/%m/%Y %I:%M:%S%p",
}


def _parse_printed_at(cell: str, date_format: str = "MDY") -> dt.datetime | None:
    """Parse the report's own "Printed : 8/21/2026  7:07:11PM" metadata line.

    This is when the POS generated the report, which is what "current
    stock" should be dated to — not whenever someone got around to
    uploading the file, which can lag the actual count by hours or days.

    Unlike the sale export's per-slip Date lines, an inventory report has only this
    one date, which is essentially never decisive on its own (day and month are both
    likely <= 12 more often than not) — so there's no in-file evidence to detect the
    convention from. `date_format` ("MDY" or "DMY", the admin-configurable
    `inventory_date_format` business setting) is authoritative here rather than a
    fallback.
    """
    _, _, rest = cell.strip().partition(":")
    rest = " ".join(rest.split())
    try:
        return dt.datetime.strptime(rest, _PRINTED_AT_FORMATS[date_format])
    except ValueError:
        return None


def _is_stock_row(row: list[str]) -> bool:
    if len(row) < 14:
        return False
    stock_code = row[0].strip()
    on_hand_qty = parse_number(row[8])
    return bool(stock_code) and stock_code != "Stk. Code" and on_hand_qty is not None


def parse_inventory_export_from_grid(
    rows: list[list[str]], date_format: str = "MDY"
) -> pd.DataFrame:
    """Parse a raw POS "inventory" report grid into a clean stock table.

    Unlike the sale export, this is a flat table (not repeating per-slip
    blocks): a metadata line, a header line (whose labels are quoted
    multi-line cells), one row per stock item, a "Grand Total" row, and a
    page footer. A row counts as a stock item only if it has a StockCode
    and its On Hand Qty parses as a number — this single structural check
    excludes the header, the Grand Total row (whose totals sit in different
    column positions, leaving On Hand Qty's position empty), and the footer.

    `date_format` ("MDY" or "DMY") decides how the report's "Printed" timestamp is
    read — see _parse_printed_at for why it's authoritative here rather than detected.
    """
    records: list[dict] = []
    origin_indices: list[int] = []
    printed_at: dt.datetime | None = None

    for row_idx, row in enumerate(rows):
        if not row or not any(cell.strip() for cell in row):
            continue

        first = row[0].strip()
        if first.startswith("Printed"):
            printed_at = _parse_printed_at(first, date_format)
            continue
        if first.startswith("Grand Total"):
            continue

        if not _is_stock_row(row):
            continue

        records.append(
            {
                "StockCode": row[0].strip(),
                "Description": clean_description(row[2]),
                "Location": clean_text(row[3]),
                "Group": row[6].strip(),
                "On_Hand_Qty": parse_number(row[8]),
                "Buying_Price": parse_number(row[12]),
                "Selling_Price": parse_number(row[13]),
            }
        )
        origin_indices.append(row_idx)

    df = pd.DataFrame.from_records(records, columns=OUTPUT_COLUMNS)
    df.attrs["origin_indices"] = origin_indices
    df.attrs["printed_at"] = printed_at
    return df


def parse_inventory_export(path: Path, date_format: str = "MDY") -> pd.DataFrame:
    """Parse a POS inventory export file on disk (csv/xls/xlsx) into a clean stock table."""
    rows = read_raw_grid(path.read_bytes(), path.name)
    return parse_inventory_export_from_grid(rows, date_format)


def parse_inventory_upload(
    file_bytes: bytes, filename: str, date_format: str = "MDY"
) -> tuple[list[list[str]], pd.DataFrame]:
    """Parse an uploaded POS inventory export, returning both the raw grid and the cleaned table."""
    rows = read_raw_grid(file_bytes, filename)
    return rows, parse_inventory_export_from_grid(rows, date_format)
