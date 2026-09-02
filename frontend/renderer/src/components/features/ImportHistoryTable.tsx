import { useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { invalidateImportedData, useCachedFetch } from '@renderer/lib/useCachedFetch'
import { useToast } from '@renderer/lib/useToast'
import { cn } from '@renderer/lib/utils'
import { useImportFilePicker } from '@renderer/lib/useImportFilePicker'
import { Button } from '@renderer/components/ui/Button'
import { Badge } from '@renderer/components/ui/Badge'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { Pagination } from '@renderer/components/ui/Pagination'
import { HistoryIcon } from '@renderer/components/ui/icons'
import { useStickyAbove } from '@renderer/lib/useStickyAbove'
import { distinctValues, inDateRange } from '@renderer/lib/filters'
import { usePagination } from '@renderer/lib/usePagination'
import type { PendingImport, Profile } from '@renderer/components/features/types'

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
  // Hands off a picked-and-parsed file to the app-level confirm flow — used by each
  // row's "Reimport" button.
  onFileReady?: (pending: PendingImport) => void
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

// Display only — the backend/DB status values are still 'completed'/'reverted'/
// 'reimported' (see ImportBatchStatus), this just gives the reader three unambiguous
// words: Completed (still active), Removed (deleted, no replacement), Reimported
// (replaced by a corrected file) — without touching the revert action, endpoint, or
// audit columns (reverted_at/reverted_by) that still use the old names internally.
const STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  reverted: 'Removed',
  reimported: 'Reimported'
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status
}

const DEFAULT_STATUS_FILTER = 'completed'

const STATUS_BADGE_VARIANT: Record<string, 'success' | 'info' | 'default'> = {
  completed: 'success',
  reimported: 'info'
}

function statusBadgeVariant(status: string): 'success' | 'info' | 'default' {
  return STATUS_BADGE_VARIANT[status] ?? 'default'
}

function importTypeLabel(importType: string): string {
  return importType.charAt(0).toUpperCase() + importType.slice(1)
}

function ImportHistoryTable({
  session,
  onViewBatch,
  branchOptions,
  profile,
  highlightBatchId,
  onFileReady
}: Props): React.JSX.Element {
  const showToast = useToast()
  const { data: rows, isRefreshing, failed, reload } = useCachedFetch<ImportBatchRow[]>(
    `${apiBaseUrl}/api/imports/history`,
    session,
    'import history'
  )
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const { aboveRef, containerStyle } = useStickyAbove()
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null)
  const { trigger: triggerFilePicker, input: filePickerInput, picking } = useImportFilePicker(session, onFileReady)

  function handleReimport(row: ImportBatchRow): void {
    triggerFilePicker({
      endpoint: `/api/imports/${row.import_type}`,
      importLabel: importTypeLabel(row.import_type),
      revertBatchId: row.id,
      replacingFilename: row.filename
    })
  }

  const [typeFilter, setTypeFilter] = useState('')
  // Defaults to hiding Removed/Reimported rows — they're kept as an audit trail, not
  // something worth seeing on every visit. Still reachable via the Status filter itself.
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS_FILTER)
  const [branchFilter, setBranchFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Only scrolls the row into view if it's on the current (default, unfiltered) page —
  // a highlight from Warnings always arrives with filters cleared and page 1, so this
  // covers the case it's meant for without needing to hunt across pages/filters.
  useEffect(() => {
    if (highlightBatchId && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightBatchId, rows])

  const hasActiveFilters =
    typeFilter !== '' ||
    statusFilter !== DEFAULT_STATUS_FILTER ||
    branchFilter !== '' ||
    dateFrom !== '' ||
    dateTo !== ''

  // Resets to genuinely unfiltered (Status included) rather than back to the Completed
  // default — this doubles as the "no rows match your filters" empty state's escape
  // hatch, which must always be able to reveal *something*, even if every row in
  // history happens to be Removed/Reimported right now.
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
    if (!window.confirm('Remove this import? This deletes the data it created.')) return

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
      // The batch's sale/inventory/purchase rows are gone, so every cached page is now
      // wrong — including this one, which refetches itself as a result. See
      // invalidateImportedData.
      invalidateImportedData()
    } catch {
      showToast('error', 'Revert failed — is the backend running?')
    } finally {
      setRevertingId(null)
    }
  }

  return (
    <div className="flex flex-col" style={containerStyle}>
      {filePickerInput}
      <div ref={aboveRef} className="sticky top-14 lg:top-0 z-30 bg-bg-subtle">
        <CardHeader
          title="Import history"
          description="Every confirmed upload — reimport a corrected file to replace a mistaken one, or remove it outright."
          action={
            <Button variant="secondary" size="sm" onClick={reload} loading={isRefreshing}>
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
                        {statusLabel(opt)}
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

      {rows === null && !failed && <TableSkeleton rows={4} cols={7} />}

      {rows === null && failed && (
        <EmptyState
          icon={<HistoryIcon />}
          title="Couldn't load import history"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
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
                    <Badge variant={statusBadgeVariant(row.status)}>{statusLabel(row.status)}</Badge>
                  </Td>
                  <Td className="text-text-muted whitespace-nowrap">{formatDate(row.created_at)}</Td>
                  <Td>
                    {row.status === 'completed' &&
                      (isRetailRevertLocked(row, profile) ? (
                        <span
                          className="text-xs text-text-muted"
                          title="Retail accounts can only reimport or remove an import within 1 day of importing it"
                        >
                          Locked
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5 justify-end">
                          <Button
                            variant="secondary"
                            size="sm"
                            title="Pick a corrected file to replace this import"
                            disabled={picking}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleReimport(row)
                            }}
                          >
                            Reimport
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleRevert(row.id)
                            }}
                            loading={revertingId === row.id}
                          >
                            Remove
                          </Button>
                        </div>
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
