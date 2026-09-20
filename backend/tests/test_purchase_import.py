import datetime as dt
from pathlib import Path

from app.retail.services.purchase_import import OUTPUT_COLUMNS, extract_purchase_metadata, parse_purchase_export

SAMPLE = (
    "Stock Code,Description,Location,Bin,Quantity,UOM,Unit Cost\r\n"
    "Crocs,Crocs,Aung Thit Sar,,6,Each,20050\r\n"
    "e7214,luofu,Aung Thit Sar,,6,Each,31700\r\n"
)


def _write_sample(tmp_path: Path) -> Path:
    path = tmp_path / "purchase.csv"
    path.write_text(SAMPLE, encoding="utf-8")
    return path


def test_columns_and_row_count(tmp_path: Path):
    df = parse_purchase_export(_write_sample(tmp_path))
    assert list(df.columns) == OUTPUT_COLUMNS
    assert len(df) == 2


def test_numeric_fields_parsed(tmp_path: Path):
    df = parse_purchase_export(_write_sample(tmp_path))
    row = df.iloc[0]
    assert row["StockCode"] == "Crocs"
    assert row["Quantity"] == 6.0
    assert row["UOM"] == "Each"
    assert row["Buying_Price"] == 20050.0


def test_header_row_excluded(tmp_path: Path):
    df = parse_purchase_export(_write_sample(tmp_path))
    assert not (df["StockCode"] == "Stock Code").any()


ZAWGYI_SAMPLE = SAMPLE.replace("luofu", "ျကိုးျကာနီမသာ‌ေ ရ")


def test_zawgyi_description_converted_to_unicode(tmp_path: Path):
    path = tmp_path / "purchase.csv"
    path.write_text(ZAWGYI_SAMPLE, encoding="utf-8")
    df = parse_purchase_export(path)
    assert df.iloc[1]["Description"] == "ကြိုးကြာနီမသာ‌ေ ရ"


ALREADY_UNICODE_SAMPLE = SAMPLE.replace("luofu", "ကလေးသိုင်း")


def test_already_unicode_description_left_unchanged(tmp_path: Path):
    path = tmp_path / "purchase.csv"
    path.write_text(ALREADY_UNICODE_SAMPLE, encoding="utf-8")
    df = parse_purchase_export(path)
    assert df.iloc[1]["Description"] == "ကလေးသိုင်း"


def test_extract_purchase_metadata_standard_hyphenated():
    num, p_date = extract_purchase_metadata("STR-000067-purchase-bogyoke-19-9-26.xlsx")
    assert num == "STR-000067"
    assert p_date == dt.date(2026, 9, 19)


def test_extract_purchase_metadata_unhyphenated_and_short_year():
    num, p_date = extract_purchase_metadata("STR000067purchase19-9-26.xls")
    assert num == "STR-000067"
    assert p_date == dt.date(2026, 9, 19)


def test_extract_purchase_metadata_existing_file_pattern():
    num, p_date = extract_purchase_metadata("STR-001303purchase19-9-26.xls")
    assert num == "STR-001303"
    assert p_date == dt.date(2026, 9, 19)


def test_extract_purchase_metadata_underscore_and_full_year():
    num, p_date = extract_purchase_metadata("STR_000067_purchase_19-09-2026.xlsx")
    assert num == "STR-000067"
    assert p_date == dt.date(2026, 9, 19)


def test_extract_purchase_metadata_iso_date():
    num, p_date = extract_purchase_metadata("STR-000067-2026-09-19.xlsx")
    assert num == "STR-000067"
    assert p_date == dt.date(2026, 9, 19)


def test_extract_purchase_metadata_fallback_when_missing():
    num, p_date = extract_purchase_metadata("plain_purchase_report.xlsx")
    assert num is None
    assert p_date is None
