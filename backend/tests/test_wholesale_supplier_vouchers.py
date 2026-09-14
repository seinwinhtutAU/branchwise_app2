from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole


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
    assert voucher["balance_due"] == 216000

    payment = authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments", json={"paid_on": "2026-09-12", "amount": 100000, "note": "Advance"})
    assert payment.status_code == 201
    too_much = authed_client.post(f"/api/wholesale/supplier-vouchers/{voucher['voucher_id']}/payments", json={"paid_on": "2026-09-12", "amount": 116001, "note": "Too much"})
    assert too_much.status_code == 422

    reread = authed_client.get("/api/wholesale/supplier-vouchers")
    assert reread.status_code == 200
    assert reread.json()[0]["paid_amount"] == 100000


def test_retail_account_cannot_read_supplier_vouchers(authed_client: TestClient, db_session: Session) -> None:
    _user(db_session, UserRole.RETAIL, _branch(db_session).id)
    assert authed_client.get("/api/wholesale/supplier-vouchers").status_code == 403
