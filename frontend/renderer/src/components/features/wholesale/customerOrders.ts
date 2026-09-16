// The customer-order half of the wholesale data model drawn in diagram/wholesale/erd.mmd.
// The API wire shape is kept aligned with these screen types. Seed rows remain a useful
// offline fallback for the wholesale workspace, while customer orders and their stock
// allocations are hydrated from the backend whenever the relevant screen is opened. The
// formatting and colour-shorthand helpers live in ./shared, shared with factory vouchers.

import { paymentStatusOf, sharePct, type PaymentStatus } from "./shared";
import { pricedAmount, type Unit, type UnitConversions } from "./units";
import { type ProductGroup } from "./products";

/** new → allocating → ready_to_deliver → partly_delivered → fulfilled, or cancelled at
 *  any point. Status follows the stock reserved and delivered for the order. */
export type OrderStatus =
  | "new"
  | "allocating"
  | "ready_to_deliver"
  | "partly_delivered"
  | "fulfilled"
  | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
  "new",
  "allocating",
  "ready_to_deliver",
  "partly_delivered",
  "fulfilled",
  "cancelled",
];

export interface CustomerOrderLine {
  order_line_id: string;
  stock_code: string;
  /** What the product actually is, so a line reads as a shoe and not as a code. */
  description: string;
  /** Man, lady or child — the range the business thinks in. */
  product_group: ProductGroup;
  supplier_name: string;
  /** Colors and their counts the way staff already write them, e.g. "black10,pink10". */
  color_breakdown: string;
  /** The unit the colors were written in — "black10" can mean ten pairs, ten sets or ten
   *  dozen, and the quantity_pairs below is that reading turned into pairs. */
  unit: Unit;
  unit_conversions?: UnitConversions;
  /** Total pairs across those colors — derived from color_breakdown and the unit, never typed
   *  directly. */
  quantity_pairs: number;
  /** Pairs of this product the customer has actually been given. The order's own figure
   *  is the sum of these: a customer asks for two stock codes and is rarely given both at
   *  once, so "how much is still owed" is a question about a product, not an order. */
  delivered_quantity_pairs: number;
  /** Explicit stock reserved for this order line. It is set from the order detail's
   *  allocation panel, never inferred from demand. The API clamps it to what remains
   *  owed after delivery. */
  allocated_quantity_pairs?: number;
  /** The colour shorthand entered when the stock reservation was made. */
  allocated_color_breakdown?: string;
  /** What has already gone out to the customer, by colour. Needed to work out how much
   *  of one colour is still owed: the ordered colours alone only give the line total. */
  delivered_color_breakdown?: string;
  lost_quantity_pairs?: number;
  /** Always the Kyat unit price, whatever currency this line was actually priced in. */
  selling_price: number;
  /** "MMK" unless this line was priced in a foreign currency — see ./currency.ts. */
  currency_code?: string;
  /** The unit price before conversion, only present for a non-MMK currency_code. */
  original_selling_price?: number | null;
  /** The exchange rate this line was saved at — a fixed snapshot, only present for a
   *  non-MMK currency_code. Never re-derived from "today's" rate after saving. */
  exchange_rate?: number | null;
}

/** One change made to a customer-order line's allocation, logged by the server whenever
 *  the reserved colour/quantity actually changes. `allocated_quantity_pairs`/
 *  `allocated_color_breakdown` on the order line only ever hold the current reservation
 *  (they get overwritten in place); this is the append-only log behind them, the data
 *  the Allocation Record screen reads. */
export interface AllocationEvent {
  event_id: string;
  order_id: string;
  order_line_id: string;
  order_no: string;
  customer_name: string;
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  unit: Unit;
  unit_conversions?: UnitConversions;
  previous_color_breakdown: string;
  previous_quantity_pairs: number;
  color_breakdown: string;
  quantity_pairs: number;
  recorded_by_user_id: string;
  created_at: string;
}

/** One payment taken against an order — a customer pays in instalments, and "how much
 *  has been paid" is the sum of them rather than a figure somebody keeps adjusting. Each
 *  one says when it came in, so a question about last week's money has an answer. */
export interface Payment {
  payment_id: string;
  paid_on: string;
  amount: number;
  paid_quantity_pairs?: number | null;
  note: string;
}

/** The ERD's payment_account for this order — what the customer owes on it. `balance`
 *  and `payment_status` are worked out from the payments taken, so nothing here can
 *  disagree with the money itself. No due paid_on: customers here pay when they pay. */
export interface PaymentAccount {
  account_id: string;
  payments: Payment[];
}

/** Everything paid against an order so far. */
export function paidAmount(order: CustomerOrder): number {
  return order.payment.payments.reduce(
    (sum, payment) => sum + payment.amount,
    0,
  );
}

export interface CustomerOrder {
  order_id: string;
  order_no: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  order_date: string;
  total_quantity_pairs: number;
  delivered_quantity_pairs: number;
  lost_quantity_pairs?: number;
  order_status: OrderStatus;
  payment: PaymentAccount;
  lines: CustomerOrderLine[];
}

/** Every line's unit-aware amount. The ERD stores line_amount per line; this is their sum. */
export function orderAmount(order: CustomerOrder): number {
  return order.lines.reduce(
    (sum, line) =>
      sum + pricedAmount(line.quantity_pairs, line.unit, line.selling_price, line.unit_conversions),
    0,
  );
}

/** What is still owed of one stock code on this order. */
export function lineRemaining(line: CustomerOrderLine): number {
  return Math.max(0, line.quantity_pairs - line.delivered_quantity_pairs - (line.lost_quantity_pairs ?? 0));
}

/** What is still owed of one stock code across a whole order. */
export function remainingOf(order: CustomerOrder, stockCode: string): number {
  return order.lines
    .filter((line) => line.stock_code === stockCode)
    .reduce((sum, line) => sum + lineRemaining(line), 0);
}

export function remainingQty(order: CustomerOrder): number {
  return Math.max(0, order.total_quantity_pairs - order.delivered_quantity_pairs - (order.lost_quantity_pairs ?? 0));
}

export function receivedPct(order: CustomerOrder): number {
  if (order.total_quantity_pairs <= 0) return 0;
  return Math.round(((order.delivered_quantity_pairs + (order.lost_quantity_pairs ?? 0)) / order.total_quantity_pairs) * 100);
}

/** What is still owed on this order. A cancelled order owes nothing. */
export function orderBalance(order: CustomerOrder): number {
  if (order.order_status === "cancelled") return 0;
  return orderAmount(order) - paidAmount(order);
}

export function paymentStatus(order: CustomerOrder): PaymentStatus {
  return paymentStatusOf(orderAmount(order), paidAmount(order));
}

export function paidPct(order: CustomerOrder): number {
  return sharePct(paidAmount(order), orderAmount(order));
}

/** Total pairs of stock explicitly allocated across all lines for this order. */
export function orderAllocatedPairs(order: CustomerOrder): number {
  return order.lines.reduce(
    (sum, line) => sum + (line.allocated_quantity_pairs ?? 0),
    0,
  );
}

/** Whether the order still has unallocated items waiting to be allocated. */
export function needsAllocation(order: CustomerOrder): boolean {
  if (order.order_status === "cancelled" || order.order_status === "fulfilled") {
    return false;
  }
  return remainingQty(order) > orderAllocatedPairs(order);
}

/** Whether the order has allocated stock ready to be delivered to the customer. */
export function readyToDeliver(order: CustomerOrder): boolean {
  if (order.order_status === "cancelled" || order.order_status === "fulfilled") {
    return false;
  }
  return orderAllocatedPairs(order) > 0;
}

/** The next operational action for staff on this order: deliver if goods are allocated,
 *  allocate if stock remains to be allocated, or null if fulfilled/cancelled/nothing to do. */
export function nextAction(order: CustomerOrder): "deliver" | "allocate" | null {
  if (order.order_status === "cancelled" || order.order_status === "fulfilled") {
    return null;
  }
  const allocated = orderAllocatedPairs(order);
  const stillToAllocate = remainingQty(order) - allocated;
  if (allocated > 0) return "deliver";
  if (stillToAllocate > 0) return "allocate";
  return null;
}

// ── Seed rows ────────────────────────────────────────────────────────────────

export const SEED_ORDERS: CustomerOrder[] = [
  {
    order_id: "co-1",
    order_no: "ORD-260902-0001",
    customer_name: "Ma Su Su Hlaing",
    customer_phone: "09-4500-12345",
    customer_address: "No. 24, Bogyoke Rd, Mawlamyine",
    order_date: "2026-09-02",
    total_quantity_pairs: 120,
    delivered_quantity_pairs: 24,
    order_status: "allocating",
    payment: {
      account_id: "pa-1",
      payments: [
        {
          payment_id: "pay-1",
          paid_on: "2026-09-02",
          amount: 1200000,
          note: "Deposit",
        },
        {
          payment_id: "pay-2",
          paid_on: "2026-09-10",
          amount: 1200000,
          note: "On collection",
        },
      ],
    },
    lines: [
      {
        order_line_id: "col-1",
        stock_code: "A1001",
        description: "Men's leather sandal",
        product_group: "man",
        supplier_name: "Goody Factory",
        color_breakdown: "black40p,white20p",
        unit: "pair",
        quantity_pairs: 60,
        delivered_quantity_pairs: 12,
        selling_price: 28000,
      },
      {
        order_line_id: "col-2",
        stock_code: "A1002",
        description: "Men's slipper",
        product_group: "man",
        supplier_name: "Goody Factory",
        color_breakdown: "white30p,pink30p",
        unit: "pair",
        quantity_pairs: 60,
        delivered_quantity_pairs: 12,
        selling_price: 32000,
      },
    ],
  },
  {
    order_id: "co-2",
    order_no: "ORD-260905-0001",
    customer_name: "Pone Pone",
    customer_phone: "09-9600-23456",
    customer_address: "112 Anawrahta Rd, Yangon",
    order_date: "2026-09-05",
    total_quantity_pairs: 78,
    delivered_quantity_pairs: 78,
    order_status: "fulfilled",
    payment: {
      account_id: "pa-2",
      payments: [
        {
          payment_id: "pay-3",
          paid_on: "2026-09-05",
          amount: 1480000,
          note: "Deposit",
        },
        {
          payment_id: "pay-4",
          paid_on: "2026-09-06",
          amount: 1000000,
          note: "Balance by transfer",
        },
      ],
    },
    lines: [
      {
        order_line_id: "col-3",
        stock_code: "B2001",
        description: "Ladies' flat sandal",
        product_group: "lady",
        supplier_name: "Lek",
        color_breakdown: "brown48p,black30p",
        unit: "pair",
        quantity_pairs: 78,
        delivered_quantity_pairs: 78,
        selling_price: 31000,
      },
    ],
  },
  {
    order_id: "co-3",
    order_no: "ORD-260908-0001",
    customer_name: "Ko Kaung Htet",
    customer_phone: "09-7800-34567",
    customer_address: "Zay Gyi Market, Magway",
    order_date: "2026-09-08",
    total_quantity_pairs: 204,
    delivered_quantity_pairs: 0,
    order_status: "new",
    payment: {
      account_id: "pa-3",
      payments: [],
    },
    lines: [
      {
        order_line_id: "col-4",
        stock_code: "C3001",
        description: "Kids' school shoe",
        product_group: "child",
        supplier_name: "Panda Shoes",
        color_breakdown: "navy60p,black42p",
        unit: "pair",
        quantity_pairs: 102,
        delivered_quantity_pairs: 0,
        selling_price: 29000,
      },
      {
        order_line_id: "col-5",
        stock_code: "C3002",
        description: "Kids' sandal",
        product_group: "child",
        supplier_name: "Panda Shoes",
        color_breakdown: "red50p,white52p",
        unit: "pair",
        quantity_pairs: 102,
        delivered_quantity_pairs: 0,
        selling_price: 29000,
      },
    ],
  },
  {
    order_id: "co-4",
    order_no: "ORD-260909-0001",
    customer_name: "KKNN",
    customer_phone: "09-4500-45678",
    customer_address: "Shwe Taung St, Mawlamyine",
    order_date: "2026-09-09",
    total_quantity_pairs: 60,
    delivered_quantity_pairs: 0,
    order_status: "new",
    payment: {
      account_id: "pa-4",
      payments: [
        {
          payment_id: "pay-5",
          paid_on: "2026-09-09",
          amount: 1160000,
          note: "Deposit",
        },
      ],
    },
    lines: [
      {
        order_line_id: "col-6",
        stock_code: "D4001",
        description: "Ladies' rubber slipper",
        product_group: "lady",
        supplier_name: "Maldini",
        color_breakdown: "beige60p",
        unit: "pair",
        quantity_pairs: 60,
        delivered_quantity_pairs: 0,
        selling_price: 29000,
      },
    ],
  },
  {
    order_id: "co-5",
    order_no: "ORD-260910-0001",
    customer_name: "Ma Kyi Phyu",
    customer_phone: "09-9600-56789",
    customer_address: "5 Ward, Insein, Yangon",
    order_date: "2026-09-10",
    total_quantity_pairs: 150,
    delivered_quantity_pairs: 36,
    order_status: "allocating",
    payment: {
      account_id: "pa-5",
      payments: [],
    },
    lines: [
      {
        order_line_id: "col-7",
        stock_code: "A1001",
        description: "Men's leather sandal",
        product_group: "man",
        supplier_name: "Goody Factory",
        color_breakdown: "black42p,pink30p",
        unit: "pair",
        quantity_pairs: 72,
        delivered_quantity_pairs: 36,
        selling_price: 30000,
      },
      {
        order_line_id: "col-8",
        stock_code: "A1003",
        description: "Men's sport sandal",
        product_group: "man",
        supplier_name: "Nilin",
        color_breakdown: "white78p",
        unit: "pair",
        quantity_pairs: 78,
        delivered_quantity_pairs: 0,
        selling_price: 30000,
      },
    ],
  },
  {
    order_id: "co-6",
    order_no: "ORD-260910-0002",
    customer_name: "MPPA",
    customer_phone: "09-7800-67890",
    customer_address: "78th St, Mandalay",
    order_date: "2026-09-10",
    total_quantity_pairs: 90,
    delivered_quantity_pairs: 0,
    order_status: "cancelled",
    payment: {
      account_id: "pa-6",
      payments: [],
    },
    lines: [
      {
        order_line_id: "col-9",
        stock_code: "B2002",
        description: "Ladies' heel sandal",
        product_group: "lady",
        supplier_name: "Lek",
        color_breakdown: "black90p",
        unit: "pair",
        quantity_pairs: 90,
        delivered_quantity_pairs: 0,
        selling_price: 27000,
      },
    ],
  },
];
