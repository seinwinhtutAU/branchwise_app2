"""Read-only response contracts for the wholesale four-pillar reports."""

from typing import Any

from pydantic import BaseModel


class ReportKpi(BaseModel):
    value: float
    previous_value: float | None = None
    delta_pct: float | None = None


class ReportWindow(BaseModel):
    period: str
    date_from: str
    date_to: str
    previous_date_from: str
    previous_date_to: str


class RevenueReport(ReportWindow):
    delivered_revenue: ReportKpi
    ordered_value: ReportKpi
    pairs_delivered: ReportKpi
    collected: ReportKpi
    trend: list[dict[str, Any]]
    top_customers: list[dict[str, Any]]
    top_products: list[dict[str, Any]]
    orders: list[dict[str, Any]]


class CostReport(ReportWindow):
    purchases: ReportKpi
    freight_and_handling: ReportKpi
    gross_margin_pct: ReportKpi
    owed_to_suppliers: ReportKpi
    trend: list[dict[str, Any]]
    freight_by_stage: list[dict[str, Any]]
    suppliers: list[dict[str, Any]]
    payables: list[dict[str, Any]]
    write_offs: list[dict[str, Any]]


class InventoryReport(ReportWindow):
    on_hand: ReportKpi
    available: ReportKpi
    incoming: ReportKpi
    stock_value: ReportKpi
    received_in_period: int
    delivered_in_period: int
    locations: list[dict[str, Any]]
    pipeline: list[dict[str, Any]]
    products: list[dict[str, Any]]
    cannot_supply: list[dict[str, Any]]
    not_moving: list[dict[str, Any]]


class CustomerReport(ReportWindow):
    active_customers: ReportKpi
    new_customers: ReportKpi
    average_order_value: ReportKpi
    receivables: ReportKpi
    fulfilment_days: ReportKpi
    trend: list[dict[str, Any]]
    top_customers: list[dict[str, Any]]
    ranking: list[dict[str, Any]]
    open_orders: list[dict[str, Any]]
    quiet_customers: list[dict[str, Any]]
