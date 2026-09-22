from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.product import Product
from app.retail.models.sale import Sale
from app.retail.models.stock_level import StockLevel


def _make_branch(db_session: Session, name: str = "Retail 1") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    return branch


def _make_user(db_session: Session, branch: Branch, role: UserRole) -> User:
    user = User(
        id="test-user-id",
        name="Test User",
        email="test@example.com",
        role=role,
        branch_id=branch.id if role != UserRole.ADMIN else None,
    )
    db_session.add(user)
    db_session.commit()
    return user


def _seed_sale(db_session: Session, branch: Branch, sale_date: date) -> None:
    db_session.add(
        Sale(
            branch_id=branch.id,
            slip_id=f"{sale_date.isoformat()}-1",
            slip_number="1",
            sale_date=sale_date,
        )
    )


def test_missing_day_between_two_confirmed_days_is_flagged(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, branch, UserRole.RETAIL_MANAGEMENT)
    today = date.today()
    day_old, day_gap, day_recent = today - timedelta(days=5), today - timedelta(days=3), today - timedelta(days=1)
    _seed_sale(db_session, branch, day_old)
    _seed_sale(db_session, branch, day_recent)
    db_session.commit()

    response = authed_client.get("/api/imports/completeness")
    assert response.status_code == 200
    body = response.json()
    row = next(r for r in body["branches"] if r["branch_id"] == branch.id)
    sales_dates = {d["date"]: d for d in row["sales"]["days"]}
    assert day_gap.isoformat() in sales_dates
    assert sales_dates[day_gap.isoformat()]["status"] == "open"
    # day_old and day_recent have data, so they must not appear as gaps.
    assert day_old.isoformat() not in sales_dates
    assert day_recent.isoformat() not in sales_dates


def test_closing_a_missing_day_hides_it_and_reopen_undoes_it(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, branch, UserRole.RETAIL_MANAGEMENT)
    today = date.today()
    day_old, day_gap, day_recent = today - timedelta(days=5), today - timedelta(days=3), today - timedelta(days=1)
    _seed_sale(db_session, branch, day_old)
    _seed_sale(db_session, branch, day_recent)
    db_session.commit()

    close = authed_client.post(
        "/api/imports/completeness/close",
        json={
            "branch_id": branch.id,
            "import_type": "sales",
            "closure_date": day_gap.isoformat(),
            "note": "Branch closed for a public holiday",
        },
    )
    assert close.status_code == 200

    body = authed_client.get("/api/imports/completeness").json()
    row = next(r for r in body["branches"] if r["branch_id"] == branch.id)
    entry = next(d for d in row["sales"]["days"] if d["date"] == day_gap.isoformat())
    assert entry["status"] == "closed"
    assert entry["note"] == "Branch closed for a public holiday"
    assert entry["closed_by_name"] == "Test User"
    # day-4 and day-2 are still-open gaps; only day_gap (day-3) was closed.
    assert row["sales"]["open_count"] == 2

    reopen = authed_client.post(
        "/api/imports/completeness/reopen",
        json={"branch_id": branch.id, "import_type": "sales", "closure_date": day_gap.isoformat()},
    )
    assert reopen.status_code == 200

    body = authed_client.get("/api/imports/completeness").json()
    row = next(r for r in body["branches"] if r["branch_id"] == branch.id)
    entry = next(d for d in row["sales"]["days"] if d["date"] == day_gap.isoformat())
    assert entry["status"] == "open"


def test_plain_retail_role_cannot_close_a_day(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch, UserRole.RETAIL)
    today = date.today()
    _seed_sale(db_session, branch, today - timedelta(days=5))
    db_session.commit()

    response = authed_client.post(
        "/api/imports/completeness/close",
        json={
            "branch_id": branch.id,
            "import_type": "sales",
            "closure_date": (today - timedelta(days=3)).isoformat(),
        },
    )
    assert response.status_code == 403


def test_inventory_gap_detected_independently_of_sales(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, branch, UserRole.RETAIL_MANAGEMENT)
    product = Product(stock_code="SC1", description="Sample")
    db_session.add(product)
    db_session.flush()

    today = date.today()
    day_old, day_gap, day_recent = today - timedelta(days=5), today - timedelta(days=3), today - timedelta(days=1)
    for d in (day_old, day_recent):
        db_session.add(
            StockLevel(
                branch_id=branch.id,
                product_id=product.id,
                on_hand_qty=1,
                snapshot_at=datetime.combine(d, datetime.min.time()),
            )
        )
    db_session.commit()

    body = authed_client.get("/api/imports/completeness").json()
    row = next(r for r in body["branches"] if r["branch_id"] == branch.id)
    inventory_dates = {d["date"] for d in row["inventory"]["days"]}
    assert day_gap.isoformat() in inventory_dates
    assert day_old.isoformat() not in inventory_dates
