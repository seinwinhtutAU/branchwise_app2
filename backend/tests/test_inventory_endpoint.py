import datetime as dt

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.product import Product
from app.models.stock_level import StockLevel
from app.models.user import User, UserRole


def _make_user(db_session: Session, *, branch: Branch | None) -> None:
    db_session.add(
        User(
            id="test-user-id",
            name="Test User",
            email="test@example.com",
            role=UserRole.RETAIL if branch else UserRole.ADMIN,
            branch_id=branch.id if branch else None,
        )
    )
    db_session.commit()


def _make_product(db_session: Session, stock_code: str) -> Product:
    product = Product(id=f"product-{stock_code}", stock_code=stock_code, description=stock_code)
    db_session.add(product)
    db_session.flush()
    return product


def _make_snapshot(
    db_session: Session,
    *,
    product: Product,
    branch: Branch | None,
    on_hand_qty: float,
    snapshot_at: dt.datetime,
) -> None:
    db_session.add(
        StockLevel(
            branch_id=branch.id if branch else None,
            product_id=product.id,
            on_hand_qty=on_hand_qty,
            snapshot_at=snapshot_at,
        )
    )
    db_session.commit()


def test_a_product_missing_from_the_latest_count_is_not_current_stock(
    authed_client: TestClient, db_session: Session
):
    """An inventory export is a full stock list, so a product that stops appearing in it
    has stopped being stocked. Showing its last known figure made the Inventory page mix
    dates — a row stamped 4 Sep sitting inside the 5 Sep count — and quietly inflated
    stock value and dead stock with goods that were no longer on the list."""
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    _make_user(db_session, branch=branch)

    counted = _make_product(db_session, "STILL-STOCKED")
    dropped = _make_product(db_session, "NO-LONGER-LISTED")

    yesterday = dt.datetime(2026, 9, 4, 8, 15)
    today = dt.datetime(2026, 9, 5, 19, 20)
    _make_snapshot(db_session, product=counted, branch=branch, on_hand_qty=4, snapshot_at=yesterday)
    _make_snapshot(db_session, product=dropped, branch=branch, on_hand_qty=1, snapshot_at=yesterday)
    _make_snapshot(db_session, product=counted, branch=branch, on_hand_qty=3, snapshot_at=today)

    rows = authed_client.get("/api/inventory").json()
    by_code = {row["StockCode"]: row for row in rows}

    assert "NO-LONGER-LISTED" not in by_code
    assert float(by_code["STILL-STOCKED"]["On_Hand_Qty"]) == 3
    # Every row on the page comes from the same count, so no date can be older than it.
    assert {row["Snapshot_At"] for row in rows} == {today.isoformat()}


def test_only_latest_snapshot_per_product_returned(authed_client: TestClient, db_session: Session):
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    _make_user(db_session, branch=branch)

    product = _make_product(db_session, "A001")
    _make_snapshot(
        db_session,
        product=product,
        branch=branch,
        on_hand_qty=10,
        snapshot_at=dt.datetime(2026, 8, 1),
    )
    _make_snapshot(
        db_session,
        product=product,
        branch=branch,
        on_hand_qty=4,
        snapshot_at=dt.datetime(2026, 8, 20),
    )

    response = authed_client.get("/api/inventory")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert float(rows[0]["On_Hand_Qty"]) == 4


def test_latest_tracked_independently_per_branch(authed_client: TestClient, db_session: Session):
    branch_a = Branch(name="Retail 1", phone_number="000", address="TBD")
    branch_b = Branch(name="Retail 2", phone_number="000", address="TBD")
    db_session.add_all([branch_a, branch_b])
    db_session.flush()
    _make_user(db_session, branch=None)  # admin — sees every branch

    product = _make_product(db_session, "A001")
    _make_snapshot(
        db_session, product=product, branch=branch_a, on_hand_qty=10, snapshot_at=dt.datetime(2026, 8, 20)
    )
    _make_snapshot(
        db_session, product=product, branch=branch_b, on_hand_qty=7, snapshot_at=dt.datetime(2026, 8, 20)
    )

    response = authed_client.get("/api/inventory")
    assert response.status_code == 200
    rows = response.json()
    assert {(r["Branch"], float(r["On_Hand_Qty"])) for r in rows} == {
        ("Retail 1", 10.0),
        ("Retail 2", 7.0),
    }


def test_retail_account_only_sees_own_branch(authed_client: TestClient, db_session: Session):
    branch_a = Branch(name="Retail 1", phone_number="000", address="TBD")
    branch_b = Branch(name="Retail 2", phone_number="000", address="TBD")
    db_session.add_all([branch_a, branch_b])
    db_session.flush()
    _make_user(db_session, branch=branch_a)

    product = _make_product(db_session, "A001")
    _make_snapshot(
        db_session, product=product, branch=branch_a, on_hand_qty=10, snapshot_at=dt.datetime(2026, 8, 20)
    )
    _make_snapshot(
        db_session, product=product, branch=branch_b, on_hand_qty=7, snapshot_at=dt.datetime(2026, 8, 20)
    )

    response = authed_client.get("/api/inventory")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["Branch"] == "Retail 1"


def test_null_branch_snapshots_deduped_correctly(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch=None)

    product = _make_product(db_session, "A001")
    _make_snapshot(
        db_session, product=product, branch=None, on_hand_qty=10, snapshot_at=dt.datetime(2026, 8, 1)
    )
    _make_snapshot(
        db_session, product=product, branch=None, on_hand_qty=4, snapshot_at=dt.datetime(2026, 8, 20)
    )

    response = authed_client.get("/api/inventory")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert float(rows[0]["On_Hand_Qty"]) == 4
    assert rows[0]["Branch"] is None
