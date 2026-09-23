import io
from datetime import datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.core.timestamps import utc_now
from app.retail.models.import_batch import ImportBatch, ImportBatchStatus
from app.retail.models.sale import Sale, SaleLine
from app.retail.services import original_file_cache
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
    assert rows[0]["created_at"].endswith("Z")


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


def test_history_detail_returns_only_the_selected_tab_page(
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
    assert body["origin"]["rows"] == []

    original_response = authed_client.get(
        f"/api/imports/history/{batch_id}?tab=original"
    )
    assert original_response.status_code == 200
    assert len(original_response.json()["origin"]["rows"]) > 0


def test_download_clean_sales_returns_csv(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)

    response = authed_client.get(
        f"/api/imports/history/{summary['batch_id']}/download-clean"
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=\"sale_clean.csv\"" == response.headers[
        "content-disposition"
    ]
    csv_data = response.content.decode("utf-8-sig")
    assert "Date,Time,Slip_ID,StockCode" in csv_data
    assert "U16085" in csv_data


def test_general_file_is_stored_unchanged_and_retail_can_download_it(
    authed_client: TestClient, db_session: Session
):
    _make_user(db_session, branch_name="Retail 1")
    original_bytes = b"This is an original file, not retail data.\x00\xff"

    response = authed_client.post(
        "/api/imports/general",
        files={"file": ("notes.bin", io.BytesIO(original_bytes), "application/octet-stream")},
    )
    assert response.status_code == 200
    batch_id = response.json()["id"]

    batch = db_session.get(ImportBatch, batch_id)
    assert batch is not None
    assert batch.import_type.value == "general"
    # New uploads no longer write original_file to the database — R2 (mirrored in the
    # background right after confirm) is now the sole durability path, same as
    # sales/inventory/purchase; original_file stays populated only for pre-existing rows.
    assert batch.original_file is None
    assert batch.storage_key is not None

    history = authed_client.get("/api/imports/history").json()
    assert history[0]["has_file"] is True
    assert history[0]["import_type"] == "general"

    download = authed_client.get(f"/api/imports/history/{batch_id}/download")
    assert download.status_code == 200
    assert download.content == original_bytes
    assert download.headers["content-type"].startswith("application/octet-stream")


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

    response = authed_client.get(f"/api/imports/history/{batch_id}?tab=original")
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
        {"created_at": utc_now() - timedelta(hours=23)}
    )
    db_session.commit()

    response = authed_client.post(f"/api/imports/history/{batch_id}/revert")
    assert response.status_code == 200


def test_retail_cannot_revert_after_one_day(authed_client: TestClient, db_session: Session):
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    db_session.query(ImportBatch).filter(ImportBatch.id == batch_id).update(
        {"created_at": utc_now() - timedelta(days=1, minutes=1)}
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
        {"created_at": utc_now() - timedelta(days=30)}
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


def test_history_detail_clean_tab_ignores_storage_entirely(
    authed_client: TestClient, db_session: Session, monkeypatch
):
    """The Clean tab is reconstructed live from the persisted SaleLine/Sale/Product
    rows (see clean_rows.py) — it must show the real data even when storage returns
    nothing at all, proving it never depends on R2."""
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]

    class MockStorage:
        is_configured = True

        def download_file_bytes(self, key: str):
            return None

    monkeypatch.setattr("app.retail.routers.imports.get_storage_service", lambda: MockStorage())

    response = authed_client.get(f"/api/imports/history/{batch_id}")
    assert response.status_code == 200
    data = response.json()
    assert data["clean"]["rows"][0]["StockCode"] == "U16085"
    assert data["origin"]["rows"] == []


def test_original_tab_returns_empty_when_r2_has_no_file_for_this_batch(
    authed_client: TestClient, db_session: Session, monkeypatch
):
    """No DB fallback is left for the Original tab (preview_data is gone) — if R2 has
    nothing under this batch's storage_key, the tab is simply empty rather than 404ing
    or reconstructing anything."""
    _make_user(db_session, branch_name="Retail 1")
    summary = _confirm_sale(authed_client)
    batch_id = summary["batch_id"]
    original_file_cache._path(batch_id).unlink(missing_ok=True)

    class MockStorage:
        is_configured = True

        def download_file_bytes(self, key: str):
            return None

    monkeypatch.setattr("app.retail.routers.imports.get_storage_service", lambda: MockStorage())

    response = authed_client.get(f"/api/imports/history/{batch_id}?tab=original")
    assert response.status_code == 200
    data = response.json()
    assert data["origin"]["rows"] == []

    warnings = authed_client.get(
        f"/api/imports/history/{batch_id}/warnings?tab=original"
    )
    assert warnings.status_code == 200
    assert warnings.json()["indices"] == []


PURCHASE_CSV = (
    "Stock Code,Description,Location,Bin,Quantity,UOM,Unit Cost\r\n"
    "Crocs,Crocs,Aung Thit Sar,,6,Each,20050\r\n"
)


def test_download_clean_purchase_returns_csv(
    authed_client: TestClient, db_session: Session
):
    """download-clean's purchase branch used to reference PurchaseLine.qty/
    total_amount, neither of which exists on that model (only quantity/uom/
    buying_price do) — this 500'd on any real purchase batch and had no coverage.
    clean_rows.py fixed it; this pins the corrected shape down."""
    _make_user(db_session, branch_name="Retail 1")
    response = authed_client.post(
        "/api/imports/purchase/confirm",
        files={"file": ("purchase.csv", io.BytesIO(PURCHASE_CSV.encode()), "text/csv")},
    )
    assert response.status_code == 200
    batch_id = response.json()["batch_id"]

    download = authed_client.get(f"/api/imports/history/{batch_id}/download-clean")
    assert download.status_code == 200
    csv_data = download.content.decode("utf-8-sig")
    assert "StockCode,Description,Quantity,UOM,Buying_Price" in csv_data
    assert "Crocs" in csv_data


def test_original_tab_is_served_from_the_local_copy_kept_at_confirm(
    authed_client: TestClient, db_session: Session, monkeypatch
):
    """Confirm keeps a local copy of the file, so the Original tab never has to pull
    it back from R2 — even when R2 has nothing at all."""
    _make_user(db_session, branch_name="Retail 1")
    batch_id = _confirm_sale(authed_client)["batch_id"]
    assert original_file_cache.load(batch_id) == SALE_CSV.encode()

    class MockStorage:
        is_configured = True

        def download_file_bytes(self, key: str):
            raise AssertionError("R2 should not be touched when the local copy exists")

    monkeypatch.setattr("app.retail.routers.imports.get_storage_service", lambda: MockStorage())

    response = authed_client.get(f"/api/imports/history/{batch_id}?tab=original")
    assert response.status_code == 200
    assert len(response.json()["origin"]["rows"]) > 0
