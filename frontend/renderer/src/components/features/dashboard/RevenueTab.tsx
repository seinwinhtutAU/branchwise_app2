import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { Button } from '@renderer/components/ui/Button'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Skeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { DashboardIcon, SalesIcon } from '@renderer/components/ui/icons'
import {
  ChartViewToggle,
  StatTile,
  TrendChart,
  WarningsTile,
  WeekdayHourHeatmap,
  formatCount,
  formatMoney,
  periodQueryParams,
  previousPeriodLabel,
  type ChartView,
  type KpiValue,
  type PeriodKey,
  type SaleWarningRow
} from './shared'

interface TrendPoint {
  date: string
  net_revenue: number
}

interface TopProduct {
  stock_code: string
  description: string
  qty: number
  net_revenue: number
}

interface HeatmapCell {
  weekday: number
  hour_band: string
  net_revenue: number
}

interface RevenueDashboardData {
  branch_name: string
  net_revenue: KpiValue
  transaction_count: KpiValue
  avg_basket: KpiValue
  trend: TrendPoint[]
  top_products: TopProduct[]
  heatmap: HeatmapCell[]
  sale_warnings: SaleWarningRow[]
}

function TopProductsTable({ products }: { products: TopProduct[] }): React.JSX.Element {
  if (products.length === 0) {
    return (
      <EmptyState
        icon={<SalesIcon />}
        title="No sales in this period"
        description="Top products will appear once there's sales data for the selected period."
      />
    )
  }
  return (
    <TableContainer>
      <Thead>
        <Tr>
          <Th>#</Th>
          <Th>Stock Code</Th>
          <Th>Description</Th>
          <Th className="text-right">Qty</Th>
          <Th className="text-right">Net Revenue</Th>
        </Tr>
      </Thead>
      <Tbody>
        {products.map((product, i) => (
          <Tr key={product.stock_code}>
            <Td className="text-text-muted">{i + 1}</Td>
            <Td className="font-mono text-xs whitespace-nowrap">{product.stock_code}</Td>
            <Td>{product.description}</Td>
            <Td className="text-right tabular-nums">{product.qty.toLocaleString()}</Td>
            <Td className="text-right tabular-nums">{formatMoney(product.net_revenue)}</Td>
          </Tr>
        ))}
      </Tbody>
    </TableContainer>
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

export function RevenueTab({ session, branchId, period, dateFrom, dateTo, canLoad, onViewWarnings }: Props): React.JSX.Element {
  const showToast = useToast()
  const [data, setData] = useState<RevenueDashboardData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [trendView, setTrendView] = useState<ChartView>('bar')

  async function load(): Promise<void> {
    if (!canLoad) return
    setLoadFailed(false)
    try {
      const params = periodQueryParams(period, dateFrom, dateTo)
      if (branchId) params.set('branch_id', branchId)
      const response = await fetch(`${apiBaseUrl}/api/dashboard/revenue?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load the Revenue dashboard: ${response.status}`)
        return
      }
      setData(await response.json())
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load the Revenue dashboard — is the backend running?')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token, period, dateFrom, dateTo, branchId])

  if (!canLoad) return <></>

  if (data === null) {
    if (loadFailed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load the Revenue dashboard"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
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
        <Skeleton className="h-48" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile
          label="Net Revenue"
          value={formatMoney(data.net_revenue.value)}
          deltaPct={data.net_revenue.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
        <StatTile
          label="Transactions"
          value={formatCount(data.transaction_count.value)}
          deltaPct={data.transaction_count.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
        <StatTile
          label="Average Sale Value"
          value={formatMoney(data.avg_basket.value)}
          deltaPct={data.avg_basket.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
      </div>

      <Card>
        <CardHeader
          title="Sales trend"
          description="Daily net revenue over the selected period."
          action={<ChartViewToggle view={trendView} onChange={setTrendView} />}
        />
        <TrendChart
          points={data.trend}
          getValue={(p) => p.net_revenue}
          formatValue={formatMoney}
          ariaLabel="Daily net revenue trend"
          view={trendView}
        />
      </Card>

      <Card>
        <CardHeader
          title="Sales by day & hour"
          description="Revenue concentration by weekday and time of day — useful for staffing decisions."
        />
        <WeekdayHourHeatmap cells={data.heatmap} getValue={(c) => c.net_revenue} formatValue={formatMoney} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card>
          <CardHeader title="Top products" description="Ranked by net revenue in the selected period." />
          <TopProductsTable products={data.top_products} />
        </Card>
        <Card>
          <CardHeader title="Sale data quality" description="Bad values on sale lines in the selected period." />
          <WarningsTile warnings={data.sale_warnings} label="Sale" onViewWarnings={onViewWarnings} />
        </Card>
      </div>
    </div>
  )
}

export default RevenueTab
