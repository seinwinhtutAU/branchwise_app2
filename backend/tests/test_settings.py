from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User, UserRole


def _make_user(db_session: Session, *, role: UserRole) -> None:
    db_session.add(
        User(id="test-user-id", name="Test User", email="test@example.com", role=role)
    )
    db_session.commit()


def test_get_settings_returns_defaults_before_any_are_saved(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.RETAIL)

    response = authed_client.get("/api/settings")
    assert response.status_code == 200
    assert response.json() == {"stock_forward_fallback_window_days": 30}


def test_empty_update_leaves_settings_unchanged(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.ADMIN)

    response = authed_client.put("/api/settings", json={})
    assert response.status_code == 200
    assert response.json() == {"stock_forward_fallback_window_days": 30}


def test_non_admin_cannot_change_settings(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.RETAIL)

    response = authed_client.put(
        "/api/settings", json={"stock_forward_fallback_window_days": 14}
    )
    assert response.status_code == 403


def test_admin_can_change_settings_and_it_persists(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.ADMIN)

    put_response = authed_client.put(
        "/api/settings", json={"stock_forward_fallback_window_days": 14}
    )
    assert put_response.status_code == 200
    assert put_response.json() == {"stock_forward_fallback_window_days": 14}

    get_response = authed_client.get("/api/settings")
    assert get_response.json() == {"stock_forward_fallback_window_days": 14}


def test_out_of_range_window_is_rejected(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.ADMIN)

    response = authed_client.put(
        "/api/settings", json={"stock_forward_fallback_window_days": -1}
    )
    assert response.status_code == 422
