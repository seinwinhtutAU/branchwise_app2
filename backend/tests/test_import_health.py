import datetime

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.import_batch import ImportBatch, ImportBatchStatus, ImportType
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.stock_level import StockLevel
from app.models.user import User, UserRole
from app.retail.services import import_health

TODAY = datetime.date(2026, 8, 30)


def _branch(db_session: Session, name: str = "Retail 1") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    return branch


def _user(db_session: Session, branch: Branch | None, role: UserRole = UserRole.RETAIL) -> User:
    user = User(
        id=f"user-{branch.id if branch else 'admin'}-{role.value}",
        name="Tester",
        email=f"{branch.id if branch else 'admin'}-{role.value}@example.com",
        role=role,
        branch_id=branch.id if branch else None,
    )
    db_session.add(user)
    db_session.flush()
    return user


def _batch(
    db_session: Session,
    *,
    branch: Branch,
    import_type: ImportType,
    summary: dict | None = None,
    created_at: datetime.datetime,
    filename: str = "file.csv",
) -> ImportBatch:
    batch = ImportBatch(
        import_type=import_type,
        branch_id=branch.id,
        filename=filename,
        status=ImportBatchStatus.COMPLETED,
        summary=summary or {},
        created_at=created_at,
    )
    db_session.add(batch)
    db_session.flush()
    return batch


def test_sales_skip_rate_flags_high_skip_but_not_normal(db_session: Session):
    branch = _branch(db_session)
    admin = _user(db_session, None, UserRole.ADMIN)

    flagged = _batch(
        db_session,
        branch=branch,
        import_type=ImportType.SALES,
        summary={"sales_created": 1942, "sales_skipped_duplicate": 1347},
        created_at=datetime.datetime(2026, 8, 22),
        filename="bad.csv",
    )
    _batch(
        db_session,
        branch=branch,
        import_type=ImportType.SALES,
        summary={"sales_created": 3301, "sales_skipped_duplicate": 0},
        created_at=datetime.datetime(2026, 8, 20),
        filename="normal.csv",
    )
    db_session.commit()

    rows = import_health.sales_skip_rate_reviews(db_session, admin, TODAY - datetime.timedelta(days=30))
    assert len(rows) == 1
    assert rows[0]["batch_id"] == flagged.id
    assert "1,347" in rows[0]["note"]


def test_sales_skip_rate_ignores_recovery_replay_batches(db_session: Session):
    branch = _branch(db_session)
    admin = _user(db_session, None, UserRole.ADMIN)
    _batch(
        db_session,
        branch=branch,
        import_type=ImportType.SALES,
        summary={"sales_created": 1347, "sales_skipped_duplicate": 1942},
        created_at=datetime.datetime(2026, 8, 30),
        filename="[recovery replay] Saledetailslipats4122026to2282026.csv",
    )
    db_session.commit()

    rows = import_health.sales_skip_rate_reviews(db_session, admin, TODAY - datetime.timedelta(days=30))
    assert rows == []


def test_sales_skip_rate_ignores_tiny_batches(db_session: Session):
    branch = _branch(db_session)
    admin = _user(db_session, None, UserRole.ADMIN)
    _batch(
        db_session,
        branch=branch,
        import_type=ImportType.SALES,
        summary={"sales_created": 5, "sales_skipped_duplicate": 1},
        created_at=datetime.datetime(2026, 8, 22),
    )
    db_session.commit()

    rows = import_health.sales_skip_rate_reviews(db_session, admin, TODAY - datetime.timedelta(days=30))
    assert rows == []


def test_purchase_duplicate_detects_matching_totals_same_branch(db_session: Session):
    branch = _branch(db_session, "Ashley")
    other_branch = _branch(db_session, "Retail 3")
    admin = _user(db_session, None, UserRole.ADMIN)
    product = Product(stock_code="X1", description="Widget")
    db_session.add(product)
    db_session.flush()

    def _purchase_batch(branch_, created_at, filename, amount):
        batch = _batch(
            db_session,
            branch=branch_,
            import_type=ImportType.PURCHASE,
            created_at=created_at,
            filename=filename,
        )
        purchase = Purchase(branch_id=branch_.id, import_batch_id=batch.id, purchase_date=created_at.date())
        db_session.add(purchase)
        db_session.flush()
        db_session.add(PurchaseLine(purchase_id=purchase.id, product_id=product.id, quantity=10, buying_price=amount / 10))
        db_session.flush()
        return batch

    original = _purchase_batch(branch, datetime.datetime(2026, 8, 19), "invoice_19.csv", 640000)
    duplicate = _purchase_batch(branch, datetime.datetime(2026, 8, 24), "invoice_24.csv", 640000)
    _purchase_batch(other_branch, datetime.datetime(2026, 8, 24), "invoice_other.csv", 640000)
    db_session.commit()

    rows = import_health.purchase_duplicate_reviews(db_session, admin, TODAY - datetime.timedelta(days=10))
    flagged_ids = {r["batch_id"] for r in rows}
    assert duplicate.id in flagged_ids
    assert original.id not in flagged_ids  # outside the requested window, only referenced as the match
    assert all(r["branch_id"] == branch.id for r in rows)


def test_inventory_anomaly_needs_baseline_history(db_session: Session):
    branch = _branch(db_session)
    admin = _user(db_session, None, UserRole.ADMIN)
    products = [Product(stock_code=f"P{i}", description="Widget") for i in range(20)]
    db_session.add_all(products)
    db_session.flush()

    def _inventory_batch(created_at, filename, product_count):
        batch = _batch(
            db_session, branch=branch, import_type=ImportType.INVENTORY, created_at=created_at, filename=filename
        )
        for product in products[:product_count]:
            db_session.add(StockLevel(branch_id=branch.id, import_batch_id=batch.id, product_id=product.id, on_hand_qty=5))
        db_session.flush()
        return batch

    # Only 2 prior batches — below INVENTORY_BASELINE_MIN_BATCHES, so nothing should flag yet.
    _inventory_batch(datetime.datetime(2026, 8, 10), "day1.csv", 18)
    _inventory_batch(datetime.datetime(2026, 8, 17), "day2.csv", 19)
    sparse = _inventory_batch(datetime.datetime(2026, 8, 24), "day3.csv", 3)
    db_session.commit()

    rows = import_health.inventory_anomaly_reviews(db_session, admin, TODAY - datetime.timedelta(days=30))
    assert rows == []  # not enough history to trust a baseline yet

    # Add one more prior batch so the sparse one has 3 predecessors (the minimum).
    _inventory_batch(datetime.datetime(2026, 8, 3), "day0.csv", 20)
    db_session.commit()

    rows = import_health.inventory_anomaly_reviews(db_session, admin, TODAY - datetime.timedelta(days=30))
    flagged_ids = {r["batch_id"] for r in rows}
    assert sparse.id in flagged_ids


def test_slip_total_mismatches_reads_stored_summary(db_session: Session):
    branch = _branch(db_session)
    admin = _user(db_session, None, UserRole.ADMIN)
    _batch(
        db_session,
        branch=branch,
        import_type=ImportType.SALES,
        created_at=datetime.datetime(2026, 8, 14),
        summary={
            "slip_subtotal_mismatches": [
                {
                    "SlipID": "20260214-088",
                    "SlipNumber": "88",
                    "Date": "2026-08-14",
                    "LineTotal": 124500.0,
                    "SubtotalOnSlip": 126500.0,
                    "Difference": -2000.0,
                }
            ]
        },
    )
    db_session.commit()

    rows = import_health.slip_total_mismatches(db_session, admin, TODAY - datetime.timedelta(days=30))
    assert len(rows) == 1
    assert rows[0]["slip_id"] == "20260214-088"
    assert rows[0]["difference"] == -2000.0


def test_dismiss_hides_batch_from_review_and_undismiss_restores_it(db_session: Session):
    branch = _branch(db_session)
    admin = _user(db_session, None, UserRole.ADMIN)
    flagged = _batch(
        db_session,
        branch=branch,
        import_type=ImportType.SALES,
        summary={"sales_created": 1942, "sales_skipped_duplicate": 1347},
        created_at=datetime.datetime(2026, 8, 22),
        filename="bad.csv",
    )
    db_session.commit()

    since = TODAY - datetime.timedelta(days=30)
    assert len(import_health.sales_skip_rate_reviews(db_session, admin, since)) == 1

    import_health.dismiss_batch(db_session, flagged.id, admin)
    assert import_health.sales_skip_rate_reviews(db_session, admin, since) == []
    assert flagged.health_dismissed_at is not None
    assert flagged.health_dismissed_by == admin.id

    import_health.undismiss_batch(db_session, flagged.id, admin)
    assert len(import_health.sales_skip_rate_reviews(db_session, admin, since)) == 1
    assert flagged.health_dismissed_at is None


def test_dismiss_respects_branch_scoping(db_session: Session):
    branch_a = _branch(db_session, "Ashley")
    branch_b = _branch(db_session, "AungThitSar")
    user_b = _user(db_session, branch_b)
    batch = _batch(
        db_session,
        branch=branch_a,
        import_type=ImportType.SALES,
        created_at=datetime.datetime(2026, 8, 22),
    )
    db_session.commit()

    with pytest.raises(HTTPException) as exc_info:
        import_health.dismiss_batch(db_session, batch.id, user_b)
    assert exc_info.value.status_code == 404


def test_build_import_health_counts_all_types(db_session: Session):
    branch = _branch(db_session)
    admin = _user(db_session, None, UserRole.ADMIN)
    now = datetime.datetime.now()
    _batch(db_session, branch=branch, import_type=ImportType.SALES, created_at=now - datetime.timedelta(days=3))
    _batch(db_session, branch=branch, import_type=ImportType.PURCHASE, created_at=now - datetime.timedelta(days=2))
    _batch(db_session, branch=branch, import_type=ImportType.INVENTORY, created_at=now - datetime.timedelta(days=1))
    db_session.commit()

    result = import_health.build_import_health(db_session, admin, days=30)
    assert result["batches_checked"] == 3
    assert result["batches_to_review"] == []
    assert result["slip_total_mismatches"] == []
