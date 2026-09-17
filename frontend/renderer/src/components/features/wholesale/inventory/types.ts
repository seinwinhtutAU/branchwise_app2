// Types, query keys, and shared constants for the Inventory feature.

export type View = "list" | "detail";
export type InventorySection = "overview" | "locations" | "movement";
export type StockDetailTab = "overview" | "orders" | "movement" | "pipeline";
export type InventoryHealth =
  | "Healthy"
  | "Low Stock"
  | "Out of Stock"
  | "Overstock"
  | "Not arrived yet";

export const INVENTORY_QUERY_KEY = ["wholesale", "inventory"] as const;
export const STOCK_QUERY_KEY = ["wholesale", "stock"] as const;
export const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;

export const IN_TRANSIT_PLACE = "In transit";
export const AT_SUPPLIER_PLACE = "At supplier";
export const ON_ORDER_PLACE = "On customer order";

export const LOW_STOCK_THRESHOLD = 20;
export const OVERSTOCK_THRESHOLD = 150;

export const HEALTH_STYLES: Record<InventoryHealth, string> = {
  Healthy: "bg-success text-white",
  "Low Stock": "bg-warning text-white",
  "Out of Stock": "bg-error text-white",
  Overstock: "bg-brand text-white",
  "Not arrived yet": "bg-text-secondary text-white",
};

export const MOVEMENT_LABELS: Record<string, string> = {
  in: "Received",
  out: "Delivered",
  allocated: "Allocated",
};

export const MOVEMENT_STYLES: Record<string, string> = {
  in: "bg-success text-white",
  out: "bg-brand text-white",
  allocated: "bg-warning text-white",
};

export const RELATED_ORDER_STATUS_LABELS: Record<string, string> = {
  waiting_for_stock: "Waiting for stock",
  ready_to_deliver: "Ready to deliver",
  partly_delivered: "Partially delivered",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

export const RELATED_ORDER_STATUS_STYLES: Record<string, string> = {
  waiting_for_stock: "bg-text-secondary text-white",
  ready_to_deliver: "bg-brand text-white",
  partly_delivered: "bg-warning text-white",
  fulfilled: "bg-success text-white",
  cancelled: "bg-error text-white",
};

export interface InventorySummaryRow {
  label: string;
  detail: string;
  pairs: number;
  tone: "green" | "blue" | "orange" | "purple" | "gray";
}

export interface RelatedOrderRow {
  order: import("@renderer/components/features/wholesale/customerOrders").CustomerOrder;
  ordered: number;
  received: number;
  remaining: number;
}

export interface ColorAvailability {
  missing: import("@renderer/components/features/wholesale/stock").ColorPairs;
  remaining: import("@renderer/components/features/wholesale/stock").ColorPairs;
}
