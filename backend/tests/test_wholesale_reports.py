from datetime import date
from types import SimpleNamespace

from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.wholesale import (
    CustomerOrder,
    CustomerOrderLine,
    ProductGroup,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesalePayment,
    WholesaleStockMovement,
    WholesaleUnit,
)
from app.services.wholesale.reports import (
    _buying_price,
    _price_history,
    cost_report,
    customer_report,
    inventory_report,
    revenue_report,
)


def _window() -> SimpleNamespace:
    return SimpleNamespace(
        period="custom",
        start=date(2026, 9, 1),
        end=date(2026, 9, 7),
        previous_start=date(2026, 8, 25),
        previous_end=date(2026, 8, 31),
    )


def _order(db: Session, branch_id: str, order_no: str, order_date: date, cancelled: bool = False) -> CustomerOrder:
    order = CustomerOrder(
        branch_id=branch_id,
        order_no=order_no,
        customer_name="Ma Su Su",
        customer_phone="",
        customer_address="",
        order_date=order_date,
        cancelled=cancelled,
        lines=[CustomerOrderLine(
            stock_code="A-1",
            description="Sandal",
            product_group=ProductGroup.MAN,
            supplier_name="Factory",
            color_breakdown="black10p",
            colors=[],
            unit=WholesaleUnit.PAIR,
            quantity_pairs=10,
            selling_price=100,
        )],
    )
    db.add(order)
    db.flush()
    return order


def test_revenue_is_delivery_based_and_excludes_cancelled_orders(db_session: Session) -> None:
    branch = Branch(name="Wholesale", phone_number="", address="")
    db_session.add(branch)
    db_session.flush()
    placed_only = _order(db_session, branch.id, "ORD-1", date(2026, 9, 2))
    delivered = _order(db_session, branch.id, "ORD-2", date(2026, 8, 30))
    cancelled = _order(db_session, branch.id, "ORD-3", date(2026, 9, 3), cancelled=True)
    db_session.add_all([
        WholesaleStockMovement(
            branch_id=branch.id,
            order_id=delivered.id,
            stock_code="A-1",
            description="Sandal",
            product_group=ProductGroup.MAN,
            color_breakdown="black4p",
            colors=[],
            quantity_pairs=4,
            location="Gate",
            delivered_on=date(2026, 9, 4),
            recorded_by_user_id="test-user-id",
        ),
        WholesaleStockMovement(
            branch_id=branch.id,
            order_id=cancelled.id,
            stock_code="A-1",
            description="Sandal",
            product_group=ProductGroup.MAN,
            color_breakdown="black10p",
            colors=[],
            quantity_pairs=10,
            location="Gate",
            delivered_on=date(2026, 9, 4),
            recorded_by_user_id="test-user-id",
        ),
        WholesalePayment(
            branch_id=branch.id,
            order_id=delivered.id,
            paid_on=date(2026, 9, 5),
            amount=150,
            recorded_by_user_id="test-user-id",
        ),
    ])
    db_session.commit()

    result = revenue_report(db_session, branch.id, _window())

    assert result["delivered_revenue"]["value"] == 400
    assert result["pairs_delivered"]["value"] == 4
    assert result["ordered_value"]["value"] == 1000
    assert result["collected"]["value"] == 150
    assert [row["order_no"] for row in result["orders"]] == ["ORD-1"]


def test_other_pillars_return_empty_shapes_without_source_rows(db_session: Session) -> None:
    window = _window()

    cost = cost_report(db_session, None, window)
    inventory = inventory_report(db_session, None, window)
    customer = customer_report(db_session, None, window)

    assert cost["purchases"]["value"] == 0
    assert cost["gross_margin_pct"]["value"] == 0
    assert inventory["on_hand"]["value"] == 0
    assert inventory["received_in_period"] == 0
    assert customer["active_customers"]["value"] == 0
    assert customer["ranking"] == []


def test_reports_preserve_price_units_for_delivery_and_stock_valuation(db_session: Session) -> None:
    branch = Branch(name="Wholesale", phone_number="", address="")
    db_session.add(branch)
    db_session.flush()
    order = CustomerOrder(
        branch_id=branch.id,
        order_no="ORD-UNIT",
        customer_name="Ma Su Su",
        customer_phone="",
        customer_address="",
        order_date=date(2026, 9, 2),
        lines=[CustomerOrderLine(
            stock_code="A-UNIT",
            description="Sandal",
            product_group=ProductGroup.MAN,
            supplier_name="Factory",
            color_breakdown="black2s",
            colors=[],
            unit=WholesaleUnit.SET,
            quantity_pairs=12,
            selling_price=10_000,
        )],
    )
    voucher = SupplierVoucher(
        branch_id=branch.id,
        voucher_no="VCH-UNIT",
        supplier_name="Factory",
        voucher_date=date(2026, 9, 1),
        lines=[SupplierVoucherLine(
            stock_code="A-UNIT",
            description="Sandal",
            product_group=ProductGroup.MAN,
            color_breakdown="black2d",
            colors=[],
            unit=WholesaleUnit.DOZEN,
            quantity_pairs=24,
            buying_price=12_000,
        )],
    )
    db_session.add_all([order, voucher])
    db_session.flush()
    db_session.add(WholesaleStockMovement(
        branch_id=branch.id,
        order_id=order.id,
        stock_code="A-UNIT",
        description="Sandal",
        product_group=ProductGroup.MAN,
        color_breakdown="black1s",
        colors=[],
        quantity_pairs=6,
        location="Gate",
        delivered_on=date(2026, 9, 4),
        recorded_by_user_id="test-user-id",
    ))
    db_session.commit()

    revenue = revenue_report(db_session, branch.id, _window())
    costs = cost_report(db_session, branch.id, _window())
    history = _price_history(db_session, branch.id, date(2026, 9, 7))

    assert revenue["ordered_value"]["value"] == 20_000
    assert revenue["delivered_revenue"]["value"] == 10_000
    assert costs["purchases"]["value"] == 24_000
    assert costs["trend"][3]["cost_of_goods_delivered"] == 6_000
    assert history["a-unit"][0][3] == WholesaleUnit.DOZEN
    assert _buying_price(history, "A-UNIT", date(2026, 9, 7)) == 1_000
