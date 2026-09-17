// Types for the four-pillar Reports screen (Revenue/Cost/Inventory/Customer). Read-only —
// each tab's own useQuery call fetches these shapes directly.

import { apiBaseUrl } from "@renderer/lib/auth";

export const WHOLESALE_REPORTS_URL = `${apiBaseUrl}/api/wholesale/reports`;

export interface WholesaleReportKpi {
  value: number;
  previous_value: number | null;
  delta_pct: number | null;
}

export interface WholesaleRevenueReport {
  period: string;
  date_from: string;
  date_to: string;
  delivered_revenue: WholesaleReportKpi;
  ordered_value: WholesaleReportKpi;
  pairs_delivered: WholesaleReportKpi;
  collected: WholesaleReportKpi;
  trend: { date: string; delivered_revenue: number; collected: number }[];
  top_customers: {
    customer_name: string;
    pairs_delivered: number;
    delivered_revenue: number;
  }[];
  top_products: {
    stock_code: string;
    description: string;
    pairs_delivered: number;
    delivered_revenue: number;
    avg_selling_price: number | null;
  }[];
  orders: {
    order_no: string;
    customer_name: string;
    pairs_ordered: number;
    ordered_value: number;
    delivered_pct: number;
    balance_due: number;
  }[];
}

export interface WholesaleCostReport {
  period: string;
  date_from: string;
  date_to: string;
  purchases: WholesaleReportKpi;
  freight_and_handling: WholesaleReportKpi;
  gross_margin_pct: WholesaleReportKpi;
  owed_to_suppliers: WholesaleReportKpi;
  trend: {
    date: string;
    delivered_revenue: number;
    cost_of_goods_delivered: number | null;
  }[];
  freight_by_stage: { stage: string; amount: number }[];
  suppliers: {
    supplier_name: string;
    vouchers: number;
    pairs: number;
    value: number;
    paid: number;
    balance: number;
  }[];
  payables: {
    voucher_no: string;
    supplier_name: string;
    voucher_date: string;
    days_since: number;
    balance_due: number;
  }[];
  write_offs: {
    reference: string;
    stock_code: string;
    description: string;
    quantity_pairs: number;
    reason: string;
    value: number;
  }[];
}

export interface WholesaleInventoryReport {
  period: string;
  date_from: string;
  date_to: string;
  on_hand: WholesaleReportKpi;
  available: WholesaleReportKpi;
  incoming: WholesaleReportKpi;
  stock_value: WholesaleReportKpi;
  received_in_period: number;
  delivered_in_period: number;
  locations: { location: string; on_hand_pairs: number }[];
  pipeline: { stage: string; pairs: number }[];
  products: WholesaleInventoryProduct[];
  cannot_supply: WholesaleInventoryProduct[];
  not_moving: (WholesaleInventoryProduct & { days_since: number | null })[];
}

export interface WholesaleInventoryProduct {
  stock_code: string;
  description: string;
  on_hand_pairs: number;
  available_pairs: number;
  allocated_pairs: number;
  at_supplier_pairs: number;
  in_transit_pairs: number;
  incoming_pairs: number;
  owed_to_customers_pairs: number;
  last_movement_on: string | null;
  stock_value: number;
  locations: {
    location: string;
    on_hand_pairs: number;
    last_moved_on: string | null;
  }[];
}

export interface WholesaleCustomerReport {
  period: string;
  date_from: string;
  date_to: string;
  active_customers: WholesaleReportKpi;
  new_customers: WholesaleReportKpi;
  average_order_value: WholesaleReportKpi;
  receivables: WholesaleReportKpi;
  fulfilment_days: WholesaleReportKpi;
  trend: { date: string; order_count: number }[];
  top_customers: WholesaleCustomerRanking[];
  ranking: WholesaleCustomerRanking[];
  open_orders: {
    order_no: string;
    customer_name: string;
    order_date: string;
    pairs_ordered: number;
    pairs_delivered: number;
    balance_due: number;
    days_open: number;
  }[];
  quiet_customers: { customer_name: string }[];
}

export interface WholesaleCustomerRanking {
  customer_name: string;
  orders: number;
  pairs_ordered: number;
  pairs_delivered: number;
  delivered_revenue: number;
  paid: number;
  balance: number;
}

export function wholesaleReportFromWire<T>(wire: T): T {
  return wire;
}
