import datetime

import pandas as pd
from sqlalchemy.orm import Session

from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.services.purchase_persist import persist_purchases

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
    assert db_session.query(Purchase).one().purchase_date == datetime.date.today()


def test_purchase_date_override_is_used_instead_of_today(db_session: Session):
    summary = persist_purchases(
        db_session,
        PURCHASE_DF,
        branch_id=None,
        location_raw="Aung Thit Sar",
        source_file="purchase.csv",
        purchase_date=datetime.date(2026, 1, 15),
    )
    purchase = db_session.query(Purchase).filter(Purchase.id == summary["purchase_id"]).one()
    assert purchase.purchase_date == datetime.date(2026, 1, 15)


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


def test_purchase_number_is_persisted(db_session: Session):
    summary = persist_purchases(
        db_session,
        PURCHASE_DF,
        branch_id=None,
        location_raw="Aung Thit Sar",
        source_file="STR-000067-purchase-bogyoke-19-9-26.xlsx",
        purchase_number="STR-000067",
        purchase_date=datetime.date(2026, 9, 19),
    )
    purchase = db_session.query(Purchase).filter(Purchase.id == summary["purchase_id"]).one()
    assert purchase.purchase_number == "STR-000067"
    assert purchase.purchase_date == datetime.date(2026, 9, 19)
