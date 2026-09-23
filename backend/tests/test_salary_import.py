from io import BytesIO

import pandas as pd
from fastapi.testclient import TestClient

from app.core.security import get_current_app_user
from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.salary import SalaryRecord


def _salary_file() -> bytes:
    output = BytesIO()
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        pd.DataFrame(
            [
                {"Name": "Ma Phyo", "Shop": "Aung Thit Sar-3 (ThuKiTar)", "Salary": 300000, "Bonus": None},
                {"Name": "Ma Mie", "Shop": "Aung Thit Sar-2", "Salary": 280000, "Bonus": 18000},
                {"Name": "Ma Pan Pan", "Shop": "Aung Thit Sar-4", "Salary": 250000, "Bonus": 0},
                {"Name": "Ma Hla", "Shop": "Aung Thit Sar-1", "Salary": 230000, "Bonus": None},
            ]
        ).to_excel(writer, index=False, sheet_name="June.2026")
    return output.getvalue()


def _current_user(user_id: str) -> User:
    return User(id=user_id, email="admin@example.com", role=UserRole.ADMIN)


def test_daily_operation_cost_parses_salary_rows_and_preserves_original(
    client: TestClient, db_session
):
    branches = [
        Branch(id="ashley", name="Ashley", phone_number="", address=""),
        Branch(id="bhs1", name="BHS1", phone_number="", address=""),
        Branch(id="ats", name="Aung Thit Sar", phone_number="", address=""),
        Branch(id="bogyoke", name="Bogyoke", phone_number="", address=""),
    ]
    db_session.add_all(branches)
    db_session.commit()
    client.app.dependency_overrides[get_current_app_user] = lambda: _current_user("test-user-id")
    try:
        payload = _salary_file()
        response = client.post(
            "/api/imports/general",
            data={"branch_id": "ats"},
            files={"file": ("Aung Thit Sar Salary.xlsx", payload, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert response.status_code == 200, response.text
        assert response.json()["salary_records_created"] == 4

        rows = db_session.query(SalaryRecord).order_by(SalaryRecord.branch).all()
        assert [(row.name, row.branch, float(row.salary), row.bonus) for row in rows] == [
            ("Ma Phyo", "Ashley", 300000.0, None),
            ("Ma Pan Pan", "Aung Thit Sar", 250000.0, 0),
            ("Ma Mie", "BHS1", 280000.0, 18000),
            ("Ma Hla", "Bogyoke", 230000.0, None),
        ]
        assert response.content != payload

        downloaded = client.get(f"/api/imports/history/{response.json()['id']}/download")
        assert downloaded.status_code == 200
        assert downloaded.content == payload
    finally:
        client.app.dependency_overrides.pop(get_current_app_user, None)


def test_salary_api_hides_other_branches_from_branch_scoped_user(client: TestClient, db_session):
    db_session.add_all(
        [
            SalaryRecord(id="salary-ashley", import_batch_id="batch-1", branch_id="ashley", name="Ma Phyo", branch="Ashley", salary=300000, bonus=None, source_sheet="May", source_row=2),
            SalaryRecord(id="salary-bhs1", import_batch_id="batch-2", branch_id="bhs1", name="Ma Mie", branch="BHS1", salary=280000, bonus=18000, source_sheet="May", source_row=3),
        ]
    )
    db_session.commit()
    client.app.dependency_overrides[get_current_app_user] = lambda: User(
        id="retail-user", email="retail@example.com", role=UserRole.RETAIL, branch_id="ashley"
    )
    try:
        response = client.get("/api/salaries")
        assert response.status_code == 200, response.text
        assert response.json() == {
            "rows": [{"Month": "May", "Name": "Ma Phyo", "Branch": "Ashley", "Salary": 300000, "Bonus": None}],
            "total": 1,
        }
    finally:
        client.app.dependency_overrides.pop(get_current_app_user, None)
