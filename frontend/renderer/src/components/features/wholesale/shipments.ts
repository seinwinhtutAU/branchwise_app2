// The shipment half of the wholesale data model drawn in diagram/wholesale/erd.mmd: one
// supplier voucher travelling here as freight, and the stops it passes through on the way.
//
// The stops are the point of this screen. A shipment records how many packages the cargo
// company sent, then each stop records how many it received and how many it sent onward,
// so a package that goes missing between two towns is visible as a gap rather than a
// mystery at the end.
//
// Backed by /api/wholesale/shipments (see wholesale/api.ts and
// backend/app/services/wholesale/shipments.py, which ports every function below —
// normaliseFlow especially — so an edit is re-settled identically on the screen and on
// the server). SEED_SHIPMENTS below is only the store's initial value, shown for the
// instant before DeliveryPage's own fetch resolves and replaces it with the real rows;
// it is not what anyone edits any more.

import { sharePct } from "./shared";
import { toPairs, type Unit } from "./units";

export type ShipmentStatus =
  "waiting_at_cargo" | "in_transit" | "partly_delivered" | "completed";

export const SHIPMENT_STATUSES: ShipmentStatus[] = [
  "waiting_at_cargo",
  "in_transit",
  "partly_delivered",
  "completed",
];

/** One stop on the way here — the ERD's shipment_leg. */
export interface ShipmentLeg {
  leg_id: string;
  leg_order: number;
  stop_name: string;
  carrier_name: string;
  packages_received: number;
  packages_sent: number;
  lost_packages?: number;
}

export interface Shipment {
  shipment_id: string;
  shipment_no: string;
  /** Which supplier voucher is travelling as this shipment. */
  voucher_no: string;
  supplier_name: string;
  carrier_name: string;
  /** The receiving gate the shipment lands at — one of our own places, named, because
   *  "here" means a different town depending on which shipment you are looking at. This
   *  is where the voucher's goods are received and counted, and the last place they sit
   *  before going out to customers. Gate and warehouse are the same building, so it is
   *  simply the town. */
  final_destination: string;
  sent_on: string;
  total_packages: number;
  /** What is inside those packages — the supplier's own count of the goods, alongside
   *  the count of boxes they travel in, in whatever unit the voucher is written in. */
  total_quantity_pairs: number;
  total_unit: Unit;
  packages_sent_by_cargo: number;
  final_received_packages: number;
  lost_packages?: number;
  final_lost_packages?: number;
  /** Set when this shipment was carved out of another one's still-undispatched
   *  remainder (see the Split shipment action) — null for an ordinary shipment. */
  split_from_shipment_id?: string | null;
  allowed_actions?: string[];
  version_id?: number;
  legs: ShipmentLeg[];
}

/** Packages the cargo company still has not sent. */
/** The goods on this shipment, in pairs. */
export function shipmentPairs(shipment: Shipment): number {
  return toPairs(shipment.total_quantity_pairs, shipment.total_unit);
}

export function cargoRemaining(shipment: Shipment): number {
  return Math.max(0, shipment.total_packages - shipment.packages_sent_by_cargo);
}

/** The most a stop could have received — whatever the place before it sent on. */
export function maxForLeg(shipment: Shipment, index: number): number {
  return index === 0
    ? shipment.packages_sent_by_cargo
    : shipment.legs[index - 1].packages_sent;
}

/** What a stop still owes the rest of the journey: everything sent to it, less what it
 *  has sent on.
 *
 *  Measured against what was sent to it, not against what it happens to have received.
 *  If the cargo company sends 10 to Yangon, only 7 turn up there and Yangon forwards all
 *  7, Yangon is not finished: 3 are somewhere between the two and are still owed. Taking
 *  received less sent would call that stop clear, which is the one thing this screen
 *  exists to notice. Same rule as the gate at the end of the route. */
export function legRemaining(shipment: Shipment, index: number): number {
  return Math.max(
    0,
    maxForLeg(shipment, index) - shipment.legs[index].packages_sent - (shipment.legs[index].lost_packages ?? 0),
  );
}

/** What is heading to us: the last stop's send, or the cargo's if there are no stops. */
export function intoFinal(shipment: Shipment): number {
  const legs = shipment.legs;
  return legs.length > 0
    ? legs[legs.length - 1].packages_sent
    : shipment.packages_sent_by_cargo;
}

/** Packages of this shipment that have still not reached us.
 *
 *  Measured against everything the shipment set out with, not against what the last stop
 *  happened to send on. If 10 leave the supplier, 10 reach Yangon and Yangon forwards 7,
 *  then 7 arriving here is not the end of it: 3 are still sitting in Yangon and are still
 *  owed. Comparing against the last hand-over would call that shipment finished. */
export function finalRemaining(shipment: Shipment): number {
  return Math.max(
    0,
    shipment.total_packages - shipment.final_received_packages - (shipment.lost_packages ?? 0),
  );
}

export function shipmentStatus(shipment: Shipment): ShipmentStatus {
  if (shipment.packages_sent_by_cargo <= 0) return "waiting_at_cargo";
  if (
    shipment.total_packages > 0 &&
    shipment.final_received_packages + (shipment.lost_packages ?? 0) >= shipment.total_packages
  ) {
    return "completed";
  }
  if (shipment.final_received_packages > 0) return "partly_delivered";
  return "in_transit";
}

/** Re-settles the whole chain after a destination is added or removed. A stop can only
 *  hold what the stop before it sent on, so taking one out of the middle can leave the
 *  next one holding more than now reaches it; this walks the route and trims each figure
 *  down to what is actually possible, rather than leaving impossible numbers on screen. */
export function normaliseFlow(shipment: Shipment): Shipment {
  let available = Math.min(
    shipment.packages_sent_by_cargo,
    shipment.total_packages,
  );
  const legs = shipment.legs.map((leg, index) => {
    const received = Math.min(leg.packages_received, available);
    const sent = Math.min(leg.packages_sent, received);
    available = sent;
    return {
      ...leg,
      leg_order: index + 1,
      packages_received: received,
      packages_sent: sent,
    };
  });
  return {
    ...shipment,
    packages_sent_by_cargo: Math.min(
      shipment.packages_sent_by_cargo,
      shipment.total_packages,
    ),
    legs,
    final_received_packages: Math.min(
      shipment.final_received_packages,
      available,
    ),
  };
}

/** Every place the packages arrive at on the way here: the cargo company, each stop in
 *  between, and our own place at the end. The supplier is not counted — that is where
 *  the goods start out, not somewhere they are delivered to. */
export function destinationCount(shipment: Shipment): number {
  return shipment.legs.length + 2;
}

export function arrivedPct(shipment: Shipment): number {
  return sharePct(
    shipment.final_received_packages + (shipment.lost_packages ?? 0),
    shipment.total_packages,
  );
}

// ── Seed rows ────────────────────────────────────────────────────────────────
// Voucher numbers and suppliers match the seeded supplier vouchers, so the two screens
// read as one business rather than two unrelated demos.

export const SEED_SHIPMENTS: Shipment[] = [
  {
    shipment_id: "sh-1",
    shipment_no: "SHP-260827-0001",
    voucher_no: "VCH-260825-0001",
    supplier_name: "Goody Factory",
    carrier_name: "Shwe Moe Cargo",
    final_destination: "Bogyoke Rd, Mawlamyine",
    sent_on: "2026-08-27",
    total_packages: 10,
    total_quantity_pairs: 50,
    total_unit: "set",
    packages_sent_by_cargo: 10,
    final_received_packages: 7,
    legs: [
      {
        leg_id: "sl-1",
        leg_order: 1,
        stop_name: "Yangon",
        carrier_name: "U Hla Myint",
        packages_received: 10,
        packages_sent: 7,
      },
    ],
  },
  {
    shipment_id: "sh-2",
    shipment_no: "SHP-260830-0001",
    voucher_no: "VCH-260828-0001",
    supplier_name: "Lek",
    carrier_name: "Ayar Cargo",
    final_destination: "Zay Gyi St, Magway",
    sent_on: "2026-08-30",
    total_packages: 8,
    total_quantity_pairs: 27,
    total_unit: "set",
    packages_sent_by_cargo: 8,
    final_received_packages: 8,
    legs: [
      {
        leg_id: "sl-2",
        leg_order: 1,
        stop_name: "Yangon",
        carrier_name: "Ko Zaw Lin",
        packages_received: 8,
        packages_sent: 8,
      },
    ],
  },
  {
    shipment_id: "sh-3",
    shipment_no: "SHP-260903-0001",
    voucher_no: "VCH-260901-0001",
    supplier_name: "Panda Shoes",
    carrier_name: "Tiger Cargo",
    final_destination: "Zay Gyi St, Magway",
    sent_on: "2026-09-03",
    total_packages: 20,
    total_quantity_pairs: 66,
    total_unit: "set",
    packages_sent_by_cargo: 0,
    final_received_packages: 0,
    legs: [],
  },
  {
    shipment_id: "sh-4",
    shipment_no: "SHP-260906-0001",
    voucher_no: "VCH-260905-0001",
    supplier_name: "Maldini",
    carrier_name: "Shwe Moe Cargo",
    final_destination: "Bogyoke Rd, Mawlamyine",
    sent_on: "2026-09-06",
    total_packages: 6,
    total_quantity_pairs: 20,
    total_unit: "set",
    packages_sent_by_cargo: 6,
    final_received_packages: 6,
    legs: [
      {
        leg_id: "sl-3",
        leg_order: 1,
        stop_name: "Yangon",
        carrier_name: "Ma Khin Khin",
        packages_received: 6,
        packages_sent: 6,
      },
    ],
  },
];

/** The places shipments normally pass through on the way. */
/** Our own receiving gates, as the short address staff would write on a delivery note.
 *  A town is not enough — a town can hold more than one gate. Goods are received and
 *  stored in the same building, so this is the whole of a gate's identity. */
/** The local drivers and agents who move packages between stops. */
