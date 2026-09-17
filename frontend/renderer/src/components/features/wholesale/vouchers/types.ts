import { z } from "zod";
import {
  DEFAULT_CURRENCY,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/shared/currency";
import { type ProductGroup } from "@renderer/components/features/wholesale/shared/products";
import {
  type PaymentStatus,
  nextReference,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  type SupplierVoucher,
  type SupplierVoucherLine,
  type ReceivingStatus,
  RECEIVING_STATUSES,
} from "@renderer/components/features/wholesale/vouchers/supplierVouchers";

export { RECEIVING_STATUSES };
import { formatSets, PAIRS_PER } from "@renderer/components/features/wholesale/shared/units";

export const VOUCHERS_QUERY_KEY = ["wholesale", "supplier-vouchers"] as const;
export const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;
export const WRITE_OFFS_QUERY_KEY = ["wholesale", "write-offs"] as const;

export type View = "list" | "to_order" | "detail" | "new";
export type ReceivingFilter = ReceivingStatus | "all";
export type PayFilter = PaymentStatus | "all";

export const RECEIVING_LABELS: Record<ReceivingStatus, string> = {
  waiting: "Waiting",
  partly_received: "Partly received",
  fully_received: "Fully received",
};

export const RECEIVING_STYLES: Record<ReceivingStatus, { bg: string; dot: string }> = {
  waiting: {
    bg: "bg-bg-raised text-text-secondary border border-border-strong",
    dot: "bg-text-muted",
  },
  partly_received: {
    bg: "bg-warning-subtle text-warning border border-warning/30",
    dot: "bg-warning animate-pulse",
  },
  fully_received: {
    bg: "bg-success-subtle text-success border border-success/30",
    dot: "bg-success",
  },
};

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

export const sets = (qty: number): string => formatSets(qty);

export function lineReceivedQty(line: SupplierVoucherLine): number {
  return line.received_quantity_pairs ?? 0;
}

export function lineRemainingQty(line: SupplierVoucherLine): number {
  return Math.max(
    0,
    line.quantity_pairs -
      lineReceivedQty(line) -
      (line.lost_quantity_pairs ?? 0),
  );
}

export function nextVoucherNo(vouchers: SupplierVoucher[]): string {
  return nextReference(
    "VCH",
    vouchers.map((voucher) => voucher.voucher_no),
  );
}

export const UNASSIGNED_SUPPLIER = "__unassigned_supplier__";

export interface SupplierDemandGroup {
  supplierName: string;
  lines: OpenOrderLine[];
  total: number;
}

export interface WaitingCustomer {
  customerName: string;
  orderNo: string;
  qty: number;
}

export interface OpenOrderLine {
  order_id: string;
  order_line_id: string;
  order_no: string;
  customer_name: string;
  supplier_name: string;
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  color_breakdown: string;
  unit: "pair" | "set" | "dozen";
  remaining: number;
}

export interface DraftLine {
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  color_breakdown: string;
  unit: "pair" | "set" | "dozen";
  unit_conversions: { pair: number; set: number; dozen: number };
  currency_code: CurrencyCode;
  buying_price: string;
  original_buying_price: string;
  exchange_rate: string;
}

export const EMPTY_LINE: DraftLine = {
  stock_code: "",
  description: "",
  product_group: "man",
  color_breakdown: "",
  unit: "set",
  unit_conversions: PAIRS_PER,
  currency_code: DEFAULT_CURRENCY,
  buying_price: "",
  original_buying_price: "",
  exchange_rate: "",
};

export const STEPS = ["Supplier", "Products", "Review"] as const;

export const voucherDraftLineSchema = z
  .object({
    stock_code: z.string(),
    description: z.string(),
    product_group: z.enum(["man", "lady", "child"]),
    color_breakdown: z.string(),
    unit: z.enum(["pair", "set", "dozen"]),
    unit_conversions: z.object({
      pair: z.number().int().positive(),
      set: z.number().int().positive(),
      dozen: z.number().int().positive(),
    }),
    currency_code: z.enum(["MMK", "THB", "USD"]),
    buying_price: z
      .string()
      .regex(/^\d*$/, "Buying price can only contain numbers."),
    original_buying_price: z
      .string()
      .regex(/^\d*\.?\d*$/, "Original price can only contain numbers."),
    exchange_rate: z
      .string()
      .regex(/^\d*\.?\d*$/, "Exchange rate can only contain numbers."),
  })
  .superRefine((line, context) => {
    if (line.currency_code !== "MMK" && line.stock_code.trim() !== "") {
      if (line.original_buying_price.trim() === "") {
        context.addIssue({
          code: "custom",
          path: ["original_buying_price"],
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
    const hasProductDetails =
      line.stock_code.trim() !== "" ||
      line.description.trim() !== "" ||
      line.color_breakdown.trim() !== "" ||
      line.buying_price.trim() !== "";

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
  });

export const supplierVoucherFormSchema = z
  .object({
    voucher_date: z.string().trim().min(1, "Choose a voucher date."),
    supplier_name: z.string().trim().min(1, "Choose a supplier or factory."),
    carrier_name: z.string(),
    packages: z.string().regex(/^\d*$/, "Packages can only contain numbers."),
    lines: z.array(voucherDraftLineSchema),
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

export interface SupplierVoucherFormValues {
  voucher_date: string;
  supplier_name: string;
  carrier_name: string;
  packages: string;
  lines: DraftLine[];
}

export const supplierVoucherDetailLineSchema = z.object({
  voucher_line_id: z.string(),
  stock_code: z.string(),
  description: z.string(),
  product_group: z.enum(["man", "lady", "child"]),
  color_breakdown: z.string(),
  unit: z.enum(["pair", "set", "dozen"]),
  quantity_pairs: z.number().finite().min(0),
  received_quantity_pairs: z.number().finite().min(0).optional(),
  buying_price: z.number().finite().min(0),
  currency_code: z.string().optional(),
  original_buying_price: z.number().finite().min(0).nullable().optional(),
  exchange_rate: z.number().finite().gt(0).nullable().optional(),
});

export const supplierVoucherDetailSchema = z.object({
  voucher: z.object({
    voucher_id: z.string(),
    voucher_no: z.string(),
    supplier_name: z.string().trim().min(1, "Enter a supplier name."),
    voucher_date: z.string().trim().min(1, "Choose a voucher date."),
    total_packages: z.number().finite().min(0),
    carrier_name: z.string(),
    total_quantity_pairs: z.number().finite().min(0),
    received_quantity_pairs: z.number().finite().min(0),
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
    lines: z.array(supplierVoucherDetailLineSchema),
  }),
});

export interface SupplierVoucherDetailFormValues {
  voucher: SupplierVoucher;
}
