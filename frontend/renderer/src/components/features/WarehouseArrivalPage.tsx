import { useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { Session } from '@renderer/lib/auth'
import { apiBaseUrl } from '@renderer/lib/auth'
import { useToast } from '@renderer/lib/useToast'
import { useWholesaleBranchOptions } from '@renderer/lib/useBranches'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/Button'
import { Pagination } from '@renderer/components/ui/Pagination'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { WarehouseIcon } from '@renderer/components/ui/icons'
import type { Profile, WarehouseReceipt } from '@renderer/components/features/types'

interface Props {
  session: Session
  profile: Profile | null
}

const noSpinnerClass =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
const draftCellInputClass = `h-8 border-border bg-bg-base hover:border-border-strong focus:border-brand ${noSpinnerClass}`

function requiredDraftClass(value: string, attempted: boolean): string {
  return attempted && value.trim() === '' ? 'border-error focus:border-error' : ''
}

interface DraftState {
  received_date: string
  warehouse: string
  product_code: string
  qty_received: string
  branch_id: string
}

function emptyDraft(): DraftState {
  return {
    received_date: new Date().toISOString().slice(0, 10),
    warehouse: '',
    product_code: '',
    qty_received: '',
    branch_id: ''
  }
}

// Deliberately no voucher/factory field here — the warehouse floor staff filling this in
// don't know what a "factory voucher" is. The backend resolves which voucher a stock code
// belongs to on its own (see record_warehouse_receipt), so this page only ever asks for
// what staff actually observe: date, warehouse, stock code, qty.
// Matches PAGE_SIZE in backend/app/routers/warehouse_receipts.py, so the Pagination control's arithmetic
// agrees with the rows the server actually sends back.
const PAGE_SIZE = 20

export function WarehouseArrivalPage({ session, profile }: Props): React.JSX.Element {
  const showToast = useToast()
  const [receipts, setReceipts] = useState<WarehouseReceipt[] | null>(null)
  // The list endpoint returns one page — `{rows, total}` — so the page being shown
  // and how many rows sit behind it are part of this page's state.
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [draft, setDraft] = useState<DraftState>(emptyDraft())
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const needsBranch = profile !== null && profile.branch_id === null
  const branchOptions = useWholesaleBranchOptions(needsBranch ? session : null)
  const showBranchColumn = needsBranch && branchOptions.length > 1
  const colCount = showBranchColumn ? 7 : 6

  async function load(): Promise<void> {
    setLoading(true)
    setLoadFailed(false)
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/warehouse-receipts?page=${page}&page_size=${PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      )
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load warehouse arrivals: ${response.status}`)
        return
      }
      const body = (await response.json()) as { rows: WarehouseReceipt[]; total: number }
      setReceipts(body.rows)
      setTotal(body.total)
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load warehouse arrivals — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token, page])

  // Removing the last row on the last page would otherwise leave the reader staring at
  // an empty page that isn't the empty state.
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  useEffect(() => {
    if (page > totalPages) setPage(totalPages)
  }, [page, totalPages])

  function openAdd(): void {
    setDraft(emptyDraft())
    setAttemptedSubmit(false)
    setIsAdding(true)
  }

  function closeAdd(): void {
    setIsAdding(false)
    setAttemptedSubmit(false)
    setDraft(emptyDraft())
  }

  async function commitDraft(opts?: { silent?: boolean }): Promise<void> {
    if (!draft.product_code.trim() || !draft.warehouse.trim() || !draft.qty_received) {
      setAttemptedSubmit(true)
      if (!opts?.silent) showToast('error', 'Warehouse, stock code and qty are required')
      return
    }
    const resolvedBranchId = draft.branch_id || (branchOptions.length === 1 ? branchOptions[0].id : '')
    if (needsBranch && !resolvedBranchId) {
      setAttemptedSubmit(true)
      if (!opts?.silent) showToast('error', 'Choose which branch this arrival belongs to')
      return
    }
    setCreating(true)
    try {
      const body = {
        product_code: draft.product_code.trim(),
        warehouse: draft.warehouse.trim(),
        qty_received: Number(draft.qty_received),
        received_date: draft.received_date,
        branch_id: needsBranch ? resolvedBranchId : null
      }
      const response = await fetch(`${apiBaseUrl}/api/warehouse-receipts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify(body)
      })
      const responseBody = await response.json().catch(() => null)
      if (!response.ok) {
        showToast('error', responseBody?.detail ?? `Add failed: ${response.status}`)
        return
      }
      showToast('success', `Recorded ${body.qty_received} of ${body.product_code} at ${body.warehouse}`)
      closeAdd()
      await load()
    } catch {
      showToast('error', 'Add failed — is the backend running?')
    } finally {
      setCreating(false)
    }
  }

  function handleDraftRowBlur(e: FocusEvent<HTMLTableRowElement>): void {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    const hasContent = draft.product_code.trim() || draft.warehouse.trim() || draft.qty_received
    if (hasContent) commitDraft({ silent: true })
  }

  function handleDraftKeyDown(e: KeyboardEvent<HTMLTableRowElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitDraft()
    }
  }

  async function handleDelete(receipt: WarehouseReceipt): Promise<void> {
    if (!window.confirm(`Delete this arrival of ${receipt.qty_received} × ${receipt.product_code}?`)) return
    setDeletingId(receipt.id)
    try {
      const response = await fetch(`${apiBaseUrl}/api/warehouse-receipts/${receipt.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok && response.status !== 204) {
        showToast('error', `Delete failed: ${response.status}`)
        return
      }
      await load()
    } catch {
      showToast('error', 'Delete failed — is the backend running?')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <CardHeader
        title="Warehouse arrival"
        description="Record what arrived at the warehouse — stock code and qty. Matched to the right factory voucher automatically."
        action={
          !isAdding && (
            <Button size="sm" onClick={openAdd}>
              + Add arrival
            </Button>
          )
        }
      />

      {receipts === null && loading && <TableSkeleton rows={4} cols={6} />}

      {receipts === null && !loading && loadFailed && (
        <EmptyState
          icon={<WarehouseIcon />}
          title="Couldn't load warehouse arrivals"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      )}

      {receipts !== null && (
        <TableContainer className="pb-4">
          <Thead>
            <Tr>
              <Th>Date</Th>
              <Th>{isAdding ? 'Warehouse *' : 'Warehouse'}</Th>
              <Th>{isAdding ? 'Stock Code *' : 'Stock Code'}</Th>
              <Th className="text-right">{isAdding ? 'Qty *' : 'Qty'}</Th>
              <Th>Matched Voucher</Th>
              {showBranchColumn && <Th>{isAdding ? 'Branch *' : 'Branch'}</Th>}
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {isAdding && (
              <Tr className="bg-brand-subtle/40" onBlur={handleDraftRowBlur} onKeyDown={handleDraftKeyDown}>
                <Td>
                  <Input
                    type="date"
                    className={draftCellInputClass}
                    value={draft.received_date}
                    onChange={(e) => setDraft({ ...draft, received_date: e.target.value })}
                  />
                </Td>
                <Td>
                  <Input
                    placeholder="Warehouse"
                    className={cn(
                      draftCellInputClass,
                      'min-w-[8rem]',
                      requiredDraftClass(draft.warehouse, attemptedSubmit)
                    )}
                    value={draft.warehouse}
                    onChange={(e) => setDraft({ ...draft, warehouse: e.target.value })}
                  />
                </Td>
                <Td>
                  <Input
                    placeholder="Stock code"
                    className={cn(
                      draftCellInputClass,
                      'min-w-[8rem]',
                      requiredDraftClass(draft.product_code, attemptedSubmit)
                    )}
                    value={draft.product_code}
                    onChange={(e) => setDraft({ ...draft, product_code: e.target.value })}
                  />
                </Td>
                <Td className="text-right">
                  <Input
                    type="number"
                    min={0}
                    placeholder="Qty"
                    className={cn(
                      draftCellInputClass,
                      'w-24 text-right',
                      requiredDraftClass(draft.qty_received, attemptedSubmit)
                    )}
                    value={draft.qty_received}
                    onChange={(e) => setDraft({ ...draft, qty_received: e.target.value })}
                  />
                </Td>
                <Td className="text-text-muted">—</Td>
                {showBranchColumn && (
                  <Td>
                    <Select
                      className={cn('h-8 py-0', attemptedSubmit && !draft.branch_id && 'border-error')}
                      value={draft.branch_id}
                      onChange={(e) => setDraft({ ...draft, branch_id: e.target.value })}
                    >
                      <option value="">Branch…</option>
                      {branchOptions.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  </Td>
                )}
                <Td>
                  <div className="flex items-center gap-1">
                    <Button type="button" size="sm" loading={creating} onClick={() => commitDraft()}>
                      Add
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={closeAdd}>
                      Close
                    </Button>
                  </div>
                </Td>
              </Tr>
            )}

            {!isAdding && receipts.length === 0 && (
              <Tr>
                <Td colSpan={colCount} className="text-center text-text-muted py-8 border-r-0">
                  No arrivals recorded yet —{' '}
                  <button type="button" className="text-brand underline underline-offset-2" onClick={openAdd}>
                    add one
                  </button>
                  .
                </Td>
              </Tr>
            )}

            {receipts.map((receipt) => (
              <Tr key={receipt.id}>
                <Td>{receipt.received_date}</Td>
                <Td>{receipt.warehouse}</Td>
                <Td>{receipt.product_code}</Td>
                <Td className="text-right tabular-nums">{receipt.qty_received}</Td>
                <Td className="text-text-muted">FV-{receipt.voucher_no}</Td>
                {showBranchColumn && <Td className="text-text-muted">—</Td>}
                <Td>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleDelete(receipt)}
                    loading={deletingId === receipt.id}
                  >
                    Delete
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </TableContainer>
      )}

      {receipts !== null && total > PAGE_SIZE && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}

export default WarehouseArrivalPage
