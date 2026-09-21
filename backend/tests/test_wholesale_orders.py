from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm.exc import StaleDataError
from sqlalchemy.orm import Session, sessionmaker

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.wholesale.models.entities import CustomerOrder, WholesaleAuditLog
from app.wholesale.models.master_data import WholesaleProduct


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
    assert order["total_amount"] == 36000
    assert order["order_status"] == "waiting_for_stock"

    changed = _payload() | {"customer_address": "Mandalay"}
    updated = authed_client.put(f"/api/wholesale/orders/{order['order_id']}", json=changed)
    assert updated.status_code == 200
    assert updated.json()["customer_address"] == "Mandalay"

    payment = authed_client.post(
        f"/api/wholesale/orders/{order['order_id']}/payments",
        json={"paid_on": "2026-09-13", "amount": 20000, "note": "Deposit"},
    )
    assert payment.status_code == 201
    too_much = authed_client.post(
        f"/api/wholesale/orders/{order['order_id']}/payments",
        json={"paid_on": "2026-09-13", "amount": 16001, "note": "Too much"},
    )
    assert too_much.status_code == 422

    reread = authed_client.get("/api/wholesale/orders")
    assert reread.status_code == 200
    assert reread.json()[0]["payment"]["payments"][0]["amount"] == 20000
    assert reread.json()[0]["paid_amount"] == 20000


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


def test_customer_order_keeps_its_own_conversion_snapshot(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    payload = _payload()
    payload["lines"][0]["unit_conversions"] = {"pair": 1, "set": 5, "dozen": 10}

    created = authed_client.post("/api/wholesale/orders", json=payload)

    assert created.status_code == 201
    line = created.json()["lines"][0]
    assert line["quantity_pairs"] == 10
    assert line["unit_conversions"] == {"pair": 1, "set": 5, "dozen": 10}
    assert created.json()["total_amount"] == 36_000


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


def test_customer_order_waits_for_stock_until_some_is_set_aside(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    order = authed_client.post("/api/wholesale/orders", json=_payload()).json()
    assert order["order_status"] == "waiting_for_stock"

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
    """An admin account has no fixed branch_id. With exactly one wholesale branch,
    admin must be able to list and create orders without being forced to
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


def test_order_line_in_mmk_stores_no_original_amount_or_rate(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    created = authed_client.post("/api/wholesale/orders", json=_payload())
    assert created.status_code == 201
    line = created.json()["lines"][0]
    assert line["currency_code"] == "MMK"
    assert line["selling_price"] == 18000
    assert line["original_selling_price"] is None
    assert line["exchange_rate"] is None


def test_order_line_in_foreign_currency_stores_decimal_snapshot_and_computed_kyat(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    payload = _payload()
    payload["lines"][0] |= {
        "currency_code": "thb",
        "selling_price": None,
        "original_selling_price": 500,
        "exchange_rate": "120.123456789012",
    }
    created = authed_client.post("/api/wholesale/orders", json=payload)
    assert created.status_code == 201
    line = created.json()["lines"][0]
    assert line["currency_code"] == "THB"
    assert line["original_selling_price"] == 500
    assert line["exchange_rate"] == 120.123456789012
    # 500 x 120.123456789012 = 60061.728394506 -> rounds to the nearest Kyat cent.
    assert line["selling_price"] == 60061.73
    # "black2s" is 2 sets (12 pairs); selling_price is per set.
    assert created.json()["total_amount"] == 60061.73 * 2


def test_order_line_foreign_currency_requires_original_amount_and_rate(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    payload = _payload()
    payload["lines"][0] |= {"currency_code": "THB"}
    response = authed_client.post("/api/wholesale/orders", json=payload)
    assert response.status_code == 422


def test_order_line_rejects_unsupported_currency(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    payload = _payload()
    payload["lines"][0] |= {
        "currency_code": "EUR",
        "original_selling_price": 500,
        "exchange_rate": 120,
    }
    response = authed_client.post("/api/wholesale/orders", json=payload)
    assert response.status_code == 422


def test_editing_order_does_not_reprice_its_foreign_currency_line_from_a_new_rate(
    authed_client: TestClient, db_session: Session
) -> None:
    """A saved foreign-currency line keeps its own snapshot rate; editing the order with
    the same original amount but a different rate re-saves the line with the new rate —
    it never gets silently rewritten by "today's" rate on its own."""
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    payload = _payload()
    payload["lines"][0] |= {
        "currency_code": "THB",
        "selling_price": None,
        "original_selling_price": 500,
        "exchange_rate": 120,
    }
    created = authed_client.post("/api/wholesale/orders", json=payload)
    assert created.json()["lines"][0]["selling_price"] == 60000

    # Editing the order without touching the line leaves its saved rate untouched.
    updated = authed_client.put(f"/api/wholesale/orders/{created.json()['order_id']}", json=payload)
    assert updated.json()["lines"][0]["selling_price"] == 60000
    assert updated.json()["lines"][0]["exchange_rate"] == 120


def test_new_stock_code_on_an_order_line_creates_a_master_data_product(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    assert db_session.query(WholesaleProduct).count() == 0

    created = authed_client.post("/api/wholesale/orders", json=_payload())
    assert created.status_code == 201

    product = db_session.query(WholesaleProduct).filter(WholesaleProduct.stock_code == "A1001").first()
    assert product is not None
    assert product.description == "Sandal"
    assert product.product_group.value == "man"


def test_order_line_reuses_an_existing_master_data_product_without_overwriting_it(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    db_session.add(
        WholesaleProduct(stock_code="A1001", description="Original name", product_group="lady")
    )
    db_session.commit()

    created = authed_client.post("/api/wholesale/orders", json=_payload())
    assert created.status_code == 201

    assert db_session.query(WholesaleProduct).filter(WholesaleProduct.stock_code == "A1001").count() == 1
    product = db_session.query(WholesaleProduct).filter(WholesaleProduct.stock_code == "A1001").first()
    # The order line said "Sandal"/"man", but the existing Master Data row is untouched.
    assert product.description == "Original name"
    assert product.product_group.value == "lady"


def test_cannot_delete_order_with_payments(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    created = authed_client.post("/api/wholesale/orders", json=_payload())
    order_id = created.json()["order_id"]

    authed_client.post(
        f"/api/wholesale/orders/{order_id}/payments",
        json={"paid_on": "2026-09-13", "amount": 5000, "note": "Deposit"},
    )

    # Deleting order with payments should fail with 409
    del_resp = authed_client.delete(f"/api/wholesale/orders/{order_id}")
    assert del_resp.status_code == 409
    assert "recorded payments" in del_resp.json()["detail"]


def test_cannot_edit_cancelled_order(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    created = authed_client.post("/api/wholesale/orders", json=_payload())
    order_id = created.json()["order_id"]

    # Cancel order
    cancel_resp = authed_client.post(f"/api/wholesale/orders/{order_id}/cancel")
    assert cancel_resp.status_code == 200
    assert cancel_resp.json()["order_status"] == "cancelled"
    assert "edit" not in cancel_resp.json()["allowed_actions"]

    # Editing cancelled order should fail with 409
    edit_resp = authed_client.put(f"/api/wholesale/orders/{order_id}", json=_payload())
    assert edit_resp.status_code == 409
    assert "cancelled" in edit_resp.json()["detail"]


def test_cannot_allocate_cancelled_order(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    created = authed_client.post("/api/wholesale/orders", json=_payload())
    order = created.json()
    order_id = order["order_id"]
    line_id = order["lines"][0]["order_line_id"]

    # Cancel order
    authed_client.post(f"/api/wholesale/orders/{order_id}/cancel")

    # Allocate should fail with 409
    alloc_resp = authed_client.put(
        f"/api/wholesale/orders/lines/{line_id}/allocation",
        json={"color_breakdown": "black1s"},
    )
    assert alloc_resp.status_code == 409


def test_order_version_and_audit_logging(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    created = authed_client.post("/api/wholesale/orders", json=_payload())
    assert created.status_code == 201
    order = created.json()
    order_id = order["order_id"]
    assert order["version_id"] == 1
    assert "allowed_actions" in order

    # Update order
    updated = authed_client.put(
        f"/api/wholesale/orders/{order_id}",
        json=_payload() | {"customer_name": "Daw May Updated"},
    )
    assert updated.status_code == 200
    assert updated.json()["customer_name"] == "Daw May Updated"

    # Verify audit logs
    audits = db_session.query(WholesaleAuditLog).filter_by(entity_id=order_id).all()
    actions = [a.action for a in audits]
    assert "create" in actions
    assert "edit" in actions


def test_deleting_a_payment_removes_it_from_the_order(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    order = authed_client.post("/api/wholesale/orders", json=_payload()).json()

    payment = authed_client.post(
        f"/api/wholesale/orders/{order['order_id']}/payments",
        json={"paid_on": "2026-09-13", "amount": 5000, "note": "Deposit"},
    )
    assert payment.status_code == 201
    payment_id = payment.json()["payment_id"]

    deleted = authed_client.delete(f"/api/wholesale/orders/{order['order_id']}/payments/{payment_id}")
    assert deleted.status_code == 204

    reread = authed_client.get(f"/api/wholesale/orders/{order['order_id']}")
    assert reread.json()["payment"]["payments"] == []
    assert reread.json()["paid_amount"] == 0


def test_deleting_an_unknown_payment_is_a_404(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    order = authed_client.post("/api/wholesale/orders", json=_payload()).json()

    missing = authed_client.delete(f"/api/wholesale/orders/{order['order_id']}/payments/not-a-real-id")
    assert missing.status_code == 404


def test_payment_exactly_matching_the_balance_is_accepted(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    order = authed_client.post("/api/wholesale/orders", json=_payload()).json()
    assert order["total_amount"] == 36000

    exact = authed_client.post(
        f"/api/wholesale/orders/{order['order_id']}/payments",
        json={"paid_on": "2026-09-13", "amount": 36000, "note": "Paid in full"},
    )
    assert exact.status_code == 201

    reread = authed_client.get(f"/api/wholesale/orders/{order['order_id']}")
    assert reread.json()["balance_due"] == 0


def test_order_line_with_zero_selling_price_is_a_valid_free_line(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    payload = _payload()
    payload["lines"][0]["selling_price"] = 0

    created = authed_client.post("/api/wholesale/orders", json=payload)
    assert created.status_code == 201
    assert created.json()["lines"][0]["selling_price"] == 0
    assert created.json()["total_amount"] == 0


def test_two_lines_on_the_same_order_cannot_share_a_stock_code(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    payload = _payload()
    payload["lines"].append(payload["lines"][0] | {"color_breakdown": "white1s"})

    created = authed_client.post("/api/wholesale/orders", json=payload)
    assert created.status_code == 422
    assert "one line per order" in created.json()["detail"]


def test_other_branch_write_actions_all_404(authed_client: TestClient, db_session: Session) -> None:
    """Mirrors the existing read-side isolation test (other branch -> 404 on GET) for
    every write action, so a branch-scoped account can't act on an order it can't see."""
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    order = authed_client.post("/api/wholesale/orders", json=_payload()).json()
    line_id = order["lines"][0]["order_line_id"]

    db_session.query(User).filter(User.id == "test-user-id").update(
        {"branch_id": _branch(db_session, "Other").id}
    )
    db_session.commit()

    assert authed_client.put(f"/api/wholesale/orders/{order['order_id']}", json=_payload()).status_code == 404
    assert authed_client.post(f"/api/wholesale/orders/{order['order_id']}/cancel").status_code == 404
    assert authed_client.delete(f"/api/wholesale/orders/{order['order_id']}").status_code == 404
    assert (
        authed_client.post(
            f"/api/wholesale/orders/{order['order_id']}/payments",
            json={"paid_on": "2026-09-13", "amount": 100, "note": "x"},
        ).status_code
        == 404
    )
    # Allocation is looked up by order-line id, not order id, but the branch check on the
    # line's parent order must reject it the same way.
    assert (
        authed_client.put(
            f"/api/wholesale/orders/lines/{line_id}/allocation",
            json={"color_breakdown": "black1s"},
        ).status_code
        == 404
    )


def test_retail_account_cannot_write_customer_orders(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    order = authed_client.post("/api/wholesale/orders", json=_payload()).json()

    db_session.query(User).filter(User.id == "test-user-id").update(
        {"role": UserRole.RETAIL, "branch_id": branch.id}
    )
    db_session.commit()

    assert authed_client.post("/api/wholesale/orders", json=_payload()).status_code == 403
    assert authed_client.put(f"/api/wholesale/orders/{order['order_id']}", json=_payload()).status_code == 403
    assert authed_client.post(f"/api/wholesale/orders/{order['order_id']}/cancel").status_code == 403
    assert authed_client.delete(f"/api/wholesale/orders/{order['order_id']}").status_code == 403
    assert (
        authed_client.post(
            f"/api/wholesale/orders/{order['order_id']}/payments",
            json={"paid_on": "2026-09-13", "amount": 100, "note": "x"},
        ).status_code
        == 403
    )


def test_editing_an_order_with_a_stale_version_raises_instead_of_silently_overwriting(
    db_session: Session,
) -> None:
    """CustomerOrder is mapped with version_id_col (see app/wholesale/models/entities.py), so two
    edits loaded from the same starting version must not both succeed - the second
    commit has to fail loudly rather than quietly discard the first save."""
    branch = _branch(db_session)
    order = CustomerOrder(
        branch_id=branch.id,
        order_no="ORD-260913-9001",
        customer_name="Daw May",
        customer_phone="09-123",
        customer_address="Yangon",
        order_date=date(2026, 9, 13),
    )
    db_session.add(order)
    db_session.commit()

    OtherSession = sessionmaker(bind=db_session.get_bind())
    other = OtherSession()
    try:
        stale = other.query(CustomerOrder).filter(CustomerOrder.id == order.id).first()

        order.customer_name = "Updated by first editor"
        db_session.commit()

        stale.customer_name = "Updated by second editor"
        with pytest.raises(StaleDataError):
            other.commit()
    finally:
        other.close()
