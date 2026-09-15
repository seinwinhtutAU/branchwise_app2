// What the business is holding right now — the ERD's `stock`, kept as the sum of what has
// moved rather than as a number somebody types.
//
// Goods come in at the gate and go out to customers, and stock is simply the difference.
// Counting a package at the receiving gate puts its sets on the shelf the same moment:
// the pairs are physically there once someone has looked in the box, and a second step to
// say so is a step that gets forgotten, leaving goods in the building and invisible in the
// system. Packages that arrive a week after the rest add themselves when they are opened.
//
// Everything is held in **pairs**, whatever unit it was counted in, and shown in sets —
// the unit the gate counts in. One storage unit is what lets a customer's order in pairs
// and a package counted in sets be compared at all.
//
// The movement helpers remain as the Movement tab's compatibility layer and as the
// weak-connection fallback while the server-computed Stock Records response loads.

import { parseColorQty } from "./shared";
import {
  lineRemaining,
  type CustomerOrder,
  type CustomerOrderLine,
} from "./customerOrders";
import { type Receiving } from "./receivings";
import { PAIRS_PER, toPairs, type Unit, type UnitConversions } from "./units";
import { type ProductGroup } from "./products";

export type MovementKind = "in" | "out";

export type ColorPairs = Record<string, number>;

export interface StockMovement {
  movement_id: string;
  movement_type: MovementKind;
  stock_code: string;
  /** What the product actually is, so a line reads as a shoe and not as a code. */
  description: string;
  /** Man, lady or child — the range the business thinks in. */
  product_group: ProductGroup;
  /** Colours and their counts as staff write them, e.g. "black10,pink10". */
  color_breakdown: string;
  /** Always in pairs, whatever unit it was typed in — the one figure every screen
   *  agrees on. */
  quantity_pairs: number;
  /** Rate map captured by the source receiving or delivery transaction. */
  unit_conversions?: UnitConversions;
  location: string;
  moved_on: string;
  /** Where it came from or went to — a receiving no. or a customer order no. */
  reference: string;
  /** Who it came from or went to — the supplier who sent it, the customer who took it. */
  counterparty_name: string;
  note: string;
  /** The delivery destination captured when stock left the selected location. */
  delivery_address?: string;
}

/** One line of the stock list: one product at one place. */
export interface StockLine {
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  location: string;
  quantity_in_pairs: number;
  quantity_out_pairs: number;
  quantity_available_pairs: number;
  last_moved_on: string;
  /** What is actually left, by colour, in the same shorthand staff write:
   *  "black7,white2". Summed across every movement rather than listing each one, so a
   *  line that took black in three times reads as one figure. */
  colors: string;
  color_quantities_pairs: ColorPairs;
}

export interface StockRecordLocation {
  location: string;
  on_hand_pairs: number;
  colors: string;
  last_moved_on: string | null;
}

/** One product across the whole wholesale pipeline. The backend is the source of
 * truth for these figures; the legacy StockLine model remains for the Movement tab
 * and the offline fallback. */
export interface StockRecord {
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  on_hand_pairs: number;
  allocated_pairs: number;
  available_pairs: number;
  at_supplier_pairs: number;
  in_transit_pairs: number;
  incoming_pairs: number;
  customer_ordered_pairs: number;
  owed_to_customers_pairs: number;
  delivered_pairs: number;
  lost_pairs: number;
  received_today_pairs?: number;
  delivered_today_pairs?: number;
  lost_today_pairs?: number;
  colors: string;
  color_quantities_pairs: ColorPairs;
  locations: StockRecordLocation[];
  sources: string[];
  voucher_nos: string[];
  shipment_nos: string[];
  order_nos: string[];
  receiving_nos: string[];
  status: string;
  last_activity_on: string | null;
  has_receiving_history: boolean;
}

function colorKey(color: string): string {
  return color.trim().replace(/\s+/g, " ").toLowerCase();
}

export function colorPairsForText(
  text: string,
  rowUnit: Unit,
  conversions: UnitConversions = PAIRS_PER,
): ColorPairs {
  const pairs: ColorPairs = {};
  for (const entry of parseColorQty(text)) {
    const color = colorKey(entry.color);
    if (!color || entry.qty <= 0) continue;
    pairs[color] = (pairs[color] ?? 0) + toPairs(entry.qty, entry.unit ?? rowUnit, conversions);
  }
  return pairs;
}

export function serializeColorPairs(
  pairs: ColorPairs,
  setSize: number = PAIRS_PER.set,
): string {
  const parts: string[] = [];
  for (const [color, count] of Object.entries(pairs)) {
    if (count <= 0) continue;
    const safeSetSize = setSize > 0 ? setSize : PAIRS_PER.set;
    const sets = Math.floor(count / safeSetSize);
    const rest = count % safeSetSize;
    if (sets > 0) parts.push(`${color}${sets}s`);
    if (rest > 0) parts.push(`${color}${rest}p`);
  }
  return parts.join(",");
}

export function colorPairsForOrder(
  order: CustomerOrder,
  stockCode: string,
): ColorPairs {
  return order.lines
    .filter((line) => line.stock_code === stockCode)
    .reduce(
      (pairs, line) => mergeColorPairs(pairs, colorPairsForLine(line)),
      {},
    );
}

function colorPairsForLine(line: CustomerOrderLine): ColorPairs {
  return colorPairsForText(line.color_breakdown, line.unit, line.unit_conversions);
}

export function colorPairsForMovements(
  movements: StockMovement[],
  predicate: (movement: StockMovement) => boolean,
): ColorPairs {
  return movements
    .filter(predicate)
    .reduce(
      (pairs, movement) =>
        mergeColorPairs(pairs, colorPairsForText(movement.color_breakdown, "set", movement.unit_conversions)),
      {},
    );
}

function mergeColorPairs(target: ColorPairs, source: ColorPairs): ColorPairs {
  for (const [color, pairs] of Object.entries(source)) {
    target[color] = (target[color] ?? 0) + pairs;
  }
  return target;
}

/** Every set counted at a gate, as a movement into that gate's stock. Read straight off
 *  the receivings: a package nobody has opened yet contributes nothing, because nobody
 *  knows what is inside it. */
export function incomingMovements(receivings: Receiving[]): StockMovement[] {
  const movements: StockMovement[] = [];
  for (const receiving of receivings) {
    for (const entry of receiving.packages) {
      if (!entry.opened) continue;
      for (const item of entry.items) {
    if (item.stock_code.trim() === "" || item.quantity <= 0) continue;
        movements.push({
          movement_id: `mv-${entry.package_id}-${item.item_id}`,
          movement_type: "in",
          stock_code: item.stock_code.trim(),
          description: item.description,
          product_group: item.product_group,
          color_breakdown: item.color_breakdown,
          quantity_pairs: toPairs(item.quantity, item.unit, item.unit_conversions ?? PAIRS_PER),
          unit_conversions: item.unit_conversions ?? PAIRS_PER,
          location: receiving.gate,
          moved_on: entry.received_on || receiving.received_on,
          reference: receiving.receiving_no,
          counterparty_name: receiving.supplier_name,
          note: entry.note,
        });
      }
    }
  }
  return movements;
}

/** Adds every movement up into one line per product per place. */
export function stockLines(movements: StockMovement[]): StockLine[] {
  const lines = new Map<string, StockLine>();
  const colours = new Map<string, Map<string, number>>();

  for (const movement of movements) {
    const key = `${movement.stock_code}@@${movement.location}`;
    const line = lines.get(key) ?? {
      stock_code: movement.stock_code,
      description: movement.description,
      product_group: movement.product_group,
      location: movement.location,
      quantity_in_pairs: 0,
      quantity_out_pairs: 0,
      quantity_available_pairs: 0,
      last_moved_on: movement.moved_on,
      colors: "",
      color_quantities_pairs: {},
    };
    if (movement.movement_type === "in") line.quantity_in_pairs += movement.quantity_pairs;
    else line.quantity_out_pairs += movement.quantity_pairs;
    line.quantity_available_pairs = line.quantity_in_pairs - line.quantity_out_pairs;
    if (movement.moved_on > line.last_moved_on) line.last_moved_on = movement.moved_on;
    lines.set(key, line);

    // Colours add up the same way the quantities do: in adds, out takes away. They are
    // kept in pairs, because one line can take black in by the set and send it out by the
    // pair, and only pairs let the two meet.
    const byColour = colours.get(key) ?? new Map<string, number>();
    for (const entry of parseColorQty(movement.color_breakdown)) {
      const sign = movement.movement_type === "in" ? 1 : -1;
      const color = colorKey(entry.color);
      if (!color) continue;
      const pairs = toPairs(entry.qty, entry.unit ?? "set");
      byColour.set(
        color,
        (byColour.get(color) ?? 0) + sign * pairs,
      );
    }
    colours.set(key, byColour);
  }

  for (const [key, line] of lines) {
    const byColour = colours.get(key);
    // Written back out the way staff write it, unit letter and all: whole sets read as
    // sets, and anything that does not divide evenly stays in pairs rather than being
    // rounded into a figure nobody counted.
    line.colors = byColour
      ? [...byColour.entries()]
          .filter(([, pairs]) => pairs > 0)
          .map(([color, pairs]) =>
            pairs % PAIRS_PER.set === 0
              ? `${color}${pairs / PAIRS_PER.set}s`
              : `${color}${pairs}p`,
          )
          .join(",")
      : "";
    line.color_quantities_pairs = byColour
      ? Object.fromEntries(
          [...byColour.entries()].filter(([, pairs]) => pairs > 0),
        )
      : {};
  }

  return [...lines.values()].sort((a, b) =>
    a.stock_code === b.stock_code
      ? a.location.localeCompare(b.location)
      : a.stock_code.localeCompare(b.stock_code),
  );
}

export function movementsFor(
  movements: StockMovement[],
  stockCode: string,
  location: string,
): StockMovement[] {
  return movements
    .filter(
      (movement) =>
        movement.stock_code === stockCode && movement.location === location,
    )
    .sort((a, b) => (a.moved_on < b.moved_on ? 1 : -1));
}

// Wholesale stock is not a shop shelf, so "running low" is not the question anyone asks
// of it. The status explains how much of the stock is already promised to customers:
// none, some, all, or none because the shelf is empty.

export type StockPurpose =
  | "quantity_available_pairs"
  | "partly_allocated"
  | "fully_allocated"
  | "out_of_stock";

/** The open orders waiting on a product, newest first. Brought to the stock screen so a
 *  delivery can be made where the goods are, without first going to Customer Orders to
 *  find out who is waiting and then coming back. */
export function ordersWaitingFor(
  stockCode: string,
  orders: CustomerOrder[],
): CustomerOrder[] {
  return orders
    .filter(
      (order) =>
        order.order_status !== "cancelled" &&
        // Still owed *this* product, not merely unfinished somewhere else on the order.
        // An order that has had all its sandals and is waiting on its slippers has no
        // business appearing under the sandals.
        owedOf(order, stockCode) > 0,
    )
    .sort((a, b) => (a.order_date < b.order_date ? 1 : -1));
}

/** The pairs of one product a single order is still owed. */
function owedOf(order: CustomerOrder, stockCode: string): number {
  return order.lines
    .filter((line) => line.stock_code === stockCode)
    .reduce((sum, line) => sum + lineRemaining(line), 0);
}

/** The pairs customers are still owed of a product, across every open order. */
export function owedPairs(stockCode: string, orders: CustomerOrder[]): number {
  return orders
    .filter((order) => order.order_status !== "cancelled")
    .reduce((sum, order) => sum + owedOf(order, stockCode), 0);
}

/** How much of what is on this shelf has been explicitly reserved by a user. Demand is
 *  not allocation: open orders remain unallocated until an order line records a quantity. */
export function allocatedPairs(
  line: StockLine,
  orders: CustomerOrder[],
): number {
  return Math.min(
    orders.reduce(
      (sum, order) =>
        sum +
        order.lines
          .filter((orderLine) => orderLine.stock_code === line.stock_code)
          .reduce((lineSum, orderLine) => lineSum + (orderLine.allocated_quantity_pairs ?? 0), 0),
      0,
    ),
    Math.max(0, line.quantity_available_pairs),
  );
}

/** Whether none, some, or all of this stock has an explicit customer allocation, or
 *  whether the stock line is empty. */
export function stockPurpose(
  line: StockLine,
  orders: CustomerOrder[],
): StockPurpose {
  if (line.quantity_available_pairs <= 0) return "out_of_stock";
  const allocated = allocatedPairs(line, orders);
  if (allocated <= 0) return "quantity_available_pairs";
  if (allocated >= line.quantity_available_pairs) return "fully_allocated";
  return "partly_allocated";
}

// ── Seed rows ────────────────────────────────────────────────────────────────
// What has already gone out to customers. Everything coming in is worked out from the
// receivings, so each of these matches goods the gate really counted, and each one is
// the reason the order it names shows what it shows as received.

export const SEED_OUTGOING: StockMovement[] = [
  {
    movement_id: "mv-out-1",
    movement_type: "out",
    stock_code: "A1001",
    description: "Men's leather sandal",
    product_group: "man",
    color_breakdown: "black2s",
    quantity_pairs: toPairs(2, "set"),
    location: "Bogyoke Rd, Mawlamyine",
    moved_on: "2026-09-10",
    reference: "ORD-260902-0001",
    counterparty_name: "Ma Su Su Hlaing",
    note: "Collected by the customer",
  },
  {
    movement_id: "mv-out-2",
    movement_type: "out",
    stock_code: "A1002",
    description: "Men's slipper",
    product_group: "man",
    color_breakdown: "white2s",
    quantity_pairs: toPairs(2, "set"),
    location: "Bogyoke Rd, Mawlamyine",
    moved_on: "2026-09-10",
    reference: "ORD-260902-0001",
    counterparty_name: "Ma Su Su Hlaing",
    note: "Collected with the sandals",
  },
  {
    movement_id: "mv-out-3",
    movement_type: "out",
    stock_code: "B2001",
    description: "Ladies' flat sandal",
    product_group: "lady",
    color_breakdown: "brown8s,black5s",
    quantity_pairs: toPairs(13, "set"),
    location: "Zay Gyi St, Magway",
    moved_on: "2026-09-06",
    reference: "ORD-260905-0001",
    counterparty_name: "Pone Pone",
    note: "Sent by bus",
  },
  {
    movement_id: "mv-out-4",
    movement_type: "out",
    stock_code: "A1001",
    description: "Men's leather sandal",
    product_group: "man",
    color_breakdown: "black6s",
    quantity_pairs: toPairs(6, "set"),
    location: "Bogyoke Rd, Mawlamyine",
    moved_on: "2026-09-11",
    reference: "ORD-260910-0001",
    counterparty_name: "Ma Kyi Phyu",
    note: "First part of the order",
  },
];
