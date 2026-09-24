"""Read-only response contracts for the wholesale Dashboard's Revenue, Customer and
Inventory tabs."""

from typing import Any

from pydantic import BaseModel


class DashboardKpi(BaseModel):
    value: float
    previous_value: float | None = None
    delta_pct: float | None = None


class DashboardWindow(BaseModel):
    period: str
    date_from: str
    date_to: str
    previous_date_from: str
    previous_date_to: str


class RevenueDashboard(DashboardWindow):
    delivered_revenue: DashboardKpi
    collected: DashboardKpi
    receivables: float
    potential_stock_sales_value: float
    inventory_cost_value: float
    potential_gross_profit: float
    trend: list[dict[str, Any]]
    factories: list[dict[str, Any]]
    top_factory_share_pct: float
    customer_receivables: list[dict[str, Any]] = []
    top_products: list[dict[str, Any]] = []


class CostDashboard(DashboardWindow):
    goods_purchased: float
    cost_to_bring_in: float
    total_cost: float
    goods_share_pct: float
    cost_share_pct: float
    supplier_balance_due: float
    factories: list[dict[str, Any]]
    factory_count: int
    payable_count: int
    payables: list[dict[str, Any]]


class RepeatCustomers(BaseModel):
    value: float
    share_of_active_pct: float


class CustomerDashboard(DashboardWindow):
    active_customers: DashboardKpi
    new_customers: DashboardKpi
    repeat_customers: RepeatCustomers
    open_orders: float
    order_count: int
    total_ordered_value: float
    top_customers: list[dict[str, Any]]
    delivery_status: dict[str, int]
    awaiting_orders: list[dict[str, Any]]


class InventoryDashboard(BaseModel):
    total_products: int
    on_hand_pairs: int
    available_pairs: int
    committed_pairs: int
    incoming_pairs: int
    at_supplier_pairs: int
    in_transit_pairs: int
    backlog_pairs: int
    locations: list[dict[str, Any]]
    groups: list[dict[str, Any]]
