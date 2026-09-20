import datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.models.user import User, UserRole
from app.services import dashboard as dashboard_service

TODAY = datetime.date(2026, 8, 30)  # a Sunday


def _make_branch(db_session: Session, name: str = "Retail 1") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    return branch


def _make_retail_user(db_session: Session, branch: Branch, user_id: str = "test-user-id") -> User:
    user = User(id=user_id, name="Tester", email=f"{user_id}@example.com", role=UserRole.RETAIL, branch_id=branch.id)
    db_session.add(user)
    return user


def _make_admin_user(db_session: Session, user_id: str = "test-user-id") -> User:
    user = User(id=user_id, name="Admin", email=f"{user_id}@example.com", role=UserRole.ADMIN)
    db_session.add(user)
    return user


def _make_product(db_session: Session, stock_code: str, description: str = "Widget") -> Product:
    product = Product(stock_code=stock_code, description=description)
    db_session.add(product)
    db_session.flush()
    return product


def _make_sale(
    db_session: Session,
    *,
    branch: Branch,
    product: Product,
    slip_id: str,
    sale_date: datetime.date,
    sale_time: str,
    qty: float,
    net_amount: float,
) -> None:
    sale = Sale(branch_id=branch.id, slip_id=slip_id, slip_number=slip_id, sale_date=sale_date, sale_time=sale_time)
    db_session.add(sale)
    db_session.flush()
    db_session.add(
        SaleLine(
            sale_id=sale.id,
            line_id=f"{slip_id}-01",
            line_no=1,
            product_id=product.id,
            selling_price=net_amount / qty if qty else 0,
            qty=qty,
            uom="Each",
            discount_amount=0,
            amount=net_amount,
            net_amount=net_amount,
        )
    )


def test_resolve_period_today_and_7d():
    r = dashboard_service.resolve_period("today", today=TODAY)
    assert r.start == r.end == TODAY
    assert r.previous_start == r.previous_end == TODAY - datetime.timedelta(days=1)

    r = dashboard_service.resolve_period("7d", today=TODAY)
    assert r.start == TODAY - datetime.timedelta(days=6)
    assert r.end == TODAY
    assert r.previous_end == r.start - datetime.timedelta(days=1)
    assert r.previous_start == r.previous_end - datetime.timedelta(days=6)


def test_dashboard_endpoint_retail_account_uses_own_branch(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    _make_sale(
        db_session,
        branch=branch,
        product=product,
        slip_id="slip-1",
        sale_date=datetime.date.today(),
        sale_time="10:00",
        qty=2,
        net_amount=1000,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/revenue?period=today")
    assert response.status_code == 200
    body = response.json()
    assert body["branch_id"] == branch.id
    assert body["net_revenue"]["value"] == 1000
    assert body["transaction_count"]["value"] == 1


def test_dashboard_admin_requires_branch_id(authed_client: TestClient, db_session: Session):
    _make_admin_user(db_session)
    db_session.commit()

    response = authed_client.get("/api/dashboard/revenue?period=today")
    assert response.status_code == 400


def test_dashboard_accepts_wholesale_branch(authed_client: TestClient, db_session: Session):
    admin = _make_admin_user(db_session)
    wholesale_branch = _make_branch(db_session, "Wholesale")
    db_session.add(
        User(
            id="wholesale-user",
            name="Wholesale Staff",
            email="wholesale-staff@example.com",
            role=UserRole.WHOLESALE,
            branch_id=wholesale_branch.id,
        )
    )
    db_session.commit()

    for endpoint in ["revenue", "overview", "cost", "customer", "summary"]:
        response = authed_client.get(f"/api/dashboard/{endpoint}?period=today&branch_id={wholesale_branch.id}")
        assert response.status_code == 200, f"Expected 200 for {endpoint}, got {response.status_code}"

    response_inv = authed_client.get(f"/api/dashboard/inventory?branch_id={wholesale_branch.id}")
    assert response_inv.status_code == 200


def test_dashboard_kpis_and_delta_vs_previous_period(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    _make_sale(
        db_session, branch=branch, product=product, slip_id="today-1",
        sale_date=today, sale_time="10:00", qty=2, net_amount=2000,
    )
    _make_sale(
        db_session, branch=branch, product=product, slip_id="yesterday-1",
        sale_date=today - datetime.timedelta(days=1), sale_time="10:00", qty=1, net_amount=1000,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/revenue?period=today")
    assert response.status_code == 200
    body = response.json()
    assert body["net_revenue"] == {"value": 2000.0, "previous_value": 1000.0, "delta_pct": 100.0}
    assert body["transaction_count"] == {"value": 1.0, "previous_value": 1.0, "delta_pct": 0.0}
    assert body["avg_basket"]["value"] == 2000.0


def test_dashboard_trend_zero_fills_missing_days(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-1",
        sale_date=today, sale_time="10:00", qty=1, net_amount=500,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/revenue?period=7d")
    assert response.status_code == 200
    trend = response.json()["trend"]
    assert len(trend) == 7
    assert trend[-1] == {"date": today.isoformat(), "net_revenue": 500.0}
    assert all(point["net_revenue"] == 0.0 for point in trend[:-1])


def test_dashboard_top_products_ordered_by_revenue(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product_a = _make_product(db_session, "SKU-A", "Product A")
    product_b = _make_product(db_session, "SKU-B", "Product B")
    today = datetime.date.today()
    _make_sale(
        db_session, branch=branch, product=product_a, slip_id="slip-a",
        sale_date=today, sale_time="10:00", qty=1, net_amount=500,
    )
    _make_sale(
        db_session, branch=branch, product=product_b, slip_id="slip-b",
        sale_date=today, sale_time="10:00", qty=1, net_amount=1500,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/revenue?period=today")
    top_products = response.json()["top_products"]
    assert [p["stock_code"] for p in top_products] == ["SKU-B", "SKU-A"]
    assert top_products[0]["avg_selling_price"] == 1500.0
    assert top_products[1]["avg_selling_price"] == 500.0


def test_dashboard_top_products_selling_price_is_qty_weighted(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    # 1 unit at 100, 9 units at 200 -> qty-weighted average should sit close to 200,
    # not the simple average of the two prices (150).
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-1",
        sale_date=today, sale_time="10:00", qty=1, net_amount=100,
    )
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-2",
        sale_date=today, sale_time="11:00", qty=9, net_amount=1800,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/revenue?period=today")
    top_products = response.json()["top_products"]
    assert top_products[0]["avg_selling_price"] == 190.0


def test_dashboard_heatmap_buckets_by_weekday_and_hour_band(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-1",
        sale_date=today, sale_time="10:15", qty=1, net_amount=300,
    )
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-2",
        sale_date=today, sale_time="10:45", qty=1, net_amount=200,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/revenue?period=today")
    heatmap = response.json()["heatmap"]
    assert heatmap == [{"weekday": today.weekday(), "hour_band": "10-11", "net_revenue": 500.0}]


def test_dashboard_heatmap_excludes_sales_outside_business_hours(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-late-night",
        sale_date=today, sale_time="23:30", qty=1, net_amount=300,
    )
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-early-morning",
        sale_date=today, sale_time="03:00", qty=1, net_amount=200,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/revenue?period=today")
    assert response.json()["heatmap"] == []


def test_dashboard_sale_warnings_scoped_to_selected_branch(
    authed_client: TestClient, db_session: Session
):
    admin = _make_admin_user(db_session)
    branch = _make_branch(db_session)
    other_branch = _make_branch(db_session, "Other")
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-1",
        sale_date=today, sale_time="10:00", qty=0, net_amount=0,
    )
    _make_sale(
        db_session, branch=other_branch, product=product, slip_id="slip-2",
        sale_date=today, sale_time="10:00", qty=0, net_amount=0,
    )
    db_session.commit()

    response = authed_client.get(f"/api/dashboard/revenue?period=today&branch_id={branch.id}")
    assert response.status_code == 200
    warnings = response.json()["sale_warnings"]
    assert len(warnings) == 1


def _make_sale_with_lines(
    db_session: Session,
    *,
    branch: Branch,
    slip_id: str,
    sale_date: datetime.date,
    sale_time: str,
    lines: list[tuple[Product, float, float]],
) -> None:
    """Like _make_sale but for a basket with more than one line item — each entry in
    `lines` is (product, qty, net_amount)."""
    sale = Sale(branch_id=branch.id, slip_id=slip_id, slip_number=slip_id, sale_date=sale_date, sale_time=sale_time)
    db_session.add(sale)
    db_session.flush()
    for i, (product, qty, net_amount) in enumerate(lines, start=1):
        db_session.add(
            SaleLine(
                sale_id=sale.id,
                line_id=f"{slip_id}-{i:02d}",
                line_no=i,
                product_id=product.id,
                selling_price=net_amount / qty if qty else 0,
                qty=qty,
                uom="Each",
                discount_amount=0,
                amount=net_amount,
                net_amount=net_amount,
            )
        )


def _make_purchase(
    db_session: Session, *, branch: Branch, product: Product, purchase_date: datetime.date, qty: float, buying_price: float
) -> None:
    purchase = Purchase(branch_id=branch.id, purchase_date=purchase_date)
    db_session.add(purchase)
    db_session.flush()
    db_session.add(
        PurchaseLine(purchase_id=purchase.id, product_id=product.id, quantity=qty, buying_price=buying_price, uom="Each")
    )


def _make_stock_level(
    db_session: Session,
    *,
    branch: Branch,
    product: Product,
    on_hand_qty: float,
    buying_price: float | None,
    snapshot_at: datetime.datetime,
) -> None:
    db_session.add(
        StockLevel(
            branch_id=branch.id,
            product_id=product.id,
            on_hand_qty=on_hand_qty,
            buying_price=buying_price,
            selling_price=None,
            snapshot_at=snapshot_at,
        )
    )


def test_cost_dashboard_uses_point_in_time_price_for_cogs_and_margin(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    _make_purchase(
        db_session, branch=branch, product=product,
        purchase_date=today - datetime.timedelta(days=1), qty=10, buying_price=100,
    )
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-1",
        sale_date=today, sale_time="10:00", qty=2, net_amount=300,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/cost?period=today")
    assert response.status_code == 200
    body = response.json()
    # Cost = 2 * 100 = 200; revenue 300; margin 100 -> 33.33%; margin per basket 100.
    assert body["estimated_cogs"]["value"] == 200.0
    assert round(body["estimated_gross_margin_pct"]["value"], 2) == 33.33
    assert body["estimated_margin_per_basket"]["value"] == 100.0
    assert body["products"][0]["stock_code"] == "SKU-1"
    assert body["products"][0]["estimated_cost"] == 200.0
    assert body["products"][0]["estimated_margin"] == 100.0
    assert len(body["trend"]) == 1
    assert body["trend"][0]["date"] == today.isoformat()
    assert body["trend"][0]["net_revenue"] == 300.0
    assert body["trend"][0]["estimated_cost"] == 200.0
    assert round(body["trend"][0]["margin_pct"], 2) == 33.33


def test_cost_dashboard_product_with_no_priced_lines_is_excluded_from_ranking(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-1",
        sale_date=today, sale_time="10:00", qty=1, net_amount=100,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/cost?period=today")
    body = response.json()
    assert body["estimated_cogs"]["value"] == 0.0
    # A product with no cost estimate can't be ranked by profit, so the top-profit
    # products list simply excludes it rather than showing a "—" entry.
    assert body["products"] == []
    assert body["trend"][0]["net_revenue"] == 100.0
    assert body["trend"][0]["estimated_cost"] is None
    assert body["trend"][0]["margin_pct"] is None


def test_cost_dashboard_products_ranked_by_estimated_margin_not_revenue(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    high_revenue_low_margin = _make_product(db_session, "SKU-A", description="High revenue, thin margin")
    low_revenue_high_margin = _make_product(db_session, "SKU-B", description="Low revenue, fat margin")
    today = datetime.date.today()
    _make_purchase(
        db_session, branch=branch, product=high_revenue_low_margin,
        purchase_date=today - datetime.timedelta(days=1), qty=100, buying_price=95,
    )
    _make_purchase(
        db_session, branch=branch, product=low_revenue_high_margin,
        purchase_date=today - datetime.timedelta(days=1), qty=100, buying_price=10,
    )
    # SKU-A: revenue 1000, cost 950, margin 50.
    _make_sale(
        db_session, branch=branch, product=high_revenue_low_margin, slip_id="slip-1",
        sale_date=today, sale_time="10:00", qty=10, net_amount=1000,
    )
    # SKU-B: revenue 200, cost 100, margin 100 — smaller revenue, bigger profit.
    _make_sale(
        db_session, branch=branch, product=low_revenue_high_margin, slip_id="slip-2",
        sale_date=today, sale_time="10:00", qty=10, net_amount=200,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/cost?period=today")
    body = response.json()
    assert [p["stock_code"] for p in body["products"]] == ["SKU-B", "SKU-A"]
    assert body["products"][0]["estimated_margin"] == 100.0
    assert body["products"][1]["estimated_margin"] == 50.0


def test_cost_dashboard_trend_zero_fills_days_with_no_sales(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)
    _make_purchase(db_session, branch=branch, product=product, purchase_date=yesterday, qty=10, buying_price=100)
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-1",
        sale_date=today, sale_time="10:00", qty=2, net_amount=300,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/cost?period=7d")
    assert response.status_code == 200
    trend = {row["date"]: row for row in response.json()["trend"]}
    assert trend[today.isoformat()]["net_revenue"] == 300.0
    assert trend[today.isoformat()]["estimated_cost"] == 200.0
    no_sales_day = (today - datetime.timedelta(days=3)).isoformat()
    assert trend[no_sales_day]["net_revenue"] == 0.0
    assert trend[no_sales_day]["estimated_cost"] == 0.0
    assert trend[no_sales_day]["margin_pct"] is None


def test_cost_dashboard_purchase_warnings_scoped_to_period(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    _make_purchase(db_session, branch=branch, product=product, purchase_date=today, qty=0, buying_price=100)
    db_session.commit()

    response = authed_client.get("/api/dashboard/cost?period=today")
    assert response.status_code == 200
    assert len(response.json()["purchase_warnings"]) == 1


def test_inventory_dashboard_stock_value_and_low_stock_status(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product_a = _make_product(db_session, "SKU-A", "Fast mover")
    product_a.group_name = "Snacks"
    product_b = _make_product(db_session, "SKU-B", "Slow mover")
    product_b.group_name = "Drinks"
    now = datetime.datetime.now()

    # SKU-A: on hand 3, sells 3/day over the trailing 30 days -> ~1 day left -> Critical.
    _make_stock_level(db_session, branch=branch, product=product_a, on_hand_qty=3, buying_price=50, snapshot_at=now)
    for day_offset in range(30):
        _make_sale(
            db_session, branch=branch, product=product_a, slip_id=f"velocity-{day_offset}",
            sale_date=datetime.date.today() - datetime.timedelta(days=day_offset),
            sale_time="10:00", qty=3, net_amount=300,
        )

    # SKU-B: on hand 100, no recent sales -> no computable days-left -> not "low stock".
    _make_stock_level(db_session, branch=branch, product=product_b, on_hand_qty=100, buying_price=20, snapshot_at=now)
    db_session.commit()

    response = authed_client.get("/api/dashboard/inventory")
    assert response.status_code == 200
    body = response.json()
    assert body["sku_count"] == 2
    assert body["estimated_stock_value"] == 3 * 50 + 100 * 20
    assert body["critical_count"] == 1
    categories = {row["category"]: row["qty"] for row in body["stock_qty_by_category"]}
    assert categories == {"Snacks": 3.0, "Drinks": 100.0}
    low_stock_codes = {item["stock_code"] for item in body["low_stock_items"]}
    assert low_stock_codes == {"SKU-A"}
    assert body["low_stock_items"][0]["status"] == "Critical"
    # SKU-B has never sold at all -> flagged as dead stock (still on hand, no sales in
    # the dead-stock window); SKU-A sells daily, so it's the opposite of dead stock.
    assert body["dead_stock_count"] == 1
    dead_stock_codes = {item["stock_code"] for item in body["dead_stock_items"]}
    assert dead_stock_codes == {"SKU-B"}
    assert body["dead_stock_items"][0]["category"] == "Drinks"


def test_inventory_dashboard_dead_stock_excludes_sales_within_the_window(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    now = datetime.datetime.now()
    _make_stock_level(db_session, branch=branch, product=product, on_hand_qty=10, buying_price=10, snapshot_at=now)
    # A sale 60 days ago: outside the 30-day velocity window (no computable days-left,
    # so not "low stock"), but inside the 90-day dead-stock window -> not dead stock.
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-60-days-ago",
        sale_date=datetime.date.today() - datetime.timedelta(days=60),
        sale_time="10:00", qty=1, net_amount=100,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/inventory")
    assert response.status_code == 200
    body = response.json()
    assert body["dead_stock_count"] == 0
    assert body["low_stock_items"] == []


def test_inventory_dashboard_requires_retail_branch_for_admin(
    authed_client: TestClient, db_session: Session
):
    _make_admin_user(db_session)
    db_session.commit()

    response = authed_client.get("/api/dashboard/inventory")
    assert response.status_code == 400


def test_customer_dashboard_basket_stats_and_histogram(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    # One single-item basket, one two-item basket.
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-1",
        sale_date=today, sale_time="10:00", qty=1, net_amount=100,
    )
    _make_sale_with_lines(
        db_session, branch=branch, slip_id="slip-2", sale_date=today, sale_time="14:00",
        lines=[(product, 1, 50), (product, 1, 50)],
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/customer?period=today")
    assert response.status_code == 200
    body = response.json()
    assert body["avg_items_per_basket"]["value"] == 1.5
    assert body["single_item_basket_share_pct"]["value"] == 50.0
    histogram = {row["items"]: row["count"] for row in body["items_per_basket_histogram"]}
    assert histogram == {1: 1, 2: 1}
    assert body["busiest_hour"]["transaction_count"] == 1
    # Both sales landed today — the transaction count trend should show 2 for today.
    trend_by_date = {row["date"]: row["transaction_count"] for row in body["transaction_count_trend"]}
    assert trend_by_date[today.isoformat()] == 2


def test_customer_dashboard_transaction_trend_zero_fills_missing_days(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-1",
        sale_date=today, sale_time="10:00", qty=1, net_amount=500,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/customer?period=7d")
    assert response.status_code == 200
    trend = response.json()["transaction_count_trend"]
    assert len(trend) == 7
    assert trend[-1] == {"date": today.isoformat(), "transaction_count": 1}
    assert all(point["transaction_count"] == 0 for point in trend[:-1])


def test_resolve_period_custom_range_computes_matching_previous_range():
    r = dashboard_service.resolve_period(
        "today",  # ignored — date_from/date_to take over
        date_from=datetime.date(2026, 8, 10),
        date_to=datetime.date(2026, 8, 14),
    )
    assert r.start == datetime.date(2026, 8, 10)
    assert r.end == datetime.date(2026, 8, 14)
    # 5-day window -> previous 5-day window ending the day before date_from.
    assert r.previous_end == datetime.date(2026, 8, 9)
    assert r.previous_start == datetime.date(2026, 8, 5)


def test_dashboard_custom_date_range_overrides_period(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-in-range",
        sale_date=datetime.date(2026, 8, 12), sale_time="10:00", qty=1, net_amount=1000,
    )
    # Outside the custom range but would be inside "30d" — proves the custom range,
    # not the (still-sent) period, is what actually won.
    _make_sale(
        db_session, branch=branch, product=product, slip_id="slip-out-of-range",
        sale_date=datetime.date.today(), sale_time="10:00", qty=1, net_amount=5000,
    )
    db_session.commit()

    response = authed_client.get(
        "/api/dashboard/revenue?period=30d&date_from=2026-08-10&date_to=2026-08-14"
    )
    assert response.status_code == 200
    body = response.json()
    assert body["period"] == "custom"
    assert body["date_from"] == "2026-08-10"
    assert body["date_to"] == "2026-08-14"
    assert body["net_revenue"]["value"] == 1000.0


def test_dashboard_rejects_one_sided_custom_range(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    db_session.commit()

    response = authed_client.get("/api/dashboard/revenue?date_from=2026-08-10")
    assert response.status_code == 400


def test_dashboard_rejects_inverted_custom_range(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    db_session.commit()

    response = authed_client.get(
        "/api/dashboard/revenue?date_from=2026-08-14&date_to=2026-08-10"
    )
    assert response.status_code == 400


def test_summary_dashboard_endpoint(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session, name="Ashley")
    _make_retail_user(db_session, branch)
    product_men = Product(stock_code="MEN-1", description="Shower", group_name="Men")
    product_lady = Product(stock_code="LADY-1", description="Luofu", group_name="Lady")
    db_session.add_all([product_men, product_lady])
    db_session.flush()

    # Sales
    _make_sale(
        db_session,
        branch=branch,
        product=product_men,
        slip_id="slip-sum-1",
        sale_date=datetime.date.today(),
        sale_time="18:30",
        qty=2,
        net_amount=20000,
    )
    _make_sale(
        db_session,
        branch=branch,
        product=product_lady,
        slip_id="slip-sum-2",
        sale_date=datetime.date.today(),
        sale_time="18:45",
        qty=1,
        net_amount=10000,
    )

    # Stock level for products
    db_session.add(
        StockLevel(
            branch_id=branch.id,
            product_id=product_men.id,
            snapshot_at=datetime.datetime.now(),
            on_hand_qty=10,
            buying_price=5000,
            selling_price=10000,
        )
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/summary?period=today")
    assert response.status_code == 200
    body = response.json()

    assert body["branch_name"] == "Ashley"
    assert "kpis" in body
    assert body["kpis"]["net_revenue"] == 30000.0
    assert body["kpis"]["transaction_count"] == 2
    assert body["kpis"]["quantity_sold"] == 3.0
    assert body["kpis"]["selling_sku_count"] == 2
    assert len(body["category_revenue"]) >= 1
    assert "inventory_condition" in body
    assert "customer_demand" in body
    assert len(body["top_products"]) >= 1
    assert len(body["recommendations"]) == 3

