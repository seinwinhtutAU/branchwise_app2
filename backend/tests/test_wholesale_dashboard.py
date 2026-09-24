from datetime import date
from types import SimpleNamespace

from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.wholesale.models.entities import (
    CustomerOrder,
    CustomerOrderLine,
    ProductGroup,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesalePayment,
    WholesaleStockMovement,
    WholesaleUnit,
)
from app.wholesale.services.dashboard import (
    UNKNOWN_FACTORY,
    _buying_price,
    _price_history,
    customer_dashboard,
    inventory_dashboard,
    revenue_dashboard,
)


def _window() -> SimpleNamespace:
    return SimpleNamespace(
        period="custom",
        start=date(2026, 9, 1),
        end=date(2026, 9, 7),
        previous_start=date(2026, 8, 25),
        previous_end=date(2026, 8, 31),
    )


def _branch(db: Session) -> Branch:
    branch = Branch(name="Wholesale", phone_number="", address="")
    db.add(branch)
    db.flush()
    return branch


def _order(
    db: Session,
    branch_id: str,
    order_no: str,
    order_date: date,
    *,
    customer: str = "Ma Su Su",
    cancelled: bool = False,
    stock_code: str = "A-1",
    pairs: int = 10,
) -> CustomerOrder:
    order = CustomerOrder(
        branch_id=branch_id,
        order_no=order_no,
        customer_name=customer,
        customer_phone="",
        customer_address="",
        order_date=order_date,
        cancelled=cancelled,
        lines=[CustomerOrderLine(
            stock_code=stock_code,
            description="Sandal",
            product_group=ProductGroup.MAN,
            supplier_name="Factory",
            color_breakdown="black10p",
            colors=[],
            unit=WholesaleUnit.PAIR,
            quantity_pairs=pairs,
            selling_price=100,
        )],
    )
    db.add(order)
    db.flush()
    return order


def _delivery(db: Session, branch_id: str, order: CustomerOrder, pairs: int, on: date, stock_code: str = "A-1") -> WholesaleStockMovement:
    movement = WholesaleStockMovement(
        branch_id=branch_id,
        order_id=order.id,
        stock_code=stock_code,
        description="Sandal",
        product_group=ProductGroup.MAN,
        color_breakdown=f"black{pairs}p",
        colors=[],
        quantity_pairs=pairs,
        location="Gate",
        delivered_on=on,
        recorded_by_user_id="test-user-id",
    )
    db.add(movement)
    return movement


def _voucher(db: Session, branch_id: str, supplier: str, on: date, stock_code: str = "A-1", price: float = 60.0) -> SupplierVoucher:
    voucher = SupplierVoucher(
        branch_id=branch_id,
        voucher_no=f"VCH-{supplier}-{on.isoformat()}",
        supplier_name=supplier,
        voucher_date=on,
        lines=[SupplierVoucherLine(
            stock_code=stock_code,
            description="Sandal",
            product_group=ProductGroup.MAN,
            color_breakdown="black20p",
            colors=[],
            unit=WholesaleUnit.PAIR,
            quantity_pairs=20,
            buying_price=price,
        )],
    )
    db.add(voucher)
    db.flush()
    return voucher


def test_revenue_is_delivery_based_and_excludes_cancelled_orders(db_session: Session) -> None:
    branch = _branch(db_session)
    _order(db_session, branch.id, "ORD-1", date(2026, 9, 2))
    delivered = _order(db_session, branch.id, "ORD-2", date(2026, 8, 30))
    cancelled = _order(db_session, branch.id, "ORD-3", date(2026, 9, 3), cancelled=True)
    _delivery(db_session, branch.id, delivered, 4, date(2026, 9, 4))
    _delivery(db_session, branch.id, cancelled, 10, date(2026, 9, 4))
    db_session.add(WholesalePayment(
        branch_id=branch.id, order_id=delivered.id, paid_on=date(2026, 9, 5), amount=150,
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()

    result = revenue_dashboard(db_session, branch.id, _window())

    assert result["delivered_revenue"]["value"] == 400
    assert result["collected"]["value"] == 150
    assert [day["delivered_revenue"] for day in result["trend"]] == [0, 0, 0, 400, 0, 0, 0]


def test_revenue_by_factory_follows_the_latest_voucher_before_each_delivery(db_session: Session) -> None:
    branch = _branch(db_session)
    order = _order(db_session, branch.id, "ORD-1", date(2026, 9, 1), pairs=20)
    _voucher(db_session, branch.id, "Goody Factory", date(2026, 8, 20))
    _voucher(db_session, branch.id, "Lek", date(2026, 9, 3))
    # Before Lek's voucher this product came from Goody; after it, from Lek.
    _delivery(db_session, branch.id, order, 3, date(2026, 9, 2))
    _delivery(db_session, branch.id, order, 5, date(2026, 9, 5))
    db_session.commit()

    result = revenue_dashboard(db_session, branch.id, _window())

    assert {row["factory_name"]: row["delivered_revenue"] for row in result["factories"]} == {
        "Goody Factory": 300,
        "Lek": 500,
    }
    assert result["factories"][0]["factory_name"] == "Lek"
    assert round(result["top_factory_share_pct"], 1) == 62.5


def test_a_delivery_with_no_earlier_voucher_is_not_dropped_from_the_factories(db_session: Session) -> None:
    branch = _branch(db_session)
    order = _order(db_session, branch.id, "ORD-1", date(2026, 9, 1))
    _delivery(db_session, branch.id, order, 2, date(2026, 9, 2))
    db_session.commit()

    result = revenue_dashboard(db_session, branch.id, _window())

    assert result["factories"] == [{"factory_name": UNKNOWN_FACTORY, "delivered_revenue": 200}]


def test_revenue_receivables_are_taken_as_of_the_end_of_the_window(db_session: Session) -> None:
    branch = _branch(db_session)
    order = _order(db_session, branch.id, "ORD-1", date(2026, 9, 1))  # 10 pairs at 100
    db_session.add(WholesalePayment(
        branch_id=branch.id, order_id=order.id, paid_on=date(2026, 9, 10), amount=300,
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()

    # The 300 was paid after the window ended, so it does not reduce what was owed then.
    assert revenue_dashboard(db_session, branch.id, _window())["receivables"] == 1000


def test_empty_dashboards_return_zeroed_shapes(db_session: Session) -> None:
    window = _window()

    revenue = revenue_dashboard(db_session, None, window)
    customer = customer_dashboard(db_session, None, window)
    inventory = inventory_dashboard(db_session, None)

    assert revenue["delivered_revenue"]["value"] == 0
    assert revenue["factories"] == []
    assert revenue["top_factory_share_pct"] == 0
    assert customer["active_customers"]["value"] == 0
    assert customer["awaiting_orders"] == []
    assert inventory["total_products"] == 0
    assert inventory["locations"] == []


def test_stock_values_use_the_last_quoted_price_and_the_estimated_buying_price(
    db_session: Session, monkeypatch
) -> None:
    branch = _branch(db_session)
    _order(db_session, branch.id, "ORD-1", date(2026, 8, 1))  # quoted at 100 a pair
    _voucher(db_session, branch.id, "Factory", date(2026, 7, 1), price=60.0)
    db_session.commit()
    # The stock arithmetic is what is under test, not the pipeline that builds the records.
    monkeypatch.setattr(
        "app.wholesale.services.dashboard.stock_records",
        lambda db, branch_id: [
            {"stock_code": "A-1", "on_hand_pairs": 20},
            {"stock_code": "NEVER-QUOTED", "on_hand_pairs": 5},
        ],
    )

    result = revenue_dashboard(db_session, branch.id, _window())

    # 20 pairs at the 100 last quoted, at the 60 estimated cost; the product nobody was
    # ever quoted a price for adds nothing to either side rather than a guess.
    assert result["potential_stock_sales_value"] == 2000
    assert result["inventory_cost_value"] == 1200
    assert result["potential_gross_profit"] == 800


def test_customer_dashboard_counts_new_repeat_and_open(db_session: Session) -> None:
    branch = _branch(db_session)
    old = _order(db_session, branch.id, "ORD-0", date(2026, 7, 1), customer="Golden Step", pairs=10)
    _delivery(db_session, branch.id, old, 10, date(2026, 7, 5))          # fulfilled long ago
    _order(db_session, branch.id, "ORD-1", date(2026, 9, 2), customer="Golden Step")   # repeat, waiting
    partly = _order(db_session, branch.id, "ORD-2", date(2026, 9, 3), customer="Moe Shoes")  # new
    _delivery(db_session, branch.id, partly, 4, date(2026, 9, 4))
    _order(db_session, branch.id, "ORD-3", date(2026, 9, 4), customer="City Walk", cancelled=True)
    db_session.commit()

    result = customer_dashboard(db_session, branch.id, _window())

    assert result["active_customers"]["value"] == 2
    assert result["new_customers"]["value"] == 1
    assert result["repeat_customers"] == {"value": 1, "share_of_active_pct": 50.0}
    assert result["open_orders"] == 2
    assert result["delivery_status"] == {"fulfilled": 0, "partly_delivered": 1, "awaiting_delivery": 1}
    assert result["order_count"] == 2
    assert [row["customer_name"] for row in result["top_customers"]] == ["Golden Step", "Moe Shoes"]
    assert result["total_ordered_value"] == 2000
    waiting = {row["order_no"]: row for row in result["awaiting_orders"]}
    assert set(waiting) == {"ORD-1", "ORD-2"}
    assert waiting["ORD-2"]["status"] == "partly_delivered"
    assert waiting["ORD-2"]["remaining_pairs"] == 6
    assert waiting["ORD-1"]["status"] == "waiting_for_stock"


def test_price_history_keeps_units_and_the_buying_price_is_per_pair(db_session: Session) -> None:
    branch = _branch(db_session)
    db_session.add(SupplierVoucher(
        branch_id=branch.id,
        voucher_no="VCH-UNIT",
        supplier_name="Factory",
        voucher_date=date(2026, 9, 1),
        lines=[SupplierVoucherLine(
            stock_code="A-UNIT", description="Sandal", product_group=ProductGroup.MAN,
            color_breakdown="black2d", colors=[], unit=WholesaleUnit.DOZEN,
            quantity_pairs=24, buying_price=12_000,
        )],
    ))
    db_session.commit()

    history = _price_history(db_session, branch.id, date(2026, 9, 7))

    assert history["a-unit"][0][3] == WholesaleUnit.DOZEN
    assert history["a-unit"][0][4] == "Factory"
    assert _buying_price(history, "A-UNIT", date(2026, 9, 7)) == 1_000


def test_inventory_dashboard_sums_stock_by_location_and_group(db_session: Session, monkeypatch) -> None:
    monkeypatch.setattr(
        "app.wholesale.services.dashboard.stock_records",
        lambda db, branch_id: [
            {
                "product_group": "man", "on_hand_pairs": 60, "available_pairs": 40, "allocated_pairs": 20,
                "incoming_pairs": 12, "at_supplier_pairs": 6, "in_transit_pairs": 6, "owed_to_customers_pairs": 3,
                "locations": [{"location": "Zay Gyi St.", "on_hand_pairs": 60}],
            },
            {
                "product_group": "lady", "on_hand_pairs": 30, "available_pairs": 30, "allocated_pairs": 0,
                "incoming_pairs": 0, "at_supplier_pairs": 0, "in_transit_pairs": 0, "owed_to_customers_pairs": 0,
                "locations": [
                    {"location": "Zay Gyi St.", "on_hand_pairs": 10},
                    {"location": "Mandalay", "on_hand_pairs": 20},
                ],
            },
        ],
    )

    result = inventory_dashboard(db_session, None)

    assert result["total_products"] == 2
    assert (result["on_hand_pairs"], result["available_pairs"], result["committed_pairs"]) == (90, 70, 20)
    assert (result["incoming_pairs"], result["at_supplier_pairs"], result["in_transit_pairs"]) == (12, 6, 6)
    assert result["backlog_pairs"] == 3
    assert result["locations"] == [
        {"location": "Mandalay", "on_hand_pairs": 20},
        {"location": "Zay Gyi St.", "on_hand_pairs": 70},
    ]
    assert [g["product_group"] for g in result["groups"]] == ["man", "lady"]
    assert result["groups"][0] == {"product_group": "man", "available_pairs": 40, "committed_pairs": 20, "incoming_pairs": 12}


def _wholesale_user(db_session: Session) -> Branch:
    from app.models.user import User, UserRole

    branch = _branch(db_session)
    db_session.add(User(
        id="test-user-id", name="Tester", email="tester@example.com",
        role=UserRole.WHOLESALE, branch_id=branch.id,
    ))
    db_session.commit()
    return branch


def test_dashboard_endpoints_accept_a_period_a_month_or_a_custom_range(authed_client, db_session: Session) -> None:
    _wholesale_user(db_session)

    for tab in ("revenue", "cost", "customer"):
        base = f"/api/wholesale/dashboard/{tab}"
        assert authed_client.get(f"{base}?period=30d").status_code == 200
        assert authed_client.get(f"{base}?period=monthly&month=2026-08").status_code == 200
        custom = authed_client.get(f"{base}?date_from=2026-09-01&date_to=2026-09-07")
        assert custom.status_code == 200
        assert custom.json()["period"] == "custom"
        assert authed_client.get(f"{base}?period=monthly&month=August").status_code == 400
        assert authed_client.get(f"{base}?date_from=2026-09-01").status_code == 400
    assert authed_client.get("/api/wholesale/dashboard/inventory").status_code == 200


def test_the_monthly_period_covers_the_month_asked_for(authed_client, db_session: Session) -> None:
    _wholesale_user(db_session)

    body = authed_client.get("/api/wholesale/dashboard/revenue?period=monthly&month=2026-08").json()

    assert (body["date_from"], body["date_to"]) == ("2026-08-01", "2026-08-31")


def test_summary_revenue_and_factories_follow_the_period_asked_for(authed_client, db_session: Session) -> None:
    branch = _wholesale_user(db_session)
    order = _order(db_session, branch.id, "ORD-1", date(2026, 9, 1), pairs=20)
    _voucher(db_session, branch.id, "Goody Factory", date(2026, 8, 20))
    _delivery(db_session, branch.id, order, 3, date(2026, 9, 2))
    db_session.commit()

    inside = authed_client.get(
        "/api/wholesale/monitoring/summary?date_from=2026-09-01&date_to=2026-09-07"
    ).json()
    outside = authed_client.get(
        "/api/wholesale/monitoring/summary?date_from=2026-10-01&date_to=2026-10-07"
    ).json()

    assert inside["revenue_this_period"] == 300
    assert [(f["name"], f["revenue"]) for f in inside["factories"]] == [("Goody Factory", 300)]
    # A period with no deliveries reports none, not a fixed sample.
    assert outside["revenue_this_period"] == 0
    assert outside["factories"] == []


def test_summary_with_no_data_reports_zeros_not_sample_figures(authed_client, db_session: Session) -> None:
    _wholesale_user(db_session)

    summary = authed_client.get("/api/wholesale/monitoring/summary").json()

    assert summary["physical_stock_sets"] == 0
    assert summary["available_sets"] == 0
    assert summary["committed_sets"] == 0
    assert summary["incoming_stock_sets"] == 0
    assert summary["backlog_sets"] == 0
    assert summary["locations"] == []
    assert summary["factories"] == []
    assert summary["revenue_this_period"] == 0
    assert summary["fulfillment"] == {
        "delivered_pct": 0, "allocated_pct": 0, "waiting_pct": 0, "open_pct": 0,
    }


def test_cost_dashboard_adds_goods_purchased_and_the_cost_to_bring_them_in(
    db_session: Session, monkeypatch
) -> None:
    from app.wholesale.services.dashboard import cost_dashboard

    branch = _branch(db_session)
    goody = _voucher(db_session, branch.id, "Goody Factory", date(2026, 9, 2), price=60.0)   # 20 pairs = 1200
    lek = _voucher(db_session, branch.id, "Lek", date(2026, 9, 3), price=40.0)               # 20 pairs = 800
    _voucher(db_session, branch.id, "Goody Factory", date(2026, 8, 1), price=10.0)           # before the window
    db_session.add(WholesalePayment(
        branch_id=branch.id, voucher_id=goody.id, paid_on=date(2026, 9, 4), amount=500,
        recorded_by_user_id="test-user-id",
    ))
    db_session.add(WholesalePayment(
        branch_id=branch.id, voucher_id=lek.id, paid_on=date(2026, 9, 20), amount=800,  # after the window
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()
    # Receiving rows need a whole shipment behind them; the sum over them is what is tested.
    monkeypatch.setattr("app.wholesale.services.dashboard._cost_to_bring_in", lambda *args: 300.0)

    result = cost_dashboard(db_session, branch.id, _window())

    assert result["goods_purchased"] == 2000
    assert result["cost_to_bring_in"] == 300
    assert result["total_cost"] == 2300
    assert round(result["goods_share_pct"], 1) == 87.0
    assert round(result["cost_share_pct"], 1) == 13.0
    assert [(f["factory_name"], f["purchased"]) for f in result["factories"]] == [
        ("Goody Factory", 1200),
        ("Lek", 800),
    ]
    # Unpaid at the end of the window: Goody still owes 700; Lek's payment came later, so 800;
    # and the older Goody voucher (200) was never paid.
    assert result["supplier_balance_due"] == 700 + 800 + 200
    assert result["payable_count"] == 3
    assert [row["voucher_no"] for row in result["payables"]] == [
        "VCH-Lek-2026-09-03",
        "VCH-Goody Factory-2026-09-02",
        "VCH-Goody Factory-2026-08-01",
    ]


def test_an_empty_cost_dashboard_is_all_zeros(db_session: Session) -> None:
    from app.wholesale.services.dashboard import cost_dashboard

    result = cost_dashboard(db_session, None, _window())

    assert (result["goods_purchased"], result["cost_to_bring_in"], result["total_cost"]) == (0, 0, 0)
    assert result["goods_share_pct"] == result["cost_share_pct"] == 0
    assert result["factories"] == [] and result["payables"] == []
