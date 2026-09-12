// What the business actually sells, beyond the code on the box. A stock code alone —
// "A1001" — tells nobody which shoe is meant, so every product carries a description and
// the group it belongs to: man, lady or child. The group is how the business thinks about
// its range, and it is the difference between "we are short of B2001" and "we are short of
// ladies' sandals".
//
// Orders, vouchers, receivings and stock all keep the description and group on the line
// itself rather than looking them up, so a line still reads properly when a product is
// renamed later. This list is what the wizards offer while someone is typing, so the same
// product is not written three different ways on three screens.
//
// Front-end only: no backend, so this is seed data.

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
  group: ProductGroup;
}

export const SEED_PRODUCTS: Product[] = [
  { stock_code: "A1001", description: "Men's leather sandal", group: "man" },
  { stock_code: "A1002", description: "Men's slipper", group: "man" },
  { stock_code: "A1003", description: "Men's sport sandal", group: "man" },
  { stock_code: "B2001", description: "Ladies' flat sandal", group: "lady" },
  { stock_code: "B2002", description: "Ladies' heel sandal", group: "lady" },
  { stock_code: "C3001", description: "Kids' school shoe", group: "child" },
  { stock_code: "C3002", description: "Kids' sandal", group: "child" },
  { stock_code: "D4001", description: "Ladies' rubber slipper", group: "lady" },
];

export const STOCK_CODES: string[] = SEED_PRODUCTS.map(
  (product) => product.stock_code,
);

/** The product a stock code stands for, or nothing when it is one we have not sold
 *  before. Used to fill a description and group in as soon as the code is typed. */
export function productOf(stockCode: string): Product | undefined {
  const code = stockCode.trim().toUpperCase();
  return SEED_PRODUCTS.find((product) => product.stock_code === code);
}

/** A product on one line, short enough for a table cell: "Men's slipper · Man". */
export function describeProduct(
  description: string,
  group: ProductGroup,
): string {
  return description
    ? `${description} · ${GROUP_LABELS[group]}`
    : GROUP_LABELS[group];
}
