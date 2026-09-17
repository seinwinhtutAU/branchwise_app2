// The Master Data screen's writes: wholesale products, suppliers, customers, and the
// small "just a name" entities (cargo companies, carriers, destinations, receiving gates).

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { request } from "../shared/apiClient";
import { type Product } from "../shared/products";
import { type Unit, type UnitConversions } from "../shared/units";


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

