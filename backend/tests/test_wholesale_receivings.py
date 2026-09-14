"""End-to-end coverage for the Receiving phase's persisted workflow."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def _make_branch(db_session: Session, name: str = "Wholesale") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.commit()
    return branch


def _make_user(db_session: Session, role: UserRole, branch_id: str | None) -> User:
    user = User(id="test-user-id", name="Tester", email="tester@example.com", role=role, branch_id=branch_id)
    db_session.add(user)
    db_session.commit()
    return user


def _shipment_payload() -> dict:
    return {
        "voucher_no": "VCH-260825-0001",
        "supplier_name": "Goody Factory",
        "carrier_name": "Shwe Moe Cargo",
        "final_destination": "Bogyoke Rd, Mawlamyine",
        "sent_on": "2026-08-27",
        "total_packages": 2,
        "total_quantity_pairs": 12,
        "total_unit": "set",
        "packages_sent_by_cargo": 2,
        "final_received_packages": 0,
        "legs": [],
    }


def _create_shipment(authed_client: TestClient) -> str:
    response = authed_client.post("/api/wholesale/shipments", json=_shipment_payload())
    assert response.status_code == 201
    return response.json()["shipment_id"]


def test_receiving_crud_packages_costs_and_shipment_figure(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _make_branch(db_session)
    _make_user(db_session, UserRole.WHOLESALE, branch.id)
    shipment_id = _create_shipment(authed_client)

    created = authed_client.post(
        "/api/wholesale/receivings",
        json={
            "shipment_id": shipment_id,
            "gate": "Bogyoke Rd, Mawlamyine",
            "received_on": "2026-09-12",
            "total_packages": 2,
            "total_quantity_pairs": 12,
            "total_unit": "set",
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["receiving_no"] == f"RCV-{date.today():%y%m%d}-0001"
    assert body["shipment_no"].startswith("SHP-")
    assert body["receiving_status"] == "recorded"
    assert len(body["packages"]) == 2

    package_id = body["packages"][0]["package_id"]
    updated = authed_client.patch(
        f"/api/wholesale/receivings/{body['receiving_id']}/packages/{package_id}",
        json={
            "opened": True,
            "received_on": "2026-09-12",
            "note": "Counted at the gate",
            "items": [
                {
                    "stock_code": "A1001",
                    "description": "Men's sandal",
                    "product_group": "man",
                    "color_breakdown": "black1s",
                    "quantity": 1,
                    "unit": "set",
                }
            ],
        },
    )
    assert updated.status_code == 200
    assert updated.json()["counted_quantity_pairs"] == 6
    assert updated.json()["receiving_status"] == "checking"

    costs = authed_client.put(
        f"/api/wholesale/receivings/{body['receiving_id']}/costs",
        json=[{"stage": "Shwe Moe Cargo", "carrier": "Shwe Moe", "kind": "Cargo fee", "amount": 15000, "note": "Paid"}],
    )
    assert costs.status_code == 200
    assert costs.json()["total_cost"] == 15000

    shipment = authed_client.get(f"/api/wholesale/shipments/{shipment_id}")
    assert shipment.status_code == 200
    assert shipment.json()["final_received_packages"] == 2

    deleted = authed_client.delete(f"/api/wholesale/receivings/{body['receiving_id']}")
    assert deleted.status_code == 204
    assert authed_client.get(f"/api/wholesale/receivings/{body['receiving_id']}").status_code == 404


def test_receiving_rejects_other_branch_and_retail_account(
    authed_client: TestClient, db_session: Session
) -> None:
    mine = _make_branch(db_session, "Wholesale A")
    other = _make_branch(db_session, "Wholesale B")
    _make_user(db_session, UserRole.WHOLESALE, other.id)
    shipment_id = _create_shipment(authed_client)
    db_session.query(User).filter(User.id == "test-user-id").update({"branch_id": mine.id})
    db_session.commit()

    response = authed_client.post(
        "/api/wholesale/receivings",
        json={
            "shipment_id": shipment_id,
            "gate": "Gate",
            "received_on": "2026-09-12",
            "total_packages": 1,
            "total_quantity_pairs": 6,
            "total_unit": "set",
        },
    )
    assert response.status_code == 404

    db_session.query(User).filter(User.id == "test-user-id").update({"role": UserRole.RETAIL})
    db_session.commit()
    assert authed_client.get("/api/wholesale/receivings").status_code == 403
