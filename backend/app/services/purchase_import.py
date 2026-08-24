from pathlib import Path

import pandas as pd

from app.services.import_common import NumericRule, clean_text, parse_number, read_raw_grid

OUTPUT_COLUMNS = [
    "StockCode",
    "Description",
    "Location",
    "Quantity",
    "UOM",
    "Buying_Price",
]

VALIDATION_RULES: list[NumericRule] = [
    ("Quantity", 1),
    ("Buying_Price", 0),
]


def _is_purchase_row(row: list[str]) -> bool:
    if len(row) < 7:
        return False
    stock_code = row[0].strip()
    if stock_code in ("", "Stock Code") or stock_code.startswith("Printed") or stock_code.startswith("Total"):
        return False
    return parse_number(row[4]) is not None


def parse_purchase_export_from_grid(rows: list[list[str]]) -> pd.DataFrame:
    """Parse a raw POS "purchase" report grid into a clean purchase-line table.

    Columns: Stock Code, Description, Location, Bin, Quantity, UOM, Unit Cost.
    A row counts as a purchase line only if it has a StockCode (and isn't a
    header/metadata/total row) and its Quantity parses as a number — kept
    structural, matching the sale/inventory cleaners, so this keeps working
    if a future export adds metadata or total rows like those files have.
    """
    records: list[dict] = []
    origin_indices: list[int] = []

    for row_idx, row in enumerate(rows):
        if not row or not any(cell.strip() for cell in row):
            continue

        if not _is_purchase_row(row):
            continue

        records.append(
            {
                "StockCode": row[0].strip(),
                "Description": clean_text(row[1]),
                "Location": clean_text(row[2]),
                "Quantity": parse_number(row[4]),
                "UOM": row[5].strip(),
                "Buying_Price": parse_number(row[6]),
            }
        )
        origin_indices.append(row_idx)

    df = pd.DataFrame.from_records(records, columns=OUTPUT_COLUMNS)
    df.attrs["origin_indices"] = origin_indices
    return df


def parse_purchase_export(path: Path) -> pd.DataFrame:
    """Parse a POS purchase export file on disk (csv/xls/xlsx) into a clean table."""
    rows = read_raw_grid(path.read_bytes(), path.name)
    return parse_purchase_export_from_grid(rows)


def parse_purchase_upload(file_bytes: bytes, filename: str) -> tuple[list[list[str]], pd.DataFrame]:
    """Parse an uploaded POS purchase export, returning both the raw grid and the cleaned table."""
    rows = read_raw_grid(file_bytes, filename)
    return rows, parse_purchase_export_from_grid(rows)
