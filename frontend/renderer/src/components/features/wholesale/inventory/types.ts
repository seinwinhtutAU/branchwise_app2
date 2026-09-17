// Types, query keys, and shared constants for the Inventory feature.

export type View = "list" | "detail";
export type InventorySection = "overview" | "locations" | "movement";
export type StockDetailTab = "overview" | "orders" | "movement" | "pipeline";
export type InventoryHealth =
  "Healthy" | "Low Stock" | "Out of Stock" | "Overstock" | "Not arrived yet";

export const INVENTORY_QUERY_KEY = ["wholesale", "inventory"] as const;
export const STOCK_QUERY_KEY = ["wholesale", "stock"] as const;
export const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;

export const IN_TRANSIT_PLACE = "In transit";
export const AT_SUPPLIER_PLACE = "At supplier";
export const ON_ORDER_PLACE = "On customer order";

export const LOW_STOCK_THRESHOLD = 20;
export const OVERSTOCK_THRESHOLD = 150;

export interface DotPillStyle {
  bg: string;
  dot: string;
}

export const HEALTH_STYLES: Record<InventoryHealth, DotPillStyle> = {
  Healthy: {
    bg: "bg-success-subtle text-success border border-success/30",
    dot: "bg-success",
  },
  "Low Stock": {
    bg: "bg-warning-subtle text-warning border border-warning/30",
    dot: "bg-warning",
  },
  "Out of Stock": {
    bg: "bg-error-subtle text-error border border-error/30",
    dot: "bg-error",
  },
  Overstock: {
    bg: "bg-brand-subtle text-brand border border-brand/30",
    dot: "bg-brand",
  },
  "Not arrived yet": {
    bg: "bg-bg-raised text-text-secondary border border-border-strong",
    dot: "bg-text-muted",
  },
};

export const MOVEMENT_LABELS: Record<string, string> = {
  in: "Received",
  out: "Delivered",
  allocated: "Allocated",
};

export const MOVEMENT_STYLES: Record<string, DotPillStyle> = {
  in: {
    bg: "bg-success-subtle text-success border border-success/30",
    dot: "bg-success",
  },
  out: {
    bg: "bg-brand-subtle text-brand border border-brand/30",
    dot: "bg-brand",
  },
  allocated: {
    bg: "bg-warning-subtle text-warning border border-warning/30",
    dot: "bg-warning",
  },
};

export const RELATED_ORDER_STATUS_LABELS: Record<string, string> = {
  waiting_for_stock: "Waiting for stock",
  ready_to_deliver: "Ready to deliver",
  partly_delivered: "Partially delivered",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

export const RELATED_ORDER_STATUS_STYLES: Record<string, DotPillStyle> = {
  waiting_for_stock: {
    bg: "bg-bg-raised text-text-secondary border border-border-strong",
    dot: "bg-text-muted",
  },
  ready_to_deliver: {
    bg: "bg-brand-subtle text-brand border border-brand/30",
    dot: "bg-brand",
  },
  partly_delivered: {
    bg: "bg-warning-subtle text-warning border border-warning/30",
    dot: "bg-warning",
  },
  fulfilled: {
    bg: "bg-success-subtle text-success border border-success/30",
    dot: "bg-success",
  },
  cancelled: {
    bg: "bg-error-subtle text-error border border-error/30",
    dot: "bg-error",
  },
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
