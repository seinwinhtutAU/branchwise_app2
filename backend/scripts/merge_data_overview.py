"""Merge sale/inventory/purchase clean CSVs into one sale-line-level
"Data Overview" workbook, with column headers color-coded by source:
green = sale.csv, blue = inventory.csv, pink = purchase.csv, no fill =
identifier/calculated columns.

Reads the already-cleaned CSVs (retail_data/*_clean.csv) rather than the
raw POS exports; run the clean_*_csv.py scripts first if those are stale.
"""

import argparse
from pathlib import Path

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

REPO_ROOT = Path(__file__).resolve().parents[2]

GREEN = "C6EFCE"
BLUE = "BDD7EE"
PINK = "F8CBAD"

# Column order + which source band(s) light up for each (sale, inventory, purchase).
COLUMNS = [
    ("Date", (True, False, False)),
    ("SlipID", (False, False, False)),
    ("SlipNumber", (True, False, False)),
    ("LineNo", (False, False, False)),
    ("LineID", (False, False, False)),
    ("StockCode", (True, True, True)),
    ("Description", (False, True, False)),
    ("Location", (False, True, False)),
    ("Selling_Price", (True, False, False)),
    ("Qty", (True, False, False)),
    ("UOM", (True, False, False)),
    ("Discount_Amount", (True, False, False)),
    ("Amount", (True, False, False)),
    ("Net_Amount", (True, False, False)),
    ("Time", (True, False, False)),
    ("Buying_Price", (False, True, True)),
    ("Group", (False, True, False)),
    ("profit", (False, False, False)),
    ("profit_margin_pct", (False, False, False)),
]

CURRENCY_COLS = {"Selling_Price", "Discount_Amount", "Amount", "Net_Amount", "Buying_Price", "profit"}


def build_merged_df(sale: pd.DataFrame, inventory: pd.DataFrame, purchase: pd.DataFrame) -> pd.DataFrame:
    inv_lookup = inventory.drop_duplicates("StockCode").set_index("StockCode")
    pur_lookup = purchase.drop_duplicates("StockCode").set_index("StockCode")

    df = sale.copy()
    df["Buying_Price"] = df["StockCode"].map(pur_lookup["Buying_Price"])
    df["Buying_Price"] = df["Buying_Price"].fillna(df["StockCode"].map(inv_lookup["Buying_Price"]))
    df["Group"] = df["StockCode"].map(inv_lookup["Group"])

    df["profit"] = df["Net_Amount"] - (df["Buying_Price"] * df["Qty"])
    df["profit_margin_pct"] = (df["profit"] / df["Net_Amount"] * 100).where(df["Net_Amount"] != 0)

    df["profit"] = df["profit"].round(2)
    df["profit_margin_pct"] = df["profit_margin_pct"].round(2)

    ordered_cols = [name for name, _ in COLUMNS]
    return df[ordered_cols]


def write_workbook(df: pd.DataFrame, output: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "Data Overview"

    fills = {
        1: PatternFill(start_color=GREEN, end_color=GREEN, fill_type="solid"),
        2: PatternFill(start_color=BLUE, end_color=BLUE, fill_type="solid"),
        3: PatternFill(start_color=PINK, end_color=PINK, fill_type="solid"),
    }

    for col_idx, (name, bands) in enumerate(COLUMNS, start=1):
        letter = get_column_letter(col_idx)
        for band_row, active in zip((1, 2, 3), bands):
            if active:
                ws[f"{letter}{band_row}"].fill = fills[band_row]
        header_cell = ws[f"{letter}4"]
        header_cell.value = name
        header_cell.font = Font(bold=True)
        header_cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        ws.column_dimensions[letter].width = max(12, len(name) + 2)

    for row in (1, 2, 3):
        ws.row_dimensions[row].height = 6
    ws.row_dimensions[4].height = 30

    for r, record in enumerate(df.itertuples(index=False), start=5):
        for c, value in enumerate(record, start=1):
            cell = ws.cell(row=r, column=c, value=None if pd.isna(value) else value)
            if COLUMNS[c - 1][0] in CURRENCY_COLS:
                cell.number_format = "#,##0.00"

    ws.freeze_panes = "A5"
    wb.save(output)


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge sale/inventory/purchase clean CSVs into one Data Overview workbook.")
    parser.add_argument("--sale", type=Path, default=REPO_ROOT / "retail_data" / "sale_clean.csv")
    parser.add_argument("--inventory", type=Path, default=REPO_ROOT / "retail_data" / "inventory_clean.csv")
    parser.add_argument("--purchase", type=Path, default=REPO_ROOT / "retail_data" / "purchase_clean.csv")
    parser.add_argument("--output", type=Path, default=REPO_ROOT / "retail_data" / "data_overview.xlsx")
    args = parser.parse_args()

    sale = pd.read_csv(args.sale)
    inventory = pd.read_csv(args.inventory)
    purchase = pd.read_csv(args.purchase)

    df = build_merged_df(sale, inventory, purchase)
    write_workbook(df, args.output)
    print(f"Wrote {len(df)} rows to {args.output}")


if __name__ == "__main__":
    main()
