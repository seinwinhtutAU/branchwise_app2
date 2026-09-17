from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.security import get_current_app_user
from app.db.session import get_db
from app.models.user import User
from app.wholesale.services.inventory import delivered_pairs_by_order
from app.wholesale.services.money import order_totals
from app.wholesale.services.orders import list_orders
from app.wholesale.routers.common import require_wholesale


router = APIRouter(prefix="/api/wholesale/finance", tags=["wholesale"])


def _payment_status(paid: float, total: float) -> str:
    if paid <= 0:
        return "unpaid"
    if paid >= total:
        return "paid"
    return "partial"


def _package_status(delivered: int, paid_pairs: int) -> str:
    if delivered <= 0:
        return "no_delivery"
    if paid_pairs >= delivered:
        return "fully_paid"
    if paid_pairs > 0:
        return "partially_paid"
    return "delivered_unpaid"


@router.get("/customers")
def customer_finance_rows(
    search: Annotated[str, Query(max_length=100)] = "",
    payment_status: Annotated[str | None, Query()] = None,
    package_status: Annotated[str | None, Query()] = None,
    user: User = Depends(get_current_app_user),
    db: Session = Depends(get_db),
) -> list[dict]:
    require_wholesale(user)
    orders = [order for order in list_orders(db, user.branch_id) if not order.cancelled]
    delivered_by_order = delivered_pairs_by_order(db, [order.id for order in orders], user.branch_id)
    query = search.strip().lower()
    rows: list[dict] = []
    for order in orders:
        totals = order_totals(order)
        delivered_pairs = sum(delivered_by_order.get(order.id, {}).values())
        total_pairs = sum(line.quantity_pairs for line in order.lines)
        paid_pairs = sum(payment.paid_quantity_pairs or 0 for payment in order.payments)
        row = {
            "order_id": order.id,
            "customer_name": order.customer_name,
            "order_no": order.order_no,
            "order_date": order.order_date,
            "total_pairs": total_pairs,
            "delivered_pairs": delivered_pairs,
            "remaining_to_deliver_pairs": max(0, total_pairs - delivered_pairs),
            "paid_pairs": paid_pairs,
            "delivered_but_unpaid_pairs": max(0, delivered_pairs - paid_pairs),
            "total_amount": totals["total"],
            "paid_amount": totals["paid"],
            "balance": totals["balance_due"],
            "payment_status": _payment_status(totals["paid"], totals["total"]),
            "package_status": _package_status(delivered_pairs, paid_pairs),
        }
        if query and query not in order.customer_name.lower() and query not in order.order_no.lower():
            continue
        if payment_status and row["payment_status"] != payment_status:
            continue
        if package_status and row["package_status"] != package_status:
            continue
        rows.append(row)
    return rows
