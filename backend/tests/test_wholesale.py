import datetime as dt

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def _make_user(db_session: Session, *, branch: Branch | None) -> None:
    db_session.add(
        User(
            id="test-user-id",
            name="Test User",
            email="test@example.com",
            role=UserRole.WHOLESALE if branch else UserRole.ADMIN,
            branch_id=branch.id if branch else None,
        )
    )
    db_session.commit()


def _make_branch(db_session: Session, name: str = "Wholesale") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.commit()
    return branch


def _order_payload(**overrides) -> dict:
    payload = {
        "order_date": dt.date(2026, 8, 1).isoformat(),
        "product_code": "WS-001",
        "factory_name": "Acme Factory",
        "customer_name": "Daw Khin",
        "first_commit_qty": 25,
        "second_commit_qty": 30,
        "colors": [{"color": "black", "qty": 10}, {"color": "pink", "qty": 20}],
        "received_qty": 0,
        "unit": "Set",
    }
    payload.update(overrides)
    return payload


def _voucher_payload(**overrides) -> dict:
    payload = {
        "voucher_date": dt.date(2026, 8, 2).isoformat(),
        "factory_name": "Acme Factory",
        "product_code": "WS-001",
        "qty": 30,
        "buying_price": 1500,
        "colors": [{"color": "black", "qty": 10}, {"color": "pink", "qty": 20}],
        "discount_per_set": 50,
    }
    payload.update(overrides)
    return payload


def test_create_order_computes_total_qty_and_defaults_not_start(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    response = authed_client.post("/api/orders", json=_order_payload())
    assert response.status_code == 201
    body = response.json()
    assert body["total_qty"] == 30
    assert body["status"] == "not_start"
    assert body["buying_price"] is None
    assert body["matched_voucher_id"] is None


def test_voucher_prices_matching_orders_and_flips_to_waiting(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    order = authed_client.post("/api/orders", json=_order_payload()).json()

    voucher_response = authed_client.post("/api/factory-vouchers", json=_voucher_payload())
    assert voucher_response.status_code == 201
    voucher_body = voucher_response.json()
    assert voucher_body["updated_order_count"] == 1

    updated_order = authed_client.get("/api/orders").json()[0]
    assert updated_order["id"] == order["id"]
    assert updated_order["buying_price"] == 1500
    assert updated_order["status"] == "waiting"
    assert updated_order["matched_voucher_id"] == voucher_body["voucher"]["id"]
    assert updated_order["matched_voucher_no"] == voucher_body["voucher"]["voucher_no"]


def test_complete_order_is_not_touched_by_a_new_voucher(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    order = authed_client.post("/api/orders", json=_order_payload()).json()
    authed_client.patch(f"/api/orders/{order['id']}", json={"status": "complete"})

    authed_client.post("/api/factory-vouchers", json=_voucher_payload())

    unchanged = authed_client.get("/api/orders").json()[0]
    assert unchanged["status"] == "complete"
    assert unchanged["buying_price"] is None


def test_latest_voucher_overwrites_price_on_open_orders(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    authed_client.post("/api/orders", json=_order_payload())
    first_voucher = authed_client.post("/api/factory-vouchers", json=_voucher_payload()).json()["voucher"]

    second_voucher = authed_client.post(
        "/api/factory-vouchers", json=_voucher_payload(buying_price=1800)
    ).json()["voucher"]

    order = authed_client.get("/api/orders").json()[0]
    assert order["buying_price"] == 1800
    assert order["matched_voucher_id"] == second_voucher["id"]
    assert order["matched_voucher_id"] != first_voucher["id"]


def test_order_created_after_voucher_inherits_price_immediately(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    voucher = authed_client.post("/api/factory-vouchers", json=_voucher_payload()).json()["voucher"]
    order = authed_client.post("/api/orders", json=_order_payload()).json()

    assert order["buying_price"] == 1500
    assert order["status"] == "waiting"
    assert order["matched_voucher_id"] == voucher["id"]


def test_voucher_only_matches_orders_in_the_same_branch(authed_client: TestClient, db_session: Session):
    branch_a = _make_branch(db_session, "Wholesale A")
    branch_b = _make_branch(db_session, "Wholesale B")
    _make_user(db_session, branch=None)  # admin: no fixed branch, must pass branch_id explicitly

    order = authed_client.post(
        "/api/orders", json=_order_payload(branch_id=branch_a.id)
    ).json()
    voucher = authed_client.post(
        "/api/factory-vouchers", json=_voucher_payload(branch_id=branch_b.id)
    ).json()
    assert voucher["updated_order_count"] == 0

    unchanged = [o for o in authed_client.get("/api/orders").json() if o["id"] == order["id"]][0]
    assert unchanged["status"] == "not_start"
    assert unchanged["buying_price"] is None


def test_received_qty_cannot_exceed_total_qty(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    response = authed_client.post("/api/orders", json=_order_payload(received_qty=999))
    assert response.status_code == 400

    order = authed_client.post("/api/orders", json=_order_payload()).json()
    update = authed_client.patch(f"/api/orders/{order['id']}", json={"received_qty": 999})
    assert update.status_code == 400
