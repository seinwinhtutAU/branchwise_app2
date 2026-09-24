from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def _branch_and_user(db: Session) -> Branch:
    branch = Branch(name="Wholesale", phone_number="0", address="Here")
    db.add(branch)
    db.commit()
    db.add(User(id="test-user-id", name="Tester", email="tester@example.com", role=UserRole.WHOLESALE, branch_id=branch.id))
    db.commit()
    return branch


def test_shipment_leg_write_off_closes_the_route_and_is_audited(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    created = authed_client.post(
        "/api/wholesale/shipments",
        json={
            "voucher_no": "VCH-1",
            "supplier_name": "Factory",
            "carrier_name": "Cargo",
            "final_destination": "Gate",
            "sent_on": "2026-09-15",
            "total_packages": 10,
            "total_quantity_pairs": 10,
            "packages_sent_by_cargo": 10,
            "final_received_packages": 7,
            "legs": [{"stop_name": "Yangon", "carrier_name": "Agent", "packages_received": 10, "packages_sent": 7}],
        },
    ).json()
    leg_id = created["legs"][0]["leg_id"]

    result = authed_client.post(
        f"/api/wholesale/shipments/{created['shipment_id']}/write-off",
        json={"leg_id": leg_id, "quantity": 3, "reason": "lost_in_transit", "note": "Carrier confirmed missing"},
    )
    assert result.status_code == 201
    assert result.json()["subject_type"] == "shipment_leg"

    reread = authed_client.get(f"/api/wholesale/shipments/{created['shipment_id']}").json()
    assert reread["final_remaining"] == 0
    assert reread["shipment_status"] == "completed"
    assert reread["legs"][0]["leg_remaining"] == 0
    assert reread["legs"][0]["lost_packages"] == 3

    audit = authed_client.get("/api/wholesale/write-offs", params={"search": "carrier"})
    assert audit.status_code == 200
    assert audit.json()[0]["reason"] == "lost_in_transit"


def test_repackaged_shipment_leg_corrects_the_count_without_creating_a_loss(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    created = authed_client.post(
        "/api/wholesale/shipments",
        json={
            "voucher_no": "VCH-REPACK",
            "supplier_name": "Factory",
            "carrier_name": "Cargo",
            "final_destination": "Gate",
            "sent_on": "2026-09-15",
            "total_packages": 5,
            "total_quantity_pairs": 10,
            "packages_sent_by_cargo": 5,
            "final_received_packages": 0,
            "legs": [
                {"stop_name": "Yangon", "carrier_name": "Agent", "packages_received": 3, "packages_sent": 3},
                {"stop_name": "Mawlamyine", "carrier_name": "Agent", "packages_received": 3, "packages_sent": 3},
            ],
        },
    ).json()
    first_leg_id = created["legs"][0]["leg_id"]

    result = authed_client.post(
        f"/api/wholesale/shipments/{created['shipment_id']}/write-off",
        json={"leg_id": first_leg_id, "quantity": 5, "reason": "repackaged", "note": "Boxes split at Yangon"},
    )

    assert result.status_code == 201
    assert result.json()["reason"] == "repackaged"
    assert "Recounted: 3 → 5 packages" in result.json()["note"]

    reread = authed_client.get(f"/api/wholesale/shipments/{created['shipment_id']}").json()
    assert reread["legs"][0]["packages_received"] == 5
    assert reread["legs"][0]["packages_sent"] == 5
    assert reread["legs"][0]["lost_packages"] == 0
    assert reread["legs"][1]["max_for_leg"] == 5
    assert reread["legs"][1]["lost_packages"] == 0

    updated = authed_client.patch(
        f"/api/wholesale/shipments/{created['shipment_id']}",
        json={"carrier_name": "Updated Cargo"},
    )
    assert updated.status_code == 200
    assert updated.json()["legs"][0]["packages_sent"] == 5
    assert updated.json()["legs"][1]["max_for_leg"] == 5


def test_repackaged_is_not_allowed_for_pair_based_lines(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    voucher = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json={
            "supplier_name": "Factory", "voucher_date": "2026-09-15", "total_packages": 1,
            "lines": [{"stock_code": "R1", "description": "Sandal", "product_group": "man", "color_breakdown": "black2s", "unit": "set", "buying_price": 1}],
        },
    ).json()
    line_id = voucher["lines"][0]["voucher_line_id"]

    result = authed_client.post(
        f"/api/wholesale/supplier-vouchers/lines/{line_id}/write-off",
        json={"quantity": 1, "reason": "repackaged"},
    )

    assert result.status_code == 422


def test_write_off_cannot_exceed_the_remaining_quantity_for_each_subject(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    voucher = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json={
            "supplier_name": "Factory", "voucher_date": "2026-09-15", "total_packages": 1,
            "lines": [{"stock_code": "A1", "description": "Sandal", "product_group": "man", "color_breakdown": "black2s", "unit": "set", "buying_price": 1}],
        },
    ).json()
    line_id = voucher["lines"][0]["voucher_line_id"]
    too_much_voucher = authed_client.post(
        f"/api/wholesale/supplier-vouchers/lines/{line_id}/write-off",
        json={"quantity": 13, "reason": "short_shipped"},
    )
    assert too_much_voucher.status_code == 422

    order = authed_client.post(
        "/api/wholesale/orders",
        json={
            "customer_name": "Customer", "order_date": "2026-09-15",
            "lines": [{"stock_code": "A1", "description": "Sandal", "product_group": "man", "color_breakdown": "black2s", "unit": "set", "selling_price": 1}],
        },
    ).json()
    order_line_id = order["lines"][0]["order_line_id"]
    too_much_order = authed_client.post(
        f"/api/wholesale/orders/lines/{order_line_id}/write-off",
        json={"quantity": 13, "reason": "damaged"},
    )
    assert too_much_order.status_code == 422


def test_voucher_and_order_exact_write_offs_close_their_statuses(
    authed_client: TestClient, db_session: Session
) -> None:
    _branch_and_user(db_session)
    voucher = authed_client.post(
        "/api/wholesale/supplier-vouchers",
        json={
            "supplier_name": "Factory", "voucher_date": "2026-09-15", "total_packages": 1,
            "lines": [{"stock_code": "B1", "description": "Flat", "product_group": "lady", "color_breakdown": "black2s", "unit": "set", "buying_price": 1}],
        },
    ).json()
    voucher_line_id = voucher["lines"][0]["voucher_line_id"]
    assert authed_client.post(
        f"/api/wholesale/supplier-vouchers/lines/{voucher_line_id}/write-off",
        json={"quantity": 12, "reason": "short_shipped"},
    ).status_code == 201
    voucher_row = authed_client.get("/api/wholesale/supplier-vouchers").json()[0]
    assert voucher_row["remaining_quantity_pairs"] == 0

    order = authed_client.post(
        "/api/wholesale/orders",
        json={
            "customer_name": "Customer", "order_date": "2026-09-15",
            "lines": [{"stock_code": "B1", "description": "Flat", "product_group": "lady", "color_breakdown": "black2s", "unit": "set", "selling_price": 1}],
        },
    ).json()
    order_line_id = order["lines"][0]["order_line_id"]
    assert authed_client.post(
        f"/api/wholesale/orders/lines/{order_line_id}/write-off",
        json={"quantity": 12, "reason": "damaged"},
    ).status_code == 201
    reread = authed_client.get(f"/api/wholesale/orders/{order['order_id']}").json()
    assert reread["remaining_quantity_pairs"] == 0
    assert reread["order_status"] == "fulfilled"
