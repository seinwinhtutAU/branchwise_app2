import { formatIn, toPairs, type Unit } from "@renderer/components/features/wholesale/shared/units";
import { type Receiving } from "@renderer/components/features/wholesale/receiving/receivings";
import { type SupplierVoucher } from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { colorPairsForText } from "@renderer/components/features/wholesale/inventory/stock";

export function formatStoredQuantity(quantity: number, unit: Unit): string {
  return formatIn(toPairs(quantity, unit), unit);
}

// ── Checked against the voucher ─────────────────────────────────────────────
// What the supplier's own voucher said was coming, so a package's contents can be
// checked against it rather than just against its own grammar. A supplier can genuinely
// ship something the voucher didn't say — these are warnings staff can still save past,
// not a hard stop.

export interface VoucherExpectations {
  stockCodes: Set<string>;
  // Colour -> pairs the voucher says are coming, keyed by stock code.
  colorsByStockCode: Map<string, Map<string, number>>;
}

export function voucherExpectations(
  voucher: SupplierVoucher | undefined,
): VoucherExpectations {
  const stockCodes = new Set<string>();
  const colorsByStockCode = new Map<string, Map<string, number>>();
  for (const line of voucher?.lines ?? []) {
    const code = line.stock_code.trim().toLowerCase();
    if (!code) continue;
    stockCodes.add(code);
    const colors = colorsByStockCode.get(code) ?? new Map<string, number>();
    for (const [color, pairs] of Object.entries(
      colorPairsForText(line.color_breakdown, "set"),
    )) {
      colors.set(color, (colors.get(color) ?? 0) + pairs);
    }
    colorsByStockCode.set(code, colors);
  }
  return { stockCodes, colorsByStockCode };
}

export function receivedStockCodeProblem(
  stockCode: string,
  expected: VoucherExpectations,
): string | null {
  const code = stockCode.trim().toLowerCase();
  if (!code || expected.stockCodes.size === 0) return null;
  return expected.stockCodes.has(code)
    ? null
    : "Not on this voucher — check the code.";
}

export function receivedColorProblem(
  stockCode: string,
  colorQty: string,
  expected: VoucherExpectations,
): string | null {
  const code = stockCode.trim().toLowerCase();
  const wanted = expected.colorsByStockCode.get(code);
  if (!wanted || wanted.size === 0) return null;
  const actual = Object.keys(colorPairsForText(colorQty, "set"));
  const unexpected = actual.filter((color) => !wanted.has(color));
  if (unexpected.length === 0) return null;
  return `${unexpected.join(", ")} ${unexpected.length === 1 ? "isn't" : "aren't"} on the voucher for this product.`;
}

/** How many pairs of each colour have actually been logged for one stock code, summed
 *  across every package in this receiving — not just the item being typed into, since
 *  the same product often arrives split across several packages and a colour's full count
 *  only exists once every package holding it is added up. */
export function receivedColorPairs(
  receiving: Receiving,
  stockCode: string,
): Map<string, number> {
  const code = stockCode.trim().toLowerCase();
  const totals = new Map<string, number>();
  for (const entry of receiving.packages) {
    for (const item of entry.items) {
      if (item.stock_code.trim().toLowerCase() !== code) continue;
      for (const [color, pairs] of Object.entries(
        colorPairsForText(item.color_breakdown, item.unit),
      )) {
        totals.set(color, (totals.get(color) ?? 0) + pairs);
      }
    }
  }
  return totals;
}

/** A colour's own name can be right while its count still isn't — 20 sets of black
 *  logged against a voucher that only ever asked for 15 is wrong the moment it happens,
 *  whatever else is still unopened. Falling short is not flagged the same way: more of a
 *  colour can still be sitting in a package nobody has opened yet. */
export function receivedColorQuantityProblem(
  stockCode: string,
  receiving: Receiving,
  expected: VoucherExpectations,
): string | null {
  const code = stockCode.trim().toLowerCase();
  const wanted = expected.colorsByStockCode.get(code);
  if (!wanted || wanted.size === 0) return null;
  const received = receivedColorPairs(receiving, stockCode);
  const over = [...received.entries()].find(
    ([color, pairs]) => pairs > (wanted.get(color) ?? 0),
  );
  if (!over) return null;
  const [color, pairs] = over;
  return `${formatIn(pairs, receiving.total_unit)} of ${color} recorded, but the voucher only says ${formatIn(wanted.get(color) ?? 0, receiving.total_unit)}.`;
}
