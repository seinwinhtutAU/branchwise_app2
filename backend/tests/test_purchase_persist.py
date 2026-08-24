import pandas as pd
from sqlalchemy.orm import Session

from app.models.product import Product
from app.models.purchase import Purchase, PurchaseLine
from app.services.purchase_persist import persist_purchases

PURCHASE_DF = pd.DataFrame(
    [
        {
            "StockCode": "Crocs",
            "Description": "Crocs",
            "Location": "Aung Thit Sar",
            "Quantity": 6.0,
            "UOM": "Each",
            "Buying_Price": 20050.0,
        },
        {
            "StockCode": "e7214",
            "Description": "luofu",
            "Location": "Aung Thit Sar",
            "Quantity": 6.0,
            "UOM": "Each",
            "Buying_Price": 31700.0,
        },
    ]
)


def test_creates_purchase_header_and_lines(db_session: Session):
    summary = persist_purchases(
        db_session,
        PURCHASE_DF,
        branch_id=None,
        location_raw="Aung Thit Sar",
        source_file="purchase.csv",
    )
    assert summary["purchase_lines_created"] == 2
    assert summary["products_created"] == 2
    assert db_session.query(Purchase).count() == 1
    assert db_session.query(PurchaseLine).count() == 2


def test_reimporting_creates_a_new_batch_each_time(db_session: Session):
    """Known limitation: purchase.csv has no natural dedup key, so re-confirming
    the same file twice creates a second Purchase batch — documented behavior."""
    persist_purchases(
        db_session, PURCHASE_DF, branch_id=None, location_raw=None, source_file="purchase.csv"
    )
    persist_purchases(
        db_session, PURCHASE_DF, branch_id=None, location_raw=None, source_file="purchase.csv"
    )

    assert db_session.query(Purchase).count() == 2
    assert db_session.query(PurchaseLine).count() == 4
    assert db_session.query(Product).count() == 2
