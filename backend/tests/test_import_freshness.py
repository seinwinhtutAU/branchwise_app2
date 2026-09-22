import datetime as dt

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.import_batch import ImportBatch, ImportBatchStatus, ImportType
from app.retail.models.purchase import Purchase
from app.retail.models.sale import Sale
from app.retail.models.stock_level import StockLevel
from app.models.user import User, UserRole


def _make_user(db_session: Session, *, branch: Branch | None) -> None:
    db_session.add(
        User(
            id="test-user-id",
            name="Test User",
            email="test@example.com",
            role=UserRole.RETAIL if branch else UserRole.DEVELOPMENT,
            branch_id=branch.id if branch else None,
        )
    )
    db_session.commit()


def _make_batch(
    db_session: Session,
    *,
    branch: Branch,
    import_type: ImportType,
    created_at: dt.datetime,
    status: ImportBatchStatus = ImportBatchStatus.COMPLETED,
) -> None:
    db_session.add(
        ImportBatch(
            import_type=import_type,
            branch_id=branch.id,
            status=status,
            created_at=created_at,
        )
    )
    db_session.commit()


def test_reports_latest_completed_import_per_type(
    authed_client: TestClient, db_session: Session
):
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    _make_user(db_session, branch=branch)

    _make_batch(
        db_session,
        branch=branch,
        import_type=ImportType.SALES,
        created_at=dt.datetime(2026, 8, 20),
    )
    _make_batch(
        db_session,
        branch=branch,
        import_type=ImportType.SALES,
        created_at=dt.datetime(2026, 8, 22),
    )
    _make_batch(
        db_session,
        branch=branch,
        import_type=ImportType.INVENTORY,
        created_at=dt.datetime(2026, 8, 15),
    )

    response = authed_client.get("/api/imports/freshness")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["branch_name"] == "Retail 1"
    assert rows[0]["sales_last_imported_at"] == "2026-08-22T00:00:00Z"
    assert rows[0]["inventory_last_imported_at"] == "2026-08-15T00:00:00Z"
    assert rows[0]["purchase_last_imported_at"] is None


def test_reverted_imports_are_not_counted(
    authed_client: TestClient, db_session: Session
):
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    _make_user(db_session, branch=branch)

    _make_batch(
        db_session,
        branch=branch,
        import_type=ImportType.PURCHASE,
        created_at=dt.datetime(2026, 8, 22),
        status=ImportBatchStatus.REVERTED,
    )

    response = authed_client.get("/api/imports/freshness")
    rows = response.json()
    assert rows[0]["purchase_last_imported_at"] is None


def test_wholesale_branch_excluded(authed_client: TestClient, db_session: Session):
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    wholesale = Branch(name="Wholesale", phone_number="000", address="TBD")
    db_session.add_all([branch, wholesale])
    db_session.flush()
    _make_user(db_session, branch=None)  # admin — the authed test user
    db_session.add(
        User(
            id="wholesale-user-id",
            name="Wholesale User",
            email="wholesale@example.com",
            role=UserRole.WHOLESALE,
            branch_id=wholesale.id,
        )
    )
    db_session.commit()

    _make_batch(
        db_session,
        branch=branch,
        import_type=ImportType.SALES,
        created_at=dt.datetime(2026, 8, 22),
    )

    response = authed_client.get("/api/imports/freshness")
    rows = response.json()
    assert {r["branch_name"] for r in rows} == {"Retail 1"}


def test_development_sees_every_branch_retail_sees_only_own(
    authed_client: TestClient, db_session: Session
):
    branch_a = Branch(name="Retail 1", phone_number="000", address="TBD")
    branch_b = Branch(name="Retail 2", phone_number="000", address="TBD")
    db_session.add_all([branch_a, branch_b])
    db_session.flush()
    _make_user(db_session, branch=None)  # admin

    _make_batch(
        db_session,
        branch=branch_a,
        import_type=ImportType.SALES,
        created_at=dt.datetime(2026, 8, 22),
    )
    _make_batch(
        db_session,
        branch=branch_b,
        import_type=ImportType.SALES,
        created_at=dt.datetime(2026, 8, 21),
    )

    response = authed_client.get("/api/imports/freshness")
    rows = response.json()
    assert {r["branch_name"] for r in rows} == {"Retail 1", "Retail 2"}


def test_reports_data_dates_and_purchase_number_gaps(
    authed_client: TestClient, db_session: Session
):
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    _make_user(db_session, branch=branch)
    db_session.add_all(
        [
            Sale(
                id="sale-data-date",
                branch_id=branch.id,
                slip_id="2026-08-20-1",
                slip_number="1",
                sale_date=dt.date(2026, 8, 20),
            ),
            StockLevel(
                id="inventory-data-date",
                branch_id=branch.id,
                product_id="unused-product-id",
                snapshot_at=dt.datetime(2026, 8, 21, 9, 30),
            ),
            Purchase(
                id="purchase-49",
                branch_id=branch.id,
                purchase_number="STR00049",
                purchase_date=dt.date(2026, 8, 20),
            ),
            Purchase(
                id="purchase-111",
                branch_id=branch.id,
                purchase_number="STR00111",
                purchase_date=dt.date(2026, 8, 21),
            ),
        ]
    )
    db_session.commit()

    response = authed_client.get("/api/imports/freshness")
    assert response.status_code == 200
    row = response.json()[0]
    assert row["sales_data_date"] == "2026-08-20"
    assert row["inventory_data_date"] == "2026-08-21"
    assert row["purchase_number_integrity"] == {
        "numbered_purchase_count": 2,
        "gap_count": 1,
        "missing_number_count": 61,
        "gaps": [
            {
                "prefix": "STR",
                "start": 50,
                "end": 110,
                "start_number": "STR00050",
                "end_number": "STR00110",
                "missing_count": 61,
            }
        ],
    }
