"""Server-side aggregation for the wholesale Dashboard's Revenue, Customer and Inventory
tabs.

The list endpoints are intentionally not used here: their pagination is useful for
screens, but would make a figure silently incomplete. Each tab filters its source rows in
SQL and then performs the small amount of cross-entity arithmetic in memory.

Revenue is recognised on delivery: an order that was placed but not delivered adds nothing
to it, and cancelled orders add nothing anywhere.
"""

from collections import defaultdict
from datetime import date

from sqlalchemy.orm import Session, selectinload

from app.retail.services.reporting import each_day, kpi_value
from app.wholesale.models.entities import (
    CustomerOrder,
    CustomerOrderLine,
    Receiving,
    SupplierVoucher,
    SupplierVoucherLine,
    WholesalePayment,
    WholesaleStockMovement,
    WholesaleUnit,
)
from app.wholesale.services.inventory import delivered_pairs_by_order
from app.wholesale.services.money import voucher_totals
from app.wholesale.services.orders import order_status
from app.wholesale.services.stock_records import stock_records
from app.wholesale.services.units import priced_amount

# What a delivery is attributed to when no supplier voucher for that product came before it.
UNKNOWN_FACTORY = "Unknown factory"


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


def _payments(db: Session, branch_id: str | None, start: date, end: date) -> list[WholesalePayment]:
    """Money customers paid against orders in the window (cancelled orders excluded)."""
    query = (
        db.query(WholesalePayment)
        .join(CustomerOrder, WholesalePayment.order_id == CustomerOrder.id)
        .filter(
            WholesalePayment.paid_on >= start,
            WholesalePayment.paid_on <= end,
            WholesalePayment.order_id.isnot(None),
            CustomerOrder.cancelled.is_(False),
        )
    )
    return _branch(query, WholesalePayment, branch_id).all()


def _delivered_amount(row: dict) -> tuple[int, float]:
    movement = row["movement"]
    line = row["line"]
    qty = max(0, int(movement.quantity_pairs))
    amount = priced_amount(qty, line.unit, float(line.selling_price)) if line is not None else 0.0
    return qty, amount


def _ordered_value(orders: list[CustomerOrder]) -> float:
    return sum(
        sum(priced_amount(line.quantity_pairs, line.unit, float(line.selling_price)) for line in order.lines)
        for order in orders if not order.cancelled
    )


# --- buying prices and factories -------------------------------------------------------

_PriceEntry = tuple[date, int, float, WholesaleUnit, str]


def _price_history(db: Session, branch_id: str | None, through: date) -> dict[str, list[_PriceEntry]]:
    """Every supplier-voucher line up to a date, by stock code: (date, pairs, buying price,
    the unit that price is quoted in, the factory)."""
    query = db.query(SupplierVoucherLine, SupplierVoucher).join(
        SupplierVoucher, SupplierVoucherLine.voucher_id == SupplierVoucher.id
    ).filter(SupplierVoucher.voucher_date <= through)
    query = _branch(query, SupplierVoucher, branch_id)
    history: dict[str, list[_PriceEntry]] = defaultdict(list)
    for line, voucher in query.all():
        history[line.stock_code.strip().lower()].append(
            (
                voucher.voucher_date,
                max(0, int(line.quantity_pairs)),
                float(line.buying_price),
                line.unit,
                voucher.supplier_name.strip(),
            )
        )
    return history


def _latest_entries(history: dict[str, list[_PriceEntry]], code: str, on: date) -> list[_PriceEntry]:
    entries = [entry for entry in history.get(code.strip().lower(), []) if entry[0] <= on]
    if not entries:
        return []
    latest = max(entry[0] for entry in entries)
    return [entry for entry in entries if entry[0] == latest]


def _buying_price(history: dict[str, list[_PriceEntry]], code: str, on: date) -> float | None:
    """The estimated buying price per pair: the quantity-weighted price on the latest
    voucher date on or before `on`. A delivery has no voucher allocation, so this is an
    estimate rather than a landed cost attribution."""
    latest_entries = _latest_entries(history, code, on)
    quantity = sum(entry[1] for entry in latest_entries)
    return (
        sum(priced_amount(entry[1], entry[3], entry[2]) for entry in latest_entries) / quantity
        if quantity
        else None
    )


def _factory(history: dict[str, list[_PriceEntry]], code: str, on: date) -> str:
    """The factory a delivery of this product is attributed to: whoever supplied the most
    of it on the latest voucher date on or before the delivery — the same voucher the
    buying-price estimate is read from."""
    latest_entries = _latest_entries(history, code, on)
    if not latest_entries:
        return UNKNOWN_FACTORY
    by_factory: dict[str, int] = defaultdict(int)
    for entry in latest_entries:
        by_factory[entry[4]] += entry[1]
    return max(by_factory.items(), key=lambda item: item[1])[0] or UNKNOWN_FACTORY


def _latest_selling_prices(
    db: Session, branch_id: str | None
) -> dict[str, tuple[WholesaleUnit, float]]:
    """The price each product was last quoted to a customer, by stock code, with the unit
    it was quoted in — what a pair still on the shelf is expected to sell for."""
    query = (
        db.query(CustomerOrderLine, CustomerOrder)
        .join(CustomerOrder, CustomerOrderLine.order_id == CustomerOrder.id)
        .filter(CustomerOrder.cancelled.is_(False))
    )
    query = _branch(query, CustomerOrder, branch_id)
    latest: dict[str, tuple[date, WholesaleUnit, float]] = {}
    for line, order in query.all():
        code = line.stock_code.strip().lower()
        if float(line.selling_price) <= 0:
            continue
        if code not in latest or order.order_date >= latest[code][0]:
            latest[code] = (order.order_date, line.unit, float(line.selling_price))
    return {code: (unit, price) for code, (_, unit, price) in latest.items()}


# --- customers -------------------------------------------------------------------------

def _normal_customer(name: str) -> str:
    return " ".join(name.strip().lower().split())


def _delivered_total(delivered: dict[str, dict[str, int]], order_id: str) -> int:
    return sum(delivered.get(order_id, {}).values())


def _order_state(order: CustomerOrder, delivered_pairs: int) -> tuple[int, str]:
    """`(pairs still to deliver, status)` for an order given what has left so far."""
    wanted = sum(line.quantity_pairs for line in order.lines)
    lost = sum(line.lost_quantity_pairs for line in order.lines)
    status = order_status(
        wanted,
        delivered_pairs,
        sum(line.allocated_quantity_pairs for line in order.lines),
        False,
        lost,
    )
    return max(0, wanted - delivered_pairs - lost), status


def _customer_receivables_summary(db: Session, branch_id: str | None, as_of: date) -> tuple[float, list[dict]]:
    """Total customer receivables and breakdown by debtor customer."""
    orders = [order for order in _orders(db, branch_id, date.min, as_of) if not order.cancelled]
    delivered = delivered_pairs_by_order(db, [order.id for order in orders], branch_id)
    total = 0.0
    by_customer: dict[str, dict] = {}
    for order in orders:
        _, status = _order_state(order, _delivered_total(delivered, order.id))
        if status != "fulfilled":
            order_total = sum(
                priced_amount(line.quantity_pairs, line.unit, float(line.selling_price))
                for line in order.lines
            )
            paid = sum(float(payment.amount) for payment in order.payments if payment.paid_on <= as_of)
            due = order_total - paid
            if due > 0:
                total += due
                norm = _normal_customer(order.customer_name)
                if norm not in by_customer:
                    by_customer[norm] = {
                        "customer_name": order.customer_name.strip(),
                        "balance_due": 0.0,
                        "order_count": 0,
                    }
                by_customer[norm]["balance_due"] += due
                by_customer[norm]["order_count"] += 1
    top_debtors = sorted(by_customer.values(), key=lambda x: x["balance_due"], reverse=True)
    return total, top_debtors[:8]


# --- Revenue ---------------------------------------------------------------------------

def _stock_values(db: Session, branch_id: str | None) -> tuple[float, float]:
    """`(potential sales value, cost value)` of the pairs on hand now.

    Potential sales value is each product's on-hand pairs at the price it was last quoted to
    a customer; cost value is the same pairs at the estimated buying price. A product with
    no known price on a side adds nothing to that side rather than a guess.
    """
    records = stock_records(db, branch_id)
    history = _price_history(db, branch_id, date.today())
    selling = _latest_selling_prices(db, branch_id)
    potential = 0.0
    cost = 0.0
    for row in records:
        pairs = row["on_hand_pairs"]
        if pairs <= 0:
            continue
        code = row["stock_code"]
        quoted = selling.get(code.strip().lower())
        if quoted is not None:
            potential += priced_amount(pairs, quoted[0], quoted[1])
        cost += priced_amount(pairs, WholesaleUnit.PAIR, _buying_price(history, code, date.today()) or 0)
    return potential, cost


def revenue_dashboard(db: Session, branch_id: str | None, window) -> dict:
    rows = _delivery_rows(db, branch_id, window.start, window.end)
    previous_rows = _delivery_rows(db, branch_id, window.previous_start, window.previous_end)
    history = _price_history(db, branch_id, window.end)

    revenue = 0.0
    previous_revenue = sum(_delivered_amount(row)[1] for row in previous_rows)
    by_day: dict[date, float] = defaultdict(float)
    by_factory: dict[str, float] = defaultdict(float)
    by_product: dict[str, dict] = {}
    for row in rows:
        qty, amount = _delivered_amount(row)
        revenue += amount
        day = row["movement"].delivered_on
        by_day[day] += amount
        code = row["movement"].stock_code.strip()
        if code:
            norm = code.lower()
            if norm not in by_product:
                by_product[norm] = {
                    "stock_code": code,
                    "quantity_pairs": 0,
                    "quantity_sets": 0,
                    "delivered_revenue": 0.0,
                }
            by_product[norm]["quantity_pairs"] += qty
            by_product[norm]["quantity_sets"] = by_product[norm]["quantity_pairs"] // 6
            by_product[norm]["delivered_revenue"] += amount
        by_factory[_factory(history, row["movement"].stock_code, day)] += amount

    collected_rows = _payments(db, branch_id, window.start, window.end)
    collected = sum(float(payment.amount) for payment in collected_rows)
    previous_collected = sum(
        float(payment.amount)
        for payment in _payments(db, branch_id, window.previous_start, window.previous_end)
    )
    collected_by_day: dict[date, float] = defaultdict(float)
    for payment in collected_rows:
        collected_by_day[payment.paid_on] += float(payment.amount)

    potential_sales, stock_cost = _stock_values(db, branch_id)
    factories = sorted(
        ({"factory_name": name, "delivered_revenue": amount} for name, amount in by_factory.items() if amount > 0),
        key=lambda row: row["delivered_revenue"],
        reverse=True,
    )
    receivables_total, customer_receivables = _customer_receivables_summary(db, branch_id, window.end)
    top_products = sorted(by_product.values(), key=lambda r: r["delivered_revenue"], reverse=True)[:8]

    return {
        **_window_payload(window),
        "delivered_revenue": kpi_value(revenue, previous_revenue),
        "collected": kpi_value(collected, previous_collected),
        "receivables": receivables_total,
        "customer_receivables": customer_receivables,
        "top_products": top_products,
        "potential_stock_sales_value": potential_sales,
        "inventory_cost_value": stock_cost,
        "potential_gross_profit": potential_sales - stock_cost,
        "trend": [
            {
                "date": day.isoformat(),
                "delivered_revenue": by_day.get(day, 0.0),
                "collected": collected_by_day.get(day, 0.0),
            }
            for day in each_day(window.start, window.end)
        ],
        "factories": factories,
        "top_factory_share_pct": (
            factories[0]["delivered_revenue"] / revenue * 100 if factories and revenue else 0.0
        ),
    }


# --- Cost ------------------------------------------------------------------------------

# How many factories and unpaid vouchers the Cost tab lists.
FACTORIES_SHOWN = 6
PAYABLES_SHOWN = 10


def _vouchers(db: Session, branch_id: str | None, start: date, end: date) -> list[SupplierVoucher]:
    query = db.query(SupplierVoucher).options(
        selectinload(SupplierVoucher.lines), selectinload(SupplierVoucher.payments)
    ).filter(SupplierVoucher.voucher_date >= start, SupplierVoucher.voucher_date <= end)
    return _branch(query, SupplierVoucher, branch_id).all()


def _cost_to_bring_in(db: Session, branch_id: str | None, start: date, end: date) -> float:
    """Everything spent getting goods in (freight, handling and the like), on the receivings
    that arrived in the window. It is one figure for the whole batch: it is never split
    across the products it covers."""
    query = db.query(Receiving).options(selectinload(Receiving.costs)).filter(
        Receiving.received_on >= start, Receiving.received_on <= end
    )
    return sum(
        float(cost.amount) for receiving in _branch(query, Receiving, branch_id).all() for cost in receiving.costs
    )


def cost_dashboard(db: Session, branch_id: str | None, window) -> dict:
    vouchers = _vouchers(db, branch_id, window.start, window.end)
    by_factory: dict[str, float] = defaultdict(float)
    goods = 0.0
    for voucher in vouchers:
        total = voucher_totals(voucher)["total"]
        goods += total
        by_factory[voucher.supplier_name.strip() or UNKNOWN_FACTORY] += total
    cost = _cost_to_bring_in(db, branch_id, window.start, window.end)
    total_cost = goods + cost

    # What is still unpaid to suppliers at the end of the window, counting only payments
    # known by then — the same "as of the end date" reading as the Revenue tab's receivables.
    unpaid = []
    for voucher in _vouchers(db, branch_id, date.min, window.end):
        balance = voucher_totals(voucher)["total"] - sum(
            float(payment.amount) for payment in voucher.payments if payment.paid_on <= window.end
        )
        if balance > 0:
            unpaid.append((voucher, balance))
    unpaid.sort(key=lambda item: (item[0].voucher_date, item[0].voucher_no), reverse=True)

    factories = sorted(
        ({"factory_name": name, "purchased": amount} for name, amount in by_factory.items() if amount > 0),
        key=lambda row: row["purchased"],
        reverse=True,
    )
    return {
        **_window_payload(window),
        "goods_purchased": goods,
        "cost_to_bring_in": cost,
        "total_cost": total_cost,
        "goods_share_pct": goods / total_cost * 100 if total_cost else 0.0,
        "cost_share_pct": cost / total_cost * 100 if total_cost else 0.0,
        "supplier_balance_due": sum(balance for _, balance in unpaid),
        "factories": factories[:FACTORIES_SHOWN],
        "factory_count": len(factories),
        "payable_count": len(unpaid),
        "payables": [
            {
                "voucher_id": voucher.id,
                "voucher_no": voucher.voucher_no,
                "supplier_name": voucher.supplier_name.strip(),
                "voucher_date": voucher.voucher_date.isoformat(),
                "days_open": max(0, (window.end - voucher.voucher_date).days),
                "balance_due": balance,
            }
            for voucher, balance in unpaid[:PAYABLES_SHOWN]
        ],
    }


# --- Customer --------------------------------------------------------------------------

# How many rows the Customer tab's ranking and waiting-orders list show.
TOP_CUSTOMERS = 8
AWAITING_ORDERS = 10


def customer_dashboard(db: Session, branch_id: str | None, window) -> dict:
    orders = [o for o in _orders(db, branch_id, window.start, window.end) if not o.cancelled]
    previous_orders = [
        o for o in _orders(db, branch_id, window.previous_start, window.previous_end) if not o.cancelled
    ]
    all_orders = [o for o in _all_orders(db, branch_id) if not o.cancelled]

    names = {_normal_customer(o.customer_name) for o in orders}
    previous_period_names = {_normal_customer(o.customer_name) for o in previous_orders}
    earlier_names = {_normal_customer(o.customer_name) for o in all_orders if o.order_date < window.start}
    earlier_than_previous = {
        _normal_customer(o.customer_name) for o in all_orders if o.order_date < window.previous_start
    }
    new_names = names - earlier_names
    repeat_names = names & earlier_names

    delivered = delivered_pairs_by_order(db, [o.id for o in all_orders], branch_id)
    state = {o.id: _order_state(o, _delivered_total(delivered, o.id)) for o in all_orders}

    # Who ordered the most, by what they ordered (not by what has been delivered yet).
    ordered_by_customer: dict[str, dict] = {}
    for order in orders:
        key = _normal_customer(order.customer_name)
        item = ordered_by_customer.setdefault(key, {"customer_name": order.customer_name.strip(), "ordered_value": 0.0})
        item["ordered_value"] += _ordered_value([order])
    ranking = sorted(ordered_by_customer.values(), key=lambda row: row["ordered_value"], reverse=True)

    status_counts = {"fulfilled": 0, "partly_delivered": 0, "awaiting_delivery": 0}
    for order in orders:
        status = state[order.id][1]
        if status == "fulfilled":
            status_counts["fulfilled"] += 1
        elif status == "partly_delivered":
            status_counts["partly_delivered"] += 1
        else:
            status_counts["awaiting_delivery"] += 1

    open_orders = sorted(
        (o for o in all_orders if state[o.id][1] != "fulfilled"),
        key=lambda o: (o.order_date, o.order_no),
        reverse=True,
    )
    return {
        **_window_payload(window),
        "active_customers": kpi_value(float(len(names)), float(len(previous_period_names))),
        "new_customers": kpi_value(
            float(len(new_names)),
            float(len(previous_period_names - earlier_than_previous)),
        ),
        "repeat_customers": {
            "value": float(len(repeat_names)),
            "share_of_active_pct": len(repeat_names) / len(names) * 100 if names else 0.0,
        },
        "open_orders": float(len(open_orders)),
        "order_count": len(orders),
        "total_ordered_value": sum(row["ordered_value"] for row in ranking),
        "top_customers": ranking[:TOP_CUSTOMERS],
        "delivery_status": status_counts,
        "awaiting_orders": [
            {
                "order_id": order.id,
                "order_no": order.order_no,
                "customer_name": order.customer_name.strip(),
                "order_date": order.order_date.isoformat(),
                "remaining_pairs": state[order.id][0],
                "status": state[order.id][1],
            }
            for order in open_orders[:AWAITING_ORDERS]
        ],
    }


# --- Inventory -------------------------------------------------------------------------

def inventory_dashboard(db: Session, branch_id: str | None) -> dict:
    """Where the stock is right now: a point-in-time view with no period."""
    records = stock_records(db, branch_id)
    locations: dict[str, int] = defaultdict(int)
    groups: dict[str, dict[str, int]] = {}
    for row in records:
        for location in row["locations"]:
            locations[location["location"]] += location["on_hand_pairs"]
        group = groups.setdefault(row["product_group"], {"available_pairs": 0, "committed_pairs": 0, "incoming_pairs": 0})
        group["available_pairs"] += row["available_pairs"]
        group["committed_pairs"] += row["allocated_pairs"]
        group["incoming_pairs"] += row["incoming_pairs"]
    return {
        "total_products": len(records),
        "on_hand_pairs": sum(row["on_hand_pairs"] for row in records),
        "available_pairs": sum(row["available_pairs"] for row in records),
        "committed_pairs": sum(row["allocated_pairs"] for row in records),
        "incoming_pairs": sum(row["incoming_pairs"] for row in records),
        "at_supplier_pairs": sum(row["at_supplier_pairs"] for row in records),
        "in_transit_pairs": sum(row["in_transit_pairs"] for row in records),
        "backlog_pairs": sum(row["owed_to_customers_pairs"] for row in records),
        "locations": [
            {"location": name, "on_hand_pairs": pairs} for name, pairs in sorted(locations.items())
        ],
        "groups": [
            {"product_group": name, **values}
            for name, values in sorted(
                groups.items(),
                key=lambda item: -(item[1]["available_pairs"] + item[1]["committed_pairs"] + item[1]["incoming_pairs"]),
            )
        ],
    }
