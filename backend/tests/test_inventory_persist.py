import datetime as dt

import pandas as pd
from sqlalchemy.orm import Session

from app.retail.models.product import Product
from app.retail.models.stock_level import StockLevel
from app.retail.services.inventory_persist import persist_inventory

INVENTORY_DF = pd.DataFrame(
    [
        {
            "StockCode": "020-724000A",
            "Description": "Fashion",
            "Location": "Aung Thit Sar",
            "Group": "Lady",
            "On_Hand_Qty": 4.0,
            "Buying_Price": 25400.0,
            "Selling_Price": 34500.0,
        },
        {
            "StockCode": "05119-743500A",
            "Description": "LiLy",
            "Location": "Aung Thit Sar",
            "Group": "Lady",
            "On_Hand_Qty": 5.0,
            "Buying_Price": 34800.0,
            "Selling_Price": 43500.0,
        },
    ]
)


def test_creates_stock_level_snapshots(db_session: Session):
    summary = persist_inventory(
        db_session,
        INVENTORY_DF,
        branch_id=None,
        location_raw="Aung Thit Sar",
        source_file="inventory.csv",
    )
    assert summary["stock_levels_created"] == 2
    assert summary["products_created"] == 2
    assert db_session.query(StockLevel).count() == 2

    product = db_session.query(Product).filter(Product.stock_code == "020-724000A").one()
    assert product.group_name == "Lady"


def test_reimporting_accumulates_snapshots(db_session: Session):
    """Inventory keeps full history — two imports of overlapping products means
    two StockLevel rows each, not an overwrite."""
    persist_inventory(
        db_session, INVENTORY_DF, branch_id=None, location_raw=None, source_file="a.csv"
    )
    persist_inventory(
        db_session, INVENTORY_DF, branch_id=None, location_raw=None, source_file="b.csv"
    )

    assert db_session.query(StockLevel).count() == 4
    assert db_session.query(Product).count() == 2


def test_snapshot_at_uses_printed_date_from_report(db_session: Session):
    df = INVENTORY_DF.copy()
    df.attrs["printed_at"] = dt.datetime(2026, 8, 21, 19, 7, 11)

    summary = persist_inventory(
        db_session, df, branch_id=None, location_raw=None, source_file="inventory.csv"
    )

    levels = db_session.query(StockLevel).all()
    assert all(level.snapshot_at == dt.datetime(2026, 8, 21, 19, 7, 11) for level in levels)
    assert "as of Aug 21, 2026, 7:07 PM" in summary["messages"][0]
