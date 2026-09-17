import { describe, expect, it } from "vitest";

import {
  type CustomerOrder,
  type CustomerOrderLine,
  lineRemaining,
  needsAllocation,
  nextAction,
  orderAllocatedPairs,
  orderAmount,
  orderBalance,
  paidAmount,
  paidPct,
  paymentStatus,
  readyToDeliver,
  receivedPct,
  remainingOf,
  remainingQty,
} from "./customerOrders";

function line(overrides: Partial<CustomerOrderLine> = {}): CustomerOrderLine {
  return {
    order_line_id: "line-1",
    stock_code: "A1001",
    description: "Sandal",
    product_group: "man",
    supplier_name: "Goody Factory",
    color_breakdown: "black1p",
    unit: "pair",
    quantity_pairs: 10,
    delivered_quantity_pairs: 0,
    selling_price: 1000,
    ...overrides,
  };
}

function order(overrides: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    order_id: "order-1",
    order_no: "ORD-260913-0001",
    customer_name: "Daw May",
    customer_phone: "09-123",
    customer_address: "Yangon",
    order_date: "2026-09-13",
    total_quantity_pairs: 10,
    delivered_quantity_pairs: 0,
    order_status: "waiting_for_stock",
    payment: { account_id: "pa-1", payments: [] },
    lines: [line()],
    ...overrides,
  };
}

describe("paidAmount", () => {
  it("sums every payment", () => {
    const o = order({
      payment: {
        account_id: "pa-1",
        payments: [
          { payment_id: "p1", paid_on: "2026-09-13", amount: 1000, note: "" },
          { payment_id: "p2", paid_on: "2026-09-14", amount: 500, note: "" },
        ],
      },
    });
    expect(paidAmount(o)).toBe(1500);
  });

  it("is 0 with no payments", () => {
    expect(paidAmount(order())).toBe(0);
  });
});

describe("orderAmount", () => {
  it("adds up unit-aware line amounts, mixing pair and set pricing", () => {
    const o = order({
      lines: [
        line({ order_line_id: "l1", quantity_pairs: 10, unit: "pair", selling_price: 1000 }),
        line({ order_line_id: "l2", stock_code: "A1002", quantity_pairs: 12, unit: "set", selling_price: 6000 }),
      ],
    });
    // l1: 10 pairs x 1000 = 10000. l2: 12 pairs = 2 sets x 6000 = 12000.
    expect(orderAmount(o)).toBe(22000);
  });

  it("is 0 for a free (zero price) line", () => {
    const o = order({ lines: [line({ selling_price: 0 })] });
    expect(orderAmount(o)).toBe(0);
  });
});

describe("lineRemaining", () => {
  it("subtracts delivered and lost pairs from what was ordered", () => {
    expect(lineRemaining(line({ quantity_pairs: 10, delivered_quantity_pairs: 4, lost_quantity_pairs: 1 }))).toBe(5);
  });

  it("never goes negative when delivered+lost overshoots the order", () => {
    expect(lineRemaining(line({ quantity_pairs: 10, delivered_quantity_pairs: 8, lost_quantity_pairs: 5 }))).toBe(0);
  });
});

describe("remainingOf", () => {
  it("adds remaining pairs across every line for a stock code", () => {
    const o = order({
      lines: [
        line({ order_line_id: "l1", stock_code: "A1001", quantity_pairs: 10, delivered_quantity_pairs: 2 }),
        line({ order_line_id: "l2", stock_code: "A1001", quantity_pairs: 5, delivered_quantity_pairs: 5 }),
      ],
    });
    expect(remainingOf(o, "A1001")).toBe(8);
  });

  it("is 0 for a stock code not on the order", () => {
    expect(remainingOf(order(), "Z9999")).toBe(0);
  });
});

describe("remainingQty / receivedPct", () => {
  it("reports 0% received and full remaining before anything ships", () => {
    const o = order({ total_quantity_pairs: 10, delivered_quantity_pairs: 0 });
    expect(remainingQty(o)).toBe(10);
    expect(receivedPct(o)).toBe(0);
  });

  it("reports 100% once delivered plus lost covers the whole order", () => {
    const o = order({ total_quantity_pairs: 10, delivered_quantity_pairs: 8, lost_quantity_pairs: 2 });
    expect(remainingQty(o)).toBe(0);
    expect(receivedPct(o)).toBe(100);
  });

  it("does not divide by zero when nothing was ordered", () => {
    const o = order({ total_quantity_pairs: 0, delivered_quantity_pairs: 0 });
    expect(receivedPct(o)).toBe(0);
    expect(remainingQty(o)).toBe(0);
  });
});

describe("orderBalance / paymentStatus / paidPct", () => {
  it("owes nothing once a cancelled order still had a balance", () => {
    const o = order({
      order_status: "cancelled",
      lines: [line({ quantity_pairs: 10, selling_price: 1000 })],
      payment: { account_id: "pa-1", payments: [] },
    });
    expect(orderBalance(o)).toBe(0);
  });

  it("is unpaid at 0%, partial in between, and paid once the balance is covered", () => {
    const unpaid = order({ lines: [line({ quantity_pairs: 10, selling_price: 1000 })] });
    expect(paymentStatus(unpaid)).toBe("unpaid");
    expect(paidPct(unpaid)).toBe(0);

    const partial = order({
      lines: [line({ quantity_pairs: 10, selling_price: 1000 })],
      payment: { account_id: "pa-1", payments: [{ payment_id: "p1", paid_on: "2026-09-13", amount: 5000, note: "" }] },
    });
    expect(paymentStatus(partial)).toBe("partial");
    expect(paidPct(partial)).toBe(50);

    const paid = order({
      lines: [line({ quantity_pairs: 10, selling_price: 1000 })],
      payment: { account_id: "pa-1", payments: [{ payment_id: "p1", paid_on: "2026-09-13", amount: 10000, note: "" }] },
    });
    expect(paymentStatus(paid)).toBe("paid");
    expect(paidPct(paid)).toBe(100);
  });
});

describe("orderAllocatedPairs / needsAllocation / readyToDeliver / nextAction", () => {
  it("treats a cancelled or fulfilled order as never needing allocation or delivery", () => {
    for (const status of ["cancelled", "fulfilled"] as const) {
      const o = order({ order_status: status, lines: [line({ allocated_quantity_pairs: 0 })] });
      expect(needsAllocation(o)).toBe(false);
      expect(readyToDeliver(o)).toBe(false);
      expect(nextAction(o)).toBe(null);
    }
  });

  it("needs allocation while remaining demand exceeds what has been set aside", () => {
    const o = order({
      total_quantity_pairs: 10,
      delivered_quantity_pairs: 0,
      lines: [line({ quantity_pairs: 10, allocated_quantity_pairs: 4 })],
    });
    expect(orderAllocatedPairs(o)).toBe(4);
    expect(needsAllocation(o)).toBe(true);
    expect(readyToDeliver(o)).toBe(true);
    expect(nextAction(o)).toBe("deliver");
  });

  it("has nothing to deliver once nothing has been allocated", () => {
    const o = order({ lines: [line({ allocated_quantity_pairs: 0 })] });
    expect(readyToDeliver(o)).toBe(false);
    expect(nextAction(o)).toBe(null);
  });

  it("stops needing allocation once the whole remaining demand is set aside", () => {
    const o = order({
      total_quantity_pairs: 10,
      delivered_quantity_pairs: 0,
      lines: [line({ quantity_pairs: 10, allocated_quantity_pairs: 10 })],
    });
    expect(needsAllocation(o)).toBe(false);
  });
});
