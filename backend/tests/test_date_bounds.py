from datetime import date
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.daily_cost import DailyCostRecord
from app.retail.models.purchase import Purchase
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.product import Product
from app.retail.models.zero_selling import ZeroSellingRecord
from app.retail.models.import_batch import ImportBatch, ImportType, ImportBatchStatus


def _setup_admin(db: Session) -> User:
    user = User(
        id="test-user-id",
        name="Admin",
        email="test@example.com",
        role=UserRole.ADMIN,
    )
    db.add(user)
    db.flush()
    return user


def test_sales_and_purchase_and_overview_date_bounds(
    authed_client: TestClient, db_session: Session
):
    _setup_admin(db_session)
    b1 = Branch(id="b1", name="Branch One", phone_number="0911111111", address="Addr 1")
    b2 = Branch(id="b2", name="Branch Two", phone_number="0922222222", address="Addr 2")
    db_session.add_all([b1, b2])

    p = Product(id="p1", stock_code="CODE1", description="Desc")
    db_session.add(p)

    batch = ImportBatch(id="batch1", import_type=ImportType.SALES, status=ImportBatchStatus.COMPLETED)
    db_session.add(batch)

    s1 = Sale(
        id="s1",
        import_batch_id="batch1",
        branch_id="b1",
        sale_date=date(2024, 1, 10),
        slip_id="slp1",
        slip_number="SLIP1",
    )
    s2 = Sale(
        id="s2",
        import_batch_id="batch1",
        branch_id="b1",
        sale_date=date(2024, 1, 20),
        slip_id="slp2",
        slip_number="SLIP2",
    )
    s3 = Sale(
        id="s3",
        import_batch_id="batch1",
        branch_id="b2",
        sale_date=date(2024, 2, 5),
        slip_id="slp3",
        slip_number="SLIP3",
    )
    db_session.add_all([s1, s2, s3])

    sl1 = SaleLine(id="sl1", sale_id="s1", product_id="p1", line_id="L1", line_no=1, qty=Decimal("1"), amount=Decimal("100"))
    sl2 = SaleLine(id="sl2", sale_id="s2", product_id="p1", line_id="L2", line_no=1, qty=Decimal("1"), amount=Decimal("100"))
    sl3 = SaleLine(id="sl3", sale_id="s3", product_id="p1", line_id="L3", line_no=1, qty=Decimal("1"), amount=Decimal("100"))
    db_session.add_all([sl1, sl2, sl3])

    pur1 = Purchase(
        id="pur1",
        import_batch_id="batch1",
        branch_id="b1",
        purchase_date=date(2024, 3, 1),
    )
    pur2 = Purchase(
        id="pur2",
        import_batch_id="batch1",
        branch_id="b2",
        purchase_date=date(2024, 3, 15),
    )
    db_session.add_all([pur1, pur2])

    db_session.commit()

    # Sales global bounds
    res = authed_client.get("/api/sales/date-bounds").json()
    assert res == {"earliest_date": "2024-01-10", "latest_date": "2024-02-05"}

    # Sales branch b1 bounds
    res_b1 = authed_client.get("/api/sales/date-bounds?branch=Branch One").json()
    assert res_b1 == {"earliest_date": "2024-01-10", "latest_date": "2024-01-20"}

    # Purchases global bounds
    res_pur = authed_client.get("/api/purchases/date-bounds").json()
    assert res_pur == {"earliest_date": "2024-03-01", "latest_date": "2024-03-15"}

    # Purchases branch b2 bounds
    res_pur_b2 = authed_client.get("/api/purchases/date-bounds?branch=Branch Two").json()
    assert res_pur_b2 == {"earliest_date": "2024-03-15", "latest_date": "2024-03-15"}

    # Data overview bounds
    res_ov = authed_client.get("/api/data-overview/date-bounds?branch=Branch One").json()
    assert res_ov == {"earliest_date": "2024-01-10", "latest_date": "2024-01-20"}


def test_daily_costs_and_zero_selling_date_bounds(
    authed_client: TestClient, db_session: Session
):
    _setup_admin(db_session)
    batch = ImportBatch(id="batch2", import_type=ImportType.GENERAL, status=ImportBatchStatus.COMPLETED)
    db_session.add(batch)

    dc1 = DailyCostRecord(
        import_batch_id="batch2",
        cost_date=date(2024, 4, 1),
        branch="Branch One",
        usage="test",
        usage_total=Decimal("10"),
        digital_income="test",
        digital_income_total=Decimal("0"),
        return_items="none",
        return_total=Decimal("0"),
        capital_expenditure="none",
        capital_total=Decimal("0"),
        source_sheet="Sheet1",
    )
    dc2 = DailyCostRecord(
        import_batch_id="batch2",
        cost_date=date(2024, 4, 10),
        branch="Branch One",
        usage="test",
        usage_total=Decimal("15"),
        digital_income="test",
        digital_income_total=Decimal("0"),
        return_items="none",
        return_total=Decimal("0"),
        capital_expenditure="none",
        capital_total=Decimal("0"),
        source_sheet="Sheet2",
    )
    db_session.add_all([dc1, dc2])

    zs1 = ZeroSellingRecord(
        import_batch_id="batch2",
        sale_date=date(2024, 5, 2),
        sale_time="10:00",
        branch="Branch One",
        category="Cat",
        reason="Reason",
        source_sheet="Sheet1",
        source_row=1,
    )
    zs2 = ZeroSellingRecord(
        import_batch_id="batch2",
        sale_date=date(2024, 5, 12),
        sale_time="11:00",
        branch="Branch One",
        category="Cat",
        reason="Reason",
        source_sheet="Sheet1",
        source_row=2,
    )
    db_session.add_all([zs1, zs2])

    db_session.commit()

    # Daily costs
    res_dc = authed_client.get("/api/daily-costs/date-bounds?branch=Branch One").json()
    assert res_dc == {"earliest_date": "2024-04-01", "latest_date": "2024-04-10"}

    # Zero selling
    res_zs = authed_client.get("/api/zero-selling/date-bounds?branch=Branch One").json()
    assert res_zs == {"earliest_date": "2024-05-02", "latest_date": "2024-05-12"}

    # Zero selling conversion endpoint
    res_conv = authed_client.get("/api/zero-selling/conversion/date-bounds").json()
    assert res_conv == {"earliest_date": "2024-05-02", "latest_date": "2024-05-12"}
