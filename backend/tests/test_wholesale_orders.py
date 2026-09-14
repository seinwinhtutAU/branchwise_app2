from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def _branch(db: Session, name: str = "Wholesale") -> Branch:
    branch = Branch(name=name, phone_number="0", address="Here")
    db.add(branch)
    db.commit()
    return branch


def _user(db: Session, role: UserRole, branch_id: str | None) -> None:
    db.add(User(id="test-user-id", name="Tester", email="tester@example.com", role=role, branch_id=branch_id))
    db.commit()


def _payload() -> dict:
    return {
        "customer_name": "Daw May",
        "customer_phone": "09-123",
        "customer_address": "Yangon",
        "order_date": "2026-09-13",
        "lines": [
            {
                "stock_code": "A1001",
                "description": "Sandal",
                "product_group": "man",
                "supplier_name": "Goody Factory",
                "color_breakdown": "black2s",
                "unit": "set",
                "selling_price": 18000,
            }
        ],
    }


def test_customer_order_persists_updates_and_caps_payments(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    created = authed_client.post("/api/wholesale/orders", json=_payload())
    assert created.status_code == 201
    order = created.json()
    assert order["order_no"].startswith("ORD-")
    assert order["total_quantity_pairs"] == 12
    assert order["total_amount"] == 216000
    assert order["order_status"] == "new"

    changed = _payload() | {"customer_address": "Mandalay"}
    updated = authed_client.put(f"/api/wholesale/orders/{order['order_id']}", json=changed)
    assert updated.status_code == 200
    assert updated.json()["customer_address"] == "Mandalay"

    payment = authed_client.post(
        f"/api/wholesale/orders/{order['order_id']}/payments",
        json={"paid_on": "2026-09-13", "amount": 100000, "note": "Deposit"},
    )
    assert payment.status_code == 201
    too_much = authed_client.post(
        f"/api/wholesale/orders/{order['order_id']}/payments",
        json={"paid_on": "2026-09-13", "amount": 116001, "note": "Too much"},
    )
    assert too_much.status_code == 422

    reread = authed_client.get("/api/wholesale/orders")
    assert reread.status_code == 200
    assert reread.json()[0]["payment"]["payments"][0]["amount"] == 100000
    assert reread.json()[0]["paid_amount"] == 100000


def test_customer_order_rejects_empty_colours_and_other_branch(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    invalid = _payload()
    invalid["lines"][0]["color_breakdown"] = ""
    assert authed_client.post("/api/wholesale/orders", json=invalid).status_code == 422

    created = authed_client.post("/api/wholesale/orders", json=_payload()).json()
    db_session.query(User).filter(User.id == "test-user-id").update({"branch_id": _branch(db_session, "Other").id})
    db_session.commit()
    assert authed_client.get(f"/api/wholesale/orders/{created['order_id']}").status_code == 404


def test_retail_account_cannot_read_customer_orders(authed_client: TestClient, db_session: Session) -> None:
    _user(db_session, UserRole.RETAIL, _branch(db_session).id)
    assert authed_client.get("/api/wholesale/orders").status_code == 403


def test_customer_order_list_filters_and_pages_on_the_server(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    first = authed_client.post("/api/wholesale/orders", json=_payload())
    second_payload = _payload() | {"customer_name": "Ko Zaw", "order_date": "2026-09-14"}
    assert first.status_code == 201
    assert authed_client.post("/api/wholesale/orders", json=second_payload).status_code == 201

    filtered = authed_client.get("/api/wholesale/orders", params={"search": "zaw", "page_size": 1})
    assert filtered.status_code == 200
    assert filtered.headers["X-Total-Count"] == "1"
    assert filtered.json()[0]["customer_name"] == "Ko Zaw"

    paged = authed_client.get("/api/wholesale/orders", params={"page": 2, "page_size": 1})
    assert paged.status_code == 200
    assert paged.headers["X-Total-Count"] == "2"
    assert len(paged.json()) == 1


def test_customer_order_stays_new_until_stock_is_allocated(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    order = authed_client.post("/api/wholesale/orders", json=_payload()).json()
    assert order["order_status"] == "new"

    voucher_payload = {
        "supplier_name": "Goody Factory", "voucher_date": "2026-09-13", "carrier_name": "Cargo", "total_packages": 1,
        "lines": [{"stock_code": "A1001", "description": "Sandal", "product_group": "man", "color_breakdown": "black5s", "unit": "set", "buying_price": 18000}],
    }
    voucher = authed_client.post("/api/wholesale/supplier-vouchers", json=voucher_payload)
    assert voucher.status_code == 201

    reread = authed_client.get(f"/api/wholesale/orders/{order['order_id']}")
    assert reread.status_code == 200


def test_admin_can_list_and_create_orders_without_naming_a_branch(
    authed_client: TestClient, db_session: Session
) -> None:
    """An admin account has no fixed branch_id. With exactly one wholesale branch (the
    normal case), admin must be able to list and create orders without being forced to
    pass branch_id — that used to 400 because the list/create endpoints called
    resolve_branch_id, which demands an explicit answer from any account with no fixed
    branch, retail-style. See app.services.branches.resolve_wholesale_branch_id and
    wholesale_orders.py's _visible_branch_id."""
    branch = _branch(db_session)
    # A wholesale-role user assigned to this branch is what makes it "a wholesale
    # branch" at all (see list_wholesale_branches) — a different id from the admin
    # account below, which is who this test actually signs in as.
    db_session.add(User(id="wholesale-user-id", name="Tester", email="tester@example.com", role=UserRole.WHOLESALE, branch_id=branch.id))
    db_session.add(User(id="test-user-id", name="Admin", email="admin@example.com", role=UserRole.ADMIN, branch_id=None))
    db_session.commit()

    listed = authed_client.get("/api/wholesale/orders")
    assert listed.status_code == 200

    created = authed_client.post("/api/wholesale/orders", json=_payload())
    assert created.status_code == 201
    assert created.json()["branch_id"] == branch.id

    next_no = authed_client.get("/api/wholesale/orders/next-no")
    assert next_no.status_code == 200

    allocations = authed_client.get("/api/wholesale/orders/allocations")
    assert allocations.status_code == 200
