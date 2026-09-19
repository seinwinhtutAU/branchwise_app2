// Foreign-currency money on customer-order lines, supplier-voucher lines, and
// receiving costs — mirrors backend/app/services/wholesale/currency.py, the one place
// that actually validates a currency/original/rate combination and computes the Kyat
// amount. Everything here is client-side preview only: the server recomputes and is
// authoritative, so a rounding difference between this file and the backend is
// cosmetic, never a source of truth mismatch.

export const DEFAULT_CURRENCY = "MMK";

/** The currencies this business actually deals in, alongside MMK. Keep this list in
 *  step with backend/app/services/wholesale/currency.py::SUPPORTED_CURRENCIES and
 *  Settings' exchange-rate section — adding one here without the backend change means
 *  a line can be typed but never saved. */
export const FOREIGN_CURRENCIES = ["THB"] as const;
export type ForeignCurrency = (typeof FOREIGN_CURRENCIES)[number];
export type CurrencyCode = "MMK" | ForeignCurrency;
export const CURRENCY_CODES: CurrencyCode[] = [DEFAULT_CURRENCY, ...FOREIGN_CURRENCIES];

export function isForeignCurrency(code: string): code is ForeignCurrency {
  return (FOREIGN_CURRENCIES as readonly string[]).includes(code);
}

/** A money field's full state, as carried on an order line / voucher line / receiving
 *  cost. `amount` is always the Kyat figure, the one every total/report reads; the rest
 *  is only present for a non-MMK currency, and is a fixed snapshot once saved. */
export interface MoneySnapshot {
  currency_code: string;
  original_amount: number | null;
  exchange_rate: number | null;
}

/** original_amount x exchange_rate, rounded to the nearest Kyat the same way the
 *  server rounds it — two decimal places, half rounds up. A client-side preview only;
 *  the server recomputes this from the same two numbers and is authoritative. */
export function previewKyatAmount(originalAmount: number, exchangeRate: number): number {
  if (!Number.isFinite(originalAmount) || !Number.isFinite(exchangeRate)) return 0;
  return Math.round(originalAmount * exchangeRate * 100) / 100;
}

const RATE_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });

export function formatRate(rate: number): string {
  return RATE_FORMAT.format(rate);
}

export function formatOriginalAmount(currencyCode: string, amount: number): string {
  return `${currencyCode} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(amount)}`;
}
