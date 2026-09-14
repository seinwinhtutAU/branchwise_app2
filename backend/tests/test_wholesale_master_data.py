import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def _make_user(db_session: Session, role: UserRole) -> User:
    user = User(id="test-user-id", name="Tester", email="tester@example.com", role=role)
    db_session.add(user)
    db_session.commit()
    return user


ENTITY_CASES = [
    ("products", {"stock_code": "Z9001", "description": "Test shoe", "product_group": "man"}, "product_id"),
    ("suppliers", {"name": "Test Factory", "phone": "09-1", "address": "Test address"}, "supplier_id"),
    ("customers", {"name": "Test Customer", "phone": "09-2", "address": "Test address"}, "customer_id"),
    ("cargo-companies", {"name": "Test Cargo"}, "cargo_company_id"),
    ("carriers", {"name": "Test Carrier"}, "carrier_id"),
    ("destinations", {"name": "Test Destination"}, "destination_id"),
    ("receiving-gates", {"name": "Test Gate"}, "receiving_gate_id"),
]


@pytest.mark.parametrize("path,payload,id_key", ENTITY_CASES)
def test_all_master_data_entities_support_crud_and_soft_delete(
    authed_client: TestClient, db_session: Session, path: str, payload: dict, id_key: str
):
    _make_user(db_session, UserRole.WHOLESALE)

    created = authed_client.post(f"/api/wholesale/{path}", json=payload)
    assert created.status_code == 201
    row = created.json()
    entity_id = row[id_key]
    assert row["active"] is True

    reread = authed_client.get(f"/api/wholesale/{path}/{entity_id}")
    assert reread.status_code == 200
    assert reread.json()[id_key] == entity_id

    listed = authed_client.get(f"/api/wholesale/{path}")
    assert listed.status_code == 200
    assert listed.headers["X-Total-Count"] == "1"
    assert listed.json()[0][id_key] == entity_id

    patched = authed_client.patch(f"/api/wholesale/{path}/{entity_id}", json={"active": False})
    assert patched.status_code == 200
    assert patched.json()["active"] is False

    assert authed_client.get(f"/api/wholesale/{path}").json() == []
    inactive = authed_client.get(f"/api/wholesale/{path}?active_only=false")
    assert inactive.status_code == 200
    assert inactive.json()[0][id_key] == entity_id

    deleted = authed_client.delete(f"/api/wholesale/{path}/{entity_id}")
    assert deleted.status_code == 204


@pytest.mark.parametrize(
    "path,payload",
    [
        ("products", {"stock_code": "Z9002", "description": "Test", "product_group": "lady"}),
        ("suppliers", {"name": "Duplicate Factory"}),
        ("cargo-companies", {"name": "Duplicate Cargo"}),
        ("carriers", {"name": "Duplicate Carrier"}),
        ("destinations", {"name": "Duplicate Destination"}),
        ("receiving-gates", {"name": "Duplicate Gate"}),
    ],
)
def test_unique_master_data_conflict_returns_409(
    authed_client: TestClient, db_session: Session, path: str, payload: dict
):
    _make_user(db_session, UserRole.WHOLESALE)
    assert authed_client.post(f"/api/wholesale/{path}", json=payload).status_code == 201
    conflict = authed_client.post(f"/api/wholesale/{path}", json=payload)
    assert conflict.status_code == 409


def test_customer_names_are_allowed_to_repeat(authed_client: TestClient, db_session: Session):
    _make_user(db_session, UserRole.WHOLESALE)
    payload = {"name": "Same Customer", "phone": "", "address": ""}
    assert authed_client.post("/api/wholesale/customers", json=payload).status_code == 201
    assert authed_client.post("/api/wholesale/customers", json=payload).status_code == 201


def test_non_wholesale_role_is_refused(authed_client: TestClient, db_session: Session):
    branch = Branch(name="Retail", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.commit()
    user = User(id="test-user-id", name="Retail", email="tester@example.com", role=UserRole.RETAIL, branch_id=branch.id)
    db_session.add(user)
    db_session.commit()
    response = authed_client.get("/api/wholesale/products")
    assert response.status_code == 403
