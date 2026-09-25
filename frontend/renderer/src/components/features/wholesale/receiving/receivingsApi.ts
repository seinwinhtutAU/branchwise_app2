// The Receiving screen's writes: recording a receiving, updating it, checking a package,
// replacing its staged costs, and deleting it.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { request } from "../shared/apiClient";
import {
  type Receiving,
  type ReceivingCost,
  type ReceivingPackage,
} from "./receivings";
import { fromPairs, PAIRS_PER, type UnitConversions } from "../shared/units";


interface ReceivingItemWire {
  item_id: string;
  stock_code: string;
  description: string;
  product_group: "man" | "lady" | "child";
  color_breakdown: string;
  quantity: number;
  unit: Receiving["total_unit"];
  unit_conversions: UnitConversions;
  quantity_pairs: number;
}

interface ReceivingPackageWire {
  package_id: string;
  package_no: number;
  opened: boolean;
  received_on: string | null;
  note: string;
  items: ReceivingItemWire[];
}

interface ReceivingCostWire {
  cost_id: string;
  cost_date: string;
  stage: string;
  carrier: string;
  kind: string;
  amount: number;
  currency_code: string;
  original_amount: number | null;
  exchange_rate: number | null;
  note: string;
}

export interface ReceivingWire {
  receiving_id: string;
  receiving_no: string;
  shipment_id: string;
  shipment_no: string;
  voucher_no: string;
  supplier_name: string;
  gate: string;
  received_on: string;
  total_packages: number;
  total_quantity_pairs: number;
  total_unit: Receiving["total_unit"];
  packages: ReceivingPackageWire[];
  costs: ReceivingCostWire[];
}

export const RECEIVINGS_URL = `${apiBaseUrl}/api/wholesale/receivings`;

function packageFromWire(wire: ReceivingPackageWire): ReceivingPackage {
  return {
    package_id: wire.package_id,
    package_no: wire.package_no,
    opened: wire.opened,
    received_on: wire.received_on ?? "",
    note: wire.note,
    items: wire.items.map((item) => ({
      item_id: item.item_id,
      stock_code: item.stock_code,
      description: item.description,
      product_group: item.product_group,
      color_breakdown: item.color_breakdown,
      quantity: item.quantity,
      quantity_pairs: item.quantity_pairs,
      unit: item.unit,
      unit_conversions: item.unit_conversions ?? PAIRS_PER,
    })),
  };
}

function receivingFromWire(wire: ReceivingWire): Receiving {
  return {
    receiving_id: wire.receiving_id,
    receiving_no: wire.receiving_no,
    shipment_no: wire.shipment_no,
    voucher_no: wire.voucher_no,
    supplier_name: wire.supplier_name,
    gate: wire.gate,
    received_on: wire.received_on,
    total_packages: wire.total_packages,
    total_quantity_pairs: fromPairs(wire.total_quantity_pairs, wire.total_unit),
    total_unit: wire.total_unit,
    packages: wire.packages.map(packageFromWire),
    costs: wire.costs,
  };
}

export function receivingsFromWire(wires: ReceivingWire[]): Receiving[] {
  return wires.map(receivingFromWire);
}

export interface NewReceivingInput {
  shipment_id: string;
  gate: string;
  received_on: string;
  total_packages: number;
  total_quantity_pairs: number;
  total_unit: Receiving["total_unit"];
  costs: ReceivingCost[];
}

function packageToWire(entry: ReceivingPackage): {
  opened: boolean;
  received_on: string | null;
  note: string;
  items: {
    stock_code: string;
    description: string;
    product_group: "man" | "lady" | "child";
    color_breakdown: string;
    quantity: number;
    unit: Receiving["total_unit"];
    unit_conversions: UnitConversions;
  }[];
} {
  return {
    opened: entry.opened,
    received_on: entry.received_on || null,
    note: entry.note,
    items: entry.items.map((item) => ({
      stock_code: item.stock_code,
      description: item.description,
      product_group: item.product_group,
      color_breakdown: item.color_breakdown,
      quantity: item.quantity,
      unit: item.unit,
      unit_conversions: item.unit_conversions ?? PAIRS_PER,
    })),
  };
}

function costsToWire(costs: ReceivingCost[]): {
  cost_date: string;
  stage: string;
  carrier: string;
  kind: string;
  currency_code: string;
  amount: number;
  original_amount: number | null;
  exchange_rate: number | null;
  note: string;
}[] {
  return costs.map(
    ({
      cost_date,
      stage,
      carrier,
      kind,
      currency_code,
      amount,
      original_amount,
      exchange_rate,
      note,
    }) => ({
      cost_date,
      stage,
      carrier,
      kind,
      currency_code: currency_code ?? "MMK",
      amount,
      original_amount: original_amount ?? null,
      exchange_rate: exchange_rate ?? null,
      note,
    }),
  );
}

export async function createReceiving(
  session: Session,
  input: NewReceivingInput,
): Promise<Receiving> {
  const wire = await request<ReceivingWire>(
    session,
    "/api/wholesale/receivings",
    {
      method: "POST",
      body: {
        shipment_id: input.shipment_id,
        gate: input.gate,
        received_on: input.received_on,
        total_packages: input.total_packages,
        total_quantity_pairs:
          input.total_quantity_pairs * PAIRS_PER[input.total_unit],
        total_unit: input.total_unit,
      },
    },
  );
  if (input.costs.length > 0)
    await replaceReceivingCosts(session, wire.receiving_id, input.costs);
  return receivingFromWire(wire);
}

export async function updateReceiving(
  session: Session,
  receivingId: string,
  patch: Pick<
    Receiving,
    | "gate"
    | "received_on"
    | "total_packages"
    | "total_quantity_pairs"
    | "total_unit"
  >,
): Promise<Receiving> {
  const wire = await request<ReceivingWire>(
    session,
    `/api/wholesale/receivings/${receivingId}`,
    {
      method: "PATCH",
      body: {
        ...patch,
        total_quantity_pairs:
          patch.total_quantity_pairs * PAIRS_PER[patch.total_unit],
      },
    },
  );
  return receivingFromWire(wire);
}

export async function updateReceivingPackage(
  session: Session,
  receivingId: string,
  entry: ReceivingPackage,
): Promise<Receiving> {
  const wire = await request<ReceivingWire>(
    session,
    `/api/wholesale/receivings/${receivingId}/packages/${entry.package_id}`,
    { method: "PATCH", body: packageToWire(entry) },
  );
  return receivingFromWire(wire);
}

export async function replaceReceivingCosts(
  session: Session,
  receivingId: string,
  costs: ReceivingCost[],
): Promise<Receiving> {
  const wire = await request<ReceivingWire>(
    session,
    `/api/wholesale/receivings/${receivingId}/costs`,
    { method: "PUT", body: costsToWire(costs) },
  );
  return receivingFromWire(wire);
}

export async function deleteReceiving(
  session: Session,
  receivingId: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/receivings/${receivingId}`, {
    method: "DELETE",
  });
}

