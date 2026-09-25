import datetime as dt
from pathlib import Path

import pandas as pd

from app.retail.services.import_common import NumericRule, clean_description, clean_text, parse_number, read_raw_grid

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
    """Parse the report's own "Printed : 8/21/2026  7:07:11PM" metadata line."""
    if ":" not in cell:
        return None
    _, _, rest = cell.strip().partition(":")
    rest = " ".join(rest.split())
    try:
        return dt.datetime.strptime(rest, _PRINTED_AT_FORMATS[date_format])
    except (ValueError, KeyError):
        return None


def _detect_column_indices(row: list[str]) -> dict[str, int | None] | None:
    """Detect column positions from a header row dynamically."""
    lowered = [" ".join(cell.strip().lower().split()) for cell in row]
    if not any(c in ("stk. code", "stk code", "stock code", "stock_code") for c in lowered):
        return None

    col_map: dict[str, int | None] = {
        "stock_code": None,
        "description": None,
        "location": None,
        "group": None,
        "on_hand_qty": None,
        "cost": None,
        "price": None,
    }

    for idx, c in enumerate(lowered):
        if c in ("stk. code", "stk code", "stock code", "stock_code"):
            col_map["stock_code"] = idx
        elif c in ("description", "item name", "product name", "item description"):
            col_map["description"] = idx
        elif c in ("location", "loc"):
            col_map["location"] = idx
        elif c in ("group", "category", "dept"):
            col_map["group"] = idx
        elif "on hand" in c or c in ("on hand qty", "on_hand_qty", "qty on hand", "stock qty", "stock_qty"):
            col_map["on_hand_qty"] = idx
        elif c == "total qty" and col_map["on_hand_qty"] is None:
            col_map["on_hand_qty"] = idx
        elif c in ("cost", "buying price", "buying_price", "buy price", "unit cost") and "amount" not in c:
            col_map["cost"] = idx
        elif c in ("price", "selling price", "selling_price", "sell price", "unit price") and "amount" not in c:
            col_map["price"] = idx

    return col_map


def parse_inventory_export_from_grid(
    rows: list[list[str]], date_format: str = "MDY"
) -> pd.DataFrame:
    """Parse a raw POS "inventory" report grid into a clean stock table.

    Supports both flat single-sheet grids and concatenated multi-sheet workbooks,
    dynamically resolving column headers to accommodate various POS export layouts.
    """
    records: list[dict] = []
    origin_indices: list[int] = []
    printed_at: dt.datetime | None = None

    # Default fallback column indices
    col_map: dict[str, int | None] = {
        "stock_code": 0,
        "description": 2,
        "location": 3,
        "group": 6,
        "on_hand_qty": 8,
        "cost": 12,
        "price": 13,
    }

    for row_idx, row in enumerate(rows):
        if not row or not any(cell.strip() for cell in row):
            continue

        # Check for printed_at metadata across any cell in the row
        if printed_at is None:
            for cell in row:
                if "printed" in cell.lower() and ":" in cell:
                    p_at = _parse_printed_at(cell, date_format)
                    if p_at:
                        printed_at = p_at
                        break

        # Check if row is a header row to update dynamic column mapping
        detected_map = _detect_column_indices(row)
        if detected_map is not None:
            # Update mapped indices with detected ones
            for k, v in detected_map.items():
                if v is not None:
                    col_map[k] = v
            continue

        # Check for grand total or metadata banners
        if any(cell.strip().startswith("Grand Total") for cell in row[:3]):
            continue
        if any("stock listing report" in cell.strip().lower() for cell in row[:5]):
            continue

        # Extract values using current column mapping with safe bounds
        def _get(idx: int | None) -> str:
            if idx is not None and 0 <= idx < len(row):
                return row[idx].strip()
            return ""

        stock_code = _get(col_map["stock_code"])
        if not stock_code or stock_code.lower() in ("stk. code", "stk code", "stock code", "grand total", "page -1"):
            continue

        raw_qty = _get(col_map["on_hand_qty"])
        on_hand_qty = parse_number(raw_qty)
        if on_hand_qty is None:
            continue

        records.append(
            {
                "StockCode": stock_code,
                "Description": clean_description(_get(col_map["description"])),
                "Location": clean_text(_get(col_map["location"])),
                "Group": _get(col_map["group"]),
                "On_Hand_Qty": on_hand_qty,
                "Buying_Price": parse_number(_get(col_map["cost"])),
                "Selling_Price": parse_number(_get(col_map["price"])),
            }
        )
        origin_indices.append(row_idx)

    df = pd.DataFrame.from_records(records, columns=OUTPUT_COLUMNS)
    df.attrs["origin_indices"] = origin_indices
    df.attrs["printed_at"] = printed_at
    if not df.empty:
        df.attrs["total_rows"] = len(df)
        df.attrs["zero_rows"] = int((df["On_Hand_Qty"] == 0).sum())
        df.attrs["negative_rows"] = int((df["On_Hand_Qty"] < 0).sum())
        df.attrs["positive_rows"] = int((df["On_Hand_Qty"] > 0).sum())
    else:
        df.attrs["total_rows"] = 0
        df.attrs["zero_rows"] = 0
        df.attrs["negative_rows"] = 0
        df.attrs["positive_rows"] = 0
    return df


def filter_nonzero_stock(df: pd.DataFrame) -> pd.DataFrame:
    """Filter inventory DataFrame to only keep rows with non-zero stock (On_Hand_Qty != 0).
    
    Preserves negative stock (On_Hand_Qty < 0) for anomaly detection while omitting
    zero-stock items to reduce storage footprint.
    """
    if df.empty:
        return df
    filtered = df[df["On_Hand_Qty"] != 0].copy()
    filtered.attrs = dict(df.attrs)
    return filtered


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
