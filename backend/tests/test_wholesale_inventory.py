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
        "lines": [{"stock_code": "A1001", "description": "Sandal", "product_group": "man", "supplier_name": "Factory", "color_qty": "black2s", "unit": "set", "selling_price": 18000}],
    }


def _incoming_stock(db: Session, branch: Branch) -> None:
    shipment = Shipment(
        branch_id=branch.id, shipment_no="SHP-260913-0001", voucher_no="VCH-1",
        supplier_name="Factory", cargo_name="Cargo", final_location="Gate", sent_date=date(2026, 9, 13),
        total_packages=1, total_pairs=12, total_unit=WholesaleUnit.SET,
        packages_sent_by_cargo=1, final_received_packages=1,
    )
    db.add(shipment)
    db.flush()
    db.add(Receiving(
        branch_id=branch.id, receiving_no="RCV-260913-0001", shipment_id=shipment.id,
        shipment_no=shipment.shipment_no, voucher_no=shipment.voucher_no, supplier_name="Factory",
        gate="Gate", received_date=date(2026, 9, 13), total_packages=1, total_pairs=12,
        total_unit=WholesaleUnit.SET,
        packages=[ReceivingPackage(package_no=1, opened=True, received_date=date(2026, 9, 13), items=[ReceivingItem(stock_code="A1001", description="Sandal", product_group=ProductGroup.MAN, color_qty="black2s", colors=[{"color": "black", "qty": 2, "unit": "set"}], unit=WholesaleUnit.SET, qty_pairs=12)])],
    ))
    db.commit()


def test_delivery_is_capped_by_stock_and_updates_order_progress(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order = authed_client.post("/api/wholesale/orders", json=_order_payload()).json()
    payload = {"order_id": order["order_id"], "stock_code": "A1001", "location": "Gate", "color_qty": "black1s", "unit": "set", "delivered_on": "2026-09-13", "note": "Collected"}

    delivery = authed_client.post("/api/wholesale/inventory/deliveries", json=payload)
    assert delivery.status_code == 201
    assert delivery.json()["pairs"] == 6

    order_after = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert order_after["received_qty"] == 6
    assert order_after["order_status"] == "processing"

    too_much = authed_client.post("/api/wholesale/inventory/deliveries", json=payload | {"color_qty": "black2s"})
    assert too_much.status_code == 422

    removed = authed_client.delete(f"/api/wholesale/inventory/deliveries/{delivery.json()['movement_id']}")
    assert removed.status_code == 204
    assert authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()["received_qty"] == 0


def test_delivery_must_match_order_and_stock_colors(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, branch.id)
    _incoming_stock(db_session, branch)
    order_payload = _order_payload()
    order_payload["lines"][0]["color_qty"] = "black1s,pink1s"
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
        json=payload | {"color_qty": "pink1s"},
    )
    assert missing_color.status_code == 422
    assert "pink" in missing_color.json()["detail"]

    available_color = authed_client.post(
        "/api/wholesale/inventory/deliveries",
        json=payload | {"color_qty": "black1s"},
    )
    assert available_color.status_code == 201
