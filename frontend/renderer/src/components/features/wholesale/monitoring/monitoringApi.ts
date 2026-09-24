// Types and the URL for the wholesale Dashboard's Summary read (a plain GET, so it has
// no write function here — see MonitoringDashboardPage.tsx's own useQuery call).

import { apiBaseUrl } from "@renderer/lib/auth";

export interface WholesaleSummaryPipeline {
  supplier_sets: number;
  transit_sets: number;
  on_hand_sets: number;
  allocated_sets: number;
  available_sets: number;
}

export interface WholesaleSummaryLocation {
  name: string;
  sets: number;
  color?: string;
}

export interface WholesaleSummaryFulfillment {
  delivered_pct: number;
  allocated_pct: number;
  waiting_pct: number;
  open_pct: number;
}

export interface WholesaleSummaryFactory {
  name: string;
  revenue: number;
  color?: string;
}

export interface WholesaleSummaryData {
  physical_stock_sets: number;
  available_sets: number;
  committed_sets: number;
  incoming_stock_sets: number;
  supplier_sets: number;
  transit_sets: number;
  backlog_sets: number;
  pipeline: WholesaleSummaryPipeline;
  locations: WholesaleSummaryLocation[];
  fulfillment: WholesaleSummaryFulfillment;
  revenue_this_period: number;
  factories: WholesaleSummaryFactory[];
  money_received?: number;
  unpaid_by_customers?: number;
  to_pay_suppliers?: number;
  inventory_value?: number;
}

export const WHOLESALE_SUMMARY_URL = `${apiBaseUrl}/api/wholesale/monitoring/summary`;
