// Raw values are point_in_time_buying_price's internal vocabulary (see
// app/services/pricing.py) — translated here rather than in the backend response, so the
// API stays a stable machine-readable enum while the label can be reworded freely.
const SOURCE_LABELS: Record<string, string> = {
  purchase: "Purchase",
  stock: "Stock count",
  stock_forward_fill: "Later recount (est.)",
};

export function formatBuyingPriceSource(
  source: string | null | undefined,
): string {
  if (!source) return "—";
  return SOURCE_LABELS[source] ?? source;
}
