// Response shapes for the wholesale Dashboard's Revenue, Customer and Inventory tabs
// (GET /api/wholesale/dashboard/{revenue,customer,inventory}). Read-only.

import { apiBaseUrl } from "@renderer/lib/auth";
import {
  periodQueryParams,
  type PeriodKey,
} from "@renderer/components/features/dashboard/helpers";

const WHOLESALE_DASHBOARD_URL = `${apiBaseUrl}/api/wholesale/dashboard`;

export interface DashboardKpi {
  value: number;
  previous_value: number | null;
  delta_pct: number | null;
}

export interface RevenueDashboardData {
  period: string;
  date_from: string;
  date_to: string;
  delivered_revenue: DashboardKpi;
  collected: DashboardKpi;
  receivables: number;
  potential_stock_sales_value: number;
  inventory_cost_value: number;
  potential_gross_profit: number;
  trend: { date: string; delivered_revenue: number; collected: number }[];
  factories: { factory_name: string; delivered_revenue: number }[];
  top_factory_share_pct: number;
  customer_receivables?: {
    customer_name: string;
    balance_due: number;
    order_count: number;
  }[];
  top_products?: {
    stock_code: string;
    quantity_pairs: number;
    quantity_sets: number;
    delivered_revenue: number;
  }[];
}

export interface CostDashboardData {
  period: string;
  date_from: string;
  date_to: string;
  goods_purchased: number;
  cost_to_bring_in: number;
  total_cost: number;
  goods_share_pct: number;
  cost_share_pct: number;
  supplier_balance_due: number;
  factories: { factory_name: string; purchased: number }[];
  factory_count: number;
  payable_count: number;
  payables: {
    voucher_id: string;
    voucher_no: string;
    supplier_name: string;
    voucher_date: string;
    days_open: number;
    balance_due: number;
  }[];
}

export type AwaitingOrderStatus =
  | "waiting_for_stock"
  | "ready_to_deliver"
  | "partly_delivered";

export interface CustomerDashboardData {
  period: string;
  date_from: string;
  date_to: string;
  active_customers: DashboardKpi;
  new_customers: DashboardKpi;
  repeat_customers: { value: number; share_of_active_pct: number };
  open_orders: number;
  order_count: number;
  total_ordered_value: number;
  top_customers: { customer_name: string; ordered_value: number }[];
  delivery_status: {
    fulfilled: number;
    partly_delivered: number;
    awaiting_delivery: number;
  };
  awaiting_orders: {
    order_id: string;
    order_no: string;
    customer_name: string;
    order_date: string;
    remaining_pairs: number;
    status: AwaitingOrderStatus;
  }[];
}

export interface InventoryDashboardData {
  total_products: number;
  on_hand_pairs: number;
  available_pairs: number;
  committed_pairs: number;
  incoming_pairs: number;
  at_supplier_pairs: number;
  in_transit_pairs: number;
  backlog_pairs: number;
  locations: { location: string; on_hand_pairs: number }[];
  groups: {
    product_group: string;
    available_pairs: number;
    committed_pairs: number;
    incoming_pairs: number;
  }[];
}

/** The window a Revenue or Customer tab is showing — what the Dashboard's period control
 *  (the same one the retail Dashboard uses) hands down. */
export interface DashboardWindow {
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  month: string;
}

export function dashboardTabUrl(
  tab: "revenue" | "cost" | "customer" | "inventory",
  window?: DashboardWindow,
): string {
  const query = window
    ? periodQueryParams(window.period, window.dateFrom, window.dateTo, window.month).toString()
    : "";
  return `${WHOLESALE_DASHBOARD_URL}/${tab}${query ? `?${query}` : ""}`;
}
