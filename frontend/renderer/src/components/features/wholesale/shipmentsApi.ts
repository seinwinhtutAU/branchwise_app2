// The Delivery screen's writes: creating a shipment with its legs, updating either, a
// write-off, and splitting cargo onto a second shipment.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { request } from "./apiClient";
import { type Shipment, type ShipmentLeg } from "./shipments";
import { fromPairs, toPairs, type UnitConversions } from "./units";

// ── Shipments ──────────────────────────────────────────────────────────────

interface ShipmentLegWire {
  stop_name: string;
  carrier_name: string;
  packages_received: number;
  packages_sent: number;
  lost_packages?: number;
}

export interface ShipmentWire {
  shipment_id: string;
  branch_id: string | null;
  shipment_no: string;
  voucher_no: string;
  supplier_name: string;
  carrier_name: string;
  final_destination: string;
  sent_on: string;
  total_packages: number;
  total_quantity_pairs: number;
  total_unit: string;
  packages_sent_by_cargo: number;
  final_received_packages: number;
  lost_packages?: number;
  final_lost_packages?: number;
  split_from_shipment_id?: string | null;
  allowed_actions?: string[];
  version_id?: number;
  legs: (ShipmentLegWire & { leg_id: string; leg_order: number })[];
}

export const SHIPMENTS_URL = `${apiBaseUrl}/api/wholesale/shipments`;


/** The wire shape uses total_quantity_pairs (what the server actually stores); the screens still
 *  say total_quantity_pairs (what it was written in), converted here at the one seam rather than
 *  renamed through every call site. */
export function shipmentFromWire(wire: ShipmentWire): Shipment {
  return {
    shipment_id: wire.shipment_id,
    shipment_no: wire.shipment_no,
    voucher_no: wire.voucher_no,
    supplier_name: wire.supplier_name,
    carrier_name: wire.carrier_name,
    final_destination: wire.final_destination,
    sent_on: wire.sent_on,
    total_packages: wire.total_packages,
    // Shipment responses carry the normalized pair total; the screen model stores the
    // value in the shipment's displayed unit and converts it back at the one seam.
    total_quantity_pairs: fromPairs(
      wire.total_quantity_pairs,
      wire.total_unit as Shipment["total_unit"],
    ),
    total_unit: wire.total_unit as Shipment["total_unit"],
    packages_sent_by_cargo: wire.packages_sent_by_cargo,
    final_received_packages: wire.final_received_packages,
    lost_packages: wire.lost_packages ?? 0,
    final_lost_packages: wire.final_lost_packages ?? 0,
    split_from_shipment_id: wire.split_from_shipment_id ?? null,
    allowed_actions: wire.allowed_actions ?? [],
    version_id: wire.version_id ?? 1,
    legs: wire.legs.map((leg) => ({
      leg_id: leg.leg_id,
      leg_order: leg.leg_order,
      stop_name: leg.stop_name,
      carrier_name: leg.carrier_name,
      packages_received: leg.packages_received,
      packages_sent: leg.packages_sent,
      lost_packages: leg.lost_packages ?? 0,
    })),
  };
}

function legToWire(leg: ShipmentLeg): ShipmentLegWire {
  return {
    stop_name: leg.stop_name,
    carrier_name: leg.carrier_name,
    packages_received: leg.packages_received,
    packages_sent: leg.packages_sent,
  };
}

export interface NewShipmentInput {
  voucher_no: string;
  supplier_name: string;
  carrier_name: string;
  final_destination: string;
  sent_on: string;
  total_packages: number;
  /** Quantity in `total_unit`; converted to the API's canonical pairs on write. */
  total_quantity_pairs: number;
  total_unit: Shipment["total_unit"];
  packages_sent_by_cargo: number;
  final_received_packages: number;
  legs: ShipmentLeg[];
}

export function shipmentsFromWire(wires: ShipmentWire[]): Shipment[] {
  return wires.map(shipmentFromWire);
}

export async function createShipment(
  session: Session,
  input: NewShipmentInput,
): Promise<Shipment> {
  const wire = await request<ShipmentWire>(
    session,
    "/api/wholesale/shipments",
    {
      method: "POST",
      body: {
        voucher_no: input.voucher_no,
        supplier_name: input.supplier_name,
        carrier_name: input.carrier_name,
        final_destination: input.final_destination,
        sent_on: input.sent_on,
        total_packages: input.total_packages,
        // Shipment form values are kept in the unit the user selected. The API stores
        // this field in pairs, just as the receiving endpoints do below.
        total_quantity_pairs: toPairs(
          input.total_quantity_pairs,
          input.total_unit,
        ),
        total_unit: input.total_unit,
        packages_sent_by_cargo: input.packages_sent_by_cargo,
        final_received_packages: input.final_received_packages,
        legs: input.legs.map(legToWire),
      },
    },
  );
  return shipmentFromWire(wire);
}

export async function updateShipment(
  session: Session,
  shipmentId: string,
  patch: Partial<Shipment> & Pick<Shipment, "total_unit">,
): Promise<Shipment> {
  const body: Record<string, unknown> = {};
  if (patch.voucher_no !== undefined) body.voucher_no = patch.voucher_no;
  if (patch.supplier_name !== undefined)
    body.supplier_name = patch.supplier_name;
  if (patch.carrier_name !== undefined) body.carrier_name = patch.carrier_name;
  if (patch.final_destination !== undefined)
    body.final_destination = patch.final_destination;
  if (patch.sent_on !== undefined) body.sent_on = patch.sent_on;
  if (patch.total_packages !== undefined)
    body.total_packages = patch.total_packages;
  if (patch.total_quantity_pairs !== undefined)
    body.total_quantity_pairs = toPairs(
      patch.total_quantity_pairs,
      patch.total_unit,
    );
  if (patch.total_unit !== undefined) body.total_unit = patch.total_unit;
  if (patch.packages_sent_by_cargo !== undefined)
    body.packages_sent_by_cargo = patch.packages_sent_by_cargo;
  if (patch.final_received_packages !== undefined)
    body.final_received_packages = patch.final_received_packages;
  if (patch.legs !== undefined) body.legs = patch.legs.map(legToWire);

  const wire = await request<ShipmentWire>(
    session,
    `/api/wholesale/shipments/${shipmentId}`,
    { method: "PATCH", body },
  );
  return shipmentFromWire(wire);
}

export async function deleteShipment(
  session: Session,
  shipmentId: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/shipments/${shipmentId}`, {
    method: "DELETE",
  });
}

export type WriteOffReason =
  "lost_in_transit" | "damaged" | "short_shipped" | "other" | "repackaged";

export interface WriteOffInput {
  quantity: number;
  reason: WriteOffReason;
  note: string;
}

export interface WriteOffWire extends WriteOffInput {
  write_off_id: string;
  branch_id: string | null;
  subject_type: "shipment" | "shipment_leg" | "voucher_line" | "order_line";
  subject_id: string;
  reference: string;
  description: string;
  stock_code: string;
  unit: string;
  unit_conversions?: UnitConversions;
  recorded_by_user_id: string;
  created_at: string;
}

export async function writeOffShipment(
  session: Session,
  shipmentId: string,
  input: WriteOffInput & { leg_id?: string },
): Promise<WriteOffWire> {
  return request<WriteOffWire>(
    session,
    `/api/wholesale/shipments/${shipmentId}/write-off`,
    { method: "POST", body: input },
  );
}

export interface SplitShipmentInput {
  packages: number;
  /** Real pairs, already converted — same convention as NewShipmentInput.total_quantity_pairs.
   *  Optional: what's actually inside a box isn't known for certain until it's opened
   *  and counted at the receiving gate, so a split doesn't have to guess at it. Left
   *  out, the new shipment starts at 0 and the original's own total is untouched. */
  quantity_pairs?: number;
  final_destination: string;
  carrier_name: string;
  /** Which stop the split is carved out of: undefined means the cargo company's own
   *  still-undispatched packages; a 1-based leg_order instead names a stop further
   *  along the route whose own leftover is being redirected. */
  split_leg_order?: number;
}

export interface SplitShipmentResult {
  original: Shipment;
  newShipment: Shipment;
}

/** Carves part of a shipment's still-undispatched remainder into a shipment of its
 *  own — see app/services/wholesale_shipments.py::split_shipment. Both the reduced
 *  original and the new shipment come back from the one call, since the server changes
 *  them together in one transaction. */
export async function splitShipment(
  session: Session,
  shipmentId: string,
  input: SplitShipmentInput,
): Promise<SplitShipmentResult> {
  const wire = await request<{
    original: ShipmentWire;
    new_shipment: ShipmentWire;
  }>(session, `/api/wholesale/shipments/${shipmentId}/split`, {
    method: "POST",
    body: input,
  });
  return {
    original: shipmentFromWire(wire.original),
    newShipment: shipmentFromWire(wire.new_shipment),
  };
}

