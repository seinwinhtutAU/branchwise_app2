from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole


def test_branch_with_wholesale_role_user_excluded(authed_client: TestClient, db_session: Session):
    # Named "Depot", not "Wholesale" — proves the exclusion is driven by the
    # assigned user's role, not by matching the branch name.
    retail = Branch(name="Retail 1", phone_number="000", address="TBD")
    depot = Branch(name="Depot", phone_number="000", address="TBD")
    db_session.add_all([retail, depot])
    db_session.flush()
    db_session.add(
        User(
            id="wholesale-user-id",
            name="Wholesale User",
            email="wholesale@example.com",
            role=UserRole.WHOLESALE,
            branch_id=depot.id,
        )
    )
    db_session.commit()

    response = authed_client.get("/api/branches")
    assert response.status_code == 200
    names = {b["name"] for b in response.json()}
    assert names == {"Retail 1"}


def test_branch_named_wholesale_but_no_wholesale_user_is_kept(
    authed_client: TestClient, db_session: Session
):
    db_session.add(Branch(name="Wholesale", phone_number="000", address="TBD"))
    db_session.commit()

    response = authed_client.get("/api/branches")
    assert response.status_code == 200
    names = {b["name"] for b in response.json()}
    assert names == {"Wholesale"}
