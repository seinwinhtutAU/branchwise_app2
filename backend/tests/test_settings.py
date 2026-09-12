from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.app_settings import DEFAULT_SETTINGS, AppSetting
from app.models.user import User, UserRole
from app.services.settings import set_setting


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
    "branch_health_weights": {
        "sales": 0.25,
        "profit": 0.25,
        "inventory": 0.25,
        "customer": 0.15,
        "data_quality": 0.10,
    },
    "early_warning_thresholds": {
        "revenue_decline_normal_pct": -5.0,
        "revenue_decline_warning_pct": -10.0,
        "revenue_decline_critical_pct": -20.0,
        "low_margin_normal_pct": 15.0,
        "low_margin_warning_pct": 10.0,
        "low_margin_critical_pct": 5.0,
        "margin_slip_normal_pp": -1.0,
        "margin_slip_warning_pp": -3.0,
        "dead_stock_normal_share_pct": 5.0,
        "dead_stock_warning_share_pct": 10.0,
        "dead_stock_critical_share_pct": 25.0,
        "traffic_decline_warning_pct": -10.0,
    },
}


def test_theme_is_readable_without_signing_in(client: TestClient, db_session: Session):
    """The sign-in screen has to be painted before there is a token to send, so this one
    key — and only this one — is readable unauthenticated."""
    response = client.get("/api/settings/theme")
    assert response.status_code == 200
    assert response.json() == {"theme": "system"}

    set_setting(db_session, "theme", "dark")
    assert client.get("/api/settings/theme").json() == {"theme": "dark"}


def test_the_rest_of_the_settings_still_need_a_token(client: TestClient):
    """The theme route is the exception, not a hole: everything else stays behind auth."""
    assert client.get("/api/settings").status_code in (401, 403)


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
