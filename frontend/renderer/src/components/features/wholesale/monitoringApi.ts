// Types and the URL for the Monitoring dashboard's snapshot read (a plain GET, so it has
// no write function here — see MonitoringDashboardPage.tsx's own useQuery call).

import { apiBaseUrl } from "@renderer/lib/auth";

export interface MonitoringCount<T> {
  count: number;
  rows: T[];
}

export interface MonitoringShipmentRow {
  shipment_id: string;
  shipment_no: string;
  supplier_name: string;
  sent_on: string;
  days_in_transit: number;
  shipment_status: string;
}

export interface MonitoringOrderRow {
  order_id: string;
  order_no: string;
  customer_name: string;
  order_status?: string;
  order_date: string;
  days_open?: number;
  balance_due?: number;
}

export interface MonitoringVoucherRow {
  voucher_id: string;
  voucher_no: string;
  supplier_name: string;
  balance_due: number;
  voucher_date: string;
}

export interface MonitoringProductRow {
  product_id: string;
  stock_code: string;
  description: string;
  product_group: string;
  stock_status: "not_arrived" | "out_of_stock";
}

export interface MonitoringActivityRow {
  activity_id: string;
  type: "receiving" | "delivery" | "payment";
  created_at: string;
  receiving_id?: string;
  receiving_no?: string;
  supplier_name?: string;
  shipment_no?: string;
  delivery_id?: string;
  order_id?: string;
  order_no?: string;
  customer_name?: string;
  stock_code?: string;
  quantity_pairs?: number;
  payment_id?: string;
  amount?: number;
  paid_on?: string;
  voucher_id?: string;
  voucher_no?: string | null;
}

export interface MonitoringSnapshot {
  shipments_in_transit: MonitoringCount<MonitoringShipmentRow>;
  orders_pending: MonitoringCount<MonitoringOrderRow>;
  unpaid_vouchers: MonitoringCount<MonitoringVoucherRow>;
  unpaid_orders: MonitoringCount<MonitoringOrderRow>;
  zero_stock_products: MonitoringCount<MonitoringProductRow>;
  recent_activity: MonitoringActivityRow[];
}

export const WHOLESALE_MONITORING_URL = `${apiBaseUrl}/api/wholesale/monitoring`;
