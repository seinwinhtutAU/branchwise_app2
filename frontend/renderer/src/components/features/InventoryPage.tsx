import { useMemo, useState } from 'react'
import type { Session } from '@renderer/lib/auth'
import { cn } from '@renderer/lib/utils'
import { CardHeader } from '@renderer/components/ui/Card'
import { InventoryIcon } from '@renderer/components/ui/icons'
import { SimpleDataTable, type DataTableColumn, type DataTableFilter } from './SimpleDataTable'

export type InventorySubTab = 'imported' | 'lowStock' | 'deadStock'

interface Props {
  session: Session
  branchOptions: string[]
  // Set only when another section (the dashboard's Inventory tab) sends the user here
  // for a specific list — App.tsx reads this once, on mount, the same way DashboardPage
  // reads its own initialTab; a plain nav click leaves it unset and lands on Imported Data.
  initialTab?: InventorySubTab
}

const SUB_TABS: { id: InventorySubTab; label: string }[] = [
  { id: 'imported', label: 'Imported Data' },
  { id: 'lowStock', label: 'Low Stock' },
  { id: 'deadStock', label: 'Dead Stock' }
]

function InventoryTabBar({
  activeTab,
  onSelect
}: {
  activeTab: InventorySubTab
  onSelect: (tab: InventorySubTab) => void
}): React.JSX.Element {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 p-1 rounded-lg bg-bg-subtle w-fit">
      {SUB_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            'flex items-center gap-1.5 h-8 px-4 rounded-md text-sm font-medium transition-all duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
            activeTab === tab.id
              ? 'bg-brand-subtle text-brand shadow-sm'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

interface InventoryRow {
  Branch: string | null
  Snapshot_At: string
  StockCode: string
  Description: string
  Group: string | null
  On_Hand_Qty: number | null
  Buying_Price: number | null
  Selling_Price: number | null
  Location: string | null
}

const INVENTORY_COLUMNS: DataTableColumn<InventoryRow>[] = [
  { key: 'Branch', label: 'Branch' },
  { key: 'Snapshot_At', label: 'Last Updated' },
  { key: 'StockCode', label: 'Stock Code' },
  { key: 'Description', label: 'Description' },
  { key: 'Group', label: 'Group' },
  { key: 'On_Hand_Qty', label: 'On Hand Qty', align: 'right' },
  { key: 'Buying_Price', label: 'Buying Price', align: 'right' },
  { key: 'Selling_Price', label: 'Selling Price', align: 'right' },
  { key: 'Location', label: 'Location' }
]

interface LowStockRow {
  Branch: string | null
  StockCode: string
  Description: string
  Status: 'Critical' | 'Low' | 'Watch'
  On_Hand_Qty: number
  Days_Left: number
}

const LOW_STOCK_COLUMNS: DataTableColumn<LowStockRow>[] = [
  { key: 'Branch', label: 'Branch' },
  { key: 'Status', label: 'Status' },
  { key: 'StockCode', label: 'Stock Code' },
  { key: 'Description', label: 'Description' },
  { key: 'On_Hand_Qty', label: 'On Hand Qty', align: 'right' },
  { key: 'Days_Left', label: 'Est. Days Left', align: 'right' }
]

interface DeadStockRow {
  Branch: string | null
  StockCode: string
  Description: string
  Category: string | null
  On_Hand_Qty: number
  // Both null together means never sold at all, not just "not recently" — see
  // backend/app/services/dashboard.py's _last_sale_dates.
  Last_Sold_At: string | null
  Days_Since_Last_Sale: number | null
}

function formatDaysUnsold(value: unknown): string {
  return value === null || value === undefined ? 'Never sold' : `${value} days`
}

const DEAD_STOCK_COLUMNS: DataTableColumn<DeadStockRow>[] = [
  { key: 'Branch', label: 'Branch' },
  { key: 'StockCode', label: 'Stock Code' },
  { key: 'Description', label: 'Description' },
  { key: 'Category', label: 'Category' },
  { key: 'On_Hand_Qty', label: 'On Hand Qty', align: 'right' },
  {
    key: 'Days_Since_Last_Sale',
    label: 'Days Unsold',
    align: 'right',
    format: formatDaysUnsold
  }
]

export function InventoryPage({ session, branchOptions, initialTab }: Props): React.JSX.Element {
  const [tab, setTab] = useState<InventorySubTab>(initialTab ?? 'imported')

  const inventoryFilters: DataTableFilter<InventoryRow>[] = useMemo(
    () => [
      {
        type: 'search',
        keys: ['StockCode', 'Description'],
        placeholder: 'Stock code or description'
      },
      { type: 'select', key: 'Branch', label: 'Branch', options: branchOptions },
      { type: 'select', key: 'Group', label: 'Group' },
      { type: 'dateRange', key: 'Snapshot_At', label: 'Last Updated' }
    ],
    [branchOptions]
  )

  const lowStockFilters: DataTableFilter<LowStockRow>[] = useMemo(
    () => [
      {
        type: 'search',
        keys: ['StockCode', 'Description'],
        placeholder: 'Stock code or description',
        serverParam: 'search'
      },
      { type: 'select', key: 'Branch', label: 'Branch', options: branchOptions, serverParam: 'branch' }
    ],
    [branchOptions]
  )

  const deadStockFilters: DataTableFilter<DeadStockRow>[] = useMemo(
    () => [
      {
        type: 'search',
        keys: ['StockCode', 'Description'],
        placeholder: 'Stock code or description',
        serverParam: 'search'
      },
      { type: 'select', key: 'Branch', label: 'Branch', options: branchOptions, serverParam: 'branch' }
    ],
    [branchOptions]
  )

  return (
    <div className="flex flex-col gap-4">
      <CardHeader
        title="Inventory"
        description="Current stock, and the products worth a closer look — running low or not moving."
      />
      <InventoryTabBar activeTab={tab} onSelect={setTab} />

      {tab === 'imported' && (
        <SimpleDataTable<InventoryRow>
          session={session}
          endpoint="/api/inventory"
          title="Inventory"
          description="Current stock on hand, from each product's most recent inventory snapshot."
          icon={<InventoryIcon />}
          columns={INVENTORY_COLUMNS}
          filters={inventoryFilters}
          rowKey={(row, i) => `${row.StockCode}-${row.Branch}-${i}`}
          emptyTitle="No inventory yet"
          emptyDescription="Import an inventory file to see it here."
          showTitle={false}
        />
      )}

      {tab === 'lowStock' && (
        <SimpleDataTable<LowStockRow>
          session={session}
          endpoint="/api/inventory/low-stock"
          title="Low Stock"
          description="Every product estimated to run out soon, based on the last 30 days of sales."
          icon={<InventoryIcon />}
          columns={LOW_STOCK_COLUMNS}
          filters={lowStockFilters}
          rowKey={(row, i) => `${row.StockCode}-${row.Branch}-${i}`}
          emptyTitle="Nothing running low"
          emptyDescription="No product is estimated to run out soon based on recent sales velocity."
          serverPaged
          showTitle={false}
        />
      )}

      {tab === 'deadStock' && (
        <SimpleDataTable<DeadStockRow>
          session={session}
          endpoint="/api/inventory/dead-stock"
          title="Dead Stock"
          description="Everything on hand that hasn't sold in 90 days."
          icon={<InventoryIcon />}
          columns={DEAD_STOCK_COLUMNS}
          filters={deadStockFilters}
          rowKey={(row, i) => `${row.StockCode}-${row.Branch}-${i}`}
          emptyTitle="No dead stock"
          emptyDescription="Nothing on hand has gone 90 days without a sale."
          serverPaged
          showTitle={false}
        />
      )}
    </div>
  )
}

export default InventoryPage
