import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.purchase import Purchase
from app.models.sale import Sale
from app.models.stock_level import StockLevel
from app.models.user import User, UserRole

SALE_CSV = (
    "﻿Printed : 8/21/2026  7:10:05PM,Aung Thit Sar,,,,,,,,,,\r\n"
    "Other Code,Stock Code,Description,Location,Price,Qty,UOM,Discount Amount,Amount,Net Amount,,\r\n"
    "Date,:,8/21/2026,,,,,,,,,\r\n"
    "Slip Number,:,2,Time,:,13:55:22,Counter,:,Counter1,UserID,:,Admin\r\n"
    ',U16085,Maldini,Aung Thit Sar,"72,500.00",1.00,Each,0.00,"72,500.00","72,500.00",,\r\n'
    '1.00,0.00,"72,500.00","72,500.00",,,,,,,,\r\n'
)

PURCHASE_CSV = (
    "Stock Code,Description,Location,Bin,Quantity,UOM,Unit Cost\r\n"
    "Crocs,Crocs,Aung Thit Sar,,6,Each,20050\r\n"
)

INVENTORY_CSV = (
    "﻿Printed : 8/21/2026  7:07:11PM,Aung Thit Sar,,,,,,,,,,,,,,\r\n"
    'Stk. Code,Other Code,Description,Location,Bin,Category,Group,Brand,"On Hand \n'
    'Qty","POS Sales\n'
    ' Qty","Outstanding \n'
    'Qty",Total Qty,Cost,Price,Price Amount,Cost Amount\r\n'
    '020-724000A,,Fashion,Aung Thit Sar,,,Lady,,4.00,0.00,0.00,4.00,"25,400.00","34,500.00","138,000.00","101,600.00"\r\n'
)


def _make_branch_user(db_session: Session, *, with_branch: bool) -> None:
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()

    db_session.add(
        User(
            id="test-user-id",
            name="Test User",
            email="test@example.com",
            role=UserRole.RETAIL,
            branch_id=branch.id if with_branch else None,
        )
    )
    db_session.commit()


def test_confirm_sales_with_branch(authed_client: TestClient, db_session: Session):
    _make_branch_user(db_session, with_branch=True)

    response = authed_client.post(
        "/api/imports/sales/confirm",
        files={"file": ("sale.csv", io.BytesIO(SALE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["sales_created"] == 1
    assert db_session.query(Sale).count() == 1


def test_confirm_purchase_with_branch(authed_client: TestClient, db_session: Session):
    _make_branch_user(db_session, with_branch=True)

    response = authed_client.post(
        "/api/imports/purchase/confirm",
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["purchase_lines_created"] == 1
    assert db_session.query(Purchase).count() == 1


def test_confirm_inventory_with_branch(authed_client: TestClient, db_session: Session):
    _make_branch_user(db_session, with_branch=True)

    response = authed_client.post(
        "/api/imports/inventory/confirm",
        files={"file": ("inventory.csv", io.BytesIO(INVENTORY_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["stock_levels_created"] == 1
    assert db_session.query(StockLevel).count() == 1


def test_confirm_without_branch_requires_branch_id(authed_client: TestClient, db_session: Session):
    _make_branch_user(db_session, with_branch=False)

    response = authed_client.post(
        "/api/imports/sales/confirm",
        files={"file": ("sale.csv", io.BytesIO(SALE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 400


def test_confirm_without_branch_accepts_supplied_branch_id(
    authed_client: TestClient, db_session: Session
):
    _make_branch_user(db_session, with_branch=False)
    other_branch = Branch(name="Wholesale", phone_number="000", address="TBD")
    db_session.add(other_branch)
    db_session.commit()

    response = authed_client.post(
        "/api/imports/sales/confirm",
        data={"branch_id": other_branch.id},
        files={"file": ("sale.csv", io.BytesIO(SALE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    sale = db_session.query(Sale).one()
    assert sale.branch_id == other_branch.id


def test_confirm_rejects_unsupported_extension(authed_client: TestClient, db_session: Session):
    _make_branch_user(db_session, with_branch=True)

    response = authed_client.post(
        "/api/imports/sales/confirm",
        files={"file": ("sale.txt", io.BytesIO(b"not a csv"), "text/plain")},
    )
    assert response.status_code == 400
