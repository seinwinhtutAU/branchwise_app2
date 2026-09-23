import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.import_batch import ImportType
from app.retail.services.clean_rows import (
    clean_row_count,
    clean_rows_all,
    clean_rows_page,
    clean_warning_scan,
)

SALE_CSV = (
    "﻿Printed : 8/21/2026  7:10:05PM,Aung Thit Sar,,,,,,,,,,\r\n"
    "Other Code,Stock Code,Description,Location,Price,Qty,UOM,Discount Amount,Amount,Net Amount,,\r\n"
    "Date,:,8/21/2026,,,,,,,,,\r\n"
    "Slip Number,:,2,Time,:,13:55:22,Counter,:,Counter1,UserID,:,Admin\r\n"
    ',U16085,Maldini,Aung Thit Sar,"72,500.00",1.00,Each,0.00,"72,500.00","72,500.00",,\r\n'
    '1.00,0.00,"72,500.00","72,500.00",,,,,,,,\r\n'
)


def _make_user(db_session: Session) -> Branch:
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    db_session.add(
        User(
            id="test-user-id",
            name="Test User",
            email="test@example.com",
            role=UserRole.RETAIL,
            branch_id=branch.id,
        )
    )
    db_session.commit()
    return branch


def test_clean_rows_reconstruct_a_confirmed_sale_batch(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session)
    response = authed_client.post(
        "/api/imports/sales/confirm",
        files={"file": ("sale.csv", io.BytesIO(SALE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    batch_id = response.json()["batch_id"]

    assert clean_row_count(db_session, ImportType.SALES, batch_id) == 1

    rows = clean_rows_page(db_session, ImportType.SALES, batch_id, offset=0, limit=50)
    assert len(rows) == 1
    assert rows[0]["StockCode"] == "U16085"
    assert rows[0]["Qty"] == 1.0

    assert clean_rows_all(db_session, ImportType.SALES, batch_id) == rows

    warning_count, indices = clean_warning_scan(db_session, ImportType.SALES, batch_id)
    assert warning_count == 0
    assert indices == []
