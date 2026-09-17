// The Supplier Vouchers screen's writes: creating a voucher, editing it, a line write-off,
// payments, and deletion.

import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import { request } from "./apiClient";
import { type WriteOffInput, type WriteOffWire } from "./shipmentsApi";
import { type SupplierVoucher } from "./supplierVouchers";
import { PAIRS_PER, type UnitConversions } from "./units";

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

