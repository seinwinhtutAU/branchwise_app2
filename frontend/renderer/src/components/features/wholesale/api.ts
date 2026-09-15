// The one place every wholesale screen talks to the real backend from. A write here is
// never retried automatically — lib/network.ts only retries reads, since a write that
// timed out may already have been applied — so a timeout is reported as "reload to see
// whether it saved" rather than silently sent again.
//
// Reads go through React Query (see each page's useQuery/useQueries call), which already
// knows how to retry, and wraps the same apiBaseUrl. This file is deliberately just the
// write side plus the per-entity request/response shapes, since a read is one line at
// the call site.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { RequestTimeoutError } from "@renderer/lib/network";
import { invalidateEverything } from "@renderer/lib/queryClient";
import { type Shipment, type ShipmentLeg } from "./shipments";
import {
  type Receiving,
  type ReceivingCost,
  type ReceivingPackage,
} from "./receivings";
import { type SupplierVoucher } from "./supplierVouchers";
import { type AllocationEvent, type CustomerOrder } from "./customerOrders";
import { type StockMovement, type StockRecord } from "./stock";
import {
  fromPairs,
  PAIRS_PER,
  toPairs,
  type Unit,
  type UnitConversions,
} from "./units";
import { type Product } from "./products";

export class WholesaleApiError extends Error {}

/** Every write funnels through here: the Bearer header, the body, reading FastAPI's
 *  `detail` as the message on a non-2xx response, and turning a network timeout into a
 *  message that tells the truth — the write may or may not have gone through. Callers
 *  never see a raw fetch. */
async function request<T>(
  session: Session,
  path: string,
  init: { method: "POST" | "PATCH" | "PUT" | "DELETE"; body?: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: init.method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch (error) {
    if (error instanceof RequestTimeoutError) {
      throw new WholesaleApiError(
        "The connection timed out. Reload the page to see whether this was saved before trying again — sending it twice could duplicate it.",
      );
    }
    throw new WholesaleApiError(
      "Could not reach the server — check the connection and try again.",
    );
  }

  if (response.status === 204) {
    invalidateEverything();
    return undefined as T;
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new WholesaleApiError(
      body?.detail ?? `Request failed: ${response.status}`,
    );
  }

  invalidateEverything();
  return body as T;
}
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
  legs: (ShipmentLegWire & { leg_id: string; leg_order: number })[];
}

export const SHIPMENTS_URL = `${apiBaseUrl}/api/wholesale/shipments`;

export interface MonitoringCount<T> {
  count: number;
  rows: T[];
}

export interface MonitoringShipmentRow {
  shipment_id: string;
  shipment_no: string;
  supplier_name: string;
  sent_on: string;
  days_in_transit: number;
  shipment_status: string;
}

export interface MonitoringOrderRow {
  order_id: string;
  order_no: string;
  customer_name: string;
  order_status?: string;
  order_date: string;
  days_open?: number;
  balance_due?: number;
}

export interface MonitoringVoucherRow {
  voucher_id: string;
  voucher_no: string;
  supplier_name: string;
  balance_due: number;
  voucher_date: string;
}

export interface MonitoringProductRow {
  product_id: string;
  stock_code: string;
  description: string;
  product_group: string;
  stock_status: "not_arrived" | "out_of_stock";
}

export interface MonitoringActivityRow {
  activity_id: string;
  type: "receiving" | "delivery" | "payment";
  created_at: string;
  receiving_id?: string;
  receiving_no?: string;
  supplier_name?: string;
  shipment_no?: string;
  delivery_id?: string;
  order_id?: string;
  order_no?: string;
  customer_name?: string;
  stock_code?: string;
  quantity_pairs?: number;
  payment_id?: string;
  amount?: number;
  paid_on?: string;
  voucher_id?: string;
  voucher_no?: string | null;
}

export interface MonitoringSnapshot {
  shipments_in_transit: MonitoringCount<MonitoringShipmentRow>;
  orders_pending: MonitoringCount<MonitoringOrderRow>;
  unpaid_vouchers: MonitoringCount<MonitoringVoucherRow>;
  unpaid_orders: MonitoringCount<MonitoringOrderRow>;
  zero_stock_products: MonitoringCount<MonitoringProductRow>;
  recent_activity: MonitoringActivityRow[];
}

export const WHOLESALE_MONITORING_URL = `${apiBaseUrl}/api/wholesale/monitoring`;

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
  /** Real pairs, already converted — same convention as NewShipmentInput.total_quantity_pairs. */
  quantity_pairs: number;
  final_destination: string;
  carrier_name: string;
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

// ── Global wholesale master data ───────────────────────────────────────────

export interface WholesaleProductWire {
  product_id: string;
  stock_code: string;
  description: string;
  product_group: Product["product_group"];
  default_unit: Unit;
  default_unit_conversions: UnitConversions;
  active: boolean;
}

export interface WholesaleCustomerWire {
  customer_id: string;
  name: string;
  phone: string;
  address: string;
  active: boolean;
}

export interface WholesaleNamedEntityWire {
  name: string;
  active: boolean;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export const WHOLESALE_PRODUCTS_URL = `${apiBaseUrl}/api/wholesale/products`;
export const SUPPLIERS_URL = `${apiBaseUrl}/api/wholesale/suppliers`;
export const CUSTOMERS_URL = `${apiBaseUrl}/api/wholesale/customers`;
export const CARGO_COMPANIES_URL = `${apiBaseUrl}/api/wholesale/cargo-companies`;
export const CARRIERS_URL = `${apiBaseUrl}/api/wholesale/carriers`;
export const DESTINATIONS_URL = `${apiBaseUrl}/api/wholesale/destinations`;
export const RECEIVING_GATES_URL = `${apiBaseUrl}/api/wholesale/receiving-gates`;

export function productsFromWire(wires: WholesaleProductWire[]): Product[] {
  return wires
    .filter((wire) => wire.active)
    .map(
      ({
        stock_code,
        description,
        product_group,
        default_unit,
        default_unit_conversions,
      }) => ({
        stock_code,
        description,
        product_group,
        default_unit,
        default_unit_conversions,
      }),
    );
}

export function customersFromWire(
  wires: WholesaleCustomerWire[],
): Array<{ name: string; phone: string; address: string }> {
  return wires
    .filter((wire) => wire.active)
    .map(({ name, phone, address }) => ({ name, phone, address }));
}

export function namedEntitiesFromWire(
  wires: WholesaleNamedEntityWire[],
): string[] {
  return wires.filter((wire) => wire.active).map((wire) => wire.name);
}

export interface NewWholesaleProductInput {
  stock_code: string;
  description: string;
  product_group: Product["product_group"];
  default_unit?: Unit;
  default_unit_conversions?: UnitConversions;
}

export async function createWholesaleProduct(
  session: Session,
  input: NewWholesaleProductInput,
): Promise<WholesaleProductWire> {
  return request<WholesaleProductWire>(session, "/api/wholesale/products", {
    method: "POST",
    body: input,
  });
}

export async function updateWholesaleProduct(
  session: Session,
  id: string,
  patch: Partial<NewWholesaleProductInput> & { active?: boolean },
): Promise<WholesaleProductWire> {
  return request<WholesaleProductWire>(
    session,
    `/api/wholesale/products/${id}`,
    { method: "PATCH", body: patch },
  );
}

export async function deleteWholesaleProduct(
  session: Session,
  id: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/products/${id}`, {
    method: "DELETE",
  });
}

export interface NewWholesaleSupplierInput {
  name: string;
  phone: string;
  address: string;
}
export interface NewWholesaleCustomerInput {
  name: string;
  phone: string;
  address: string;
}
export interface NewWholesaleNamedEntityInput {
  name: string;
}

export async function createWholesaleSupplier(
  session: Session,
  input: NewWholesaleSupplierInput,
): Promise<WholesaleNamedEntityWire> {
  return request<WholesaleNamedEntityWire>(
    session,
    "/api/wholesale/suppliers",
    { method: "POST", body: input },
  );
}
export async function updateWholesaleSupplier(
  session: Session,
  id: string,
  patch: Partial<NewWholesaleSupplierInput> & { active?: boolean },
): Promise<WholesaleNamedEntityWire> {
  return request<WholesaleNamedEntityWire>(
    session,
    `/api/wholesale/suppliers/${id}`,
    { method: "PATCH", body: patch },
  );
}
export async function deleteWholesaleSupplier(
  session: Session,
  id: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/suppliers/${id}`, {
    method: "DELETE",
  });
}
export async function createWholesaleCustomer(
  session: Session,
  input: NewWholesaleCustomerInput,
): Promise<WholesaleCustomerWire> {
  return request<WholesaleCustomerWire>(session, "/api/wholesale/customers", {
    method: "POST",
    body: input,
  });
}
export async function updateWholesaleCustomer(
  session: Session,
  id: string,
  patch: Partial<NewWholesaleCustomerInput> & { active?: boolean },
): Promise<WholesaleCustomerWire> {
  return request<WholesaleCustomerWire>(
    session,
    `/api/wholesale/customers/${id}`,
    { method: "PATCH", body: patch },
  );
}
export async function deleteWholesaleCustomer(
  session: Session,
  id: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/customers/${id}`, {
    method: "DELETE",
  });
}

export async function createWholesaleNamedEntity(
  session: Session,
  path: string,
  input: NewWholesaleNamedEntityInput,
): Promise<WholesaleNamedEntityWire> {
  return request<WholesaleNamedEntityWire>(session, `/api/wholesale/${path}`, {
    method: "POST",
    body: input,
  });
}
export async function updateWholesaleNamedEntity(
  session: Session,
  path: string,
  id: string,
  patch: Partial<NewWholesaleNamedEntityInput> & { active?: boolean },
): Promise<WholesaleNamedEntityWire> {
  return request<WholesaleNamedEntityWire>(
    session,
    `/api/wholesale/${path}/${id}`,
    { method: "PATCH", body: patch },
  );
}
export async function deleteWholesaleNamedEntity(
  session: Session,
  path: string,
  id: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/${path}/${id}`, {
    method: "DELETE",
  });
}

// ── Receivings ─────────────────────────────────────────────────────────────

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

export function receivingFromWire(wire: ReceivingWire): Receiving {
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

// ── Supplier vouchers ──────────────────────────────────────────────────────

export interface SupplierVoucherWire extends SupplierVoucher {}
export const SUPPLIER_VOUCHERS_URL = `${apiBaseUrl}/api/wholesale/supplier-vouchers`;

export function vouchersFromWire(
  wires: SupplierVoucherWire[],
): SupplierVoucher[] {
  return wires;
}

export interface NewSupplierVoucherInput {
  supplier_name: string;
  voucher_date: string;
  carrier_name: string;
  total_packages: number;
  lines: SupplierVoucher["lines"];
}

function voucherBody(input: NewSupplierVoucherInput): {
  supplier_name: string;
  voucher_date: string;
  carrier_name: string;
  total_packages: number;
  lines: {
    stock_code: string;
    description: string;
    product_group: "man" | "lady" | "child";
    color_breakdown: string;
    unit: SupplierVoucher["lines"][number]["unit"];
    unit_conversions: UnitConversions;
    currency_code: string;
    buying_price: number;
    original_buying_price: number | null;
    exchange_rate: number | null;
  }[];
} {
  return {
    supplier_name: input.supplier_name,
    voucher_date: input.voucher_date,
    carrier_name: input.carrier_name,
    total_packages: input.total_packages,
    lines: input.lines.map((line) => ({
      stock_code: line.stock_code,
      description: line.description,
      product_group: line.product_group,
      color_breakdown: line.color_breakdown,
      unit: line.unit,
      unit_conversions: line.unit_conversions ?? PAIRS_PER,
      currency_code: line.currency_code ?? "MMK",
      buying_price: line.buying_price,
      original_buying_price: line.original_buying_price ?? null,
      exchange_rate: line.exchange_rate ?? null,
    })),
  };
}

export async function createSupplierVoucher(
  session: Session,
  input: NewSupplierVoucherInput,
): Promise<SupplierVoucher> {
  return request<SupplierVoucher>(session, "/api/wholesale/supplier-vouchers", {
    method: "POST",
    body: voucherBody(input),
  });
}

export async function updateSupplierVoucher(
  session: Session,
  voucherId: string,
  input: NewSupplierVoucherInput,
): Promise<SupplierVoucher> {
  return request<SupplierVoucher>(
    session,
    `/api/wholesale/supplier-vouchers/${voucherId}`,
    { method: "PUT", body: voucherBody(input) },
  );
}

export async function deleteSupplierVoucher(
  session: Session,
  voucherId: string,
): Promise<void> {
  await request<void>(
    session,
    `/api/wholesale/supplier-vouchers/${voucherId}`,
    { method: "DELETE" },
  );
}

export async function writeOffSupplierVoucherLine(
  session: Session,
  lineId: string,
  input: WriteOffInput,
): Promise<WriteOffWire> {
  return request<WriteOffWire>(
    session,
    `/api/wholesale/supplier-vouchers/lines/${lineId}/write-off`,
    { method: "POST", body: input },
  );
}

export async function addSupplierVoucherPayment(
  session: Session,
  voucherId: string,
  payment: SupplierVoucher["payment"]["payments"][number],
): Promise<void> {
  await request(
    session,
    `/api/wholesale/supplier-vouchers/${voucherId}/payments`,
    {
      method: "POST",
      body: {
        paid_on: payment.paid_on,
        amount: payment.amount,
        note: payment.note,
      },
    },
  );
}

export async function removeSupplierVoucherPayment(
  session: Session,
  voucherId: string,
  paymentId: string,
): Promise<void> {
  await request<void>(
    session,
    `/api/wholesale/supplier-vouchers/${voucherId}/payments/${paymentId}`,
    { method: "DELETE" },
  );
}

// ── Customer orders ────────────────────────────────────────────────────────

export const CUSTOMER_ORDERS_URL = `${apiBaseUrl}/api/wholesale/orders`;
export const WHOLESALE_FINANCE_CUSTOMERS_URL = `${apiBaseUrl}/api/wholesale/finance/customers`;
export const ALLOCATION_EVENTS_URL = `${apiBaseUrl}/api/wholesale/orders/allocations`;
export function allocationEventsFromWire(
  wires: AllocationEvent[],
): AllocationEvent[] {
  return wires;
}
export interface NewCustomerOrderInput {
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  order_date: string;
  lines: CustomerOrder["lines"];
}
export function ordersFromWire(wires: CustomerOrder[]): CustomerOrder[] {
  return wires;
}
function orderBody(input: NewCustomerOrderInput): object {
  return {
    ...input,
    lines: input.lines.map((line) => ({
      stock_code: line.stock_code,
      description: line.description,
      product_group: line.product_group,
      supplier_name: line.supplier_name,
      color_breakdown: line.color_breakdown,
      unit: line.unit,
      unit_conversions: line.unit_conversions ?? PAIRS_PER,
      currency_code: line.currency_code ?? "MMK",
      selling_price: line.selling_price,
      original_selling_price: line.original_selling_price ?? null,
      exchange_rate: line.exchange_rate ?? null,
    })),
  };
}
export async function createCustomerOrder(
  session: Session,
  input: NewCustomerOrderInput,
): Promise<CustomerOrder> {
  return request<CustomerOrder>(session, "/api/wholesale/orders", {
    method: "POST",
    body: orderBody(input),
  });
}
export async function cancelCustomerOrder(
  session: Session,
  orderId: string,
): Promise<CustomerOrder> {
  return request<CustomerOrder>(
    session,
    `/api/wholesale/orders/${orderId}/cancel`,
    { method: "POST" },
  );
}

export async function updateCustomerOrderLineAllocation(
  session: Session,
  orderLineId: string,
  colorBreakdown: string,
): Promise<CustomerOrder> {
  return request<CustomerOrder>(
    session,
    `/api/wholesale/orders/lines/${orderLineId}/allocation`,
    {
      method: "PUT",
      body: { color_breakdown: colorBreakdown },
    },
  );
}

export async function writeOffCustomerOrderLine(
  session: Session,
  lineId: string,
  input: WriteOffInput,
): Promise<WriteOffWire> {
  return request<WriteOffWire>(
    session,
    `/api/wholesale/orders/lines/${lineId}/write-off`,
    { method: "POST", body: input },
  );
}

export const WHOLESALE_WRITE_OFFS_URL = `${apiBaseUrl}/api/wholesale/write-offs`;

export async function updateCustomerOrder(
  session: Session,
  orderId: string,
  input: NewCustomerOrderInput,
): Promise<CustomerOrder> {
  return request<CustomerOrder>(session, `/api/wholesale/orders/${orderId}`, {
    method: "PUT",
    body: orderBody(input),
  });
}

export async function deleteCustomerOrder(
  session: Session,
  orderId: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/orders/${orderId}`, {
    method: "DELETE",
  });
}

export async function addCustomerOrderPayment(
  session: Session,
  orderId: string,
  payment: CustomerOrder["payment"]["payments"][number],
): Promise<void> {
  const body: {
    paid_on: string;
    amount: number;
    note: string;
    paid_quantity_pairs?: number;
  } = {
    paid_on: payment.paid_on,
    amount: payment.amount,
    note: payment.note,
  };
  if (
    payment.paid_quantity_pairs !== undefined &&
    payment.paid_quantity_pairs !== null
  ) {
    body.paid_quantity_pairs = payment.paid_quantity_pairs;
  }
  await request<void>(session, `/api/wholesale/orders/${orderId}/payments`, {
    method: "POST",
    body,
  });
}

export async function removeCustomerOrderPayment(
  session: Session,
  orderId: string,
  paymentId: string,
): Promise<void> {
  await request<void>(
    session,
    `/api/wholesale/orders/${orderId}/payments/${paymentId}`,
    {
      method: "DELETE",
    },
  );
}

// ── Inventory movements ────────────────────────────────────────────────────

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

// ── Four-pillar reports ────────────────────────────────────────────────────

export const WHOLESALE_REPORTS_URL = `${apiBaseUrl}/api/wholesale/reports`;

export interface WholesaleReportKpi {
  value: number;
  previous_value: number | null;
  delta_pct: number | null;
}

export interface WholesaleRevenueReport {
  period: string;
  date_from: string;
  date_to: string;
  delivered_revenue: WholesaleReportKpi;
  ordered_value: WholesaleReportKpi;
  pairs_delivered: WholesaleReportKpi;
  collected: WholesaleReportKpi;
  trend: { date: string; delivered_revenue: number; collected: number }[];
  top_customers: {
    customer_name: string;
    pairs_delivered: number;
    delivered_revenue: number;
  }[];
  top_products: {
    stock_code: string;
    description: string;
    pairs_delivered: number;
    delivered_revenue: number;
    avg_selling_price: number | null;
  }[];
  orders: {
    order_no: string;
    customer_name: string;
    pairs_ordered: number;
    ordered_value: number;
    delivered_pct: number;
    balance_due: number;
  }[];
}

export interface WholesaleCostReport {
  period: string;
  date_from: string;
  date_to: string;
  purchases: WholesaleReportKpi;
  freight_and_handling: WholesaleReportKpi;
  gross_margin_pct: WholesaleReportKpi;
  owed_to_suppliers: WholesaleReportKpi;
  trend: {
    date: string;
    delivered_revenue: number;
    cost_of_goods_delivered: number | null;
  }[];
  freight_by_stage: { stage: string; amount: number }[];
  suppliers: {
    supplier_name: string;
    vouchers: number;
    pairs: number;
    value: number;
    paid: number;
    balance: number;
  }[];
  payables: {
    voucher_no: string;
    supplier_name: string;
    voucher_date: string;
    days_since: number;
    balance_due: number;
  }[];
  write_offs: {
    reference: string;
    stock_code: string;
    description: string;
    quantity_pairs: number;
    reason: string;
    value: number;
  }[];
}

export interface WholesaleInventoryReport {
  period: string;
  date_from: string;
  date_to: string;
  on_hand: WholesaleReportKpi;
  available: WholesaleReportKpi;
  incoming: WholesaleReportKpi;
  stock_value: WholesaleReportKpi;
  received_in_period: number;
  delivered_in_period: number;
  locations: { location: string; on_hand_pairs: number }[];
  pipeline: { stage: string; pairs: number }[];
  products: WholesaleInventoryProduct[];
  cannot_supply: WholesaleInventoryProduct[];
  not_moving: (WholesaleInventoryProduct & { days_since: number | null })[];
}

export interface WholesaleInventoryProduct {
  stock_code: string;
  description: string;
  on_hand_pairs: number;
  available_pairs: number;
  allocated_pairs: number;
  at_supplier_pairs: number;
  in_transit_pairs: number;
  incoming_pairs: number;
  owed_to_customers_pairs: number;
  last_movement_on: string | null;
  stock_value: number;
  locations: {
    location: string;
    on_hand_pairs: number;
    last_moved_on: string | null;
  }[];
}

export interface WholesaleCustomerReport {
  period: string;
  date_from: string;
  date_to: string;
  active_customers: WholesaleReportKpi;
  new_customers: WholesaleReportKpi;
  average_order_value: WholesaleReportKpi;
  receivables: WholesaleReportKpi;
  fulfilment_days: WholesaleReportKpi;
  trend: { date: string; order_count: number }[];
  top_customers: WholesaleCustomerRanking[];
  ranking: WholesaleCustomerRanking[];
  open_orders: {
    order_no: string;
    customer_name: string;
    order_date: string;
    pairs_ordered: number;
    pairs_delivered: number;
    balance_due: number;
    days_open: number;
  }[];
  quiet_customers: { customer_name: string }[];
}

export interface WholesaleCustomerRanking {
  customer_name: string;
  orders: number;
  pairs_ordered: number;
  pairs_delivered: number;
  delivered_revenue: number;
  paid: number;
  balance: number;
}

export function wholesaleReportFromWire<T>(wire: T): T {
  return wire;
}
