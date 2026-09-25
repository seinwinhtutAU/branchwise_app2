#!/usr/bin/env python3
"""
Standalone Inventory File Inspector & Cleaner

Usage:
    python inspect_inventory.py --input /path/to/Rplistinnventorybogyoke21-9-2026.xlsx
    python inspect_inventory.py --input inventory.csv --save-clean

Features:
- Reads all sheets in multi-sheet Excel files (.xlsx / .xls / .csv)
- Dynamically locates column headers
- Counts total raw rows vs. valid products
- Breaks down: Qty > 0, Qty == 0, Qty < 0 (negative stock anomalies)
- Exports clean CSVs (full catalog and sparse non-zero stock)
"""

import argparse
import datetime as dt
from pathlib import Path
import sys

import pandas as pd


OUTPUT_COLUMNS = [
    "StockCode",
    "Description",
    "Location",
    "Group",
    "On_Hand_Qty",
    "Buying_Price",
    "Selling_Price",
]


def parse_number(val: object) -> float | None:
    if val is None or pd.isna(val):
        return None
    s = str(val).strip().replace(",", "")
    if not s or s == "#" * len(s):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def parse_printed_at(cell: str) -> dt.datetime | None:
    if ":" not in cell:
        return None
    _, _, rest = cell.strip().partition(":")
    rest = " ".join(rest.split())
    for fmt in ("%d/%m/%Y %I:%M:%S%p", "%m/%d/%Y %I:%M:%S%p", "%Y-%m-%d %H:%M:%S"):
        try:
            return dt.datetime.strptime(rest, fmt)
        except ValueError:
            pass
    return None


def detect_columns(row: list[str]) -> dict[str, int | None] | None:
    lowered = [" ".join(str(cell).strip().lower().split()) for cell in row]
    if not any(c in ("stk. code", "stk code", "stock code", "stock_code") for c in lowered):
        return None

    col_map = {
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


def inspect_and_clean_inventory(file_path: Path) -> tuple[pd.DataFrame, dict]:
    if not file_path.exists():
        print(f"Error: File not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    ext = file_path.suffix.lower()
    print(f"\n📂 Reading file: {file_path.name} ({file_path.stat().st_size / (1024*1024):.2f} MB)...")

    sheets_raw_counts = {}
    all_rows: list[list[str]] = []

    if ext == ".csv":
        import csv
        with open(file_path, "r", encoding="utf-8-sig", errors="replace") as f:
            all_rows = list(csv.reader(f))
        sheets_raw_counts["CSV"] = len(all_rows)
    elif ext in (".xlsx", ".xls"):
        excel_dict = pd.read_excel(file_path, sheet_name=None, header=None, dtype=str)
        for name, sheet_df in excel_dict.items():
            sheets_raw_counts[name] = len(sheet_df)
            if not sheet_df.empty:
                all_rows.extend(sheet_df.fillna("").astype(str).values.tolist())
    else:
        print(f"Unsupported file extension: {ext}", file=sys.stderr)
        sys.exit(1)

    print(f"📄 Sheets found: {len(sheets_raw_counts)}")
    total_raw_rows = sum(sheets_raw_counts.values())
    for name, cnt in sheets_raw_counts.items():
        print(f"   • {name}: {cnt:,} raw spreadsheet rows")
    print(f"   ► Total raw spreadsheet lines across all sheets: {total_raw_rows:,}")

    # Process rows with detailed category accounting
    records: list[dict] = []
    printed_at: dt.datetime | None = None
    col_map = {
        "stock_code": 0,
        "description": 2,
        "location": 3,
        "group": 6,
        "on_hand_qty": 8,
        "cost": 12,
        "price": 13,
    }

    count_blank_rows = 0
    count_header_title_rows = 0
    count_footer_total_rows = 0
    count_continuation_rows = 0
    count_invalid_qty_rows = 0

    for row in all_rows:
        if not row or not any(str(c).strip() for c in row):
            count_blank_rows += 1
            continue

        # Look for Printed :
        if printed_at is None:
            for c in row:
                c_str = str(c).strip()
                if "printed" in c_str.lower() and ":" in c_str:
                    p = parse_printed_at(c_str)
                    if p:
                        printed_at = p
                        break

        # Check for header
        d_map = detect_columns(row)
        if d_map:
            count_header_title_rows += 1
            for k, v in d_map.items():
                if v is not None:
                    col_map[k] = v
            continue

        # Skip headers / totals
        if any(str(c).strip().startswith("Grand Total") for c in row[:3]) or any("page -" in str(c).strip().lower() for c in row[:3]):
            count_footer_total_rows += 1
            continue
        if any("stock listing report" in str(c).strip().lower() for c in row[:5]) or any(str(c).strip().startswith("Printed") for c in row[:5]):
            count_header_title_rows += 1
            continue

        def _get(idx: int | None) -> str:
            if idx is not None and 0 <= idx < len(row):
                return str(row[idx]).strip()
            return ""

        stock_code = _get(col_map["stock_code"])
        if not stock_code:
            count_continuation_rows += 1
            continue

        if stock_code.lower() in ("stk. code", "stk code", "stock code", "grand total", "page -1"):
            count_header_title_rows += 1
            continue

        raw_qty = _get(col_map["on_hand_qty"])
        on_hand_qty = parse_number(raw_qty)
        if on_hand_qty is None:
            count_invalid_qty_rows += 1
            continue

        records.append(
            {
                "StockCode": stock_code,
                "Description": " ".join(_get(col_map["description"]).split()),
                "Location": " ".join(_get(col_map["location"]).split()),
                "Group": _get(col_map["group"]),
                "On_Hand_Qty": on_hand_qty,
                "Buying_Price": parse_number(_get(col_map["cost"])),
                "Selling_Price": parse_number(_get(col_map["price"])),
            }
        )

    df = pd.DataFrame.from_records(records, columns=OUTPUT_COLUMNS)

    pos_count = int((df["On_Hand_Qty"] > 0).sum()) if not df.empty else 0
    zero_count = int((df["On_Hand_Qty"] == 0).sum()) if not df.empty else 0
    neg_count = int((df["On_Hand_Qty"] < 0).sum()) if not df.empty else 0

    distinct_skus = df["StockCode"].nunique() if not df.empty else 0
    code_counts = df["StockCode"].value_counts() if not df.empty else pd.Series(dtype=int)
    duplicate_codes = code_counts[code_counts > 1]
    duplicate_codes_count = len(duplicate_codes)
    duplicate_rows_count = int(df["StockCode"].duplicated(keep=False).sum()) if not df.empty else 0

    non_item_rows = count_blank_rows + count_header_title_rows + count_footer_total_rows + count_continuation_rows + count_invalid_qty_rows

    stats = {
        "raw_rows": total_raw_rows,
        "valid_items": len(df),
        "non_item_rows": non_item_rows,
        "blank_rows": count_blank_rows,
        "header_title_rows": count_header_title_rows,
        "footer_total_rows": count_footer_total_rows,
        "continuation_rows": count_continuation_rows,
        "invalid_qty_rows": count_invalid_qty_rows,
        "distinct_skus": distinct_skus,
        "duplicate_codes_count": duplicate_codes_count,
        "duplicate_rows_count": duplicate_rows_count,
        "top_duplicates": duplicate_codes.head(10).to_dict() if not duplicate_codes.empty else {},
        "positive_items": pos_count,
        "zero_items": zero_count,
        "negative_items": neg_count,
        "printed_at": printed_at,
    }
    return df, stats


def main():
    parser = argparse.ArgumentParser(description="Inspect and clean POS inventory exports.")
    parser.add_argument("--input", "-i", type=Path, help="Path to inventory file (.xlsx, .xls, or .csv)")
    parser.add_argument("--save-clean", action="store_true", help="Save clean CSV output files")
    args = parser.parse_args()

    if not args.input:
        inp = input("Please enter the path to your inventory file (.xlsx / .csv): ").strip()
        if not inp:
            print("No file provided. Exiting.")
            sys.exit(0)
        file_path = Path(inp.strip('"').strip("'"))
    else:
        file_path = args.input

    df, stats = inspect_and_clean_inventory(file_path)

    print("\n" + "=" * 60)
    print("📊 INVENTORY INSPECTION & ROW ACCOUNTING SUMMARY")
    print("=" * 60)
    if stats["printed_at"]:
        print(f"🗓️  Report Printed Date     : {stats['printed_at'].strftime('%Y-%m-%d %I:%M:%S %p')}")
    print(f"📑 Total Raw Rows in Excel   : {stats['raw_rows']:,}")
    print("-" * 60)
    print(f"📦 Valid Product Items       : {stats['valid_items']:,}")
    print(f"🏷️  Unique Product Codes(SKU) : {stats['distinct_skus']:,}")
    print(f"   • In-Stock Items (Qty > 0): {stats['positive_items']:,} ({stats['positive_items']/max(stats['valid_items'],1)*100:.1f}%)")
    print(f"   • Zero-Stock (Qty = 0)    : {stats['zero_items']:,} ({stats['zero_items']/max(stats['valid_items'],1)*100:.1f}%)")
    if stats["negative_items"] > 0:
        print(f"   • Negative Stock (Qty < 0): {stats['negative_items']:,} (⚠️ Anomalies flagged)")
    print("-" * 60)
    print(f"🧹 Filtered Non-Item Rows    : {stats['non_item_rows']:,} (Total Excel rows that are not products)")
    print(f"   • Blank Spacing Rows      : {stats['blank_rows']:,} (Alternating empty rows between products)")
    print(f"   • Sub-lines/Continuations : {stats['continuation_rows']:,} (Multi-line text with no SKU)")
    print(f"   • Repeated Header & Titles: {stats['header_title_rows']:,} (Stk. Code, Report Title, Printed Date)")
    print(f"   • Page Footers & Totals   : {stats['footer_total_rows']:,} (Grand Total, Page -1 of 1)")
    if stats['invalid_qty_rows'] > 0:
        print(f"   • Rows with Invalid Qty   : {stats['invalid_qty_rows']:,}")
    print("=" * 60)
    print(f"🧮 Check: {stats['valid_items']:,} (valid) + {stats['non_item_rows']:,} (filtered) = {stats['valid_items'] + stats['non_item_rows']:,} (total raw rows)")
    print("=" * 60)

    # Show top duplicates if any
    if stats["top_duplicates"]:
        print("\n🔁 Top Repeated StockCodes (appearing in multiple rows):")
        for code, count in stats["top_duplicates"].items():
            sub_df = df[df["StockCode"] == code]
            desc = sub_df.iloc[0]["Description"] if not sub_df.empty else ""
            qtys = sub_df["On_Hand_Qty"].tolist()
            print(f"   • {code} ({desc}): repeated {count} times, Qty values: {qtys}")

    # Show samples
    if stats["positive_items"] > 0:
        print("\n🔍 Sample In-Stock Items (Qty > 0):")
        print(df[df["On_Hand_Qty"] > 0][["StockCode", "Description", "Group", "On_Hand_Qty", "Selling_Price"]].head(5).to_string(index=False))

    if stats["negative_items"] > 0:
        print("\n⚠️ Sample Negative Stock Items (Qty < 0):")
        print(df[df["On_Hand_Qty"] < 0][["StockCode", "Description", "Group", "On_Hand_Qty", "Selling_Price"]].head(5).to_string(index=False))

    # Save output if requested or ask
    if args.save_clean or input("\nSave cleaned CSV files? (y/n): ").strip().lower() == "y":
        out_dir = file_path.parent
        all_path = out_dir / f"{file_path.stem}_full_clean.csv"
        nonzero_path = out_dir / f"{file_path.stem}_nonzero_clean.csv"

        df.to_csv(all_path, index=False)
        df[df["On_Hand_Qty"] != 0].to_csv(nonzero_path, index=False)
        print(f"\n💾 Saved full cleaned catalog ({len(df):,} items) -> {all_path.name}")
        print(f"💾 Saved non-zero active stock ({stats['positive_items'] + stats['negative_items']:,} items) -> {nonzero_path.name}")


if __name__ == "__main__":
    main()
