"""Read-only aggregates for the wholesale live status board."""

from datetime import date

from sqlalchemy.orm import Session, selectinload

from app.wholesale.models.entities import (
    CustomerOrder,
    Receiving,
    WholesalePayment,
    WholesaleStockMovement,
)
from app.wholesale.models.master_data import WholesaleProduct
from app.wholesale.services.inventory import (
    delivered_color_pairs_by_orders,
    delivered_pairs_by_order,
    effective_allocated_color_pairs,
    incoming_movements,
    net_pairs_by_stock_code,
)
from app.wholesale.services.money import order_totals, voucher_totals
from app.wholesale.services.orders import list_orders, order_status
from app.wholesale.services.shipments import shipment_status
from app.wholesale.services.receivings_service import final_received_by_shipment
from app.wholesale.services.shipments_service import list_shipments
from app.wholesale.services.supplier_vouchers_service import list_vouchers


def _days_open(value: date) -> int:
    return max(0, (date.today() - value).days)


def shipments_in_transit(db: Session, branch_id: str | None) -> dict:
    shipments = list_shipments(db, branch_id)
    received = final_received_by_shipment(db, [shipment.id for shipment in shipments])
    rows = []
    for shipment in shipments:
        status = shipment_status(shipment, received.get(shipment.id, shipment.final_received_packages))
        if status == "completed":
            continue
        rows.append({
            "shipment_id": shipment.id,
            "shipment_no": shipment.shipment_no,
            "supplier_name": shipment.supplier_name,
            "sent_on": shipment.sent_on,
            "days_in_transit": _days_open(shipment.sent_on),
            "shipment_status": status,
        })
    return {"count": len(rows), "rows": rows}


def _order_statuses(db: Session, branch_id: str | None) -> list[tuple[CustomerOrder, str]]:
    orders = list_orders(db, branch_id)
    order_ids = [order.id for order in orders]
    delivered = delivered_pairs_by_order(db, order_ids, branch_id)
    delivered_colors_by_order = delivered_color_pairs_by_orders(db, order_ids, branch_id)
    statuses: list[tuple[CustomerOrder, str]] = []
    for order in orders:
        remaining_deliveries = dict(delivered.get(order.id, {}))
        received = 0
        allocated = 0
        lost = 0
        for line in order.lines:
            delivered_colors = delivered_colors_by_order.get(order.id, {}).get(line.stock_code, {})
            effective_colors = effective_allocated_color_pairs(line, delivered_colors)
            allocated += sum(effective_colors.values())
            line_received = min(remaining_deliveries.get(line.stock_code, 0), line.quantity_pairs)
            received += line_received
            lost += line.lost_quantity_pairs
            remaining_deliveries[line.stock_code] = max(
                0, remaining_deliveries.get(line.stock_code, 0) - line_received
            )
        statuses.append((order, order_status(sum(line.quantity_pairs for line in order.lines), received, allocated, order.cancelled, lost)))
    return statuses


def orders_pending(db: Session, branch_id: str | None) -> dict:
    rows = []
    for order, status in _order_statuses(db, branch_id):
        if order.cancelled or status == "fulfilled":
            continue
        rows.append({
            "order_id": order.id,
            "order_no": order.order_no,
            "customer_name": order.customer_name,
            "order_status": status,
            "order_date": order.order_date,
            "days_open": _days_open(order.order_date),
        })
    return {"count": len(rows), "rows": rows}


def unpaid_vouchers(db: Session, branch_id: str | None) -> dict:
    rows = []
    for voucher in list_vouchers(db, branch_id):
        totals = voucher_totals(voucher)
        if totals["balance_due"] <= 0:
            continue
        rows.append({
            "voucher_id": voucher.id,
            "voucher_no": voucher.voucher_no,
            "supplier_name": voucher.supplier_name,
            "balance_due": totals["balance_due"],
            "voucher_date": voucher.voucher_date,
        })
    return {"count": len(rows), "rows": rows}


def unpaid_orders(db: Session, branch_id: str | None) -> dict:
    rows = []
    for order in list_orders(db, branch_id):
        if order.cancelled:
            continue
        totals = order_totals(order)
        if totals["balance_due"] <= 0:
            continue
        rows.append({
            "order_id": order.id,
            "order_no": order.order_no,
            "customer_name": order.customer_name,
            "balance_due": totals["balance_due"],
            "order_date": order.order_date,
        })
    return {"count": len(rows), "rows": rows}


def zero_stock_products(db: Session, branch_id: str | None) -> dict:
    stock = net_pairs_by_stock_code(db, branch_id)
    received_codes = {
        row["stock_code"]
        for row in incoming_movements(db, branch_id)
    }
    products = db.query(WholesaleProduct).filter(WholesaleProduct.active.is_(True)).order_by(WholesaleProduct.stock_code).all()
    rows = [
        {
            "product_id": product.id,
            "stock_code": product.stock_code,
            "description": product.description,
            "product_group": product.product_group.value,
            "stock_status": (
                "out_of_stock"
                if product.stock_code in received_codes
                else "not_arrived"
            ),
        }
        for product in products
        if stock.get(product.stock_code, 0) <= 0
    ]
    return {"count": len(rows), "rows": rows}


def recent_activity(db: Session, branch_id: str | None, limit: int = 15) -> list[dict]:
    def scoped(query, model):
        if branch_id is not None:
            query = query.filter(model.branch_id == branch_id)
        return query.order_by(model.created_at.desc()).limit(limit)

    receivings = scoped(
        db.query(Receiving), Receiving
    ).all()
    deliveries = scoped(
        db.query(WholesaleStockMovement).options(selectinload(WholesaleStockMovement.order)),
        WholesaleStockMovement,
    ).all()
    payments = scoped(
        db.query(WholesalePayment).options(
            selectinload(WholesalePayment.voucher), selectinload(WholesalePayment.order)
        ),
        WholesalePayment,
    ).all()

    rows = [
        {
            "activity_id": receiving.id,
            "type": "receiving",
            "created_at": receiving.created_at,
            "receiving_id": receiving.id,
            "receiving_no": receiving.receiving_no,
            "supplier_name": receiving.supplier_name,
            "shipment_no": receiving.shipment_no,
        }
        for receiving in receivings
    ]
    rows.extend(
        {
            "activity_id": delivery.id,
            "type": "delivery",
            "created_at": delivery.created_at,
            "delivery_id": delivery.id,
            "order_id": delivery.order_id,
            "order_no": delivery.order.order_no,
            "customer_name": delivery.order.customer_name,
            "stock_code": delivery.stock_code,
            "quantity_pairs": delivery.quantity_pairs,
        }
        for delivery in deliveries
    )
    rows.extend(
        {
            "activity_id": payment.id,
            "type": "payment",
            "created_at": payment.created_at,
            "payment_id": payment.id,
            "amount": float(payment.amount),
            "paid_on": payment.paid_on,
            "voucher_id": payment.voucher_id,
            "voucher_no": payment.voucher.voucher_no if payment.voucher else None,
            "order_id": payment.order_id,
            "order_no": payment.order.order_no if payment.order else None,
        }
        for payment in payments
    )
    rows.sort(key=lambda row: row["created_at"] or date.min, reverse=True)
    return rows[:limit]


def monitoring_snapshot(db: Session, branch_id: str | None) -> dict:
    return {
        "shipments_in_transit": shipments_in_transit(db, branch_id),
        "orders_pending": orders_pending(db, branch_id),
        "unpaid_vouchers": unpaid_vouchers(db, branch_id),
        "unpaid_orders": unpaid_orders(db, branch_id),
        "zero_stock_products": zero_stock_products(db, branch_id),
        "recent_activity": recent_activity(db, branch_id),
    }
