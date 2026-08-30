import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { Button } from '@renderer/components/ui/Button'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Skeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { DashboardIcon, DollarIcon, WarningIcon } from '@renderer/components/ui/icons'
import {
  StatTile,
  WarningsTile,
  formatMoney,
  formatPercent,
  periodQueryParams,
  previousPeriodLabel,
  type KpiValue,
  type PeriodKey,
  type SaleWarningRow
} from './shared'

interface CostProduct {
  stock_code: string
  description: string
  qty: number
  net_revenue: number
  estimated_cost: number | null
  estimated_margin: number | null
  margin_pct: number | null
}

interface CostDashboardData {
  branch_name: string
  estimated_cogs: KpiValue
  estimated_gross_margin_pct: KpiValue
  estimated_margin_per_basket: KpiValue
  products: CostProduct[]
  purchase_warnings: SaleWarningRow[]
}

function CostProductsTable({ products }: { products: CostProduct[] }): React.JSX.Element {
  if (products.length === 0) {
    return (
      <EmptyState
        icon={<DollarIcon />}
        title="No sales in this period"
        description="Cost and margin by product will appear once there's sales data for the selected period."
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
          <Th className="text-right">Net Revenue</Th>
          <Th className="text-right">Est. Cost</Th>
          <Th className="text-right">Est. Margin</Th>
          <Th className="text-right">Margin %</Th>
        </Tr>
      </Thead>
      <Tbody>
        {products.map((product, i) => (
          <Tr key={product.stock_code}>
            <Td className="text-text-muted">{i + 1}</Td>
            <Td className="font-mono text-xs whitespace-nowrap">{product.stock_code}</Td>
            <Td>{product.description}</Td>
            <Td className="text-right tabular-nums">{formatMoney(product.net_revenue)}</Td>
            <Td className="text-right tabular-nums">
              {product.estimated_cost === null ? '—' : formatMoney(product.estimated_cost)}
            </Td>
            <Td className="text-right tabular-nums">
              {product.estimated_margin === null ? '—' : formatMoney(product.estimated_margin)}
            </Td>
            <Td className="text-right tabular-nums">
              {product.margin_pct === null ? '—' : formatPercent(product.margin_pct)}
            </Td>
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

export function CostTab({ session, branchId, period, dateFrom, dateTo, canLoad, onViewWarnings }: Props): React.JSX.Element {
  const showToast = useToast()
  const [data, setData] = useState<CostDashboardData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  async function load(): Promise<void> {
    if (!canLoad) return
    setLoadFailed(false)
    try {
      const params = periodQueryParams(period, dateFrom, dateTo)
      if (branchId) params.set('branch_id', branchId)
      const response = await fetch(`${apiBaseUrl}/api/dashboard/cost?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load the Cost dashboard: ${response.status}`)
        return
      }
      setData(await response.json())
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load the Cost dashboard — is the backend running?')
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
          title="Couldn't load the Cost dashboard"
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
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-3 rounded-lg bg-warning-subtle p-4">
        <WarningIcon className="w-5 h-5 shrink-0 mt-0.5 text-warning" />
        <p className="text-sm text-text-secondary leading-relaxed">
          <span className="font-medium text-text-primary">Every number on this tab is an estimate</span>, built from
          whichever purchase record or stock count was on file as of each sale — not a guaranteed-accurate cost
          accounting figure. A product with no priced sale lines shows "—" rather than a misleading 0.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile
          label="Estimated Cost of Goods Sold"
          value={formatMoney(data.estimated_cogs.value)}
          deltaPct={data.estimated_cogs.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
        <StatTile
          label="Estimated Gross Margin"
          value={formatPercent(data.estimated_gross_margin_pct.value)}
          deltaPct={data.estimated_gross_margin_pct.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
        <StatTile
          label="Estimated Margin per Transaction"
          value={formatMoney(data.estimated_margin_per_basket.value)}
          deltaPct={data.estimated_margin_per_basket.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Cost & margin by product"
            description="Same top products as Revenue, viewed through a cost lens."
          />
          <CostProductsTable products={data.products} />
        </Card>
        <Card>
          <CardHeader title="Purchase data quality" description="Bad values on purchase lines in the selected period." />
          <WarningsTile warnings={data.purchase_warnings} label="Purchase" onViewWarnings={onViewWarnings} />
        </Card>
      </div>
    </div>
  )
}

export default CostTab
