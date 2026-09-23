import io

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.purchase import Purchase
from app.retail.models.sale import Sale
from app.retail.models.staged_upload import StagedImportUpload
from app.retail.models.stock_level import StockLevel
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


def test_confirm_purchase_replays_the_same_idempotency_key(
    authed_client: TestClient, db_session: Session
):
    _make_branch_user(db_session, with_branch=True)
    headers = {"Idempotency-Key": "weak-network-purchase-001"}

    first = authed_client.post(
        "/api/imports/purchase/confirm",
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
        headers=headers,
    )
    second = authed_client.post(
        "/api/imports/purchase/confirm",
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
        headers=headers,
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()
    assert db_session.query(Purchase).count() == 1


def test_confirm_purchase_with_date_override(authed_client: TestClient, db_session: Session):
    _make_branch_user(db_session, with_branch=True)

    response = authed_client.post(
        "/api/imports/purchase/confirm",
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
        data={"purchase_date": "2026-01-15"},
    )
    assert response.status_code == 200
    purchase = db_session.query(Purchase).one()
    assert purchase.purchase_date.isoformat() == "2026-01-15"


def test_confirm_purchase_with_invalid_date_is_rejected(authed_client: TestClient, db_session: Session):
    _make_branch_user(db_session, with_branch=True)

    response = authed_client.post(
        "/api/imports/purchase/confirm",
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
        data={"purchase_date": "not-a-date"},
    )
    assert response.status_code == 400


def test_confirm_inventory_with_branch(authed_client: TestClient, db_session: Session):
    _make_branch_user(db_session, with_branch=True)

    response = authed_client.post(
        "/api/imports/inventory/confirm",
        files={"file": ("inventory.csv", io.BytesIO(INVENTORY_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["stock_levels_created"] == 1
    assert db_session.query(StockLevel).count() == 1


def test_export_date_bounds_return_the_earliest_visible_record(
    authed_client: TestClient, db_session: Session
):
    _make_branch_user(db_session, with_branch=True)
    assert authed_client.post(
        "/api/imports/sales/confirm",
        files={"file": ("sale.csv", io.BytesIO(SALE_CSV.encode()), "text/csv")},
    ).status_code == 200
    assert authed_client.post(
        "/api/imports/purchase/confirm",
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
        data={"purchase_date": "2026-01-15"},
    ).status_code == 200

    assert authed_client.get("/api/sales/date-bounds").json() == {
        "earliest_date": "2026-08-21"
    }
    assert authed_client.get("/api/purchases/date-bounds").json() == {
        "earliest_date": "2026-01-15"
    }
    assert authed_client.get("/api/data-overview/date-bounds").json() == {
        "earliest_date": "2026-08-21"
    }


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


def test_confirm_sales_via_staged_upload_id_does_not_need_the_file_again(
    authed_client: TestClient, db_session: Session
):
    """The preview call stages the upload and hands back a staged_upload_id; confirm
    can then send just that id instead of re-attaching the whole file — see
    _resolve_upload/_stage_upload in app.retail.routers.imports."""
    _make_branch_user(db_session, with_branch=True)

    preview = authed_client.post(
        "/api/imports/sales",
        files={"file": ("sale.csv", io.BytesIO(SALE_CSV.encode()), "text/csv")},
    )
    assert preview.status_code == 200
    staged_upload_id = preview.json()["staged_upload_id"]
    assert staged_upload_id
    assert db_session.query(StagedImportUpload).count() == 1

    confirm = authed_client.post(
        "/api/imports/sales/confirm",
        data={"staged_upload_id": staged_upload_id},
    )
    assert confirm.status_code == 200
    assert confirm.json()["sales_created"] == 1
    assert db_session.query(Sale).count() == 1
    # Confirming consumes the staged row — it only needs to outlive the gap between
    # preview and confirm, not the imported data.
    assert db_session.query(StagedImportUpload).count() == 0


def test_confirm_with_unknown_staged_upload_id_returns_404(
    authed_client: TestClient, db_session: Session
):
    _make_branch_user(db_session, with_branch=True)

    response = authed_client.post(
        "/api/imports/sales/confirm",
        data={"staged_upload_id": "does-not-exist"},
    )
    assert response.status_code == 404
