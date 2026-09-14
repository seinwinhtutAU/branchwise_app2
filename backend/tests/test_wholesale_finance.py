from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.models.wholesale import ProductGroup, WholesaleStockMovement


def _branch(db: Session) -> Branch:
    branch = Branch(name="Wholesale", phone_number="0", address="Here")
    db.add(branch)
    db.commit()
    return branch


def _user(db: Session, branch_id: str) -> None:
    db.add(User(id="test-user-id", name="Tester", email="tester@example.com", role=UserRole.WHOLESALE, branch_id=branch_id))
    db.commit()


def _order_payload() -> dict:
    return {
        "customer_name": "Daw May",
        "customer_phone": "09-123",
        "customer_address": "Yangon",
        "order_date": "2026-09-13",
        "lines": [{
            "stock_code": "A1001",
            "description": "Sandal",
            "product_group": "man",
            "supplier_name": "Goody Factory",
            "color_breakdown": "black24p",
            "unit": "pair",
            "selling_price": 18000,
        }],
    }


def test_customer_finance_reports_pairs_and_payment_status(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()

    db_session.add(WholesaleStockMovement(
        branch_id=branch.id,
        order_id=order["order_id"],
        stock_code="A1001",
        description="Sandal",
        product_group=ProductGroup.MAN,
        color_breakdown="black13p",
        colors=[{"color": "black", "qty": 13, "unit": "pair"}],
        quantity_pairs=13,
        location="Main gate",
        delivery_address="Yangon",
        delivered_on=date(2026, 9, 14),
        note="",
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()

    payment = authed_client.post(
        f"/api/wholesale/orders/{order['order_id']}/payments",
        json={"paid_on": "2026-09-14", "amount": 180000, "paid_quantity_pairs": 10, "note": "Deposit"},
    )
    assert payment.status_code == 201

    rows = authed_client.get("/api/wholesale/finance/customers")
    assert rows.status_code == 200
    row = rows.json()[0]
    assert row["total_pairs"] == 24
    assert row["delivered_pairs"] == 13
    assert row["remaining_to_deliver_pairs"] == 11
    assert row["paid_pairs"] == 10
    assert row["delivered_but_unpaid_pairs"] == 3
    assert row["payment_status"] == "partial"
    assert row["package_status"] == "partially_paid"

    assert authed_client.get(
        "/api/wholesale/finance/customers", params={"package_status": "delivered_unpaid"}
    ).json() == []
    assert len(authed_client.get(
        "/api/wholesale/finance/customers", params={"package_status": "partially_paid"}
    ).json()) == 1


def test_customer_payment_rejects_paid_pairs_above_delivered(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    db_session.add(WholesaleStockMovement(
        branch_id=branch.id,
        order_id=order["order_id"],
        stock_code="A1001",
        description="Sandal",
        product_group=ProductGroup.MAN,
        color_breakdown="black13p",
        colors=[],
        quantity_pairs=13,
        location="Main gate",
        delivery_address="Yangon",
        delivered_on=date(2026, 9, 14),
        note="",
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()

    response = authed_client.post(
        f"/api/wholesale/orders/{order['order_id']}/payments",
        json={"paid_on": "2026-09-14", "amount": 180000, "paid_quantity_pairs": 14},
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "Paid pairs cannot exceed delivered pairs."
