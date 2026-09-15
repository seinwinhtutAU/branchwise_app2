from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.models.wholesale_master_data import WholesaleProduct


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
