import { apiBaseUrl } from '@renderer/lib/supabaseClient'

// Non-component helpers shared by the dashboard tabs. Kept apart from shared.tsx
// (components only) so Vite Fast Refresh can hot-swap that file in dev — a module
// that exports both components and plain values/functions can't be refreshed in place.

export type PeriodKey = 'today' | 'yesterday' | '7d' | '30d'

export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' }
]

// `dateFrom`/`dateTo` (a custom range, both set) always wins over `period` — matches
// the backend's own resolve_period rule (app/services/dashboard.py).
export function previousPeriodLabel(period: PeriodKey, dateFrom?: string, dateTo?: string): string {
  if (dateFrom && dateTo) return 'vs the same-length period right before it'
  switch (period) {
    case 'today':
      return 'vs yesterday'
    case 'yesterday':
      return 'vs the day before'
    case '7d':
      return 'vs the previous 7 days'
    case '30d':
      return 'vs the previous 30 days'
  }
}

// Builds the period/date query params shared by every period-scoped dashboard tab
// (Revenue, Cost, Customer — Inventory has no period control at all).
export function periodQueryParams(period: PeriodKey, dateFrom: string, dateTo: string): URLSearchParams {
  const params = new URLSearchParams()
  if (dateFrom && dateTo) {
    params.set('date_from', dateFrom)
    params.set('date_to', dateTo)
  } else {
    params.set('period', period)
  }
  return params
}

// The one place a dashboard tab's request URL is built. It doubles as the cache key in
// useCachedFetch, so every parameter that changes what comes back has to appear in it —
// which is exactly why building it here rather than inline in five tabs matters.
export function dashboardUrl(
  tab: 'overview' | 'revenue' | 'cost' | 'inventory' | 'customer',
  branchId: string,
  // Omitted for Inventory, which has no period control at all.
  window?: { period: PeriodKey; dateFrom: string; dateTo: string }
): string {
  const params = window
    ? periodQueryParams(window.period, window.dateFrom, window.dateTo)
    : new URLSearchParams()
  if (branchId) params.set('branch_id', branchId)
  const query = params.toString()
  return `${apiBaseUrl}/api/dashboard/${tab}${query ? `?${query}` : ''}`
}

// --- the Overview payload (GET /api/dashboard/overview) ------------------------------
// Shared by the Overview tab and the Alerts tab, so they read one definition of the
// shape rather than two that can drift.

export type HealthStatus = 'healthy' | 'needs_attention' | 'critical'
export type AlertSeverity = 'critical' | 'warning'

/** Which tab holds the evidence behind a score or an alert. */
export type EvidenceTarget = 'revenue' | 'cost' | 'inventory' | 'customer' | 'warnings'

export interface SubMetric {
  key: string
  label: string
  unit: 'pct' | 'pct_change' | 'pct_points' | 'days' | 'count' | 'rate'
  weight: number
  value: number | null
  score: number | null
  /** One sentence saying what this measures. */
  definition: string
  /** The figures the value was worked out from, or null when it wasn't measurable. */
  calculation: string | null
  /** [value, score] breakpoints — the same table the score was computed against. */
  bands: [number, number][]
}

export interface DimensionScore {
  key: string
  label: string
  description: string
  weight: number
  effective_weight: number | null
  score: number | null
  status: HealthStatus | null
  insufficient_data_reason: string | null
  sub_metrics: SubMetric[]
}

export interface HealthAlert {
  id: string
  severity: AlertSeverity
  dimension: string
  title: string
  summary: string
  what_happened: string
  recommended_action: string
  link: EvidenceTarget
  /** The `SubMetric.key` this alert is about — see the Overview branch page. */
  measure: string
  driver: string | null
  interpretation: string | null
}

export interface OverviewData {
  branch_id: string
  branch_name: string
  date_from: string
  date_to: string
  overall_score: number | null
  status: HealthStatus | null
  scored_weight: number
  dimensions: DimensionScore[]
  alerts: HealthAlert[]
}

export const EVIDENCE_LABEL: Record<EvidenceTarget, string> = {
  revenue: 'View Revenue',
  cost: 'View Cost',
  inventory: 'View Inventory',
  customer: 'View Customer',
  warnings: 'View Warning page'
}

export interface KpiValue {
  value: number
  previous_value: number
  delta_pct: number | null
}

export interface SaleWarningRow {
  note: string
  fields: { label: string; value: string }[]
  highlight: string[]
  source_import: { id: string; filename: string | null; date: string } | null
}

export function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString()
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

export function formatShortDate(iso: string, full = false): string {
  const parsed = new Date(`${iso}T00:00:00`)
  return parsed.toLocaleDateString(
    undefined,
    full ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }
  )
}

export function dateRangeLabel(dateFrom: string, dateTo: string): string {
  return dateFrom === dateTo
    ? formatShortDate(dateFrom, true)
    : `${formatShortDate(dateFrom, true)} – ${formatShortDate(dateTo, true)}`
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
