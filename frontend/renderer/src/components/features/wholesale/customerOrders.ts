// The customer-order half of the wholesale data model drawn in diagram/wholesale/erd.mmd.
// Front-end only for now: there is no backend behind any of this, so the rows below are
// in-memory seed data and anything the user adds lives until the window reloads. Types
// are named after the ERD's columns rather than the old removed API's, so wiring a real
// backend later is a matter of swapping the source, not renaming every field. The
// formatting and colour-shorthand helpers live in ./shared, shared with factory vouchers.

import { paymentStatusOf, sharePct, type PaymentStatus } from "./shared";
import { type Unit } from "./units";
import { type ProductGroup } from "./products";

/** created → processing → completed, or cancelled at any point. */
export type OrderStatus = "created" | "processing" | "completed" | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
  "created",
  "processing",
  "completed",
  "cancelled",
];

export interface CustomerOrderLine {
  order_line_id: string;
  stock_code: string;
  /** What the product actually is, so a line reads as a shoe and not as a code. */
  description: string;
  /** Man, lady or child — the range the business thinks in. */
  group: ProductGroup;
  supplier_name: string;
  /** Colors and their counts the way staff already write them, e.g. "black10,pink10". */
  color_qty: string;
  /** The unit the colors were written in — "black10" can mean ten pairs, ten sets or ten
   *  dozen, and the quantity below is that reading turned into pairs. */
  unit: Unit;
  /** Total pairs across those colors — derived from color_qty and the unit, never typed
   *  directly. */
  wanted_qty: number;
  /** Pairs of this product the customer has actually been given. The order's own figure
   *  is the sum of these: a customer asks for two stock codes and is rarely given both at
   *  once, so "how much is still owed" is a question about a product, not an order. */
  received_qty: number;
  selling_price: number;
}

/** One payment taken against an order — a customer pays in instalments, and "how much
 *  has been paid" is the sum of them rather than a figure somebody keeps adjusting. Each
 *  one says when it came in, so a question about last week's money has an answer. */
export interface Payment {
  payment_id: string;
  date: string;
  amount: number;
  note: string;
}

/** The ERD's payment_account for this order — what the customer owes on it. `balance`
 *  and `payment_status` are worked out from the payments taken, so nothing here can
 *  disagree with the money itself. No due date: customers here pay when they pay. */
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
  total_qty: number;
  received_qty: number;
  order_status: OrderStatus;
  payment: PaymentAccount;
  lines: CustomerOrderLine[];
}

/** Every line's qty x price. The ERD stores line_amount per line; this is their sum. */
export function orderAmount(order: CustomerOrder): number {
  return order.lines.reduce(
    (sum, line) => sum + line.wanted_qty * line.selling_price,
    0,
  );
}

/** What is still owed of one stock code on this order. */
export function lineRemaining(line: CustomerOrderLine): number {
  return Math.max(0, line.wanted_qty - line.received_qty);
}

/** What is still owed of one stock code across a whole order. */
export function remainingOf(order: CustomerOrder, stockCode: string): number {
  return order.lines
    .filter((line) => line.stock_code === stockCode)
    .reduce((sum, line) => sum + lineRemaining(line), 0);
}

export function remainingQty(order: CustomerOrder): number {
  return Math.max(0, order.total_qty - order.received_qty);
}

export function receivedPct(order: CustomerOrder): number {
  if (order.total_qty <= 0) return 0;
  return Math.round((order.received_qty / order.total_qty) * 100);
}

/** What is still owed on this order. A cancelled order owes nothing. */
export function orderBalance(order: CustomerOrder): number {
  if (order.order_status === "cancelled") return 0;
  return Math.max(0, orderAmount(order) - paidAmount(order));
}

export function paymentStatus(order: CustomerOrder): PaymentStatus {
  return paymentStatusOf(orderAmount(order), paidAmount(order));
}

export function paidPct(order: CustomerOrder): number {
  return sharePct(paidAmount(order), orderAmount(order));
}

export const KNOWN_CUSTOMERS = [
  {
    name: "Ma Su Su Hlaing",
    phone: "09-4500-12345",
    address: "No. 24, Bogyoke Rd, Mawlamyine",
  },
  {
    name: "Pone Pone",
    phone: "09-9600-23456",
    address: "112 Anawrahta Rd, Yangon",
  },
  {
    name: "Ko Kaung Htet",
    phone: "09-7800-34567",
    address: "Zay Gyi Market, Magway",
  },
  {
    name: "KKNN",
    phone: "09-4500-45678",
    address: "Shwe Taung St, Mawlamyine",
  },
  {
    name: "Ma Kyi Phyu",
    phone: "09-9600-56789",
    address: "5 Ward, Insein, Yangon",
  },
  { name: "MPPA", phone: "09-7800-67890", address: "78th St, Mandalay" },
];

// ── Seed rows ────────────────────────────────────────────────────────────────

export const SEED_ORDERS: CustomerOrder[] = [
  {
    order_id: "co-1",
    order_no: "ORD-260902-0001",
    customer_name: "Ma Su Su Hlaing",
    customer_phone: "09-4500-12345",
    customer_address: "No. 24, Bogyoke Rd, Mawlamyine",
    order_date: "2026-09-02",
    total_qty: 120,
    received_qty: 24,
    order_status: "processing",
    payment: {
      account_id: "pa-1",
      payments: [
        {
          payment_id: "pay-1",
          date: "2026-09-02",
          amount: 1200000,
          note: "Deposit",
        },
        {
          payment_id: "pay-2",
          date: "2026-09-10",
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
        group: "man",
        supplier_name: "Goody Factory",
        color_qty: "black40p,white20p",
        unit: "pair",
        wanted_qty: 60,
        received_qty: 12,
        selling_price: 28000,
      },
      {
        order_line_id: "col-2",
        stock_code: "A1002",
        description: "Men's slipper",
        group: "man",
        supplier_name: "Goody Factory",
        color_qty: "white30p,pink30p",
        unit: "pair",
        wanted_qty: 60,
        received_qty: 12,
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
    total_qty: 78,
    received_qty: 78,
    order_status: "completed",
    payment: {
      account_id: "pa-2",
      payments: [
        {
          payment_id: "pay-3",
          date: "2026-09-05",
          amount: 1480000,
          note: "Deposit",
        },
        {
          payment_id: "pay-4",
          date: "2026-09-06",
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
        group: "lady",
        supplier_name: "Lek",
        color_qty: "brown48p,black30p",
        unit: "pair",
        wanted_qty: 78,
        received_qty: 78,
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
    total_qty: 204,
    received_qty: 0,
    order_status: "created",
    payment: {
      account_id: "pa-3",
      payments: [],
    },
    lines: [
      {
        order_line_id: "col-4",
        stock_code: "C3001",
        description: "Kids' school shoe",
        group: "child",
        supplier_name: "Panda Shoes",
        color_qty: "navy60p,black42p",
        unit: "pair",
        wanted_qty: 102,
        received_qty: 0,
        selling_price: 29000,
      },
      {
        order_line_id: "col-5",
        stock_code: "C3002",
        description: "Kids' sandal",
        group: "child",
        supplier_name: "Panda Shoes",
        color_qty: "red50p,white52p",
        unit: "pair",
        wanted_qty: 102,
        received_qty: 0,
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
    total_qty: 60,
    received_qty: 0,
    order_status: "created",
    payment: {
      account_id: "pa-4",
      payments: [
        {
          payment_id: "pay-5",
          date: "2026-09-09",
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
        group: "lady",
        supplier_name: "Maldini",
        color_qty: "beige60p",
        unit: "pair",
        wanted_qty: 60,
        received_qty: 0,
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
    total_qty: 150,
    received_qty: 36,
    order_status: "processing",
    payment: {
      account_id: "pa-5",
      payments: [],
    },
    lines: [
      {
        order_line_id: "col-7",
        stock_code: "A1001",
        description: "Men's leather sandal",
        group: "man",
        supplier_name: "Goody Factory",
        color_qty: "black42p,pink30p",
        unit: "pair",
        wanted_qty: 72,
        received_qty: 36,
        selling_price: 30000,
      },
      {
        order_line_id: "col-8",
        stock_code: "A1003",
        description: "Men's sport sandal",
        group: "man",
        supplier_name: "Nilin",
        color_qty: "white78p",
        unit: "pair",
        wanted_qty: 78,
        received_qty: 0,
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
    total_qty: 90,
    received_qty: 0,
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
        group: "lady",
        supplier_name: "Lek",
        color_qty: "black90p",
        unit: "pair",
        wanted_qty: 90,
        received_qty: 0,
        selling_price: 27000,
      },
    ],
  },
];
