import { useState } from 'react'
import type { Session } from '@renderer/lib/auth'
import { useCachedFetch } from '@renderer/lib/useCachedFetch'
import { Button } from '@renderer/components/ui/Button'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { Skeleton } from '@renderer/components/ui/Skeleton'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { DashboardIcon } from '@renderer/components/ui/icons'
import {
  RefreshingHint,
  ChartViewToggle,
  StatTile,
  TrendChart,
  WarningsTile,
  WeekdayHourHeatmap,
  type ChartView
} from './shared'
import {
  dashboardUrl,
  WEEKDAY_LABELS,
  formatCount,
  formatPercent,
  previousPeriodLabel,
  type KpiValue,
  type PeriodKey,
  type SaleWarningRow
} from './helpers'

interface TransactionCountPoint {
  date: string
  transaction_count: number
}

interface FootfallCell {
  weekday: number
  hour_band: string
  transaction_count: number
}

interface HistogramBucket {
  items: number
  count: number
}

interface CustomerDashboardData {
  branch_name: string
  avg_items_per_basket: KpiValue
  single_item_basket_share_pct: KpiValue
  busiest_hour: FootfallCell | null
  footfall_heatmap: FootfallCell[]
  transaction_count_trend: TransactionCountPoint[]
  items_per_basket_histogram: HistogramBucket[]
  sale_warnings: SaleWarningRow[]
}

function histogramLabel(items: number): string {
  return items >= 6 ? '6+' : String(items)
}

function ItemsPerBasketHistogram({ buckets }: { buckets: HistogramBucket[] }): React.JSX.Element {
  const total = buckets.reduce((sum, b) => sum + b.count, 0)
  if (total === 0) {
    return <p className="text-sm text-text-muted">No transactions in this period.</p>
  }
  const maxCount = Math.max(...buckets.map((b) => b.count), 0)
  return (
    <div className="flex flex-col gap-2.5">
      {buckets.map((bucket) => (
        <div key={bucket.items} className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-sm text-text-secondary">{histogramLabel(bucket.items)}</span>
          <div className="flex-1 h-2.5 rounded-full bg-bg-raised overflow-hidden">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: maxCount > 0 ? `${(bucket.count / maxCount) * 100}%` : '0%' }}
            />
          </div>
          <span className="w-28 shrink-0 text-right text-sm tabular-nums text-text-primary">
            {bucket.count.toLocaleString()} ({((bucket.count / total) * 100).toFixed(0)}%)
          </span>
        </div>
      ))}
    </div>
  )
}

interface Props {
  session: Session
  branchId: string
  period: PeriodKey
  dateFrom: string
  dateTo: string
  canLoad: boolean
  onViewWarnings: () => void
}

export function CustomerTab({ session, branchId, period, dateFrom, dateTo, canLoad, onViewWarnings }: Props): React.JSX.Element {
  const [trendView, setTrendView] = useState<ChartView>('bar')
  // One cached request per (tab, branch, period) — returning to this tab with the same
  // selection shows the numbers it showed last time instead of a skeleton. See
  // lib/useCachedFetch.ts.
  const url = canLoad ? dashboardUrl('customer', branchId, { period, dateFrom, dateTo }) : null
  const { data, isRefreshing, failed, reload } = useCachedFetch<CustomerDashboardData>(url, session, 'Customer dashboard')

  if (!canLoad) return <></>

  if (data === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load the Customer dashboard"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      )
    }
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-48" />
      </div>
    )
  }

  const busiest = data.busiest_hour

  return (
    <div className="flex flex-col gap-4">
      <RefreshingHint show={isRefreshing} />
      <p className="text-sm text-text-muted">
        Shopping patterns, not customer identity — the retail POS data has no customer identifier, so this looks at
        how people shop (transactions and visits) instead of who they are.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile
          label="Average Items per Transaction"
          value={data.avg_items_per_basket.value.toFixed(1)}
          deltaPct={data.avg_items_per_basket.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
        <StatTile
          label="Single-Item Transaction Share"
          value={formatPercent(data.single_item_basket_share_pct.value)}
          deltaPct={data.single_item_basket_share_pct.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
        <StatTile
          label="Busiest Hour"
          value={busiest ? `${WEEKDAY_LABELS[busiest.weekday]} ${busiest.hour_band}` : '—'}
          sub={busiest ? `${busiest.transaction_count.toLocaleString()} transactions` : 'No transactions in this period'}
        />
      </div>

      <Card>
        <CardHeader
          title="Transaction trend"
          description="Number of transactions per day — the day-by-day footfall trend behind the Busy Hours pattern below."
          action={<ChartViewToggle view={trendView} onChange={setTrendView} />}
        />
        <TrendChart
          points={data.transaction_count_trend}
          getValue={(p) => p.transaction_count}
          formatValue={formatCount}
          ariaLabel="Daily transaction count"
          view={trendView}
        />
      </Card>

      <Card>
        <CardHeader
          title="Busy hours by day & hour"
          description="Transaction count by weekday and time of day — a more direct 'how busy was the store' signal than revenue concentration."
        />
        <WeekdayHourHeatmap
          cells={data.footfall_heatmap}
          getValue={(c) => c.transaction_count}
          formatValue={(v) => `${v.toLocaleString()} transactions`}
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card>
          <CardHeader
            title="Items per transaction"
            description="Distribution of line-item counts behind the average above."
          />
          <ItemsPerBasketHistogram buckets={data.items_per_basket_histogram} />
        </Card>
        <Card>
          <CardHeader title="Sale data quality" description="Bad values on sale lines in the selected period." />
          <WarningsTile warnings={data.sale_warnings} label="Sale" onViewWarnings={onViewWarnings} />
        </Card>
      </div>
    </div>
  )
}

export default CustomerTab
