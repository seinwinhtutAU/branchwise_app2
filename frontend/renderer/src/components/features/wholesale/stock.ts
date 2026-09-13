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
// Front-end only: no backend, so the outgoing movements below are seed data and anything
// recorded lives until the window reloads.

import { parseColorQty } from "./shared";
import {
  lineRemaining,
  type CustomerOrder,
  type CustomerOrderLine,
} from "./customerOrders";
import { type Receiving } from "./receivings";
import { PAIRS_PER, toPairs, type Unit } from "./units";
import { type ProductGroup } from "./products";

export type MovementKind = "in" | "out";

export type ColorPairs = Record<string, number>;

export interface StockMovement {
  movement_id: string;
  kind: MovementKind;
  stock_code: string;
  /** What the product actually is, so a line reads as a shoe and not as a code. */
  description: string;
  /** Man, lady or child — the range the business thinks in. */
  group: ProductGroup;
  /** Colours and their counts as staff write them, e.g. "black10,pink10". */
  color_qty: string;
  /** Always in pairs, whatever unit it was typed in — the one figure every screen
   *  agrees on. */
  pairs: number;
  location: string;
  date: string;
  /** Where it came from or went to — a receiving no. or a customer order no. */
  reference: string;
  /** Who it came from or went to — the supplier who sent it, the customer who took it. */
  party: string;
  note: string;
}

/** One line of the stock list: one product at one place. */
export interface StockLine {
  stock_code: string;
  description: string;
  group: ProductGroup;
  location: string;
  pairs_in: number;
  pairs_out: number;
  in_stock: number;
  last_moved: string;
  /** What is actually left, by colour, in the same shorthand staff write:
   *  "black7,white2". Summed across every movement rather than listing each one, so a
   *  line that took black in three times reads as one figure. */
  colors: string;
  color_pairs: ColorPairs;
}

function colorKey(color: string): string {
  return color.trim().replace(/\s+/g, " ").toLowerCase();
}

export function colorPairsForText(text: string, rowUnit: Unit): ColorPairs {
  const pairs: ColorPairs = {};
  for (const entry of parseColorQty(text)) {
    const color = colorKey(entry.color);
    if (!color || entry.qty <= 0) continue;
    pairs[color] = (pairs[color] ?? 0) + toPairs(entry.qty, entry.unit ?? rowUnit);
  }
  return pairs;
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
  return colorPairsForText(line.color_qty, line.unit);
}

export function colorPairsForMovements(
  movements: StockMovement[],
  predicate: (movement: StockMovement) => boolean,
): ColorPairs {
  return movements
    .filter(predicate)
    .reduce(
      (pairs, movement) =>
        mergeColorPairs(pairs, colorPairsForText(movement.color_qty, "set")),
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
        if (item.stock_code.trim() === "" || item.qty <= 0) continue;
        movements.push({
          movement_id: `mv-${entry.package_id}-${item.item_id}`,
          kind: "in",
          stock_code: item.stock_code.trim(),
          description: item.description,
          group: item.group,
          color_qty: item.color_qty,
          pairs: toPairs(item.qty, item.unit),
          location: receiving.gate,
          date: entry.received_date || receiving.received_date,
          reference: receiving.receiving_no,
          party: receiving.supplier_name,
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
      group: movement.group,
      location: movement.location,
      pairs_in: 0,
      pairs_out: 0,
      in_stock: 0,
      last_moved: movement.date,
      colors: "",
      color_pairs: {},
    };
    if (movement.kind === "in") line.pairs_in += movement.pairs;
    else line.pairs_out += movement.pairs;
    line.in_stock = line.pairs_in - line.pairs_out;
    if (movement.date > line.last_moved) line.last_moved = movement.date;
    lines.set(key, line);

    // Colours add up the same way the quantities do: in adds, out takes away. They are
    // kept in pairs, because one line can take black in by the set and send it out by the
    // pair, and only pairs let the two meet.
    const byColour = colours.get(key) ?? new Map<string, number>();
    for (const entry of parseColorQty(movement.color_qty)) {
      const sign = movement.kind === "in" ? 1 : -1;
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
    line.color_pairs = byColour
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
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

// Wholesale stock is not a shop shelf, so "running low" is not the question anyone asks
// of it. Goods sit here for one of two reasons: a customer has already ordered them and
// they are waiting to go out, or nobody has claimed them and they are there to be sold to
// whoever wants them. An empty shelf is neither — it used to read as "for sale" just
// because nothing was allocated, which said the wrong thing next to a stock count of
// zero. That is what a line's status says.

export type StockPurpose = "waiting" | "for_sale" | "out_of_stock";

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

/** How much of what is on this shelf is already spoken for: whichever is smaller, the
 *  pairs customers are owed or the pairs actually here. Nothing can be promised twice,
 *  and an order for 3 sets does not claim the 40 sets standing beside them. */
export function allocatedPairs(
  line: StockLine,
  orders: CustomerOrder[],
): number {
  return Math.min(
    owedPairs(line.stock_code, orders),
    Math.max(0, line.in_stock),
  );
}

/** Whether this line is spoken for, free to sell, or simply not there. Allocated means
 *  every pair here is already promised to a customer; a line holding more than is owed
 *  still has stock anyone can buy, so it reads as available. Nothing on the shelf is its
 *  own state — it is not "available" just because nothing has claimed it. */
export function stockPurpose(
  line: StockLine,
  orders: CustomerOrder[],
): StockPurpose {
  if (line.in_stock <= 0) return "out_of_stock";
  return allocatedPairs(line, orders) >= line.in_stock ? "waiting" : "for_sale";
}

// ── Seed rows ────────────────────────────────────────────────────────────────
// What has already gone out to customers. Everything coming in is worked out from the
// receivings, so each of these matches goods the gate really counted, and each one is
// the reason the order it names shows what it shows as received.

export const SEED_OUTGOING: StockMovement[] = [
  {
    movement_id: "mv-out-1",
    kind: "out",
    stock_code: "A1001",
    description: "Men's leather sandal",
    group: "man",
    color_qty: "black2s",
    pairs: toPairs(2, "set"),
    location: "Bogyoke Rd, Mawlamyine",
    date: "2026-09-10",
    reference: "ORD-260902-0001",
    party: "Ma Su Su Hlaing",
    note: "Collected by the customer",
  },
  {
    movement_id: "mv-out-2",
    kind: "out",
    stock_code: "A1002",
    description: "Men's slipper",
    group: "man",
    color_qty: "white2s",
    pairs: toPairs(2, "set"),
    location: "Bogyoke Rd, Mawlamyine",
    date: "2026-09-10",
    reference: "ORD-260902-0001",
    party: "Ma Su Su Hlaing",
    note: "Collected with the sandals",
  },
  {
    movement_id: "mv-out-3",
    kind: "out",
    stock_code: "B2001",
    description: "Ladies' flat sandal",
    group: "lady",
    color_qty: "brown8s,black5s",
    pairs: toPairs(13, "set"),
    location: "Zay Gyi St, Magway",
    date: "2026-09-06",
    reference: "ORD-260905-0001",
    party: "Pone Pone",
    note: "Sent by bus",
  },
  {
    movement_id: "mv-out-4",
    kind: "out",
    stock_code: "A1001",
    description: "Men's leather sandal",
    group: "man",
    color_qty: "black6s",
    pairs: toPairs(6, "set"),
    location: "Bogyoke Rd, Mawlamyine",
    date: "2026-09-11",
    reference: "ORD-260910-0001",
    party: "Ma Kyi Phyu",
    note: "First part of the order",
  },
];
