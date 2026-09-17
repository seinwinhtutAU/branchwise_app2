from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.wholesale.models.master_data import WholesaleProduct


def _user(db: Session, role: UserRole, branch_id: str | None) -> None:
    db.add(User(id="test-user-id", name="Tester", email="tester@example.com", role=role, branch_id=branch_id))
    db.commit()


def _branch(db: Session) -> Branch:
    branch = Branch(name="Wholesale", phone_number="0", address="Here")
    db.add(branch)
    db.commit()
    return branch


def _payload() -> dict:
    return {"supplier_name": "Goody Factory", "voucher_date": "2026-09-12", "carrier_name": "Shwe Moe Cargo", "total_packages": 2,
            "lines": [{"stock_code": "A1001", "description": "Sandal", "product_group": "man", "color_breakdown": "black2s", "unit": "set", "buying_price": 18000}]}


def test_supplier_voucher_persists_lines_and_capped_payments(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    assert created.status_code == 201
    voucher = created.json()
    assert voucher["voucher_no"].startswith("VCH-")
    assert voucher["total_quantity_pairs"] == 12
    assert voucher["balance_due"] == 36000

    payment = authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments", json={"paid_on": "2026-09-12", "amount": 20000, "note": "Advance"})
    assert payment.status_code == 201
    too_much = authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments", json={"paid_on": "2026-09-12", "amount": 16001, "note": "Too much"})
    assert too_much.status_code == 422

    reread = authed_client.get("/api/wholesale/supplier-vouchers")
    assert reread.status_code == 200
    assert reread.json()[0]["paid_amount"] == 20000


def test_retail_account_cannot_read_supplier_vouchers(authed_client: TestClient, db_session: Session) -> None:
    _user(db_session, UserRole.RETAIL, _branch(db_session).id)
    assert authed_client.get("/api/wholesale/supplier-vouchers").status_code == 403


def test_voucher_line_in_mmk_stores_no_original_amount_or_rate(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    line = created.json()["lines"][0]
    assert line["currency_code"] == "MMK"
    assert line["buying_price"] == 18000
    assert line["original_buying_price"] is None
    assert line["exchange_rate"] is None


def test_voucher_line_in_foreign_currency_computes_kyat_buying_price(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    payload = _payload()
    payload["lines"][0] |= {
        "currency_code": "thb",
        "buying_price": None,
        "original_buying_price": 500,
        "exchange_rate": 120,
    }
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=payload)
    assert created.status_code == 201
    line = created.json()["lines"][0]
    assert line["currency_code"] == "THB"
    assert line["buying_price"] == 60000
    assert line["original_buying_price"] == 500
    assert line["exchange_rate"] == 120


def test_voucher_line_foreign_currency_requires_original_amount_and_rate(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    payload = _payload()
    payload["lines"][0] |= {"currency_code": "USD"}
    response = authed_client.post("/api/wholesale/supplier-vouchers", json=payload)
    assert response.status_code == 422


def test_new_stock_code_on_a_voucher_line_creates_a_master_data_product(
    authed_client: TestClient, db_session: Session
) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    assert db_session.query(WholesaleProduct).count() == 0

    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    assert created.status_code == 201

    product = db_session.query(WholesaleProduct).filter(WholesaleProduct.stock_code == "A1001").first()
    assert product is not None
    assert product.description == "Sandal"


def test_voucher_version_id_and_allowed_actions(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    assert created.status_code == 201
    voucher = created.json()
    assert voucher["version_id"] == 1
    assert voucher["status"] == "draft"
    assert "edit" in voucher["allowed_actions"]
    assert "add_payment" in voucher["allowed_actions"]
    assert "delete" in voucher["allowed_actions"]

    # Update voucher bumps version_id
    updated = authed_client.put(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}", json=_payload())
    assert updated.status_code == 200
    assert updated.json()["version_id"] == 2

    # Add payment bumps version_id
    payment = authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments", json={"paid_on": "2026-09-12", "amount": 10000, "note": "Advance"})
    assert payment.status_code == 201
    v_after_payment = authed_client.get(f"/api/wholesale/supplier-vouchers").json()[0]
    assert v_after_payment["version_id"] == 3


def test_voucher_delete_guard_blocked_with_payments(authed_client: TestClient, db_session: Session) -> None:
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    v_id = created.json()["voucher_id"]

    # Add payment
    payment = authed_client.post(f"/api/wholesale/supplier-vouchers/{v_id}/payments", json={"paid_on": "2026-09-12", "amount": 5000, "note": "Part"}).json()

    # Attempt delete -> 409 Conflict
    del_res = authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_id}")
    assert del_res.status_code == 409
    assert "recorded payments" in del_res.json()["detail"]

    # Remove payment
    rem_res = authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_id}/payments/{payment['payment_id']}")
    assert rem_res.status_code == 204

    # Now delete succeeds
    del_res2 = authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_id}")
    assert del_res2.status_code == 204


def test_voucher_delete_guard_blocked_with_shipments(authed_client: TestClient, db_session: Session) -> None:
    from datetime import date
    from app.wholesale.models.entities import Shipment
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    v_data = created.json()

    # Add a shipment pointing to this voucher_no
    shipment = Shipment(
        branch_id=branch.id,
        shipment_no="SHP-260912-0001",
        voucher_no=v_data["voucher_no"],
        supplier_name=v_data["supplier_name"],
        carrier_name=v_data["carrier_name"],
        final_destination="Yangon",
        sent_on=date(2026, 9, 12),
        total_packages=2,
        total_quantity_pairs=12,
        total_unit="pair",
        packages_sent_by_cargo=2,
        final_received_packages=0,
    )
    db_session.add(shipment)
    db_session.commit()

    # Attempt delete -> 409 Conflict
    del_res = authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_data['voucher_id']}")
    assert del_res.status_code == 409
    assert "recorded shipments" in del_res.json()["detail"]


def test_voucher_line_quantity_reduction_guard(authed_client: TestClient, db_session: Session) -> None:
    from datetime import date
    from app.wholesale.models.entities import Receiving, ReceivingPackage, ReceivingItem, Shipment
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    v_data = created.json()

    # Need a shipment first because Receiving requires shipment_id FK
    shipment = Shipment(
        branch_id=branch.id,
        shipment_no="SHP-260912-0002",
        voucher_no=v_data["voucher_no"],
        supplier_name=v_data["supplier_name"],
        carrier_name=v_data["carrier_name"],
        final_destination="Yangon",
        sent_on=date(2026, 9, 12),
        total_packages=2,
        total_quantity_pairs=12,
        total_unit="pair",
        packages_sent_by_cargo=2,
        final_received_packages=0,
    )
    db_session.add(shipment)
    db_session.flush()

    # Create a receiving with 6 pairs opened for A1001
    rcv = Receiving(
        branch_id=branch.id,
        receiving_no="RCV-260912-0001",
        shipment_id=shipment.id,
        shipment_no=shipment.shipment_no,
        received_on=date(2026, 9, 12),
        gate="Gate 1",
        supplier_name="Goody Factory",
        voucher_no=v_data["voucher_no"],
    )
    db_session.add(rcv)
    db_session.flush()
    pkg = ReceivingPackage(receiving_id=rcv.id, package_no=1, opened=True)
    db_session.add(pkg)
    db_session.flush()
    item = ReceivingItem(package_id=pkg.id, stock_code="A1001", color_breakdown="black1s", quantity_pairs=6)
    db_session.add(item)
    db_session.commit()

    # Trying to reduce A1001 quantity to 4 pairs (< 6 received) should fail with 422
    payload = _payload()
    payload["lines"][0]["color_breakdown"] = "black4p"
    payload["lines"][0]["unit"] = "pair"
    res = authed_client.put(f"/api/wholesale/supplier-vouchers/{v_data['voucher_id']}", json=payload)
    assert res.status_code == 422
    assert "below already received quantity" in res.json()["detail"]


def test_voucher_audit_log_recorded(authed_client: TestClient, db_session: Session) -> None:
    from app.wholesale.models.entities import WholesaleAuditLog
    branch = _branch(db_session)
    _user(db_session, UserRole.WHOLESALE, branch.id)

    # 1. Create
    created = authed_client.post("/api/wholesale/supplier-vouchers", json=_payload())
    v_id = created.json()["voucher_id"]

    logs = db_session.query(WholesaleAuditLog).filter(WholesaleAuditLog.entity_id == v_id).all()
    assert len(logs) == 1
    assert logs[0].action == "create"
    assert logs[0].entity_type == "voucher"

    # 2. Edit
    authed_client.put(f"/api/wholesale/supplier-vouchers/{v_id}", json=_payload())
    logs = db_session.query(WholesaleAuditLog).filter(WholesaleAuditLog.entity_id == v_id).order_by(WholesaleAuditLog.created_at.asc()).all()
    assert len(logs) == 2
    assert logs[1].action == "edit"

    # 3. Add payment
    payment = authed_client.post(f"/api/wholesale/supplier-vouchers/{v_id}/payments", json={"paid_on": "2026-09-12", "amount": 5000, "note": "Part"}).json()
    logs = db_session.query(WholesaleAuditLog).filter(WholesaleAuditLog.entity_id == v_id).order_by(WholesaleAuditLog.created_at.asc()).all()
    assert len(logs) == 3
    assert logs[2].action == "add_payment"

    # 4. Delete payment
    authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_id}/payments/{payment['payment_id']}")
    logs = db_session.query(WholesaleAuditLog).filter(WholesaleAuditLog.entity_id == v_id).order_by(WholesaleAuditLog.created_at.asc()).all()
    assert len(logs) == 4
    assert logs[3].action == "delete_payment"

    # 5. Delete voucher
    authed_client.delete(f"/api/wholesale/supplier-vouchers/{v_id}")
    logs = db_session.query(WholesaleAuditLog).filter(WholesaleAuditLog.entity_id == v_id).order_by(WholesaleAuditLog.created_at.asc()).all()
    assert len(logs) == 5
    assert logs[4].action == "delete"

