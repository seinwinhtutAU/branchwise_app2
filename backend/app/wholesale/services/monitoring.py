from collections import defaultdict
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


def wholesale_summary_snapshot(
    db: Session,
    branch_id: str | None,
    location: str | None = None,
    window=None,
) -> dict:
    from app.wholesale.services.dashboard import revenue_dashboard
    from app.wholesale.services.stock_records import stock_records

    records = stock_records(db, branch_id)

    loc_norm = location.strip().lower() if location else ""
    is_filtered_location = bool(loc_norm and loc_norm not in ("all", "all locations", "all_locations"))

    total_on_hand_pairs = 0
    total_supplier_pairs = 0
    total_transit_pairs = 0
    total_allocated_pairs = 0
    total_owed_pairs = 0

    loc_totals: dict[str, int] = defaultdict(int)

    for rec in records:
        for loc in rec.get("locations", []):
            loc_name = loc.get("location", "").strip()
            loc_pairs = max(0, int(loc.get("on_hand_pairs", 0)))
            if loc_name:
                loc_totals[loc_name] += loc_pairs

        if is_filtered_location:
            rec_loc_pairs = sum(
                max(0, int(loc.get("on_hand_pairs", 0)))
                for loc in rec.get("locations", [])
                if loc.get("location", "").strip().lower() == loc_norm
            )
            total_on_hand_pairs += rec_loc_pairs
        else:
            total_on_hand_pairs += max(0, int(rec.get("on_hand_pairs", 0)))

        total_supplier_pairs += max(0, int(rec.get("at_supplier_pairs", 0)))
        total_transit_pairs += max(0, int(rec.get("in_transit_pairs", 0)))
        total_allocated_pairs += max(0, int(rec.get("allocated_pairs", 0)))
        total_owed_pairs += max(0, int(rec.get("owed_to_customers_pairs", 0)))

    on_hand_sets = round(total_on_hand_pairs / 6)
    supplier_sets = round(total_supplier_pairs / 6)
    transit_sets = round(total_transit_pairs / 6)
    incoming_sets = supplier_sets + transit_sets
    allocated_sets = round(total_allocated_pairs / 6)
    available_sets = max(0, on_hand_sets - allocated_sets)
    backlog_sets = max(0, round((total_owed_pairs - total_allocated_pairs) / 6))

    committed_sets = allocated_sets

    # Locations
    location_rows = []
    color_map = {
        "zay gyi st.": "#5252E8",
        "zay gyi st, magway": "#5252E8",
        "zay gyi st": "#5252E8",
        "mawlamyine": "#0D9488",
        "mandalay": "#E88B1A",
    }
    if loc_totals:
        for loc_name, pairs in sorted(loc_totals.items(), key=lambda x: x[1], reverse=True):
            sets = round(pairs / 6)
            c = color_map.get(loc_name.lower(), "#5252E8")
            location_rows.append({"name": loc_name, "sets": sets, "color": c})

    # Fulfillment
    total_demand = sum(
        sum(line.quantity_pairs for line in order.lines)
        for order in list_orders(db, branch_id)
        if not order.cancelled
    )
    if total_demand > 0:
        delivered_pairs_dict = delivered_pairs_by_order(
            db, [o.id for o in list_orders(db, branch_id) if not o.cancelled], branch_id
        )
        delivered_sum = sum(
            sum(pairs_map.values()) for pairs_map in delivered_pairs_dict.values()
        )
        del_pct = min(100, max(0, round(delivered_sum / total_demand * 100)))
        alloc_pct = min(100 - del_pct, max(0, round(total_allocated_pairs / total_demand * 100)))
        wait_pct = max(0, 100 - del_pct - alloc_pct)
        fulfillment = {
            "delivered_pct": del_pct,
            "allocated_pct": alloc_pct,
            "waiting_pct": wait_pct,
            "open_pct": alloc_pct + wait_pct,
        }
    else:
        # No orders yet: nothing has been delivered, allocated or is waiting.
        fulfillment = {"delivered_pct": 0, "allocated_pct": 0, "waiting_pct": 0, "open_pct": 0}

    # Revenue and its factories are for the window asked for — the same figures the
    # Revenue tab shows, not a fixed sample.
    revenue = revenue_dashboard(db, branch_id, window) if window is not None else None
    palette = ["#5252E8", "#7575EA", "#A2A2F1", "#C7C7F7"]
    factories = [
        {"name": row["factory_name"], "revenue": row["delivered_revenue"], "color": palette[min(index, len(palette) - 1)]}
        for index, row in enumerate((revenue["factories"] if revenue else [])[:4])
    ]
    revenue_this_period = revenue["delivered_revenue"]["value"] if revenue else 0.0

    return {
        "physical_stock_sets": on_hand_sets,
        "available_sets": available_sets,
        "committed_sets": committed_sets,
        "incoming_stock_sets": incoming_sets,
        "supplier_sets": supplier_sets,
        "transit_sets": transit_sets,
        "backlog_sets": backlog_sets,
        "pipeline": {
            "supplier_sets": supplier_sets,
            "transit_sets": transit_sets,
            "on_hand_sets": on_hand_sets,
            "allocated_sets": committed_sets,
            "available_sets": available_sets,
        },
        "locations": location_rows,
        "fulfillment": fulfillment,
        "revenue_this_period": revenue_this_period,
        "factories": factories,
    }

