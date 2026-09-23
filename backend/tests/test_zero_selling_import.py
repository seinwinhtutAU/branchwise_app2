from datetime import date
from io import BytesIO

import pandas as pd
from fastapi.testclient import TestClient

from app.core.security import get_current_app_user
from app.models.user import User, UserRole
from app.retail.models.sale import Sale
from app.retail.models.zero_selling import ZeroSellingRecord
from app.retail.services.zero_selling_import import parse_zero_selling_upload


def _zero_selling_file() -> bytes:
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(
            [
                ["Zero Selling Process", None, None, None, None],
                ["No", "Date", "Time", "Shop", "Category", "Reason"],
                [1, "5.8.2026", 0.5, "Aung Thit Sar-3", "No stock", "Size not available"],
                [2, "5.8.2026", 0.75, "Aung Thit Sar-3", "Price", "Too expensive"],
            ]
        ).to_excel(writer, index=False, header=False, sheet_name="Zero Selling")
    return output.getvalue()


def test_zero_selling_parser_uses_dmy_dates_and_branch_mapping():
    rows = parse_zero_selling_upload(_zero_selling_file(), "zero-selling.xlsx")
    assert rows == [
        {
            "sale_date": date(2026, 8, 5),
            "sale_time": "12:00:00",
            "branch": "Ashley",
            "category": "No stock",
            "reason": "Size not available",
            "source_sheet": "Zero Selling",
            "source_row": 3,
        },
        {
            "sale_date": date(2026, 8, 5),
            "sale_time": "18:00:00",
            "branch": "Ashley",
            "category": "Price",
            "reason": "Too expensive",
            "source_sheet": "Zero Selling",
            "source_row": 4,
        },
    ]


def test_conversion_rate_uses_sales_slips_and_zero_selling_records(client: TestClient, db_session):
    db_session.add_all(
        [
            ZeroSellingRecord(
                id="zero-1",
                import_batch_id="batch-1",
                branch_id="ashley",
                sale_date=date(2026, 8, 5),
                branch="Ashley",
                category="No stock",
                reason="Size not available",
                source_sheet="Zero Selling",
                source_row=3,
            ),
            ZeroSellingRecord(
                id="zero-2",
                import_batch_id="batch-1",
                branch_id="ashley",
                sale_date=date(2026, 8, 5),
                branch="Ashley",
                category="Price",
                reason="Too expensive",
                source_sheet="Zero Selling",
                source_row=4,
            ),
            Sale(id="sale-1", branch_id="ashley", slip_id="20260805-001", slip_number="1", sale_date=date(2026, 8, 5)),
            Sale(id="sale-2", branch_id="ashley", slip_id="20260805-002", slip_number="2", sale_date=date(2026, 8, 5)),
            Sale(id="sale-3", branch_id="ashley", slip_id="20260805-003", slip_number="3", sale_date=date(2026, 8, 5)),
        ]
    )
    db_session.commit()
    client.app.dependency_overrides[get_current_app_user] = lambda: User(
        id="admin", email="admin@example.com", role=UserRole.ADMIN
    )
    try:
        response = client.get("/api/zero-selling/conversion")
        assert response.status_code == 200, response.text
        assert response.json() == {
            "rows": [
                {
                    "Date": "2026-08-05",
                    "Branch": "Ashley",
                    "SalesSlips": 3,
                    "ZeroSelling": 2,
                    "ConversionRate": 60.0,
                }
            ],
            "total": 1,
        }
    finally:
        client.app.dependency_overrides.pop(get_current_app_user, None)
