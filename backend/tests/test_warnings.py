import datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.import_batch import ImportBatch, ImportType
from app.models.product import Product
from app.models.purchase import Purchase, PurchaseLine
from app.models.sale import Sale, SaleLine
from app.models.stock_level import StockLevel
from app.models.user import User, UserRole
from app.services import data_quality


def _make_branch_and_user(db_session: Session, name: str = "Retail 1") -> tuple[Branch, User]:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    user = User(
        id=f"user-{name}",
        name="Tester",
        email=f"{name.lower().replace(' ', '-')}@example.com",
        role=UserRole.RETAIL,
        branch_id=branch.id,
    )
    db_session.add(user)
    db_session.commit()
    return branch, user


def _make_product(db_session: Session, stock_code: str, description: str = "Widget") -> Product:
    product = Product(stock_code=stock_code, description=description)
    db_session.add(product)
    db_session.flush()
    return product


def _make_sale_line(db_session: Session, *, branch: Branch, product: Product, slip_id: str, qty, sale_date) -> None:
    sale = Sale(branch_id=branch.id, slip_id=slip_id, slip_number=slip_id, sale_date=sale_date)
    db_session.add(sale)
    db_session.flush()
    db_session.add(
        SaleLine(
            sale_id=sale.id,
            line_id=f"{slip_id}-01",
            line_no=1,
            product_id=product.id,
            selling_price=1000,
            qty=qty,
            uom="Each",
            discount_amount=0,
            amount=1000,
            net_amount=1000,
        )
    )


def _make_purchase_line(
    db_session: Session, *, branch: Branch, product: Product, qty, purchase_date
) -> None:
    purchase = Purchase(branch_id=branch.id, purchase_date=purchase_date)
    db_session.add(purchase)
    db_session.flush()
    db_session.add(
        PurchaseLine(purchase_id=purchase.id, product_id=product.id, quantity=qty, buying_price=100, uom="Each")
    )


def test_sale_numeric_warning_flags_zero_qty(db_session: Session):
    branch, user = _make_branch_and_user(db_session)
    product = _make_product(db_session, "SKU-1")
    _make_sale_line(
        db_session, branch=branch, product=product, slip_id="slip-1", qty=0, sale_date=datetime.date(2026, 8, 20)
    )
    db_session.commit()

    rows = data_quality.sale_numeric_warnings(db_session, user)
    assert len(rows) == 1
    assert "Quantity" in rows[0]["note"]
    assert "0" in rows[0]["note"]  # names the actual bad value, not just the rule
    assert rows[0]["highlight"] == ["Qty"]
    assert {"Stock Code", "Branch"} <= {f["label"] for f in rows[0]["fields"]}
    assert rows[0]["source_import"] is None  # this sale line wasn't linked to an import batch


def test_sale_numeric_warning_points_at_its_source_import(db_session: Session):
    branch, user = _make_branch_and_user(db_session)
    product = _make_product(db_session, "SKU-1d")
    batch = ImportBatch(import_type=ImportType.SALES, branch_id=branch.id, filename="sale.csv")
    db_session.add(batch)
    db_session.flush()

    sale = Sale(
        branch_id=branch.id,
        slip_id="slip-1d",
        slip_number="slip-1d",
        sale_date=datetime.date(2026, 8, 20),
        import_batch_id=batch.id,
    )
    db_session.add(sale)
    db_session.flush()
    db_session.add(
        SaleLine(
            sale_id=sale.id,
            line_id="slip-1d-01",
            line_no=1,
            product_id=product.id,
            selling_price=1000,
            qty=0,
            uom="Each",
            discount_amount=0,
            amount=1000,
            net_amount=1000,
        )
    )
    db_session.commit()

    rows = data_quality.sale_numeric_warnings(db_session, user)
    assert len(rows) == 1
    assert rows[0]["source_import"] == {"id": batch.id, "filename": "sale.csv", "date": batch.created_at.isoformat()}


def test_sale_numeric_warning_respects_since_window(db_session: Session):
    branch, user = _make_branch_and_user(db_session)
    product = _make_product(db_session, "SKU-1b")
    _make_sale_line(
        db_session, branch=branch, product=product, slip_id="slip-1b", qty=0, sale_date=datetime.date(2026, 8, 1)
    )
    db_session.commit()

    assert data_quality.sale_numeric_warnings(db_session, user) != []
    assert data_quality.sale_numeric_warnings(db_session, user, since=datetime.date(2026, 8, 20)) == []
    assert data_quality.sale_numeric_warnings(db_session, user, since=datetime.date(2026, 8, 1)) != []


def test_purchase_numeric_warning_respects_since_window(db_session: Session):
    branch, user = _make_branch_and_user(db_session)
    product = _make_product(db_session, "SKU-1c")
    _make_purchase_line(
        db_session, branch=branch, product=product, qty=-1, purchase_date=datetime.date(2026, 8, 1)
    )
    db_session.commit()

    assert data_quality.purchase_numeric_warnings(db_session, user) != []
    assert data_quality.purchase_numeric_warnings(db_session, user, since=datetime.date(2026, 8, 20)) == []
    assert data_quality.purchase_numeric_warnings(db_session, user, since=datetime.date(2026, 8, 1)) != []


def test_sale_missing_product_in_inventory(db_session: Session):
    branch, user = _make_branch_and_user(db_session)
    product = _make_product(db_session, "SKU-2")
    _make_sale_line(
        db_session, branch=branch, product=product, slip_id="slip-2", qty=2, sale_date=datetime.date(2026, 8, 20)
    )
    db_session.commit()

    rows = data_quality.sale_missing_product_warnings(db_session, user)
    assert len(rows) == 1
    # The note is a standalone action — the row's own fields carry the identity.
    assert "inventory system" in rows[0]["note"]
    assert {"label": "Stock Code", "value": "SKU-2"} in rows[0]["fields"]
    assert rows[0]["highlight"] == []  # an absence, not a bad value — nothing to highlight
    assert rows[0]["source_import"] is None  # can span several imports — no single batch to point at


def test_sale_missing_product_not_flagged_when_inventory_exists(db_session: Session):
    branch, user = _make_branch_and_user(db_session)
    product = _make_product(db_session, "SKU-3")
    _make_sale_line(
        db_session, branch=branch, product=product, slip_id="slip-3", qty=2, sale_date=datetime.date(2026, 8, 20)
    )
    db_session.add(StockLevel(branch_id=branch.id, product_id=product.id, on_hand_qty=5))
    db_session.commit()

    assert data_quality.sale_missing_product_warnings(db_session, user) == []


def test_purchase_missing_product_in_inventory(db_session: Session):
    branch, user = _make_branch_and_user(db_session)
    product = _make_product(db_session, "SKU-6")
    _make_purchase_line(
        db_session, branch=branch, product=product, qty=4, purchase_date=datetime.date(2026, 8, 20)
    )
    db_session.commit()

    rows = data_quality.purchase_missing_product_warnings(db_session, user)
    assert len(rows) == 1
    assert "inventory system" in rows[0]["note"]
    assert {"label": "Stock Code", "value": "SKU-6"} in rows[0]["fields"]


def test_reconciliation_flags_mismatch(db_session: Session):
    branch, user = _make_branch_and_user(db_session)
    product = _make_product(db_session, "SKU-4")

    db_session.add(
        StockLevel(
            branch_id=branch.id,
            product_id=product.id,
            on_hand_qty=10,
            snapshot_at=datetime.datetime(2026, 8, 1, 8, 0, 0),
        )
    )
    db_session.flush()
    _make_purchase_line(
        db_session, branch=branch, product=product, qty=5, purchase_date=datetime.date(2026, 8, 2)
    )
    _make_sale_line(
        db_session, branch=branch, product=product, slip_id="slip-4", qty=3, sale_date=datetime.date(2026, 8, 2)
    )
    # Expected = 10 prior + 5 purchased - 3 sold = 12, but the imported inventory says 20.
    db_session.add(
        StockLevel(
            branch_id=branch.id,
            product_id=product.id,
            on_hand_qty=20,
            snapshot_at=datetime.datetime(2026, 8, 2, 8, 0, 0),
        )
    )
    db_session.commit()

    mismatches, uom_notices = data_quality.inventory_reconciliation_warnings(db_session, user)
    assert len(mismatches) == 1
    assert "20" in mismatches[0]["note"]  # actual
    assert "12" in mismatches[0]["note"]  # expected
    assert {"label": "Stock Code", "value": "SKU-4"} in mismatches[0]["fields"]
    assert mismatches[0]["highlight"] == ["Expected Qty", "Actual Qty", "Difference"]
    assert {"label": "Until", "value": "2026-08-02"} in mismatches[0]["fields"]
    assert uom_notices == []


def test_reconciliation_silent_when_correct(db_session: Session):
    branch, user = _make_branch_and_user(db_session)
    product = _make_product(db_session, "SKU-5")

    db_session.add(
        StockLevel(
            branch_id=branch.id,
            product_id=product.id,
            on_hand_qty=10,
            snapshot_at=datetime.datetime(2026, 8, 1, 8, 0, 0),
        )
    )
    db_session.flush()
    _make_purchase_line(
        db_session, branch=branch, product=product, qty=5, purchase_date=datetime.date(2026, 8, 2)
    )
    _make_sale_line(
        db_session, branch=branch, product=product, slip_id="slip-5", qty=3, sale_date=datetime.date(2026, 8, 2)
    )
    # Expected = 10 + 5 - 3 = 12, and the imported inventory correctly says 12.
    db_session.add(
        StockLevel(
            branch_id=branch.id,
            product_id=product.id,
            on_hand_qty=12,
            snapshot_at=datetime.datetime(2026, 8, 2, 8, 0, 0),
        )
    )
    db_session.commit()

    mismatches, _ = data_quality.inventory_reconciliation_warnings(db_session, user)
    assert mismatches == []


def test_reconciliation_flags_uom_mismatch(db_session: Session):
    branch, user = _make_branch_and_user(db_session)
    product = _make_product(db_session, "SKU-7")

    db_session.add(
        StockLevel(
            branch_id=branch.id,
            product_id=product.id,
            on_hand_qty=10,
            snapshot_at=datetime.datetime(2026, 8, 1, 8, 0, 0),
        )
    )
    db_session.flush()
    _make_purchase_line(
        db_session, branch=branch, product=product, qty=5, purchase_date=datetime.date(2026, 8, 2)
    )
    # Override the sale line's UOM to something inconsistent with the purchase's "Each".
    sale = Sale(branch_id=branch.id, slip_id="slip-7", slip_number="slip-7", sale_date=datetime.date(2026, 8, 2))
    db_session.add(sale)
    db_session.flush()
    db_session.add(
        SaleLine(
            sale_id=sale.id,
            line_id="slip-7-01",
            line_no=1,
            product_id=product.id,
            selling_price=1000,
            qty=3,
            uom="Box",
            discount_amount=0,
            amount=1000,
            net_amount=1000,
        )
    )
    db_session.add(
        StockLevel(
            branch_id=branch.id,
            product_id=product.id,
            on_hand_qty=12,
            snapshot_at=datetime.datetime(2026, 8, 2, 8, 0, 0),
        )
    )
    db_session.commit()

    _, uom_notices = data_quality.inventory_reconciliation_warnings(db_session, user)
    assert len(uom_notices) == 1
    assert "Box" in uom_notices[0]["note"]
    assert {"label": "Stock Code", "value": "SKU-7"} in uom_notices[0]["fields"]
    assert uom_notices[0]["highlight"] == ["Units Seen"]


def test_warnings_endpoint_returns_all_sections(authed_client: TestClient, db_session: Session):
    branch = Branch(name="Retail 1", phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    db_session.add(
        User(
            id="test-user-id",
            name="Tester",
            email="test@example.com",
            role=UserRole.RETAIL,
            branch_id=branch.id,
        )
    )
    db_session.commit()

    response = authed_client.get("/api/warnings")
    assert response.status_code == 200
    body = response.json()
    section_ids = {s["id"] for s in body["sections"]}
    assert section_ids == {
        "sale_numeric",
        "inventory_numeric",
        "purchase_numeric",
        "sale_missing_product",
        "purchase_missing_product",
        "reconciliation_uom",
        "reconciliation_mismatch",
    }
    assert all(s["rows"] == [] for s in body["sections"])
