import datetime

import pytest

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.product import Product
from app.models.sale import Sale, SaleLine
from app.models.stock_level import StockLevel
from app.models.user import User, UserRole
from app.services import early_warning
from app.services.branch_health import DIMENSIONS, BranchSnapshot


def _snapshot(**overrides) -> BranchSnapshot:
    """A branch with nothing wrong with it. Every test changes one thing and asserts
    which alert that one thing raised, so a failure names the rule that broke."""
    base = dict(
        # Real dates, because an alert states which days it is describing and which it
        # compares against — a snapshot without them would quietly test a panel missing
        # its first line.
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
        stock_as_of="2026-09-01T00:00:00",
        at_risk_count=0,
        at_risk_demand_driven_count=0,
        at_risk_leading_item=None,
        at_risk_top_items=(),
        avg_items_per_basket=3.0,
        previous_avg_items_per_basket=3.0,
        single_item_basket_share_pct=20.0,
        previous_single_item_basket_share_pct=20.0,
        data_issue_count=0,
        critical_data_issue_count=0,
        data_issue_sections=(),
        records_checked=1000,
        period_days=30,
    )
    base.update(overrides)
    return BranchSnapshot(**base)


def _ids(alerts) -> list[str]:
    return [alert.id for alert in alerts]


def _by_id(alerts, alert_id: str):
    return next(alert for alert in alerts if alert.id == alert_id)


# --- the engine itself ----------------------------------------------------------------


def test_a_healthy_branch_raises_nothing():
    """An alert list that always has something in it is one nobody reads."""
    assert early_warning.evaluate(_snapshot()) == []


def test_every_alert_carries_an_action_and_somewhere_to_look():
    """An alert a manager can't act on, or can't investigate, is just anxiety — so this
    holds for every rule at once rather than being re-asserted rule by rule."""
    alerts = early_warning.evaluate(
        _snapshot(
            net_revenue=70_000.0,
            gross_margin_pct=4.0,
            critical_count=3,
            dead_stock_count=40,
            single_item_basket_share_pct=80.0,
            data_issue_sections=(
                {"id": "sale_numeric", "title": "Sale — fix these numbers", "description": "d", "severity": "warning", "count": 2},
            ),
        )
    )
    assert len(alerts) >= 5
    valid_links = {"revenue", "cost", "inventory", "customer", "warnings"}
    for alert in alerts:
        assert alert.recommended_action.strip()
        assert alert.what_happened.strip()
        assert alert.link in valid_links
        assert alert.severity in {early_warning.CRITICAL, early_warning.WARNING}
    assert len({alert.id for alert in alerts}) == len(alerts)


def test_critical_alerts_sort_ahead_of_warnings():
    alerts = early_warning.evaluate(
        _snapshot(net_revenue=88_000.0, critical_count=2)  # -12% revenue (warning), stockout (critical)
    )
    assert _ids(alerts) == ["stockout_risk", "revenue_decline"]


def test_thresholds_are_injectable_so_the_business_can_tune_them():
    """Phase 5 will build these from app_settings; the rules already take them as an
    argument, so tuning must not need a code change."""
    snapshot = _snapshot(net_revenue=97_000.0)  # -3%: quiet at every default level
    assert early_warning.evaluate(snapshot) == []
    strict = early_warning.Thresholds(revenue_decline_normal_pct=-2.0, revenue_decline_warning_pct=-2.0)
    assert _ids(early_warning.evaluate(snapshot, strict)) == ["revenue_decline"]


# --- individual rules -----------------------------------------------------------------


def test_revenue_decline_escalates_from_normal_to_warning_to_critical():
    assert early_warning.evaluate(_snapshot(net_revenue=97_000.0)) == []  # -3%, quiet
    normal = _by_id(early_warning.evaluate(_snapshot(net_revenue=94_000.0)), "revenue_decline")
    assert normal.severity == early_warning.NORMAL
    assert normal.title == "Revenue is drifting down"
    warning = _by_id(early_warning.evaluate(_snapshot(net_revenue=88_000.0)), "revenue_decline")
    assert warning.severity == early_warning.WARNING
    assert "12.0%" in warning.what_happened
    critical = _by_id(early_warning.evaluate(_snapshot(net_revenue=70_000.0)), "revenue_decline")
    assert critical.severity == early_warning.CRITICAL


def test_a_normal_alert_still_carries_an_action_and_never_reads_as_urgent():
    """The point of the third level is that it asks for nothing today — so its action has
    to say so, or it is just a warning wearing a different badge."""
    normal = _by_id(early_warning.evaluate(_snapshot(net_revenue=94_000.0)), "revenue_decline")
    assert normal.severity == early_warning.NORMAL
    assert normal.recommended_action.startswith("Nothing to act on yet")


def test_normal_alerts_sort_below_the_ones_that_need_a_decision():
    alerts = early_warning.evaluate(
        _snapshot(net_revenue=94_000.0, critical_count=2, single_item_basket_share_pct=55.0)
    )
    severities = [alert.severity for alert in alerts]
    assert severities == sorted(severities, key=lambda s: early_warning._SEVERITY_RANK[s])
    assert severities[0] == early_warning.CRITICAL
    assert severities[-1] == early_warning.NORMAL


def test_an_empty_period_is_reported_as_a_missing_import_not_a_100pct_collapse():
    """A period with no sales at all, after one that had them, is nearly always a file
    nobody imported — sending a manager to investigate the shop floor over it would be
    the single most annoying thing this engine could do."""
    alerts = early_warning.evaluate(_snapshot(net_revenue=0.0, transaction_count=0, avg_basket=0.0))
    assert _ids(alerts) == ["no_sales_recorded"]
    assert "Import History" in _by_id(alerts, "no_sales_recorded").recommended_action


def test_a_brand_new_branch_with_no_history_raises_no_revenue_alert():
    assert early_warning.evaluate(_snapshot(previous_net_revenue=0.0, previous_transaction_count=0)) == []


def test_margin_reports_the_floor_or_the_slip_but_never_both():
    """One rule owns the whole margin conversation, so a branch that is both below the
    floor and falling gets one alert about it, not two."""
    both = early_warning.evaluate(_snapshot(gross_margin_pct=6.0, previous_gross_margin_pct=25.0))
    margin_alerts = [a for a in both if a.dimension == "profit"]
    assert _ids(margin_alerts) == ["low_margin"]

    slipping = early_warning.evaluate(_snapshot(gross_margin_pct=20.0, previous_gross_margin_pct=30.0))
    assert _ids([a for a in slipping if a.dimension == "profit"]) == ["margin_slipping"]

    assert _by_id(early_warning.evaluate(_snapshot(gross_margin_pct=3.0)), "low_margin").severity == (
        early_warning.CRITICAL
    )


def test_margin_stays_quiet_when_too_little_of_the_revenue_is_costed():
    """The same coverage gate the Profit score uses — an estimate covering a minority
    of revenue is not solid enough to raise an alarm someone would act on."""
    assert early_warning.evaluate(_snapshot(gross_margin_pct=2.0, cost_coverage_pct=20.0)) == []


def test_stockout_beats_low_stock_rather_than_firing_alongside_it():
    critical = early_warning.evaluate(_snapshot(critical_count=2, low_count=5))
    assert _ids(critical) == ["stockout_risk"]
    assert critical[0].severity == early_warning.CRITICAL
    low = early_warning.evaluate(_snapshot(low_count=5))
    assert _ids(low) == ["low_stock"]
    assert low[0].severity == early_warning.WARNING


def test_stock_alert_hands_over_the_products_and_what_can_be_counted_on_the_shelf():
    """A count of low products is unactionable on its own: nobody reorders eighty lines
    off one sentence. The table names the few with the least cover left and, for each,
    the two figures the shop can verify by looking — how many are there and how many
    sold — plus how long that lasts. It says how many it left out, so five rows under a
    count of eighty never read as the whole list."""
    items = (
        {
            "stock_code": "BEV-014",
            "description": "Coffee Mix",
            "days_left": 1.8,
            "status": "Critical",
            "on_hand_qty": 10.0,
            "sold_recent_qty": 150,
            "demand_ratio": 2.4,
            "selling_faster": True,
        },
        {
            "stock_code": "SOP-200",
            "description": "Soap 200g",
            "days_left": 6.2,
            "status": "Low",
            "on_hand_qty": 40.0,
            "sold_recent_qty": 195,
            "demand_ratio": 0.9,
            "selling_faster": False,
        },
    )
    alert = _by_id(
        early_warning.evaluate(
            _snapshot(
                low_count=80,
                at_risk_count=80,
                at_risk_leading_item=dict(items[0]),
                at_risk_top_items=items,
            )
        ),
        "low_stock",
    )
    assert alert.table is not None
    assert [column["label"] for column in alert.table["columns"]] == [
        "Product",
        "In shop",
        "Sold 30d",
        "Lasts",
    ]
    assert alert.table["rows"][0] == ["BEV-014 · Coffee Mix", "10", "150", "2 days"]
    assert alert.table["note"] == "78 more on the Inventory tab"


def test_stock_alert_says_nothing_about_products_selling_faster():
    """The demand/drawdown split was removed on purpose (see _stock_why): at shoe-shop
    volumes it rested on a handful of sales and read far firmer than the evidence."""
    alert = _by_id(early_warning.evaluate(_snapshot(low_count=2, at_risk_count=2)), "low_stock")
    assert "faster" not in (alert.driver or "")
    assert alert.interpretation is None
    assert alert.evidence is None


def test_the_customer_alert_carries_no_revenue_split():
    """It is an alert about people, not about money moving between two causes. The
    business asked for the "where the Ks came from" bars to go from this one; the revenue
    alert still has them, because there the money *is* the subject."""
    alert = _by_id(
        early_warning.evaluate(
            _snapshot(transaction_count=60, previous_transaction_count=100, avg_basket=1834.0)
        ),
        "traffic_decline",
    )
    assert alert.evidence is None
    assert [fact["label"] for fact in alert.facts] == [
        "Sales",
        "Customers served",
        "Average sale",
        "Items per sale",
    ]


def test_a_stock_alert_with_nothing_at_risk_carries_no_table():
    """`watch_stock` is the one stock alert raised without a Critical or Low product
    behind it, so there is no shortlist to show — and an empty table would read as
    "no products" rather than "there is nothing to order yet"."""
    alert = _by_id(early_warning.evaluate(_snapshot(watch_count=4)), "watch_stock")
    assert alert.table is None
    assert alert.evidence is None


def test_dead_stock_fires_on_share_not_raw_count():
    """Twelve dead SKUs is nothing in a 1,000-product shop and serious in a 40-product
    one, so the rule has to read the proportion."""
    assert early_warning.evaluate(_snapshot(dead_stock_count=12, sku_count=1000)) == []
    small_shop = early_warning.evaluate(_snapshot(dead_stock_count=12, sku_count=40))
    assert _ids(small_shop) == ["dead_stock"]
    assert small_shop[0].severity == early_warning.CRITICAL  # 30% share
    assert "12 of 40" in small_shop[0].what_happened


def test_traffic_alert_needs_both_halves_of_the_pattern():
    """Fewer visits *and* bigger baskets. Falling transactions alone is already told by
    the revenue alert; it is the combination that says the shop lost footfall rather
    than lost demand."""
    both = early_warning.evaluate(_snapshot(transaction_count=85, avg_basket=1300.0, net_revenue=110_500.0))
    assert "traffic_decline" in _ids(both)
    # Transactions down, baskets down too — ordinary decline, not the footfall pattern.
    ordinary = early_warning.evaluate(_snapshot(transaction_count=85, avg_basket=900.0, net_revenue=76_500.0))
    assert "traffic_decline" not in _ids(ordinary)


def test_single_item_basket_share_fires_above_its_threshold():
    assert early_warning.evaluate(_snapshot(single_item_basket_share_pct=40.0)) == []
    normal = _by_id(
        early_warning.evaluate(_snapshot(single_item_basket_share_pct=55.0)), "single_item_baskets"
    )
    assert normal.severity == early_warning.NORMAL
    warning = _by_id(
        early_warning.evaluate(_snapshot(single_item_basket_share_pct=70.0)), "single_item_baskets"
    )
    assert warning.severity == early_warning.WARNING


def test_stock_reports_only_the_worst_of_its_three_levels():
    """One rule owns one subject, and that still holds now the subject has three levels:
    a branch with products at every level hears about the ones running out, not about
    the ones with a fortnight of cover."""
    watch_only = _by_id(early_warning.evaluate(_snapshot(watch_count=4)), "watch_stock")
    assert watch_only.severity == early_warning.NORMAL
    assert _ids(early_warning.evaluate(_snapshot(watch_count=4, low_count=2))) == ["low_stock"]
    assert _ids(early_warning.evaluate(_snapshot(watch_count=4, critical_count=1))) == ["stockout_risk"]


def test_dead_stock_and_margin_have_a_normal_tier_below_their_warning_one():
    dead = _by_id(early_warning.evaluate(_snapshot(dead_stock_count=7)), "dead_stock")
    assert dead.severity == early_warning.NORMAL
    assert dead.title == "Some stock is not moving"
    assert early_warning.evaluate(_snapshot(dead_stock_count=3)) == []

    margin = _by_id(early_warning.evaluate(_snapshot(gross_margin_pct=13.0)), "low_margin")
    assert margin.severity == early_warning.NORMAL
    slipping = _by_id(
        early_warning.evaluate(_snapshot(gross_margin_pct=28.0, previous_gross_margin_pct=30.0)),
        "margin_slipping",
    )
    assert slipping.severity == early_warning.NORMAL
    assert slipping.title == "Margin has edged down"


def test_alerts_carry_their_figures_as_data_not_only_as_sentences():
    """The detail panel lays the figures out as labelled rows, so they travel as data.
    They must be the same figures the sentences were built from — computed once, here,
    and formatted here too, so a row can never round differently from the sentence beside
    it."""
    alert = _by_id(early_warning.evaluate(_snapshot(net_revenue=88_000.0)), "revenue_decline")
    rows = {fact["label"]: fact for fact in alert.facts}
    assert set(rows) == {"Sales", "Customers served", "Average sale"}
    assert rows["Sales"]["after"] == "Ks 88,000"
    # A real minus sign: the same column carries "\u2212Ks 1,175,057" elsewhere, and a
    # hyphen beside it looks like a different character, because it is.
    assert rows["Sales"]["change"] == "\u221212.0%"
    # And the reader is told which days are being compared, since every one of those
    # movements is "against" something.
    assert alert.context is not None and " vs " in alert.context

    # The split is the evidence panel's whole claim: the parts sum to the actual change.
    parts = sum(part["amount"] for part in alert.evidence["parts"])
    assert alert.evidence["kind"] == "revenue_split"
    assert parts == pytest.approx(alert.evidence["total_change"], abs=0.01)
    assert alert.evidence["to_total"] - alert.evidence["from_total"] == pytest.approx(
        alert.evidence["total_change"], abs=0.01
    )


def test_an_unmeasurable_figure_is_left_blank_rather_than_shown_as_a_zero():
    """Same rule as the score itself: nothing measured is nothing shown, never a 0. With
    no comparable previous margin, every row still appears — the figures for *this*
    period are real — but nothing claims what they were before or by how much they
    moved."""
    alert = _by_id(
        early_warning.evaluate(_snapshot(gross_margin_pct=8.0, previous_gross_margin_pct=None)),
        "low_margin",
    )
    for fact in alert.facts:
        assert fact["after"] is not None
        assert fact["before"] is None
        assert fact["change"] is None
    assert alert.evidence is None


def test_every_rule_that_can_show_figures_does():
    """A rule that quietly stops carrying its figures would leave an empty detail panel,
    which looks identical to a rule that has none to show."""
    cases = {
        "revenue_decline": _snapshot(net_revenue=88_000.0),
        "low_margin": _snapshot(gross_margin_pct=8.0),
        "margin_slipping": _snapshot(gross_margin_pct=25.0, previous_gross_margin_pct=30.0),
        "stockout_risk": _snapshot(critical_count=2),
        "low_stock": _snapshot(low_count=3),
        "watch_stock": _snapshot(watch_count=4),
        "dead_stock": _snapshot(dead_stock_count=30),
        "single_item_baskets": _snapshot(single_item_basket_share_pct=70.0),
    }
    for alert_id, snapshot in cases.items():
        alert = _by_id(early_warning.evaluate(snapshot), alert_id)
        assert alert.facts, f"{alert_id} carries no figures"


def test_data_quality_alerts_reuse_the_warning_pages_own_titles_and_severities():
    """This engine holds no second opinion about what counts as a data problem — it
    surfaces what data_quality.py already found and links back to it."""
    alerts = early_warning.evaluate(
        _snapshot(
            data_issue_sections=(
                {
                    "id": "reconciliation_mismatch",
                    "title": "Daily inventory check — recount these",
                    "description": "The latest snapshot doesn't match.",
                    "severity": "critical",
                    "count": 4,
                },
                {
                    "id": "sale_numeric",
                    "title": "Sale — fix these numbers",
                    "description": "A price looks wrong.",
                    "severity": "warning",
                    "count": 9,
                },
            )
        )
    )
    assert _ids(alerts) == ["data_quality_reconciliation_mismatch", "data_quality_sale_numeric"]
    assert alerts[0].severity == "critical"
    assert alerts[0].title == "Daily inventory check — recount these"
    assert "4 rows" in alerts[0].what_happened
    assert all(alert.link == "warnings" for alert in alerts)


# --- endpoint -------------------------------------------------------------------------


def _make_branch(db_session: Session, name: str = "Retail 1") -> Branch:
    branch = Branch(name=name, phone_number="000", address="TBD")
    db_session.add(branch)
    db_session.flush()
    return branch


def _make_sale(db_session, *, branch, product, slip_id, sale_date, qty, net_amount) -> None:
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


def test_overview_endpoint_returns_alerts_alongside_the_scores(
    authed_client: TestClient, db_session: Session
):
    branch = _make_branch(db_session)
    db_session.add(
        User(id="test-user-id", name="Tester", email="t@example.com", role=UserRole.RETAIL, branch_id=branch.id)
    )
    sold = Product(stock_code="SKU-SOLD", description="Sells sometimes")
    never_sold = Product(stock_code="SKU-DEAD", description="Sitting there")
    db_session.add_all([sold, never_sold])
    db_session.flush()
    today = datetime.date.today()
    # Sales in the previous 30-day window but none in this one — the missing-import case.
    _make_sale(
        db_session,
        branch=branch,
        product=sold,
        slip_id="old-1",
        sale_date=today - datetime.timedelta(days=40),
        qty=1,
        net_amount=5000,
    )
    # On the shelf and never sold at all, so it is outside the 90-day dead-stock window
    # too — the sold product above is not dead stock, since 40 days ago is inside it.
    db_session.add(
        StockLevel(
            branch_id=branch.id,
            product_id=never_sold.id,
            on_hand_qty=50,
            buying_price=100,
            selling_price=200,
            snapshot_at=datetime.datetime.now(),
        )
    )
    db_session.commit()

    body = authed_client.get("/api/dashboard/overview?period=30d").json()
    alert_ids = [alert["id"] for alert in body["alerts"]]
    assert "no_sales_recorded" in alert_ids
    assert "dead_stock" in alert_ids
    # Criticals first, and every alert is a complete, actionable row.
    severities = [alert["severity"] for alert in body["alerts"]]
    assert severities == sorted(severities, key=lambda s: 0 if s == "critical" else 1)
    for alert in body["alerts"]:
        assert alert["title"] and alert["what_happened"] and alert["recommended_action"]
        assert alert["dimension"] in {d.key for d in DIMENSIONS}


def test_overview_of_a_quiet_branch_returns_no_alerts(authed_client: TestClient, db_session: Session):
    branch = _make_branch(db_session)
    db_session.add(
        User(id="test-user-id", name="Tester", email="t@example.com", role=UserRole.RETAIL, branch_id=branch.id)
    )
    db_session.commit()

    body = authed_client.get("/api/dashboard/overview?period=30d").json()
    assert body["alerts"] == []


# --- business-configured thresholds ---------------------------------------------------


def test_saved_thresholds_reach_the_overview_endpoint(authed_client: TestClient, db_session: Session):
    """The rules already took thresholds as an argument; this is the wire from the
    Settings page to that argument, end to end."""
    branch = _make_branch(db_session)
    db_session.add(
        User(id="test-user-id", name="Admin", email="admin@example.com", role=UserRole.ADMIN)
    )
    product = Product(stock_code="SKU-1", description="Widget")
    db_session.add(product)
    db_session.flush()
    today = datetime.date.today()
    # Revenue down 3%: quiet at every default firing point, including the -5% normal one.
    _make_sale(
        db_session, branch=branch, product=product, slip_id="now", sale_date=today, qty=1, net_amount=970
    )
    _make_sale(
        db_session,
        branch=branch,
        product=product,
        slip_id="before",
        sale_date=today - datetime.timedelta(days=40),
        qty=1,
        net_amount=1000,
    )
    db_session.commit()

    quiet = authed_client.get(f"/api/dashboard/overview?branch_id={branch.id}&period=30d").json()
    assert "revenue_decline" not in [alert["id"] for alert in quiet["alerts"]]

    response = authed_client.put(
        "/api/settings",
        json={
            "early_warning_thresholds": {
                "revenue_decline_normal_pct": -2.0,
                "revenue_decline_warning_pct": -2.0,
                "revenue_decline_critical_pct": -20.0,
                "low_margin_normal_pct": 15.0,
                "low_margin_warning_pct": 10.0,
                "low_margin_critical_pct": 5.0,
                "margin_slip_normal_pp": -1.0,
                "margin_slip_warning_pp": -3.0,
                "dead_stock_normal_share_pct": 5.0,
                "dead_stock_warning_share_pct": 10.0,
                "dead_stock_critical_share_pct": 25.0,
                "traffic_decline_warning_pct": -10.0,
                "single_item_basket_normal_share_pct": 45.0,
                "single_item_basket_warning_share_pct": 60.0,
            }
        },
    )
    assert response.status_code == 200

    noisy = authed_client.get(f"/api/dashboard/overview?branch_id={branch.id}&period=30d").json()
    raised = [alert for alert in noisy["alerts"] if alert["id"] == "revenue_decline"]
    assert [alert["severity"] for alert in raised] == ["warning"]


def test_a_threshold_set_saved_before_a_rule_existed_still_works(
    authed_client: TestClient, db_session: Session
):
    """A saved dict missing a key that was added later must fall back to that key's
    default rather than leaving a hole for the rules to trip over."""
    from app.services.settings import get_early_warning_thresholds, set_setting

    _make_branch(db_session)
    set_setting(db_session, "early_warning_thresholds", {"revenue_decline_warning_pct": -4.0})
    thresholds = get_early_warning_thresholds(db_session)
    assert thresholds["revenue_decline_warning_pct"] == -4.0
    assert thresholds["single_item_basket_warning_share_pct"] == 60.0
    assert early_warning.Thresholds(**thresholds).dead_stock_warning_share_pct == 10.0


def test_every_alert_names_a_measure_that_exists():
    """The Overview branch page shows an alert inside the row of the measure it is about,
    so a typo here would silently hide it — and this is the only thing that would catch
    it, since a wrong key looks exactly like a branch with no alerts."""
    from app.services.branch_health import DIMENSIONS

    measure_keys = {measure.key for dimension in DIMENSIONS for measure in dimension.sub_metrics}
    alerts = early_warning.evaluate(
        _snapshot(
            net_revenue=88_694.0,
            transaction_count=82,
            avg_basket=1300.0,
            critical_count=1,
            low_count=2,
            dead_stock_count=323,
            sku_count=629,
            single_item_basket_share_pct=70.0,
            gross_margin_pct=6.0,
            previous_gross_margin_pct=6.2,
            at_risk_count=3,
            at_risk_demand_driven_count=3,
            at_risk_leading_item=_at_risk_leading_item(),
            data_issue_sections=(
                {"id": "sale_numeric", "title": "T", "description": "d", "severity": "warning", "count": 3},
                {
                    "id": "reconciliation_mismatch",
                    "title": "M",
                    "description": "d",
                    "severity": "critical",
                    "count": 2,
                },
            ),
        )
    )
    assert len(alerts) >= 6
    for alert in alerts:
        assert alert.measure in measure_keys, (alert.id, alert.measure)

    # The rules that have no measure of their own are covered too.
    empty = early_warning.evaluate(_snapshot(net_revenue=0.0, transaction_count=0, avg_basket=0.0))
    assert _by_id(empty, "no_sales_recorded").measure in measure_keys


def _at_risk_leading_item() -> dict:
    return {
        "stock_code": "BEV-014",
        "description": "Coffee Mix",
        "days_left": 1.8,
        "status": "Critical",
        "demand_ratio": 2.4,
    }
