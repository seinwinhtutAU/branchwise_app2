// Non-component helpers for the wholesale Revenue, Customer and Inventory dashboard tabs,
// kept apart from dashboardParts.tsx so that file only exports components (Fast Refresh).

/** "103.8M" — the compact money the dashboard tiles use. Just the number: each dashboard
 *  says once, in its footer, that values are in MMK. */
export function formatMmk(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  const trim = (value: number): string => {
    const text = value.toFixed(1);
    return text.endsWith(".0") ? text.slice(0, -2) : text;
  };
  if (abs >= 1_000_000) return `${sign}${trim(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${trim(abs / 1_000)}K`;
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

/** A share, one decimal: "41.0%". */
export function formatShare(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

// The series colours: the brand colour, then a purple and the warning amber, matching the
// stock-composition and flow visuals.
export const SERIES_COLORS = {
  primary: "var(--color-brand)",
  purple: "#9b6de0",
  amber: "#e09f3e",
  green: "#52b788",
} as const;
