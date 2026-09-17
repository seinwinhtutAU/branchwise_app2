// What the business actually sells, beyond the code on the box. A stock code alone —
// "A1001" — tells nobody which shoe is meant, so every product carries a description and
// the product_group it belongs to: man, lady or child. The product_group is how the business thinks about
// its range, and it is the difference between "we are short of B2001" and "we are short of
// ladies' sandals".
//
// Orders, vouchers, receivings and stock all keep the description and product_group on the line
// itself rather than looking them up, so a line still reads properly when a product is
// renamed later. This list is what the wizards offer while someone is typing, so the same
// product is not written three different ways on three screens.
//
// Product master data is hydrated from the backend by masterData.ts.

import { type Unit, type UnitConversions } from "./units";

export type ProductGroup = "man" | "lady" | "child";

export const PRODUCT_GROUPS: ProductGroup[] = ["man", "lady", "child"];

export const GROUP_LABELS: Record<ProductGroup, string> = {
  man: "Man",
  lady: "Lady",
  child: "Child",
};

export interface Product {
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  default_unit: Unit;
  /** The rate to copy into a new transaction line. Existing lines keep their own copy. */
  default_unit_conversions?: UnitConversions;
}

/** A product on one line, short enough for a table cell: "Men's slipper · Man". */
export function describeProduct(
  description: string,
  product_group: ProductGroup,
): string {
  return description
    ? `${description} · ${GROUP_LABELS[product_group]}`
    : GROUP_LABELS[product_group];
}
