// The one place every wholesale screen talks to the real backend from. A write here is
// never retried automatically — lib/network.ts only retries reads, since a write that
// timed out may already have been applied — so a timeout is reported as "reload to see
// whether it saved" rather than silently sent again.
//
// Reads go through useCachedFetch (see each page), which already knows how to retry, and
// wraps the same apiBaseUrl. This file is deliberately just the write side plus the
// per-entity request/response shapes, since a read is one line at the call site.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { RequestTimeoutError } from "@renderer/lib/network";
import { invalidateCachedPages } from "@renderer/lib/useCachedFetch";
import { type Shipment, type ShipmentLeg } from "./shipments";
import { type Receiving, type ReceivingCost, type ReceivingPackage } from "./receivings";
import { type SupplierVoucher } from "./supplierVouchers";
import { type CustomerOrder } from "./customerOrders";
import { type StockMovement } from "./stock";
import { fromPairs, PAIRS_PER } from "./units";

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
    invalidateCachedPages();
    return undefined as T;
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new WholesaleApiError(body?.detail ?? `Request failed: ${response.status}`);
  }

  invalidateCachedPages();
  return body as T;
}

// ── Shipments ──────────────────────────────────────────────────────────────

interface ShipmentLegWire {
  stop_name: string;
  carrier_name: string;
  packages_received: number;
  packages_sent: number;
}

export interface ShipmentWire {
  shipment_id: string;
  branch_id: string | null;
  shipment_no: string;
  voucher_no: string;
  supplier_name: string;
  cargo_name: string;
  final_location: string;
  sent_date: string;
  total_packages: number;
  total_pairs: number;
  total_unit: string;
  packages_sent_by_cargo: number;
  final_received_packages: number;
  legs: (ShipmentLegWire & { leg_id: string; leg_order: number })[];
}

export const SHIPMENTS_URL = `${apiBaseUrl}/api/wholesale/shipments`;

/** The wire shape uses total_pairs (what the server actually stores); the screens still
 *  say total_qty (what it was written in), converted here at the one seam rather than
 *  renamed through every call site. */
export function shipmentFromWire(wire: ShipmentWire): Shipment {
  return {
    shipment_id: wire.shipment_id,
    shipment_no: wire.shipment_no,
    voucher_no: wire.voucher_no,
    supplier_name: wire.supplier_name,
    cargo_name: wire.cargo_name,
    final_location: wire.final_location,
    sent_date: wire.sent_date,
    total_packages: wire.total_packages,
    total_qty: wire.total_pairs,
    total_unit: wire.total_unit as Shipment["total_unit"],
    packages_sent_by_cargo: wire.packages_sent_by_cargo,
    final_received_packages: wire.final_received_packages,
    legs: wire.legs.map((leg) => ({
      leg_id: leg.leg_id,
      leg_order: leg.leg_order,
      stop_name: leg.stop_name,
      carrier_name: leg.carrier_name,
      packages_received: leg.packages_received,
      packages_sent: leg.packages_sent,
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
  cargo_name: string;
  final_location: string;
  sent_date: string;
  total_packages: number;
  total_qty: number;
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
  const wire = await request<ShipmentWire>(session, "/api/wholesale/shipments", {
    method: "POST",
    body: {
      voucher_no: input.voucher_no,
      supplier_name: input.supplier_name,
      cargo_name: input.cargo_name,
      final_location: input.final_location,
      sent_date: input.sent_date,
      total_packages: input.total_packages,
      total_pairs: input.total_qty,
      total_unit: input.total_unit,
      packages_sent_by_cargo: input.packages_sent_by_cargo,
      final_received_packages: input.final_received_packages,
      legs: input.legs.map(legToWire),
    },
  });
  return shipmentFromWire(wire);
}

export async function updateShipment(
  session: Session,
  shipmentId: string,
  patch: Partial<Shipment>,
): Promise<Shipment> {
  const body: Record<string, unknown> = {};
  if (patch.voucher_no !== undefined) body.voucher_no = patch.voucher_no;
  if (patch.supplier_name !== undefined) body.supplier_name = patch.supplier_name;
  if (patch.cargo_name !== undefined) body.cargo_name = patch.cargo_name;
  if (patch.final_location !== undefined) body.final_location = patch.final_location;
  if (patch.sent_date !== undefined) body.sent_date = patch.sent_date;
  if (patch.total_packages !== undefined) body.total_packages = patch.total_packages;
  if (patch.total_qty !== undefined) body.total_pairs = patch.total_qty;
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

export async function deleteShipment(session: Session, shipmentId: string): Promise<void> {
  await request<void>(session, `/api/wholesale/shipments/${shipmentId}`, {
    method: "DELETE",
  });
}

// ── Receivings ─────────────────────────────────────────────────────────────

interface ReceivingItemWire {
  item_id: string;
  stock_code: string;
  description: string;
  group: "man" | "lady" | "child";
  color_qty: string;
  unit: Receiving["total_unit"];
  qty_pairs: number;
}

interface ReceivingPackageWire {
  package_id: string;
  package_no: number;
  opened: boolean;
  received_date: string | null;
  note: string;
  items: ReceivingItemWire[];
}

interface ReceivingCostWire {
  cost_id: string;
  stage: string;
  carrier: string;
  kind: string;
  amount: number;
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
  received_date: string;
  total_packages: number;
  total_pairs: number;
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
    received_date: wire.received_date ?? "",
    note: wire.note,
    items: wire.items.map((item) => ({
      item_id: item.item_id,
      stock_code: item.stock_code,
      description: item.description,
      group: item.group,
      color_qty: item.color_qty,
      qty: fromPairs(item.qty_pairs, item.unit),
      unit: item.unit,
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
    received_date: wire.received_date,
    total_packages: wire.total_packages,
    total_qty: fromPairs(wire.total_pairs, wire.total_unit),
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
  received_date: string;
  total_packages: number;
  total_qty: number;
  total_unit: Receiving["total_unit"];
  costs: ReceivingCost[];
}

function packageToWire(entry: ReceivingPackage): {
  opened: boolean;
  received_date: string | null;
  note: string;
  items: {
    stock_code: string;
    description: string;
    product_group: "man" | "lady" | "child";
    color_qty: string;
    qty: number;
    unit: Receiving["total_unit"];
  }[];
} {
  return {
    opened: entry.opened,
    received_date: entry.received_date || null,
    note: entry.note,
    items: entry.items.map((item) => ({
      stock_code: item.stock_code,
      description: item.description,
      product_group: item.group,
      color_qty: item.color_qty,
      qty: item.qty,
      unit: item.unit,
    })),
  };
}

function costsToWire(costs: ReceivingCost[]): {
  stage: string;
  carrier: string;
  kind: string;
  amount: number;
  note: string;
}[] {
  return costs.map(({ stage, carrier, kind, amount, note }) => ({
    stage,
    carrier,
    kind,
    amount,
    note,
  }));
}

export async function createReceiving(session: Session, input: NewReceivingInput): Promise<Receiving> {
  const wire = await request<ReceivingWire>(session, "/api/wholesale/receivings", {
    method: "POST",
    body: {
      shipment_id: input.shipment_id,
      gate: input.gate,
      received_date: input.received_date,
      total_packages: input.total_packages,
      total_pairs: input.total_qty * PAIRS_PER[input.total_unit],
      total_unit: input.total_unit,
    },
  });
  if (input.costs.length > 0) await replaceReceivingCosts(session, wire.receiving_id, input.costs);
  return receivingFromWire(wire);
}

export async function updateReceiving(
  session: Session,
  receivingId: string,
  patch: Pick<Receiving, "gate" | "received_date" | "total_packages" | "total_qty" | "total_unit">,
): Promise<Receiving> {
  const wire = await request<ReceivingWire>(session, `/api/wholesale/receivings/${receivingId}`, {
    method: "PATCH",
    body: {
      ...patch,
      total_pairs: patch.total_qty * PAIRS_PER[patch.total_unit],
      total_qty: undefined,
    },
  });
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

export async function deleteReceiving(session: Session, receivingId: string): Promise<void> {
  await request<void>(session, `/api/wholesale/receivings/${receivingId}`, { method: "DELETE" });
}

// ── Supplier vouchers ──────────────────────────────────────────────────────

export interface SupplierVoucherWire extends SupplierVoucher {}
export const SUPPLIER_VOUCHERS_URL = `${apiBaseUrl}/api/wholesale/supplier-vouchers`;

export function vouchersFromWire(wires: SupplierVoucherWire[]): SupplierVoucher[] {
  return wires;
}

export interface NewSupplierVoucherInput {
  supplier_name: string;
  voucher_date: string;
  cargo_name: string;
  total_packages: number;
  lines: SupplierVoucher["lines"];
}

function voucherBody(input: NewSupplierVoucherInput): {
  supplier_name: string;
  voucher_date: string;
  cargo_name: string;
  total_packages: number;
  lines: {
    stock_code: string;
    description: string;
    product_group: "man" | "lady" | "child";
    color_qty: string;
    unit: SupplierVoucher["lines"][number]["unit"];
    buying_price: number;
  }[];
} {
  return {
    supplier_name: input.supplier_name,
    voucher_date: input.voucher_date,
    cargo_name: input.cargo_name,
    total_packages: input.total_packages,
    lines: input.lines.map((line) => ({
      stock_code: line.stock_code,
      description: line.description,
      product_group: line.group,
      color_qty: line.color_qty,
      unit: line.unit,
      buying_price: line.buying_price,
    })),
  };
}

export async function createSupplierVoucher(session: Session, input: NewSupplierVoucherInput): Promise<SupplierVoucher> {
  return request<SupplierVoucher>(session, "/api/wholesale/supplier-vouchers", { method: "POST", body: voucherBody(input) });
}

export async function updateSupplierVoucher(session: Session, voucherId: string, input: NewSupplierVoucherInput): Promise<SupplierVoucher> {
  return request<SupplierVoucher>(session, `/api/wholesale/supplier-vouchers/${voucherId}`, { method: "PUT", body: voucherBody(input) });
}

export async function deleteSupplierVoucher(session: Session, voucherId: string): Promise<void> {
  await request<void>(session, `/api/wholesale/supplier-vouchers/${voucherId}`, { method: "DELETE" });
}

export async function addSupplierVoucherPayment(session: Session, voucherId: string, payment: SupplierVoucher["payment"]["payments"][number]): Promise<void> {
  await request(session, `/api/wholesale/supplier-vouchers/${voucherId}/payments`, { method: "POST", body: { paid_on: payment.date, amount: payment.amount, note: payment.note } });
}

export async function removeSupplierVoucherPayment(session: Session, voucherId: string, paymentId: string): Promise<void> {
  await request<void>(session, `/api/wholesale/supplier-vouchers/${voucherId}/payments/${paymentId}`, { method: "DELETE" });
}

// ── Customer orders ────────────────────────────────────────────────────────

export const CUSTOMER_ORDERS_URL = `${apiBaseUrl}/api/wholesale/orders`;
export interface NewCustomerOrderInput {
  customer_name: string; customer_phone: string; customer_address: string; order_date: string; lines: CustomerOrder["lines"];
}
export function ordersFromWire(wires: CustomerOrder[]): CustomerOrder[] { return wires; }
function orderBody(input: NewCustomerOrderInput): object {
  return { ...input, lines: input.lines.map((line) => ({ stock_code: line.stock_code, description: line.description, product_group: line.group, supplier_name: line.supplier_name, color_qty: line.color_qty, unit: line.unit, selling_price: line.selling_price })) };
}
export async function createCustomerOrder(session: Session, input: NewCustomerOrderInput): Promise<CustomerOrder> {
  return request<CustomerOrder>(session, "/api/wholesale/orders", { method: "POST", body: orderBody(input) });
}
export async function cancelCustomerOrder(session: Session, orderId: string): Promise<CustomerOrder> {
  return request<CustomerOrder>(session, `/api/wholesale/orders/${orderId}/cancel`, { method: "POST" });
}

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

export async function deleteCustomerOrder(session: Session, orderId: string): Promise<void> {
  await request<void>(session, `/api/wholesale/orders/${orderId}`, { method: "DELETE" });
}

export async function addCustomerOrderPayment(
  session: Session,
  orderId: string,
  payment: CustomerOrder["payment"]["payments"][number],
): Promise<void> {
  await request<void>(session, `/api/wholesale/orders/${orderId}/payments`, {
    method: "POST",
    body: { paid_on: payment.date, amount: payment.amount, note: payment.note },
  });
}

export async function removeCustomerOrderPayment(
  session: Session,
  orderId: string,
  paymentId: string,
): Promise<void> {
  await request<void>(session, `/api/wholesale/orders/${orderId}/payments/${paymentId}`, {
    method: "DELETE",
  });
}

// ── Inventory and customer deliveries ──────────────────────────────────────

export const WHOLESALE_INVENTORY_URL = `${apiBaseUrl}/api/wholesale/inventory`;

export function inventoryMovementsFromWire(wires: StockMovement[]): StockMovement[] {
  return wires;
}

export async function createCustomerDelivery(
  session: Session,
  orderId: string,
  movement: StockMovement,
): Promise<StockMovement> {
  return request<StockMovement>(session, "/api/wholesale/inventory/deliveries", {
    method: "POST",
    body: {
      order_id: orderId, stock_code: movement.stock_code, location: movement.location,
      color_qty: movement.color_qty, unit: "set", delivered_on: movement.date, note: movement.note,
    },
  });
}

export async function updateCustomerDelivery(
  session: Session,
  movement: StockMovement,
): Promise<StockMovement> {
  return request<StockMovement>(session, `/api/wholesale/inventory/deliveries/${movement.movement_id}`, {
    method: "PUT",
    body: {
      location: movement.location, color_qty: movement.color_qty, unit: "set",
      delivered_on: movement.date, note: movement.note,
    },
  });
}

export async function deleteCustomerDelivery(session: Session, movementId: string): Promise<void> {
  await request<void>(session, `/api/wholesale/inventory/deliveries/${movementId}`, { method: "DELETE" });
}
