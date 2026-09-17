from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.wholesale.models.entities import (
    CustomerOrder,
    CustomerOrderLine,
    ProductGroup,
    Receiving,
    ReceivingItem,
    ReceivingPackage,
    Shipment,
    ShipmentLeg,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesaleAuditLog,
    WholesaleStockMovement,
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



def _allocate(client: TestClient, order: dict, colors: str, stock_code: str = "A1001") -> None:
    """Goods can only be delivered once they are allocated, so every delivery test has to
    reserve the stock first — the same two steps a user takes on the Fulfill screen.

    Looked up by stock code rather than by position: the API does not promise to hand the
    lines back in the order they were sent."""
    line_id = next(
        line["order_line_id"] for line in order["lines"] if line["stock_code"] == stock_code
    )
    response = client.put(
        f"/api/wholesale/orders/lines/{line_id}/allocation",
        json={"color_breakdown": colors},
    )
    assert response.status_code == 200, response.text


def test_delivery_is_capped_by_stock_and_updates_order_progress(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    _allocate(authed_client, order, "black2s")
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
    assert allocated.json()["order_status"] == "ready_to_deliver"

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

    fully_allocated = authed_client.put(
        f"/api/wholesale/orders/lines/{updated.json()['lines'][0]['order_line_id']}/allocation",
        json={"color_breakdown": "black2s"},
    )
    assert fully_allocated.status_code == 200
    assert fully_allocated.json()["order_status"] == "ready_to_deliver"

    cleared = authed_client.put(
        f"/api/wholesale/orders/lines/{updated.json()['lines'][0]['order_line_id']}/allocation",
        json={"color_breakdown": ""},
    )
    assert cleared.status_code == 200
    assert cleared.json()["lines"][0]["allocated_quantity_pairs"] == 0
    assert cleared.json()["lines"][0]["allocated_color_breakdown"] == ""
    assert cleared.json()["order_status"] == "waiting_for_stock"

    events = authed_client.get("/api/wholesale/orders/allocations")
    assert events.status_code == 200
    rows = events.json()
    # One event per value change: black1s, then black2s, then cleared back to "".
    assert [row["color_breakdown"] for row in rows] == ["", "black2s", "black1s"]
    assert rows[0]["previous_color_breakdown"] == "black2s"
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

    # B cannot reserve all 12: 6 of them are already held for A.
    greedy_b = authed_client.put(
        f"/api/wholesale/orders/lines/{order_b['lines'][0]['order_line_id']}/allocation",
        json={"color_breakdown": "black2s"},
    )
    assert greedy_b.status_code == 422
    assert "available" in greedy_b.json()["detail"].lower()

    # B takes the 6 pairs A did not, then asks to deliver twice what it holds.
    _allocate(authed_client, order_b, "black1s")
    too_much_for_b = authed_client.post(
        "/api/wholesale/inventory/deliveries",
        json={
            "order_id": order_b["order_id"], "stock_code": "A1001", "location": "Gate",
            "color_breakdown": "black2s", "unit": "set", "delivered_on": "2026-09-13", "note": "",
        },
    )
    assert too_much_for_b.status_code == 422
    assert "allocated" in too_much_for_b.json()["detail"].lower()

    # The 6 pairs B reserved for itself can go out.
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


def test_delivery_must_match_order_and_stock_colors(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order_payload = _order_payload()
    order_payload["lines"][0]["color_breakdown"] = "black1s,pink1s"
    order = authed_client.post("/api/wholesale/orders", json=order_payload).json()
    _allocate(authed_client, order, "black1s")
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
    _allocate(authed_client, order, "black2s", "A1001")
    _allocate(authed_client, order, "white1s", "A1002")

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
    assert order_after["order_status"] == "fulfilled"


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


def test_stock_records_include_supplier_voucher_lines_before_receiving(
    authed_client: TestClient, db_session: Session,
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    db_session.add(SupplierVoucher(
        branch_id=branch.id,
        voucher_no="VCH-1",
        supplier_name="Factory",
        voucher_date=date(2026, 9, 13),
        carrier_name="Cargo",
        total_packages=1,
        lines=[SupplierVoucherLine(
            stock_code="A1003", description="Boot", product_group=ProductGroup.MAN,
            color_breakdown="black2s", colors=[{"color": "black", "qty": 2, "unit": "set"}],
            unit=WholesaleUnit.SET, quantity_pairs=12, buying_price=100,
        )],
    ))
    db_session.commit()

    response = authed_client.get("/api/wholesale/inventory/stock")
    assert response.status_code == 200
    row = response.json()[0]
    assert row["stock_code"] == "A1003"
    assert row["at_supplier_pairs"] == 12
    assert row["on_hand_pairs"] == 0
    assert row["colors"] == "black2s"
    assert row["status"] == "At Supplier"
    assert row["locations"] == []
    assert response.headers["X-Total-Count"] == "1"
    assert authed_client.get("/api/wholesale/inventory/stock?source=voucher").json()[0]["stock_code"] == "A1003"
    assert authed_client.get("/api/wholesale/inventory/stock?status=In%20Transit").json() == []
    assert authed_client.get("/api/wholesale/inventory/stock?search=VCH-1").json()[0]["stock_code"] == "A1003"


def test_stock_records_include_open_orders_but_ignore_cancelled_orders(
    authed_client: TestClient, db_session: Session,
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    open_order = CustomerOrder(
        branch_id=branch.id, order_no="ORD-OPEN", customer_name="Customer",
        customer_phone="0", customer_address="Here", order_date=date(2026, 9, 13),
        lines=[CustomerOrderLine(
            stock_code="A1004", description="Bag", product_group=ProductGroup.LADY,
            supplier_name="Factory", color_breakdown="red1s", colors=[{"color": "red", "qty": 1, "unit": "set"}],
            unit=WholesaleUnit.SET, quantity_pairs=6, selling_price=100,
        )],
    )
    cancelled_order = CustomerOrder(
        branch_id=branch.id, order_no="ORD-CANCELLED", customer_name="Customer",
        customer_phone="0", customer_address="Here", order_date=date(2026, 9, 13), cancelled=True,
        lines=[CustomerOrderLine(
            stock_code="A1005", description="Hat", product_group=ProductGroup.LADY,
            supplier_name="Factory", color_breakdown="blue1s", colors=[{"color": "blue", "qty": 1, "unit": "set"}],
            unit=WholesaleUnit.SET, quantity_pairs=6, selling_price=100,
        )],
    )
    db_session.add_all([open_order, cancelled_order])
    db_session.commit()

    rows = authed_client.get("/api/wholesale/inventory/stock").json()
    by_code = {row["stock_code"]: row for row in rows}
    assert by_code["A1004"]["status"] == "Customer Ordered"
    assert by_code["A1004"]["owed_to_customers_pairs"] == 6
    assert by_code["A1004"]["colors"] == "red1s"
    assert "A1005" not in by_code


def test_product_movements_can_be_read_across_all_locations(
    authed_client: TestClient, db_session: Session,
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    db_session.add(WholesaleStockMovement(
        branch_id=branch.id, order_id=order["order_id"], stock_code="A1001", description="Sandal",
        product_group=ProductGroup.MAN, color_breakdown="black1s", colors=[{"color": "black", "qty": 1, "unit": "set"}],
        quantity_pairs=6, location="Other Gate", delivered_on=date(2026, 9, 13), recorded_by_user_id="test-user-id",
    ))
    db_session.commit()

    rows = authed_client.get("/api/wholesale/inventory/movements/A1001")
    assert rows.status_code == 200
    assert {row["location"] for row in rows.json()} == {"Gate", "Other Gate"}


def test_stock_records_split_shipment_stage_and_received_stock(
    authed_client: TestClient, db_session: Session,
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    voucher = SupplierVoucher(
        branch_id=branch.id, voucher_no="VCH-STAGE", supplier_name="Factory",
        voucher_date=date(2026, 9, 10), carrier_name="Cargo", total_packages=2,
        lines=[SupplierVoucherLine(
            stock_code="A1006", description="Shoe", product_group=ProductGroup.MAN,
            color_breakdown="black4s", colors=[{"color": "black", "qty": 4, "unit": "set"}],
            unit=WholesaleUnit.SET, quantity_pairs=24, buying_price=100,
        )],
    )
    shipment = Shipment(
        branch_id=branch.id, shipment_no="SHP-STAGE", voucher_no="VCH-STAGE",
        supplier_name="Factory", carrier_name="Cargo", final_destination="Gate",
        sent_on=date(2026, 9, 11), total_packages=2, total_quantity_pairs=24,
        total_unit=WholesaleUnit.SET, packages_sent_by_cargo=2, final_received_packages=0,
        legs=[ShipmentLeg(leg_order=1, stop_name="Yangon", carrier_name="Truck", packages_received=2, packages_sent=2)],
    )
    db_session.add_all([voucher, shipment])
    db_session.commit()

    transit = authed_client.get("/api/wholesale/inventory/stock").json()[0]
    assert transit["in_transit_pairs"] == 24
    assert transit["at_supplier_pairs"] == 0
    assert transit["status"] == "In Transit"

    receiving = Receiving(
        branch_id=branch.id, receiving_no="RCV-STAGE", shipment_id=shipment.id,
        shipment_no=shipment.shipment_no, voucher_no=shipment.voucher_no,
        supplier_name="Factory", gate="Gate", received_on=date(2026, 9, 12),
        total_packages=2, total_quantity_pairs=24, total_unit=WholesaleUnit.SET,
        packages=[ReceivingPackage(
            package_no=1, opened=True, received_on=date(2026, 9, 12),
            items=[ReceivingItem(
                stock_code="A1006", description="Shoe", product_group=ProductGroup.MAN,
                color_breakdown="black2s", colors=[{"color": "black", "qty": 2, "unit": "set"}],
                unit=WholesaleUnit.SET, quantity_pairs=12,
            )],
        )],
    )
    db_session.add(receiving)
    db_session.commit()

    partial = authed_client.get("/api/wholesale/inventory/stock").json()[0]
    assert partial["on_hand_pairs"] == 12
    assert partial["incoming_pairs"] == 12
    assert partial["at_supplier_pairs"] + partial["in_transit_pairs"] == 12


def test_delivery_requires_the_stock_to_be_allocated_first(
    authed_client: TestClient,
    db_session: Session,
) -> None:
    """Allocation is the step that decides whose goods these are. Handing over stock that
    was never set aside would let one customer take what another is waiting for."""
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    assert order["lines"][0]["allocated_quantity_pairs"] == 0

    refused = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
        "order_id": order["order_id"], "delivered_on": "2026-09-13",
        "delivery_address": "Yangon", "note": "",
        "lines": [
            {"stock_code": "A1001", "location": "Gate",
             "color_breakdown": "black1s", "unit": "set"},
        ],
    })
    assert refused.status_code == 422
    assert "allocate" in refused.json()["detail"].lower()

    _allocate(authed_client, order, "black1s")
    allowed = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
        "order_id": order["order_id"], "delivered_on": "2026-09-13",
        "delivery_address": "Yangon", "note": "",
        "lines": [
            {"stock_code": "A1001", "location": "Gate",
             "color_breakdown": "black1s", "unit": "set"},
        ],
    })
    assert allowed.status_code == 201, allowed.text

    after = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert after["delivered_quantity_pairs"] == 6
    assert after["remaining_quantity_pairs"] == 6


def test_delivery_still_cannot_pass_what_the_customer_is_owed(
    authed_client: TestClient,
    db_session: Session,
) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()

    too_much = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
        "order_id": order["order_id"], "delivered_on": "2026-09-13",
        "delivery_address": "Yangon", "note": "",
        "lines": [
            {"stock_code": "A1001", "location": "Gate",
             "color_breakdown": "black3s", "unit": "set"},
        ],
    })
    assert too_much.status_code == 422
    assert "owed" in too_much.json()["detail"]


def test_order_line_reports_what_has_been_delivered_by_color(
    authed_client: TestClient,
    db_session: Session,
) -> None:
    """The screen caps a delivery per colour, so it needs the colours already gone out —
    ordered colours alone only give it the line total."""
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    payload = _order_payload()
    payload["lines"][0]["color_breakdown"] = "black1s,pink1s"
    order = authed_client.post("/api/wholesale/orders", json=payload).json()
    assert order["lines"][0]["delivered_color_breakdown"] == ""
    _allocate(authed_client, order, "black1s")

    delivery = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
        "order_id": order["order_id"], "delivered_on": "2026-09-13",
        "delivery_address": "Yangon", "note": "",
        "lines": [
            {"stock_code": "A1001", "location": "Gate",
             "color_breakdown": "black1s", "unit": "set"},
        ],
    })
    assert delivery.status_code == 201, delivery.text

    after = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    line = after["lines"][0]
    assert line["delivered_color_breakdown"] == "black6p"
    assert line["delivered_quantity_pairs"] == 6


def test_delivery_bumps_order_version_and_records_audit(
    authed_client: TestClient, db_session: Session,
) -> None:
    """create_delivery_batch must bump the order version_id and write an audit log."""
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)

    order_resp = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    order_id = order_resp["order_id"]

    # Allocation is required before delivery can be accepted.
    _allocate(authed_client, order_resp, "black1s")

    order_before = db_session.get(CustomerOrder, order_id)
    version_before = order_before.version_id

    batch = authed_client.post("/api/wholesale/inventory/deliveries/batch", json={
        "order_id": order_id,
        "delivered_on": "2026-09-14",
        "delivery_address": "Yangon",
        "note": "",
        "lines": [
            {"stock_code": "A1001", "location": "Gate", "color_breakdown": "black1s", "unit": "set"},
        ],
    })
    assert batch.status_code == 201, batch.text

    db_session.expire(order_before)
    order_after = db_session.get(CustomerOrder, order_id)
    assert order_after.version_id != version_before, "version_id should have been bumped"

    log = (
        db_session.query(WholesaleAuditLog)
        .filter_by(entity_type="customer_order", entity_id=order_id, action="deliver")
        .first()
    )
    assert log is not None, "audit log entry should have been created"
    assert log.payload["stock_codes"] == ["A1001"]
