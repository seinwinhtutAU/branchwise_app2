import io
import json
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.import_batch import ImportBatch, ImportBatchStatus
from app.retail.models.sale import Sale, SaleLine
from app.models.user import User, UserRole

SALE_CSV = (
    "﻿Printed : 8/21/2026  7:10:05PM,Aung Thit Sar,,,,,,,,,,\r\n"
    "Other Code,Stock Code,Description,Location,Price,Qty,UOM,Discount Amount,Amount,Net Amount,,\r\n"
    "Date,:,8/21/2026,,,,,,,,,\r\n"
    "Slip Number,:,2,Time,:,13:55:22,Counter,:,Counter1,UserID,:,Admin\r\n"
    ',U16085,Maldini,Aung Thit Sar,"72,500.00",1.00,Each,0.00,"72,500.00","72,500.00",,\r\n'
    '1.00,0.00,"72,500.00","72,500.00",,,,,,,,\r\n'
)


def _make_user(db_session: Session, *, branch_name: str | None) -> Branch | None:
    branch = None
    if branch_name is not None:
        branch = Branch(name=branch_name, phone_number="000", address="TBD")
        db_session.add(branch)
        db_session.flush()

    db_session.add(
        User(
            id="test-user-id",
            name="Test User",
            email="test@example.com",
            role=UserRole.RETAIL if branch else UserRole.ADMIN,
            branch_id=branch.id if branch else None,
        )
    )
    db_session.commit()
    return branch


def _confirm_sale(authed_client: TestClient) -> dict:
    response = authed_client.post(
        "/api/imports/sales/confirm",
        files={"file": ("sale.csv", io.BytesIO(SALE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    return response.json()


def test_confirm_creates_linked_batch(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)

    batch = db_session.get(ImportBatch, summary["batch_id"])
    assert batch is not None
    assert batch.status == ImportBatchStatus.COMPLETED
    assert batch.summary["sales_created"] == 1

    sale = db_session.query(Sale).one()
    assert sale.import_batch_id == batch.id


def test_history_lists_own_branch_only(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    _confirm_sale(authed_client)

    response = authed_client.get("/api/imports/history")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    assert rows[0]["import_type"] == "sales"
    assert rows[0]["branch_name"] == "Retail 1"
    assert rows[0]["status"] == "completed"


def test_admin_sees_all_branches(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    _confirm_sale(authed_client)

    # swap the same account to admin (no branch) to check the "see everything" path
    db_session.query(User).filter(User.id == "test-user-id").update(
        {"branch_id": None, "role": UserRole.ADMIN}
    )
    db_session.commit()

    response = authed_client.get("/api/imports/history")
    assert len(response.json()) == 1


def test_history_detail_returns_origin_and_clean_data(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    response = authed_client.get(f"/api/imports/history/{batch_id}")
    assert response.status_code == 200
    body = response.json()
    assert body["import_type"] == "sales"
    assert body["summary"]["sales_created"] == 1
    assert body["clean"]["columns"]
    assert len(body["clean"]["rows"]) == 1
    assert body["clean"]["rows"][0]["StockCode"] == "U16085"
    assert len(body["origin"]["rows"]) > 0


def test_history_detail_unknown_batch_404(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    response = authed_client.get("/api/imports/history/does-not-exist")
    assert response.status_code == 404


def test_history_detail_other_branch_404(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    other_branch = Branch(name="Retail 2", phone_number="000", address="TBD")
    db_session.add(other_branch)
    db_session.flush()
    db_session.query(User).filter(User.id == "test-user-id").update(
        {"branch_id": other_branch.id}
    )
    db_session.commit()

    response = authed_client.get(f"/api/imports/history/{batch_id}")
    assert response.status_code == 404


def test_revert_deletes_data_but_keeps_batch(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    response = authed_client.post(f"/api/imports/history/{batch_id}/revert")
    assert response.status_code == 200
    assert response.json()["status"] == "reverted"

    assert db_session.query(Sale).count() == 0
    assert db_session.query(SaleLine).count() == 0

    batch = db_session.get(ImportBatch, batch_id)
    assert batch is not None
    assert batch.status == ImportBatchStatus.REVERTED
    assert batch.reverted_at is not None
    assert batch.reverted_by == "test-user-id"


def test_revert_with_replaced_marks_reimported(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    response = authed_client.post(f"/api/imports/history/{batch_id}/revert?replaced=true")
    assert response.status_code == 200
    assert response.json()["status"] == "reimported"

    batch = db_session.get(ImportBatch, batch_id)
    assert batch is not None
    assert batch.status == ImportBatchStatus.REIMPORTED


def test_revert_after_reimported_conflicts(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    authed_client.post(f"/api/imports/history/{batch_id}/revert?replaced=true")
    response = authed_client.post(f"/api/imports/history/{batch_id}/revert")
    assert response.status_code == 409


def test_revert_twice_conflicts(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    authed_client.post(f"/api/imports/history/{batch_id}/revert")
    response = authed_client.post(f"/api/imports/history/{batch_id}/revert")
    assert response.status_code == 409


def test_revert_unknown_batch_404(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    response = authed_client.post("/api/imports/history/does-not-exist/revert")
    assert response.status_code == 404


def test_non_admin_cannot_revert_other_branch_batch(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    # move the same account to a different branch — it should no longer see/revert this batch
    other_branch = Branch(name="Retail 2", phone_number="000", address="TBD")
    db_session.add(other_branch)
    db_session.flush()
    db_session.query(User).filter(User.id == "test-user-id").update(
        {"branch_id": other_branch.id}
    )
    db_session.commit()

    list_response = authed_client.get("/api/imports/history")
    assert list_response.json() == []

    revert_response = authed_client.post(f"/api/imports/history/{batch_id}/revert")
    assert revert_response.status_code == 404


def test_retail_can_revert_within_one_day(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    db_session.query(ImportBatch).filter(ImportBatch.id == batch_id).update(
        {"created_at": datetime.now() - timedelta(hours=23)}
    )
    db_session.commit()

    response = authed_client.post(f"/api/imports/history/{batch_id}/revert")
    assert response.status_code == 200


def test_retail_cannot_revert_after_one_day(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    db_session.query(ImportBatch).filter(ImportBatch.id == batch_id).update(
        {"created_at": datetime.now() - timedelta(days=1, minutes=1)}
    )
    db_session.commit()

    response = authed_client.post(f"/api/imports/history/{batch_id}/revert")
    assert response.status_code == 403

    batch = db_session.get(ImportBatch, batch_id)
    assert batch.status == ImportBatchStatus.COMPLETED


def test_admin_can_revert_after_one_day(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    db_session.query(ImportBatch).filter(ImportBatch.id == batch_id).update(
        {"created_at": datetime.now() - timedelta(days=30)}
    )
    db_session.query(User).filter(User.id == "test-user-id").update(
        {"branch_id": None, "role": UserRole.ADMIN}
    )
    db_session.commit()

    response = authed_client.post(f"/api/imports/history/{batch_id}/revert")
    assert response.status_code == 200


def test_reverted_slip_can_be_reimported(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    authed_client.post(f"/api/imports/history/{batch_id}/revert")

    second = _confirm_sale(authed_client)
    assert second["sales_created"] == 1
    assert second["sales_skipped_duplicate"] == 0


# --- the cache's cross-account staleness probe ----------------------------------------


def test_data_version_moves_when_an_import_is_confirmed(
    authed_client: TestClient, db_session: Session
):
    """The frontend caches the dashboard and Warning pages and polls this to find out
    when *someone else* changed the data. If the token didn't move on a confirm, every
    other account would keep showing stale numbers."""
    _make_user(db_session, branch_name="Ashley")

    before = authed_client.get("/api/imports/data-version").json()["version"]
    _confirm_sale(authed_client)
    after = authed_client.get("/api/imports/data-version").json()["version"]

    assert before != after
    # Stable when nothing has happened — otherwise every poll would invalidate the cache.
    assert authed_client.get("/api/imports/data-version").json()["version"] == after


def test_data_version_moves_when_an_import_is_reverted(
    authed_client: TestClient, db_session: Session
):
    """A revert deletes rows without creating a batch, so the newest-created timestamp
    alone would not move — which is why reverted_at is in the token too."""
    _make_user(db_session, branch_name="Ashley")
    batch_id = _confirm_sale(authed_client)["batch_id"]

    before = authed_client.get("/api/imports/data-version").json()["version"]
    assert authed_client.post(f"/api/imports/history/{batch_id}/revert").status_code == 200
    assert authed_client.get("/api/imports/data-version").json()["version"] != before


def test_data_version_is_scoped_to_the_branch_the_account_can_see(
    authed_client: TestClient, db_session: Session
):
    """A branch account shouldn't refetch its dashboard because another branch imported
    something it can't even see."""
    branch = _make_user(db_session, branch_name="Ashley")
    assert branch is not None
    other = Branch(name="AungThitSar", phone_number="000", address="TBD")
    db_session.add(other)
    db_session.flush()

    before = authed_client.get("/api/imports/data-version").json()["version"]
    db_session.add(
        ImportBatch(
            import_type="sales",
            branch_id=other.id,
            filename="someone-elses.csv",
            status=ImportBatchStatus.COMPLETED,
            summary={},
            preview_data={},
            created_at=datetime.now(),
        )
    )
    db_session.commit()

    assert authed_client.get("/api/imports/data-version").json()["version"] == before


def test_download_file_admin_allowed(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    # Swap account to admin
    db_session.query(User).filter(User.id == "test-user-id").update(
        {"branch_id": None, "role": UserRole.ADMIN}
    )
    db_session.commit()

    response = authed_client.get(f"/api/imports/history/{batch_id}/download")
    assert response.status_code == 200
    assert "attachment" in response.headers.get("Content-Disposition", "")


def test_download_file_retail_forbidden(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")  # Retail role
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    response = authed_client.get(f"/api/imports/history/{batch_id}/download")
    assert response.status_code == 403
    assert "Only administrators can download" in response.json()["detail"]


def test_get_history_detail_prefers_r2_preview_data(
    authed_client: TestClient, db_session: Session, monkeypatch
):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    # Mock storage service to return custom R2 preview data
    class MockStorage:
        is_configured = True

        def download_file_bytes(self, key: str):
            if key == f"imports/{batch_id}/preview_data.json":
                r2_content = json.dumps({
                    "origin": {"rows": [{"Source": "Cloudflare R2"}]},
                    "clean": {"columns": ["Source"], "rows": [{"Source": "Cloudflare R2"}]}
                }).encode("utf-8")
                return r2_content, "application/json"
            return None

    monkeypatch.setattr("app.retail.routers.imports.get_storage_service", lambda: MockStorage())

    response = authed_client.get(f"/api/imports/history/{batch_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["origin"]["rows"] == [{"Source": "Cloudflare R2"}]
    assert data["clean"]["rows"] == [{"Source": "Cloudflare R2"}]


def test_get_history_detail_falls_back_to_db_when_r2_missing(
    authed_client: TestClient, db_session: Session, monkeypatch
):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    # Mock storage where preview_data.json is missing
    class MockStorage:
        is_configured = True

        def download_file_bytes(self, key: str):
            return None

    monkeypatch.setattr("app.retail.routers.imports.get_storage_service", lambda: MockStorage())

    response = authed_client.get(f"/api/imports/history/{batch_id}")
    assert response.status_code == 200
    data = response.json()
    # Should fall back to DB origin data
    assert len(data["origin"]["rows"]) > 0
    assert data["origin"]["rows"][0][0].startswith("Printed :")



