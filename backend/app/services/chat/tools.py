"""Read-only LangGraph tools for the retail chatbot.

Each tool queries the same SQLAlchemy models the rest of the backend uses, scoped to
the caller's branch (or every branch, for admin) exactly like every other router —
see the module docstring in agent.py for why that scoping matters here specifically.
"""

from datetime import date, datetime, timedelta

from langchain_core.tools import tool
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.product import Product
from app.models.purchase import Purchase, PurchaseLine
from app.models.sale import Sale, SaleLine
from app.models.stock_level import StockLevel
from app.models.user import User
from app.services.data_quality import build_warning_sections

DEFAULT_QUERY_WINDOW_DAYS = 30
MAX_STOCK_ROWS = 30
MAX_WARNING_ROWS_PER_SECTION = 10


def _parse_date(value: str, default: date) -> date:
    return date.fromisoformat(value) if value else default


def _default_window(date_from: str, date_to: str) -> tuple[date, date]:
    end = _parse_date(date_to, date.today())
    start = _parse_date(date_from, end - timedelta(days=DEFAULT_QUERY_WINDOW_DAYS - 1))
    return start, end


# A model has no reliable sense of "now" on its own (its training cutoff isn't today,
# and it can't read the server clock) — this tool is what grounds relative-date
# questions ("today", "yesterday", "this week") in the actual current date before it
# computes explicit YYYY-MM-DD bounds for the other tools. Module-level rather than a
# build_tools() closure since it needs no db/user binding.
@tool
def get_current_date() -> str:
    """Get the current date and time, plus the bounds of "this week" and "this month".
    Call this FIRST whenever a question uses a relative date — "today", "yesterday",
    "this week", "last month" — so date_from/date_to for the other tools are computed
    from the real current date instead of guessed."""
    now = datetime.now()
    today = now.date()
    yesterday = today - timedelta(days=1)
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    return (
        f"Today: {today.isoformat()} ({today.strftime('%A')})\n"
        f"Current time: {now.strftime('%H:%M')}\n"
        f"Yesterday: {yesterday.isoformat()}\n"
        f"This week: {week_start.isoformat()} (Mon) to {today.isoformat()}\n"
        f"This month: {month_start.isoformat()} to {today.isoformat()}"
    )


def build_tools(db: Session, user: User) -> list:
    """Binds every tool to this request's db session + caller via closure, so
    branch-scoping happens here rather than the model needing to pass db/user
    arguments it has no business knowing about."""

    @tool
    def get_sales_summary(date_from: str = "", date_to: str = "") -> str:
        """Total sales (slip count, quantity sold, net amount) grouped by day, for a
        date range in YYYY-MM-DD format. Defaults to the last 30 days if omitted."""
        start, end = _default_window(date_from, date_to)
        query = (
            db.query(
                Sale.sale_date,
                func.count(func.distinct(Sale.id)).label("slips"),
                func.sum(SaleLine.qty).label("qty"),
                func.sum(SaleLine.net_amount).label("net_amount"),
            )
            .join(SaleLine, SaleLine.sale_id == Sale.id)
            .filter(Sale.sale_date >= start, Sale.sale_date <= end)
            .group_by(Sale.sale_date)
            .order_by(Sale.sale_date)
        )
        if user.branch_id is not None:
            query = query.filter(Sale.branch_id == user.branch_id)
        rows = query.all()
        if not rows:
            return f"No sales recorded between {start} and {end}."
        lines = [
            f"{d}: {slips} slips, qty {qty or 0}, net amount {float(net or 0):.2f}"
            for d, slips, qty, net in rows
        ]
        total_net = sum(float(r.net_amount or 0) for r in rows)
        lines.append(f"TOTAL net amount {start}..{end}: {total_net:.2f}")
        return "\n".join(lines)

    @tool
    def get_top_selling_products(date_from: str = "", date_to: str = "", limit: int = 10) -> str:
        """Top-selling products by net sales amount for a date range (YYYY-MM-DD,
        defaults to the last 30 days). limit caps how many products come back (max 50)."""
        start, end = _default_window(date_from, date_to)
        capped_limit = max(1, min(limit, 50))
        query = (
            db.query(
                Product.stock_code,
                Product.description,
                func.sum(SaleLine.qty).label("qty"),
                func.sum(SaleLine.net_amount).label("net_amount"),
            )
            .join(SaleLine, SaleLine.product_id == Product.id)
            .join(Sale, SaleLine.sale_id == Sale.id)
            .filter(Sale.sale_date >= start, Sale.sale_date <= end)
            .group_by(Product.id, Product.stock_code, Product.description)
            .order_by(func.sum(SaleLine.net_amount).desc())
            .limit(capped_limit)
        )
        if user.branch_id is not None:
            query = query.filter(Sale.branch_id == user.branch_id)
        rows = query.all()
        if not rows:
            return f"No sales recorded between {start} and {end}."
        return "\n".join(
            f"{code} — {desc}: qty {qty or 0}, net amount {float(net or 0):.2f}"
            for code, desc, qty, net in rows
        )

    @tool
    def get_current_stock(search: str = "", low_stock_max_qty: float | None = None) -> str:
        """Current on-hand stock (each product's latest inventory snapshot). `search`
        filters by a stock code/description substring; `low_stock_max_qty` caps results
        to items at or below that quantity (use it for "what's low on stock"-type
        questions). Returns at most 30 rows, sorted lowest quantity first."""
        latest = (
            db.query(
                StockLevel.product_id,
                StockLevel.branch_id,
                func.max(StockLevel.snapshot_at).label("snapshot_at"),
            )
            .group_by(StockLevel.product_id, StockLevel.branch_id)
            .subquery()
        )
        query = (
            db.query(StockLevel, Product, Branch)
            .join(Product, StockLevel.product_id == Product.id)
            .outerjoin(Branch, StockLevel.branch_id == Branch.id)
            .join(
                latest,
                (StockLevel.product_id == latest.c.product_id)
                & StockLevel.branch_id.is_not_distinct_from(latest.c.branch_id)
                & (StockLevel.snapshot_at == latest.c.snapshot_at),
            )
        )
        if user.branch_id is not None:
            query = query.filter(StockLevel.branch_id == user.branch_id)
        if search:
            like = f"%{search}%"
            query = query.filter(
                Product.stock_code.ilike(like) | Product.description.ilike(like)
            )
        if low_stock_max_qty is not None:
            query = query.filter(StockLevel.on_hand_qty <= low_stock_max_qty)
        rows = query.order_by(StockLevel.on_hand_qty.asc()).limit(MAX_STOCK_ROWS).all()
        if not rows:
            return "No matching inventory found."
        return "\n".join(
            f"{product.stock_code} — {product.description} "
            f"({branch.name if branch else 'no branch'}): on hand {stock.on_hand_qty}, "
            f"as of {stock.snapshot_at.isoformat()}"
            for stock, product, branch in rows
        )

    @tool
    def get_purchases_summary(date_from: str = "", date_to: str = "") -> str:
        """Total purchases (quantity, cost) grouped by day, for a date range
        (YYYY-MM-DD). Defaults to the last 30 days if omitted."""
        start, end = _default_window(date_from, date_to)
        query = (
            db.query(
                Purchase.purchase_date,
                func.sum(PurchaseLine.quantity).label("qty"),
                func.sum(PurchaseLine.quantity * PurchaseLine.buying_price).label("cost"),
            )
            .join(PurchaseLine, PurchaseLine.purchase_id == Purchase.id)
            .filter(Purchase.purchase_date >= start, Purchase.purchase_date <= end)
            .group_by(Purchase.purchase_date)
            .order_by(Purchase.purchase_date)
        )
        if user.branch_id is not None:
            query = query.filter(Purchase.branch_id == user.branch_id)
        rows = query.all()
        if not rows:
            return f"No purchases recorded between {start} and {end}."
        return "\n".join(
            f"{d}: qty {qty or 0}, cost {float(cost or 0):.2f}" for d, qty, cost in rows
        )

    @tool
    def get_data_quality_warnings(days: int = 1) -> str:
        """Summarize current data-quality warnings — bad numbers on sale/inventory/
        purchase rows, stock codes missing an inventory record, and daily stock
        reconciliation mismatches — for the last N days (default 1, max 365). Use this
        whenever asked to explain warnings or data problems."""
        capped_days = max(1, min(days, 365))
        sections = build_warning_sections(db, user, capped_days, capped_days)
        lines = []
        for section in sections:
            rows = section["rows"]
            if not rows:
                continue
            lines.append(f"## {section['title']} ({len(rows)})")
            for row in rows[:MAX_WARNING_ROWS_PER_SECTION]:
                field_str = ", ".join(f"{f['label']}={f['value']}" for f in row["fields"])
                lines.append(f"- {row['note']} [{field_str}]")
            if len(rows) > MAX_WARNING_ROWS_PER_SECTION:
                lines.append(f"...and {len(rows) - MAX_WARNING_ROWS_PER_SECTION} more.")
        return "\n".join(lines) if lines else "No data-quality warnings right now."

    return [
        get_current_date,
        get_sales_summary,
        get_top_selling_products,
        get_current_stock,
        get_purchases_summary,
        get_data_quality_warnings,
    ]
