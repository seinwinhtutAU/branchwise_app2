from collections import defaultdict

from sqlalchemy.orm import Session

from app.wholesale.services.inventory import (
    delivered_pairs_by_order,
)
from app.wholesale.services.money import voucher_totals
from app.wholesale.services.orders import list_orders
from app.wholesale.services.supplier_vouchers_service import list_vouchers


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


def wholesale_summary_snapshot(
    db: Session,
    branch_id: str | None,
    location: str | None = None,
    window=None,
) -> dict:
    from app.wholesale.services.dashboard import _stock_values, revenue_dashboard
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

    if window is None:
        from app.wholesale.routers.common import resolve_window
        window = resolve_window("30d")
    revenue = revenue_dashboard(db, branch_id, window)
    palette = ["#5252E8", "#7575EA", "#A2A2F1", "#C7C7F7"]
    factories = [
        {"name": row["factory_name"], "revenue": row["delivered_revenue"], "color": palette[min(index, len(palette) - 1)]}
        for index, row in enumerate((revenue["factories"] if revenue else [])[:4])
    ]
    revenue_this_period = revenue["delivered_revenue"]["value"] if revenue else 0.0

    vouchers = unpaid_vouchers(db, branch_id)
    to_pay_suppliers = sum(float(r["balance_due"]) for r in vouchers["rows"])
    money_received = float(revenue["collected"]["value"]) if revenue else 0.0
    unpaid_by_customers = float(revenue["receivables"]) if revenue else 0.0
    potential_sales, stock_cost = _stock_values(db, branch_id)
    inventory_value = float(revenue["inventory_cost_value"]) if (revenue and revenue.get("inventory_cost_value", 0) > 0) else float(stock_cost or potential_sales)

    return {
        "physical_stock_sets": on_hand_sets,
        "available_sets": available_sets,
        "committed_sets": committed_sets,
        "incoming_stock_sets": incoming_sets,
        "supplier_sets": supplier_sets,
        "transit_sets": transit_sets,
        "backlog_sets": backlog_sets,
        "money_received": money_received,
        "unpaid_by_customers": unpaid_by_customers,
        "to_pay_suppliers": to_pay_suppliers,
        "inventory_value": inventory_value,
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

