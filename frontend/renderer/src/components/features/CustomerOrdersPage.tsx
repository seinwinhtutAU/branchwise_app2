import { useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { useWholesaleBranchOptions } from '@renderer/lib/useBranches'
import { cn } from '@renderer/lib/utils'
import { parseColorShorthand, formatColorShorthand, colorShorthandTotal } from '@renderer/lib/colorShorthand'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { Textarea } from '@renderer/components/ui/Textarea'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { ClipboardIcon } from '@renderer/components/ui/icons'
import type { CustomerOrder, OrderStatus, Profile } from '@renderer/components/features/types'

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

// Applied to every inline cell input: transparent until hovered/focused (reads as a
// spreadsheet cell, not a form field), and strips the native number spinner — harmless on
// non-number inputs since those selectors just don't match anything on them.
const cellInputClass =
  'h-8 border-transparent bg-transparent hover:border-border focus:bg-bg-base ' +
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
const qtyColClass = 'min-w-[6rem]'

interface DraftState {
  order_date: string
  product_code: string
  customer_name: string
  factory_name: string
  first_commit_qty: string
  second_commit_qty: string
  colorsText: string
  unit: string
  remark: string
  branch_id: string
}

function emptyDraft(): DraftState {
  return {
    order_date: new Date().toISOString().slice(0, 10),
    product_code: '',
    customer_name: '',
    factory_name: '',
    first_commit_qty: '',
    second_commit_qty: '',
    colorsText: '',
    unit: 'Set',
    remark: '',
    branch_id: ''
  }
}

export function CustomerOrdersPage({ session, profile }: Props): React.JSX.Element {
  const showToast = useToast()
  const [orders, setOrders] = useState<CustomerOrder[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [isAdding, setIsAdding] = useState(false)
  const [draft, setDraft] = useState<DraftState>(emptyDraft())
  const [creating, setCreating] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const needsBranch = profile !== null && profile.branch_id === null
  const branchOptions = useWholesaleBranchOptions(needsBranch ? session : null)

  async function load(): Promise<void> {
    setLoading(true)
    setLoadFailed(false)
    try {
      const response = await fetch(`${apiBaseUrl}/api/orders`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load orders: ${response.status}`)
        return
      }
      setOrders(await response.json())
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
  }, [session.access_token])

  function openAdd(): void {
    setDraft(emptyDraft())
    setIsAdding(true)
  }

  function closeAdd(): void {
    setIsAdding(false)
    setDraft(emptyDraft())
  }

  async function commitDraft(opts?: { silent?: boolean }): Promise<void> {
    if (!draft.product_code.trim() || !draft.customer_name.trim()) {
      if (!opts?.silent) showToast('error', 'Product code and customer name are required')
      return
    }
    if (needsBranch && !draft.branch_id) {
      if (!opts?.silent) showToast('error', 'Choose which branch this order belongs to')
      return
    }
    setCreating(true)
    try {
      const body = {
        order_date: draft.order_date,
        product_code: draft.product_code.trim(),
        customer_name: draft.customer_name.trim(),
        factory_name: draft.factory_name.trim() || null,
        first_commit_qty: draft.first_commit_qty === '' ? null : Number(draft.first_commit_qty),
        second_commit_qty: draft.second_commit_qty === '' ? null : Number(draft.second_commit_qty),
        colors: parseColorShorthand(draft.colorsText),
        unit: draft.unit || 'Set',
        remark: draft.remark.trim() || null,
        received_qty: 0,
        branch_id: needsBranch ? draft.branch_id : null
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
      showToast('success', `Order #${responseBody.order_no} added`)
      setDraft(emptyDraft())
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
    setSavingId(order.id)
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
      setSavingId(null)
    }
  }

  async function handleDelete(order: CustomerOrder): Promise<void> {
    if (!window.confirm(`Delete order #${order.order_no} for ${order.customer_name}?`)) return
    setDeletingId(order.id)
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
      setDeletingId(null)
    }
  }

  const draftTotal = colorShorthandTotal(draft.colorsText)
  const colCount = needsBranch ? 17 : 16

  return (
    <div className="flex flex-col gap-4">
      <CardHeader
        title="Customer orders"
        description={
          <>
            Colors as <span className="font-mono">black10+pink20</span> — total qty is the sum.
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
        <TableContainer>
          <Thead>
            <Tr>
              <Th>No.</Th>
              <Th>Date</Th>
              <Th>Product code</Th>
              <Th className={qtyColClass}>Ordered qty</Th>
              <Th className={qtyColClass}>Approved qty</Th>
              <Th>Customer</Th>
              <Th>Factory</Th>
              <Th>Colors</Th>
              <Th className={qtyColClass}>Total qty</Th>
              <Th className={qtyColClass}>Received qty</Th>
              <Th className={qtyColClass}>Unit</Th>
              <Th className="text-right">Buying price</Th>
              <Th>Matched voucher</Th>
              <Th>Status</Th>
              <Th>Remark</Th>
              {needsBranch && <Th>Branch</Th>}
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
                    className={cellInputClass}
                    value={draft.order_date}
                    onChange={(e) => setDraft({ ...draft, order_date: e.target.value })}
                  />
                </Td>
                <Td>
                  <Input
                    placeholder="Product code"
                    className={cellInputClass + ' min-w-[8rem]'}
                    value={draft.product_code}
                    onChange={(e) => setDraft({ ...draft, product_code: e.target.value })}
                  />
                </Td>
                <Td className={qtyColClass}>
                  <Input
                    type="number"
                    min={0}
                    className={cellInputClass}
                    value={draft.first_commit_qty}
                    onChange={(e) => setDraft({ ...draft, first_commit_qty: e.target.value })}
                  />
                </Td>
                <Td className={qtyColClass}>
                  <Input
                    type="number"
                    min={0}
                    className={cellInputClass}
                    value={draft.second_commit_qty}
                    onChange={(e) => setDraft({ ...draft, second_commit_qty: e.target.value })}
                  />
                </Td>
                <Td>
                  <Input
                    placeholder="Customer"
                    className={cellInputClass + ' min-w-[9rem]'}
                    value={draft.customer_name}
                    onChange={(e) => setDraft({ ...draft, customer_name: e.target.value })}
                  />
                </Td>
                <Td>
                  <Textarea
                    placeholder="Factory"
                    className={cellInputClass + ' min-w-[10rem]'}
                    value={draft.factory_name}
                    onChange={(e) => setDraft({ ...draft, factory_name: e.target.value })}
                  />
                </Td>
                <Td>
                  <Input
                    placeholder="black10+pink20"
                    className={cellInputClass + ' font-mono min-w-[9rem]'}
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
                    className={cellInputClass}
                    value={draft.unit}
                    onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
                  />
                </Td>
                <Td className="text-right text-text-muted">—</Td>
                <Td className="text-text-muted">—</Td>
                <Td>
                  <Badge variant="error">Not started</Badge>
                </Td>
                <Td>
                  <Textarea
                    placeholder="Remark"
                    className={cellInputClass + ' min-w-[12rem]'}
                    value={draft.remark}
                    onChange={(e) => setDraft({ ...draft, remark: e.target.value })}
                  />
                </Td>
                {needsBranch && (
                  <Td>
                    <Select
                      className="h-8 py-0"
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
              <Tr key={order.id}>
                <Td>{order.order_no}</Td>
                <Td>
                  <Input
                    key={order.order_date}
                    type="date"
                    className={cellInputClass}
                    disabled={savingId === order.id}
                    defaultValue={order.order_date}
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== order.order_date) {
                        patchOrder(order, { order_date: e.target.value })
                      }
                    }}
                  />
                </Td>
                <Td>
                  <Input
                    key={order.product_code}
                    className={cellInputClass + ' min-w-[8rem]'}
                    disabled={savingId === order.id}
                    defaultValue={order.product_code}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== order.product_code) {
                        patchOrder(order, { product_code: e.target.value.trim() })
                      }
                    }}
                  />
                </Td>
                <Td className={qtyColClass}>
                  <Input
                    key={order.first_commit_qty ?? ''}
                    type="number"
                    min={0}
                    className={cellInputClass}
                    disabled={savingId === order.id}
                    defaultValue={order.first_commit_qty ?? ''}
                    onBlur={(e) => {
                      const next = e.target.value === '' ? null : Number(e.target.value)
                      if (next !== order.first_commit_qty) patchOrder(order, { first_commit_qty: next })
                    }}
                  />
                </Td>
                <Td className={qtyColClass}>
                  <Input
                    key={order.second_commit_qty ?? ''}
                    type="number"
                    min={0}
                    className={cellInputClass}
                    disabled={savingId === order.id}
                    defaultValue={order.second_commit_qty ?? ''}
                    onBlur={(e) => {
                      const next = e.target.value === '' ? null : Number(e.target.value)
                      if (next !== order.second_commit_qty) patchOrder(order, { second_commit_qty: next })
                    }}
                  />
                </Td>
                <Td>
                  <Input
                    key={order.customer_name}
                    className={cellInputClass + ' min-w-[9rem]'}
                    disabled={savingId === order.id}
                    defaultValue={order.customer_name}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== order.customer_name) {
                        patchOrder(order, { customer_name: e.target.value.trim() })
                      }
                    }}
                  />
                </Td>
                <Td>
                  <Textarea
                    key={order.factory_name ?? ''}
                    className={cellInputClass + ' min-w-[10rem]'}
                    disabled={savingId === order.id}
                    defaultValue={order.factory_name ?? ''}
                    onBlur={(e) => {
                      if (e.target.value !== (order.factory_name ?? '')) {
                        patchOrder(order, { factory_name: e.target.value || null })
                      }
                    }}
                  />
                </Td>
                <Td>
                  <Input
                    key={formatColorShorthand(order.colors)}
                    className={cellInputClass + ' font-mono min-w-[9rem]'}
                    placeholder="black10+pink20"
                    disabled={savingId === order.id}
                    defaultValue={formatColorShorthand(order.colors)}
                    onBlur={(e) => {
                      if (e.target.value !== formatColorShorthand(order.colors)) {
                        patchOrder(order, { colors: parseColorShorthand(e.target.value) })
                      }
                    }}
                  />
                </Td>
                <Td className={qtyColClass + ' text-right tabular-nums'}>{order.total_qty}</Td>
                <Td className={qtyColClass}>
                  <Input
                    key={order.received_qty}
                    type="number"
                    min={0}
                    max={order.total_qty}
                    disabled={savingId === order.id}
                    defaultValue={order.received_qty}
                    className={cellInputClass}
                    onBlur={(e) => {
                      const next = Number(e.target.value)
                      if (next !== order.received_qty) patchOrder(order, { received_qty: next })
                    }}
                  />
                </Td>
                <Td className={qtyColClass}>
                  <Input
                    key={order.unit}
                    className={cellInputClass}
                    disabled={savingId === order.id}
                    defaultValue={order.unit}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== order.unit) {
                        patchOrder(order, { unit: e.target.value.trim() })
                      }
                    }}
                  />
                </Td>
                <Td className="text-right tabular-nums">{order.buying_price ?? '—'}</Td>
                <Td className="text-text-muted">
                  {order.matched_voucher_no ? `#${order.matched_voucher_no}` : '—'}
                </Td>
                <Td>
                  <StatusPillSelect
                    value={order.status}
                    disabled={savingId === order.id}
                    onChange={(status) => patchOrder(order, { status })}
                  />
                </Td>
                <Td>
                  <Textarea
                    key={order.remark ?? ''}
                    className={cellInputClass + ' min-w-[12rem]'}
                    disabled={savingId === order.id}
                    defaultValue={order.remark ?? ''}
                    onBlur={(e) => {
                      if (e.target.value !== (order.remark ?? '')) {
                        patchOrder(order, { remark: e.target.value || null })
                      }
                    }}
                  />
                </Td>
                {needsBranch && <Td className="text-text-muted">{order.branch_name ?? '—'}</Td>}
                <Td>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(order)}
                    loading={deletingId === order.id}
                  >
                    Delete
                  </Button>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </TableContainer>
      )}
    </div>
  )
}

export default CustomerOrdersPage
