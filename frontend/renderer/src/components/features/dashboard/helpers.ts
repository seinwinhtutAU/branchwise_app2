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
