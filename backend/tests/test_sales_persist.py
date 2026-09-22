import pandas as pd
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.product import Product
from app.retail.models.sale import Sale, SaleLine
from app.retail.services.sales_persist import persist_sales

SALE_DF = pd.DataFrame(
    [
        {
            "Date": "2026-08-21",
            "SlipID": "20260821-002",
            "SlipNumber": "2",
            "LineNo": 1,
            "LineID": "20260821-002-01",
            "StockCode": "U16085",
            "Description": "Maldini",
            "Location": "Aung Thit Sar",
            "Selling_Price": 72500.0,
            "Qty": 1.0,
            "UOM": "Each",
            "Discount_Amount": 0.0,
            "Amount": 72500.0,
            "Net_Amount": 72500.0,
            "Time": "13:55:22",
        },
        {
            "Date": "2026-08-21",
            "SlipID": "20260821-002",
            "SlipNumber": "2",
            "LineNo": 2,
            "LineID": "20260821-002-02",
            "StockCode": "kknm",
            "Description": "Sunset",
            "Location": "Aung Thit Sar",
            "Selling_Price": 27000.0,
            "Qty": 1.0,
            "UOM": "Each",
            "Discount_Amount": 0.0,
            "Amount": 27000.0,
            "Net_Amount": 27000.0,
            "Time": "13:55:22",
        },
    ]
)


def test_creates_sale_header_and_lines(db_session: Session):
    summary = persist_sales(
        db_session, SALE_DF, branch_id=None, location_raw="Aung Thit Sar", source_file="sale.csv"
    )
    assert summary["batch_id"]
    del summary["batch_id"]
    assert summary == {
        "sales_created": 1,
        "sales_skipped_duplicate": 0,
        "sale_lines_created": 2,
        "products_created": 2,
        "products_updated": 0,
        "messages": ["2 total sale lines in file", "1 sales recorded (2 items)"],
    }

    sale = db_session.query(Sale).filter(Sale.slip_id == "20260821-002").one()
    assert len(sale.lines) == 2
    assert db_session.query(Product).count() == 2


def test_reimporting_same_slip_is_skipped(db_session: Session):
    persist_sales(db_session, SALE_DF, branch_id=None, location_raw=None, source_file="sale.csv")
    summary = persist_sales(
        db_session, SALE_DF, branch_id=None, location_raw=None, source_file="sale.csv"
    )

    assert summary["sales_created"] == 0
    assert summary["sales_skipped_duplicate"] == 1
    assert db_session.query(Sale).count() == 1
    assert db_session.query(SaleLine).count() == 2


def test_same_slip_id_from_a_different_branch_is_not_skipped(db_session: Session):
    """Different branches/POS terminals number their own slips independently, so the
    same SlipID (report date + slip number) can legitimately show up at two branches
    on the same day — that must not be treated as a re-import of the same sale."""
    branch_a = Branch(name="Branch A", phone_number="000", address="TBD")
    branch_b = Branch(name="Branch B", phone_number="000", address="TBD")
    db_session.add_all([branch_a, branch_b])
    db_session.flush()

    persist_sales(db_session, SALE_DF, branch_id=branch_a.id, location_raw=None, source_file="a.csv")
    summary = persist_sales(
        db_session, SALE_DF, branch_id=branch_b.id, location_raw=None, source_file="b.csv"
    )

    assert summary["sales_created"] == 1
    assert summary["sales_skipped_duplicate"] == 0
    assert db_session.query(Sale).filter(Sale.slip_id == "20260821-002").count() == 2


def test_product_upserted_not_duplicated_across_slips(db_session: Session):
    second_slip = SALE_DF.copy()
    second_slip["SlipID"] = "20260821-003"
    second_slip["SlipNumber"] = "3"
    second_slip["LineID"] = ["20260821-003-01", "20260821-003-02"]

    persist_sales(db_session, SALE_DF, branch_id=None, location_raw=None, source_file="a.csv")
    summary = persist_sales(
        db_session, second_slip, branch_id=None, location_raw=None, source_file="b.csv"
    )

    assert summary["sales_created"] == 1
    assert summary["products_created"] == 0
    assert summary["products_updated"] == 2
    assert db_session.query(Product).count() == 2
