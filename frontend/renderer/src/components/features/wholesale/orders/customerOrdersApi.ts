// The Customer Orders screen's writes: creating an order, cancelling it, allocating stock
// to a line, a line write-off, edits, deletion, and payments.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { request } from "../shared/apiClient";
import { type AllocationEvent, type CustomerOrder } from "./customerOrders";
import { type WriteOffInput, type WriteOffWire } from "../delivery/shipmentsApi";
import { PAIRS_PER } from "../shared/units";

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

