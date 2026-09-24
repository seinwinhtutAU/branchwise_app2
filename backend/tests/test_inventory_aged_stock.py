import datetime
from datetime import date, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.stock_level import StockLevel


def test_aged_stock_lists_every_aged_product_oldest_first(
    authed_client: TestClient, db_session: Session
):
    branch = Branch(id="br1", name="Ashley", phone_number="1", address="x")
    db_session.add(branch)
    db_session.add(
        User(
            id="test-user-id", name="T", email="t@example.com",
            role=UserRole.RETAIL, branch_id=branch.id,
        )
    )
    today = date.today()
    snapshot_at = datetime.datetime.now()
    # Seven aged products (more than the alert's five-row shortlist) and one recent one.
    for i, days_ago in enumerate([200, 210, 220, 230, 240, 250, 260, 10]):
        product = Product(id=f"p{i}", stock_code=f"C{i}", description=f"Item {i}")
        db_session.add(product)
        db_session.flush()
        db_session.add(
            StockLevel(
                branch_id=branch.id, product_id=product.id, on_hand_qty=3, snapshot_at=snapshot_at
            )
        )
        db_session.add(
            Purchase(id=f"pu{i}", branch_id=branch.id, purchase_date=today - timedelta(days=days_ago))
        )
        db_session.flush()
        db_session.add(
            PurchaseLine(purchase_id=f"pu{i}", product_id=product.id, quantity=3, buying_price=100)
        )
    db_session.commit()

    body = authed_client.get("/api/inventory/aged-stock").json()
    assert body["total"] == 7
    assert [row["StockCode"] for row in body["rows"]][:2] == ["C6", "C5"]
    assert body["rows"][0]["Days_In_Stock"] == 260
    assert body["rows"][0]["Branch"] == "Ashley"
