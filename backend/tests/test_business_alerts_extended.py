import datetime
from datetime import date, datetime as dt, time
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.retail.models.product import Product
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.services import early_warning
from app.retail.services.branch_health import (
    BranchSnapshot,
    _check_daily_import_status,
)


def _base_snapshot(**overrides) -> BranchSnapshot:
    base = dict(
        date_from="2026-08-09",
        date_to="2026-09-07",
        previous_date_from="2026-07-10",
        previous_date_to="2026-08-08",
        net_revenue=110_000.0,
        previous_net_revenue=100_000.0,
        transaction_count=110,
        previous_transaction_count=100,
        avg_basket=1000.0,
        previous_avg_basket=1000.0,
        estimated_cogs=77_000.0,
        previous_estimated_cogs=70_000.0,
        gross_margin_pct=30.0,
        previous_gross_margin_pct=30.0,
        cost_coverage_pct=100.0,
        previous_cost_coverage_pct=100.0,
        sku_count=100,
        critical_count=0,
        low_count=0,
        watch_count=0,
        dead_stock_count=0,
        estimated_stock_value=77_000.0,
        days_of_inventory_on_hand=30.0,
        stock_as_of="2026-09-07T00:00:00",
        at_risk_count=0,
        at_risk_demand_driven_count=0,
        at_risk_leading_item=None,
        at_risk_top_items=(),
        avg_items_per_basket=3.0,
        previous_avg_items_per_basket=3.0,
        single_item_basket_share_pct=20.0,
        previous_single_item_basket_share_pct=20.0,
        trading_days=30,
        previous_trading_days=30,
        products_sold=120,
        previous_products_sold=120,
        data_issue_count=0,
        critical_data_issue_count=0,
        data_issue_sections=(),
        records_checked=1000,
        period_days=30,
        has_today_sales=True,
        has_today_inventory=True,
        is_after_8pm=False,
        daily_check_cutoff_time="20:00",
        stock_allocations=(),
        urgent_reorders=(),
        aged_footwear=(),
        seasonal_spikes=(),
        weekly_pattern=None,
    )
    base.update(overrides)
    return BranchSnapshot(**base)


# ---------------------------------------------------------------------------
# Rule 1: Daily Import Missing Check (Critical)
# ---------------------------------------------------------------------------


def test_daily_import_no_alert_before_8pm():
    """Before 8:00 PM, no alert should fire even if today's imports have not arrived yet."""
    snap = _base_snapshot(
        is_after_8pm=False,
        has_today_sales=False,
        has_today_inventory=False,
    )
    alerts = early_warning.evaluate(snap)
    assert not any(a.id.startswith("daily_import_missing") for a in alerts)


def test_daily_import_fires_critical_after_8pm_when_both_missing():
    """After 8:00 PM, if neither sales nor inventory was imported today, fire one
    critical alert per missing type — they're two separate imports, not one problem."""
    snap = _base_snapshot(
        is_after_8pm=True,
        has_today_sales=False,
        has_today_inventory=False,
    )
    alerts = early_warning.evaluate(snap)
    sales_alert = next(a for a in alerts if a.id == "daily_import_missing_sales")
    inventory_alert = next(a for a in alerts if a.id == "daily_import_missing_inventory")
    assert sales_alert.severity == early_warning.CRITICAL
    assert sales_alert.dimension == "sales"
    assert sales_alert.title == "Today's sales data is missing or out of date"
    assert sales_alert.link == "import"
    assert inventory_alert.severity == early_warning.CRITICAL
    assert inventory_alert.dimension == "inventory"
    assert inventory_alert.title == "Today's inventory data is missing or out of date"
    assert inventory_alert.link == "import"


def test_daily_import_fires_critical_after_8pm_when_only_sales_missing():
    snap = _base_snapshot(
        is_after_8pm=True,
        has_today_sales=False,
        has_today_inventory=True,
    )
    alerts = early_warning.evaluate(snap)
    assert not any(a.id == "daily_import_missing_inventory" for a in alerts)
    alert = next(a for a in alerts if a.id == "daily_import_missing_sales")
    assert alert.severity == early_warning.CRITICAL
    assert alert.dimension == "sales"
    assert "sales" in alert.title.lower()
    assert "inventory" not in alert.title.lower()


def test_daily_import_fires_critical_after_8pm_when_only_inventory_missing():
    snap = _base_snapshot(
        is_after_8pm=True,
        has_today_sales=True,
        has_today_inventory=False,
    )
    alerts = early_warning.evaluate(snap)
    assert not any(a.id == "daily_import_missing_sales" for a in alerts)
    alert = next(a for a in alerts if a.id == "daily_import_missing_inventory")
    assert alert.severity == early_warning.CRITICAL
    assert alert.dimension == "inventory"
    assert "inventory" in alert.title.lower()
    assert "sales" not in alert.title.lower()


def test_daily_import_clears_when_both_today_imports_present():
    snap = _base_snapshot(
        is_after_8pm=True,
        has_today_sales=True,
        has_today_inventory=True,
    )
    alerts = early_warning.evaluate(snap)
    assert not any(a.id.startswith("daily_import_missing") for a in alerts)


def test_daily_import_alert_identifies_data_uploaded_for_an_older_day():
    snap = _base_snapshot(
        is_after_8pm=True,
        has_today_sales=False,
        has_today_inventory=False,
        sales_data_date="2026-09-20",
        inventory_data_date="2026-09-19",
    )

    alerts = early_warning.evaluate(snap)
    sales_alert = next(a for a in alerts if a.id == "daily_import_missing_sales")
    inventory_alert = next(a for a in alerts if a.id == "daily_import_missing_inventory")
    sales_facts = {fact["label"]: fact["value"] for fact in sales_alert.facts}
    inventory_facts = {fact["label"]: fact["value"] for fact in inventory_alert.facts}
    assert sales_facts["Sale Day"] == "2026-09-20 (not today)"
    assert inventory_facts["Inventory Day"] == "2026-09-19 (not today)"


def test_purchase_number_sequence_gap_fires_critical_alert():
    snap = _base_snapshot(
        purchase_number_integrity={
            "numbered_purchase_count": 2,
            "gap_count": 1,
            "missing_number_count": 61,
            "gaps": [
                {
                    "start_number": "STR00050",
                    "end_number": "STR00110",
                    "missing_count": 61,
                }
            ],
        }
    )

    alert = next(
        alert
        for alert in early_warning.evaluate(snap)
        if alert.id == "purchase_number_sequence_gap"
    )
    assert alert.severity == early_warning.CRITICAL
    assert alert.link == "import"
    assert "STR00050–STR00110" in alert.what_happened


# ---------------------------------------------------------------------------
# Rule 2: Physical Stock Audit Alert on Inventory Data Quality
# ---------------------------------------------------------------------------


def test_physical_stock_audit_quiet_when_no_data_issues():
    snap = _base_snapshot(data_issue_count=0)
    alerts = early_warning.evaluate(snap)
    assert not any(a.id == "physical_stock_audit" for a in alerts)


def test_physical_stock_audit_fires_when_data_issues_exist():
    # Locked status when before 8pm
    snap_locked = _base_snapshot(
        data_issue_count=5,
        critical_data_issue_count=2,
        is_after_8pm=False,
        has_today_sales=True,
        has_today_inventory=True,
    )
    alerts = early_warning.evaluate(snap_locked)
    alert = next(a for a in alerts if a.id == "physical_stock_audit")
    assert alert.severity == early_warning.WARNING
    assert alert.link == "checking"
    status_facts = {fact["label"]: fact["value"] for fact in alert.facts}
    assert "locked" in status_facts["Audit Sheet Status"].lower()

    # Ready status when after 8pm and imports complete
    snap_ready = _base_snapshot(
        data_issue_count=5,
        critical_data_issue_count=2,
        is_after_8pm=True,
        has_today_sales=True,
        has_today_inventory=True,
    )
    alerts_ready = early_warning.evaluate(snap_ready)
    alert_ready = next(a for a in alerts_ready if a.id == "physical_stock_audit")
    ready_facts = {fact["label"]: fact["value"] for fact in alert_ready.facts}
    assert "ready" in ready_facts["Audit Sheet Status"].lower()


# ---------------------------------------------------------------------------
# Rule 3: Inter-Branch Stock Allocation (Dead Stock 90d)
# ---------------------------------------------------------------------------


def test_stock_allocation_alert_fires_with_table():
    allocations = (
        {
            "stock_code": "SH-001",
            "description": "Leather Oxford",
            "on_hand_qty": 25,
            "target_branch_id": "br_02",
            "target_branch_name": "Downtown Branch",
            "target_sales_90d": 40,
            "recommended_transfer_qty": 15,
        },
    )
    snap = _base_snapshot(stock_allocations=allocations)
    alerts = early_warning.evaluate(snap)
    alert = next(a for a in alerts if a.id == "stock_allocation")
    assert alert.severity == early_warning.WARNING
    assert alert.link == "inventory"
    assert alert.table is not None
    assert len(alert.table["rows"]) == 1
    assert "SH-001" in alert.table["rows"][0][0]
    assert "Downtown Branch" in alert.table["rows"][0][2]


# ---------------------------------------------------------------------------
# Rule 4: Urgent Reorder Alert (Critical)
# ---------------------------------------------------------------------------


def test_urgent_reorder_alert_fires_with_table():
    reorders = (
        {
            "stock_code": "SNK-01",
            "description": "Air Runner Pro",
            "on_hand_qty": 2,
            "daily_velocity": 1.5,
            "days_left": 1.3,
            "recommended_reorder_qty": 30,
        },
    )
    snap = _base_snapshot(urgent_reorders=reorders)
    alerts = early_warning.evaluate(snap)
    alert = next(a for a in alerts if a.id == "urgent_reorder")
    assert alert.severity == early_warning.CRITICAL
    assert alert.dimension == "reorder"
    assert alert.link == "inventory"
    assert "SNK-01" in alert.table["rows"][0][0]


# ---------------------------------------------------------------------------
# Rule 5: Footwear Aging > 6 Months (180 days)
# ---------------------------------------------------------------------------


def test_footwear_aging_alert_fires_with_purchase_labels():
    aged = (
        {
            "stock_code": "BOOT-99",
            "description": "Winter Hiking Boot",
            "on_hand_qty": 12,
            "purchase_date": "2026-01-10",
            "batch_label": "Purchased: Batch #PO-2026-001 · 10 Jan 2026",
            "age_days": 240,
        },
    )
    snap = _base_snapshot(aged_footwear=aged)
    alerts = early_warning.evaluate(snap)
    alert = next(a for a in alerts if a.id == "footwear_aging")
    assert alert.severity == early_warning.WARNING
    assert alert.link == "inventory"
    assert "BOOT-99" in alert.table["rows"][0][0]
    assert "PO-2026-001" in alert.table["rows"][0][3]
    assert "240 days" in alert.table["rows"][0][2]


# ---------------------------------------------------------------------------
# Rule 6: Seasonal Demand Spike Alert
# ---------------------------------------------------------------------------


def test_seasonal_spike_alert():
    spikes = (
        {
            "stock_code": "SAN-10",
            "description": "Summer Sandal",
            "month_name": "October",
            "prior_year_qty": 120,
        },
    )
    snap = _base_snapshot(seasonal_spikes=spikes)
    alerts = early_warning.evaluate(snap)
    alert = next(a for a in alerts if a.id == "seasonal_demand_spike")
    assert alert.severity == early_warning.NORMAL
    assert alert.link == "revenue"
    assert "SAN-10" in alert.table["rows"][0][0]


# ---------------------------------------------------------------------------
# Rule 7: Weekly Pattern Demand Alert
# ---------------------------------------------------------------------------


def test_weekly_pattern_alert():
    pattern = {
        "peak_day": "Saturday",
        "weekend_share_pct": 42.5,
        "peak_day_qty": 65,
        "weekday_avg_qty": 22.0,
    }
    snap = _base_snapshot(weekly_pattern=pattern)
    alerts = early_warning.evaluate(snap)
    alert = next(a for a in alerts if a.id == "weekly_pattern_demand")
    assert alert.severity == early_warning.NORMAL
    assert alert.link == "customer"
    assert "Saturday" in alert.what_happened
    assert alert.title == "Saturday is your busiest sales day"


# ---------------------------------------------------------------------------
# Database & Checking API Endpoints Integration Test
# ---------------------------------------------------------------------------


def test_checking_api_status_and_export(db_session: Session, authed_client: TestClient):
    # Setup test branch
    branch = Branch(
        id="test_br_01", name="Test Branch", phone_number="123456", address="Main St"
    )
    db_session.add(branch)

    # Setup admin user
    user = User(
        id="test-user-id",
        name="Admin User",
        email="test@example.com",
        role=UserRole.DEVELOPMENT,
        auth_user_id="test-user-id",
        branch_id="test_br_01",
    )
    db_session.add(user)

    # Setup product
    prod = Product(
        id="prod_01",
        stock_code="TEST-SKU-01",
        description="Test Shoe Description",
        group_name="Footwear",
    )
    db_session.add(prod)
    db_session.flush()

    # Setup stock level with negative quantity (triggers inventory_negative discrepancy)
    stock = StockLevel(
        branch_id="test_br_01",
        product_id=prod.id,
        on_hand_qty=-5.0,
        snapshot_at=dt.now(),
    )
    db_session.add(stock)
    db_session.commit()

    mock_items = [
        {
            "stock_code": "TEST-SKU-01",
            "description": "Test Shoe Description",
            "on_hand_qty": 15.0,
        }
    ]

    with patch(
        "app.retail.routers.checking.build_checking_items", return_value=mock_items
    ):
        # 1. Query checking status when locked (< 8pm or imports missing)
        with patch(
            "app.retail.routers.checking._check_daily_import_status",
            return_value=(False, False, False),
        ):
            res = authed_client.get("/api/checking")
            assert res.status_code == 200
            data = res.json()
            assert "items" in data
            assert data["is_eligible"] is False
            assert data["items"] == []
            assert "Audit sheet unlocks" in data["reason"]

        # 2. Query checking status when eligible (after 8pm and imports present)
        with patch(
            "app.retail.routers.checking._check_daily_import_status",
            return_value=(True, True, True),
        ):
            res = authed_client.get("/api/checking")
            assert res.status_code == 200
            data = res.json()
            assert data["is_eligible"] is True
            assert len(data["items"]) == 1
            assert data["items"][0]["stock_code"] == "TEST-SKU-01"

        # 3. Test export CSV: when locked (< 8pm or imports missing), should return 400
        with patch(
            "app.retail.routers.checking._check_daily_import_status",
            return_value=(False, False, False),
        ):
            res_locked = authed_client.get("/api/checking/export")
            assert res_locked.status_code == 400

        # 4. Test export CSV: when unlocked (after 8pm and imports present), should return CSV
        with patch(
            "app.retail.routers.checking._check_daily_import_status",
            return_value=(True, True, True),
        ):
            res_csv = authed_client.get("/api/checking/export")
            assert res_csv.status_code == 200
            assert res_csv.headers["content-type"].startswith("text/csv")
            csv_text = res_csv.text
            assert "Stock Code" in csv_text
            assert "TEST-SKU-01" in csv_text

        # 5. Test verify endpoint: should verify correctly when snapshot has TEST-SKU-01
        res_verify = authed_client.get("/api/checking/verify")
        assert res_verify.status_code == 200
        v_data = res_verify.json()
        assert v_data["success"] is True
        assert v_data["missing_stock_codes"] == []


def test_custom_daily_check_cutoff_time_formats_in_alerts_and_checking(
    db_session: Session, authed_client: TestClient
):
    """Verify that changing daily_check_cutoff_time changes alert copy and checking locking messages."""
    branch = Branch(
        id="test_br_02",
        name="Cutoff Test Branch",
        phone_number="123456",
        address="Main St",
    )
    db_session.add(branch)

    user = User(
        id="test-user-id",
        name="Admin User",
        email="test@example.com",
        role=UserRole.DEVELOPMENT,
        auth_user_id="test-user-id",
        branch_id="test_br_02",
    )
    db_session.add(user)
    db_session.commit()

    # 1. Test alert rule with custom cutoff time "19:00"
    snap = _base_snapshot(
        has_today_sales=False,
        has_today_inventory=False,
        is_after_8pm=True,
        daily_check_cutoff_time="19:00",
    )
    alerts = early_warning.evaluate(snap)
    import_alerts = [a for a in alerts if a.id.startswith("daily_import_missing")]
    assert len(import_alerts) == 2
    assert all("7:00 PM" in alert.summary for alert in import_alerts)

    # 2. Update app_settings with custom cutoff time 21:30
    res_update = authed_client.put(
        "/api/settings",
        json={"daily_check_cutoff_time": "21:30"},
    )
    assert res_update.status_code == 200
    assert res_update.json()["daily_check_cutoff_time"] == "21:30"

    # 3. Checking status endpoint reflects new cutoff time and 9:30 PM in reason when locked
    with patch(
        "app.retail.routers.checking._check_daily_import_status",
        return_value=(False, False, False),
    ):
        res = authed_client.get("/api/checking")
        assert res.status_code == 200
        data = res.json()
        assert data["cutoff_time"] == "21:30"
        assert data["formatted_cutoff_time"] == "9:30 PM"
        assert "9:30 PM" in data["reason"]

    # 4. Checking export reflects new cutoff time when locked
    with patch(
        "app.retail.routers.checking._check_daily_import_status",
        return_value=(False, False, False),
    ):
        res_exp = authed_client.get("/api/checking/export")
        assert res_exp.status_code == 400
        assert "9:30 PM" in res_exp.json()["detail"]


# ---------------------------------------------------------------------------
# Rule 15 & 16: Sale & Purchase Data Quality Alerts (Critical)
# ---------------------------------------------------------------------------


def test_sale_data_quality_fires_critical_on_negative_or_zero_values():
    """Flags critical alert when sale lines have zero/negative/invalid quantities or prices."""
    snap = _base_snapshot(
        sale_data_quality_issues={
            "invalid_numeric_count": 3,
            "missing_description_count": 0,
            "total_issues": 3,
        }
    )
    alerts = early_warning.evaluate(snap)
    alert = next(a for a in alerts if a.id == "sale_data_quality")
    assert alert.severity == early_warning.CRITICAL
    assert alert.dimension == "data_quality"
    assert alert.title == "Sales data needs attention"
    assert "3 with zero/negative/invalid numbers" in alert.summary
    assert alert.link == "warnings"


def test_sale_data_quality_fires_critical_on_missing_description():
    """Flags critical alert when sale products have missing or blank descriptions."""
    snap = _base_snapshot(
        sale_data_quality_issues={
            "invalid_numeric_count": 0,
            "missing_description_count": 2,
            "total_issues": 2,
        }
    )
    alerts = early_warning.evaluate(snap)
    alert = next(a for a in alerts if a.id == "sale_data_quality")
    assert alert.severity == early_warning.CRITICAL
    assert "2 with missing description" in alert.summary


def test_sale_data_quality_clears_when_clean():
    """No alert fires when sale transactions are clean."""
    snap = _base_snapshot(
        sale_data_quality_issues={
            "invalid_numeric_count": 0,
            "missing_description_count": 0,
            "total_issues": 0,
        }
    )
    alerts = early_warning.evaluate(snap)
    assert not any(a.id == "sale_data_quality" for a in alerts)


def test_purchase_data_quality_fires_critical_on_zero_or_negative_qty_or_cost():
    """Flags critical alert when purchase lines have zero/negative/invalid quantities or unit costs."""
    snap = _base_snapshot(
        purchase_data_quality_issues={
            "invalid_numeric_count": 2,
            "missing_description_count": 0,
            "total_issues": 2,
        }
    )
    alerts = early_warning.evaluate(snap)
    alert = next(a for a in alerts if a.id == "purchase_data_quality")
    assert alert.severity == early_warning.CRITICAL
    assert alert.dimension == "data_quality"
    assert alert.title == "Purchase data needs attention"
    assert "2 with zero/negative/invalid quantity or unit cost" in alert.summary
    assert alert.link == "warnings"


def test_purchase_data_quality_fires_critical_on_missing_description():
    """Flags critical alert when purchase items have missing descriptions."""
    snap = _base_snapshot(
        purchase_data_quality_issues={
            "invalid_numeric_count": 0,
            "missing_description_count": 4,
            "total_issues": 4,
        }
    )
    alerts = early_warning.evaluate(snap)
    alert = next(a for a in alerts if a.id == "purchase_data_quality")
    assert alert.severity == early_warning.CRITICAL
    assert "4 with missing description" in alert.summary


def test_purchase_data_quality_clears_when_clean():
    """No alert fires when purchase lines are clean."""
    snap = _base_snapshot(
        purchase_data_quality_issues={
            "invalid_numeric_count": 0,
            "missing_description_count": 0,
            "total_issues": 0,
        }
    )
    alerts = early_warning.evaluate(snap)
    assert not any(a.id == "purchase_data_quality" for a in alerts)


def test_db_check_sale_and_purchase_data_quality(db_session: Session):
    """Integration test verifying _check_sale_data_quality and _check_purchase_data_quality query logic."""
    from app.retail.services.branch_health import (
        _check_sale_data_quality,
        _check_purchase_data_quality,
    )

    branch = Branch(
        id="test_br_dq", name="DQ Branch", phone_number="123", address="Main"
    )
    db_session.add(branch)

    # 1. Product with valid description
    p1 = Product(
        id="prod_valid", stock_code="SKU-VALID", description="Good Leather Shoes"
    )
    # 2. Product with empty/missing description
    p2 = Product(id="prod_nodesc", stock_code="SKU-NODESC", description="   ")
    db_session.add_all([p1, p2])
    db_session.flush()

    today = date(2026, 9, 21)

    # Sale 1: valid line
    s1 = Sale(
        id="sale_1",
        branch_id="test_br_dq",
        slip_id="SL-1",
        slip_number="001",
        sale_date=today,
    )
    l1 = SaleLine(
        id="sl_1",
        sale_id="sale_1",
        line_id="sl-1-1",
        line_no=1,
        product_id="prod_valid",
        qty=2.0,
        selling_price=50.0,
        net_amount=100.0,
        amount=100.0,
        discount_amount=0.0,
    )

    # Sale 2: invalid qty (-1). Same rules as the Warning page: a zero price is allowed,
    # a quantity below 1 is not.
    s2 = Sale(
        id="sale_2",
        branch_id="test_br_dq",
        slip_id="SL-2",
        slip_number="002",
        sale_date=today,
    )
    l2 = SaleLine(
        id="sl_2",
        sale_id="sale_2",
        line_id="sl-2-1",
        line_no=1,
        product_id="prod_valid",
        qty=-1.0,
        selling_price=0.0,
        net_amount=0.0,
        amount=0.0,
        discount_amount=0.0,
    )

    # Sale 3: missing description on product
    s3 = Sale(
        id="sale_3",
        branch_id="test_br_dq",
        slip_id="SL-3",
        slip_number="003",
        sale_date=today,
    )
    l3 = SaleLine(
        id="sl_3",
        sale_id="sale_3",
        line_id="sl-3-1",
        line_no=1,
        product_id="prod_nodesc",
        qty=1.0,
        selling_price=30.0,
        net_amount=30.0,
        amount=30.0,
        discount_amount=0.0,
    )

    # Purchase 1: valid
    pur1 = Purchase(
        id="pur_1",
        branch_id="test_br_dq",
        purchase_number="STR-001",
        purchase_date=today,
    )
    pl1 = PurchaseLine(
        id="pl_1",
        purchase_id="pur_1",
        product_id="prod_valid",
        quantity=10.0,
        buying_price=25.0,
    )

    # Purchase 2: invalid unit cost (negative) and missing description
    pur2 = Purchase(
        id="pur_2",
        branch_id="test_br_dq",
        purchase_number="STR-002",
        purchase_date=today,
    )
    pl2 = PurchaseLine(
        id="pl_2",
        purchase_id="pur_2",
        product_id="prod_nodesc",
        quantity=5.0,
        buying_price=-1.0,
    )

    db_session.add_all([s1, l1, s2, l2, s3, l3, pur1, pl1, pur2, pl2])
    db_session.commit()

    # Check sales data quality
    sale_dq = _check_sale_data_quality(db_session, "test_br_dq", today, today)
    assert sale_dq["invalid_numeric_count"] == 1  # sl_2
    assert sale_dq["missing_description_count"] == 1  # sl_3
    assert sale_dq["total_issues"] == 2

    # Check purchase data quality
    pur_dq = _check_purchase_data_quality(db_session, "test_br_dq", today, today)
    assert pur_dq["invalid_numeric_count"] == 1  # pl_2 (unit cost below 0)
    assert pur_dq["missing_description_count"] == 1  # pl_2 (prod_nodesc)
    assert pur_dq["total_issues"] == 2
