import { Fragment, useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { Session } from '@renderer/lib/auth'
import { apiBaseUrl } from '@renderer/lib/auth'
import { useToast } from '@renderer/lib/useToast'
import { useWholesaleBranchOptions } from '@renderer/lib/useBranches'
import { cn } from '@renderer/lib/utils'
import { parseColorShorthand, formatColorShorthand, colorShorthandTotal } from '@renderer/lib/colorShorthand'
import { Button } from '@renderer/components/ui/Button'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { Textarea } from '@renderer/components/ui/Textarea'
import { Pagination } from '@renderer/components/ui/Pagination'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { TrashIcon } from '@renderer/components/ui/icons'
import { ClipboardIcon } from '@renderer/components/ui/icons'
import type { CustomerOrder, CustomerOrderLine, OrderStatus, Profile } from '@renderer/components/features/types'

interface Props {
  session: Session
  profile: Profile | null
}

const STATUS_PILL_CLASS: Record<OrderStatus, string> = {
  not_start: 'bg-error-subtle text-error',
  waiting: 'bg-warning-subtle text-warning',
  complete: 'bg-success-subtle text-success'
}

// Looks like a colored status badge, not a form control — until clicked, when it opens
// the native <select> dropdown like normal. Beats showing a plain bordered select box next
// to a separate read-only badge.
function StatusPillSelect({
  value,
  disabled,
  onChange
}: {
  value: OrderStatus
  disabled?: boolean
  onChange: (value: OrderStatus) => void
}): React.JSX.Element {
  return (
    <div className="relative inline-block">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as OrderStatus)}
        className={cn(
          'appearance-none cursor-pointer rounded-full pl-2.5 pr-6 py-0.5 text-xs font-medium whitespace-nowrap',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          STATUS_PILL_CLASS[value]
        )}
      >
        <option value="not_start">Not started</option>
        <option value="waiting">Waiting</option>
        <option value="complete">Complete</option>
      </select>
      <svg
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3"
        viewBox="0 0 20 20"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M5 7.5L10 12.5L15 7.5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}

// Strips the native number spinner — harmless on non-number inputs since those selectors
// just don't match anything on them.
const noSpinnerClass =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
// Applied to an existing row's cells: transparent until hovered/focused, so saved data reads
// as a clean spreadsheet rather than a wall of form fields.
const cellInputClass = `h-8 border-transparent bg-transparent hover:border-border focus:bg-bg-base ${noSpinnerClass}`
// Applied to the "New" draft row's cells instead: a visible border by default, so an empty
// row full of blank-looking cells still reads as "a form waiting to be filled in" rather
// than empty space — the opposite instinct from the existing-row treatment above.
const draftCellInputClass = `h-8 border-border bg-bg-base hover:border-border-strong focus:border-brand ${noSpinnerClass}`
const qtyColClass = 'min-w-[6rem]'

// The two fields commitDraft() actually requires — everything else on the row is optional.
// Tints the border red once a submit attempt has failed because this cell is still empty —
// not the instant the row opens, which would read as "something's already wrong" before the
// user has done anything. The column header carries the "required" hint (a "*") the rest of
// the time.
function requiredDraftClass(value: string, attempted: boolean): string {
  return attempted && value.trim() === '' ? 'border-error focus:border-error' : ''
}

interface LineDraftState {
  product_code: string
  description: string
  factory_name: string
  first_commit_qty: string
  second_commit_qty: string
  colorsText: string
  unit: string
  status: OrderStatus
}

function emptyLineDraft(): LineDraftState {
  return {
    product_code: '',
    description: '',
    factory_name: '',
    first_commit_qty: '',
    second_commit_qty: '',
    colorsText: '',
    unit: 'Set',
    status: 'not_start'
  }
}

interface DraftState extends LineDraftState {
  order_date: string
  customer_name: string
  remark: string
  branch_id: string
}

function emptyDraft(): DraftState {
  return {
    ...emptyLineDraft(),
    order_date: new Date().toISOString().slice(0, 10),
    customer_name: '',
    remark: '',
    branch_id: ''
  }
}

// Matches PAGE_SIZE in backend/app/routers/orders.py, so the Pagination control's
// arithmetic agrees with the rows the server actually sends back.
const PAGE_SIZE = 20

export function CustomerOrdersPage({ session, profile }: Props): React.JSX.Element {
  const showToast = useToast()
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null)
  // The list endpoint returns one page — `{rows, total}` — so the page it is showing and
  // how many orders exist behind it are part of this page's state.
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [draft, setDraft] = useState<DraftState>(emptyDraft())
  const [creating, setCreating] = useState(false)
  const [savingOrderId, setSavingOrderId] = useState<string | null>(null)
  const [savingLineId, setSavingLineId] = useState<string | null>(null)
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null)
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null)
  const [addingLineOrderId, setAddingLineOrderId] = useState<string | null>(null)
  const [lineAttemptedSubmit, setLineAttemptedSubmit] = useState(false)
  const [lineDraft, setLineDraft] = useState<LineDraftState>(emptyLineDraft())
  const [creatingLine, setCreatingLine] = useState(false)

  // The second commitment qty is the firmer, follow-up number sent to the factory after
  // the customer's initial (first) commitment — only admin can set/change it.
  const isAdmin = profile !== null && profile.role === 'admin'
  const needsBranch = profile !== null && profile.branch_id === null
  const branchOptions = useWholesaleBranchOptions(needsBranch ? session : null)
  // Wholesale is structurally a single-branch operation (see CLAUDE.md) — with exactly one
  // option there's nothing to actually choose, so it's auto-filled instead of shown as a
  // picker. The picker only reappears if a second wholesale branch is ever added.
  const showBranchColumn = needsBranch && branchOptions.length > 1

  async function load(): Promise<void> {
    setLoading(true)
    setLoadFailed(false)
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/orders?page=${page}&page_size=${PAGE_SIZE}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } }
      )
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load orders: ${response.status}`)
        return
      }
      const body = (await response.json()) as { rows: CustomerOrder[]; total: number }
      setOrders(body.rows)
      setTotal(body.total)
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load orders — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token, page])

  // Deleting the last order on the last page would otherwise leave the reader staring at
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
    if (!draft.product_code.trim() || !draft.customer_name.trim()) {
      setAttemptedSubmit(true)
      if (!opts?.silent) showToast('error', 'Product code and customer name are required')
      return
    }
    const resolvedBranchId = draft.branch_id || (branchOptions.length === 1 ? branchOptions[0].id : '')
    if (needsBranch && !resolvedBranchId) {
      setAttemptedSubmit(true)
      if (!opts?.silent) showToast('error', 'Choose which branch this order belongs to')
      return
    }
    setCreating(true)
    try {
      const body = {
        order_date: draft.order_date,
        customer_name: draft.customer_name.trim(),
        remark: draft.remark.trim() || null,
        branch_id: needsBranch ? resolvedBranchId : null,
        line: {
          product_code: draft.product_code.trim(),
          description: draft.description.trim() || null,
          factory_name: draft.factory_name.trim() || null,
          first_commit_qty: draft.first_commit_qty === '' ? null : Number(draft.first_commit_qty),
          second_commit_qty: draft.second_commit_qty === '' ? null : Number(draft.second_commit_qty),
          colors: parseColorShorthand(draft.colorsText),
          unit: draft.unit || 'Set',
          received_qty: 0,
          status: draft.status
        }
      }
      const response = await fetch(`${apiBaseUrl}/api/orders`, {
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
      showToast('success', `Order ORD-${responseBody.order_no} added`)
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
    const hasContent = draft.product_code.trim() || draft.customer_name.trim() || draft.colorsText.trim()
    if (hasContent) commitDraft({ silent: true })
  }

  function handleDraftKeyDown(e: KeyboardEvent<HTMLTableRowElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitDraft()
    }
  }

  async function patchOrder(order: CustomerOrder, patch: Record<string, unknown>): Promise<void> {
    setSavingOrderId(order.id)
    try {
      const response = await fetch(`${apiBaseUrl}/api/orders/${order.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify(patch)
      })
      const responseBody = await response.json().catch(() => null)
      if (!response.ok) {
        showToast('error', responseBody?.detail ?? `Update failed: ${response.status}`)
        return
      }
      await load()
    } catch {
      showToast('error', 'Update failed — is the backend running?')
    } finally {
      setSavingOrderId(null)
    }
  }

  async function patchLine(order: CustomerOrder, line: CustomerOrderLine, patch: Record<string, unknown>): Promise<void> {
    setSavingLineId(line.id)
    try {
      const response = await fetch(`${apiBaseUrl}/api/orders/${order.id}/lines/${line.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify(patch)
      })
      const responseBody = await response.json().catch(() => null)
      if (!response.ok) {
        showToast('error', responseBody?.detail ?? `Update failed: ${response.status}`)
        return
      }
      await load()
    } catch {
      showToast('error', 'Update failed — is the backend running?')
    } finally {
      setSavingLineId(null)
    }
  }

  async function handleDeleteOrder(order: CustomerOrder): Promise<void> {
    if (!window.confirm(`Delete order ORD-${order.order_no} for ${order.customer_name} and all its products?`)) return
    setDeletingOrderId(order.id)
    try {
      const response = await fetch(`${apiBaseUrl}/api/orders/${order.id}`, {
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
      setDeletingOrderId(null)
    }
  }

  async function handleDeleteLine(order: CustomerOrder, line: CustomerOrderLine): Promise<void> {
    const message =
      order.lines.length === 1
        ? `Delete order ORD-${order.order_no}? It has only this one product.`
        : `Delete product ${line.product_code} from order ORD-${order.order_no}?`
    if (!window.confirm(message)) return
    setDeletingLineId(line.id)
    try {
      const response = await fetch(`${apiBaseUrl}/api/orders/${order.id}/lines/${line.id}`, {
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
      setDeletingLineId(null)
    }
  }

  function openAddLine(orderId: string): void {
    setLineDraft(emptyLineDraft())
    setLineAttemptedSubmit(false)
    setAddingLineOrderId(orderId)
  }

  function closeAddLine(): void {
    setAddingLineOrderId(null)
    setLineAttemptedSubmit(false)
    setLineDraft(emptyLineDraft())
  }

  async function commitLineDraft(order: CustomerOrder, opts?: { silent?: boolean }): Promise<void> {
    if (!lineDraft.product_code.trim()) {
      setLineAttemptedSubmit(true)
      if (!opts?.silent) showToast('error', 'Product code is required')
      return
    }
    setCreatingLine(true)
    try {
      const body = {
        product_code: lineDraft.product_code.trim(),
        description: lineDraft.description.trim() || null,
        factory_name: lineDraft.factory_name.trim() || null,
        first_commit_qty: lineDraft.first_commit_qty === '' ? null : Number(lineDraft.first_commit_qty),
        second_commit_qty: lineDraft.second_commit_qty === '' ? null : Number(lineDraft.second_commit_qty),
        colors: parseColorShorthand(lineDraft.colorsText),
        unit: lineDraft.unit || 'Set',
        received_qty: 0,
        status: lineDraft.status
      }
      const response = await fetch(`${apiBaseUrl}/api/orders/${order.id}/lines`, {
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
      closeAddLine()
      await load()
    } catch {
      showToast('error', 'Add failed — is the backend running?')
    } finally {
      setCreatingLine(false)
    }
  }

  function handleLineDraftRowBlur(order: CustomerOrder, e: FocusEvent<HTMLTableRowElement>): void {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    const hasContent = lineDraft.product_code.trim() || lineDraft.colorsText.trim()
    if (hasContent) commitLineDraft(order, { silent: true })
  }

  function handleLineDraftKeyDown(order: CustomerOrder, e: KeyboardEvent<HTMLTableRowElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitLineDraft(order)
    }
  }

  const draftTotal = colorShorthandTotal(draft.colorsText)
  const lineDraftTotal = colorShorthandTotal(lineDraft.colorsText)
  const colCount = showBranchColumn ? 18 : 17

  return (
    <div className="flex flex-col gap-4">
      <CardHeader
        title="Customer orders"
        description={
          <>
            One order can list several products. Colors as{' '}
            <span className="font-mono">black10+pink20</span> — total qty is the sum.
          </>
        }
        action={
          !isAdding && (
            <Button size="sm" onClick={openAdd}>
              + Add order
            </Button>
          )
        }
      />

      {orders === null && loading && <TableSkeleton rows={4} cols={9} />}

      {orders === null && !loading && loadFailed && (
        <EmptyState
          icon={<ClipboardIcon />}
          title="Couldn't load orders"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      )}

      {orders !== null && (
        <TableContainer className="pb-4">
          <Thead>
            <Tr>
              <Th>No.</Th>
              <Th>Date</Th>
              <Th>{isAdding ? 'Customer *' : 'Customer'}</Th>
              <Th>{isAdding ? 'Product code *' : 'Product code'}</Th>
              <Th>Description</Th>
              <Th>Factory</Th>
              <Th className={qtyColClass}>First qty commitment</Th>
              <Th className={qtyColClass}>Second qty commitment</Th>
              <Th>Colors</Th>
              <Th className={qtyColClass}>Total qty</Th>
              <Th className={qtyColClass}>Received qty</Th>
              <Th className={qtyColClass}>Unit</Th>
              <Th className="text-right">Buying price</Th>
              <Th>Matched voucher</Th>
              <Th>Status</Th>
              <Th>Remark</Th>
              {showBranchColumn && <Th>{isAdding ? 'Branch *' : 'Branch'}</Th>}
              <Th />
            </Tr>
          </Thead>
          <Tbody>
            {isAdding && (
              <Tr className="bg-brand-subtle/40" onBlur={handleDraftRowBlur} onKeyDown={handleDraftKeyDown}>
                <Td className="text-text-muted">New</Td>
                <Td>
                  <Input
                    type="date"
                    className={draftCellInputClass}
                    value={draft.order_date}
                    onChange={(e) => setDraft({ ...draft, order_date: e.target.value })}
                  />
                </Td>
                <Td>
                  <Input
                    placeholder="Customer"
                    className={cn(
                      draftCellInputClass,
                      'min-w-[9rem]',
                      requiredDraftClass(draft.customer_name, attemptedSubmit)
                    )}
                    value={draft.customer_name}
                    onChange={(e) => setDraft({ ...draft, customer_name: e.target.value })}
                  />
                </Td>
                <Td>
                  <Input
                    placeholder="Product code"
                    className={cn(
                      draftCellInputClass,
                      'min-w-[8rem]',
                      requiredDraftClass(draft.product_code, attemptedSubmit)
                    )}
                    value={draft.product_code}
                    onChange={(e) => setDraft({ ...draft, product_code: e.target.value })}
                  />
                </Td>
                <Td>
                  <Textarea
                    placeholder="Description"
                    className={draftCellInputClass + ' min-w-[10rem]'}
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </Td>
                <Td>
                  <Textarea
                    placeholder="Factory"
                    className={draftCellInputClass + ' min-w-[10rem]'}
                    value={draft.factory_name}
                    onChange={(e) => setDraft({ ...draft, factory_name: e.target.value })}
                  />
                </Td>
                <Td className={qtyColClass}>
                  <Input
                    type="number"
                    min={0}
                    placeholder="Qty"
                    className={draftCellInputClass}
                    value={draft.first_commit_qty}
                    onChange={(e) => setDraft({ ...draft, first_commit_qty: e.target.value })}
                  />
                </Td>
                <Td className={qtyColClass}>
                  <Input
                    type="number"
                    min={0}
                    placeholder={isAdmin ? 'Qty' : 'Admin only'}
                    disabled={!isAdmin}
                    className={draftCellInputClass}
                    value={draft.second_commit_qty}
                    onChange={(e) => setDraft({ ...draft, second_commit_qty: e.target.value })}
                  />
                </Td>
                <Td>
                  <Input
                    placeholder="black10+pink20"
                    className={draftCellInputClass + ' font-mono min-w-[9rem]'}
                    value={draft.colorsText}
                    onChange={(e) => setDraft({ ...draft, colorsText: e.target.value })}
                  />
                </Td>
                <Td className={qtyColClass + ' text-right tabular-nums text-text-muted'}>
                  {draftTotal || '—'}
                </Td>
                <Td className={qtyColClass + ' text-right text-text-muted'}>—</Td>
                <Td className={qtyColClass}>
                  <Input
                    className={draftCellInputClass}
                    value={draft.unit}
                    onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  />
                </Td>
                <Td className="text-right text-text-muted">—</Td>
                <Td className="text-text-muted">—</Td>
                <Td>
                  <StatusPillSelect
                    value={draft.status}
                    onChange={(status) => setDraft({ ...draft, status })}
                  />
                </Td>
                <Td>
                  <Textarea
                    placeholder="Remark"
                    className={draftCellInputClass + ' min-w-[12rem]'}
                    value={draft.remark}
                    onChange={(e) => setDraft({ ...draft, remark: e.target.value })}
                  />
                </Td>
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

            {!isAdding && orders.length === 0 && (
              <Tr>
                <Td colSpan={colCount} className="text-center text-text-muted py-8 border-r-0">
                  No customer orders yet —{' '}
                  <button type="button" className="text-brand underline underline-offset-2" onClick={openAdd}>
                    add one
                  </button>
                  .
                </Td>
              </Tr>
            )}

            {orders.map((order) => (
              <Fragment key={order.id}>
                {order.lines.map((line, lineIndex) => (
                  <Tr key={line.id}>
                    {lineIndex === 0 && (
                      <>
                        <Td rowSpan={order.lines.length} className="align-top">
                          <div className="flex flex-col items-start gap-1">
                            <span className="whitespace-nowrap">ORD-{order.order_no}</span>
                            <button
                              type="button"
                              title="Delete order"
                              className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-error-subtle text-error hover:bg-error hover:text-white disabled:opacity-50 transition-colors"
                              disabled={deletingOrderId === order.id}
                              onClick={() => handleDeleteOrder(order)}
                            >
                              <TrashIcon className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </Td>
                        <Td rowSpan={order.lines.length} className="align-top">
                          <Input
                            key={order.order_date}
                            type="date"
                            className={cellInputClass}
                            disabled={savingOrderId === order.id}
                            defaultValue={order.order_date}
                            onBlur={(e) => {
                              if (e.target.value && e.target.value !== order.order_date) {
                                patchOrder(order, { order_date: e.target.value })
                              }
                            }}
                          />
                        </Td>
                        <Td rowSpan={order.lines.length} className="align-top">
                          <Input
                            key={order.customer_name}
                            className={cellInputClass + ' min-w-[9rem]'}
                            disabled={savingOrderId === order.id}
                            defaultValue={order.customer_name}
                            onBlur={(e) => {
                              if (e.target.value.trim() && e.target.value !== order.customer_name) {
                                patchOrder(order, { customer_name: e.target.value.trim() })
                              }
                            }}
                          />
                        </Td>
                      </>
                    )}
                    <Td>
                      <Input
                        key={line.product_code}
                        className={cellInputClass + ' min-w-[8rem]'}
                        disabled={savingLineId === line.id}
                        defaultValue={line.product_code}
                        onBlur={(e) => {
                          if (e.target.value.trim() && e.target.value !== line.product_code) {
                            patchLine(order, line, { product_code: e.target.value.trim() })
                          }
                        }}
                      />
                    </Td>
                    <Td>
                      <Textarea
                        key={line.description ?? ''}
                        className={cellInputClass + ' min-w-[10rem]'}
                        disabled={savingLineId === line.id}
                        defaultValue={line.description ?? ''}
                        onBlur={(e) => {
                          if (e.target.value !== (line.description ?? '')) {
                            patchLine(order, line, { description: e.target.value || null })
                          }
                        }}
                      />
                    </Td>
                    <Td>
                      <Textarea
                        key={line.factory_name ?? ''}
                        className={cellInputClass + ' min-w-[10rem]'}
                        disabled={savingLineId === line.id}
                        defaultValue={line.factory_name ?? ''}
                        onBlur={(e) => {
                          if (e.target.value !== (line.factory_name ?? '')) {
                            patchLine(order, line, { factory_name: e.target.value || null })
                          }
                        }}
                      />
                    </Td>
                    <Td className={qtyColClass}>
                      <Input
                        key={line.first_commit_qty ?? ''}
                        type="number"
                        min={0}
                        className={cellInputClass}
                        disabled={savingLineId === line.id}
                        defaultValue={line.first_commit_qty ?? ''}
                        onBlur={(e) => {
                          const next = e.target.value === '' ? null : Number(e.target.value)
                          if (next !== line.first_commit_qty) patchLine(order, line, { first_commit_qty: next })
                        }}
                      />
                    </Td>
                    <Td className={qtyColClass}>
                      <Input
                        key={line.second_commit_qty ?? ''}
                        type="number"
                        min={0}
                        className={cellInputClass}
                        disabled={!isAdmin || savingLineId === line.id}
                        title={isAdmin ? undefined : 'Only admin can change the second commitment qty'}
                        defaultValue={line.second_commit_qty ?? ''}
                        onBlur={(e) => {
                          const next = e.target.value === '' ? null : Number(e.target.value)
                          if (next !== line.second_commit_qty) patchLine(order, line, { second_commit_qty: next })
                        }}
                      />
                    </Td>
                    <Td>
                      <Input
                        key={formatColorShorthand(line.colors)}
                        className={cellInputClass + ' font-mono min-w-[9rem]'}
                        placeholder="black10+pink20"
                        disabled={savingLineId === line.id}
                        defaultValue={formatColorShorthand(line.colors)}
                        onBlur={(e) => {
                          if (e.target.value !== formatColorShorthand(line.colors)) {
                            patchLine(order, line, { colors: parseColorShorthand(e.target.value) })
                          }
                        }}
                      />
                    </Td>
                    <Td className={qtyColClass + ' text-right tabular-nums'}>{line.total_qty}</Td>
                    <Td className={qtyColClass}>
                      <Input
                        key={line.received_qty}
                        type="number"
                        min={0}
                        max={line.total_qty}
                        disabled={savingLineId === line.id}
                        defaultValue={line.received_qty}
                        className={cellInputClass}
                        onBlur={(e) => {
                          const next = Number(e.target.value)
                          if (next !== line.received_qty) patchLine(order, line, { received_qty: next })
                        }}
                      />
                    </Td>
                    <Td className={qtyColClass}>
                      <Input
                        key={line.unit}
                        className={cellInputClass}
                        disabled={savingLineId === line.id}
                        defaultValue={line.unit}
                        onBlur={(e) => {
                          if (e.target.value.trim() && e.target.value !== line.unit) {
                            patchLine(order, line, { unit: e.target.value.trim() })
                          }
                        }}
                      />
                    </Td>
                    <Td className="text-right tabular-nums">{line.buying_price ?? '—'}</Td>
                    <Td className="text-text-muted">
                      {line.matched_voucher_no ? `FV-${line.matched_voucher_no}` : '—'}
                    </Td>
                    <Td>
                      <StatusPillSelect
                        value={line.status}
                        disabled={savingLineId === line.id}
                        onChange={(status) => patchLine(order, line, { status })}
                      />
                    </Td>
                    {lineIndex === 0 && (
                      <Td rowSpan={order.lines.length} className="align-top">
                        <Textarea
                          key={order.remark ?? ''}
                          className={cellInputClass + ' min-w-[12rem]'}
                          disabled={savingOrderId === order.id}
                          defaultValue={order.remark ?? ''}
                          onBlur={(e) => {
                            if (e.target.value !== (order.remark ?? '')) {
                              patchOrder(order, { remark: e.target.value || null })
                            }
                          }}
                        />
                      </Td>
                    )}
                    {showBranchColumn && lineIndex === 0 && (
                      <Td rowSpan={order.lines.length} className="align-top text-text-muted">
                        {order.branch_name ?? '—'}
                      </Td>
                    )}
                    <Td>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteLine(order, line)}
                        loading={deletingLineId === line.id}
                      >
                        Delete
                      </Button>
                    </Td>
                  </Tr>
                ))}

                {addingLineOrderId === order.id ? (
                  <Tr
                    className="bg-brand-subtle/40"
                    onBlur={(e) => handleLineDraftRowBlur(order, e)}
                    onKeyDown={(e) => handleLineDraftKeyDown(order, e)}
                  >
                    <Td className="text-text-muted text-center">↳</Td>
                    <Td className="text-text-muted">—</Td>
                    <Td className="text-text-muted">—</Td>
                    <Td>
                      <Input
                        placeholder="Product code"
                        className={cn(
                          draftCellInputClass,
                          'min-w-[8rem]',
                          requiredDraftClass(lineDraft.product_code, lineAttemptedSubmit)
                        )}
                        value={lineDraft.product_code}
                        onChange={(e) => setLineDraft({ ...lineDraft, product_code: e.target.value })}
                      />
                    </Td>
                    <Td>
                      <Textarea
                        placeholder="Description"
                        className={draftCellInputClass + ' min-w-[10rem]'}
                        value={lineDraft.description}
                        onChange={(e) => setLineDraft({ ...lineDraft, description: e.target.value })}
                      />
                    </Td>
                    <Td>
                      <Textarea
                        placeholder="Factory"
                        className={draftCellInputClass + ' min-w-[10rem]'}
                        value={lineDraft.factory_name}
                        onChange={(e) => setLineDraft({ ...lineDraft, factory_name: e.target.value })}
                      />
                    </Td>
                    <Td className={qtyColClass}>
                      <Input
                        type="number"
                        min={0}
                        placeholder="Qty"
                        className={draftCellInputClass}
                        value={lineDraft.first_commit_qty}
                        onChange={(e) => setLineDraft({ ...lineDraft, first_commit_qty: e.target.value })}
                      />
                    </Td>
                    <Td className={qtyColClass}>
                      <Input
                        type="number"
                        min={0}
                        placeholder={isAdmin ? 'Qty' : 'Admin only'}
                        disabled={!isAdmin}
                        className={draftCellInputClass}
                        value={lineDraft.second_commit_qty}
                        onChange={(e) => setLineDraft({ ...lineDraft, second_commit_qty: e.target.value })}
                      />
                    </Td>
                    <Td>
                      <Input
                        placeholder="black10+pink20"
                        className={draftCellInputClass + ' font-mono min-w-[9rem]'}
                        value={lineDraft.colorsText}
                        onChange={(e) => setLineDraft({ ...lineDraft, colorsText: e.target.value })}
                      />
                    </Td>
                    <Td className={qtyColClass + ' text-right tabular-nums text-text-muted'}>
                      {lineDraftTotal || '—'}
                    </Td>
                    <Td className={qtyColClass + ' text-right text-text-muted'}>—</Td>
                    <Td className={qtyColClass}>
                      <Input
                        className={draftCellInputClass}
                        value={lineDraft.unit}
                        onChange={(e) => setLineDraft({ ...lineDraft, unit: e.target.value })}
                      />
                    </Td>
                    <Td className="text-right text-text-muted">—</Td>
                    <Td className="text-text-muted">—</Td>
                    <Td>
                      <StatusPillSelect
                        value={lineDraft.status}
                        onChange={(status) => setLineDraft({ ...lineDraft, status })}
                      />
                    </Td>
                    <Td className="text-text-muted">—</Td>
                    {showBranchColumn && <Td className="text-text-muted">—</Td>}
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          loading={creatingLine}
                          onClick={() => commitLineDraft(order)}
                        >
                          Add
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={closeAddLine}>
                          Close
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ) : (
                  <Tr>
                    <Td colSpan={colCount} className="border-r-0 py-1.5">
                      <button
                        type="button"
                        className="text-brand text-xs underline underline-offset-2"
                        onClick={() => openAddLine(order.id)}
                      >
                        + Add product
                      </button>
                    </Td>
                  </Tr>
                )}
              </Fragment>
            ))}
          </Tbody>
        </TableContainer>
      )}

      {orders !== null && total > PAGE_SIZE && (
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

export default CustomerOrdersPage
