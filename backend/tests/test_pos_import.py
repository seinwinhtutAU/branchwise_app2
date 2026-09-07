import csv
import io
from pathlib import Path

import pandas as pd

from app.services.pos_import import OUTPUT_COLUMNS, parse_pos_sale_export, parse_pos_sale_upload

SAMPLE = (
    "﻿Printed : 8/21/2026  7:10:05PM,Aung Thit Sar,,,,,,,,,,\r\n"
    "Other Code,Stock Code,Description,Location,Price,Qty,UOM,Discount Amount,Amount,Net Amount,,\r\n"
    "Date,:,8/21/2026,,,,,,,,,\r\n"
    "Slip Number,:,2,Time,:,13:55:22,Counter,:,Counter1,UserID,:,Admin\r\n"
    ',U16085,Maldini,Aung Thit Sar,"72,500.00",1.00,Each,0.00,"72,500.00","72,500.00",,\r\n'
    '4.00,0.00,"72,500.00","72,500.00",,,,,,,,\r\n'
    "Slip Number,:,3,Time,:,14:31:13,Counter,:,Counter1,UserID,:,Admin\r\n"
    ',71642,"Multi\nline",Aung Thit Sar,"15,500.00",1.00,Each,0.00,"15,500.00","15,500.00",,\r\n'
    ',6217ke01,luofu,Aung Thit Sar,"34,500.00",2.00,Each,0.00,"69,000.00","69,000.00",,\r\n'
    '3.00,0.00,"84,500.00","84,500.00",,,,,,,,\r\n'
    'Total ,:,2,(Slips),3.00,0.00,"157,000.00","157,000.00",,,,\r\n'
    ",Page -1 of 1,,,,,,,,,,\r\n"
)


def _write_sample(tmp_path: Path) -> Path:
    path = tmp_path / "sale.csv"
    path.write_text(SAMPLE, encoding="utf-8")
    return path


def test_columns_and_row_count(tmp_path: Path):
    df = parse_pos_sale_export(_write_sample(tmp_path))
    assert list(df.columns) == OUTPUT_COLUMNS
    assert len(df) == 3


def test_numeric_fields_parsed(tmp_path: Path):
    df = parse_pos_sale_export(_write_sample(tmp_path))
    row = df.iloc[0]
    assert row["Selling_Price"] == 72500.0
    assert row["Qty"] == 1.0
    assert row["Amount"] == 72500.0


def test_synthetic_keys_and_date(tmp_path: Path):
    df = parse_pos_sale_export(_write_sample(tmp_path))
    assert df.iloc[0]["Date"] == "2026-08-21"
    assert df.iloc[0]["SlipID"] == "20260821-002"
    assert df.iloc[0]["LineID"] == "20260821-002-01"
    assert df.iloc[1]["SlipID"] == "20260821-003"
    assert df.iloc[1]["LineID"] == "20260821-003-01"
    assert df.iloc[1]["LineNo"] == 1
    assert df.iloc[2]["LineID"] == "20260821-003-02"
    assert df.iloc[2]["LineNo"] == 2


# "Multi Line", not "Multi line": descriptions are title-cased on the way in (see
# import_common.clean_description) — what this test is about is the newline collapsing.
def test_multiline_description_collapsed(tmp_path: Path):
    df = parse_pos_sale_export(_write_sample(tmp_path))
    assert df.iloc[1]["Description"] == "Multi Line"


def test_totals_and_footer_rows_excluded(tmp_path: Path):
    df = parse_pos_sale_export(_write_sample(tmp_path))
    assert df["Amount"].sum() == 157000.0
    assert not (df["StockCode"] == "Page -1 of 1").any()


def test_dmy_date_format_supported(tmp_path: Path):
    dmy_sample = SAMPLE.replace("Date,:,8/21/2026", "Date,:,21/08/2026")
    path = tmp_path / "sale.csv"
    path.write_text(dmy_sample, encoding="utf-8")
    df = parse_pos_sale_export(path)
    assert df.iloc[0]["Date"] == "2026-08-21"


def test_ambiguous_date_follows_file_wide_dmy_convention(tmp_path: Path):
    # A multi-day export like a real POS "sale detail" report: one Date line is
    # decisively DD/MM (month 31 can't be a month), the other is ambiguous under
    # either reading ("09/02/2026" could be Sep 2 or Feb 9). Real POS exports never
    # mix date locales row to row, so the decisive line should settle the ambiguous
    # one as DD/MM too — this is the exact bug seen on a real multi-day export where
    # ambiguous dates were silently parsed as month-first instead.
    multi_day_sample = (
        "﻿Printed : 31/01/2026  7:10:05PM,Aung Thit Sar,,,,,,,,,,\r\n"
        "Other Code,Stock Code,Description,Location,Price,Qty,UOM,Discount Amount,Amount,Net Amount,,\r\n"
        "Date,:,31/01/2026,,,,,,,,,\r\n"
        "Slip Number,:,1,Time,:,10:00:00,Counter,:,Counter1,UserID,:,Admin\r\n"
        ',U16085,Maldini,Aung Thit Sar,"72,500.00",1.00,Each,0.00,"72,500.00","72,500.00",,\r\n'
        '1.00,0.00,"72,500.00","72,500.00",,,,,,,,\r\n'
        "Date,:,09/02/2026,,,,,,,,,\r\n"
        "Slip Number,:,2,Time,:,11:00:00,Counter,:,Counter1,UserID,:,Admin\r\n"
        ',71642,Multi,Aung Thit Sar,"15,500.00",1.00,Each,0.00,"15,500.00","15,500.00",,\r\n'
        '1.00,0.00,"15,500.00","15,500.00",,,,,,,,\r\n'
        'Total ,:,2,(Slips),2.00,0.00,"88,000.00","88,000.00",,,,\r\n'
        ",Page -1 of 1,,,,,,,,,,\r\n"
    )
    path = tmp_path / "sale.csv"
    path.write_text(multi_day_sample, encoding="utf-8")
    df = parse_pos_sale_export(path)

    assert df.iloc[0]["Date"] == "2026-01-31"
    assert df.iloc[1]["Date"] == "2026-02-09"  # not 2026-09-02


def test_ambiguous_date_defaults_to_month_first_when_file_has_no_decisive_date(tmp_path: Path):
    mdy_sample = SAMPLE.replace("Date,:,8/21/2026", "Date,:,05/06/2026")
    path = tmp_path / "sale.csv"
    path.write_text(mdy_sample, encoding="utf-8")
    df = parse_pos_sale_export(path)

    assert df.iloc[0]["Date"] == "2026-05-06"  # month-first: May 6, not June 5


def test_ambiguous_date_respects_dmy_fallback_setting_when_no_decisive_date(tmp_path: Path):
    ambiguous_sample = SAMPLE.replace("Date,:,8/21/2026", "Date,:,05/06/2026")
    path = tmp_path / "sale.csv"
    path.write_text(ambiguous_sample, encoding="utf-8")

    df = parse_pos_sale_export(path, fallback_date_format="DMY")
    assert df.iloc[0]["Date"] == "2026-06-05"  # day-first: 5 June, not May 6


def test_xls_datetime_report_date_supported(tmp_path: Path):
    # .xls/.xlsx report-date cells stored as real Excel dates come through
    # read_raw_grid as a stringified pandas Timestamp, e.g. "2026-08-21 00:00:00".
    datetime_sample = SAMPLE.replace("Date,:,8/21/2026", "Date,:,2026-08-21 00:00:00")
    path = tmp_path / "sale.csv"
    path.write_text(datetime_sample, encoding="utf-8")
    df = parse_pos_sale_export(path)
    assert df.iloc[0]["Date"] == "2026-08-21"


ZAWGYI_SAMPLE = SAMPLE.replace("luofu", "ယုန္ျဖူ(က)ကတီပါ")


def test_zawgyi_description_converted_to_unicode(tmp_path: Path):
    path = tmp_path / "sale.csv"
    path.write_text(ZAWGYI_SAMPLE, encoding="utf-8")
    df = parse_pos_sale_export(path)
    assert df.iloc[2]["Description"] == "ယုန်ဖြူ(က)ကတီပါ"


ALREADY_UNICODE_SAMPLE = SAMPLE.replace("luofu", "ကလေးသိုင်း")


def test_already_unicode_description_left_unchanged(tmp_path: Path):
    """Regression test: text that is already proper Unicode Myanmar must not
    be run through the Zawgyi converter, which corrupts it (found while
    cleaning inventory.csv, which mixes already-Unicode and Zawgyi text)."""
    path = tmp_path / "sale.csv"
    path.write_text(ALREADY_UNICODE_SAMPLE, encoding="utf-8")
    df = parse_pos_sale_export(path)
    assert df.iloc[2]["Description"] == "ကလေးသိုင်း"


def _sample_as_xlsx_bytes() -> bytes:
    rows = list(csv.reader(io.StringIO(SAMPLE, newline="")))
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    buf = io.BytesIO()
    pd.DataFrame(padded).to_excel(buf, header=False, index=False, engine="openpyxl")
    return buf.getvalue()


def test_upload_csv_bytes():
    origin_rows, clean_df = parse_pos_sale_upload(SAMPLE.encode("utf-8"), "sale.csv")
    assert len(origin_rows) > 0
    assert len(clean_df) == 3
    assert list(clean_df.columns) == OUTPUT_COLUMNS


def test_upload_xlsx_bytes():
    origin_rows, clean_df = parse_pos_sale_upload(_sample_as_xlsx_bytes(), "sale.xlsx")
    assert len(origin_rows) > 0
    assert len(clean_df) == 3
    assert clean_df.iloc[0]["Selling_Price"] == 72500.0
    assert clean_df.iloc[0]["SlipID"] == "20260821-002"
    assert clean_df["Amount"].sum() == 157000.0
