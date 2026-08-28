import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
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
  | { type: 'search'; keys: (keyof T)[]; placeholder?: string }
  | { type: 'select'; key: keyof T; label: string; options?: string[] }
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
}

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
  emptyDescription
}: Props<T>): React.JSX.Element {
  const showToast = useToast()
  const [rows, setRows] = useState<T[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const { aboveRef, containerStyle } = useStickyAbove()

  const [search, setSearch] = useState('')
  const [selectValues, setSelectValues] = useState<Record<string, string>>({})
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const dateRangeFilter = filters?.find((f) => f.type === 'dateRange')
  const serverParam = dateRangeFilter?.type === 'dateRange' ? dateRangeFilter.serverParam : undefined

  async function load(): Promise<void> {
    setLoading(true)
    setLoadFailed(false)
    try {
      let url = `${apiBaseUrl}${endpoint}`
      if (serverParam) {
        const params = new URLSearchParams()
        if (dateFrom) params.set(serverParam.from, dateFrom)
        if (dateTo) params.set(serverParam.to, dateTo)
        const qs = params.toString()
        if (qs) url += `?${qs}`
      }
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load ${title.toLowerCase()}: ${response.status}`)
        return
      }
      setRows(await response.json())
    } catch {
      setLoadFailed(true)
      showToast('error', `Failed to load ${title.toLowerCase()} — is the backend running?`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token, endpoint, ...(serverParam ? [dateFrom, dateTo] : [])])

  const hasActiveFilters =
    search !== '' || dateFrom !== '' || dateTo !== '' || Object.values(selectValues).some(Boolean)

  function clearFilters(): void {
    setSearch('')
    setDateFrom('')
    setDateTo('')
    setSelectValues({})
  }

  const filteredRows = useMemo(() => {
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
  }, [rows, filters, search, selectValues, dateFrom, dateTo])

  const { page, setPage, totalPages, pageItems, pageSize } = usePagination(filteredRows)

  function handleDownloadCsv(): void {
    if (!filteredRows || filteredRows.length === 0) return
    downloadCsv(
      `${slugify(title)}.csv`,
      columns.map((col) => col.label),
      filteredRows.map((row) => columns.map((col) => toCsvValue(row[col.key])))
    )
  }

  function handleDownloadExcel(): void {
    if (!filteredRows || filteredRows.length === 0) return
    downloadExcel(
      `${slugify(title)}.xlsx`,
      title,
      columns.map((col) => col.label),
      filteredRows.map((row) => columns.map((col) => toCsvValue(row[col.key])))
    )
  }

  return (
    <div className="flex flex-col" style={containerStyle}>
      <div ref={aboveRef} className="sticky top-14 lg:top-0 z-30 bg-bg-subtle">
        <CardHeader
          title={title}
          description={description}
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

        {filters && filters.length > 0 && rows && rows.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 pb-4 -mt-1">
            {filters.map((filter) => {
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
                const options = filter.options ?? distinctValues(rows, filter.key)
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

      {rows === null && loading && <TableSkeleton rows={6} cols={columns.length} />}

      {rows === null && !loading && loadFailed && (
        <EmptyState
          icon={icon}
          title={`Couldn't load ${title.toLowerCase()}`}
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      )}

      {rows !== null && rows.length === 0 && (
        <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} />
      )}

      {rows !== null && rows.length > 0 && filteredRows !== null && filteredRows.length === 0 && (
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

      {filteredRows !== null && filteredRows.length > 0 && pageItems && (
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

export default SimpleDataTable
