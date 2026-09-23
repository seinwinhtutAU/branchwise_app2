import datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.import_batch import ImportBatch, ImportType
from app.services import response_cache


def _make_branch(db_session: Session, name: str = "Retail 1") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    return branch


def _make_import_batch(db_session: Session, branch: Branch, **kwargs) -> ImportBatch:
    batch = ImportBatch(
        import_type=ImportType.SALES,
        branch_id=branch.id,
        status="confirmed",
        summary={},
        **kwargs,
    )
    db_session.add(batch)
    db_session.flush()
    return batch


# --- cached() / clear() — pure in-memory behaviour, no DB involved -------------------


def test_cached_returns_stored_value_without_recomputing_for_the_same_key():
    calls = []

    def compute():
        calls.append(1)
        return "value"

    key = ("k", 1)
    assert response_cache.cached(key, compute) == "value"
    assert response_cache.cached(key, compute) == "value"
    assert len(calls) == 1


def test_cached_recomputes_for_a_different_key():
    calls = []

    def compute():
        calls.append(1)
        return len(calls)

    assert response_cache.cached(("a",), compute) == 1
    assert response_cache.cached(("b",), compute) == 2
    assert len(calls) == 2


def test_clear_forces_a_recompute():
    calls = []

    def compute():
        calls.append(1)
        return len(calls)

    key = ("k",)
    assert response_cache.cached(key, compute) == 1
    response_cache.clear()
    assert response_cache.cached(key, compute) == 2


# --- import_data_version() ------------------------------------------------------------


def test_import_data_version_changes_when_a_new_batch_is_created(db_session: Session):
    branch = _make_branch(db_session)
    db_session.commit()
    before = response_cache.import_data_version(db_session, branch.id)

    _make_import_batch(db_session, branch, created_at=datetime.datetime(2026, 1, 1))
    db_session.commit()
    after = response_cache.import_data_version(db_session, branch.id)

    assert before != after


def test_import_data_version_changes_when_a_batch_is_reverted(db_session: Session):
    branch = _make_branch(db_session)
    _make_import_batch(db_session, branch, created_at=datetime.datetime(2026, 1, 1))
    db_session.commit()
    before = response_cache.import_data_version(db_session, branch.id)

    batch2 = _make_import_batch(db_session, branch, created_at=datetime.datetime(2026, 1, 1))
    batch2.reverted_at = datetime.datetime(2026, 1, 2)
    db_session.commit()
    after = response_cache.import_data_version(db_session, branch.id)

    assert before != after


def test_import_data_version_is_scoped_per_branch(db_session: Session):
    branch_a = _make_branch(db_session, "A")
    branch_b = _make_branch(db_session, "B")
    db_session.commit()
    version_a_before = response_cache.import_data_version(db_session, branch_a.id)

    _make_import_batch(db_session, branch_b, created_at=datetime.datetime(2026, 1, 1))
    db_session.commit()

    # Another branch's import doesn't move this branch's version.
    assert response_cache.import_data_version(db_session, branch_a.id) == version_a_before


# --- GET /api/dashboard/overview is actually served from cache -----------------------


def test_overview_endpoint_is_not_recomputed_for_a_repeat_request(
    authed_client: TestClient, db_session: Session, monkeypatch
):
    branch = _make_branch(db_session)
    db_session.add(
        User(id="test-user-id", name="Tester", email="test@example.com", role=UserRole.RETAIL, branch_id=branch.id)
    )
    db_session.commit()

    calls = []
    from app.retail.services import branch_health as branch_health_service

    original = branch_health_service.build_overview_dashboard

    def counting(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(branch_health_service, "build_overview_dashboard", counting)

    first = authed_client.get("/api/dashboard/overview?period=30d")
    second = authed_client.get("/api/dashboard/overview?period=30d")

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    assert len(calls) == 1


def test_overview_endpoint_recomputes_after_a_new_import_for_that_branch(
    authed_client: TestClient, db_session: Session, monkeypatch
):
    branch = _make_branch(db_session)
    db_session.add(
        User(id="test-user-id", name="Tester", email="test@example.com", role=UserRole.RETAIL, branch_id=branch.id)
    )
    db_session.commit()

    calls = []
    from app.retail.services import branch_health as branch_health_service

    original = branch_health_service.build_overview_dashboard

    def counting(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(branch_health_service, "build_overview_dashboard", counting)

    authed_client.get("/api/dashboard/overview?period=30d")
    assert len(calls) == 1

    _make_import_batch(db_session, branch, created_at=datetime.datetime.now())
    db_session.commit()

    authed_client.get("/api/dashboard/overview?period=30d")
    assert len(calls) == 2


def test_overview_endpoint_recomputes_after_the_day_changes_with_no_new_import(
    authed_client: TestClient, db_session: Session, monkeypatch
):
    """A relative period ("today", "30d", ...) means something different once the
    calendar rolls over even with no new import — and Branch Health's Inventory
    dimension always reflects *today's* shelf regardless of which period is on screen
    (see branch_health.py's own note on this). import_data_version alone wouldn't catch
    that, so the cache key also carries date.today()."""
    branch = _make_branch(db_session)
    db_session.add(
        User(id="test-user-id", name="Tester", email="test@example.com", role=UserRole.RETAIL, branch_id=branch.id)
    )
    db_session.commit()

    calls = []
    from app.retail.services import branch_health as branch_health_service

    original = branch_health_service.build_overview_dashboard

    def counting(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(branch_health_service, "build_overview_dashboard", counting)

    class _FrozenDate(datetime.date):
        _frozen = datetime.date(2026, 1, 1)

        @classmethod
        def today(cls):
            return cls._frozen

    monkeypatch.setattr("app.retail.routers.dashboard.date", _FrozenDate)

    authed_client.get("/api/dashboard/overview?period=30d")
    assert len(calls) == 1
    authed_client.get("/api/dashboard/overview?period=30d")
    assert len(calls) == 1  # same day, still cached

    _FrozenDate._frozen = datetime.date(2026, 1, 2)
    authed_client.get("/api/dashboard/overview?period=30d")
    assert len(calls) == 2  # the day moved on — recomputed despite no new import


def test_overview_endpoint_does_not_share_cache_across_branches(
    authed_client: TestClient, db_session: Session
):
    branch_a = _make_branch(db_session, "A")
    branch_b = _make_branch(db_session, "B")
    db_session.add(
        User(id="test-user-id", name="Development", email="dev@example.com", role=UserRole.DEVELOPMENT)
    )
    db_session.commit()

    body_a = authed_client.get(f"/api/dashboard/overview?branch_id={branch_a.id}").json()
    body_b = authed_client.get(f"/api/dashboard/overview?branch_id={branch_b.id}").json()

    assert body_a["branch_id"] == branch_a.id
    assert body_b["branch_id"] == branch_b.id


# --- GET /api/warnings is served from cache too, and PUT /api/settings busts it ------


def test_warnings_endpoint_is_not_recomputed_for_a_repeat_request(
    authed_client: TestClient, db_session: Session, monkeypatch
):
    branch = _make_branch(db_session)
    db_session.add(
        User(id="test-user-id", name="Tester", email="test@example.com", role=UserRole.RETAIL, branch_id=branch.id)
    )
    db_session.commit()

    calls = []
    import app.retail.routers.warnings as warnings_router

    original = warnings_router.build_warning_sections

    def counting(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(warnings_router, "build_warning_sections", counting)

    authed_client.get("/api/warnings")
    authed_client.get("/api/warnings")

    assert len(calls) == 1


def test_settings_update_busts_the_response_cache(
    authed_client: TestClient, db_session: Session, monkeypatch
):
    branch = _make_branch(db_session)
    db_session.add(
        User(id="test-user-id", name="Development", email="dev@example.com", role=UserRole.DEVELOPMENT)
    )
    db_session.commit()

    calls = []
    from app.retail.services import branch_health as branch_health_service

    original = branch_health_service.build_overview_dashboard

    def counting(*args, **kwargs):
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(branch_health_service, "build_overview_dashboard", counting)

    authed_client.get(f"/api/dashboard/overview?branch_id={branch.id}")
    assert len(calls) == 1

    authed_client.put(
        "/api/settings",
        json={
            "branch_health_weights": {
                "sales": 0.5,
                "profit": 0.2,
                "inventory": 0.2,
                "customer": 0.05,
                "data_quality": 0.05,
            }
        },
    )

    authed_client.get(f"/api/dashboard/overview?branch_id={branch.id}")
    assert len(calls) == 2
