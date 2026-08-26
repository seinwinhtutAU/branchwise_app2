import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/Button'
import { Badge } from '@renderer/components/ui/Badge'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { Pagination } from '@renderer/components/ui/Pagination'
import { HistoryIcon, TrashIcon } from '@renderer/components/ui/icons'
import { useStickyAbove } from '@renderer/lib/useStickyAbove'
import { distinctValues, inDateRange } from '@renderer/lib/filters'
import { usePagination } from '@renderer/lib/usePagination'
import type { Profile } from '@renderer/components/features/types'

const RETAIL_REVERT_WINDOW_MS = 24 * 60 * 60 * 1000

function isRetailRevertLocked(row: ImportBatchRow, profile: Profile | null): boolean {
  return (
    profile?.role === 'retail' && Date.now() - new Date(row.created_at).getTime() > RETAIL_REVERT_WINDOW_MS
  )
}

interface ImportBatchRow {
  id: string
  import_type: string
  filename: string | null
  branch_name: string | null
  uploaded_by_name: string | null
  status: string
  summary: Record<string, unknown>
  created_at: string
  reverted_at: string | null
}

interface Props {
  session: Session
  onViewBatch: (batchId: string) => void
  branchOptions: string[]
  profile: Profile | null
  // Set when arriving here from a Warning row's "Source Import" link — scrolls that
  // exact row into view and rings it so it's obvious which one to revert.
  highlightBatchId?: string | null
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

function ImportHistoryTable({
  session,
  onViewBatch,
  branchOptions,
  profile,
  highlightBatchId
}: Props): React.JSX.Element {
  const showToast = useToast()
  const [rows, setRows] = useState<ImportBatchRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const { aboveRef, containerStyle } = useStickyAbove()
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null)

  const [typeFilter, setTypeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  async function load(): Promise<void> {
    setLoading(true)
    setLoadFailed(false)
    try {
      const response = await fetch(`${apiBaseUrl}/api/imports/history`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load history: ${response.status}`)
        return
      }
      setRows(await response.json())
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load history — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token])

  // Only scrolls the row into view if it's on the current (default, unfiltered) page —
  // a highlight from Warnings always arrives with filters cleared and page 1, so this
  // covers the case it's meant for without needing to hunt across pages/filters.
  useEffect(() => {
    if (highlightBatchId && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightBatchId, rows])

  const hasActiveFilters =
    typeFilter !== '' || statusFilter !== '' || branchFilter !== '' || dateFrom !== '' || dateTo !== ''

  function clearFilters(): void {
    setTypeFilter('')
    setStatusFilter('')
    setBranchFilter('')
    setDateFrom('')
    setDateTo('')
  }

  const filteredRows = useMemo(() => {
    if (!rows) return null
    return rows.filter(
      (row) =>
        (!typeFilter || row.import_type === typeFilter) &&
        (!statusFilter || row.status === statusFilter) &&
        (!branchFilter || row.branch_name === branchFilter) &&
        inDateRange(row.created_at, { from: dateFrom, to: dateTo })
    )
  }, [rows, typeFilter, statusFilter, branchFilter, dateFrom, dateTo])

  const { page, setPage, totalPages, pageItems, pageSize } = usePagination(filteredRows)

  async function handleRevert(batchId: string): Promise<void> {
    if (!window.confirm('Revert this import? This deletes the data it created.')) return

    setRevertingId(batchId)
    try {
      const response = await fetch(`${apiBaseUrl}/api/imports/history/${batchId}/revert`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        showToast('error', body?.detail ?? `Revert failed: ${response.status}`)
        return
      }
      await load()
    } catch {
      showToast('error', 'Revert failed — is the backend running?')
    } finally {
      setRevertingId(null)
    }
  }

  return (
    <div className="flex flex-col" style={containerStyle}>
      <div ref={aboveRef} className="sticky top-14 lg:top-0 z-30 bg-bg-base">
        <CardHeader
          title="Import history"
          description="Every confirmed upload, with the option to revert a mistaken one."
          action={
            <Button variant="secondary" size="sm" onClick={load} loading={loading}>
              Refresh
            </Button>
          }
        />

        {rows && rows.length > 0 && (
          <div className="flex flex-wrap items-end gap-3 pb-4 -mt-1">
            {(() => {
              const typeOptions = distinctValues(rows, 'import_type')
              return typeOptions.length > 1 ? (
                <div className="w-36">
                  <Select label="Type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                    <option value="">All</option>
                    {typeOptions.map((opt) => (
                      <option key={opt} value={opt} className="capitalize">
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null
            })()}

            {(() => {
              const statusOptions = distinctValues(rows, 'status')
              return statusOptions.length > 1 ? (
                <div className="w-36">
                  <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="">All</option>
                    {statusOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null
            })()}

            {(() => {
              const options = branchOptions.length > 0 ? branchOptions : distinctValues(rows, 'branch_name')
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

            <div className="flex items-end gap-2">
              <Input
                type="date"
                label="Created from"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <Input type="date" label="Created to" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>

      {rows === null && loading && <TableSkeleton rows={4} cols={7} />}

      {rows === null && !loading && loadFailed && (
        <EmptyState
          icon={<HistoryIcon />}
          title="Couldn't load import history"
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
          icon={<HistoryIcon />}
          title="No imports yet"
          description="Confirmed sales, inventory, and purchase imports will show up here."
        />
      )}

      {rows !== null && rows.length > 0 && filteredRows !== null && filteredRows.length === 0 && (
        <EmptyState
          icon={<HistoryIcon />}
          title="No imports match your filters"
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
                <Th>Type</Th>
                <Th>Filename</Th>
                <Th>Branch</Th>
                <Th>Uploaded by</Th>
                <Th>Status</Th>
                <Th>Created</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {pageItems.map((row) => (
                <Tr
                  key={row.id}
                  ref={row.id === highlightBatchId ? highlightRowRef : undefined}
                  onClick={() => onViewBatch(row.id)}
                  className={cn(
                    'cursor-pointer',
                    row.id === highlightBatchId && 'ring-2 ring-inset ring-brand bg-brand-subtle'
                  )}
                >
                  <Td className="capitalize">{row.import_type}</Td>
                  <Td className="max-w-[12rem] truncate">{row.filename ?? '—'}</Td>
                  <Td>{row.branch_name ?? '—'}</Td>
                  <Td>{row.uploaded_by_name ?? '—'}</Td>
                  <Td>
                    <Badge variant={row.status === 'completed' ? 'success' : 'default'}>
                      {row.status}
                    </Badge>
                  </Td>
                  <Td className="text-text-muted whitespace-nowrap">{formatDate(row.created_at)}</Td>
                  <Td>
                    {row.status === 'completed' &&
                      (isRetailRevertLocked(row, profile) ? (
                        <span
                          className="text-xs text-text-muted"
                          title="Retail accounts can only revert an import within 1 day of importing it"
                        >
                          Locked
                        </span>
                      ) : (
                        <Button
                          variant="destructive"
                          size="sm"
                          aria-label="Revert import"
                          title="Revert import"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleRevert(row.id)
                          }}
                          loading={revertingId === row.id}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </Button>
                      ))}
                  </Td>
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

export default ImportHistoryTable
