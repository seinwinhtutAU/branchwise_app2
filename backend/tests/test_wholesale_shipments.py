"""GET/POST/PATCH/DELETE /api/wholesale/shipments."""

from datetime import date

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.wholesale.models.entities import (
    Receiving,
    Shipment,
    WholesaleAuditLog,
    WholesaleUnit,
    WholesaleWriteOff,
    WholesaleWriteOffReason,
)


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


def test_splitting_a_shipment_moves_the_undispatched_remainder_into_a_new_shipment(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10, total_quantity_pairs=300, packages_sent_by_cargo=6, legs=[]
        ),
    )
    assert created.status_code == 201
    shipment_id = created.json()["shipment_id"]

    split = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={
            "packages": 4,
            "quantity_pairs": 120,
            "final_destination": "Anawrahta Rd, Yangon",
            "carrier_name": "Ko Zaw Lin",
        },
    )
    assert split.status_code == 201
    body = split.json()

    original = body["original"]
    assert original["shipment_id"] == shipment_id
    assert original["total_packages"] == 6
    assert original["total_quantity_pairs"] == 180

    new_shipment = body["new_shipment"]
    assert new_shipment["shipment_id"] != shipment_id
    assert new_shipment["split_from_shipment_id"] == shipment_id
    assert new_shipment["voucher_no"] == original["voucher_no"]
    assert new_shipment["supplier_name"] == original["supplier_name"]
    assert new_shipment["total_packages"] == 4
    assert new_shipment["total_quantity_pairs"] == 120
    assert new_shipment["final_destination"] == "Anawrahta Rd, Yangon"
    assert new_shipment["carrier_name"] == "Ko Zaw Lin"
    today = date.today().strftime("%y%m%d")
    assert new_shipment["shipment_no"] == f"SHP-{today}-0002"


def test_split_with_no_quantity_leaves_the_originals_quantity_untouched(
    authed_client: TestClient, db_session: Session
):
    """quantity_pairs is optional — what's actually inside a box isn't known for
    certain until it's opened and counted at the receiving gate, so a split shouldn't
    have to guess at it. Leaving it out moves packages only; neither shipment's own
    quantity total is touched until a real count settles it."""
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10, total_quantity_pairs=300, packages_sent_by_cargo=6, legs=[]
        ),
    )
    shipment_id = created.json()["shipment_id"]

    split = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={
            "packages": 4,
            "final_destination": "Anawrahta Rd, Yangon",
            "carrier_name": "Ko Zaw Lin",
        },
    )
    assert split.status_code == 201
    body = split.json()

    assert body["original"]["total_packages"] == 6
    assert body["original"]["total_quantity_pairs"] == 300

    new_shipment = body["new_shipment"]
    assert new_shipment["total_packages"] == 4
    assert new_shipment["total_quantity_pairs"] == 0


def test_split_cannot_exceed_the_undispatched_remainder(
    authed_client: TestClient, db_session: Session
):
    """Packages are capped at what the cargo stage actually still holds — here, 2 of the
    10 — because letting a bigger request through would force the original's own
    already-sent figure to shrink to make the arithmetic add up, silently contradicting
    a count that may already be reflected in a Receiving record."""
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10, total_quantity_pairs=300, packages_sent_by_cargo=8, legs=[]
        ),
    )
    shipment_id = created.json()["shipment_id"]

    response = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={
            "packages": 3,
            "quantity_pairs": 90,
            "final_destination": "Zay Gyi St, Magway",
            "carrier_name": "",
        },
    )
    assert response.status_code == 422
    assert "2" in response.json()["detail"]

    reread = authed_client.get(f"/api/wholesale/shipments/{shipment_id}")
    assert reread.json()["total_packages"] == 10
    assert reread.json()["packages_sent_by_cargo"] == 8


def test_split_quantity_pairs_cannot_exceed_the_shipments_total(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10, total_quantity_pairs=300, packages_sent_by_cargo=0, legs=[]
        ),
    )
    shipment_id = created.json()["shipment_id"]

    response = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={
            "packages": 2,
            "quantity_pairs": 400,
            "final_destination": "Zay Gyi St, Magway",
            "carrier_name": "",
        },
    )
    assert response.status_code == 422


def test_splitting_a_leg_carries_its_travelled_route_into_the_new_shipment(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10,
            total_quantity_pairs=300,
            packages_sent_by_cargo=10,
            legs=[
                {
                    "stop_name": "Yangon",
                    "carrier_name": "U Hla Myint",
                    "packages_received": 10,
                    "packages_sent": 7,
                }
            ],
        ),
    )
    assert created.status_code == 201
    shipment_id = created.json()["shipment_id"]

    split = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={
            "packages": 2,
            "quantity_pairs": 60,
            "final_destination": "Zay Gyi St, Magway",
            "carrier_name": "Ko Zaw Lin",
            "split_leg_order": 1,
        },
    )
    assert split.status_code == 201
    body = split.json()

    original = body["original"]
    assert original["total_packages"] == 8
    assert original["total_quantity_pairs"] == 240
    assert original["packages_sent_by_cargo"] == 8
    assert len(original["legs"]) == 1
    assert original["legs"][0]["packages_received"] == 8
    assert original["legs"][0]["packages_sent"] == 7
    assert original["legs"][0]["leg_remaining"] == 1

    new_shipment = body["new_shipment"]
    assert new_shipment["total_packages"] == 2
    assert new_shipment["packages_sent_by_cargo"] == 2
    assert new_shipment["final_destination"] == "Zay Gyi St, Magway"
    assert len(new_shipment["legs"]) == 1
    assert new_shipment["legs"][0]["stop_name"] == "Yangon"
    assert new_shipment["legs"][0]["packages_received"] == 2
    assert new_shipment["legs"][0]["packages_sent"] == 0
    assert new_shipment["legs"][0]["leg_remaining"] == 2


def test_split_leg_order_cannot_exceed_that_stops_remainder(
    authed_client: TestClient, db_session: Session
):
    """Same cap at a leg: Yangon only shows 3 packages not yet sent on (10 received, 7
    already forwarded), so asking for 4 is refused rather than being allowed to shrink
    that already-forwarded 7 down to make the numbers balance."""
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10,
            total_quantity_pairs=300,
            packages_sent_by_cargo=10,
            legs=[
                {
                    "stop_name": "Yangon",
                    "carrier_name": "U Hla Myint",
                    "packages_received": 10,
                    "packages_sent": 7,
                }
            ],
        ),
    )
    shipment_id = created.json()["shipment_id"]

    response = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={
            "packages": 4,
            "quantity_pairs": 120,
            "final_destination": "Zay Gyi St, Magway",
            "carrier_name": "",
            "split_leg_order": 1,
        },
    )
    assert response.status_code == 422
    assert "3" in response.json()["detail"]

    reread = authed_client.get(f"/api/wholesale/shipments/{shipment_id}")
    assert reread.json()["legs"][0]["packages_sent"] == 7


def test_split_leg_order_must_reference_an_existing_stop(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)

    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10, total_quantity_pairs=300, packages_sent_by_cargo=10, legs=[]
        ),
    )
    shipment_id = created.json()["shipment_id"]

    response = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={
            "packages": 1,
            "quantity_pairs": 10,
            "final_destination": "Somewhere",
            "carrier_name": "",
            "split_leg_order": 1,
        },
    )
    assert response.status_code == 422


def test_a_retail_account_cannot_split_a_shipment(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    created = authed_client.post("/api/wholesale/shipments", json=_shipment_payload(legs=[]))
    shipment_id = created.json()["shipment_id"]

    db_session.query(User).filter(User.id == "test-user-id").delete()
    db_session.add(User(id="test-user-id", name="Retail", email="retail@example.com", role=UserRole.RETAIL, branch_id=branch.id))
    db_session.commit()

    response = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={"packages": 1, "quantity_pairs": 10, "final_destination": "Somewhere", "carrier_name": ""},
    )
    assert response.status_code == 403


def test_split_guarded_when_completed(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    # total_packages=10, final_received_packages=10 -> completed
    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(total_packages=10, final_received_packages=10, packages_sent_by_cargo=10, legs=[]),
    )
    shipment_id = created.json()["shipment_id"]
    assert created.json()["shipment_status"] == "completed"
    assert "split" not in created.json()["allowed_actions"]

    response = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={"packages": 1, "final_destination": "Mawlamyine", "carrier_name": "Test Cargo"},
    )
    assert response.status_code == 409
    assert "completed shipment" in response.json()["detail"]


def test_split_and_delete_guarded_when_receiving_exists(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(total_packages=10, packages_sent_by_cargo=5, final_received_packages=0, legs=[]),
    )
    shipment_id = created.json()["shipment_id"]

    receiving = Receiving(
        branch_id=branch.id,
        receiving_no="RCV-260827-0001",
        voucher_no="VCH-260825-0001",
        supplier_name="Goody Factory",
        gate="Bogyoke Rd",
        shipment_no=created.json()["shipment_no"],
        shipment_id=shipment_id,
        received_on=date.today(),
    )
    db_session.add(receiving)
    db_session.commit()

    # Split should be rejected with 409
    split_resp = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={"packages": 1, "final_destination": "Mawlamyine", "carrier_name": "Test Cargo"},
    )
    assert split_resp.status_code == 409
    assert "receiving recorded" in split_resp.json()["detail"]

    # Delete should also be rejected with 409
    del_resp = authed_client.delete(f"/api/wholesale/shipments/{shipment_id}")
    assert del_resp.status_code == 409
    assert "receiving recorded" in del_resp.json()["detail"]


def test_split_leg_preserves_leg_id_for_writeoffs(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10,
            packages_sent_by_cargo=10,
            final_received_packages=0,
            legs=[
                {"stop_name": "Yangon", "carrier_name": "Cargo A", "packages_received": 10, "packages_sent": 7}
            ],
        ),
    )
    shipment = created.json()
    orig_leg_id = shipment["legs"][0]["leg_id"]

    # Record a write-off against this leg
    write_off = WholesaleWriteOff(
        branch_id=branch.id,
        subject_type="shipment_leg",
        subject_id=orig_leg_id,
        unit=WholesaleUnit.PAIR,
        reason=WholesaleWriteOffReason.DAMAGED,
        quantity=1,
        recorded_by_user_id="test-user-id",
    )
    db_session.add(write_off)
    db_session.commit()

    # Split from Yangon leg (physical remaining at Yangon: 10 - 7 - 1 = 2)
    response = authed_client.post(
        f"/api/wholesale/shipments/{shipment['shipment_id']}/split",
        json={
            "packages": 1,
            "final_destination": "Bago",
            "carrier_name": "Express",
            "split_leg_order": 1,
        },
    )
    assert response.status_code == 201
    split_result = response.json()
    orig_updated = split_result["original"]

    # The original leg's ID must be preserved, NOT replaced with a new UUID
    assert orig_updated["legs"][0]["leg_id"] == orig_leg_id

    # The write_off subject_id still matches
    attached_wo = db_session.query(WholesaleWriteOff).filter_by(subject_id=orig_leg_id).first()
    assert attached_wo is not None


def test_split_with_set_unit_deducts_pairs(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10,
            total_quantity_pairs=60,  # 10 sets = 60 pairs
            total_unit="set",
            packages_sent_by_cargo=0,
            final_received_packages=0,
            legs=[],
        ),
    )
    shipment_id = created.json()["shipment_id"]

    # Split 2 packages with 12 pairs (2 sets)
    response = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={
            "packages": 2,
            "quantity_pairs": 12,
            "final_destination": "Mandalay",
            "carrier_name": "MDY Express",
        },
    )
    assert response.status_code == 201
    res = response.json()
    orig = res["original"]
    new_shp = res["new_shipment"]

    assert orig["total_packages"] == 8
    assert orig["total_quantity_pairs"] == 48
    assert orig["total_unit"] == "set"

    assert new_shp["total_packages"] == 2
    assert new_shp["total_quantity_pairs"] == 12
    assert new_shp["total_unit"] == "set"
    assert new_shp["split_from_shipment_id"] == shipment_id


def test_split_records_audit_log_and_version(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10,
            total_quantity_pairs=100,
            packages_sent_by_cargo=0,
            final_received_packages=0,
            legs=[],
        ),
    )
    shipment_id = created.json()["shipment_id"]
    assert created.json()["version_id"] == 1

    split_resp = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/split",
        json={
            "packages": 3,
            "quantity_pairs": 30,
            "final_destination": "Mawlamyine",
            "carrier_name": "Express",
        },
    )
    assert split_resp.status_code == 201

    # Audit log check
    audit = db_session.query(WholesaleAuditLog).filter_by(entity_id=shipment_id, action="split").first()
    assert audit is not None
    assert audit.payload["packages"] == 3
    assert audit.payload["final_destination"] == "Mawlamyine"


def test_write_off_shipment_guard_and_version_bump(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_user(db_session, role=UserRole.WHOLESALE, branch_id=branch.id)
    created = authed_client.post(
        "/api/wholesale/shipments",
        json=_shipment_payload(
            total_packages=10,
            total_quantity_pairs=100,
            packages_sent_by_cargo=10,
            final_received_packages=5,
            legs=[],
        ),
    )
    shipment_id = created.json()["shipment_id"]
    assert created.json()["version_id"] == 1

    # Record write-off on in-transit/partly-delivered shipment
    wo_resp = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/write-off",
        json={"quantity": 1, "reason": "lost_in_transit", "note": "Box lost"},
    )
    assert wo_resp.status_code == 201

    # Version should be bumped
    fetched = authed_client.get(f"/api/wholesale/shipments/{shipment_id}")
    assert fetched.json()["version_id"] == 2

    # Now update to completed (final_received_packages = 9, since 1 lost, remaining 0)
    upd_resp = authed_client.patch(
        f"/api/wholesale/shipments/{shipment_id}",
        json={"final_received_packages": 9},
    )
    assert upd_resp.status_code == 200
    assert upd_resp.json()["shipment_status"] == "completed"

    # Attempt write-off on completed shipment must raise 409 Conflict
    blocked_wo = authed_client.post(
        f"/api/wholesale/shipments/{shipment_id}/write-off",
        json={"quantity": 1, "reason": "lost_in_transit", "note": "Too late"},
    )
    assert blocked_wo.status_code == 409

