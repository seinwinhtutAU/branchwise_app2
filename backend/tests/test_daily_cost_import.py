from datetime import date
from io import BytesIO

import pandas as pd

from app.retail.services.daily_cost_import import parse_daily_cost_upload


def _daily_cost_file() -> bytes:
    rows = [
        [None] * 9 + ["အသုံး", None],
        [None] * 9 + ["Donation", 2000],
        [None] * 9 + ["U KPAY", 311250],
        [None] * 9 + ["Return", 5000],
        [None] * 9 + ["ဆိုင်းဘုတ်ခွံ", 60000],
        [None] * 9 + ["Bonus", 10000],
    ]
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(rows).to_excel(writer, index=False, header=False, sheet_name="20.9.26")
        pd.DataFrame([["not a daily sheet"]]).to_excel(
            writer, index=False, header=False, sheet_name="Notes"
        )
    return output.getvalue()


def test_daily_cost_parser_separates_the_four_daily_sections():
    rows = parse_daily_cost_upload(_daily_cost_file(), "GeneralUsageAshley20926.xlsx")
    assert rows == [
        {
            "cost_date": date(2026, 9, 20),
            "branch": "Ashley",
            "usage": "Donation=2000",
            "usage_total": 2000.0,
            "digital_income": "U KPAY=311250",
            "digital_income_total": 311250.0,
            "return_items": "Return=5000",
            "return_total": 5000.0,
            "capital_expenditure": "ဆိုင်းဘုတ်ခွံ=60000",
            "capital_total": 60000.0,
            "source_sheet": "20.9.26",
        }
    ]


def test_daily_cost_parser_recognizes_bsh_filename_as_bhs1():
    rows = parse_daily_cost_upload(_daily_cost_file(), "GeneralUsageBSH1220926.xlsx")
    assert rows[0]["branch"] == "BHS 1"
