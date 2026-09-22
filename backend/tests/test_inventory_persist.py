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
    assert "as of Aug 21, 2026, 7:07 PM" in summary["messages"][1]


def test_zero_quantity_rows_skipped_for_stock_levels_but_create_products(db_session: Session):
    mixed_df = pd.DataFrame(
        [
            {
                "StockCode": "POS-001",
                "Description": "Positive Item",
                "Location": "Branch A",
                "Group": "Lady",
                "On_Hand_Qty": 10.0,
                "Buying_Price": 1000.0,
                "Selling_Price": 1500.0,
            },
            {
                "StockCode": "ZERO-002",
                "Description": "Zero Stock Item",
                "Location": "Branch A",
                "Group": "Lady",
                "On_Hand_Qty": 0.0,
                "Buying_Price": 2000.0,
                "Selling_Price": 2500.0,
            },
            {
                "StockCode": "NEG-003",
                "Description": "Negative Stock Item",
                "Location": "Branch A",
                "Group": "Lady",
                "On_Hand_Qty": -3.0,
                "Buying_Price": 3000.0,
                "Selling_Price": 3500.0,
            },
        ]
    )

    summary = persist_inventory(
        db_session,
        mixed_df,
        branch_id=None,
        location_raw="Branch A",
        source_file="inventory.csv",
    )

    # All 3 products created in master product catalog
    assert summary["products_created"] == 3
    assert db_session.query(Product).count() == 3

    # Only 2 stock levels created (positive and negative, zero omitted)
    assert summary["stock_levels_created"] == 2
    assert summary["zero_stock_skipped"] == 1
    assert summary["negative_stock_count"] == 1
    assert db_session.query(StockLevel).count() == 2

    # Zero stock product exists in catalog but not in stock_levels
    zero_product = db_session.query(Product).filter(Product.stock_code == "ZERO-002").one()
    zero_levels = db_session.query(StockLevel).filter(StockLevel.product_id == zero_product.id).all()
    assert len(zero_levels) == 0

    # Negative stock product exists in both catalog and stock_levels
    neg_product = db_session.query(Product).filter(Product.stock_code == "NEG-003").one()
    neg_level = db_session.query(StockLevel).filter(StockLevel.product_id == neg_product.id).one()
    assert float(neg_level.on_hand_qty) == -3.0

    # Messages verify counts and alert
    assert any("3 total products in file" in msg for msg in summary["messages"])
    assert any("2 product stocks recorded" in msg for msg in summary["messages"])
    assert any("1 products with 0 stock" in msg for msg in summary["messages"])
    assert any("⚠️ Alert: 1 product recorded with invalid values" in msg for msg in summary["messages"])
