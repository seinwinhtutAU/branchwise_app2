from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.routers import users as users_router


def _admin(db: Session) -> User:
    account = User(
        id="test-user-id",
        name="Admin",
        email="admin@example.com",
        role=UserRole.ADMIN,
    )
    db.add(account)
    db.flush()
    return account


def _branch(db: Session) -> Branch:
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db.add(branch)
    db.flush()
    return branch


def test_only_admin_can_list_users(authed_client, db_session: Session):
    db_session.add(
        User(
            id="test-user-id",
            name="Retail",
            email="retail@example.com",
            role=UserRole.RETAIL,
            branch_id=_branch(db_session).id,
        )
    )
    db_session.commit()

    assert authed_client.get("/api/users").status_code == 403


def test_admin_can_create_update_and_delete_user(
    authed_client, db_session: Session, monkeypatch
):
    _admin(db_session)
    branch = _branch(db_session)
    db_session.commit()
    monkeypatch.setattr(users_router, "_create_auth_account", lambda email, password, name: "auth-new")

    created = authed_client.post(
        "/api/users",
        json={
            "name": "Retail Operator",
            "email": "operator@example.com",
            "password": "password123",
            "role": "retail",
            "branch_id": branch.id,
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["role"] == "retail"
    assert body["branch_name"] == "Retail 1"

    changed = authed_client.patch(
        f"/api/users/{body['id']}",
        json={"role": "retail_management", "branch_id": None},
    )
    assert changed.status_code == 200
    assert changed.json()["role"] == "retail_management"
    assert changed.json()["branch_id"] is None

    deleted = authed_client.delete(f"/api/users/{body['id']}")
    assert deleted.status_code == 204
    assert authed_client.get("/api/users").json() == [
        {
            "id": "test-user-id",
            "name": "Admin",
            "email": "admin@example.com",
            "role": "admin",
            "branch_id": None,
            "branch_name": None,
        }
    ]
