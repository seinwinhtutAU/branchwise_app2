import { apiBaseUrl } from "@renderer/lib/auth";

// Non-component helpers shared by the dashboard tabs. Kept apart from shared.tsx
// (components only) so Vite Fast Refresh can hot-swap that file in dev — a module
// that exports both components and plain values/functions can't be refreshed in place.

// "7d"/"30d" are kept for Business Alerts, which still fetches /api/dashboard/overview
// with its own, separate period control (see BusinessAlertsPage) — the Dashboard's own
// picker dropped them in favour of "monthly" (see DASHBOARD_PERIOD_OPTIONS below).
export type PeriodKey = "today" | "yesterday" | "7d" | "30d" | "monthly";

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

// The Dashboard page's own period choices — Business Alerts keeps PERIOD_OPTIONS above
// unchanged. Order matches how the business asked for them: Yesterday is the default.
export const DASHBOARD_PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: "yesterday", label: "Yesterday" },
  { value: "monthly", label: "Monthly" },
  { value: "today", label: "Today" },
];

// `dateFrom`/`dateTo` (a custom range, both set) always wins over `period` — matches
// the backend's own resolve_period rule (app/services/dashboard.py).
//
// `comparison` mirrors the backend's own resolve_period parameter of the same name:
// Revenue/Cost/Customer pass "year_ago" (their KPI deltas compare against the same
// dates one year earlier); every other caller (Overview, Summary, Business Alerts,
// wholesale Reports) keeps the default, vs the window right before this one.
export function previousPeriodLabel(
  period: PeriodKey,
  dateFrom?: string,
  dateTo?: string,
  comparison: "previous_period" | "year_ago" = "previous_period",
): string {
  if (comparison === "year_ago") {
    if (dateFrom && dateTo) return "vs the same dates last year";
    return period === "monthly"
      ? "vs the same month last year"
      : "vs the same day last year";
  }
  if (dateFrom && dateTo) return "vs the same-length period right before it";
  switch (period) {
    case "today":
      return "vs yesterday";
    case "yesterday":
      return "vs the day before";
    case "7d":
      return "vs the previous 7 days";
    case "30d":
      return "vs the previous 30 days";
    case "monthly":
      return "vs the previous month";
  }
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

export const MONTH_SHORT_LABELS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString("en-US", { month: "short" }),
);

export function parseMonth(month: string): { year: number; monthIndex0: number } {
  return { year: Number(month.slice(0, 4)), monthIndex0: Number(month.slice(5, 7)) - 1 };
}

export function formatMonth(year: number, monthIndex0: number): string {
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}`;
}

// The Dashboard's Monthly picker label for one specific month (YYYY-MM) — the current,
// in-progress month reads "1st to today" (e.g. "Sep 1-23"); any earlier one reads its
// full span (e.g. "Aug 1-31"), matching the backend's own resolve_period (_resolve_month).
export function monthLabel(month: string, today: Date = new Date()): string {
  const { year, monthIndex0 } = parseMonth(month);
  const isCurrentMonth =
    year === today.getFullYear() && monthIndex0 === today.getMonth();
  const endDay = isCurrentMonth ? today.getDate() : daysInMonth(year, monthIndex0);
  const yearSuffix = year === today.getFullYear() ? "" : `, ${year}`;
  return `${MONTH_SHORT_LABELS[monthIndex0]} 1–${endDay}${yearSuffix}`;
}

// Whether `year`/`monthIndex0` names a month later than today's — the Monthly picker
// disables these rather than letting someone pick data that can't exist yet.
export function isFutureMonth(
  year: number,
  monthIndex0: number,
  today: Date = new Date(),
): boolean {
  return (
    year > today.getFullYear() ||
    (year === today.getFullYear() && monthIndex0 > today.getMonth())
  );
}

// Builds the period/date query params shared by every period-scoped dashboard tab
// (Revenue, Cost, Customer — Inventory has no period control at all).
export function periodQueryParams(
  period: PeriodKey,
  dateFrom: string,
  dateTo: string,
  // Which calendar month `period === "monthly"` means (YYYY-MM) — ignored otherwise,
  // and by any custom dateFrom/dateTo range, same as `period` itself.
  month?: string,
): URLSearchParams {
  const params = new URLSearchParams();
  if (dateFrom && dateTo) {
    params.set("date_from", dateFrom);
    params.set("date_to", dateTo);
  } else {
    params.set("period", period);
    if (period === "monthly" && month) params.set("month", month);
  }
  return params;
}

// The one place a dashboard tab's request URL is built. It doubles as the cache key in
// useCachedFetch, so every parameter that changes what comes back has to appear in it —
// which is exactly why building it here rather than inline in five tabs matters.
export function dashboardUrl(
  tab: "overview" | "summary" | "revenue" | "cost" | "inventory" | "customer",
  branchId: string,
  // Omitted for Inventory, which has no period control at all.
  window?: { period: PeriodKey; dateFrom: string; dateTo: string; month?: string },
): string {
  const params = window
    ? periodQueryParams(window.period, window.dateFrom, window.dateTo, window.month)
    : new URLSearchParams();
  if (branchId) params.set("branch_id", branchId);
  const query = params.toString();
  return `${apiBaseUrl}/api/dashboard/${tab}${query ? `?${query}` : ""}`;
}

// --- the Overview payload (GET /api/dashboard/overview) ------------------------------
// Shared by the Overview tab and the Alerts tab, so they read one definition of the
// shape rather than two that can drift.

export type HealthStatus = "healthy" | "needs_attention" | "critical";
export type AlertSeverity = "critical" | "warning" | "normal";

/**
 * How each status band is named and coloured, in one place: the Overview tab's gauge,
 * dimension bars and branch cards, and the Business Alerts page's branch strip, all read
 * it, so a branch that is "Healthy" is the same word and the same green everywhere.
 */
/**
 * How each alert severity is named and coloured, in one place — the Overview tab and the
 * Business Alerts page both read it, so one problem looks the same wherever it appears.
 *
 * `normal` is the level that asks for nothing today: a margin down a point, a fortnight
 * of stock cover left. It is green because that is what it means — nothing to act on —
 * and because it is never counted anywhere (see the nav badge and the branch tiles), so
 * the numbers a manager reacts to still count only the two levels that need a decision.
 */
export const SEVERITY_META: Record<
  AlertSeverity,
  {
    label: string;
    badge: "error" | "warning" | "success";
    text: string;
    accent: string;
    dot: string;
  }
> = {
  critical: {
    label: "Critical",
    badge: "error",
    text: "text-error",
    accent: "border-l-error",
    dot: "bg-error",
  },
  warning: {
    label: "Warning",
    badge: "warning",
    text: "text-warning",
    accent: "border-l-warning",
    dot: "bg-warning",
  },
  normal: {
    label: "Normal",
    badge: "success",
    text: "text-success",
    accent: "border-l-success",
    dot: "bg-success",
  },
};

/** The severities that ask for a decision — what every count in the app counts. */
export const ACTIONABLE_SEVERITIES: AlertSeverity[] = ["critical", "warning"];

export const STATUS_META: Record<
  HealthStatus,
  {
    label: string;
    badge: "success" | "warning" | "error";
    bar: string;
    text: string;
    stroke: string;
  }
> = {
  healthy: {
    label: "Healthy",
    badge: "success",
    bar: "bg-success",
    text: "text-success",
    stroke: "stroke-success",
  },
  needs_attention: {
    label: "Needs attention",
    badge: "warning",
    bar: "bg-warning",
    text: "text-warning",
    stroke: "stroke-warning",
  },
  critical: {
    label: "Critical",
    badge: "error",
    bar: "bg-error",
    text: "text-error",
    stroke: "stroke-error",
  },
};

/** Which tab holds the evidence behind a score or an alert. */
export type EvidenceTarget =
  | "revenue"
  | "cost"
  | "inventory"
  | "customer"
  | "warnings"
  | "checking"
  | "import";

export interface SubMetric {
  key: string;
  label: string;
  unit: "pct" | "pct_change" | "pct_points" | "days" | "count" | "rate";
  weight: number;
  value: number | null;
  score: number | null;
  /** One sentence saying what this measures. */
  definition: string;
  /** The figures the value was worked out from, or null when it wasn't measurable. */
  calculation: string | null;
  /** [value, score] breakpoints — the same table the score was computed against. */
  bands: [number, number][];
}

export interface DimensionScore {
  key: string;
  label: string;
  description: string;
  weight: number;
  effective_weight: number | null;
  score: number | null;
  status: HealthStatus | null;
  insufficient_data_reason: string | null;
  sub_metrics: SubMetric[];
}

export interface HealthAlert {
  id: string;
  severity: AlertSeverity;
  dimension: string;
  title: string;
  summary: string;
  what_happened: string;
  recommended_action: string;
  link: EvidenceTarget;
  /** The `SubMetric.key` this alert is about — see the Overview branch page. */
  measure: string;
  driver: string | null;
  interpretation: string | null;
  /** The days behind the alert: "9 Aug – 7 Sep 2026 vs 10 Jul – 8 Aug 2026", or, for the
   * stock rules, the count date and sales window — those deliberately ignore the period
   * control, and this is where the reader can see that. */
  context: string | null;
  /** The alert's figures, labelled and preformatted by the server (see
   * early_warning.Alert) — the detail panel's main content. */
  facts: AlertFact[];
  /** The products behind an alert about a list rather than a number. */
  table: AlertTable | null;
  /** For an alert that points at the Warning page: how many days back from today its
   * counts reach, so that page opens on the same stretch of days. */
  evidence_days: number | null;
}

/**
 * One labelled row of the detail panel: either a single value, or a movement carrying
 * what it was before and by how much it changed.
 *
 * Values arrive as finished strings rather than numbers. That is deliberate: the alert's
 * own sentences are built on the server from the same figures, and formatting them twice
 * is how a panel ends up saying "32.8%" beside a sentence that says "33%".
 */
export interface AlertFact {
  label: string;
  value?: string;
  before?: string | null;
  after?: string;
  change?: string | null;
  /** Whether the movement was good or bad news — decided by the rule, since the sign
   * alone doesn't say (cost of goods up 14% is a plus and bad). Null when it is neither,
   * or when nothing moved. */
  tone?: "good" | "bad" | null;
  /** Which way it moved, which is a different question from whether that was good — the
   * panel draws the arrow from this and takes its colour from `tone`. */
  direction?: "up" | "down" | null;
}

export interface AlertTable {
  columns: { label: string; align: "left" | "right" }[];
  /** Cells in column order, already formatted. */
  rows: string[][];
  /** "78 more on the Inventory tab", when the list was capped. */
  note: string | null;
}

export interface OverviewData {
  branch_id: string;
  branch_name: string;
  date_from: string;
  date_to: string;
  /** The window this one is scored against — shown when an alert explains its working. */
  previous_date_from: string;
  previous_date_to: string;
  overall_score: number | null;
  status: HealthStatus | null;
  scored_weight: number;
  dimensions: DimensionScore[];
  alerts: HealthAlert[];
}

export const EVIDENCE_LABEL: Record<EvidenceTarget, string> = {
  revenue: "View Revenue",
  cost: "View Cost",
  inventory: "View Inventory",
  customer: "View Customer",
  warnings: "Open Data Quality",
  checking: "Open Checking",
  import: "Open Import",
};

export interface KpiValue {
  value: number;
  previous_value: number;
  delta_pct: number | null;
}

export function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}

export function formatShortDate(iso: string, full = false): string {
  const parsed = new Date(`${iso}T00:00:00`);
  return parsed.toLocaleDateString(
    undefined,
    full
      ? { month: "short", day: "numeric", year: "numeric" }
      : { month: "short", day: "numeric" },
  );
}

export function dateRangeLabel(dateFrom: string, dateTo: string): string {
  return dateFrom === dateTo
    ? formatShortDate(dateFrom, true)
    : `${formatShortDate(dateFrom, true)} – ${formatShortDate(dateTo, true)}`;
}

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// --- Summary Dashboard Interfaces ---

export interface SummaryKpis {
  net_revenue: number;
  gross_profit: number;
  profit_margin_pct: number;
  transaction_count: number;
  avg_sale: number;
  quantity_sold: number;
  selling_sku_count: number;
  dead_stock_count: number;
  active_stock_count: number;
  total_products_count: number;
  dead_stock_pct: number;
}

export interface CategoryRevenueItem {
  category: string;
  net_revenue: number;
  share_pct: number;
}

export interface InventoryConditionData {
  dead_stock_count: number;
  active_stock_count: number;
  total_products_count: number;
  dead_stock_pct: number;
  risk_alert: string;
}

export interface HourlyDemandPoint {
  hour: string;
  count: number;
  net_revenue: number;
}

export interface FootfallCell {
  weekday: number;
  hour_band: string;
  transaction_count: number;
}

export interface CustomerDemandData {
  summary: string;
  peak_period: string;
  peak_hour_desc: string;
  busiest_hour: FootfallCell | null;
  hourly: HourlyDemandPoint[];
  footfall_heatmap: FootfallCell[];
}

export interface TopProductSummary {
  stock_code: string;
  description: string;
  qty: number;
  net_revenue: number;
  avg_selling_price: number | null;
}

export interface SummaryDashboardData {
  branch_id: string;
  branch_name: string;
  period: string;
  date_from: string;
  date_to: string;
  as_of: string | null;
  kpis: SummaryKpis;
  category_revenue: CategoryRevenueItem[];
  inventory_condition: InventoryConditionData;
  customer_demand: CustomerDemandData;
  top_products: TopProductSummary[];
}

export function formatCompactMmk(val: number): string {
  if (Math.abs(val) >= 1_000_000) {
    const m = val / 1_000_000;
    return `${m >= 10 ? m.toFixed(2) : m.toFixed(2)}M`;
  }
  if (Math.abs(val) >= 1_000) {
    return `${(val / 1_000).toFixed(1)}K`;
  }
  return val.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function parseIsoDate(isoStr: string): Date {
  if (!isoStr) return new Date(NaN);
  const clean = isoStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    return new Date(`${clean}T00:00:00`);
  }
  return new Date(clean);
}

export function formatExecutiveDate(isoStr: string): string {
  const d = parseIsoDate(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const day = d.getDate();
  const month = d.toLocaleDateString("en-GB", { month: "short" });
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

export function formatExecutivePeriod(fromIso: string, toIso: string): string {
  const fromD = parseIsoDate(fromIso);
  const toD = parseIsoDate(toIso);
  if (isNaN(fromD.getTime()) || isNaN(toD.getTime())) {
    return `${fromIso}–${toIso}`;
  }
  const fromDay = fromD.getDate();
  const fromMonth = fromD.toLocaleDateString("en-GB", { month: "short" });
  const toDay = toD.getDate();
  const toMonth = toD.toLocaleDateString("en-GB", { month: "short" });
  const toYear = toD.getFullYear();

  if (fromIso === toIso) {
    return `${fromDay} ${fromMonth} ${toYear}`;
  }
  if (fromD.getFullYear() === toD.getFullYear() && fromMonth === toMonth) {
    return `${fromDay}–${toDay} ${toMonth} ${toYear}`;
  }
  return `${fromDay} ${fromMonth}–${toDay} ${toMonth} ${toYear}`;
}
