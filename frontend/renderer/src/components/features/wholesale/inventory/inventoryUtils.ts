// Pure utility functions shared across inventory submodules.

import {
  colorPairsForMovements,
  colorPairsForOrder,
  colorPairsForText,
  type ColorPairs,
  type StockMovement,
  type StockRecord,
  type StockLine,
} from "@renderer/components/features/wholesale/stock";
import { lineRemaining, type CustomerOrder } from "@renderer/components/features/wholesale/customerOrders";
import { type Shipment } from "@renderer/components/features/wholesale/shipments";
import { remainingQty, type SupplierVoucher } from "@renderer/components/features/wholesale/supplierVouchers";
import {
  IN_TRANSIT_PLACE,
  AT_SUPPLIER_PLACE,
  ON_ORDER_PLACE,
  LOW_STOCK_THRESHOLD,
  OVERSTOCK_THRESHOLD,
  type InventoryHealth,
  type ColorAvailability,
  type RelatedOrderRow,
} from "./types";

export function inventoryHealth(record: StockRecord | StockLine): InventoryHealth {
  const onHand = "on_hand_pairs" in record
    ? Math.max(0, record.on_hand_pairs)
    : Math.max(0, record.quantity_available_pairs);
  if (onHand <= 0) {
    return "on_hand_pairs" in record && !record.has_receiving_history
      ? "Not arrived yet"
      : "Out of Stock";
  }
  if (onHand > OVERSTOCK_THRESHOLD) return "Overstock";
  if (onHand < LOW_STOCK_THRESHOLD) return "Low Stock";
  return "Healthy";
}

export function stockPlaces(record: StockRecord): { label: string; pairs: number }[] {
  const places = [
    ...record.locations.map((entry) => ({
      label: entry.location,
      pairs: Math.max(0, entry.on_hand_pairs),
    })),
    { label: IN_TRANSIT_PLACE, pairs: Math.max(0, record.in_transit_pairs) },
    { label: AT_SUPPLIER_PLACE, pairs: Math.max(0, record.at_supplier_pairs) },
  ].filter((place) => place.pairs > 0);

  if (places.length === 0 && record.owed_to_customers_pairs > 0) {
    return [{ label: ON_ORDER_PLACE, pairs: record.owed_to_customers_pairs }];
  }
  return places.sort((a, b) => b.pairs - a.pairs);
}

export function reservedColorPairsForStockCode(
  orders: CustomerOrder[],
  stockCode: string,
  excludingOrderId: string,
): ColorPairs {
  const reserved: ColorPairs = {};
  for (const other of orders) {
    if (other.order_status === "cancelled" || other.order_id === excludingOrderId) continue;
    for (const line of other.lines) {
      if (line.stock_code !== stockCode) continue;
      for (const [color, pairs] of Object.entries(
        colorPairsForText(line.allocated_color_breakdown ?? "", line.unit, line.unit_conversions),
      )) {
        reserved[color] = (reserved[color] ?? 0) + pairs;
      }
    }
  }
  return reserved;
}

export function subtractColorPairs(colors: ColorPairs, reserved: ColorPairs): ColorPairs {
  const result: ColorPairs = {};
  for (const [color, pairs] of Object.entries(colors)) {
    result[color] = Math.max(0, pairs - (reserved[color] ?? 0));
  }
  return result;
}

export function incomingPairsForLine(
  stockCode: string,
  shipments: Shipment[],
  vouchers: SupplierVoucher[],
): number {
  const openVoucherNos = new Set(
    shipments
      .filter((shipment) => shipment.final_received_packages < shipment.total_packages)
      .map((shipment) => shipment.voucher_no),
  );
  return vouchers.reduce((sum, voucher) => {
    if (!openVoucherNos.has(voucher.voucher_no)) return sum;
    const line = voucher.lines.find((entry) => entry.stock_code === stockCode);
    if (!line) return sum;
    const remaining = remainingQty(voucher);
    if (remaining <= 0 || voucher.total_quantity_pairs <= 0) return sum;
    return sum + Math.round((line.quantity_pairs * remaining) / voucher.total_quantity_pairs);
  }, 0);
}

export function relatedOrdersFor(
  stockCode: string,
  orders: CustomerOrder[],
): RelatedOrderRow[] {
  return orders
    .filter(
      (order) =>
        order.order_status !== "cancelled" &&
        order.lines.some((line) => line.stock_code === stockCode),
    )
    .map((order) => {
      const lines = order.lines.filter((line) => line.stock_code === stockCode);
      return {
        order,
        ordered: lines.reduce((sum, line) => sum + line.quantity_pairs, 0),
        received: lines.reduce((sum, line) => sum + line.delivered_quantity_pairs, 0),
        remaining: lines.reduce((sum, line) => sum + lineRemaining(line), 0),
      };
    })
    .sort((a, b) => (a.order.order_date < b.order.order_date ? 1 : -1));
}

export function colorAvailabilityForOrder(
  order: CustomerOrder,
  stockCode: string,
  stockColors: ColorPairs,
  allMovements: StockMovement[],
): ColorAvailability {
  const ordered = colorPairsForOrder(order, stockCode);
  const delivered = colorPairsForMovements(
    allMovements,
    (movement) =>
      movement.movement_type === "out" &&
      movement.reference === order.order_no &&
      movement.stock_code === stockCode,
  );
  const remaining: ColorPairs = {};
  const missing: ColorPairs = {};
  for (const [color, pairs] of Object.entries(ordered)) {
    const stillNeeded = Math.max(0, pairs - (delivered[color] ?? 0));
    if (stillNeeded <= 0) continue;
    remaining[color] = stillNeeded;
    const shortfall = Math.max(0, stillNeeded - (stockColors[color] ?? 0));
    if (shortfall > 0) missing[color] = shortfall;
  }
  return { missing, remaining };
}

export function formatColorPairs(quantity_pairs: ColorPairs): string {
  return Object.entries(quantity_pairs)
    .filter(([, quantity]) => quantity > 0)
    .map(([color, quantity]) =>
      quantity % 6 === 0 ? `${color}${quantity / 6}s` : `${color}${quantity}p`,
    )
    .join(", ");
}

export function colorsWanted(order: CustomerOrder, stockCode: string): string {
  const colors = order.lines
    .filter((line) => line.stock_code === stockCode)
    .map((line) => line.color_breakdown)
    .filter((color) => color.trim() !== "");
  return colors.join(",") || "—";
}

export function legacyLineFromRecord(record: StockRecord): StockLine {
  const firstLocation = record.locations[0];
  return {
    stock_code: record.stock_code,
    description: record.description,
    product_group: record.product_group,
    location: firstLocation?.location ?? "",
    quantity_in_pairs: record.on_hand_pairs + record.delivered_pairs,
    quantity_out_pairs: record.delivered_pairs,
    quantity_available_pairs: record.on_hand_pairs,
    last_moved_on: record.last_activity_on ?? "",
    colors: record.colors,
    color_quantities_pairs: record.color_quantities_pairs,
  };
}
