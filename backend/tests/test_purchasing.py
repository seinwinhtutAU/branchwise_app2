import datetime as dt
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.models.user import User, UserRole
from app.retail.services.purchasing import get_purchasing_recommendations


def _make_admin_user(db_session: Session) -> None:
    db_session.add(
        User(
            id="admin-user-id",
            name="Admin User",
            email="admin@example.com",
            role=UserRole.ADMIN,
            branch_id=None,
        )
    )
    db_session.commit()


def test_purchasing_recommendations_logic(db_session: Session):
    branch = Branch(name="Ashley", phone_number="123", address="Main Road")
    db_session.add(branch)
    db_session.flush()

    # Product 1: Top seller, but 0 stock -> Urgent Reorder
    p1 = Product(id="prod-1", stock_code="CODE-A1", description="High Seller Shoes")
    # Product 2: Moderate seller, low stock -> Reorder
    p2 = Product(id="prod-2", stock_code="CODE-B1", description="Mid Seller Shoes")
    # Product 3: No sales -> Review / Do Not Reorder
    p3 = Product(id="prod-3", stock_code="CODE-N1", description="No Sales Item")

    db_session.add_all([p1, p2, p3])
    db_session.flush()

    now = dt.datetime(2026, 9, 1, 10, 0, 0)
    db_session.add_all(
        [
            StockLevel(
                branch_id=branch.id,
                product_id=p1.id,
                on_hand_qty=0,
                selling_price=50000,
                snapshot_at=now,
            ),
            StockLevel(
                branch_id=branch.id,
                product_id=p2.id,
                on_hand_qty=2,
                selling_price=20000,
                snapshot_at=now,
            ),
            StockLevel(
                branch_id=branch.id,
                product_id=p3.id,
                on_hand_qty=10,
                selling_price=10000,
                snapshot_at=now,
            ),
        ]
    )
    db_session.flush()

    # Create Sales over 2 months: 2026-07-01 to 2026-09-01
    sale_1 = Sale(branch_id=branch.id, slip_id="SLIP-01", slip_number="01", sale_date=dt.date(2026, 7, 1))
    sale_2 = Sale(branch_id=branch.id, slip_id="SLIP-02", slip_number="02", sale_date=dt.date(2026, 9, 1))
    db_session.add_all([sale_1, sale_2])
    db_session.flush()

    db_session.add_all(
        [
            # p1: 100 units * 50,000 = 5,000,000 net amount (> 80% total revenue)
            SaleLine(sale_id=sale_1.id, line_id="L1", line_no=1, product_id=p1.id, qty=100, net_amount=5000000),
            # p2: 10 units * 20,000 = 200,000 net amount
            SaleLine(sale_id=sale_2.id, line_id="L2", line_no=1, product_id=p2.id, qty=10, net_amount=200000),
        ]
    )
    db_session.flush()

    # Create Purchase for p1
    purchase_1 = Purchase(branch_id=branch.id, purchase_date=dt.date(2026, 9, 2))
    db_session.add(purchase_1)
    db_session.flush()
    db_session.add(PurchaseLine(purchase_id=purchase_1.id, product_id=p1.id, quantity=50))
    db_session.commit()

    result = get_purchasing_recommendations(db_session, branch.id, target_months=3)
    summary = result["summary"]
    rows = result["rows"]

    assert summary["total_products"] == 3
    assert summary["urgent_reorder_count"] == 1
    assert summary["reorder_count"] == 1
    assert summary["review_count"] == 1
    assert summary["total_suggested_units"] > 0

    by_code = {r["StockCode"]: r for r in rows}
    assert by_code["CODE-A1"]["Recommendation"] == "Urgent Reorder"
    assert by_code["CODE-A1"]["ABC_Class"] == "A"
    assert by_code["CODE-A1"]["PurchaseNote"] == "Recent Purchase Exists"
    assert by_code["CODE-A1"]["RecentPurchaseQty"] == 50.0

    assert by_code["CODE-B1"]["Recommendation"] == "Reorder"
    assert by_code["CODE-B1"]["ABC_Class"] in ("A", "B", "C")

    assert by_code["CODE-N1"]["Recommendation"] == "Review / Do Not Reorder"
    assert by_code["CODE-N1"]["ABC_Class"] == "N"
    assert by_code["CODE-N1"]["SuggestedReorderQty"] == 0


def test_purchasing_api_endpoints(authed_client: TestClient, db_session: Session):
    db_session.add(
        User(
            id="test-user-id",
            name="Admin User",
            email="test@example.com",
            role=UserRole.ADMIN,
        )
    )
    branch = Branch(name="Ashley", phone_number="123", address="Main Road")
    db_session.add(branch)
    db_session.flush()

    p = Product(id="prod-api-1", stock_code="API-01", description="Test Shoes")
    db_session.add(p)
    db_session.flush()

    now = dt.datetime(2026, 9, 1, 10, 0, 0)
    db_session.add(
        StockLevel(
            branch_id=branch.id,
            product_id=p.id,
            on_hand_qty=0,
            selling_price=15000,
            snapshot_at=now,
        )
    )
    db_session.commit()

    # Query recommendations endpoint
    res = authed_client.get(f"/api/purchasing/recommendations?branch_id={branch.id}&target_months=3")
    assert res.status_code == 200
    data = res.json()
    assert "summary" in data
    assert "rows" in data
    assert data["total"] == 1
    assert data["rows"][0]["StockCode"] == "API-01"

    # Query CSV export endpoint
    export_res = authed_client.get(f"/api/purchasing/export?branch_id={branch.id}&target_months=3&reorder_only=false")
    assert export_res.status_code == 200
    assert "text/csv" in export_res.headers["content-type"]
    assert "StockCode" in export_res.text
    assert "API-01" in export_res.text
