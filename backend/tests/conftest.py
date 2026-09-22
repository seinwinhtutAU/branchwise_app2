import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.security import CurrentUser, get_current_user
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.services import response_cache

# Force-import all models so their tables register on Base.metadata before create_all.
from app.models import *  # noqa: F401,F403


@pytest.fixture(autouse=True)
def _clear_response_cache():
    """response_cache is a module-level dict, so it outlives any one test's db_session —
    without this, a cache key that happened to collide across tests (or a test that
    checks a request is served from cache) could see another test's entry instead of a
    clean one."""
    response_cache.clear()
    yield
    response_cache.clear()


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db_session: Session) -> TestClient:
    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def authed_client(client: TestClient) -> TestClient:
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        id="test-user-id", email="test@example.com"
    )
    try:
        yield client
    finally:
        app.dependency_overrides.pop(get_current_user, None)
