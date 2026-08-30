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

# The two ambiguous 4-digit-year slash formats are handled separately from
# _OTHER_DATE_FORMATS below — see _detect_slash_date_order for why.
_MDY = "%m/%d/%Y"
_DMY = "%d/%m/%Y"
_SLASH_FORMATS_BY_CODE = {"MDY": _MDY, "DMY": _DMY}

_OTHER_DATE_FORMATS = [
    "%Y-%m-%d",
    "%m-%d-%Y",
    "%d-%m-%Y",
    "%m/%d/%y",
    "%d/%m/%y",
    # xls/xlsx report-date cells stored as real Excel dates come through
    # read_raw_grid as a stringified pandas Timestamp, e.g. "2026-02-01 00:00:00".
    "%Y-%m-%d %H:%M:%S",
    "%m/%d/%Y %H:%M:%S",
    "%d/%m/%Y %H:%M:%S",
]


def _fits(raw: str, fmt: str) -> bool:
    try:
        datetime.strptime(raw, fmt)
        return True
    except ValueError:
        return False


def _detect_slash_date_order(
    raw_dates: list[str], fallback: str = "MDY"
) -> tuple[str, str]:
    """Picks which of %m/%d/%Y or %d/%m/%Y to try first for this file's whole set of
    Date lines, rather than guessing per-row — a single POS export never mixes date
    locales row to row, but many raw dates (e.g. "09/02/2025") are valid under either
    reading, so trying a fixed order per row silently picks the wrong one for a file
    whose real convention is the other order. As soon as one raw date is decisive
    (valid under only one of the two — e.g. "31/01/2026", where month 31 is
    impossible), that settles the convention for every date in the file, ambiguous
    ones included.

    Different branches/POS terminals can (and, in this business, do) use different
    conventions — so this per-file detection stays authoritative whenever a file
    itself gives decisive evidence. `fallback` ("MDY" or "DMY", the admin-configurable
    `sale_date_format_fallback` business setting) only decides files with no decisive
    date at all — e.g. a single-day export whose one date happens to be ambiguous.
    """
    fallback_fmt = _SLASH_FORMATS_BY_CODE[fallback]
    fallback_other = _DMY if fallback_fmt == _MDY else _MDY

    for raw in raw_dates:
        raw = raw.strip()
        mdy_ok = _fits(raw, _MDY)
        dmy_ok = _fits(raw, _DMY)
        if mdy_ok and not dmy_ok:
            return (_MDY, _DMY)
        if dmy_ok and not mdy_ok:
            return (_DMY, _MDY)
    return (fallback_fmt, fallback_other)


def _parse_report_date(raw: str, slash_order: tuple[str, str] = (_MDY, _DMY)) -> str:
    raw = raw.strip()
    for fmt in (*slash_order, *_OTHER_DATE_FORMATS):
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


def parse_pos_sale_export_from_grid(
    rows: list[list[str]], fallback_date_format: str = "MDY"
) -> pd.DataFrame:
    """Parse a raw POS "sale" report grid into a clean, flat line-item table.

    The source is a printed-report format, not a plain table: a metadata line,
    a column-header line, a report-wide Date line, then repeating per-slip blocks
    (a "Slip Number" header line, one or more line-item rows, a subtotal row),
    followed by a grand-total row and a page footer. Row type is determined
    structurally so this keeps working on future exports in the same format,
    regardless of whether it arrived as CSV, XLS, or XLSX.

    `fallback_date_format` ("MDY" or "DMY") only matters when this file's own dates
    give no decisive evidence either way — see _detect_slash_date_order.
    """
    records: list[dict] = []
    origin_indices: list[int] = []

    slash_order = _detect_slash_date_order(
        [row[2] for row in rows if len(row) > 2 and row[0].strip() == "Date"],
        fallback=fallback_date_format,
    )

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
            report_date = _parse_report_date(row[2], slash_order)
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


def parse_pos_sale_export(path: Path, fallback_date_format: str = "MDY") -> pd.DataFrame:
    """Parse a POS sale export file on disk (csv/xls/xlsx) into a clean line-item table."""
    rows = read_raw_grid(path.read_bytes(), path.name)
    return parse_pos_sale_export_from_grid(rows, fallback_date_format)


def parse_pos_sale_upload(
    file_bytes: bytes, filename: str, fallback_date_format: str = "MDY"
) -> tuple[list[list[str]], pd.DataFrame]:
    """Parse an uploaded POS sale export, returning both the raw grid and the cleaned table."""
    rows = read_raw_grid(file_bytes, filename)
    return rows, parse_pos_sale_export_from_grid(rows, fallback_date_format)
