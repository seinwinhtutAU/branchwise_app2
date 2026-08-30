import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Skeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { DashboardIcon, InventoryIcon } from '@renderer/components/ui/icons'
import { StatTile, WarningsTile, formatMoney, formatShortDate, type SaleWarningRow } from './shared'

interface CategoryValue {
  category: string
  value: number
}

interface LowStockItem {
  stock_code: string
  description: string
  on_hand_qty: number
  days_left: number
  status: 'Critical' | 'Low' | 'Watch'
}

interface InventoryDashboardData {
  branch_name: string
  as_of: string | null
  sku_count: number
  critical_count: number
  low_count: number
  watch_count: number
  estimated_stock_value: number
  median_days_of_stock: number | null
  stock_value_by_category: CategoryValue[]
  low_stock_items: LowStockItem[]
  warnings: SaleWarningRow[]
}

const STATUS_BADGE_VARIANT: Record<LowStockItem['status'], 'error' | 'warning' | 'info'> = {
  Critical: 'error',
  Low: 'warning',
  Watch: 'info'
}

function CategoryValueList({ categories }: { categories: CategoryValue[] }): React.JSX.Element {
  if (categories.length === 0) {
    return <p className="text-sm text-text-muted">No categorized stock value yet.</p>
  }
  const maxValue = Math.max(...categories.map((c) => c.value), 0)
  return (
    <div className="flex flex-col gap-2.5">
      {categories.map((row) => (
        <div key={row.category} className="flex items-center gap-3">
          <span className="w-28 shrink-0 truncate text-sm text-text-secondary" title={row.category}>
            {row.category}
          </span>
          <div className="flex-1 h-2.5 rounded-full bg-bg-raised overflow-hidden">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: maxValue > 0 ? `${(row.value / maxValue) * 100}%` : '0%' }}
            />
          </div>
          <span className="w-24 shrink-0 text-right text-sm tabular-nums text-text-primary">
            {formatMoney(row.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function LowStockTable({ items }: { items: LowStockItem[] }): React.JSX.Element {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<InventoryIcon />}
        title="Nothing running low"
        description="No product is estimated to run out soon based on recent sales velocity."
      />
    )
  }
  return (
    <TableContainer>
      <Thead>
        <Tr>
          <Th>Status</Th>
          <Th>Stock Code</Th>
          <Th>Description</Th>
          <Th className="text-right">On Hand Qty</Th>
          <Th className="text-right">Est. Days Left</Th>
        </Tr>
      </Thead>
      <Tbody>
        {items.map((item) => (
          <Tr key={item.stock_code}>
            <Td>
              <Badge variant={STATUS_BADGE_VARIANT[item.status]}>{item.status}</Badge>
            </Td>
            <Td className="font-mono text-xs whitespace-nowrap">{item.stock_code}</Td>
            <Td>{item.description}</Td>
            <Td className="text-right tabular-nums">{item.on_hand_qty.toLocaleString()}</Td>
            <Td className="text-right tabular-nums">{item.days_left}</Td>
          </Tr>
        ))}
      </Tbody>
    </TableContainer>
  )
}

interface Props {
  session: Session
  branchId: string
  canLoad: boolean
  onViewWarnings: () => void
}

export function InventoryTab({ session, branchId, canLoad, onViewWarnings }: Props): React.JSX.Element {
  const showToast = useToast()
  const [data, setData] = useState<InventoryDashboardData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  async function load(): Promise<void> {
    if (!canLoad) return
    setLoadFailed(false)
    try {
      const params = new URLSearchParams()
      if (branchId) params.set('branch_id', branchId)
      const qs = params.toString()
      const response = await fetch(`${apiBaseUrl}/api/dashboard/inventory${qs ? `?${qs}` : ''}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load the Inventory dashboard: ${response.status}`)
        return
      }
      setData(await response.json())
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load the Inventory dashboard — is the backend running?')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token, branchId])

  if (!canLoad) return <></>

  if (data === null) {
    if (loadFailed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load the Inventory dashboard"
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
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-48" />
      </div>
    )
  }

  const lowStockCount = data.critical_count + data.low_count + data.watch_count

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        {data.as_of
          ? `Current stock as of the latest inventory snapshot — ${formatShortDate(data.as_of.slice(0, 10), true)}.`
          : 'No inventory snapshot on record for this branch yet.'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <StatTile label="SKUs Tracked" value={data.sku_count.toLocaleString()} />
        <StatTile
          label="Low / Critical Stock"
          value={lowStockCount.toLocaleString()}
          sub={`${data.critical_count} critical, ${data.low_count} low, ${data.watch_count} watch`}
        />
        <StatTile label="Estimated Stock Value" value={formatMoney(data.estimated_stock_value)} />
        <StatTile
          label="Median Days of Stock"
          value={data.median_days_of_stock === null ? '—' : data.median_days_of_stock.toFixed(1)}
          sub="Based on the last 30 days' sales"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <Card>
          <CardHeader title="Stock value by category" description="Estimated on-hand value, grouped by product category." />
          <CategoryValueList categories={data.stock_value_by_category} />
        </Card>
        <Card>
          <CardHeader
            title="Inventory data quality"
            description="Bad values, missing records, and reconciliation mismatches for this branch."
          />
          <WarningsTile warnings={data.warnings} label="Inventory" onViewWarnings={onViewWarnings} />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Low stock"
          description="Estimated to run out soonest, based on the last 30 days' sales velocity."
        />
        <LowStockTable items={data.low_stock_items} />
      </Card>
    </div>
  )
}

export default InventoryTab
