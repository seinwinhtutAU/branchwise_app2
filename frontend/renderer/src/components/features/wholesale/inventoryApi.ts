// The Inventory screen's one write (a batch of customer deliveries) plus the wire-shape
// normalisers for stock records and movement rows, tolerant of an older backend's field
// names so a stale response cannot crash the stock or delivery views.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { request } from "./apiClient";
import { type StockMovement, type StockRecord } from "./stock";
import { type Unit } from "./units";

export const WHOLESALE_INVENTORY_URL = `${apiBaseUrl}/api/wholesale/inventory`;
export const WHOLESALE_STOCK_URL = `${apiBaseUrl}/api/wholesale/inventory/stock`;

export interface CustomerDeliveryBatchInput {
  order_id: string;
  delivered_on: string;
  delivery_address: string;
  note: string;
  lines: {
    stock_code: string;
    location: string;
    color_breakdown: string;
    unit: Unit;
  }[];
}

export async function createCustomerDeliveryBatch(
  session: Session,
  input: CustomerDeliveryBatchInput,
): Promise<StockMovement[]> {
  return request<StockMovement[]>(
    session,
    "/api/wholesale/inventory/deliveries/batch",
    { method: "POST", body: input },
  );
}

export interface StockRecordWire extends Omit<StockRecord, "product_group"> {
  product_group: string;
}

export function stockRecordsFromWire(wires: StockRecordWire[]): StockRecord[] {
  return wires.map((wire) => ({
    ...wire,
    product_group: wire.product_group as StockRecord["product_group"],
    locations: wire.locations.map((location) => ({
      ...location,
      last_moved_on: location.last_moved_on ?? null,
    })),
    last_activity_on: wire.last_activity_on ?? null,
  }));
}

/** The current API uses descriptive field names, while desktop clients with an older
 * backend can still receive the original inventory field names. Normalize at the wire
 * boundary so a stale response cannot crash the stock or delivery views. */
export type InventoryMovementWire = Partial<StockMovement> & {
  kind?: StockMovement["movement_type"];
  group?: StockMovement["product_group"];
  color_qty?: string;
  pairs?: number;
  date?: string;
  party?: string;
};

export function inventoryMovementsFromWire(
  wires: InventoryMovementWire[],
): StockMovement[] {
  return wires.map((wire) => ({
    movement_id: wire.movement_id ?? "",
    movement_type: wire.movement_type ?? wire.kind ?? "in",
    stock_code: wire.stock_code ?? "",
    description: wire.description ?? "",
    product_group: wire.product_group ?? wire.group ?? "man",
    color_breakdown: wire.color_breakdown ?? wire.color_qty ?? "",
    quantity_pairs: wire.quantity_pairs ?? wire.pairs ?? 0,
    unit_conversions: wire.unit_conversions,
    location: wire.location ?? "",
    moved_on: wire.moved_on ?? wire.date ?? "",
    reference: wire.reference ?? "",
    counterparty_name: wire.counterparty_name ?? wire.party ?? "",
    note: wire.note ?? "",
    delivery_address: wire.delivery_address,
  }));
}

