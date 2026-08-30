from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.app_settings import DEFAULT_SETTINGS, AppSetting
from app.models.user import User, UserRole


def _make_user(db_session: Session, *, role: UserRole) -> None:
    db_session.add(
        User(id="test-user-id", name="Test User", email="test@example.com", role=role)
    )
    db_session.commit()


DEFAULT_SETTINGS_RESPONSE = {
    "stock_forward_fallback_window_days": 30,
    "purchase_lookback_window_days": 14,
    "stock_lookback_window_days": 7,
    "theme": "system",
    "sale_warning_window_days": 1,
    "purchase_warning_window_days": 1,
    "sale_list_window_days": 90,
    "purchase_list_window_days": 90,
    "show_buying_price_source": True,
}


def test_get_settings_returns_defaults_before_any_are_saved(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.RETAIL)

    response = authed_client.get("/api/settings")
    assert response.status_code == 200
    assert response.json() == DEFAULT_SETTINGS_RESPONSE


def test_empty_update_leaves_settings_unchanged(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.ADMIN)

    response = authed_client.put("/api/settings", json={})
    assert response.status_code == 200
    assert response.json() == DEFAULT_SETTINGS_RESPONSE


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
        "/api/settings",
        json={
            "stock_forward_fallback_window_days": 45,
            "purchase_lookback_window_days": 21,
            "stock_lookback_window_days": 10,
        },
    )
    expected = {
        **DEFAULT_SETTINGS_RESPONSE,
        "stock_forward_fallback_window_days": 45,
        "purchase_lookback_window_days": 21,
        "stock_lookback_window_days": 10,
    }
    assert put_response.status_code == 200
    assert put_response.json() == expected

    get_response = authed_client.get("/api/settings")
    assert get_response.json() == expected


def test_admin_can_change_one_setting_without_touching_others(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.ADMIN)

    put_response = authed_client.put(
        "/api/settings", json={"purchase_lookback_window_days": 21}
    )
    assert put_response.status_code == 200
    assert put_response.json() == {**DEFAULT_SETTINGS_RESPONSE, "purchase_lookback_window_days": 21}


def test_out_of_range_window_is_rejected(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.ADMIN)

    response = authed_client.put(
        "/api/settings", json={"stock_forward_fallback_window_days": -1}
    )
    assert response.status_code == 422


def test_admin_can_change_business_wide_ui_preferences(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.ADMIN)

    put_response = authed_client.put(
        "/api/settings",
        json={
            "theme": "dark",
            "sale_warning_window_days": 7,
            "purchase_warning_window_days": 14,
            "sale_list_window_days": 180,
            "purchase_list_window_days": 30,
            "show_buying_price_source": False,
        },
    )
    expected = {
        **DEFAULT_SETTINGS_RESPONSE,
        "theme": "dark",
        "sale_warning_window_days": 7,
        "purchase_warning_window_days": 14,
        "sale_list_window_days": 180,
        "purchase_list_window_days": 30,
        "show_buying_price_source": False,
    }
    assert put_response.status_code == 200
    assert put_response.json() == expected

    get_response = authed_client.get("/api/settings")
    assert get_response.json() == expected


def test_invalid_theme_is_rejected(authed_client: TestClient, db_session: Session):
    _make_user(db_session, role=UserRole.ADMIN)

    response = authed_client.put("/api/settings", json={"theme": "purple"})
    assert response.status_code == 422


def test_get_settings_backfills_a_row_for_every_key(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, role=UserRole.RETAIL)
    assert db_session.query(AppSetting).count() == 0

    response = authed_client.get("/api/settings")
    assert response.status_code == 200
    assert response.json() == DEFAULT_SETTINGS_RESPONSE

    saved = {row.key: row.value for row in db_session.query(AppSetting).all()}
    assert saved == DEFAULT_SETTINGS

    # Calling it again is idempotent — no duplicate-key error, same rows.
    response = authed_client.get("/api/settings")
    assert response.status_code == 200
    assert db_session.query(AppSetting).count() == len(DEFAULT_SETTINGS)
