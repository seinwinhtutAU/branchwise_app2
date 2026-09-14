from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.models.wholesale import (
    ProductGroup,
    Receiving,
    ReceivingItem,
    ReceivingPackage,
    Shipment,
    WholesaleUnit,
)


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
        "customer_name": "Daw May", "customer_phone": "09", "customer_address": "Yangon",
        "order_date": "2026-09-13",
        "lines": [{"stock_code": "A1001", "description": "Sandal", "product_group": "man", "supplier_name": "Factory", "color_breakdown": "black2s", "unit": "set", "selling_price": 18000}],
    }


def _incoming_stock(db: Session, branch: Branch) -> None:
    shipment = Shipment(
        branch_id=branch.id, shipment_no="SHP-260913-0001", voucher_no="VCH-1",
        supplier_name="Factory", carrier_name="Cargo", final_destination="Gate", sent_on=date(2026, 9, 13),
        total_packages=1, total_quantity_pairs=12, total_unit=WholesaleUnit.SET,
        packages_sent_by_cargo=1, final_received_packages=1,
    )
    db.add(shipment)
    db.flush()
    db.add(Receiving(
        branch_id=branch.id, receiving_no="RCV-260913-0001", shipment_id=shipment.id,
        shipment_no=shipment.shipment_no, voucher_no=shipment.voucher_no, supplier_name="Factory",
        gate="Gate", received_on=date(2026, 9, 13), total_packages=1, total_quantity_pairs=12,
        total_unit=WholesaleUnit.SET,
        packages=[ReceivingPackage(package_no=1, opened=True, received_on=date(2026, 9, 13), items=[
            ReceivingItem(stock_code="A1001", description="Sandal", product_group=ProductGroup.MAN, color_breakdown="black2s", colors=[{"color": "black", "qty": 2, "unit": "set"}], unit=WholesaleUnit.SET, quantity_pairs=12),
            ReceivingItem(stock_code="A1002", description="Slipper", product_group=ProductGroup.MAN, color_breakdown="white2s", colors=[{"color": "white", "qty": 2, "unit": "set"}], unit=WholesaleUnit.SET, quantity_pairs=12),
        ])],
    ))
    db.commit()


def test_delivery_is_capped_by_stock_and_updates_order_progress(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    payload = {"order_id": order["order_id"], "stock_code": "A1001", "location": "Gate", "color_breakdown": "black1s", "unit": "set", "delivered_on": "2026-09-13", "note": "Collected"}

    delivery = authed_client.post("/api/wholesale/inventory/deliveries", json=payload)
    assert delivery.status_code == 201
    assert delivery.json()["quantity_pairs"] == 6

    order_after = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert order_after["delivered_quantity_pairs"] == 6
    assert order_after["order_status"] == "partly_delivered"

    too_much = authed_client.post("/api/wholesale/inventory/deliveries", json=payload | {"color_breakdown": "black2s"})
    assert too_much.status_code == 422

    removed = authed_client.delete(f"/api/wholesale/inventory/deliveries/{delivery.json()['movement_id']}")
    assert removed.status_code == 204
    assert authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()["delivered_quantity_pairs"] == 0


def test_customer_order_line_allocation_persists_and_is_returned_on_order_reads(
    authed_client: TestClient,
    db_session: Session,
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    line_id = order["lines"][0]["order_line_id"]

    allocated = authed_client.put(
        f"/api/wholesale/orders/lines/{line_id}/allocation",
        json={"color_breakdown": "black1s"},
    )
    assert allocated.status_code == 200
    assert allocated.json()["lines"][0]["allocated_quantity_pairs"] == 6
    assert allocated.json()["lines"][0]["allocated_color_breakdown"] == "black1s"

    reread = authed_client.get(f"/api/wholesale/orders/{order['order_id']}")
    assert reread.status_code == 200
    assert reread.json()["lines"][0]["allocated_quantity_pairs"] == 6
    assert reread.json()["lines"][0]["allocated_color_breakdown"] == "black1s"

    updated = authed_client.put(
        f"/api/wholesale/orders/{order['order_id']}",
        json=_order_payload() | {"customer_address": "Mandalay"},
    )
    assert updated.status_code == 200
    assert updated.json()["lines"][0]["allocated_quantity_pairs"] == 6
    assert updated.json()["lines"][0]["allocated_color_breakdown"] == "black1s"

    cleared = authed_client.put(
        f"/api/wholesale/orders/lines/{updated.json()['lines'][0]['order_line_id']}/allocation",
        json={"color_breakdown": ""},
    )
    assert cleared.status_code == 200
    assert cleared.json()["lines"][0]["allocated_quantity_pairs"] == 0
    assert cleared.json()["lines"][0]["allocated_color_breakdown"] == ""

    events = authed_client.get("/api/wholesale/orders/allocations")
    assert events.status_code == 200
    rows = events.json()
    # One event per value change: black1s, then re-saving it on the order update is a
    # no-op (skipped), then cleared back to "".
    assert [row["color_breakdown"] for row in rows] == ["", "black1s"]
    assert rows[0]["previous_color_breakdown"] == "black1s"
    assert rows[0]["order_no"] == order["order_no"]
    assert rows[0]["stock_code"] == "A1001"
    assert rows[0]["recorded_by_user_id"] == "test-user-id"


def test_delivery_cannot_take_stock_allocated_to_another_order(
    authed_client: TestClient, db_session: Session,
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    # Both orders want the same 12 pairs of black A1001; only one order can end up with
    # the stock this reserves.
    order_a = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    order_b = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()

    allocated = authed_client.put(
        f"/api/wholesale/orders/lines/{order_a['lines'][0]['order_line_id']}/allocation",
        json={"color_breakdown": "black1s"},
    )
    assert allocated.status_code == 200
    assert allocated.json()["lines"][0]["allocated_quantity_pairs"] == 6

    # Order B cannot be delivered from the 6 pairs reserved for order A: 12 total minus
    # 6 reserved leaves only 6 available to anyone else.
    too_much_for_b = authed_client.post(
        "/api/wholesale/inventory/deliveries",
        json={
            "order_id": order_b["order_id"], "stock_code": "A1001", "location": "Gate",
            "color_breakdown": "black2s", "unit": "set", "delivered_on": "2026-09-13", "note": "",
        },
    )
    assert too_much_for_b.status_code == 422
    assert "reserved" in too_much_for_b.json()["detail"].lower()

    # The unreserved 6 pairs are still first-come-first-served.
    fits_for_b = authed_client.post(
        "/api/wholesale/inventory/deliveries",
        json={
            "order_id": order_b["order_id"], "stock_code": "A1001", "location": "Gate",
            "color_breakdown": "black1s", "unit": "set", "delivered_on": "2026-09-13", "note": "",
        },
    )
    assert fits_for_b.status_code == 201

    # Order A can still draw on its own reservation even though every remaining pair is
    # now either delivered to B or reserved for A.
    fits_for_a = authed_client.post(
        "/api/wholesale/inventory/deliveries",
        json={
            "order_id": order_a["order_id"], "stock_code": "A1001", "location": "Gate",
            "color_breakdown": "black1s", "unit": "set", "delivered_on": "2026-09-13", "note": "",
        },
    )
    assert fits_for_a.status_code == 201


def test_delivery_clamps_allocation_and_releases_the_delivered_stock(
    authed_client: TestClient,
    db_session: Session,
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order_a = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    line_id = order_a["lines"][0]["order_line_id"]

    allocated = authed_client.put(
        f"/api/wholesale/orders/lines/{line_id}/allocation",
        json={"color_breakdown": "black2s"},
    )
    assert allocated.status_code == 200
    assert allocated.json()["lines"][0]["allocated_quantity_pairs"] == 12

    delivered = authed_client.post(
        "/api/wholesale/inventory/deliveries",
        json={
            "order_id": order_a["order_id"], "stock_code": "A1001", "location": "Gate",
            "color_breakdown": "black1s", "unit": "set", "delivered_on": "2026-09-13", "note": "",
        },
    )
    assert delivered.status_code == 201

    reread = authed_client.get(f"/api/wholesale/orders/{order_a['order_id']}").json()
    assert reread["lines"][0]["allocated_quantity_pairs"] == 6
    assert reread["lines"][0]["allocated_color_breakdown"] == "black6p"

    # The six pairs delivered to A no longer remain part of A's reservation, so B can
    # take the six pairs that are physically left without colliding with stale state.
    order_b = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    fits_for_b = authed_client.post(
        "/api/wholesale/inventory/deliveries",
        json={
            "order_id": order_b["order_id"], "stock_code": "A1001", "location": "Gate",
            "color_breakdown": "black1s", "unit": "set", "delivered_on": "2026-09-13", "note": "",
        },
    )
    assert fits_for_b.status_code == 201


def test_delivery_must_match_order_and_stock_colors(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order_payload = _order_payload()
    order_payload["lines"][0]["color_breakdown"] = "black1s,pink1s"
    order = authed_client.post("/api/wholesale/orders", json=order_payload).json()
    payload = {
        "order_id": order["order_id"],
        "stock_code": "A1001",
        "location": "Gate",
        "unit": "set",
        "delivered_on": "2026-09-13",
        "note": "Collected",
    }

    missing_color = authed_client.post(
        "/api/wholesale/inventory/deliveries",
        json=payload | {"color_breakdown": "pink1s"},
    )
    assert missing_color.status_code == 422
    assert "pink" in missing_color.json()["detail"]

    available_color = authed_client.post(
        "/api/wholesale/inventory/deliveries",
        json=payload | {"color_breakdown": "black1s"},
    )
    assert available_color.status_code == 201


def test_customer_delivery_batch_records_multiple_products_together(
    authed_client: TestClient,
    db_session: Session,
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order_payload = _order_payload()
    order_payload["lines"].append({
        "stock_code": "A1002", "description": "Slipper", "product_group": "man",
        "supplier_name": "Factory", "color_breakdown": "white1s", "unit": "set",
        "selling_price": 16000,
    })
    order = authed_client.post("/api/wholesale/orders", json=order_payload).json()

    delivery = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
        "order_id": order["order_id"], "delivered_on": "2026-09-13",
        "delivery_address": "12 Strand Road, Yangon", "note": "Collected together",
        "lines": [
            {"stock_code": "A1001", "location": "Gate", "color_breakdown": "black2s", "unit": "set"},
            {"stock_code": "A1002", "location": "Gate", "color_breakdown": "white1s", "unit": "set"},
        ],
    })

    assert delivery.status_code == 201
    assert {row["stock_code"] for row in delivery.json()} == {"A1001", "A1002"}
    assert {row["delivery_address"] for row in delivery.json()} == {"12 Strand Road, Yangon"}
    order_after = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert order_after["delivered_quantity_pairs"] == 18
    assert order_after["order_status"] == "completed"


def test_customer_delivery_batch_does_not_partially_save_invalid_lines(
    authed_client: TestClient,
    db_session: Session,
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order_payload = _order_payload()
    order_payload["lines"].append({
        "stock_code": "A1002", "description": "Slipper", "product_group": "man",
        "supplier_name": "Factory", "color_breakdown": "white1s", "unit": "set",
        "selling_price": 16000,
    })
    order = authed_client.post("/api/wholesale/orders", json=order_payload).json()

    delivery = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
        "order_id": order["order_id"], "delivered_on": "2026-09-13", "note": "",
        "lines": [
            {"stock_code": "A1001", "location": "Gate", "color_breakdown": "black1s", "unit": "set"},
            {"stock_code": "A1002", "location": "Gate", "color_breakdown": "pink1s", "unit": "set"},
        ],
    })

    assert delivery.status_code == 422
    order_after = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert order_after["delivered_quantity_pairs"] == 0
