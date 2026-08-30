import datetime as dt
from pathlib import Path

from app.services.inventory_import import OUTPUT_COLUMNS, parse_inventory_export

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


def test_multiline_description_collapsed(tmp_path: Path):
    df = parse_inventory_export(_write_sample(tmp_path))
    assert df.iloc[1]["Description"] == "Multi line"


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
