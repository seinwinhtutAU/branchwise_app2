import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole

# Sales: one good row (Qty=1), one bad row (Qty=0 — below the minimum of 1)
SALE_CSV = (
    "﻿Printed : 8/21/2026  7:10:05PM,Aung Thit Sar,,,,,,,,,,\r\n"
    "Other Code,Stock Code,Description,Location,Price,Qty,UOM,Discount Amount,Amount,Net Amount,,\r\n"
    "Date,:,8/21/2026,,,,,,,,,\r\n"
    "Slip Number,:,2,Time,:,13:55:22,Counter,:,Counter1,UserID,:,Admin\r\n"
    ',U16085,Maldini,Aung Thit Sar,"72,500.00",1.00,Each,0.00,"72,500.00","72,500.00",,\r\n'
    '1.00,0.00,"72,500.00","72,500.00",,,,,,,,\r\n'
    "Slip Number,:,3,Time,:,14:00:00,Counter,:,Counter1,UserID,:,Admin\r\n"
    ',U16086,BadRow,Aung Thit Sar,"1,000.00",0.00,Each,0.00,"0.00","0.00",,\r\n'
    '0.00,0.00,"0.00","0.00",,,,,,,,\r\n'
)

# Purchase: one good row, one bad row (negative Buying_Price)
PURCHASE_CSV = (
    "Stock Code,Description,Location,Bin,Quantity,UOM,Unit Cost\r\n"
    "Crocs,Crocs,Aung Thit Sar,,6,Each,20050\r\n"
    "Bad,Bad,Aung Thit Sar,,1,Each,-5\r\n"
)

# Inventory: one good row, one bad row (negative On Hand Qty)
INVENTORY_CSV = (
    "﻿Printed : 8/21/2026  7:07:11PM,Aung Thit Sar,,,,,,,,,,,,,,\r\n"
    'Stk. Code,Other Code,Description,Location,Bin,Category,Group,Brand,"On Hand \n'
    'Qty","POS Sales\n'
    ' Qty","Outstanding \n'
    'Qty",Total Qty,Cost,Price,Price Amount,Cost Amount\r\n'
    '020-724000A,,Fashion,Aung Thit Sar,,,Lady,,4.00,0.00,0.00,4.00,"25,400.00","34,500.00","138,000.00","101,600.00"\r\n'
    '020-724001A,,Bad,Aung Thit Sar,,,Lady,,-1.00,0.00,0.00,-1.00,"25,400.00","34,500.00","0.00","0.00"\r\n'
)


def _make_retail_user(db_session: Session) -> None:
    # Preview for Sale/Inventory now needs an app-level user profile (to resolve the
    # uploader's branch for its date-format setting), not just a valid JWT — see
    # app.routers.imports._resolve_branch_for_preview.
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


def test_sales_preview_flags_bad_qty(authed_client: TestClient, db_session: Session):
    _make_retail_user(db_session)
    response = authed_client.post(
        "/api/imports/sales",
        files={"file": ("sale.csv", io.BytesIO(SALE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    body = response.json()

    clean_issues = body["clean"]["row_issues"]
    assert clean_issues[0] == []
    assert clean_issues[1] == [{"column": "Qty", "message": "Quantity can't be zero — enter at least 1"}]

    origin = body["origin"]
    assert len(origin["row_issues"]) == len(origin["rows"])
    bad_rows = [i for i, issues in enumerate(origin["row_issues"]) if issues]
    assert len(bad_rows) == 1
    assert origin["rows"][bad_rows[0]][1] == "U16086"
    assert origin["row_issues"][bad_rows[0]] == clean_issues[1]


def test_purchase_preview_flags_negative_price(authed_client: TestClient):
    response = authed_client.post(
        "/api/imports/purchase",
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    body = response.json()

    clean_issues = body["clean"]["row_issues"]
    assert clean_issues[0] == []
    assert clean_issues[1] == [
        {"column": "Buying_Price", "message": "Buying Price can't be a negative number"}
    ]

    origin = body["origin"]
    bad_rows = [i for i, issues in enumerate(origin["row_issues"]) if issues]
    assert len(bad_rows) == 1
    assert origin["rows"][bad_rows[0]][0] == "Bad"


def test_inventory_preview_flags_negative_qty(authed_client: TestClient, db_session: Session):
    _make_retail_user(db_session)
    response = authed_client.post(
        "/api/imports/inventory",
        files={"file": ("inventory.csv", io.BytesIO(INVENTORY_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    body = response.json()

    clean_issues = body["clean"]["row_issues"]
    assert clean_issues[0] == []
    assert clean_issues[1] == [
        {"column": "On_Hand_Qty", "message": "Stock Quantity can't be a negative number"}
    ]

    origin = body["origin"]
    bad_rows = [i for i, issues in enumerate(origin["row_issues"]) if issues]
    assert len(bad_rows) == 1
    assert origin["rows"][bad_rows[0]][0] == "020-724001A"


def test_sales_endpoint_rejects_purchase_file(authed_client: TestClient, db_session: Session):
    _make_retail_user(db_session)
    response = authed_client.post(
        "/api/imports/sales",
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 400
    assert "Purchase file" in response.json()["detail"]
    assert "Sale file" in response.json()["detail"]


def test_purchase_endpoint_rejects_inventory_file(authed_client: TestClient):
    response = authed_client.post(
        "/api/imports/purchase",
        files={"file": ("inventory.csv", io.BytesIO(INVENTORY_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 400
    assert "Inventory file" in response.json()["detail"]
    assert "Purchase file" in response.json()["detail"]


def test_inventory_endpoint_rejects_sale_file(authed_client: TestClient, db_session: Session):
    _make_retail_user(db_session)
    response = authed_client.post(
        "/api/imports/inventory",
        files={"file": ("sale.csv", io.BytesIO(SALE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 400
    assert "Sale file" in response.json()["detail"]
    assert "Inventory file" in response.json()["detail"]


def test_sales_preview_accepts_admin_with_branch_id_and_applies_its_date_format(
    authed_client: TestClient, db_session: Session
):
    # An admin account (no fixed branch) can pass branch_id even at preview time —
    # once the review screen's branch picker has a selection, the frontend re-previews
    # with it so the table reflects that branch's date format before confirm.
    branch = Branch(
        name="Ashley", phone_number="000", address="TBD", sale_date_format="DMY"
    )
    db_session.add(branch)
    db_session.flush()
    db_session.add(
        User(id="test-user-id", name="Admin", email="admin@example.com", role=UserRole.ADMIN)
    )
    db_session.commit()

    ambiguous_csv = SALE_CSV.replace("Date,:,8/21/2026", "Date,:,05/06/2026")
    response = authed_client.post(
        "/api/imports/sales",
        data={"branch_id": branch.id},
        files={"file": ("sale.csv", io.BytesIO(ambiguous_csv.encode()), "text/csv")},
    )
    assert response.status_code == 200
    row = response.json()["clean"]["rows"][0]
    assert row["Date"] == "2026-06-05"  # day-first: 5 June, not May 6


def test_sales_preview_defaults_to_mdy_when_admin_has_not_picked_a_branch_yet(
    authed_client: TestClient, db_session: Session
):
    db_session.add(
        User(id="test-user-id", name="Admin", email="admin@example.com", role=UserRole.ADMIN)
    )
    db_session.commit()

    ambiguous_csv = SALE_CSV.replace("Date,:,8/21/2026", "Date,:,05/06/2026")
    response = authed_client.post(
        "/api/imports/sales",
        files={"file": ("sale.csv", io.BytesIO(ambiguous_csv.encode()), "text/csv")},
    )
    assert response.status_code == 200
    row = response.json()["clean"]["rows"][0]
    assert row["Date"] == "2026-05-06"  # month-first default: May 6
