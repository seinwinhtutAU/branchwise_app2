import { z } from "zod";
import { type OrderStatus } from "@renderer/components/features/wholesale/customerOrders";
import {
  colorQtyPairs,
  nextReference,
  type PaymentStatus,
} from "@renderer/components/features/wholesale/shared";
import {
  formatSets,
  PAIRS_PER,
} from "@renderer/components/features/wholesale/units";
import { type ProductGroup } from "@renderer/components/features/wholesale/products";
import {
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/currency";
import { type CustomerOrder } from "@renderer/components/features/wholesale/customerOrders";

/** An aggregate may combine products quoted in different units, so it is stored in pairs
 * and shown the way the business reads a quantity: sets, with any leftover pairs.
 * Individual lines use their own unit below. */
export const sets = (qty: number): string => formatSets(qty);

export const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;
export const STOCK_QUERY_KEY = ["wholesale", "stock"] as const;

export type View = "list" | "detail" | "new";
export type DetailTab = "products" | "payments" | "allocate";
export type StatusFilter = OrderStatus | "all";
export type PayFilter = PaymentStatus | "all";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  waiting_for_stock: "Waiting for stock",
  ready_to_deliver: "Ready to deliver",
  partly_delivered: "Partially delivered",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

// Filled, not tinted: the shared Badge's subtle variants read as a highlighted background
// rather than a state, so each status is solid colour with the inverse text over it. Every
// value is a token, so the lifecycle remains legible in the workspace theme.
export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
};

export const PAYMENT_STYLES: Record<PaymentStatus, { bg: string; dot: string }> = {
  unpaid: {
    bg: "bg-error-subtle text-error border border-error/30",
    dot: "bg-error",
  },
  partial: {
    bg: "bg-warning-subtle text-warning border border-warning/30",
    dot: "bg-warning",
  },
  paid: {
    bg: "bg-success-subtle text-success border border-success/30",
    dot: "bg-success",
  },
};

export const PAYMENT_STATUSES: PaymentStatus[] = ["unpaid", "partial", "paid"];

export const STATUS_STYLES: Record<OrderStatus, { bg: string; dot: string }> = {
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

export function nextOrderNo(orders: CustomerOrder[]): string {
  return nextReference(
    "ORD",
    orders.map((order) => order.order_no),
  );
}

// ── Detail Schemas ──────────────────────────────────────────────────────────

export const customerOrderDetailLineSchema = z.object({
  order_line_id: z.string(),
  stock_code: z.string(),
  description: z.string(),
  product_group: z.enum(["man", "lady", "child"]),
  supplier_name: z.string(),
  color_breakdown: z.string(),
  unit: z.enum(["pair", "set", "dozen"]),
  quantity_pairs: z.number().finite(),
  delivered_quantity_pairs: z.number().finite().min(0),
  allocated_quantity_pairs: z.number().finite().min(0).optional(),
  allocated_color_breakdown: z.string().optional(),
  selling_price: z.number().finite().min(0),
  currency_code: z.string().optional(),
  original_selling_price: z.number().finite().min(0).nullable().optional(),
  exchange_rate: z.number().finite().min(0).nullable().optional(),
});

export const customerOrderDetailSchema = z.object({
  order: z.object({
    order_id: z.string(),
    order_no: z.string(),
    customer_name: z.string().trim().min(1, "Enter a customer name."),
    customer_phone: z.string(),
    customer_address: z.string(),
    order_date: z.string().trim().min(1, "Choose an order date."),
    total_quantity_pairs: z.number().finite().min(0),
    delivered_quantity_pairs: z.number().finite().min(0),
    order_status: z.enum([
      "waiting_for_stock",
      "ready_to_deliver",
      "partly_delivered",
      "fulfilled",
      "cancelled",
    ]),
    payment: z.object({
      account_id: z.string(),
      payments: z.array(
        z.object({
          payment_id: z.string(),
          paid_on: z.string(),
          amount: z.number().finite().min(0),
          note: z.string(),
        }),
      ),
    }),
    lines: z.array(customerOrderDetailLineSchema),
  }),
});

export interface CustomerOrderDetailFormValues {
  order: CustomerOrder;
}

// ── New Order Schemas ───────────────────────────────────────────────────────

export interface DraftLine {
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  supplier_name: string;
  color_breakdown: string;
  unit: "pair" | "set" | "dozen";
  unit_conversions: { pair: number; set: number; dozen: number };
  selling_price: string;
  currency_code: CurrencyCode;
  original_selling_price: string;
  exchange_rate: string;
}

export const draftLineSchema = z
  .object({
    stock_code: z.string(),
    description: z.string(),
    product_group: z.enum(["man", "lady", "child"]),
    supplier_name: z.string(),
    color_breakdown: z.string(),
    unit: z.enum(["pair", "set", "dozen"]),
    unit_conversions: z.object({
      pair: z.number().int().positive(),
      set: z.number().int().positive(),
      dozen: z.number().int().positive(),
    }),
    selling_price: z
      .string()
      .regex(/^\d*$/, "Selling price can only contain numbers."),
    currency_code: z.enum(["MMK", "THB", "USD"]),
    original_selling_price: z
      .string()
      .regex(/^\d*\.?\d*$/, "Original price can only contain numbers."),
    exchange_rate: z
      .string()
      .regex(/^\d*\.?\d*$/, "Exchange rate can only contain numbers."),
  })
  .superRefine((line, context) => {
    const hasProductDetails =
      line.stock_code.trim() !== "" ||
      line.description.trim() !== "" ||
      line.supplier_name.trim() !== "" ||
      line.color_breakdown.trim() !== "" ||
      line.selling_price.trim() !== "";

    if (!hasProductDetails) return;

    if (line.stock_code.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["stock_code"],
        message: "Enter a stock code.",
      });
    }
    if (line.description.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "Enter a description.",
      });
    }
    if (line.color_breakdown.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["color_breakdown"],
        message: "Enter colors and quantities.",
      });
    }
    if (line.currency_code !== "MMK") {
      if (line.original_selling_price.trim() === "") {
        context.addIssue({
          code: "custom",
          path: ["original_selling_price"],
          message: "Enter the original price.",
        });
      }
      if (line.exchange_rate.trim() === "" || Number(line.exchange_rate) <= 0) {
        context.addIssue({
          code: "custom",
          path: ["exchange_rate"],
          message: "Enter an exchange rate greater than zero.",
        });
      }
    }
  });

export const customerOrderFormSchema = z
  .object({
    order_date: z.string().trim().min(1, "Choose an order date."),
    customer_name: z.string().trim().min(1, "Enter a customer name."),
    customer_phone: z.string(),
    customer_address: z.string(),
    lines: z.array(draftLineSchema),
  })
  .superRefine((values, context) => {
    if (!values.lines.some((line) => line.stock_code.trim() !== "")) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Add at least one product.",
      });
    }
  });

export interface CustomerOrderFormValues {
  order_date: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  lines: DraftLine[];
}

/** The pairs one drafted row comes to: its colors read in its own unit. */
export function draftPairs(line: DraftLine): number {
  return colorQtyPairs(line.color_breakdown, line.unit, line.unit_conversions);
}

export const EMPTY_LINE: DraftLine = {
  stock_code: "",
  description: "",
  product_group: "man",
  supplier_name: "",
  color_breakdown: "",
  unit: "set",
  unit_conversions: PAIRS_PER,
  selling_price: "",
  currency_code: DEFAULT_CURRENCY,
  original_selling_price: "",
  exchange_rate: "",
};

export const STEPS = ["Customer", "Products", "Review"] as const;
