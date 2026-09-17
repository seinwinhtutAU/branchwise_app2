import {
  lineRemaining,
  remainingQty as orderRemaining,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import { type SupplierVoucher } from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { colorQtyPairs } from "@renderer/components/features/wholesale/shared/shared";
import { PAIRS_PER } from "@renderer/components/features/wholesale/shared/units";
import {
  colorPairsForText,
  type ColorPairs,
} from "@renderer/components/features/wholesale/inventory/stock";
import { DEFAULT_CURRENCY } from "@renderer/components/features/wholesale/shared/currency";
import {
  EMPTY_LINE,
  UNASSIGNED_SUPPLIER,
  type DraftLine,
  type OpenOrderLine,
  type SupplierDemandGroup,
  type WaitingCustomer,
} from "./types";

export function draftPairs(line: DraftLine): number {
  return colorQtyPairs(line.color_breakdown, line.unit, line.unit_conversions);
}

export function customersWaitingFor(
  stockCode: string,
  orders: CustomerOrder[],
): WaitingCustomer[] {
  const waiting: WaitingCustomer[] = [];
  for (const order of orders) {
    if (order.order_status === "cancelled") continue;
    if (orderRemaining(order) <= 0) continue;
    const qty = order.lines
      .filter((line) => line.stock_code === stockCode)
      .reduce((sum, line) => sum + line.quantity_pairs, 0);
    if (qty > 0) {
      waiting.push({
        customerName: order.customer_name,
        orderNo: order.order_no,
        qty,
      });
    }
  }
  return waiting;
}

export function openOrderLines(
  orders: CustomerOrder[],
  supplierName: string,
  vouchers: SupplierVoucher[] = [],
): OpenOrderLine[] {
  const wanted = supplierName.trim().toLowerCase();
  const requestedByCode = new Map<string, ColorPairs>();
  for (const voucher of vouchers) {
    if (voucher.supplier_name.trim().toLowerCase() !== wanted) continue;
    for (const line of voucher.lines) {
      const key = line.stock_code.trim().toLowerCase();
      const requested = requestedByCode.get(key) ?? {};
      for (const [color, pairs] of Object.entries(
        colorPairsForText(line.color_breakdown, line.unit),
      )) {
        requested[color] = (requested[color] ?? 0) + pairs;
      }
      requestedByCode.set(key, requested);
    }
  }
  const rows: OpenOrderLine[] = [];
  for (const order of orders) {
    if (order.order_status === "cancelled") continue;
    for (const line of order.lines) {
      const lineSupplier = line.supplier_name.trim();
      const isUnassigned = supplierName === UNASSIGNED_SUPPLIER;
      if (isUnassigned) {
        if (lineSupplier && lineSupplier !== "—") continue;
      } else if (lineSupplier.toLowerCase() !== wanted) {
        continue;
      }
      const requested =
        requestedByCode.get(line.stock_code.trim().toLowerCase()) ?? {};
      const demand = colorPairsForText(line.color_breakdown, line.unit);
      const remainingColors: ColorPairs = {};
      let openQty = lineRemaining(line);
      for (const [color, pairs] of Object.entries(demand)) {
        const alreadyRequested = Math.min(pairs, requested[color] ?? 0);
        requested[color] = Math.max(
          0,
          (requested[color] ?? 0) - alreadyRequested,
        );
        const available = Math.max(0, pairs - alreadyRequested);
        const take = Math.min(available, openQty);
        if (take > 0) remainingColors[color] = take;
        openQty -= take;
      }
      const openPairs = lineRemaining(line) - openQty;
      if (openPairs <= 0) continue;
      rows.push({
        order_id: order.order_id,
        order_line_id: line.order_line_id,
        order_no: order.order_no,
        customer_name: order.customer_name,
        supplier_name: line.supplier_name,
        stock_code: line.stock_code,
        description: line.description,
        product_group: line.product_group,
        color_breakdown: colorQtyFromPairs(remainingColors),
        unit: line.unit,
        remaining: openPairs,
      });
    }
  }
  return rows.sort((a, b) => (a.order_no < b.order_no ? 1 : -1));
}

export function colorQtyFromPairs(pairs: ColorPairs): string {
  return Object.entries(pairs)
    .filter(([, qty]) => qty > 0)
    .map(([color, qty]) =>
      qty % PAIRS_PER.set === 0
        ? `${color}${qty / PAIRS_PER.set}s`
        : `${color}${qty}p`,
    )
    .join(",");
}

export function mergeColorQty(a: string, b: string): string {
  const merged: ColorPairs = { ...colorPairsForText(a, "set") };
  for (const [color, pairs] of Object.entries(colorPairsForText(b, "set"))) {
    merged[color] = (merged[color] ?? 0) + pairs;
  }
  return Object.entries(merged)
    .filter(([, pairs]) => pairs > 0)
    .map(([color, pairs]) =>
      pairs % PAIRS_PER.set === 0
        ? `${color}${pairs / PAIRS_PER.set}s`
        : `${color}${pairs}p`,
    )
    .join(",");
}

export function draftLinesFromOpenOrderLines(rows: OpenOrderLine[]): DraftLine[] {
  const lines: DraftLine[] = [];
  for (const row of rows) {
    const code = row.stock_code.trim().toLowerCase();
    const existing = lines.findIndex(
      (line) => line.stock_code.trim().toLowerCase() === code,
    );
    if (existing >= 0) {
      lines[existing] = {
        ...lines[existing],
        color_breakdown: mergeColorQty(
          lines[existing].color_breakdown,
          row.color_breakdown,
        ),
      };
    } else {
      lines.push({
        stock_code: row.stock_code,
        description: row.description,
        product_group: row.product_group,
        color_breakdown: row.color_breakdown,
        unit: row.unit,
        unit_conversions: PAIRS_PER,
        currency_code: DEFAULT_CURRENCY,
        buying_price: "",
        original_buying_price: "",
        exchange_rate: "",
      });
    }
  }
  return lines.length > 0 ? lines : [{ ...EMPTY_LINE }];
}

export function supplierDemandGroups(
  orders: CustomerOrder[],
  vouchers: SupplierVoucher[],
): SupplierDemandGroup[] {
  const supplierNames = new Set<string>();
  let hasUnassigned = false;
  for (const order of orders) {
    if (order.order_status === "cancelled") continue;
    for (const line of order.lines) {
      const supplier = line.supplier_name.trim();
      if (supplier && supplier !== "—") supplierNames.add(supplier);
      else hasUnassigned = true;
    }
  }

  const names = [...supplierNames];
  if (hasUnassigned) names.push(UNASSIGNED_SUPPLIER);

  return names
    .map((supplierName) => {
      const lines = openOrderLines(orders, supplierName, vouchers);
      return {
        supplierName,
        lines,
        total: lines.reduce((sum, line) => sum + line.remaining, 0),
      };
    })
    .filter((group) => group.lines.length > 0)
    .sort((a, b) => {
      if (a.supplierName === UNASSIGNED_SUPPLIER) return -1;
      if (b.supplierName === UNASSIGNED_SUPPLIER) return 1;
      return b.total - a.total || a.supplierName.localeCompare(b.supplierName);
    });
}
