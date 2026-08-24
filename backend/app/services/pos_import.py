import logging
from datetime import datetime
from pathlib import Path

import pandas as pd

from app.services.import_common import (
    SUPPORTED_EXTENSIONS,
    NumericRule,
    clean_text,
    parse_number,
    read_raw_grid,
)

logger = logging.getLogger(__name__)

OUTPUT_COLUMNS = [
    "Date",
    "SlipID",
    "SlipNumber",
    "LineNo",
    "LineID",
    "StockCode",
    "Description",
    "Location",
    "Selling_Price",
    "Qty",
    "UOM",
    "Discount_Amount",
    "Amount",
    "Net_Amount",
    "Time",
]

VALIDATION_RULES: list[NumericRule] = [
    ("Selling_Price", 0),
    ("Qty", 1),
    ("Discount_Amount", None),
    ("Amount", None),
    ("Net_Amount", None),
]

_DATE_FORMATS = [
    "%m/%d/%Y",
    "%d/%m/%Y",
    "%Y-%m-%d",
    "%m-%d-%Y",
    "%d-%m-%Y",
    "%m/%d/%y",
    "%d/%m/%y",
]


def _parse_report_date(raw: str) -> str:
    raw = raw.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(raw, fmt).date().isoformat()
        except ValueError:
            continue
    raise ValueError(f"Unrecognized date format: {raw!r}")


def _is_line_item_row(row: list[str]) -> bool:
    if len(row) < 7:
        return False
    stock_code = row[1].strip()
    price = parse_number(row[4])
    qty = parse_number(row[5])
    return bool(stock_code) and price is not None and qty is not None


def parse_pos_sale_export_from_grid(rows: list[list[str]]) -> pd.DataFrame:
    """Parse a raw POS "sale" report grid into a clean, flat line-item table.

    The source is a printed-report format, not a plain table: a metadata line,
    a column-header line, a report-wide Date line, then repeating per-slip blocks
    (a "Slip Number" header line, one or more line-item rows, a subtotal row),
    followed by a grand-total row and a page footer. Row type is determined
    structurally so this keeps working on future exports in the same format,
    regardless of whether it arrived as CSV, XLS, or XLSX.
    """
    records: list[dict] = []
    origin_indices: list[int] = []

    report_date: str | None = None
    slip_number: str | None = None
    slip_time: str | None = None
    slip_id: str | None = None
    line_no = 0
    slip_line_total = 0.0
    slip_expected_total: float | None = None

    for row_idx, row in enumerate(rows):
        if not row or not any(cell.strip() for cell in row):
            continue

        first = row[0].strip()

        if first.startswith("Printed") or first == "Other Code":
            continue

        if first == "Date":
            report_date = _parse_report_date(row[2])
            continue

        if first == "Slip Number":
            if slip_expected_total is not None and abs(slip_line_total - slip_expected_total) > 0.01:
                logger.warning(
                    "Slip %s: line items sum to %.2f but subtotal row says %.2f",
                    slip_id, slip_line_total, slip_expected_total,
                )
            slip_number = row[2].strip()
            slip_time = row[5].strip()
            slip_id = f"{report_date.replace('-', '')}-{slip_number.zfill(3)}"
            line_no = 0
            slip_line_total = 0.0
            slip_expected_total = None
            continue

        if first.startswith("Total"):
            continue

        if _is_line_item_row(row):
            line_no += 1
            amount = parse_number(row[8]) or 0.0
            slip_line_total += amount
            records.append(
                {
                    "Date": report_date,
                    "SlipID": slip_id,
                    "SlipNumber": slip_number,
                    "LineNo": line_no,
                    "LineID": f"{slip_id}-{str(line_no).zfill(2)}",
                    "StockCode": row[1].strip(),
                    "Description": clean_text(row[2]),
                    "Location": clean_text(row[3]),
                    "Selling_Price": parse_number(row[4]),
                    "Qty": parse_number(row[5]),
                    "UOM": row[6].strip(),
                    "Discount_Amount": parse_number(row[7]),
                    "Amount": amount,
                    "Net_Amount": parse_number(row[9]) if len(row) > 9 else None,
                    "Time": slip_time,
                }
            )
            origin_indices.append(row_idx)
            continue

        # Per-slip subtotal row: "<qty_total>,<discount_total>,<amount_total>,<net_amount_total>,..."
        slip_expected_total = parse_number(row[2]) if len(row) > 2 else None

    if slip_expected_total is not None and abs(slip_line_total - slip_expected_total) > 0.01:
        logger.warning(
            "Slip %s: line items sum to %.2f but subtotal row says %.2f",
            slip_id, slip_line_total, slip_expected_total,
        )

    df = pd.DataFrame.from_records(records, columns=OUTPUT_COLUMNS)
    df.attrs["origin_indices"] = origin_indices
    return df


def parse_pos_sale_export(path: Path) -> pd.DataFrame:
    """Parse a POS sale export file on disk (csv/xls/xlsx) into a clean line-item table."""
    rows = read_raw_grid(path.read_bytes(), path.name)
    return parse_pos_sale_export_from_grid(rows)


def parse_pos_sale_upload(file_bytes: bytes, filename: str) -> tuple[list[list[str]], pd.DataFrame]:
    """Parse an uploaded POS sale export, returning both the raw grid and the cleaned table."""
    rows = read_raw_grid(file_bytes, filename)
    return rows, parse_pos_sale_export_from_grid(rows)
