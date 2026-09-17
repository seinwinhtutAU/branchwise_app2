// The receiving-gate half of the wholesale data model drawn in diagram/wholesale/erd.mmd:
// one delivery landing at one of our gates, and what was actually inside its packages.
//
// The gate does two jobs, in this order. First it writes down what is due to arrive: how
// many packages, and how many sets inside them. Then, as the packages reach the gate and
// are opened, it records what actually turned up — the products in each package and how
// many sets of each. Keeping those apart is the whole point: the first is what was
// promised, the second is what the business really has, and the gap between them is what
// anyone reading the page wants to see.
//
// The Receiving page now reads and writes the authoritative API. The seed rows remain
// only as a fallback for the wholesale screens that have not yet moved off the store.

import { sharePct } from "./shared";
import { PAIRS_PER, toPairs, type Unit, type UnitConversions } from "./units";
import { type ProductGroup } from "./products";

export type ReceivingStatus = "recorded" | "checking" | "checked" | "issue";

export const RECEIVING_STATUSES: ReceivingStatus[] = [
  "recorded",
  "checking",
  "checked",
  "issue",
];

/** One product found inside a package. A package rarely holds just one: a box packed at
 *  the factory can carry several stock codes together. */
export interface ReceivingItem {
  item_id: string;
  stock_code: string;
  /** What the product actually is, so a line reads as a shoe and not as a code. */
  description: string;
  /** Man, lady or child — the range the business thinks in. */
  product_group: ProductGroup;
  /** Colors and their counts as staff write them, e.g. "black10,pink10". */
  color_breakdown: string;
  /** How many, in whatever unit this box is counted in. */
  quantity: number;
  /** Normalized quantity used for stock calculations when this came from the API. */
  quantity_pairs?: number;
  unit: Unit;
  unit_conversions?: UnitConversions;
}

/** One physical box. A package nobody has opened yet has no contents recorded at all,
 *  which is not the same as a package holding nothing. */
export interface ReceivingPackage {
  package_id: string;
  package_no: number;
  opened: boolean;
  /** The day this particular package turned up. Packages of one delivery do not all
   *  arrive together — a few can follow a week later — so the date belongs to the
   *  package, not only to the delivery as a whole. Empty until it arrives. */
  received_on: string;
  items: ReceivingItem[];
  note: string;
}

/** Everything found in one package, in pairs — whatever units its products were counted
 *  in. Pairs are the one thing every screen agrees on. */
export function packagePairs(entry: ReceivingPackage): number {
  return entry.items.reduce(
    (sum, item) => sum + toPairs(item.quantity, item.unit, item.unit_conversions ?? PAIRS_PER),
    0,
  );
}

export function emptyItem(seed: string, unit: Unit = "set"): ReceivingItem {
  return {
    item_id: `ai-${seed}-${Math.random().toString(36).slice(2, 8)}`,
    stock_code: "",
    description: "",
    product_group: "man",
    color_breakdown: "",
    quantity: 0,
    unit,
    unit_conversions: PAIRS_PER,
  };
}

/** One charge against a delivery. Transport is not a single fee paid once. Money is spent
 *  the whole way along: the cargo company's own fee, a carrier between two towns, porters
 *  unloading at the gate. Each charge is written down on its own and says **where** it was
 *  spent, so the cost of a route can be read stage by stage instead of as one lump.
 *
 *  A charge belongs to the delivery as a whole, never to a package inside it: nobody pays
 *  a porter per box, and splitting one charge across boxes would invent a figure the
 *  business never agreed. */
export interface ReceivingCost {
  cost_id: string;
  /** The day this charge was paid or incurred. */
  cost_date: string;
  /** Where it was spent — the cargo company, one of the destinations, or the gate. */
  stage: string;
  /** Who was paid — the cargo company, the driver on that leg, the porters at the gate.
   *  Left empty for a charge with nobody to name: a gate fee, a permit, a fine. */
  carrier: string;
  /** What the money was for — carrier fee, porters, handling, a second trip. */
  kind: string;
  /** Always the Kyat amount, whatever currency this charge was actually paid in. */
  amount: number;
  /** "MMK" unless this charge was paid in a foreign currency — see ./currency.ts. */
  currency_code?: string;
  /** The amount before conversion, only present for a non-MMK currency_code. */
  original_amount?: number | null;
  /** The exchange rate this charge was saved at — a fixed snapshot, only present for a
   *  non-MMK currency_code. Never re-derived from "today's" rate after saving. */
  exchange_rate?: number | null;
  note: string;
}

/** The kinds of charge that come up often enough to offer. Anything else can be typed. */
export const COST_KINDS = [
  "Carrier fee",
  "Cargo fee",
  "Porters",
  "Gate handling",
  "Second trip",
  "Other",
];

export interface Receiving {
  receiving_id: string;
  receiving_no: string;
  shipment_id?: string;
  /** The shipment these packages came off. */
  shipment_no: string;
  voucher_no: string;
  supplier_name: string;
  /** The gate they landed at, as its short address. */
  gate: string;
  received_on: string;
  /** How many packages are due to arrive at the gate. */
  total_packages: number;
  /** Every charge this delivery has picked up. */
  costs: ReceivingCost[];
  /** How much is due inside those packages, from the supplier's voucher, in the unit the
   *  voucher is written in. What is received is checked against it in pairs, so the two
   *  can be compared even when they are counted differently. */
  total_quantity_pairs: number;
  total_unit: Unit;
  packages: ReceivingPackage[];
  allowed_actions?: string[];
  version_id?: number;
}

/** Everything this delivery has cost so far. */
export function totalCost(receiving: Receiving): number {
  return receiving.costs.reduce((sum, cost) => sum + cost.amount, 0);
}

export function emptyCost(
  seed: string,
  stage = "",
  cost_date = "",
): ReceivingCost {
  return {
    cost_id: `ac-${seed}-${Math.random().toString(36).slice(2, 8)}`,
    cost_date,
    stage,
    carrier: "",
    kind: "",
    amount: 0,
    note: "",
  };
}

/** What each stage of the journey has cost, in the order the packages passed through it.
 *  Stages with nothing spent on them are left out — an empty row says nothing. */
export function costByStage(
  receiving: Receiving,
  stages: string[],
): { stage: string; amount: number }[] {
  const totals = new Map<string, number>();
  for (const cost of receiving.costs) {
    const stage = cost.stage.trim() === "" ? "Not said where" : cost.stage;
    totals.set(stage, (totals.get(stage) ?? 0) + cost.amount);
  }
  const ordered = [...stages, "Not said where"].filter((stage) =>
    totals.has(stage),
  );
  const extras = [...totals.keys()].filter((stage) => !ordered.includes(stage));
  return [...ordered, ...extras].map((stage) => ({
    stage,
    amount: totals.get(stage) ?? 0,
  }));
}

export function openedCount(receiving: Receiving): number {
  return receiving.packages.filter((entry) => entry.opened).length;
}

/** Pairs actually found, across every package opened so far. */
export function countedPairs(receiving: Receiving): number {
  return receiving.packages.reduce(
    (sum, entry) => (entry.opened ? sum + packagePairs(entry) : sum),
    0,
  );
}

/** What the voucher says is coming, in pairs. */
export function expectedPairs(receiving: Receiving): number {
  return toPairs(receiving.total_quantity_pairs, receiving.total_unit);
}

export function pairsDifference(receiving: Receiving): number {
  return countedPairs(receiving) - expectedPairs(receiving);
}

export function checkedPct(receiving: Receiving): number {
  return sharePct(openedCount(receiving), receiving.packages.length);
}

/** expectedPackages is the shipment's own total_packages, when known — a receiving can
 *  grow box by box as more of them turn up, so every box added so far being open only
 *  means the count is final once "Received packages" has actually caught up with that.
 *  Short of that it still reads as "checking", the same as an unopened box would. */
export function receivingStatus(
  receiving: Receiving,
  expectedPackages?: number,
): ReceivingStatus {
  const opened = openedCount(receiving);
  if (opened === 0) return "recorded";
  if (opened < receiving.packages.length) return "checking";
  if (
    expectedPackages !== undefined &&
    receiving.total_packages < expectedPackages
  ) {
    return "checking";
  }
  return pairsDifference(receiving) === 0 ? "checked" : "issue";
}

/** Builds the empty package rows an receiving starts with — one per box off the truck,
 *  numbered, with nothing inside them yet. */
export function emptyPackages(count: number, seed: string): ReceivingPackage[] {
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({
    package_id: `ap-${seed}-${index + 1}`,
    package_no: index + 1,
    opened: false,
    received_on: "",
    items: [],
    note: "",
  }));
}

/** Keeps the package rows in step with the number of packages recorded: extra boxes gain
 *  empty rows, a lowered count drops the rows from the end, and anything already counted
 *  is left alone. */
export function resizePackages(
  packages: ReceivingPackage[],
  count: number,
  seed: string,
): ReceivingPackage[] {
  if (count === packages.length) return packages;
  if (count < packages.length) return packages.slice(0, Math.max(0, count));
  return [
    ...packages,
    ...emptyPackages(count - packages.length, seed).map((entry, index) => ({
      ...entry,
      package_id: `ap-${seed}-${packages.length + index + 1}`,
      package_no: packages.length + index + 1,
    })),
  ];
}

// ── Seed rows ────────────────────────────────────────────────────────────────
// Tied to the seeded shipments, so the three screens read as one business.

export const SEED_RECEIVINGS: Receiving[] = [
  {
    receiving_id: "ar-1",
    receiving_no: "RCV-260908-0001",
    shipment_no: "SHP-260827-0001",
    voucher_no: "VCH-260825-0001",
    supplier_name: "Goody Factory",
    gate: "Bogyoke Rd, Mawlamyine",
    received_on: "2026-09-08",
    total_packages: 7,
    costs: [
      {
        cost_id: "ac-1-1",
        cost_date: "2026-09-08",
        stage: "Shwe Moe Cargo",
        carrier: "Shwe Moe Cargo",
        kind: "Cargo fee",
        amount: 240000,
        note: "",
      },
      {
        cost_id: "ac-1-2",
        cost_date: "2026-09-08",
        stage: "Yangon",
        carrier: "U Hla Myint",
        kind: "Carrier fee",
        amount: 80000,
        note: "",
      },
      {
        cost_id: "ac-1-3",
        cost_date: "2026-09-08",
        stage: "Bogyoke Rd, Mawlamyine",
        carrier: "Gate porters",
        kind: "Porters",
        amount: 15000,
        note: "Four men, an hour",
      },
    ],
    total_quantity_pairs: 50,
    total_unit: "set",
    packages: [
      {
        package_id: "ap-1-1",
        package_no: 1,
        opened: true,
        received_on: "2026-09-08",
        items: [
          {
            item_id: "ai-1-1",
            stock_code: "A1001",
            description: "Men's leather sandal",
            product_group: "man",
            color_breakdown: "black3s",
            quantity: 3,
            unit: "set",
          },
          {
            item_id: "ai-1-2",
            stock_code: "A1002",
            description: "Men's slipper",
            product_group: "man",
            color_breakdown: "white1s",
            quantity: 1,
            unit: "set",
          },
        ],
        note: "",
      },
      {
        package_id: "ap-1-2",
        package_no: 2,
        opened: true,
        received_on: "2026-09-08",
        items: [
          {
            item_id: "ai-1-3",
            stock_code: "A1001",
            description: "Men's leather sandal",
            product_group: "man",
            color_breakdown: "black4s",
            quantity: 4,
            unit: "set",
          },
        ],
        note: "",
      },
      {
        package_id: "ap-1-3",
        package_no: 3,
        opened: true,
        received_on: "2026-09-11",
        items: [
          {
            item_id: "ai-1-4",
            stock_code: "A1002",
            description: "Men's slipper",
            product_group: "man",
            color_breakdown: "white2s",
            quantity: 2,
            unit: "set",
          },
          {
            item_id: "ai-1-5",
            stock_code: "A1001",
            description: "Men's leather sandal",
            product_group: "man",
            color_breakdown: "black2s",
            quantity: 2,
            unit: "set",
          },
        ],
        note: "",
      },
      {
        package_id: "ap-1-4",
        package_no: 4,
        opened: true,
        received_on: "2026-09-11",
        items: [
          {
            item_id: "ai-1-6",
            stock_code: "A1002",
            description: "Men's slipper",
            product_group: "man",
            color_breakdown: "white3s",
            quantity: 3,
            unit: "set",
          },
        ],
        note: "One set short",
      },
      {
        package_id: "ap-1-5",
        package_no: 5,
        opened: false,
        received_on: "",
        items: [],
        note: "",
      },
      {
        package_id: "ap-1-6",
        package_no: 6,
        opened: false,
        received_on: "",
        items: [],
        note: "",
      },
      {
        package_id: "ap-1-7",
        package_no: 7,
        opened: false,
        received_on: "",
        items: [],
        note: "",
      },
    ],
  },
  {
    receiving_id: "ar-2",
    receiving_no: "RCV-260904-0001",
    shipment_no: "SHP-260830-0001",
    voucher_no: "VCH-260828-0001",
    supplier_name: "Lek",
    gate: "Zay Gyi St, Magway",
    received_on: "2026-09-04",
    total_packages: 8,
    costs: [
      {
        cost_id: "ac-2-1",
        cost_date: "2026-09-04",
        stage: "Ayar Cargo",
        carrier: "Ayar Cargo",
        kind: "Cargo fee",
        amount: 280000,
        note: "",
      },
    ],
    total_quantity_pairs: 27,
    total_unit: "set",
    // Seven boxes of three sets and a last one of six: 27 sets, exactly what the voucher
    // promised, so this receiving reads as "all received".
    packages: Array.from({ length: 8 }, (_, index) => ({
      package_id: `ap-2-${index + 1}`,
      package_no: index + 1,
      opened: true,
      received_on: "2026-09-04",
      items: [
        {
          item_id: `ai-2-${index + 1}`,
          stock_code: "B2001",
          description: "Ladies' flat sandal",
          product_group: "lady",
          color_breakdown:
            index === 7 ? "brown6s" : index % 2 === 0 ? "brown3s" : "black3s",
          quantity: index === 7 ? 6 : 3,
          unit: "set",
        },
      ],
      note: "",
    })),
  },
  {
    receiving_id: "ar-3",
    receiving_no: "RCV-260909-0001",
    shipment_no: "SHP-260906-0001",
    voucher_no: "VCH-260905-0001",
    supplier_name: "Maldini",
    gate: "Bogyoke Rd, Mawlamyine",
    received_on: "2026-09-09",
    total_packages: 6,
    costs: [
      {
        cost_id: "ac-3-1",
        cost_date: "2026-09-09",
        stage: "Shwe Moe Cargo",
        carrier: "Shwe Moe Cargo",
        kind: "Cargo fee",
        amount: 150000,
        note: "",
      },
    ],
    total_quantity_pairs: 20,
    total_unit: "set",
    packages: emptyPackages(6, "3"),
  },
];
