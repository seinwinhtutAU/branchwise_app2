"""Purchasing decision support engine for retail branches.

Translates sales, inventory, and purchase data into actionable purchasing recommendations:
1. Product Master aggregation (latest stock snapshot per branch).
2. Missing selling price recovery from historical sales.
3. ABC analysis based on cumulative net sales revenue (A=top 80%, B=next 15%, C=bottom 5%, N=no sales).
4. Dynamic price range tiering (Low, Mid, High based on 25th and 75th percentiles).
5. Sales velocity (Avg_Monthly_Sales) and Stock Coverage (months).
6. Target stock buffer and Suggested Reorder Quantity calculation.
7. Deduplicated recent purchase alerts (Recent Purchase Exists).
8. Recommendation categorization:
   - Urgent Reorder: A-class products with zero/negative stock.
   - Reorder: Stock below target buffer.
   - Hold / Monitor: Adequate or high stock coverage.
   - Review / Do Not Reorder: Products with no sales recorded.
"""

from datetime import date
import math
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.retail.models.product import Product
from app.retail.models.purchase import Purchase, PurchaseLine
from app.retail.models.sale import Sale, SaleLine
from app.retail.services.stock import latest_stock_query
from app.services.settings import get_purchasing_buffer_months


def get_purchasing_recommendations(
    db: Session,
    branch_id: str | None,
    target_months: float | None = None,
    buffer_months: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Computes full purchasing recommendations for a specific branch (or all retail branches if branch_id is None).

    Uses per-ABC target buffer months configured in settings (A: core 3mo, B: mid 2.5mo, C: long-tail 1mo),
    or explicit target_months override. Returns summary metrics and sorted product recommendation records.
    """
    if buffer_months is None:
        buffer_months = get_purchasing_buffer_months(db)

    # 1. Fetch latest stock snapshots for the branch
    stock_rows = latest_stock_query(db, branch_id).all()
    if not stock_rows:
        return {
            "summary": {
                "total_products": 0,
                "urgent_reorder_count": 0,
                "reorder_count": 0,
                "hold_monitor_count": 0,
                "review_count": 0,
                "total_suggested_units": 0,
                "a_count": 0,
                "b_count": 0,
                "c_count": 0,
                "n_count": 0,
                "buffer_months": buffer_months,
            },
            "rows": [],
        }

    # Map product_id -> (StockLevel, Product, Branch)
    # If multiple stock rows exist for the same product across branches (when branch_id is None),
    # aggregate them.
    product_stock: dict[str, dict[str, Any]] = {}
    for stock_level, product, branch in stock_rows:
        pid = product.id
        on_hand = float(stock_level.on_hand_qty or 0)
        buying_price = float(stock_level.buying_price) if stock_level.buying_price is not None else None
        selling_price = float(stock_level.selling_price) if stock_level.selling_price is not None else None

        if pid not in product_stock:
            product_stock[pid] = {
                "product_id": pid,
                "stock_code": product.stock_code,
                "description": product.description or "",
                "group_name": product.group_name or "",
                "branch_name": branch.name if branch else "",
                "branch_id": stock_level.branch_id,
                "on_hand_qty": on_hand,
                "buying_price": buying_price,
                "selling_price": selling_price,
            }
        else:
            product_stock[pid]["on_hand_qty"] += on_hand
            if product_stock[pid]["selling_price"] is None and selling_price is not None:
                product_stock[pid]["selling_price"] = selling_price
            if product_stock[pid]["buying_price"] is None and buying_price is not None:
                product_stock[pid]["buying_price"] = buying_price

    all_product_ids = list(product_stock.keys())

    # 2. Query historical sales performance for these products
    sales_query = (
        db.query(
            SaleLine.product_id,
            func.sum(SaleLine.qty).label("total_qty"),
            func.sum(SaleLine.net_amount).label("total_net_amount"),
            func.min(Sale.sale_date).label("min_date"),
            func.max(Sale.sale_date).label("max_date"),
        )
        .join(Sale, SaleLine.sale_id == Sale.id)
        .filter(SaleLine.product_id.in_(all_product_ids))
        .filter(SaleLine.net_amount > 0)
    )
    if branch_id is not None:
        sales_query = sales_query.filter(Sale.branch_id == branch_id)

    sales_agg = sales_query.group_by(SaleLine.product_id).all()

    # Query overall date window for sales velocity
    date_window_query = db.query(func.min(Sale.sale_date), func.max(Sale.sale_date))
    if branch_id is not None:
        date_window_query = date_window_query.filter(Sale.branch_id == branch_id)
    overall_min_date, overall_max_date = date_window_query.first() or (None, None)

    if overall_min_date and overall_max_date:
        days_span = max(1, (overall_max_date - overall_min_date).days)
        window_months = max(1.0, days_span / 30.4375)
    else:
        window_months = 1.0

    # Map product_id -> sales metrics
    sales_by_product: dict[str, dict[str, float]] = {}
    total_sales_value_all = 0.0
    for pid, total_qty, total_net, _, _ in sales_agg:
        qty_val = float(total_qty or 0)
        net_val = float(total_net or 0)
        sales_by_product[pid] = {
            "total_qty": qty_val,
            "total_net": net_val,
        }
        total_sales_value_all += net_val

    # Also check if any products are missing selling_price in inventory, look up latest sale price
    products_needing_price = [
        pid for pid, data in product_stock.items() if data["selling_price"] is None or data["selling_price"] <= 0
    ]
    if products_needing_price:
        recent_prices_subquery = (
            db.query(
                SaleLine.product_id,
                SaleLine.selling_price,
            )
            .join(Sale, SaleLine.sale_id == Sale.id)
            .filter(SaleLine.product_id.in_(products_needing_price))
            .filter(SaleLine.selling_price > 0)
            .order_by(SaleLine.product_id, Sale.sale_date.desc())
            .all()
        )
        for pid, s_price in recent_prices_subquery:
            if product_stock[pid]["selling_price"] is None or product_stock[pid]["selling_price"] <= 0:
                product_stock[pid]["selling_price"] = float(s_price)

    # 3. Dynamic Price Range (Low, Mid, High)
    known_prices = sorted(
        [d["selling_price"] for d in product_stock.values() if d["selling_price"] and d["selling_price"] > 0]
    )
    if len(known_prices) >= 4:
        p25 = known_prices[int(len(known_prices) * 0.25)]
        p75 = known_prices[int(len(known_prices) * 0.75)]
    elif known_prices:
        p25 = known_prices[0]
        p75 = known_prices[-1]
    else:
        p25, p75 = 14500.0, 35000.0

    def get_price_range(price: float | None) -> str:
        if price is None or price <= 0:
            return "Mid"
        if price <= p25:
            return "Low"
        elif price <= p75:
            return "Mid"
        else:
            return "High"

    # 4. ABC Classification
    sold_products = sorted(
        [
            (pid, sales_by_product[pid]["total_net"], sales_by_product[pid]["total_qty"])
            for pid in sales_by_product
        ],
        key=lambda x: x[1],
        reverse=True,
    )

    abc_class_map: dict[str, str] = {}
    cum_sales = 0.0
    for pid, net_amount, _ in sold_products:
        prev_pct = (cum_sales / total_sales_value_all * 100) if total_sales_value_all > 0 else 0
        if prev_pct < 80.0:
            abc_class_map[pid] = "A"
        elif prev_pct < 95.0:
            abc_class_map[pid] = "B"
        else:
            abc_class_map[pid] = "C"
        cum_sales += net_amount

    # 5. Query Recent Purchases (to prevent duplicate ordering / warn buyer)
    purchase_query = (
        db.query(
            PurchaseLine.product_id,
            func.sum(PurchaseLine.quantity).label("recent_qty"),
            func.max(Purchase.purchase_date).label("last_purchase_date"),
        )
        .join(Purchase, PurchaseLine.purchase_id == Purchase.id)
        .filter(PurchaseLine.product_id.in_(all_product_ids))
    )
    if branch_id is not None:
        purchase_query = purchase_query.filter(Purchase.branch_id == branch_id)

    purchase_agg = purchase_query.group_by(PurchaseLine.product_id).all()
    purchase_by_product: dict[str, dict[str, Any]] = {}
    for pid, qty, last_dt in purchase_agg:
        purchase_by_product[pid] = {
            "recent_qty": float(qty or 0),
            "last_date": last_dt.isoformat() if last_dt else None,
        }

    # 6. Build final product recommendation records
    result_rows: list[dict[str, Any]] = []
    urgent_count = 0
    reorder_count = 0
    hold_count = 0
    review_count = 0
    total_suggested_units = 0
    a_count = 0
    b_count = 0
    c_count = 0
    n_count = 0

    priority_sort_order = {
        "Urgent Reorder": 1,
        "Reorder": 2,
        "Hold / Monitor": 3,
        "No Reorder Needed": 4,
        "Review / Do Not Reorder": 5,
    }

    for pid, pdata in product_stock.items():
        stock_code = pdata["stock_code"]
        desc = pdata["description"]
        selling_price = pdata["selling_price"]
        buying_price = pdata["buying_price"]
        on_hand_qty = pdata["on_hand_qty"]
        price_range = get_price_range(selling_price)

        sales_info = sales_by_product.get(pid)
        if sales_info:
            total_qty_sold = sales_info["total_qty"]
            total_sales_value = sales_info["total_net"]
            abc_class = abc_class_map.get(pid, "C")
            avg_monthly_sales = round(total_qty_sold / window_months, 2)
        else:
            total_qty_sold = 0.0
            total_sales_value = 0.0
            abc_class = "N"
            avg_monthly_sales = 0.0

        if abc_class == "A":
            a_count += 1
        elif abc_class == "B":
            b_count += 1
        elif abc_class == "C":
            c_count += 1
        elif abc_class == "N":
            n_count += 1

        # Determine target buffer months for this specific ABC category
        if abc_class == "A":
            product_buffer = buffer_months.get("a", 3.0)
        elif abc_class == "B":
            product_buffer = buffer_months.get("b", 2.5)
        elif abc_class == "C":
            product_buffer = buffer_months.get("c", 1.0)
        else:
            product_buffer = 0.0

        if target_months is not None:
            product_buffer = float(target_months)

        # Stock coverage in months
        if avg_monthly_sales > 0 and on_hand_qty > 0:
            stock_coverage_months = round(on_hand_qty / avg_monthly_sales, 2)
        else:
            stock_coverage_months = 0.0

        # Stock status
        if abc_class == "N":
            stock_status = "No Sales"
        elif on_hand_qty <= 0:
            stock_status = "Out of Stock"
        elif product_buffer > 0 and stock_coverage_months < product_buffer * 0.5:
            stock_status = "Low Coverage"
        elif product_buffer > 0 and stock_coverage_months <= product_buffer:
            stock_status = "Adequate"
        else:
            stock_status = "High Coverage"

        # Suggested reorder quantity based on target buffer stock
        if abc_class != "N" and product_buffer > 0:
            target_stock = avg_monthly_sales * product_buffer
            reorder_needed = target_stock - on_hand_qty
            suggested_reorder_qty = max(0, math.ceil(reorder_needed))
        else:
            suggested_reorder_qty = 0

        # Recent purchase information
        purch_info = purchase_by_product.get(pid, {})
        recent_purch_qty = purch_info.get("recent_qty", 0.0)
        last_purch_date = purch_info.get("last_date", None)
        purchase_note = "Recent Purchase Exists" if recent_purch_qty > 0 else "No Recent Purchase"

        # Final Action Recommendation
        if abc_class == "N":
            recommendation = "Review / Do Not Reorder"
            review_count += 1
        elif abc_class == "A" and on_hand_qty <= 0:
            recommendation = "Urgent Reorder"
            urgent_count += 1
            total_suggested_units += suggested_reorder_qty
        elif suggested_reorder_qty > 0:
            recommendation = "Reorder"
            reorder_count += 1
            total_suggested_units += suggested_reorder_qty
        elif stock_status == "High Coverage" or stock_status == "Adequate":
            recommendation = "Hold / Monitor"
            hold_count += 1
        else:
            recommendation = "Hold / Monitor"
            hold_count += 1

        result_rows.append(
            {
                "StockCode": stock_code,
                "Description": desc,
                "GroupName": pdata["group_name"],
                "ABC_Class": abc_class,
                "PriceRange": price_range,
                "SellingPrice": round(selling_price, 2) if selling_price is not None else None,
                "BuyingPrice": round(buying_price, 2) if buying_price is not None else None,
                "TotalQtySold": round(total_qty_sold, 1),
                "TotalSalesValue": round(total_sales_value, 2),
                "AvgMonthlySales": avg_monthly_sales,
                "OnHandQty": round(on_hand_qty, 1),
                "TargetBufferMonths": product_buffer,
                "StockCoverageMonths": stock_coverage_months,
                "StockStatus": stock_status,
                "SuggestedReorderQty": suggested_reorder_qty,
                "RecentPurchaseQty": round(recent_purch_qty, 1),
                "LastPurchaseDate": last_purch_date,
                "PurchaseNote": purchase_note,
                "Recommendation": recommendation,
                "PriorityOrder": priority_sort_order.get(recommendation, 99),
            }
        )

    # Sort rows by PriorityOrder ascending, then TotalSalesValue descending
    result_rows.sort(key=lambda r: (r["PriorityOrder"], -r["TotalSalesValue"]))

    # Clean up internal PriorityOrder before returning
    for r in result_rows:
        del r["PriorityOrder"]

    return {
        "summary": {
            "total_products": len(result_rows),
            "urgent_reorder_count": urgent_count,
            "reorder_count": reorder_count,
            "hold_monitor_count": hold_count,
            "review_count": review_count,
            "total_suggested_units": total_suggested_units,
            "a_count": a_count,
            "b_count": b_count,
            "c_count": c_count,
            "n_count": n_count,
            "buffer_months": buffer_months,
        },
        "rows": result_rows,
    }
