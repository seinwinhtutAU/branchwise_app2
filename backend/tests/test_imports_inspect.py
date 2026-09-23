import gzip
import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.staged_upload import StagedImportUpload

PURCHASE_CSV = (
    "Stock Code,Description,Location,Bin,Quantity,UOM,Unit Cost\r\n"
    "Crocs,Crocs,Aung Thit Sar,,6,Each,20050\r\n"
)

SALE_CSV = (
    "﻿Printed : 8/21/2026  7:10:05PM,Aung Thit Sar,,,,,,,,,,\r\n"
    "Other Code,Stock Code,Description,Location,Price,Qty,UOM,Discount Amount,Amount,Net Amount,,\r\n"
    "Date,:,8/21/2026,,,,,,,,,\r\n"
    "Slip Number,:,2,Time,:,13:55:22,Counter,:,Counter1,UserID,:,Admin\r\n"
    ',U16085,Maldini,Aung Thit Sar,"72,500.00",1.00,Each,0.00,"72,500.00","72,500.00",,\r\n'
    '1.00,0.00,"72,500.00","72,500.00",,,,,,,,\r\n'
)


def _make_retail_user(db_session: Session) -> None:
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    db_session.add(
        User(
            id="test-user-id",
            name="Tester",
            email="test@example.com",
            role=UserRole.RETAIL,
            branch_id=branch.id,
        )
    )
    db_session.commit()


def test_inspect_valid_purchase_file_stages_the_upload(
    authed_client: TestClient, db_session: Session
):
    """The heavy parsing here moved off the event loop into a threadpool call (see
    _inspect_parsed_file in app.retail.routers.imports) — this pins down that the
    endpoint still behaves the same afterwards, including staging the upload for
    a subsequent confirm."""
    _make_retail_user(db_session)
    response = authed_client.post(
        "/api/imports/inspect",
        data={"expected_type": "purchase"},
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "valid"
    assert body["row_count"] == 1
    assert body["staged_upload_id"]
    assert db_session.query(StagedImportUpload).count() == 1


def test_inspect_accepts_gzip_compressed_upload(
    authed_client: TestClient, db_session: Session
):
    _make_retail_user(db_session)
    compressed = gzip.compress(SALE_CSV.encode())
    response = authed_client.post(
        "/api/imports/inspect",
        data={"expected_type": "sale"},
        files={"file": ("sale.csv", io.BytesIO(compressed), "text/csv")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "valid"
    assert body["row_count"] == 1


def test_inspect_flags_wrong_type(authed_client: TestClient, db_session: Session):
    _make_retail_user(db_session)
    response = authed_client.post(
        "/api/imports/inspect",
        data={"expected_type": "sale"},
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "wrong_type"
    assert body["detected_type"] == "purchase"


def test_inspect_rejects_unsupported_extension(
    authed_client: TestClient, db_session: Session
):
    _make_retail_user(db_session)
    response = authed_client.post(
        "/api/imports/inspect",
        data={"expected_type": "purchase"},
        files={"file": ("purchase.txt", io.BytesIO(b"not a csv"), "text/plain")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "invalid"
    assert "Unsupported file type" in body["error_message"]
