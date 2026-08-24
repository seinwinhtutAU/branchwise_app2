import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { cn } from '@renderer/lib/utils'
import { downloadCsv } from '@renderer/lib/csv'
import { downloadExcel } from '@renderer/lib/excel'
import { Button } from '@renderer/components/ui/Button'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { Pagination } from '@renderer/components/ui/Pagination'
import { DownloadIcon, OverviewIcon } from '@renderer/components/ui/icons'
import { useStickyAbove } from '@renderer/lib/useStickyAbove'
import { distinctValues, inDateRange, matchesSearch } from '@renderer/lib/filters'
import { usePagination } from '@renderer/lib/usePagination'

interface OverviewRow {
  Branch: string | null
  Date: string
  SlipID: string
  SlipNumber: string
  LineNo: number
  LineID: string
  StockCode: string
  Description: string
  Location: string | null
  Selling_Price: number | null
  Qty: number | null
  UOM: string | null
  Discount_Amount: number | null
  Amount: number | null
  Net_Amount: number | null
  Time: string | null
  Buying_Price: number | null
  Group: string | null
  profit: number | null
  profit_margin_pct: number | null
}

interface Props {
  session: Session
  branchOptions: string[]
}

// green = from sale.csv, blue = from inventory, pink = from purchase.
// A column can light up more than one band (e.g. StockCode appears in all three).
type Band = 'sale' | 'inventory' | 'purchase'

interface ColumnDef {
  key: keyof OverviewRow
  label: string
  bands: Band[]
  align?: 'right'
}

const COLUMNS: ColumnDef[] = [
  { key: 'Branch', label: 'Branch', bands: ['sale'] },
  { key: 'Date', label: 'Date', bands: ['sale'] },
  { key: 'SlipID', label: 'Slip ID', bands: [] },
  { key: 'SlipNumber', label: 'Slip Number', bands: ['sale'] },
  { key: 'LineNo', label: 'Line No', bands: ['sale'], align: 'right' },
  { key: 'LineID', label: 'Line ID', bands: [] },
  { key: 'StockCode', label: 'Stock Code', bands: ['sale', 'inventory', 'purchase'] },
  { key: 'Description', label: 'Description', bands: ['inventory'] },
  { key: 'Location', label: 'Location', bands: ['inventory'] },
  { key: 'Selling_Price', label: 'Selling Price', bands: ['sale'], align: 'right' },
  { key: 'Qty', label: 'Qty', bands: ['sale'], align: 'right' },
  { key: 'UOM', label: 'UOM', bands: ['sale'] },
  { key: 'Discount_Amount', label: 'Discount Amount', bands: ['sale'], align: 'right' },
  { key: 'Amount', label: 'Amount', bands: ['sale'], align: 'right' },
  { key: 'Net_Amount', label: 'Net Amount', bands: ['sale'], align: 'right' },
  { key: 'Time', label: 'Time', bands: ['sale'] },
  { key: 'Buying_Price', label: 'Buying Price', bands: ['inventory', 'purchase'], align: 'right' },
  { key: 'Group', label: 'Group', bands: ['inventory'] },
  { key: 'profit', label: 'Profit', bands: [], align: 'right' },
  { key: 'profit_margin_pct', label: 'Profit Margin %', bands: [], align: 'right' }
]

const BAND_ORDER: Band[] = ['sale', 'inventory', 'purchase']
const BAND_COLOR: Record<Band, string> = {
  sale: 'bg-emerald-400',
  inventory: 'bg-sky-400',
  purchase: 'bg-pink-400'
}
const BAND_LABEL: Record<Band, string> = {
  sale: 'Sale',
  inventory: 'Inventory',
  purchase: 'Purchase'
}

function SourceLegend(): React.JSX.Element {
  return (
    <div className="flex flex-row flex-wrap items-center gap-4 mb-4">
      {BAND_ORDER.map((band) => (
        <div key={band} className="flex items-center gap-1.5">
          <div className={cn('h-3 w-5 rounded-sm', BAND_COLOR[band])} />
          <span className="text-sm text-text-secondary">{BAND_LABEL[band]}</span>
        </div>
      ))}
    </div>
  )
}

function SourceStrip({ bands }: { bands: Band[] }): React.JSX.Element {
  return (
    <div className="flex flex-row gap-1 mb-1.5" aria-hidden="true">
      {BAND_ORDER.filter((band) => bands.includes(band)).map((band) => (
        <div key={band} className={cn('h-2.5 w-4 rounded-sm', BAND_COLOR[band])} />
      ))}
    </div>
  )
}

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return '—'
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatCell(col: ColumnDef, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (col.key === 'profit_margin_pct') return `${formatNumber(value as number)}%`
  if (
    ['Selling_Price', 'Qty', 'Discount_Amount', 'Amount', 'Net_Amount', 'Buying_Price', 'profit'].includes(
      col.key
    )
  ) {
    return formatNumber(value as number)
  }
  return String(value)
}

function DataOverviewTable({ session, branchOptions }: Props): React.JSX.Element {
  const showToast = useToast()
  const [rows, setRows] = useState<OverviewRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const { aboveRef, containerStyle } = useStickyAbove()

  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [groupFilter, setGroupFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  async function load(): Promise<void> {
    setLoading(true)
    setLoadFailed(false)
    try {
      const response = await fetch(`${apiBaseUrl}/api/data-overview`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load data overview: ${response.status}`)
        return
      }
      setRows(await response.json())
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load data overview — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token])

  const hasActiveFilters =
    search !== '' || branchFilter !== '' || groupFilter !== '' || dateFrom !== '' || dateTo !== ''

  function clearFilters(): void {
    setSearch('')
    setBranchFilter('')
    setGroupFilter('')
    setDateFrom('')
    setDateTo('')
  }

  const filteredRows = useMemo(() => {
    if (!rows) return null
    return rows.filter(
      (row) =>
        (!search || matchesSearch(row.StockCode, search) || matchesSearch(row.Description, search)) &&
        (!branchFilter || row.Branch === branchFilter) &&
        (!groupFilter || row.Group === groupFilter) &&
        inDateRange(row.Date, { from: dateFrom, to: dateTo })
    )
  }, [rows, search, branchFilter, groupFilter, dateFrom, dateTo])

  const { page, setPage, totalPages, pageItems, pageSize } = usePagination(filteredRows)

  function overviewCsvRows(source: OverviewRow[]): string[][] {
    return source.map((row) =>
      COLUMNS.map((col) => {
        const value = row[col.key]
        return value === null || value === undefined ? '' : String(value)
      })
    )
  }

  function handleDownloadCsv(): void {
    if (!filteredRows || filteredRows.length === 0) return
    downloadCsv('data-overview.csv', COLUMNS.map((col) => col.label), overviewCsvRows(filteredRows))
  }

  function handleDownloadExcel(): void {
    if (!filteredRows || filteredRows.length === 0) return
    downloadExcel(
      'data-overview.xlsx',
      'Data overview',
      COLUMNS.map((col) => col.label),
      overviewCsvRows(filteredRows)
    )
  }

  return (
    <div className="flex flex-col" style={containerStyle}>
      <div ref={aboveRef} className="sticky top-14 lg:top-0 z-30 bg-bg-base">
        <CardHeader
          title="Data overview"
          description="Sale line items merged with inventory and purchase data by stock code."
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownloadCsv}
                disabled={!filteredRows || filteredRows.length === 0}
              >
                <DownloadIcon className="w-4 h-4" />
                CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownloadExcel}
                disabled={!filteredRows || filteredRows.length === 0}
              >
                <DownloadIcon className="w-4 h-4" />
                Excel
              </Button>
              <Button variant="secondary" size="sm" onClick={load} loading={loading}>
                Refresh
              </Button>
            </div>
          }
        />

        <SourceLegend />

        {rows && rows.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 pb-4 -mt-1">
            <Input
              label="Search"
              placeholder="Stock code or description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />

            {(() => {
              const options = branchOptions.length > 0 ? branchOptions : distinctValues(rows, 'Branch')
              return options.length > 1 ? (
                <div className="w-40">
                  <Select label="Branch" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
                    <option value="">All</option>
                    {options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null
            })()}

            {(() => {
              const groupOptions = distinctValues(rows, 'Group')
              return groupOptions.length > 1 ? (
                <div className="w-40">
                  <Select label="Group" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
                    <option value="">All</option>
                    {groupOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null
            })()}

            <div className="flex items-end gap-2">
              <Input type="date" label="Date from" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <Input type="date" label="Date to" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>

      {rows === null && loading && <TableSkeleton rows={6} cols={8} />}

      {rows === null && !loading && loadFailed && (
        <EmptyState
          icon={<OverviewIcon />}
          title="Couldn't load data overview"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      )}

      {rows !== null && rows.length === 0 && (
        <EmptyState
          icon={<OverviewIcon />}
          title="No sales data yet"
          description="Import a sales file to see it here, merged with inventory and purchase data."
        />
      )}

      {rows !== null && rows.length > 0 && filteredRows !== null && filteredRows.length === 0 && (
        <EmptyState
          icon={<OverviewIcon />}
          title="No rows match your filters"
          description="Try widening the date range or clearing a filter."
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}

      {filteredRows !== null && filteredRows.length > 0 && pageItems && (
        <>
          <TableContainer
            className="overflow-y-auto border-0 rounded-none"
            style={{ maxHeight: 'calc(100vh - var(--sticky-offset, 0px) - 5rem)' }}
          >
            <Thead className="top-0">
              <Tr>
                {COLUMNS.map((col) => (
                  <Th key={col.key} className={col.align === 'right' ? 'text-right' : undefined}>
                    <SourceStrip bands={col.bands} />
                    {col.label}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {pageItems.map((row) => (
                <Tr key={row.LineID}>
                  {COLUMNS.map((col) => (
                    <Td
                      key={col.key}
                      className={cn('whitespace-nowrap', col.align === 'right' && 'text-right tabular-nums')}
                    >
                      {formatCell(col, row[col.key])}
                    </Td>
                  ))}
                </Tr>
              ))}
            </Tbody>
          </TableContainer>

          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={filteredRows.length}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  )
}

export default DataOverviewTable
