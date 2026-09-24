import dataclasses
import datetime

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import pytest
from app.models.branch import Branch
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.models.stock_level import StockLevel
from app.retail.models.zero_selling import ZeroSellingRecord
from app.models.user import User, UserRole
from app.retail.services import branch_health
from app.services.dashboard import _year_ago


# --- fixtures ------------------------------------------------------------------------


def _make_branch(db_session: Session, name: str = "Retail 1") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    return branch


def _make_retail_user(db_session: Session, branch: Branch, user_id: str = "test-user-id") -> User:
    user = User(
        id=user_id, name="Tester", email=f"{user_id}@example.com", role=UserRole.RETAIL, branch_id=branch.id
    )
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
    qty: float,
    net_amount: float,
) -> None:
    sale = Sale(
        branch_id=branch.id, slip_id=slip_id, slip_number=slip_id, sale_date=sale_date, sale_time="10:00"
    )
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


def _make_purchase(
    db_session: Session,
    *,
    branch: Branch,
    product: Product,
    purchase_date: datetime.date,
    qty: float,
    buying_price: float,
) -> None:
    purchase = Purchase(branch_id=branch.id, purchase_date=purchase_date)
    db_session.add(purchase)
    db_session.flush()
    db_session.add(
        PurchaseLine(
            purchase_id=purchase.id, product_id=product.id, quantity=qty, buying_price=buying_price, uom="Each"
        )
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


def _make_zero_selling(
    db_session: Session,
    *,
    branch: Branch,
    sale_date: datetime.date,
    category: str = "Size",
    reason: str = "Out of stock",
    import_batch_id: str = "batch-1",
    source_sheet: str = "Sheet1",
    source_row: int = 1,
) -> None:
    db_session.add(
        ZeroSellingRecord(
            import_batch_id=import_batch_id,
            branch_id=branch.id,
            sale_date=sale_date,
            branch=branch.name,
            category=category,
            reason=reason,
            source_sheet=source_sheet,
            source_row=source_row,
        )
    )


def _snapshot(**overrides) -> branch_health.BranchSnapshot:
    """A deliberately healthy baseline — every test below changes one thing and
    asserts on that one thing, so a failure names the rule that broke."""
    base = dict(
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
        aged_stock_count=0,
        aged_stock_judged_count=60,
        estimated_stock_value=77_000.0,
        days_of_inventory_on_hand=30.0,
        stock_as_of="2026-09-01T00:00:00",
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
        quantity_sold=250.0,
        previous_quantity_sold=250.0,
        data_issue_count=0,
        critical_data_issue_count=0,
        data_issue_sections=(),
        records_checked=1000,
        period_days=30,
        conversion_rate_pct=85.0,
        conversion_sales_slips=85,
        conversion_zero_count=15,
        conversion_days_recorded=10,
    )
    base.update(overrides)
    return branch_health.BranchSnapshot(**base)


def _dimension(scored: dict, key: str) -> dict:
    return next(d for d in scored["dimensions"] if d["key"] == key)


# --- the scoring table itself ---------------------------------------------------------


def test_dimension_and_sub_metric_weights_each_sum_to_one():
    """The published weight table is the thing a reader checks first — if the five
    dimension weights didn't sum to 100%, every score on the page would be quietly
    misweighted while still looking plausible."""
    assert sum(d.weight for d in branch_health.DIMENSIONS) == 1.0
    for dimension in branch_health.DIMENSIONS:
        assert round(sum(s.weight for s in dimension.sub_metrics), 6) == 1.0


def test_score_from_bands_interpolates_between_breakpoints_and_clamps_outside():
    bands = ((-20.0, 0.0), (-10.0, 40.0), (0.0, 70.0), (10.0, 100.0))
    assert branch_health.score_from_bands(0.0, bands) == 70.0
    assert branch_health.score_from_bands(-5.0, bands) == 55.0  # halfway between 40 and 70
    assert branch_health.score_from_bands(-100.0, bands) == 0.0
    assert branch_health.score_from_bands(999.0, bands) == 100.0


def test_inventory_sub_metrics_and_dead_stock_bands():
    inventory_dim = next(d for d in branch_health.DIMENSIONS if d.key == "inventory")
    sub_keys = [s.key for s in inventory_dim.sub_metrics]
    assert sub_keys == ["dead_stock_share_pct", "stockout_risk_share_pct", "aged_stock_share_pct"]
    assert [s.weight for s in inventory_dim.sub_metrics] == [0.4, 0.35, 0.25]

    dead_bands = next(s.bands for s in inventory_dim.sub_metrics if s.key == "dead_stock_share_pct")
    assert branch_health.score_from_bands(15.0, dead_bands) == 100.0
    assert branch_health.score_from_bands(20.0, dead_bands) == 100.0
    assert branch_health.score_from_bands(35.0, dead_bands) == 85.0
    assert branch_health.score_from_bands(50.0, dead_bands) == 60.0
    assert branch_health.score_from_bands(80.0, dead_bands) == 0.0
    assert branch_health.score_from_bands(90.0, dead_bands) == 0.0


def test_aged_stock_share_scores_from_bands_and_its_own_count():
    inventory_dim = next(d for d in branch_health.DIMENSIONS if d.key == "inventory")
    bands = next(s.bands for s in inventory_dim.sub_metrics if s.key == "aged_stock_share_pct")
    assert branch_health.score_from_bands(0.0, bands) == 100.0
    assert branch_health.score_from_bands(10.0, bands) == 80.0
    assert branch_health.score_from_bands(25.0, bands) == 50.0
    assert branch_health.score_from_bands(60.0, bands) == 0.0

    scored = branch_health.score_branch(
        _snapshot(aged_stock_count=25, aged_stock_judged_count=100, sku_count=400)
    )
    aged = next(
        m for m in _dimension(scored, "inventory")["sub_metrics"] if m["key"] == "aged_stock_share_pct"
    )
    assert aged["value"] == 25.0
    assert aged["score"] == 50.0
    assert aged["calculation"] == "25 of 100 products with stock and a purchase record."


def test_conversion_rate_scores_from_bands():
    customer_dim = next(d for d in branch_health.DIMENSIONS if d.key == "customer")
    cr_metric = next(s for s in customer_dim.sub_metrics if s.key == "conversion_rate_pct")
    assert cr_metric.weight == 0.5
    bands = cr_metric.bands
    assert branch_health.score_from_bands(20.0, bands) == 0.0
    assert branch_health.score_from_bands(30.0, bands) == 0.0
    assert branch_health.score_from_bands(45.0, bands) == 40.0
    assert branch_health.score_from_bands(60.0, bands) == 70.0
    assert branch_health.score_from_bands(75.0, bands) == 85.0
    assert branch_health.score_from_bands(85.0, bands) == 100.0
    assert branch_health.score_from_bands(95.0, bands) == 100.0


def test_healthy_branch_scores_well_across_every_dimension():
    scored = branch_health.score_branch(_snapshot())
    assert scored["status"] == "healthy"
    assert scored["overall_score"] >= branch_health.HEALTHY_SCORE
    assert all(d["score"] is not None for d in scored["dimensions"])
    assert scored["scored_weight"] == 1.0


# --- the "unmeasured is not zero" rule ------------------------------------------------


def test_no_previous_period_leaves_sales_unscored_rather_than_zero():
    scored = branch_health.score_branch(
        _snapshot(
            previous_net_revenue=0.0,
            previous_transaction_count=0,
            previous_avg_basket=0.0,
            previous_quantity_sold=0.0,
        )
    )
    sales = _dimension(scored, "sales")
    assert sales["score"] is None
    assert sales["status"] is None
    assert "last year" in sales["insufficient_data_reason"]


def test_low_cost_coverage_drops_profit_instead_of_scoring_a_guess():
    scored = branch_health.score_branch(_snapshot(cost_coverage_pct=20.0, previous_cost_coverage_pct=20.0))
    profit = _dimension(scored, "profit")
    assert profit["score"] is None
    assert "20% of this period's revenue" in profit["insufficient_data_reason"]


def test_no_inventory_snapshot_leaves_inventory_unscored():
    scored = branch_health.score_branch(_snapshot(sku_count=0, aged_stock_judged_count=0, days_of_inventory_on_hand=None))
    inventory = _dimension(scored, "inventory")
    assert inventory["score"] is None
    assert inventory["insufficient_data_reason"] == "No inventory snapshot imported for this branch yet."


def test_overall_score_renormalises_weights_over_scored_dimensions_only():
    """A dropped dimension must not drag the overall score down — it should leave the
    remaining ones sharing 100% of the weight between them."""
    scored = branch_health.score_branch(_snapshot(sku_count=0, aged_stock_judged_count=0, days_of_inventory_on_hand=None))
    assert _dimension(scored, "inventory")["score"] is None
    assert _dimension(scored, "inventory")["effective_weight"] is None
    # Inventory's 25% is gone, so the other four share the whole score.
    assert scored["scored_weight"] == 0.75
    effective = [d["effective_weight"] for d in scored["dimensions"] if d["effective_weight"] is not None]
    # Reported to 4dp for display, so they sum to 1 only up to that rounding.
    assert abs(sum(effective) - 1.0) < 1e-3
    # Sales' 25% of 75% scored weight is a third of the result.
    assert _dimension(scored, "sales")["effective_weight"] == round(0.25 / 0.75, 4)

    expected = (
        sum(d["score"] * d["weight"] for d in scored["dimensions"] if d["score"] is not None)
        / scored["scored_weight"]
    )
    assert scored["overall_score"] == round(expected, 1)


def test_profit_is_scored_from_gross_margin_alone():
    """Margin change was dropped, so a branch with no priced sales last year is no less
    measurable on Profit than any other: only this period's coverage matters."""
    scored = branch_health.score_branch(_snapshot(previous_cost_coverage_pct=0.0))
    profit = _dimension(scored, "profit")
    assert [s["key"] for s in profit["sub_metrics"]] == ["gross_margin_pct"]
    assert profit["score"] == 100.0


def test_a_customer_measure_can_drop_out_without_dropping_the_dimension():
    """Conversion rate needs zero-selling records; transaction growth does not."""
    scored = branch_health.score_branch(_snapshot(conversion_rate_pct=None))
    customer = _dimension(scored, "customer")
    by_key = {s["key"]: s for s in customer["sub_metrics"]}
    assert by_key["conversion_rate_pct"]["score"] is None
    assert by_key["transaction_growth_pct"]["score"] is not None
    assert customer["score"] == by_key["transaction_growth_pct"]["score"]


# --- individual dimensions ------------------------------------------------------------


def test_falling_revenue_pushes_sales_into_critical():
    scored = branch_health.score_branch(
        _snapshot(
            net_revenue=75_000.0,
            previous_net_revenue=100_000.0,
            transaction_count=70,
            previous_transaction_count=100,
            avg_basket=1071.0,
            previous_avg_basket=1000.0,
        )
    )
    sales = _dimension(scored, "sales")
    assert sales["status"] == "critical"
    by_key = {s["key"]: s for s in sales["sub_metrics"]}
    assert by_key["revenue_growth_pct"]["value"] == -25.0
    # The average sale actually rose — the breakdown has to show that even though Sales
    # as a whole is red, since that is the whole diagnostic value.
    assert by_key["avg_basket_growth_pct"]["value"] > 0


def test_dead_stock_share_drives_the_inventory_score_down():
    healthy = branch_health.score_branch(_snapshot())
    dead = branch_health.score_branch(_snapshot(dead_stock_count=85))
    assert _dimension(dead, "inventory")["score"] < _dimension(healthy, "inventory")["score"]
    by_key = {s["key"]: s for s in _dimension(dead, "inventory")["sub_metrics"]}
    assert by_key["dead_stock_share_pct"]["value"] == 85.0
    assert by_key["dead_stock_share_pct"]["score"] == 0.0


def test_customer_dimension_renormalizes_when_conversion_rate_has_no_data():
    snapshot_with_cr = _snapshot(conversion_rate_pct=85.0)
    scored_with_cr = branch_health.score_branch(snapshot_with_cr)
    customer_with_cr = _dimension(scored_with_cr, "customer")
    assert len(customer_with_cr["sub_metrics"]) == 2
    assert all(s["score"] is not None for s in customer_with_cr["sub_metrics"])

    snapshot_no_cr = _snapshot(conversion_rate_pct=None)
    scored_no_cr = branch_health.score_branch(snapshot_no_cr)
    customer_no_cr = _dimension(scored_no_cr, "customer")
    cr_metric = next(s for s in customer_no_cr["sub_metrics"] if s["key"] == "conversion_rate_pct")
    assert cr_metric["value"] is None
    assert cr_metric["score"] is None
    assert cr_metric["calculation"] is None
    # Dimension still scores because transaction growth is present
    assert customer_no_cr["score"] is not None


def test_conversion_rate_calculation_sentence():
    snapshot = _snapshot(
        conversion_rate_pct=60.0,
        conversion_sales_slips=30,
        conversion_zero_count=20,
        conversion_days_recorded=5,
    )
    scored = branch_health.score_branch(snapshot)
    customer = _dimension(scored, "customer")
    cr_metric = next(s for s in customer["sub_metrics"] if s["key"] == "conversion_rate_pct")
    assert "30 sales ÷ (30 sales + 20 walkouts) over 5 tracked days." in cr_metric["calculation"]


def test_data_quality_is_scored_as_a_rate_not_a_raw_count():
    """40 warnings across 40,000 rows is a clean import; 40 across 200 is a broken one.
    Only the rate tells those apart, so the same count must score differently against
    different volumes."""
    small = branch_health.score_branch(_snapshot(data_issue_count=40, records_checked=200))
    large = branch_health.score_branch(_snapshot(data_issue_count=40, records_checked=40_000))
    assert _dimension(small, "data_quality")["score"] < _dimension(large, "data_quality")["score"]
    # 0.1 issues per 100 records is effectively clean; 20 per 100 is not.
    assert _dimension(large, "data_quality")["score"] > 95.0
    assert _dimension(small, "data_quality")["score"] < 50.0


def test_no_records_at_all_leaves_data_quality_unscored():
    scored = branch_health.score_branch(_snapshot(records_checked=0))
    assert _dimension(scored, "data_quality")["score"] is None


# --- endpoint -------------------------------------------------------------------------


def test_overview_endpoint_scores_a_branch_and_returns_its_inputs(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    _make_sale(
        db_session, branch=branch, product=product, slip_id="now-1", sale_date=today, qty=2, net_amount=2000
    )
    _make_sale(
        db_session,
        branch=branch,
        product=product,
        slip_id="before-1",
        # Growth is compared with the same days one year earlier, not the window before.
        sale_date=_year_ago(today),
        qty=1,
        net_amount=1000,
    )
    db_session.commit()

    response = authed_client.get("/api/dashboard/overview?period=30d")
    assert response.status_code == 200
    body = response.json()
    assert body["branch_id"] == branch.id
    assert body["period"] == "30d"
    assert body["overall_score"] is not None
    assert body["status"] in {"healthy", "needs_attention", "critical"}
    assert [d["key"] for d in body["dimensions"]] == [d.key for d in branch_health.DIMENSIONS]
    # The raw inputs travel with the scores so nothing on the page is unexplained.
    assert body["metrics"]["net_revenue"] == 2000.0
    assert body["metrics"]["previous_net_revenue"] == 1000.0
    assert set(body["metrics"]) == {f.name for f in dataclasses.fields(branch_health.BranchSnapshot)}


def test_overview_reports_the_same_figures_as_the_tabs_it_links_to(
    authed_client: TestClient, db_session: Session
):
    """Overview is a second reading of the pillars' numbers, never a second
    computation of them — if these ever diverge, a manager who drills down from a red
    score into the evidence tab finds it contradicting the score that sent them there."""
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    product = _make_product(db_session, "SKU-1")
    today = datetime.date.today()
    now = datetime.datetime.now()
    _make_sale(
        db_session, branch=branch, product=product, slip_id="now-1", sale_date=today, qty=2, net_amount=2000
    )
    _make_purchase(
        db_session, branch=branch, product=product, purchase_date=today, qty=10, buying_price=100
    )
    _make_stock_level(
        db_session, branch=branch, product=product, on_hand_qty=8, buying_price=100, snapshot_at=now
    )
    db_session.commit()

    overview = authed_client.get("/api/dashboard/overview?period=30d").json()
    revenue = authed_client.get("/api/dashboard/revenue?period=30d").json()
    cost = authed_client.get("/api/dashboard/cost?period=30d").json()
    inventory = authed_client.get("/api/dashboard/inventory").json()

    assert overview["metrics"]["net_revenue"] == revenue["net_revenue"]["value"]
    assert overview["metrics"]["transaction_count"] == revenue["transaction_count"]["value"]
    assert overview["metrics"]["estimated_cogs"] == cost["estimated_cogs"]["value"]
    assert overview["metrics"]["gross_margin_pct"] == cost["estimated_gross_margin_pct"]["value"]
    assert overview["metrics"]["sku_count"] == inventory["sku_count"]
    assert overview["metrics"]["dead_stock_count"] == inventory["dead_stock_count"]
    assert overview["metrics"]["estimated_stock_value"] == inventory["estimated_stock_value"]


def test_overview_defaults_to_a_30_day_window(authed_client: TestClient, db_session: Session):
    """Every other tab defaults to today; this one can't, because a single day against
    the day before turns ordinary weekday variation into a critical alert."""
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    db_session.commit()

    body = authed_client.get("/api/dashboard/overview").json()
    assert body["period"] == "30d"
    assert body["metrics"]["period_days"] == 30
    span = datetime.date.fromisoformat(body["date_to"]) - datetime.date.fromisoformat(body["date_from"])
    assert span.days == 29


def test_overview_accepts_a_custom_range(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    db_session.commit()

    body = authed_client.get(
        "/api/dashboard/overview?date_from=2026-01-01&date_to=2026-01-31"
    ).json()
    assert body["period"] == "custom"
    assert body["date_from"] == "2026-01-01"
    # The same dates one year earlier, not the month before.
    assert body["previous_date_to"] == "2025-01-31"
    assert body["previous_date_from"] == "2025-01-01"


def test_overview_of_a_branch_with_no_data_scores_nothing_rather_than_zero(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    _make_retail_user(db_session, branch)
    db_session.commit()

    body = authed_client.get("/api/dashboard/overview?period=30d").json()
    assert body["overall_score"] is None
    assert body["status"] is None
    assert all(d["score"] is None for d in body["dimensions"])
    assert all(d["insufficient_data_reason"] for d in body["dimensions"])


def test_overview_rejects_wholesale_branch(authed_client: TestClient, db_session: Session):
    """Wholesale branches are completely excluded from retail dashboard."""
    db_session.add(
        User(id="test-user-id", name="Development", email="development@example.com", role=UserRole.DEVELOPMENT)
    )
    wholesale = _make_branch(db_session, "Wholesale")
    db_session.add(
        User(
            id="wholesale-user",
            name="Wholesale Staff",
            email="wholesale-staff@example.com",
            role=UserRole.WHOLESALE,
            branch_id=wholesale.id,
        )
    )
    db_session.commit()

    assert authed_client.get("/api/dashboard/overview").status_code == 400  # admin, no branch_id
    assert (
        authed_client.get(f"/api/dashboard/overview?branch_id={wholesale.id}").status_code == 400
    )


# --- business-configured weights ------------------------------------------------------


def test_configured_weights_override_the_default_table():
    """The point of making these tunable: the same period, scored two ways. A branch
    weak on inventory and strong on sales should land differently depending on which of
    the two the business says matters."""
    snapshot = _snapshot(
        dead_stock_count=40,  # inventory badly down
        critical_count=10,
        net_revenue=140_000.0,  # sales strongly up
        previous_net_revenue=100_000.0,
        transaction_count=140,
        avg_basket=1000.0,
    )
    inventory_led = branch_health.score_branch(
        snapshot, {"sales": 0.05, "profit": 0.05, "inventory": 0.8, "customer": 0.05, "data_quality": 0.05}
    )
    sales_led = branch_health.score_branch(
        snapshot, {"sales": 0.8, "profit": 0.05, "inventory": 0.05, "customer": 0.05, "data_quality": 0.05}
    )
    assert inventory_led["overall_score"] < sales_led["overall_score"]
    # The dimension scores themselves are untouched — only what they add up to moves.
    assert _dimension(inventory_led, "inventory")["score"] == _dimension(sales_led, "inventory")["score"]


def test_the_payload_reports_the_weight_actually_used():
    """The page must never explain a score with the code's default while the score
    itself came from a different number."""
    scored = branch_health.score_branch(_snapshot(), {"inventory": 0.5})
    assert _dimension(scored, "inventory")["weight"] == 0.5
    # An omitted key keeps its default rather than dropping to zero.
    assert _dimension(scored, "sales")["weight"] == 0.25


def test_weights_that_do_not_sum_to_one_still_produce_a_sound_score():
    """A half-finished edit in the Settings form must not break the dashboard."""
    scored = branch_health.score_branch(
        _snapshot(), {"sales": 0.1, "profit": 0.1, "inventory": 0.1, "customer": 0.1, "data_quality": 0.1}
    )
    assert scored["overall_score"] is not None
    assert 0 <= scored["overall_score"] <= 100


def test_saved_weights_reach_the_overview_endpoint(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    db_session.add(
        User(id="test-user-id", name="Development", email="development@example.com", role=UserRole.DEVELOPMENT)
    )
    db_session.commit()

    assert (
        authed_client.put(
            "/api/settings",
            json={
                "branch_health_weights": {
                    "sales": 0.5,
                    "profit": 0.2,
                    "inventory": 0.2,
                    "customer": 0.05,
                    "data_quality": 0.05,
                }
            },
        ).status_code
        == 200
    )

    body = authed_client.get(f"/api/dashboard/overview?branch_id={branch.id}").json()
    weights = {d["key"]: d["weight"] for d in body["dimensions"]}
    assert weights["sales"] == 0.5
    assert weights["customer"] == 0.05


# --- explaining the measures ------------------------------------------------------------


def test_neither_customer_measure_can_sink_the_dimension_alone():
    """Each is half the dimension, so a bad one lands as half rather than all of it."""
    only_transactions_are_bad = _dimension(
        branch_health.score_branch(
            _snapshot(transaction_count=70, previous_transaction_count=100, conversion_rate_pct=85.0)
        ),
        "customer",
    )
    assert only_transactions_are_bad["score"] is not None
    assert only_transactions_are_bad["score"] >= 50


def test_every_measure_explains_itself():
    """A score nobody can trace back to a definition is a number they have to take on
    faith. Every measure on the Overview page carries all three of what it means, the
    figures it came from, and the bands it was scored against."""
    scored = branch_health.score_branch(_snapshot())
    measures = [m for dimension in scored["dimensions"] for m in dimension["sub_metrics"]]
    assert len(measures) == 11
    for measure in measures:
        assert measure["definition"].strip(), measure["key"]
        assert measure["calculation"], measure["key"]
        assert len(measure["bands"]) >= 2, measure["key"]


def test_the_bands_shown_are_the_bands_scored_against():
    """They come from the same table rather than being written down twice, so the
    explanation on screen cannot drift from the arithmetic that produced the score."""
    scored = branch_health.score_branch(_snapshot(dead_stock_count=32))
    dead_stock = next(
        m
        for m in _dimension(scored, "inventory")["sub_metrics"]
        if m["key"] == "dead_stock_share_pct"
    )
    bands = tuple((value, score) for value, score in dead_stock["bands"])
    assert dead_stock["score"] == round(branch_health.score_from_bands(dead_stock["value"], bands), 1)


def test_a_calculation_names_the_figures_behind_the_number():
    scored = branch_health.score_branch(_snapshot(dead_stock_count=32, sku_count=100))
    dead_stock = next(
        m
        for m in _dimension(scored, "inventory")["sub_metrics"]
        if m["key"] == "dead_stock_share_pct"
    )
    assert dead_stock["calculation"] == "32 of 100 products with stock."

    revenue = next(
        m for m in _dimension(scored, "sales")["sub_metrics"] if m["key"] == "revenue_growth_pct"
    )
    # Myanmar Kyat, no decimals — see _ks.
    assert "Ks 110,000" in revenue["calculation"]
    assert "Ks 100,000" in revenue["calculation"]


def test_an_unmeasurable_measure_has_no_calculation_to_show():
    """No value means no figures behind it — better an empty field than a sentence
    describing a number the page isn't showing."""
    scored = branch_health.score_branch(_snapshot(sku_count=0, aged_stock_judged_count=0, days_of_inventory_on_hand=None))
    for measure in _dimension(scored, "inventory")["sub_metrics"]:
        assert measure["value"] is None
        assert measure["calculation"] is None
        # The definition still shows: it says what the measure *would* be.
        assert measure["definition"].strip()


def test_build_snapshot_computes_conversion_rate_for_tracked_days(db_session: Session):
    branch = _make_branch(db_session, "Conversion Branch")
    product = _make_product(db_session, "CONV-SKU-1")
    today = datetime.date.today()
    yesterday = today - datetime.timedelta(days=1)

    # Yesterday: tracked day with 2 sales and 1 walkout -> 2 / (2 + 1) = 66.67%
    _make_sale(db_session, branch=branch, product=product, slip_id="conv-1", sale_date=yesterday, qty=1, net_amount=1000)
    _make_sale(db_session, branch=branch, product=product, slip_id="conv-2", sale_date=yesterday, qty=1, net_amount=1000)
    _make_zero_selling(db_session, branch=branch, sale_date=yesterday)

    # Today: untracked day with 1 sale, no zero-selling records
    _make_sale(db_session, branch=branch, product=product, slip_id="conv-3", sale_date=today, qty=1, net_amount=1000)
    db_session.commit()

    period_range = branch_health.resolve_period("30d")
    snapshot = branch_health.build_snapshot(db_session, branch.id, period_range)

    assert snapshot.conversion_days_recorded == 1
    assert snapshot.conversion_sales_slips == 2
    assert snapshot.conversion_zero_count == 1
    assert snapshot.conversion_rate_pct == pytest.approx(66.67, rel=1e-2)



def test_aged_stock_ignores_products_with_no_purchase_on_file(db_session):
    """A stock file only says when the app first saw a product, not when it was bought, so
    a product with no purchase record is left out of both the aged count and the count it
    is measured against, rather than being judged on a date that means nothing."""
    from datetime import date, timedelta

    from app.models.branch import Branch
    from app.retail.models.product import Product
    from app.retail.models.purchase import Purchase, PurchaseLine
    from app.retail.models.stock_level import StockLevel

    branch = Branch(id="br_aged", name="Aged Branch", phone_number="1", address="x")
    db_session.add(branch)
    today = date(2026, 9, 24)
    old, recent, unknown = (
        Product(id="p_old", stock_code="OLD", description="Old"),
        Product(id="p_recent", stock_code="RECENT", description="Recent"),
        Product(id="p_unknown", stock_code="UNKNOWN", description="Unknown"),
    )
    db_session.add_all([old, recent, unknown])
    db_session.flush()
    snapshot_at = datetime.datetime(2026, 9, 23, 12, 0, 0)
    for product in (old, recent, unknown):
        db_session.add(
            StockLevel(
                branch_id=branch.id, product_id=product.id, on_hand_qty=5, snapshot_at=snapshot_at
            )
        )
    # "restocked" was first bought long ago but topped up last week, so it is not aged.
    restocked = Product(id="p_restocked", stock_code="RESTOCKED", description="Restocked")
    db_session.add(restocked)
    db_session.flush()
    db_session.add(
        StockLevel(branch_id=branch.id, product_id=restocked.id, on_hand_qty=5, snapshot_at=snapshot_at)
    )
    for purchase_id, product, days_ago in (
        ("pu_old", old, 300),
        ("pu_recent", recent, 10),
        ("pu_restocked_first", restocked, 400),
        ("pu_restocked_last", restocked, 7),
    ):
        db_session.add(
            Purchase(id=purchase_id, branch_id=branch.id, purchase_date=today - timedelta(days=days_ago))
        )
        db_session.flush()
        db_session.add(
            PurchaseLine(purchase_id=purchase_id, product_id=product.id, quantity=5, buying_price=100)
        )
    db_session.commit()

    aged, judged = branch_health.aged_stock_for_branch(db_session, branch.id, today=today)
    assert [item["stock_code"] for item in aged] == ["OLD"]
    assert judged == 3  # UNKNOWN has no purchase, so it is neither aged nor counted


def test_sales_health_scores_quantity_sold_not_product_variety():
    sales_dim = next(d for d in branch_health.DIMENSIONS if d.key == "sales")
    assert [s.key for s in sales_dim.sub_metrics] == [
        "revenue_growth_pct",
        "avg_basket_growth_pct",
        "quantity_sold_growth_pct",
    ]
    assert [s.weight for s in sales_dim.sub_metrics] == [0.5, 0.3, 0.2]

    # 90 pairs against 100 last year: down 10%, which scores like a 10% fall in revenue.
    scored = branch_health.score_branch(_snapshot(quantity_sold=90.0, previous_quantity_sold=100.0))
    quantity = next(
        m for m in _dimension(scored, "sales")["sub_metrics"] if m["key"] == "quantity_sold_growth_pct"
    )
    assert round(quantity["value"], 1) == -10.0
    assert quantity["score"] == 40.0
    assert quantity["calculation"] == "90 pairs sold this period, against 100 last year."


# --- stock allocation (move slow-moving stock to another branch) ---------------------


def _allocation_setup(db_session: Session, *, sold: float, there_on_hand: float, here_on_hand: float = 30):
    here = _make_branch(db_session, "Here")
    there = _make_branch(db_session, "There")
    product = _make_product(db_session, "SH-001", "Oxford")
    today = datetime.date.today()
    now = datetime.datetime.now()
    db_session.add(StockLevel(branch_id=here.id, product_id=product.id, on_hand_qty=here_on_hand, snapshot_at=now))
    db_session.add(StockLevel(branch_id=there.id, product_id=product.id, on_hand_qty=there_on_hand, snapshot_at=now))
    _make_sale(
        db_session, branch=there, product=product, slip_id="s1",
        sale_date=today - datetime.timedelta(days=5), qty=sold, net_amount=sold * 10,
    )
    db_session.commit()
    dead = [{"stock_code": "SH-001", "description": "Oxford", "on_hand_qty": here_on_hand}]
    return here, there, dead


def test_stock_allocation_nets_off_what_the_selling_branch_already_holds(db_session: Session):
    here, there, dead = _allocation_setup(db_session, sold=40, there_on_hand=25)
    (item,) = branch_health._find_stock_allocations(db_session, here.id, dead)
    assert item["target_branch_id"] == there.id
    assert item["target_on_hand_qty"] == 25
    # It sold 40 and has 25 left, so it is short 15 — not the full 30 it could receive.
    assert item["recommended_transfer_qty"] == 15


def test_stock_allocation_skipped_when_selling_branch_already_has_enough(db_session: Session):
    here, _, dead = _allocation_setup(db_session, sold=10, there_on_hand=50)
    assert branch_health._find_stock_allocations(db_session, here.id, dead) == ()


def test_stock_allocation_never_recommends_more_than_is_on_hand_here(db_session: Session):
    here, _, dead = _allocation_setup(db_session, sold=100, there_on_hand=0, here_on_hand=30)
    (item,) = branch_health._find_stock_allocations(db_session, here.id, dead)
    assert item["recommended_transfer_qty"] == 30


def test_stock_allocation_is_not_capped_at_ten_products(db_session: Session):
    here = _make_branch(db_session, "Here")
    there = _make_branch(db_session, "There")
    now = datetime.datetime.now()
    dead = []
    for i in range(12):
        product = _make_product(db_session, f"P{i:02d}", f"Item {i}")
        db_session.add(StockLevel(branch_id=here.id, product_id=product.id, on_hand_qty=5, snapshot_at=now))
        _make_sale(
            db_session, branch=there, product=product, slip_id=f"s{i}",
            sale_date=datetime.date.today() - datetime.timedelta(days=3), qty=10, net_amount=100,
        )
        dead.append({"stock_code": product.stock_code, "description": product.description, "on_hand_qty": 5})
    db_session.commit()
    assert len(branch_health._find_stock_allocations(db_session, here.id, dead)) == 12
