"""Server-side aggregation for the wholesale Reports four-pillar page.

The list endpoints are intentionally not used here: their pagination is useful for
screens, but would make a report silently incomplete. Each report filters its source
rows in SQL and then performs the small amount of cross-entity arithmetic in memory.
"""

from collections import defaultdict
from datetime import date, datetime, time

from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.models.wholesale import (
    CustomerOrder,
    CustomerOrderLine,
    Receiving,
    ReceivingItem,
    ReceivingPackage,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesalePayment,
    WholesaleStockMovement,
    WholesaleUnit,
    WholesaleWriteOff,
)
from app.services.reporting import each_day, kpi_value
from app.services.wholesale.inventory import delivered_pairs_by_order
from app.services.wholesale.money import order_totals, voucher_totals
from app.services.wholesale.orders import order_status
from app.services.wholesale.receivings import cost_by_stage
from app.services.wholesale.stock_records import stock_records
from app.services.wholesale.units import priced_amount


def _branch(query, model, branch_id: str | None):
    return query if branch_id is None else query.filter(model.branch_id == branch_id)


def _window_payload(window) -> dict:
    return {
        "period": getattr(window, "period", "custom"),
        "date_from": window.start.isoformat(),
        "date_to": window.end.isoformat(),
        "previous_date_from": window.previous_start.isoformat(),
        "previous_date_to": window.previous_end.isoformat(),
    }


def _orders(db: Session, branch_id: str | None, start: date, end: date) -> list[CustomerOrder]:
    query = db.query(CustomerOrder).options(
        selectinload(CustomerOrder.lines), selectinload(CustomerOrder.payments)
    ).filter(CustomerOrder.order_date >= start, CustomerOrder.order_date <= end)
    query = _branch(query, CustomerOrder, branch_id)
    return query.order_by(CustomerOrder.order_date, CustomerOrder.order_no).all()


def _all_orders(db: Session, branch_id: str | None) -> list[CustomerOrder]:
    query = db.query(CustomerOrder).options(
        selectinload(CustomerOrder.lines), selectinload(CustomerOrder.payments)
    )
    return _branch(query, CustomerOrder, branch_id).all()


def _delivery_rows(db: Session, branch_id: str | None, start: date, end: date) -> list[dict]:
    query = db.query(WholesaleStockMovement, CustomerOrder).join(
        CustomerOrder, WholesaleStockMovement.order_id == CustomerOrder.id
    ).filter(
        WholesaleStockMovement.delivered_on >= start,
        WholesaleStockMovement.delivered_on <= end,
        CustomerOrder.cancelled.is_(False),
    )
    query = _branch(query, WholesaleStockMovement, branch_id)
    pairs = query.all()
    order_ids = {order.id for _, order in pairs}
    lines: dict[tuple[str, str], CustomerOrderLine] = {}
    if order_ids:
        line_query = db.query(CustomerOrderLine).filter(CustomerOrderLine.order_id.in_(order_ids))
        for line in line_query.all():
            lines[(line.order_id, line.stock_code.strip().lower())] = line
    return [
        {
            "movement": movement,
            "order": order,
            "line": lines.get((order.id, movement.stock_code.strip().lower())),
        }
        for movement, order in pairs
    ]


def _payments(
    db: Session,
    branch_id: str | None,
    start: date,
    end: date,
    account: str,
) -> list[WholesalePayment]:
    query = db.query(WholesalePayment).filter(
        WholesalePayment.paid_on >= start, WholesalePayment.paid_on <= end,
        getattr(WholesalePayment, f"{account}_id").isnot(None),
    )
    if account == "order":
        query = query.join(CustomerOrder, WholesalePayment.order_id == CustomerOrder.id).filter(
            CustomerOrder.cancelled.is_(False)
        )
    return _branch(query, WholesalePayment, branch_id).all()


def _delivered_metrics(rows: list[dict]) -> dict:
    revenue = 0.0
    pairs = 0
    by_customer: dict[str, dict] = defaultdict(lambda: {"pairs_delivered": 0, "delivered_revenue": 0.0})
    by_product: dict[str, dict] = {}
    by_day: dict[date, dict] = defaultdict(lambda: {"delivered_revenue": 0.0, "pairs_delivered": 0})
    last_delivery: dict[str, date] = {}
    for row in rows:
        movement = row["movement"]
        order = row["order"]
        line = row["line"]
        qty = max(0, int(movement.quantity_pairs))
        amount = priced_amount(qty, line.unit, float(line.selling_price)) if line is not None else 0.0
        revenue += amount
        pairs += qty
        name = order.customer_name.strip()
        by_customer[name]["pairs_delivered"] += qty
        by_customer[name]["delivered_revenue"] += amount
        code = movement.stock_code.strip()
        product = by_product.setdefault(code, {
            "stock_code": code,
            "description": line.description if line is not None else movement.description,
            "pairs_delivered": 0,
            "delivered_revenue": 0.0,
            "weighted_price": 0.0,
        })
        product["pairs_delivered"] += qty
        product["delivered_revenue"] += amount
        product["weighted_price"] += amount
        day = movement.delivered_on
        by_day[day]["delivered_revenue"] += amount
        by_day[day]["pairs_delivered"] += qty
        last_delivery[order.id] = max(last_delivery.get(order.id, day), day)
    for product in by_product.values():
        product["avg_selling_price"] = (
            product["weighted_price"] / product["pairs_delivered"]
            if product["pairs_delivered"] else None
        )
        del product["weighted_price"]
    return {
        "revenue": revenue,
        "pairs": pairs,
        "customers": by_customer,
        "products": by_product,
        "days": by_day,
        "last_delivery": last_delivery,
    }


def _ordered_value(orders: list[CustomerOrder]) -> float:
    return sum(
        sum(priced_amount(line.quantity_pairs, line.unit, float(line.selling_price)) for line in order.lines)
        for order in orders if not order.cancelled
    )


def _period_label(window, custom: bool = False) -> dict:
    payload = _window_payload(window)
    if custom:
        payload["period"] = "custom"
    return payload


def revenue_report(db: Session, branch_id: str | None, window) -> dict:
    orders = _orders(db, branch_id, window.start, window.end)
    previous_orders = _orders(db, branch_id, window.previous_start, window.previous_end)
    rows = _delivery_rows(db, branch_id, window.start, window.end)
    previous_rows = _delivery_rows(db, branch_id, window.previous_start, window.previous_end)
    metrics = _delivered_metrics(rows)
    previous = _delivered_metrics(previous_rows)
    collected_rows = _payments(db, branch_id, window.start, window.end, "order")
    previous_collected = sum(float(payment.amount) for payment in _payments(db, branch_id, window.previous_start, window.previous_end, "order"))
    collected = sum(float(payment.amount) for payment in collected_rows)
    collected_by_day: dict[date, float] = defaultdict(float)
    for payment in collected_rows:
        collected_by_day[payment.paid_on] += float(payment.amount)
    trend = []
    for day in each_day(window.start, window.end):
        trend.append({
            "date": day.isoformat(),
            "delivered_revenue": metrics["days"].get(day, {}).get("delivered_revenue", 0.0),
            "collected": collected_by_day.get(day, 0.0),
        })
    order_rows = []
    delivered_by_order: dict[str, int] = defaultdict(int)
    for row in rows:
        delivered_by_order[row["order"].id] += max(0, int(row["movement"].quantity_pairs))
    for order in orders:
        if order.cancelled:
            continue
        total_pairs = sum(line.quantity_pairs for line in order.lines)
        totals = order_totals(order)
        delivered = delivered_by_order.get(order.id, 0)
        order_rows.append({
            "order_no": order.order_no,
            "customer_name": order.customer_name.strip(),
            "pairs_ordered": total_pairs,
            "ordered_value": totals["total"],
            "delivered_pct": delivered / total_pairs * 100 if total_pairs else 0.0,
            "balance_due": totals["balance_due"],
        })
    customers = [
        {"customer_name": name, **values}
        for name, values in metrics["customers"].items()
    ]
    customers.sort(key=lambda row: row["delivered_revenue"], reverse=True)
    products = sorted(metrics["products"].values(), key=lambda row: row["delivered_revenue"], reverse=True)
    return {
        **_window_payload(window),
        "delivered_revenue": kpi_value(metrics["revenue"], previous["revenue"]),
        "ordered_value": kpi_value(_ordered_value(orders), _ordered_value(previous_orders)),
        "pairs_delivered": kpi_value(float(metrics["pairs"]), float(previous["pairs"])),
        "collected": kpi_value(collected, previous_collected),
        "trend": trend,
        "top_customers": customers[:10],
        "top_products": products[:10],
        "orders": order_rows,
    }


def _voucher_rows(db: Session, branch_id: str | None, start: date, end: date) -> list[SupplierVoucher]:
    query = db.query(SupplierVoucher).options(
        selectinload(SupplierVoucher.lines), selectinload(SupplierVoucher.payments)
    ).filter(SupplierVoucher.voucher_date >= start, SupplierVoucher.voucher_date <= end)
    return _branch(query, SupplierVoucher, branch_id).all()


def _supplier_owed_as_of(db: Session, branch_id: str | None, as_of: date) -> float:
    """Supplier balances at a date, including only payments known by that date."""
    vouchers = _voucher_rows(db, branch_id, date.min, as_of)
    return sum(
        voucher_totals(voucher)["total"]
        - sum(float(payment.amount) for payment in voucher.payments if payment.paid_on <= as_of)
        for voucher in vouchers
    )


def _price_history(
    db: Session, branch_id: str | None, through: date
) -> dict[str, list[tuple[date, int, float, WholesaleUnit]]]:
    query = db.query(SupplierVoucherLine, SupplierVoucher).join(
        SupplierVoucher, SupplierVoucherLine.voucher_id == SupplierVoucher.id
    ).filter(SupplierVoucher.voucher_date <= through)
    query = _branch(query, SupplierVoucher, branch_id)
    history: dict[str, list[tuple[date, int, float, WholesaleUnit]]] = defaultdict(list)
    for line, voucher in query.all():
        history[line.stock_code.strip().lower()].append(
            (
                voucher.voucher_date,
                max(0, int(line.quantity_pairs)),
                float(line.buying_price),
                line.unit,
            )
        )
    return history


def _buying_price(
    history: dict[str, list[tuple[date, int, float, WholesaleUnit]]], code: str, on: date
) -> float | None:
    entries = [entry for entry in history.get(code.strip().lower(), []) if entry[0] <= on]
    if not entries:
        return None
    latest = max(entry[0] for entry in entries)
    latest_entries = [entry for entry in entries if entry[0] == latest]
    quantity = sum(entry[1] for entry in latest_entries)
    # A delivery has no voucher allocation, so this latest-date, quantity-weighted
    # price is an estimate rather than a landed cost attribution.
    return (
        sum(priced_amount(entry[1], entry[3], entry[2]) for entry in latest_entries) / quantity
        if quantity
        else None
    )


def _receiving_rows(db: Session, branch_id: str | None, start: date, end: date) -> list[Receiving]:
    query = db.query(Receiving).options(
        selectinload(Receiving.costs), selectinload(Receiving.packages).selectinload(ReceivingPackage.items)
    ).filter(Receiving.received_on >= start, Receiving.received_on <= end)
    return _branch(query, Receiving, branch_id).all()


def _cost_metrics(db: Session, branch_id: str | None, start: date, end: date) -> dict:
    rows = _delivery_rows(db, branch_id, start, end)
    history = _price_history(db, branch_id, end)
    revenue = 0.0
    cost = 0.0
    days: dict[date, dict] = defaultdict(lambda: {"delivered_revenue": 0.0, "cost_of_goods_delivered": 0.0, "priced": False})
    for row in rows:
        movement = row["movement"]
        line = row["line"]
        qty = max(0, int(movement.quantity_pairs))
        amount = priced_amount(qty, line.unit, float(line.selling_price)) if line is not None else 0.0
        price = _buying_price(history, movement.stock_code, movement.delivered_on)
        revenue += amount
        days[movement.delivered_on]["delivered_revenue"] += amount
        if price is not None:
            estimated = priced_amount(qty, WholesaleUnit.PAIR, price)
            cost += estimated
            days[movement.delivered_on]["cost_of_goods_delivered"] += estimated
            days[movement.delivered_on]["priced"] = True
    return {"revenue": revenue, "cost": cost, "days": days, "history": history}


def _freight(db: Session, branch_id: str | None, start: date, end: date) -> tuple[float, list[dict]]:
    receivings = _receiving_rows(db, branch_id, start, end)
    total = 0.0
    rows: list[dict] = []
    for receiving in receivings:
        costs = [(cost.stage, float(cost.amount)) for cost in receiving.costs]
        stages = [receiving.gate]
        staged = cost_by_stage(costs, stages)
        total += sum(row["amount"] for row in staged)
        rows.extend(staged)
    combined: dict[str, float] = defaultdict(float)
    for row in rows:
        combined[row["stage"]] += row["amount"]
    return total, [{"stage": stage, "amount": amount} for stage, amount in combined.items()]


def _writeoffs(db: Session, branch_id: str | None, start: date, end: date, history) -> list[dict]:
    start_dt = datetime.combine(start, time.min)
    end_dt = datetime.combine(end, time.max)
    query = db.query(WholesaleWriteOff).filter(
        WholesaleWriteOff.created_at >= start_dt, WholesaleWriteOff.created_at <= end_dt
    )
    query = _branch(query, WholesaleWriteOff, branch_id)
    return [
        {
            "reference": row.reference,
            "stock_code": row.stock_code,
            "description": row.description,
            "quantity_pairs": row.quantity,
            "reason": row.reason.value if hasattr(row.reason, "value") else row.reason,
            "buying_price": _buying_price(history, row.stock_code, row.created_at.date()),
            "value": priced_amount(
                row.quantity,
                WholesaleUnit.PAIR,
                _buying_price(history, row.stock_code, row.created_at.date()) or 0,
            ),
        }
        for row in query.order_by(WholesaleWriteOff.created_at).all()
    ]


def cost_report(db: Session, branch_id: str | None, window) -> dict:
    vouchers = _voucher_rows(db, branch_id, window.start, window.end)
    previous_vouchers = _voucher_rows(db, branch_id, window.previous_start, window.previous_end)
    current = _cost_metrics(db, branch_id, window.start, window.end)
    previous = _cost_metrics(db, branch_id, window.previous_start, window.previous_end)
    freight, freight_by_stage = _freight(db, branch_id, window.start, window.end)
    previous_freight, _ = _freight(db, branch_id, window.previous_start, window.previous_end)
    all_vouchers = _voucher_rows(db, branch_id, date.min, date.today())
    owed = _supplier_owed_as_of(db, branch_id, date.today())
    period_owed = _supplier_owed_as_of(db, branch_id, window.previous_end)
    margin = current["revenue"] - current["cost"]
    previous_margin = previous["revenue"] - previous["cost"]
    trend = []
    for day in each_day(window.start, window.end):
        item = current["days"].get(day)
        revenue = item["delivered_revenue"] if item else 0.0
        trend.append({
            "date": day.isoformat(),
            "delivered_revenue": revenue,
            "cost_of_goods_delivered": item["cost_of_goods_delivered"] if item and item["priced"] else (0.0 if revenue == 0 else None),
        })
    supplier_map: dict[str, dict] = defaultdict(lambda: {"vouchers": 0, "pairs": 0, "value": 0.0, "paid": 0.0, "balance": 0.0})
    for voucher in vouchers:
        totals = voucher_totals(voucher)
        item = supplier_map[voucher.supplier_name.strip()]
        item["vouchers"] += 1
        item["pairs"] += sum(line.quantity_pairs for line in voucher.lines)
        item["value"] += totals["total"]
        item["paid"] += totals["paid"]
        item["balance"] += totals["balance_due"]
    suppliers = [{"supplier_name": name, **values} for name, values in supplier_map.items()]
    suppliers.sort(key=lambda row: row["value"], reverse=True)
    payables = []
    today = date.today()
    for voucher in all_vouchers:
        balance = voucher_totals(voucher)["balance_due"]
        if balance > 0:
            payables.append({
                "voucher_no": voucher.voucher_no,
                "supplier_name": voucher.supplier_name.strip(),
                "voucher_date": voucher.voucher_date.isoformat(),
                "days_since": max(0, (today - voucher.voucher_date).days),
                "balance_due": balance,
            })
    return {
        **_window_payload(window),
        "purchases": kpi_value(sum(voucher_totals(v)["total"] for v in vouchers), sum(voucher_totals(v)["total"] for v in previous_vouchers)),
        "freight_and_handling": kpi_value(freight, previous_freight),
        "gross_margin_pct": kpi_value(margin / current["revenue"] * 100 if current["revenue"] else 0.0, previous_margin / previous["revenue"] * 100 if previous["revenue"] else 0.0),
        "owed_to_suppliers": kpi_value(owed, period_owed),
        "trend": trend,
        "freight_by_stage": freight_by_stage,
        "suppliers": suppliers,
        "payables": payables,
        "write_offs": _writeoffs(db, branch_id, window.start, window.end, current["history"]),
    }


def _inventory_movements(db: Session, branch_id: str | None, start: date, end: date) -> tuple[int, int]:
    incoming_query = db.query(func.coalesce(func.sum(ReceivingItem.quantity_pairs), 0)).join(
        ReceivingPackage, ReceivingItem.package_id == ReceivingPackage.id
    ).join(Receiving, ReceivingPackage.receiving_id == Receiving.id).filter(
        ReceivingPackage.opened.is_(True),
        func.coalesce(ReceivingPackage.received_on, Receiving.received_on) >= start,
        func.coalesce(ReceivingPackage.received_on, Receiving.received_on) <= end,
    )
    incoming = _branch(incoming_query, Receiving, branch_id).scalar() or 0
    outgoing_query = db.query(func.coalesce(func.sum(WholesaleStockMovement.quantity_pairs), 0)).join(
        CustomerOrder, WholesaleStockMovement.order_id == CustomerOrder.id
    ).filter(
        WholesaleStockMovement.delivered_on >= start,
        WholesaleStockMovement.delivered_on <= end,
        CustomerOrder.cancelled.is_(False),
    )
    outgoing = _branch(outgoing_query, WholesaleStockMovement, branch_id).scalar() or 0
    return int(incoming), int(outgoing)


def inventory_report(db: Session, branch_id: str | None, window) -> dict:
    records = stock_records(db, branch_id)
    history = _price_history(db, branch_id, date.today())
    on_hand = sum(row["on_hand_pairs"] for row in records)
    available = sum(row["available_pairs"] for row in records)
    incoming = sum(row["incoming_pairs"] for row in records)
    stock_value = sum(
        priced_amount(
            row["on_hand_pairs"],
            WholesaleUnit.PAIR,
            _buying_price(history, row["stock_code"], date.today()) or 0,
        )
        for row in records
    )
    received, delivered = _inventory_movements(db, branch_id, window.start, window.end)
    locations: dict[str, int] = defaultdict(int)
    products = []
    cannot_supply = []
    not_moving = []
    for row in records:
        for location in row["locations"]:
            locations[location["location"]] += location["on_hand_pairs"]
        item = {
            "stock_code": row["stock_code"],
            "description": row["description"],
            "on_hand_pairs": row["on_hand_pairs"],
            "available_pairs": row["available_pairs"],
            "allocated_pairs": row["allocated_pairs"],
            "at_supplier_pairs": row["at_supplier_pairs"],
            "in_transit_pairs": row["in_transit_pairs"],
            "incoming_pairs": row["incoming_pairs"],
            "owed_to_customers_pairs": row["owed_to_customers_pairs"],
            "last_movement_on": row["last_activity_on"].isoformat() if row["last_activity_on"] else None,
            "stock_value": priced_amount(
                row["on_hand_pairs"],
                WholesaleUnit.PAIR,
                _buying_price(history, row["stock_code"], date.today()) or 0,
            ),
            "locations": row["locations"],
        }
        products.append(item)
        if row["owed_to_customers_pairs"] > 0 and row["on_hand_pairs"] + row["incoming_pairs"] == 0:
            cannot_supply.append(item)
        if row["on_hand_pairs"] > 0:
            days_since = (date.today() - row["last_activity_on"]).days if row["last_activity_on"] else None
            not_moving.append({**item, "days_since": days_since})
    products.sort(key=lambda row: row["stock_code"])
    not_moving.sort(key=lambda row: row["days_since"] if row["days_since"] is not None else 10**9, reverse=True)
    pipeline = [
        {"stage": "At supplier", "pairs": sum(row["at_supplier_pairs"] for row in records)},
        {"stage": "In transit", "pairs": sum(row["in_transit_pairs"] for row in records)},
        {"stage": "On hand", "pairs": on_hand},
        {"stage": "Allocated", "pairs": sum(row["allocated_pairs"] for row in records)},
    ]
    return {
        **_window_payload(window),
        "on_hand": {"value": float(on_hand), "previous_value": None, "delta_pct": None},
        "available": {"value": float(available), "previous_value": None, "delta_pct": None},
        "incoming": {"value": float(incoming), "previous_value": None, "delta_pct": None},
        "stock_value": {"value": float(stock_value), "previous_value": None, "delta_pct": None},
        "received_in_period": received,
        "delivered_in_period": delivered,
        "locations": [{"location": name, "on_hand_pairs": pairs} for name, pairs in sorted(locations.items())],
        "pipeline": pipeline,
        "products": products,
        "cannot_supply": cannot_supply,
        "not_moving": not_moving,
    }


def _normal_customer(name: str) -> str:
    return " ".join(name.strip().lower().split())


def _customer_receivables_as_of(db: Session, branch_id: str | None, as_of: date) -> float:
    orders = [order for order in _orders(db, branch_id, date.min, as_of) if not order.cancelled]
    delivered = delivered_pairs_by_order(db, [order.id for order in orders], branch_id)
    total = 0.0
    for order in orders:
        delivered_pairs = sum(delivered.get(order.id, {}).values())
        status = order_status(
            sum(line.quantity_pairs for line in order.lines),
            delivered_pairs,
            sum(line.allocated_quantity_pairs for line in order.lines),
            False,
            sum(line.lost_quantity_pairs for line in order.lines),
        )
        if status != "fulfilled":
            order_total = sum(
                priced_amount(line.quantity_pairs, line.unit, float(line.selling_price))
                for line in order.lines
            )
            paid = sum(float(payment.amount) for payment in order.payments if payment.paid_on <= as_of)
            total += order_total - paid
    return total


def customer_report(db: Session, branch_id: str | None, window) -> dict:
    orders = [order for order in _orders(db, branch_id, window.start, window.end) if not order.cancelled]
    previous_orders = [order for order in _orders(db, branch_id, window.previous_start, window.previous_end) if not order.cancelled]
    all_orders = [order for order in _all_orders(db, branch_id) if not order.cancelled]
    rows = _delivery_rows(db, branch_id, window.start, window.end)
    previous_rows = _delivery_rows(db, branch_id, window.previous_start, window.previous_end)
    delivered = _delivered_metrics(rows)
    previous = _delivered_metrics(previous_rows)
    names = {_normal_customer(order.customer_name) for order in orders}
    previous_names = {_normal_customer(order.customer_name) for order in all_orders if order.order_date < window.start}
    previous_period_names = {_normal_customer(order.customer_name) for order in previous_orders}
    ordered = _ordered_value(orders)
    previous_ordered = _ordered_value(previous_orders)
    receivables = 0.0
    order_rows = []
    delivered_by_order: dict[str, int] = defaultdict(int)
    last_delivery: dict[str, date] = {}
    for row in rows:
        delivered_by_order[row["order"].id] += int(row["movement"].quantity_pairs)
        last_delivery[row["order"].id] = max(last_delivery.get(row["order"].id, row["movement"].delivered_on), row["movement"].delivered_on)
    fulfilment: list[int] = []
    for order in orders:
        totals = order_totals(order)
        pairs_ordered = sum(line.quantity_pairs for line in order.lines)
        pairs_delivered = delivered_by_order.get(order.id, 0)
        status = order_status(pairs_ordered, pairs_delivered, sum(line.allocated_quantity_pairs for line in order.lines), False, sum(line.lost_quantity_pairs for line in order.lines))
        if status not in ("fulfilled", "cancelled"):
            receivables += totals["balance_due"]
        if status == "fulfilled" and order.id in last_delivery:
            fulfilment.append(max(0, (last_delivery[order.id] - order.order_date).days))
        order_rows.append({
            "order_no": order.order_no,
            "customer_name": order.customer_name.strip(),
            "order_date": order.order_date.isoformat(),
            "pairs_ordered": pairs_ordered,
            "pairs_delivered": pairs_delivered,
            "balance_due": totals["balance_due"],
            "days_open": max(0, (date.today() - order.order_date).days),
        })
    # Receivables are point-in-time, so open orders outside the selected period matter too.
    receivables = sum(
        order_totals(order)["balance_due"]
        for order in all_orders
        if order_status(sum(line.quantity_pairs for line in order.lines), delivered_by_order.get(order.id, 0), sum(line.allocated_quantity_pairs for line in order.lines), False, sum(line.lost_quantity_pairs for line in order.lines)) != "fulfilled"
    )
    ranking_map: dict[str, dict] = defaultdict(lambda: {"orders": 0, "pairs_ordered": 0, "pairs_delivered": 0, "delivered_revenue": 0.0, "paid": 0.0, "balance": 0.0})
    for order in orders:
        key = _normal_customer(order.customer_name)
        item = ranking_map[key]
        totals = order_totals(order)
        item["orders"] += 1
        item["pairs_ordered"] += sum(line.quantity_pairs for line in order.lines)
        item["pairs_delivered"] += delivered_by_order.get(order.id, 0)
        item["paid"] += totals["paid"]
        item["balance"] += totals["balance_due"]
    for row in rows:
        line = row["line"]
        if line is not None:
            item = ranking_map[_normal_customer(row["order"].customer_name)]
            item["delivered_revenue"] += priced_amount(
                int(row["movement"].quantity_pairs), line.unit, float(line.selling_price)
            )
    # Receivables are point-in-time figures. Rebuild the delivery and payment view at
    # each as-of date so an older order is not treated as open merely because its
    # delivery fell outside this report window.
    receivables = _customer_receivables_as_of(db, branch_id, date.today())
    previous_receivables = _customer_receivables_as_of(db, branch_id, window.previous_end)
    ranking = [
        {"customer_name": next((o.customer_name.strip() for o in orders if _normal_customer(o.customer_name) == key), key), **value}
        for key, value in ranking_map.items()
    ]
    ranking.sort(key=lambda row: row["delivered_revenue"], reverse=True)
    quiet = sorted(
        {order.customer_name.strip() for order in all_orders if _normal_customer(order.customer_name) not in names and order.order_date < window.start},
        key=str.casefold,
    )
    trend = [{"date": day.isoformat(), "order_count": sum(1 for order in orders if order.order_date == day)} for day in each_day(window.start, window.end)]
    return {
        **_window_payload(window),
        "active_customers": kpi_value(float(len(names)), float(len(previous_period_names))),
        "new_customers": kpi_value(float(len(names - previous_names)), float(len(previous_period_names - {_normal_customer(order.customer_name) for order in all_orders if order.order_date < window.previous_start}))),
        "average_order_value": kpi_value(ordered / len(orders) if orders else 0.0, previous_ordered / len(previous_orders) if previous_orders else 0.0),
        "receivables": kpi_value(receivables, previous_receivables),
        "fulfilment_days": {"value": sum(fulfilment) / len(fulfilment) if fulfilment else 0.0, "previous_value": None, "delta_pct": None},
        "trend": trend,
        "top_customers": ranking[:10],
        "ranking": ranking,
        "open_orders": [row for row in order_rows if row["balance_due"] > 0 or row["pairs_delivered"] < row["pairs_ordered"]],
        "quiet_customers": [{"customer_name": name} for name in quiet],
    }
