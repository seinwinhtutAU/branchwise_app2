from datetime import date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.user import User, UserRole
from app.wholesale.models.entities import (
    CustomerOrder,
    CustomerOrderLine,
    ProductGroup,
    Receiving,
    ReceivingItem,
    ReceivingPackage,
    Shipment,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesalePayment,
    WholesaleStockMovement,
    WholesaleUnit,
)
from app.wholesale.models.master_data import WholesaleProduct


def test_wholesale_summary_reads_across_branches_for_admin(
    authed_client: TestClient, db_session: Session
) -> None:
    branch_one = Branch(name="Wholesale one", phone_number="0", address="Here")
    branch_two = Branch(name="Wholesale two", phone_number="0", address="There")
    db_session.add_all([branch_one, branch_two])
    db_session.flush()
    db_session.add(User(id="test-user-id", name="Development", email="development@example.com", role=UserRole.DEVELOPMENT))

    in_transit = Shipment(
        branch_id=branch_one.id, shipment_no="SHP-IN", voucher_no="VCH-IN", supplier_name="Factory A",
        carrier_name="Cargo", final_destination="Gate", sent_on=date.today() - timedelta(days=4),
        total_packages=4, total_quantity_pairs=24, total_unit=WholesaleUnit.SET,
        packages_sent_by_cargo=4, final_received_packages=0,
    )
    completed = Shipment(
        branch_id=branch_one.id, shipment_no="SHP-DONE", voucher_no="VCH-DONE", supplier_name="Factory B",
        carrier_name="Cargo", final_destination="Gate", sent_on=date.today(), total_packages=1,
        total_quantity_pairs=6, total_unit=WholesaleUnit.SET, packages_sent_by_cargo=1,
        final_received_packages=1,
    )
    other_branch_shipment = Shipment(
        branch_id=branch_two.id, shipment_no="SHP-OTHER", voucher_no="VCH-OTHER", supplier_name="Factory C",
        carrier_name="Cargo", final_destination="Gate", sent_on=date.today(), total_packages=1,
        total_quantity_pairs=6, total_unit=WholesaleUnit.SET, packages_sent_by_cargo=1,
        final_received_packages=0,
    )
    db_session.add_all([in_transit, completed, other_branch_shipment])
    db_session.flush()

    pending = CustomerOrder(
        branch_id=branch_one.id, order_no="ORD-PENDING", customer_name="Customer A", order_date=date.today(),
        lines=[CustomerOrderLine(stock_code="ZERO", description="Zero shoe", product_group=ProductGroup.MAN,
                                 supplier_name="Factory A", color_breakdown="black1s", colors=[{"color": "black", "qty": 1}],
                                 unit=WholesaleUnit.SET, quantity_pairs=6, selling_price=100)],
    )
    fulfilled = CustomerOrder(
        branch_id=branch_one.id, order_no="ORD-DONE", customer_name="Customer B", order_date=date.today(),
        lines=[CustomerOrderLine(stock_code="FULFILLED", description="Delivered shoe", product_group=ProductGroup.MAN,
                                 supplier_name="Factory B", color_breakdown="black1s", colors=[{"color": "black", "qty": 1}],
                                 unit=WholesaleUnit.SET, quantity_pairs=6, selling_price=100)],
    )
    db_session.add_all([pending, fulfilled])
    db_session.flush()
    db_session.add(WholesaleStockMovement(
        branch_id=branch_one.id, order_id=fulfilled.id, stock_code="FULFILLED", description="Delivered shoe",
        product_group=ProductGroup.MAN, color_breakdown="black1s", colors=[{"color": "black", "qty": 1}],
        quantity_pairs=6, location="Gate", delivered_on=date.today(), recorded_by_user_id="test-user-id",
        created_at=datetime.now() - timedelta(minutes=2),
    ))
    db_session.add(WholesaleStockMovement(
        branch_id=branch_one.id, order_id=fulfilled.id, stock_code="DEPLETED", description="Depleted shoe",
        product_group=ProductGroup.MAN, color_breakdown="black2s", colors=[{"color": "black", "qty": 2}],
        quantity_pairs=12, location="Gate", delivered_on=date.today(), recorded_by_user_id="test-user-id",
        created_at=datetime.now() - timedelta(minutes=3),
    ))

    unpaid = SupplierVoucher(
        branch_id=branch_one.id, voucher_no="VCH-UNPAID", supplier_name="Factory A", voucher_date=date.today(),
        carrier_name="Cargo", total_packages=1,
        lines=[SupplierVoucherLine(stock_code="ZERO", description="Zero shoe", product_group=ProductGroup.MAN,
                                   color_breakdown="black1s", colors=[{"color": "black", "qty": 1}],
                                   unit=WholesaleUnit.SET, quantity_pairs=6, buying_price=50)],
    )
    paid = SupplierVoucher(
        branch_id=branch_one.id, voucher_no="VCH-PAID", supplier_name="Factory B", voucher_date=date.today(),
        carrier_name="Cargo", total_packages=1,
        lines=[SupplierVoucherLine(stock_code="FULFILLED", description="Delivered shoe", product_group=ProductGroup.MAN,
                                   color_breakdown="black1s", colors=[{"color": "black", "qty": 1}],
                                   unit=WholesaleUnit.SET, quantity_pairs=6, buying_price=50)],
    )
    db_session.add_all([unpaid, paid])
    db_session.flush()
    db_session.add(WholesalePayment(
        branch_id=branch_one.id, voucher_id=paid.id, paid_on=date.today(), amount=300,
        recorded_by_user_id="test-user-id", created_at=datetime.now() - timedelta(minutes=1),
    ))

    receiving = Receiving(
        branch_id=branch_one.id, receiving_no="RCV-STOCK", shipment_id=in_transit.id, shipment_no=in_transit.shipment_no,
        voucher_no=in_transit.voucher_no, supplier_name=in_transit.supplier_name, gate="Gate", received_on=date.today(),
        total_packages=1, total_quantity_pairs=24, total_unit=WholesaleUnit.SET,
    )
    package = ReceivingPackage(package_no=1, opened=True, received_on=date.today(), receiving=receiving)
    package.items = [
        ReceivingItem(stock_code="FULFILLED", description="Delivered shoe", product_group=ProductGroup.MAN,
                      color_breakdown="black2s", colors=[{"color": "black", "qty": 2}],
                      unit=WholesaleUnit.SET, quantity_pairs=12),
        ReceivingItem(stock_code="DEPLETED", description="Depleted shoe", product_group=ProductGroup.MAN,
                      color_breakdown="black2s", colors=[{"color": "black", "qty": 2}],
                      unit=WholesaleUnit.SET, quantity_pairs=12),
    ]
    db_session.add(receiving)
    db_session.commit()
    db_session.query(WholesaleProduct).delete()
    db_session.add_all([
        WholesaleProduct(stock_code="ZERO", description="Zero shoe", product_group=ProductGroup.MAN, active=True),
        WholesaleProduct(stock_code="FULFILLED", description="Delivered shoe", product_group=ProductGroup.MAN, active=True),
        WholesaleProduct(stock_code="DEPLETED", description="Depleted shoe", product_group=ProductGroup.MAN, active=True),
    ])
    db_session.commit()

    summary_resp = authed_client.get("/api/wholesale/monitoring/summary")
    assert summary_resp.status_code == 200
    summary = summary_resp.json()
    assert "physical_stock_sets" in summary
    assert "available_sets" in summary
    assert "committed_sets" in summary
    assert "incoming_stock_sets" in summary
    assert "pipeline" in summary
    assert "locations" in summary
    assert "fulfillment" in summary
    assert "revenue_this_period" in summary
    assert "factories" in summary

