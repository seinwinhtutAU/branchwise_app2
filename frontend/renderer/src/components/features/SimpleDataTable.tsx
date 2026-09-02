import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useCachedFetch } from '@renderer/lib/useCachedFetch'
import { useToast } from '@renderer/lib/useToast'
import { useSettled } from '@renderer/lib/useSettled'
import { cn } from '@renderer/lib/utils'
import { downloadCsv } from '@renderer/lib/csv'
import { downloadExcel } from '@renderer/lib/excel'
import { distinctValues, inDateRange, matchesSearch } from '@renderer/lib/filters'
import { Button } from '@renderer/components/ui/Button'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { Pagination } from '@renderer/components/ui/Pagination'
import { DownloadIcon } from '@renderer/components/ui/icons'
import { useStickyAbove } from '@renderer/lib/useStickyAbove'
import { usePagination } from '@renderer/lib/usePagination'

export interface DataTableColumn<T> {
  key: keyof T
  label: string
  align?: 'right'
  format?: (value: T[keyof T]) => string
}

export type DataTableFilter<T> =
  | {
      type: 'search'
      keys: (keyof T)[]
      placeholder?: string
      /** serverPaged only — the query param this search is sent as (see Props.serverPaged). */
      serverParam?: string
    }
  | {
      type: 'select'
      key: keyof T
      label: string
      options?: string[]
      /** serverPaged only — the query param this filter is sent as (see Props.serverPaged). */
      serverParam?: string
    }
  | {
      type: 'dateRange'
      key: keyof T
      label: string
      /**
       * When set, the date range is sent to the server as these query param
       * names (e.g. `{ from: 'date_from', to: 'date_to' }`) instead of only
       * filtering client-side — for endpoints whose backing table grows
       * without bound (sales, purchases), so the browser isn't asked to load
       * the entire history on every visit.
       */
      serverParam?: { from: string; to: string }
    }

interface ServerPage<T> {
  rows: T[]
  total: number
}

interface Props<T extends object> {
  session: Session
  endpoint: string
  title: string
  description: string
  icon: ReactNode
  columns: DataTableColumn<T>[]
  filters?: DataTableFilter<T>[]
  rowKey: (row: T, index: number) => string
  emptyTitle: string
  emptyDescription: string
  /**
   * Pre-fills the dateRange filter's "from" field on first load, for endpoints that
   * default to a recent window server-side when no date_from is sent (see the
   * `serverParam` doc on DataTableFilter). Purely a starting point — the user can still
   * clear or widen it same as any other filter value.
   */
  defaultWindowDays?: number
  /**
   * Fetches and paginates one page of rows at a time from the server (endpoint must
   * return `{ rows, total }` and accept `page`/`page_size`, plus every filter's
   * `serverParam`, and an `export=true` override for CSV/Excel that ignores paging) —
   * instead of the default, which loads the whole result set once and pages/filters it
   * in memory. Turn this on only for a backing table that grows without bound (sales,
   * purchases); a small one (like Inventory's latest-snapshot table) is already cheap
   * enough that the default is simpler and just as fast.
   */
  serverPaged?: boolean
  /**
   * Set false to skip the title/description heading entirely — for a caller that
   * already shows its own heading just above (e.g. a tabbed page whose tab label
   * already says what this table is), so the two don't repeat each other. `title`/
   * `description` are still used for the CSV/Excel filename and the error-toast label
   * either way. Defaults true.
   */
  showHeading?: boolean
  /**
   * Set false to skip just the title line (keeping the description and the action
   * row) — for a caller whose tab label already names this table but whose
   * `description` still adds something the tab label doesn't say. Ignored when
   * `showHeading` is false. Defaults true.
   */
  showTitle?: boolean
}

const PAGE_SIZE = 50
const FILTER_SETTLE_MS = 400

function defaultFormat(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return String(value)
}

function toCsvValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// Matches the backend's own "date_from = today - (days - 1)" so the pre-filled date
// picker reflects exactly what an unfiltered request would already return.
function daysAgoIso(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() - (days - 1))
  return date.toISOString().slice(0, 10)
}

export function SimpleDataTable<T extends object>({
  session,
  endpoint,
  title,
  description,
  icon,
  columns,
  filters,
  rowKey,
  emptyTitle,
  emptyDescription,
  defaultWindowDays,
  serverPaged,
  showHeading = true,
  showTitle = true
}: Props<T>): React.JSX.Element {
  const showToast = useToast()
  const { aboveRef, containerStyle } = useStickyAbove()

  const [search, setSearch] = useState('')
  const [selectValues, setSelectValues] = useState<Record<string, string>>({})
  const [dateFrom, setDateFrom] = useState(() =>
    defaultWindowDays ? daysAgoIso(defaultWindowDays) : ''
  )
  const [dateTo, setDateTo] = useState('')
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState<'csv' | 'excel' | null>(null)

  const dateRangeFilter = filters?.find((f) => f.type === 'dateRange')
  const dateServerParam = dateRangeFilter?.type === 'dateRange' ? dateRangeFilter.serverParam : undefined
  const searchFilter = filters?.find((f) => f.type === 'search')
  const searchServerParam = searchFilter?.type === 'search' ? searchFilter.serverParam : undefined

  // Settled (debounced) versions of the free-typed filters — see useSettled. Only
  // matters for serverPaged, where these feed the fetch URL; harmless to compute either
  // way since a value nobody reads costs nothing.
  const settledSearch = useSettled(search, FILTER_SETTLE_MS)
  const settledDateFrom = useSettled(dateFrom, FILTER_SETTLE_MS)
  const settledDateTo = useSettled(dateTo, FILTER_SETTLE_MS)

  function buildServerParams(extra?: Record<string, string>): URLSearchParams {
    const params = new URLSearchParams()
    if (dateServerParam) {
      if (settledDateFrom) params.set(dateServerParam.from, settledDateFrom)
      if (settledDateTo) params.set(dateServerParam.to, settledDateTo)
    }
    if (searchServerParam && settledSearch) params.set(searchServerParam, settledSearch)
    if (filters) {
      for (const filter of filters) {
        if (filter.type !== 'select' || !filter.serverParam) continue
        const value = selectValues[String(filter.key)]
        if (value) params.set(filter.serverParam, value)
      }
    }
    if (extra) for (const [key, value] of Object.entries(extra)) params.set(key, value)
    return params
  }

  // The server-side date range is part of the URL and therefore part of the cache key;
  // the search box and the select filters are not (in the default, non-serverPaged
  // mode) because they narrow the rows this component already has without going back to
  // the server.
  let url = `${apiBaseUrl}${endpoint}`
  if (serverPaged) {
    const params = buildServerParams({ page: String(page), page_size: String(PAGE_SIZE) })
    url += `?${params.toString()}`
  } else if (dateServerParam) {
    const params = new URLSearchParams()
    if (dateFrom) params.set(dateServerParam.from, dateFrom)
    if (dateTo) params.set(dateServerParam.to, dateTo)
    const query = params.toString()
    if (query) url += `?${query}`
  }
  const { data, isRefreshing, failed, reload } = useCachedFetch<T[] | ServerPage<T>>(
    url,
    session,
    title.toLowerCase()
  )
  const rows = data === null ? null : serverPaged ? (data as ServerPage<T>).rows : (data as T[])
  const total = serverPaged ? (data as ServerPage<T> | null)?.total ?? 0 : null

  // Resets to page 1 whenever a settled filter changes — otherwise narrowing the result
  // set can strand the user on a now-empty page.
  useEffect(() => {
    if (serverPaged) setPage(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPaged, settledSearch, settledDateFrom, settledDateTo, JSON.stringify(selectValues)])

  const hasActiveFilters =
    search !== '' || dateFrom !== '' || dateTo !== '' || Object.values(selectValues).some(Boolean)

  function clearFilters(): void {
    setSearch('')
    setDateFrom('')
    setDateTo('')
    setSelectValues({})
  }

  // Only used in the default (non-serverPaged) mode — serverPaged rows are already
  // exactly one filtered, paginated page as the backend sent them.
  const filteredRows = useMemo(() => {
    if (serverPaged) return rows
    if (!rows) return null
    if (!filters || filters.length === 0) return rows
    return rows.filter((row) =>
      filters.every((filter) => {
        if (filter.type === 'search') {
          return !search || filter.keys.some((key) => matchesSearch(row[key], search))
        }
        if (filter.type === 'select') {
          const selected = selectValues[String(filter.key)]
          return !selected || String(row[filter.key] ?? '') === selected
        }
        return inDateRange(row[filter.key], { from: dateFrom, to: dateTo })
      })
    )
  }, [rows, filters, search, selectValues, dateFrom, dateTo, serverPaged])

  const clientPagination = usePagination(serverPaged ? null : filteredRows)
  const totalPages = serverPaged ? Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE)) : clientPagination.totalPages
  const pageItems = serverPaged ? rows : clientPagination.pageItems
  const pageSize = serverPaged ? PAGE_SIZE : clientPagination.pageSize
  const currentPage = serverPaged ? page : clientPagination.page
  const totalItems = serverPaged ? total ?? 0 : filteredRows?.length ?? 0
  const setCurrentPage = serverPaged ? setPage : clientPagination.setPage

  // Snaps back to the last real page if a background refresh shrinks the result set out
  // from under the page the user is sitting on.
  useEffect(() => {
    if (serverPaged && page > totalPages) setPage(totalPages)
  }, [serverPaged, page, totalPages])

  function csvRows(source: T[]): string[][] {
    return source.map((row) => columns.map((col) => toCsvValue(row[col.key])))
  }

  async function fetchAllForExport(): Promise<T[] | null> {
    const params = buildServerParams({ export: 'true' })
    try {
      const response = await fetch(`${apiBaseUrl}${endpoint}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) throw new Error(String(response.status))
      const body = (await response.json()) as ServerPage<T>
      return body.rows
    } catch {
      showToast('error', `Failed to prepare the export — is the backend running?`)
      return null
    }
  }

  async function handleDownloadCsv(): Promise<void> {
    if (serverPaged) {
      if (totalItems === 0) return
      setExporting('csv')
      const allRows = await fetchAllForExport()
      setExporting(null)
      if (!allRows) return
      downloadCsv(`${slugify(title)}.csv`, columns.map((col) => col.label), csvRows(allRows))
      return
    }
    if (!filteredRows || filteredRows.length === 0) return
    downloadCsv(`${slugify(title)}.csv`, columns.map((col) => col.label), csvRows(filteredRows))
  }

  async function handleDownloadExcel(): Promise<void> {
    if (serverPaged) {
      if (totalItems === 0) return
      setExporting('excel')
      const allRows = await fetchAllForExport()
      setExporting(null)
      if (!allRows) return
      downloadExcel(`${slugify(title)}.xlsx`, title, columns.map((col) => col.label), csvRows(allRows))
      return
    }
    if (!filteredRows || filteredRows.length === 0) return
    downloadExcel(`${slugify(title)}.xlsx`, title, columns.map((col) => col.label), csvRows(filteredRows))
  }

  const showFilterBar = serverPaged
    ? filters && filters.length > 0 && (totalItems > 0 || hasActiveFilters)
    : filters && filters.length > 0 && rows && rows.length > 0

  const actionButtons = (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleDownloadCsv}
        disabled={serverPaged ? totalItems === 0 : !filteredRows || filteredRows.length === 0}
        loading={exporting === 'csv'}
      >
        <DownloadIcon className="w-4 h-4" />
        CSV
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleDownloadExcel}
        disabled={serverPaged ? totalItems === 0 : !filteredRows || filteredRows.length === 0}
        loading={exporting === 'excel'}
      >
        <DownloadIcon className="w-4 h-4" />
        Excel
      </Button>
      <Button variant="secondary" size="sm" onClick={reload} loading={isRefreshing}>
        Refresh
      </Button>
    </div>
  )

  return (
    <div className="flex flex-col" style={containerStyle}>
      <div ref={aboveRef} className="sticky top-14 lg:top-0 z-30 bg-bg-subtle">
        {showHeading ? (
          <CardHeader
            title={showTitle ? title : undefined}
            description={description}
            action={actionButtons}
          />
        ) : (
          <div className="flex items-center justify-end gap-2 mb-4">{actionButtons}</div>
        )}

        {showFilterBar && (
          <div className="flex flex-wrap items-end gap-3 pb-4 -mt-1">
            {filters!.map((filter) => {
              if (filter.type === 'search') {
                return (
                  <Input
                    key="search"
                    label="Search"
                    placeholder={filter.placeholder ?? 'Search…'}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-56"
                  />
                )
              }
              if (filter.type === 'select') {
                const options = filter.options ?? (rows ? distinctValues(rows, filter.key) : [])
                if (options.length <= 1) return null
                return (
                  <div key={String(filter.key)} className="w-40">
                    <Select
                      label={filter.label}
                      value={selectValues[String(filter.key)] ?? ''}
                      onChange={(e) =>
                        setSelectValues((prev) => ({ ...prev, [String(filter.key)]: e.target.value }))
                      }
                    >
                      <option value="">All</option>
                      {options.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </Select>
                  </div>
                )
              }
              return (
                <div key={String(filter.key)} className="flex items-end gap-2">
                  <Input
                    type="date"
                    label={`${filter.label} from`}
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                  <Input
                    type="date"
                    label={`${filter.label} to`}
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              )
            })}
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>

      {rows === null && !failed && <TableSkeleton rows={6} cols={columns.length} />}

      {rows === null && failed && (
        <EmptyState
          icon={icon}
          title={`Couldn't load ${title.toLowerCase()}`}
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      )}

      {rows !== null && totalItems === 0 && !hasActiveFilters && (
        <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />
      )}

      {rows !== null && totalItems === 0 && hasActiveFilters && (
        <EmptyState
          icon={icon}
          title="No rows match your filters"
          description="Try widening the date range or clearing a filter."
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}

      {pageItems !== null && pageItems.length > 0 && (
        <>
          <TableContainer
            className="overflow-y-auto border-0 rounded-none"
            style={{ maxHeight: 'calc(100vh - var(--sticky-offset, 0px) - 5rem)' }}
          >
            <Thead className="top-0">
              <Tr>
                {columns.map((col) => (
                  <Th key={String(col.key)} className={col.align === 'right' ? 'text-right' : undefined}>
                    {col.label}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {pageItems.map((row, i) => (
                <Tr key={rowKey(row, i)}>
                  {columns.map((col) => (
                    <Td
                      key={String(col.key)}
                      className={cn('whitespace-nowrap', col.align === 'right' && 'text-right tabular-nums')}
                    >
                      {(col.format ?? defaultFormat)(row[col.key])}
                    </Td>
                  ))}
                </Tr>
              ))}
            </Tbody>
          </TableContainer>

          <Pagination
            page={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={pageSize}
            onPageChange={setCurrentPage}
          />
        </>
      )}
    </div>
  )
}

export default SimpleDataTable
