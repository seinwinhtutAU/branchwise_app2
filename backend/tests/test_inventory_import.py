import datetime as dt
from pathlib import Path

from app.retail.services.inventory_import import OUTPUT_COLUMNS, parse_inventory_export

HEADER = (
    'Stk. Code,Other Code,Description,Location,Bin,Category,Group,Brand,"On Hand \n'
    'Qty","POS Sales\n'
    ' Qty","Outstanding \n'
    'Qty",Total Qty,Cost,Price,Price Amount,Cost Amount\r\n'
)

SAMPLE = (
    "﻿Printed : 8/21/2026  7:07:11PM,Aung Thit Sar,,,,,,,,,,,,,,\r\n"
    + HEADER
    + '020-724000A,,Fashion,Aung Thit Sar,,,Lady,,4.00,0.00,0.00,4.00,"25,400.00","34,500.00","138,000.00","101,600.00"\r\n'
    + '05119-743500A,,"Multi\nline",Aung Thit Sar,,,Baby,,1.00,0.00,0.00,1.00,"9,350.00","12,800.00","12,800.00","9,350.00"\r\n'
    + 'Grand Total ,"7,481.00","20,418,714.37","31,149,650.00","214,305,700.00","138,264,406.21",,,,,,,,,,\r\n'
    + ',Page -1 of 1,,,,,,,,,,,,,,\r\n'
)


def _write_sample(tmp_path: Path) -> Path:
    path = tmp_path / "inventory.csv"
    path.write_text(SAMPLE, encoding="utf-8")
    return path


def test_columns_and_row_count(tmp_path: Path):
    df = parse_inventory_export(_write_sample(tmp_path))
    assert list(df.columns) == OUTPUT_COLUMNS
    assert len(df) == 2


def test_numeric_fields_parsed(tmp_path: Path):
    df = parse_inventory_export(_write_sample(tmp_path))
    row = df.iloc[0]
    assert row["StockCode"] == "020-724000A"
    assert row["Group"] == "Lady"
    assert row["On_Hand_Qty"] == 4.0
    assert row["Buying_Price"] == 25400.0
    assert row["Selling_Price"] == 34500.0


# "Multi Line", not "Multi line": descriptions are title-cased on the way in (see
# import_common.clean_description) — what this test is about is the newline collapsing.
def test_multiline_description_collapsed(tmp_path: Path):
    df = parse_inventory_export(_write_sample(tmp_path))
    assert df.iloc[1]["Description"] == "Multi Line"


def test_header_grand_total_and_footer_excluded(tmp_path: Path):
    df = parse_inventory_export(_write_sample(tmp_path))
    assert df["On_Hand_Qty"].sum() == 5.0
    assert not (df["StockCode"] == "Grand Total").any()
    assert not (df["StockCode"] == "Page -1 of 1").any()


def test_printed_at_parsed_from_metadata_line(tmp_path: Path):
    df = parse_inventory_export(_write_sample(tmp_path))
    assert df.attrs["printed_at"] == dt.datetime(2026, 8, 21, 19, 7, 11)


def test_printed_at_none_when_metadata_line_missing(tmp_path: Path):
    path = tmp_path / "inventory.csv"
    path.write_text(SAMPLE.split("\r\n", 1)[1], encoding="utf-8")
    df = parse_inventory_export(path)
    assert df.attrs["printed_at"] is None


def test_printed_at_respects_dmy_date_format_setting(tmp_path: Path):
    # A single "Printed" timestamp is never decisive the way a sale export's many
    # Date lines can be, so this has to be an explicit setting rather than detected —
    # "21/08/2026" only makes sense as day-first (there's no month 21).
    dmy_sample = SAMPLE.replace("Printed : 8/21/2026", "Printed : 21/08/2026")
    path = tmp_path / "inventory.csv"
    path.write_text(dmy_sample, encoding="utf-8")

    df = parse_inventory_export(path, date_format="DMY")
    assert df.attrs["printed_at"] == dt.datetime(2026, 8, 21, 19, 7, 11)

    # Parsing that same DMY line under the MDY default fails outright (month 21 is
    # invalid), rather than silently misreading it — confirming the setting, not luck,
    # is what made the DMY case above work.
    default_df = parse_inventory_export(path)
    assert default_df.attrs["printed_at"] is None


ZAWGYI_SAMPLE = SAMPLE.replace("Fashion", "ျကိုးျကာနီမသာ‌ေ ရ", 1)


def test_zawgyi_description_converted_to_unicode(tmp_path: Path):
    path = tmp_path / "inventory.csv"
    path.write_text(ZAWGYI_SAMPLE, encoding="utf-8")
    df = parse_inventory_export(path)
    assert df.iloc[0]["Description"] == "ကြိုးကြာနီမသာ‌ေ ရ"


ALREADY_UNICODE_SAMPLE = SAMPLE.replace("Fashion", "ကလေးသိုင်း", 1)


def test_already_unicode_description_left_unchanged(tmp_path: Path):
    path = tmp_path / "inventory.csv"
    path.write_text(ALREADY_UNICODE_SAMPLE, encoding="utf-8")
    df = parse_inventory_export(path)
    assert df.iloc[0]["Description"] == "ကလေးသိုင်း"


def test_inventory_stats_and_nonzero_filtering(tmp_path: Path):
    from app.retail.services.inventory_import import filter_nonzero_stock

    mixed_sample = (
        "﻿Printed : 8/21/2026  7:07:11PM,Aung Thit Sar,,,,,,,,,,,,,,\r\n"
        + HEADER
        + 'SKU-001,,Item 1,Aung Thit Sar,,,Lady,,10.00,0.00,0.00,10.00,"1000.00","1500.00","15000.00","10000.00"\r\n'
        + 'SKU-002,,Item 2,Aung Thit Sar,,,Lady,,0.00,0.00,0.00,0.00,"2000.00","2500.00","0.00","0.00"\r\n'
        + 'SKU-003,,Item 3,Aung Thit Sar,,,Lady,,-5.00,0.00,0.00,-5.00,"3000.00","3500.00","-17500.00","-15000.00"\r\n'
    )
    path = tmp_path / "inventory_mixed.csv"
    path.write_text(mixed_sample, encoding="utf-8")

    df = parse_inventory_export(path)
    assert df.attrs["total_rows"] == 3
    assert df.attrs["positive_rows"] == 1
    assert df.attrs["zero_rows"] == 1
    assert df.attrs["negative_rows"] == 1

    nonzero_df = filter_nonzero_stock(df)
    assert len(nonzero_df) == 2
    assert set(nonzero_df["StockCode"]) == {"SKU-001", "SKU-003"}
    assert "SKU-002" not in nonzero_df["StockCode"].values
    assert nonzero_df.attrs["total_rows"] == 3


def test_shifted_columns_and_custom_layout(tmp_path: Path):
    """Test POS layout where headers and column positions are shifted (like column J for On Hand Qty)."""
    custom_sample = (
        ",,,,,,,,,,,,,,,,,,,,Printed : 20/09/2026 6:27:41PM,\r\n"
        ",,,,,,,,,Aung Thit Sar,,,,,,,,,,,,\r\n"
        ",,,,Stock Listing Report,,,,,,,,,,,,,,,,\r\n"
        "Stk. Code,Other Code,Description,,Location,Bin,Category,Group,Brand,On Hand Qty,POS Sales Qty,Outstanding Qty,Total Qty,,,,Cost,,Price,,Price Amount,,Cost Amount\r\n"
        "gc202-39,,guci,,Aung Thit Sar,,,Men,,0.00,0.00,0.00,0.00,,,,0.00,,1500.00,,0.00,,0.00\r\n"
        "000041,,Muzze,,Aung Thit Sar,,,Lady,,1.00,0.00,0.00,1.00,,,,28490.00,,47000.00,,47000.00,,28490.00\r\n"
    )
    path = tmp_path / "custom_inventory.csv"
    path.write_text(custom_sample, encoding="utf-8")

    df = parse_inventory_export(path, date_format="DMY")
    assert len(df) == 2
    assert df.attrs["printed_at"] == dt.datetime(2026, 9, 20, 18, 27, 41)

    row1 = df.iloc[0]
    assert row1["StockCode"] == "gc202-39"
    assert row1["Description"] == "Guci"
    assert row1["Location"] == "Aung Thit Sar"
    assert row1["Group"] == "Men"
    assert row1["On_Hand_Qty"] == 0.0
    assert row1["Buying_Price"] == 0.0
    assert row1["Selling_Price"] == 1500.0

    row2 = df.iloc[1]
    assert row2["StockCode"] == "000041"
    assert row2["Description"] == "Muzze"
    assert row2["On_Hand_Qty"] == 1.0
    assert row2["Buying_Price"] == 28490.0
    assert row2["Selling_Price"] == 47000.0


def test_multisheet_excel_parsing(tmp_path: Path):
    """Test reading an Excel workbook split into multiple sheets."""
    import pandas as pd
    from app.retail.services.inventory_import import parse_inventory_upload

    sheet1_data = {
        0: ["Printed : 8/21/2026 7:07:11PM", "Stk. Code", "SKU-S1-01"],
        1: ["", "Other Code", ""],
        2: ["", "Description", "Item Sheet 1"],
        3: ["", "Location", "Branch A"],
        4: ["", "Bin", ""],
        5: ["", "Category", ""],
        6: ["", "Group", "Lady"],
        7: ["", "Brand", ""],
        8: ["", "On Hand Qty", "5.00"],
        9: ["", "POS Sales Qty", "0.00"],
        10: ["", "Outstanding Qty", "0.00"],
        11: ["", "Total Qty", "5.00"],
        12: ["", "Cost", "1000.00"],
        13: ["", "Price", "1500.00"],
    }
    sheet2_data = {
        0: ["Stk. Code", "SKU-S2-02"],
        1: ["Other Code", ""],
        2: ["Description", "Item Sheet 2"],
        3: ["Location", "Branch A"],
        4: ["Bin", ""],
        5: ["Category", ""],
        6: ["Group", "Men"],
        7: ["Brand", ""],
        8: ["On Hand Qty", "8.00"],
        9: ["POS Sales Qty", "0.00"],
        10: ["Outstanding Qty", "0.00"],
        11: ["Total Qty", "8.00"],
        12: ["Cost", "2000.00"],
        13: ["Price", "2500.00"],
    }

    df_s1 = pd.DataFrame(sheet1_data)
    df_s2 = pd.DataFrame(sheet2_data)

    excel_path = tmp_path / "multi_sheet_inventory.xlsx"
    with pd.ExcelWriter(excel_path) as writer:
        df_s1.to_excel(writer, sheet_name="Sheet1", index=False, header=False)
        df_s2.to_excel(writer, sheet_name="Sheet2", index=False, header=False)

    rows, clean_df = parse_inventory_upload(excel_path.read_bytes(), excel_path.name)
    assert len(clean_df) == 2
    assert set(clean_df["StockCode"]) == {"SKU-S1-01", "SKU-S2-02"}
    assert clean_df.attrs["printed_at"] == dt.datetime(2026, 8, 21, 19, 7, 11)
