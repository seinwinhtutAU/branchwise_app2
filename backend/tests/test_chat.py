import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.user import User, UserRole
from app.retail.routers import chat as chat_router
from app.retail.services.chat import ChatNotConfigured


def _make_user(db_session: Session, *, role: UserRole) -> None:
    db_session.add(
        User(id="test-user-id", name="Test User", email="test@example.com", role=role)
    )
    db_session.commit()


def test_wholesale_account_is_forbidden(authed_client: TestClient, db_session: Session):
    _make_user(db_session, role=UserRole.WHOLESALE)

    response = authed_client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "hi"}]}
    )
    assert response.status_code == 403


def test_last_message_must_be_from_user(authed_client: TestClient, db_session: Session):
    _make_user(db_session, role=UserRole.RETAIL)

    response = authed_client.post(
        "/api/chat",
        json={"messages": [{"role": "assistant", "content": "hi"}]},
    )
    assert response.status_code == 400


def test_returns_agent_reply(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session, role=UserRole.RETAIL)
    monkeypatch.setattr(chat_router, "run_chat", lambda db, user, history: "42 units sold today.")

    response = authed_client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "how much did we sell today?"}]},
    )
    assert response.status_code == 200
    assert response.json() == {"reply": "42 units sold today."}


def test_missing_openai_key_returns_500(
    authed_client: TestClient, db_session: Session, monkeypatch: pytest.MonkeyPatch
):
    _make_user(db_session, role=UserRole.RETAIL)

    def _raise(db, user, history):
        raise ChatNotConfigured("OPENAI_API_KEY is not configured on the backend")

    monkeypatch.setattr(chat_router, "run_chat", _raise)

    response = authed_client.post(
        "/api/chat", json={"messages": [{"role": "user", "content": "hi"}]}
    )
    assert response.status_code == 500
