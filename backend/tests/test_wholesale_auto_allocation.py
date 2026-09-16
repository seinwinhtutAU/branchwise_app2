"""Stock is shared out to waiting customers the moment a package is opened.

The decision has already been made once: a supplier voucher is raised from the open
customer-order lines it is meant to cover. Re-entering it by hand on the Fulfill screen
was doing the same work twice, so opening a package does it instead.
"""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import UserRole
from tests.test_wholesale_receivings import _make_branch, _make_user, _create_receiving


def _order(client: TestClient, colors: str, order_date: str, customer: str) -> dict:
    created = client.post("/api/wholesale/orders", json={
        "customer_name": customer, "customer_phone": "09", "customer_address": "Yangon",
        "order_date": order_date,
        "lines": [{
            "stock_code": "A1001", "description": "Sandal", "product_group": "man",
            "supplier_name": "Factory", "color_breakdown": colors, "unit": "set",
            "selling_price": 18000,
        }],
    })
    assert created.status_code == 201, created.text
    return created.json()


def _open_package(client: TestClient, receiving: dict, colors: str, qty: int) -> None:
    package_id = receiving["packages"][0]["package_id"]
    response = client.patch(
        f"/api/wholesale/receivings/{receiving['receiving_id']}/packages/{package_id}",
        json={
            "opened": True,
            "received_on": "2026-09-12",
            "note": "",
            "items": [{
                "stock_code": "A1001", "description": "Sandal", "product_group": "man",
                "color_breakdown": colors, "quantity": qty, "unit": "set",
            }],
        },
    )
    assert response.status_code == 200, response.text


def test_opening_a_package_allocates_it_to_the_waiting_order(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    order = _order(authed_client, "black2s", "2026-09-10", "Daw May")
    assert order["lines"][0]["allocated_quantity_pairs"] == 0

    receiving = _create_receiving(authed_client)
    _open_package(authed_client, receiving, "black2s", 2)

    after = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert after["lines"][0]["allocated_quantity_pairs"] == 12
    assert after["order_status"] == "ready_to_deliver"


def test_a_short_arrival_goes_to_the_older_order_first(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    older = _order(authed_client, "black2s", "2026-09-10", "Daw May")
    newer = _order(authed_client, "black2s", "2026-09-11", "U Ba")

    # Only two sets turn up, but four were wanted.
    receiving = _create_receiving(authed_client)
    _open_package(authed_client, receiving, "black2s", 2)

    older_after = authed_client.get(f"/api/wholesale/orders/{older['order_id']}").json()
    newer_after = authed_client.get(f"/api/wholesale/orders/{newer['order_id']}").json()
    assert older_after["lines"][0]["allocated_quantity_pairs"] == 12
    assert newer_after["lines"][0]["allocated_quantity_pairs"] == 0


def test_auto_allocation_never_passes_what_a_line_is_owed(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    order = _order(authed_client, "black1s", "2026-09-10", "Daw May")

    # Two sets arrive for a customer who only asked for one.
    receiving = _create_receiving(authed_client)
    _open_package(authed_client, receiving, "black2s", 2)

    after = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert after["lines"][0]["allocated_quantity_pairs"] == 6
