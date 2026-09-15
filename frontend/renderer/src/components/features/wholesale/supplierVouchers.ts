// The supplier-voucher half of the wholesale data model drawn in
// diagram/wholesale/erd.mmd — the supplier's (factory's) own document for one batch it
// is sending us.
//
// Front-end only: no backend, so these rows are in-memory seed data and anything added
// lives until the window reloads. Formatting and colour shorthand come from ./shared.

import { paymentStatusOf, sharePct, type PaymentStatus } from "./shared";
import { type Payment } from "./customerOrders";
import { pricedAmount, type Unit, type UnitConversions } from "./units";
import { type ProductGroup } from "./products";

/** The ERD's supplier_voucher.receiving_status. Worked out from the quantities rather
 *  than stored, so it can never disagree with the numbers beside it. */
export type ReceivingStatus = "waiting" | "partly_received" | "fully_received";

export const RECEIVING_STATUSES: ReceivingStatus[] = [
  "waiting",
  "partly_received",
  "fully_received",
];

export interface SupplierVoucherLine {
  voucher_line_id: string;
  stock_code: string;
  /** What the product actually is, so a line reads as a shoe and not as a code. */
  description: string;
  /** Man, lady or child — the range the business thinks in. */
  product_group: ProductGroup;
  /** Colors and their counts as staff write them, e.g. "black10,pink10". */
  color_breakdown: string;
  /** The unit the colors were written in. */
  unit: Unit;
  unit_conversions?: UnitConversions;
  /** Total pairs across those colors — derived from color_breakdown and the unit. */
  quantity_pairs: number;
  /** Total pairs received for this stock code from opened receiving packages. */
  received_quantity_pairs?: number;
  lost_quantity_pairs?: number;
  /** Always the Kyat unit price, whatever currency this line was actually priced in. */
  buying_price: number;
  /** "MMK" unless this line was priced in a foreign currency — see ./currency.ts. */
  currency_code?: string;
  /** The unit price before conversion, only present for a non-MMK currency_code. */
  original_buying_price?: number | null;
  /** The exchange rate this line was saved at — a fixed snapshot, only present for a
   *  non-MMK currency_code. Never re-derived from "today's" rate after saving. */
  exchange_rate?: number | null;
}

/** The ERD's payment_account for this voucher — what we owe the supplier for it. What
 *  has been paid is the sum of the payments made, never a figure typed over the top. */
export interface VoucherPayment {
  account_id: string;
  payments: Payment[];
}

/** Everything paid to the supplier against this voucher so far. */
export function paidAmount(voucher: SupplierVoucher): number {
  return voucher.payment.payments.reduce(
    (sum, payment) => sum + payment.amount,
    0,
  );
}

/** A voucher as the business holds it. `received_quantity_pairs` is not typed by anyone: it is what
 *  the receiving gate has counted against this voucher, written back whenever a package is
 *  opened (see ./store). A voucher no goods have arrived for is simply waiting. */
export interface SupplierVoucher {
  voucher_id: string;
  /** Our own reference for the voucher. */
  voucher_no: string;
  supplier_name: string;
  voucher_date: string;
  /** How many packages the supplier says it is sending. */
  total_packages: number;
  carrier_name: string;
  total_quantity_pairs: number;
  received_quantity_pairs: number;
  lost_quantity_pairs?: number;
  payment: VoucherPayment;
  lines: SupplierVoucherLine[];
}

export function voucherAmount(voucher: SupplierVoucher): number {
  return voucher.lines.reduce(
    (sum, line) =>
      sum + pricedAmount(line.quantity_pairs, line.unit, line.buying_price, line.unit_conversions),
    0,
  );
}

export function remainingQty(voucher: SupplierVoucher): number {
  return Math.max(0, voucher.total_quantity_pairs - voucher.received_quantity_pairs - (voucher.lost_quantity_pairs ?? 0));
}

export function receivedPct(voucher: SupplierVoucher): number {
  return sharePct(voucher.received_quantity_pairs + (voucher.lost_quantity_pairs ?? 0), voucher.total_quantity_pairs);
}

export function receivingStatus(voucher: SupplierVoucher): ReceivingStatus {
  const accounted = voucher.received_quantity_pairs + (voucher.lost_quantity_pairs ?? 0);
  if (accounted <= 0) return "waiting";
  if (accounted >= voucher.total_quantity_pairs) return "fully_received";
  return "partly_received";
}

export function voucherBalance(voucher: SupplierVoucher): number {
  return voucherAmount(voucher) - paidAmount(voucher);
}

export function paymentStatus(voucher: SupplierVoucher): PaymentStatus {
  return paymentStatusOf(voucherAmount(voucher), paidAmount(voucher));
}

export function paidPct(voucher: SupplierVoucher): number {
  return sharePct(paidAmount(voucher), voucherAmount(voucher));
}

/** The freight companies that bring shipments in. */
// ── Seed rows ────────────────────────────────────────────────────────────────
// Stock codes match the ones on the seeded customer orders, so the two screens read as
// one business rather than two unrelated demos.

export const SEED_VOUCHERS: SupplierVoucher[] = [
  {
    voucher_id: "fv-1",
    voucher_no: "VCH-260825-0001",
    supplier_name: "Goody Factory",
    voucher_date: "2026-08-25",
    total_packages: 10,
    carrier_name: "Shwe Moe Cargo",
    total_quantity_pairs: 300,
    received_quantity_pairs: 90,
    payment: {
      account_id: "pa-v1",
      payments: [
        {
          payment_id: "payv-1",
          paid_on: "2026-08-25",
          amount: 2000000,
          note: "Advance to the factory",
        },
      ],
    },
    lines: [
      {
        voucher_line_id: "fvl-1",
        stock_code: "A1001",
        description: "Men's leather sandal",
        product_group: "man",
        color_breakdown: "black90p,white60p",
        unit: "pair",
        quantity_pairs: 150,
        buying_price: 18000,
      },
      {
        voucher_line_id: "fvl-2",
        stock_code: "A1002",
        description: "Men's slipper",
        product_group: "man",
        color_breakdown: "white80p,pink70p",
        unit: "pair",
        quantity_pairs: 150,
        buying_price: 20000,
      },
    ],
  },
  {
    voucher_id: "fv-2",
    voucher_no: "VCH-260828-0001",
    supplier_name: "Lek",
    voucher_date: "2026-08-28",
    total_packages: 8,
    carrier_name: "Ayar Cargo",
    total_quantity_pairs: 162,
    received_quantity_pairs: 162,
    payment: {
      account_id: "pa-v2",
      payments: [
        {
          payment_id: "payv-2",
          paid_on: "2026-08-28",
          amount: 2000000,
          note: "Advance",
        },
        {
          payment_id: "payv-3",
          paid_on: "2026-09-04",
          amount: 1120000,
          note: "On arrival",
        },
      ],
    },
    lines: [
      {
        voucher_line_id: "fvl-3",
        stock_code: "B2001",
        description: "Ladies' flat sandal",
        product_group: "lady",
        color_breakdown: "brown102p,black60p",
        unit: "pair",
        quantity_pairs: 162,
        buying_price: 19500,
      },
    ],
  },
  {
    voucher_id: "fv-3",
    voucher_no: "VCH-260901-0001",
    supplier_name: "Panda Shoes",
    voucher_date: "2026-09-01",
    total_packages: 20,
    carrier_name: "Tiger Cargo",
    total_quantity_pairs: 396,
    received_quantity_pairs: 0,
    payment: {
      account_id: "pa-v3",
      payments: [],
    },
    lines: [
      {
        voucher_line_id: "fvl-4",
        stock_code: "C3001",
        description: "Kids' school shoe",
        product_group: "child",
        color_breakdown: "navy120p,black78p",
        unit: "pair",
        quantity_pairs: 198,
        buying_price: 17000,
      },
      {
        voucher_line_id: "fvl-5",
        stock_code: "C3002",
        description: "Kids' sandal",
        product_group: "child",
        color_breakdown: "red100p,white98p",
        unit: "pair",
        quantity_pairs: 198,
        buying_price: 17000,
      },
    ],
  },
  {
    voucher_id: "fv-4",
    voucher_no: "VCH-260905-0001",
    supplier_name: "Maldini",
    voucher_date: "2026-09-05",
    total_packages: 6,
    carrier_name: "Shwe Moe Cargo",
    total_quantity_pairs: 120,
    received_quantity_pairs: 0,
    payment: {
      account_id: "pa-v4",
      payments: [
        {
          payment_id: "payv-4",
          paid_on: "2026-09-05",
          amount: 1200000,
          note: "Advance",
        },
      ],
    },
    lines: [
      {
        voucher_line_id: "fvl-6",
        stock_code: "D4001",
        description: "Ladies' rubber slipper",
        product_group: "lady",
        color_breakdown: "beige120p",
        unit: "pair",
        quantity_pairs: 120,
        buying_price: 19000,
      },
    ],
  },
];
