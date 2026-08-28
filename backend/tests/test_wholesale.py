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


def _order_line_payload(**overrides) -> dict:
    # second_commit_qty deliberately omitted here (defaults to None) — it can only be set
    # by an admin account (see _check_second_commit_permission), and most of these fixtures
    # use a branch-scoped wholesale user. Tests that specifically exercise second_commit_qty
    # pass it explicitly with the right user role.
    payload = {
        "product_code": "WS-001",
        "factory_name": "Acme Factory",
        "first_commit_qty": 25,
        "colors": [{"color": "black", "qty": 10}, {"color": "pink", "qty": 20}],
        "received_qty": 0,
        "unit": "Set",
    }
    payload.update(overrides)
    return payload


def _order_payload(*, line: dict | None = None, **overrides) -> dict:
    payload = {
        "order_date": dt.date(2026, 8, 1).isoformat(),
        "customer_name": "Daw Khin",
        "line": line or _order_line_payload(),
    }
    payload.update(overrides)
    return payload


def _voucher_line_payload(**overrides) -> dict:
    payload = {
        "product_code": "WS-001",
        "buying_price": 1500,
        "colors": [{"color": "black", "qty": 10}, {"color": "pink", "qty": 20}],
        "discount_per_set": 50,
    }
    payload.update(overrides)
    return payload


def _voucher_payload(*, line: dict | None = None, **overrides) -> dict:
    payload = {
        "voucher_date": dt.date(2026, 8, 2).isoformat(),
        "factory_name": "Acme Factory",
        "line": line or _voucher_line_payload(),
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
    assert len(body["lines"]) == 1
    line = body["lines"][0]
    assert line["total_qty"] == 30
    assert line["status"] == "not_start"
    assert line["buying_price"] is None
    assert line["matched_voucher_id"] is None


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
    updated_line = updated_order["lines"][0]
    voucher_line = voucher_body["voucher"]["lines"][0]
    assert updated_line["buying_price"] == 1500
    assert updated_line["status"] == "waiting"
    assert updated_line["matched_voucher_id"] == voucher_line["id"]
    assert updated_line["matched_voucher_no"] == voucher_body["voucher"]["voucher_no"]


def test_complete_order_is_not_touched_by_a_new_voucher(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    order = authed_client.post("/api/orders", json=_order_payload()).json()
    line_id = order["lines"][0]["id"]
    authed_client.patch(f"/api/orders/{order['id']}/lines/{line_id}", json={"status": "complete"})

    authed_client.post("/api/factory-vouchers", json=_voucher_payload())

    unchanged = authed_client.get("/api/orders").json()[0]
    unchanged_line = unchanged["lines"][0]
    assert unchanged_line["status"] == "complete"
    assert unchanged_line["buying_price"] is None


def test_voucher_line_qty_is_computed_from_colors(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    response = authed_client.post(
        "/api/factory-vouchers",
        json=_voucher_payload(
            line=_voucher_line_payload(colors=[{"color": "black", "qty": 4}, {"color": "pink", "qty": 6}])
        ),
    )
    assert response.status_code == 201
    line = response.json()["voucher"]["lines"][0]
    assert line["qty"] == 10


def test_latest_voucher_overwrites_price_on_open_orders(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    authed_client.post("/api/orders", json=_order_payload())
    first_voucher = authed_client.post("/api/factory-vouchers", json=_voucher_payload()).json()["voucher"]

    second_voucher = authed_client.post(
        "/api/factory-vouchers", json=_voucher_payload(line=_voucher_line_payload(buying_price=1800))
    ).json()["voucher"]

    order = authed_client.get("/api/orders").json()[0]
    line = order["lines"][0]
    assert line["buying_price"] == 1800
    assert line["matched_voucher_id"] == second_voucher["lines"][0]["id"]
    assert line["matched_voucher_id"] != first_voucher["lines"][0]["id"]


def test_order_created_after_voucher_inherits_price_immediately(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    voucher = authed_client.post("/api/factory-vouchers", json=_voucher_payload()).json()["voucher"]
    order = authed_client.post("/api/orders", json=_order_payload()).json()
    line = order["lines"][0]

    assert line["buying_price"] == 1500
    assert line["status"] == "waiting"
    assert line["matched_voucher_id"] == voucher["lines"][0]["id"]


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
    unchanged_line = unchanged["lines"][0]
    assert unchanged_line["status"] == "not_start"
    assert unchanged_line["buying_price"] is None


def test_received_qty_cannot_exceed_total_qty(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    response = authed_client.post(
        "/api/orders", json=_order_payload(line=_order_line_payload(received_qty=999))
    )
    assert response.status_code == 400

    order = authed_client.post("/api/orders", json=_order_payload()).json()
    line_id = order["lines"][0]["id"]
    update = authed_client.patch(
        f"/api/orders/{order['id']}/lines/{line_id}", json={"received_qty": 999}
    )
    assert update.status_code == 400


def test_order_can_be_created_with_a_non_default_status(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    order = authed_client.post(
        "/api/orders", json=_order_payload(line=_order_line_payload(status="complete"))
    ).json()
    assert order["lines"][0]["status"] == "complete"

    # A voucher for the same product code must not touch an order created as already complete.
    voucher = authed_client.post("/api/factory-vouchers", json=_voucher_payload()).json()
    assert voucher["updated_order_count"] == 0

    unchanged = [o for o in authed_client.get("/api/orders").json() if o["id"] == order["id"]][0]
    assert unchanged["lines"][0]["buying_price"] is None


def test_order_can_have_multiple_product_lines(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    order = authed_client.post("/api/orders", json=_order_payload()).json()
    response = authed_client.post(
        f"/api/orders/{order['id']}/lines",
        json=_order_line_payload(product_code="WS-002", colors=[{"color": "blue", "qty": 15}]),
    )
    assert response.status_code == 201
    body = response.json()
    assert len(body["lines"]) == 2
    assert {line["product_code"] for line in body["lines"]} == {"WS-001", "WS-002"}


def test_deleting_the_last_line_deletes_the_order(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    order = authed_client.post("/api/orders", json=_order_payload()).json()
    line_id = order["lines"][0]["id"]

    response = authed_client.delete(f"/api/orders/{order['id']}/lines/{line_id}")
    assert response.status_code == 204
    assert authed_client.get("/api/orders").json() == []


def test_voucher_can_have_multiple_product_lines(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    voucher = authed_client.post("/api/factory-vouchers", json=_voucher_payload()).json()["voucher"]
    response = authed_client.post(
        f"/api/factory-vouchers/{voucher['id']}/lines",
        json=_voucher_line_payload(product_code="WS-002"),
    )
    assert response.status_code == 201
    body = response.json()["voucher"]
    assert len(body["lines"]) == 2
    assert {line["product_code"] for line in body["lines"]} == {"WS-001", "WS-002"}


def test_non_admin_cannot_set_second_commit_qty_on_create(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)  # branch-scoped -> wholesale, not admin

    response = authed_client.post(
        "/api/orders", json=_order_payload(line=_order_line_payload(second_commit_qty=30))
    )
    assert response.status_code == 403


def test_non_admin_cannot_set_second_commit_qty_on_new_line(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    order = authed_client.post("/api/orders", json=_order_payload()).json()
    response = authed_client.post(
        f"/api/orders/{order['id']}/lines",
        json=_order_line_payload(product_code="WS-002", second_commit_qty=30),
    )
    assert response.status_code == 403


def test_non_admin_cannot_update_second_commit_qty(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=branch)

    order = authed_client.post("/api/orders", json=_order_payload()).json()
    line_id = order["lines"][0]["id"]
    response = authed_client.patch(
        f"/api/orders/{order['id']}/lines/{line_id}", json={"second_commit_qty": 30}
    )
    assert response.status_code == 403


def test_admin_can_set_second_commit_qty(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, branch=None)  # admin: no fixed branch

    order = authed_client.post(
        "/api/orders",
        json=_order_payload(branch_id=branch.id, line=_order_line_payload(second_commit_qty=30)),
    ).json()
    assert order["lines"][0]["second_commit_qty"] == 30

    line_id = order["lines"][0]["id"]
    update = authed_client.patch(
        f"/api/orders/{order['id']}/lines/{line_id}", json={"second_commit_qty": 45}
    )
    assert update.status_code == 200
    assert update.json()["lines"][0]["second_commit_qty"] == 45
