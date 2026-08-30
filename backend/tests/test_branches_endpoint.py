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


def test_new_branch_defaults_to_month_first_date_formats(
    authed_client: TestClient, db_session: Session
):
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.commit()

    response = authed_client.get("/api/branches")
    assert response.status_code == 200
    row = response.json()[0]
    assert row["sale_date_format"] == "MDY"
    assert row["inventory_date_format"] == "MDY"


def _make_admin(db_session: Session) -> None:
    db_session.add(
        User(id="test-user-id", name="Admin", email="admin@example.com", role=UserRole.ADMIN)
    )
    db_session.commit()


def test_admin_can_set_a_branchs_date_formats_independently_of_other_branches(
    authed_client: TestClient, db_session: Session
):
    ashley = Branch(name="Ashley", phone_number="000", address="TBD")
    other = Branch(name="Aung Thit Sar", phone_number="000", address="TBD")
    db_session.add_all([ashley, other])
    db_session.flush()
    _make_admin(db_session)

    response = authed_client.put(
        f"/api/branches/{ashley.id}",
        json={"sale_date_format": "DMY", "inventory_date_format": "DMY"},
    )
    assert response.status_code == 200
    assert response.json() == {
        "id": ashley.id,
        "name": "Ashley",
        "sale_date_format": "DMY",
        "inventory_date_format": "DMY",
    }

    # The other branch is untouched — this is a per-branch setting, not global.
    unaffected = [b for b in authed_client.get("/api/branches").json() if b["id"] == other.id][0]
    assert unaffected["sale_date_format"] == "MDY"
    assert unaffected["inventory_date_format"] == "MDY"


def test_admin_can_update_just_one_of_the_two_formats(
    authed_client: TestClient, db_session: Session
):
    branch = Branch(name="Ashley", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    _make_admin(db_session)

    response = authed_client.put(
        f"/api/branches/{branch.id}", json={"sale_date_format": "DMY"}
    )
    assert response.status_code == 200
    assert response.json()["sale_date_format"] == "DMY"
    assert response.json()["inventory_date_format"] == "MDY"


def test_non_admin_cannot_change_a_branchs_date_format(
    authed_client: TestClient, db_session: Session
):
    branch = Branch(name="Ashley", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    db_session.add(
        User(
            id="test-user-id",
            name="Retail",
            email="retail@example.com",
            role=UserRole.RETAIL,
            branch_id=branch.id,
        )
    )
    db_session.commit()

    response = authed_client.put(
        f"/api/branches/{branch.id}", json={"sale_date_format": "DMY"}
    )
    assert response.status_code == 403


def test_updating_an_unknown_branch_id_is_rejected(
    authed_client: TestClient, db_session: Session
):
    _make_admin(db_session)

    response = authed_client.put(
        "/api/branches/does-not-exist", json={"sale_date_format": "DMY"}
    )
    assert response.status_code == 404


def test_invalid_date_format_value_is_rejected(
    authed_client: TestClient, db_session: Session
):
    branch = Branch(name="Ashley", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    _make_admin(db_session)

    response = authed_client.put(
        f"/api/branches/{branch.id}", json={"sale_date_format": "YMD"}
    )
    assert response.status_code == 422
