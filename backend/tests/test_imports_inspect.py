import gzip
import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.services import staged_uploads

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
    a subsequent confirm. A recognized header (the common case) takes the fast
    path, which skips row_count/zero_count/nonzero_count entirely rather than
    running the full per-row parse just to fill in numbers this screen doesn't
    strictly need — see the "if detected == expected_type" branch."""
    _make_retail_user(db_session)
    response = authed_client.post(
        "/api/imports/inspect",
        data={"expected_type": "purchase"},
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "valid"
    assert body["row_count"] == 0
    assert body["staged_upload_id"]
    assert staged_uploads.load(body["staged_upload_id"]) is not None


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


def test_inspect_falls_back_to_a_full_parse_when_the_header_is_not_recognized(
    authed_client: TestClient, db_session: Session
):
    """A file whose header doesn't match any known signature can't take the fast
    path above (detect_report_type returns None) — inspect falls back to actually
    parsing it, which is how it tells a genuinely empty/unrelated file (row_count
    stays 0, status "unrecognized") apart from an unusual-but-valid one like this,
    whose data rows still parse fine structurally."""
    _make_retail_user(db_session)
    unrecognized_header_csv = PURCHASE_CSV.replace("Stock Code", "Item Code", 1)
    response = authed_client.post(
        "/api/imports/inspect",
        data={"expected_type": "purchase"},
        files={
            "file": (
                "purchase.csv",
                io.BytesIO(unrecognized_header_csv.encode()),
                "text/csv",
            )
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "valid"
    assert body["row_count"] == 1


def test_inspect_unrecognized_header_and_no_data_rows_is_flagged(
    authed_client: TestClient, db_session: Session
):
    _make_retail_user(db_session)
    response = authed_client.post(
        "/api/imports/inspect",
        data={"expected_type": "purchase"},
        files={
            "file": (
                "purchase.csv",
                io.BytesIO(b"Item Code,Description\r\n"),
                "text/csv",
            )
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "unrecognized"


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
