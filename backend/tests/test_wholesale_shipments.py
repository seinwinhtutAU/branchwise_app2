"""GET/POST/PATCH/DELETE /api/wholesale/shipments."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.models.wholesale import Shipment


def _make_user(db_session: Session, *, role: UserRole, branch_id: str | None = None) -> User:
    user = User(id="test-user-id", name="Tester", email="tester@example.com", role=role, branch_id=branch_id)
    db_session.add(user)
    db_session.commit()
    return user


def _make_branch(db_session: Session, name: str = "Wholesale") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.commit()
    return branch


def _shipment_payload(**overrides) -> dict:
    payload = {
        "voucher_no": "VCH-260825-0001",
        "supplier_name": "Goody Factory",
        "carrier_name": "Shwe Moe Cargo",
        "final_destination": "Bogyoke Rd, Mawlamyine",
        "sent_on": "2026-08-27",
        "total_packages": 10,
        "total_quantity_pairs": 300,
        "total_unit": "pair",
        "packages_sent_by_cargo": 10,
        "final_received_packages": 7,
        "legs": [
            {
                "stop_name": "Yangon",
                "carrier_name": "U Hla Myint",
                "packages_received": 10,
                "packages_sent": 7,
            }
        ],
    }
    payload.update(overrides)
    return payload


def test_creating_a_shipment_assigns_a_reference_number_and_reads_back(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    response = authed_client.post("/api/wholesale/shipments", json=_shipment_payload())
    assert response.status_code == 201
    body = response.json()
    # The reference is dated to when it was raised (today), not the shipment's own
    # sent_on — the same rule frontend/.../wholesale/shared.ts::nextReference follows.
    today = date.today().strftime("%y%m%d")
    assert body["shipment_no"] == f"SHP-{today}-0001"
    assert body["total_packages"] == 10
    assert body["cargo_remaining"] == 0
    assert body["final_remaining"] == 3
    assert body["shipment_status"] == "partly_delivered"
    assert len(body["legs"]) == 1
    assert body["legs"][0]["max_for_leg"] == 10
    assert body["legs"][0]["leg_remaining"] == 3

    reread = authed_client.get(f"/api/wholesale/shipments/{body['shipment_id']}")
    assert reread.status_code == 200
    assert reread.json()["shipment_no"] == f"SHP-{today}-0001"


def test_a_second_shipment_the_same_day_gets_the_next_number(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    first = authed_client.post("/api/wholesale/shipments", json=_shipment_payload())
    second = authed_client.post("/api/wholesale/shipments", json=_shipment_payload())
    today = date.today().strftime("%y%m%d")
    assert first.json()["shipment_no"] == f"SHP-{today}-0001"
    assert second.json()["shipment_no"] == f"SHP-{today}-0002"


def test_an_impossible_leg_is_trimmed_on_create(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    payload = _shipment_payload(
        packages_sent_by_cargo=5,
        legs=[{"stop_name": "Yangon", "carrier_name": "U Hla", "packages_received": 10, "packages_sent": 10}],
    )
    response = authed_client.post("/api/wholesale/shipments", json=payload)
    assert response.status_code == 201
    leg = response.json()["legs"][0]
    assert leg["packages_received"] == 5
    assert leg["packages_sent"] == 5


def test_partial_update_leaves_other_fields_untouched(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    shipment_id = authed_client.post("/api/wholesale/shipments", json=_shipment_payload()).json()["shipment_id"]

    response = authed_client.patch(
        f"/api/wholesale/shipments/{shipment_id}", json={"carrier_name": "Ayar Cargo"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["carrier_name"] == "Ayar Cargo"
    assert body["supplier_name"] == "Goody Factory"
    assert body["final_destination"] == "Bogyoke Rd, Mawlamyine"


def test_replacing_legs_re_normalises_the_flow(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    shipment_id = authed_client.post("/api/wholesale/shipments", json=_shipment_payload()).json()["shipment_id"]

    response = authed_client.patch(
        f"/api/wholesale/shipments/{shipment_id}",
        json={"legs": [{"stop_name": "Yangon", "carrier_name": "U Hla", "packages_received": 10, "packages_sent": 12}]},
    )
    assert response.status_code == 200
    leg = response.json()["legs"][0]
    assert leg["packages_sent"] == 10


def test_deleting_a_shipment_removes_it(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    shipment_id = authed_client.post("/api/wholesale/shipments", json=_shipment_payload()).json()["shipment_id"]

    response = authed_client.delete(f"/api/wholesale/shipments/{shipment_id}")
    assert response.status_code == 204
    assert authed_client.get(f"/api/wholesale/shipments/{shipment_id}").status_code == 404


def test_a_retail_account_is_refused(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session, "Retail")
    _make_user(db_session, role=UserRole.RETAIL, branch_id=branch.id)

    response = authed_client.get("/api/wholesale/shipments")
    assert response.status_code == 403


def test_another_branchs_shipment_is_404_not_403(authed_client: TestClient, db_session: Session):
    mine = _make_branch(db_session, "Mine")
    theirs = Branch(name="Theirs", phone_number="000", address="TBD")
    db_session.add(theirs)
    db_session.commit()

    other_shipment = Shipment(
        branch_id=theirs.id,
        shipment_no="SHP-260827-0001",
        voucher_no="VCH-260825-0001",
        supplier_name="Goody Factory",
        carrier_name="Shwe Moe Cargo",
        final_destination="Zay Gyi St, Magway",
        sent_on=date(2026, 8, 27),
        total_packages=5,
        total_quantity_pairs=100,
    )
    db_session.add(other_shipment)
    db_session.commit()

    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=mine.id)

    response = authed_client.get(f"/api/wholesale/shipments/{other_shipment.id}")
    assert response.status_code == 404


def test_negative_package_count_is_rejected(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    response = authed_client.post("/api/wholesale/shipments", json=_shipment_payload(total_packages=-1))
    assert response.status_code == 422


def test_admin_without_branch_id_is_rejected(authed_client: TestClient, db_session: Session):
    _make_user(db_session, role=UserRole.ADMIN, branch_id=None)

    response = authed_client.post("/api/wholesale/shipments", json=_shipment_payload())
    assert response.status_code == 400


def test_admin_can_create_for_a_named_branch(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.ADMIN, branch_id=None)

    response = authed_client.post(
        "/api/wholesale/shipments", json=_shipment_payload(branch_id=branch.id)
    )
    assert response.status_code == 201
    assert response.json()["branch_id"] == branch.id
