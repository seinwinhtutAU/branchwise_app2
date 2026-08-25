import { useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { useWholesaleBranchOptions } from '@renderer/lib/useBranches'
import { parseColorShorthand, formatColorShorthand, colorShorthandTotal } from '@renderer/lib/colorShorthand'
import { Button } from '@renderer/components/ui/Button'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { Textarea } from '@renderer/components/ui/Textarea'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { FactoryIcon } from '@renderer/components/ui/icons'
import type { FactoryVoucher, Profile } from '@renderer/components/features/types'

interface Props {
  session: Session
  profile: Profile | null
}

const cellInputClass =
  'h-8 border-transparent bg-transparent hover:border-border focus:bg-bg-base ' +
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
const qtyColClass = 'min-w-[6rem]'

interface DraftState {
  voucher_date: string
  product_code: string
  factory_name: string
  qty: string
  buying_price: string
  colorsText: string
  discount_per_set: string
  remark: string
  branch_id: string
}

function emptyDraft(): DraftState {
  return {
    voucher_date: new Date().toISOString().slice(0, 10),
    product_code: '',
    factory_name: '',
    qty: '',
    buying_price: '',
    colorsText: '',
    discount_per_set: '',
    remark: '',
    branch_id: ''
  }
}

export function FactoryVouchersPage({ session, profile }: Props): React.JSX.Element {
  const showToast = useToast()
  const [vouchers, setVouchers] = useState<FactoryVoucher[] | null>(null)
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
      const response = await fetch(`${apiBaseUrl}/api/factory-vouchers`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load factory vouchers: ${response.status}`)
        return
      }
      setVouchers(await response.json())
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load factory vouchers — is the backend running?')
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

  function announceUpdatedOrders(count: number): void {
    if (count > 0) {
      showToast('success', `Priced ${count} customer order${count === 1 ? '' : 's'}`)
    }
  }

  async function commitDraft(opts?: { silent?: boolean }): Promise<void> {
    if (!draft.product_code.trim() || !draft.qty || !draft.buying_price) {
      if (!opts?.silent) showToast('error', 'Product code, qty, and buying price are required')
      return
    }
    if (needsBranch && !draft.branch_id) {
      if (!opts?.silent) showToast('error', 'Choose which branch this voucher belongs to')
      return
    }
    setCreating(true)
    try {
      const body = {
        voucher_date: draft.voucher_date,
        product_code: draft.product_code.trim(),
        factory_name: draft.factory_name.trim() || null,
        qty: Number(draft.qty),
        buying_price: Number(draft.buying_price),
        colors: parseColorShorthand(draft.colorsText),
        discount_per_set: draft.discount_per_set === '' ? null : Number(draft.discount_per_set),
        remark: draft.remark.trim() || null,
        branch_id: needsBranch ? draft.branch_id : null
      }
      const response = await fetch(`${apiBaseUrl}/api/factory-vouchers`, {
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
      showToast('success', `Voucher #${responseBody.voucher.voucher_no} added`)
      announceUpdatedOrders(responseBody.updated_order_count ?? 0)
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
    const hasContent = draft.product_code.trim() || draft.qty || draft.buying_price
    if (hasContent) commitDraft({ silent: true })
  }

  function handleDraftKeyDown(e: KeyboardEvent<HTMLTableRowElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitDraft()
    }
  }

  async function patchVoucher(voucher: FactoryVoucher, patch: Record<string, unknown>): Promise<void> {
    setSavingId(voucher.id)
    try {
      const response = await fetch(`${apiBaseUrl}/api/factory-vouchers/${voucher.id}`, {
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
      announceUpdatedOrders(responseBody?.updated_order_count ?? 0)
      await load()
    } catch {
      showToast('error', 'Update failed — is the backend running?')
    } finally {
      setSavingId(null)
    }
  }

  async function handleDelete(voucher: FactoryVoucher): Promise<void> {
    if (!window.confirm(`Delete voucher #${voucher.voucher_no} for ${voucher.product_code}?`)) return
    setDeletingId(voucher.id)
    try {
      const response = await fetch(`${apiBaseUrl}/api/factory-vouchers/${voucher.id}`, {
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
  const colCount = needsBranch ? 11 : 10

  return (
    <div className="flex flex-col gap-4">
      <CardHeader
        title="Factory vouchers"
        description={
          <>
            Matches customer orders by product code. Colors as{' '}
            <span className="font-mono">black10+pink20</span>.
          </>
        }
        action={
          !isAdding && (
            <Button size="sm" onClick={openAdd}>
              + Add voucher
            </Button>
          )
        }
      />

      {vouchers === null && loading && <TableSkeleton rows={4} cols={8} />}

      {vouchers === null && !loading && loadFailed && (
        <EmptyState
          icon={<FactoryIcon />}
          title="Couldn't load factory vouchers"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      )}

      {vouchers !== null && (
        <TableContainer>
          <Thead>
            <Tr>
              <Th>No.</Th>
              <Th>Date</Th>
              <Th>Product code</Th>
              <Th>Factory</Th>
              <Th>Colors</Th>
              <Th className={qtyColClass + ' text-right'}>Qty</Th>
              <Th className="text-right">Buying price</Th>
              <Th className="text-right">Discount / set</Th>
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
                    value={draft.voucher_date}
                    onChange={(e) => setDraft({ ...draft, voucher_date: e.target.value })}
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
                  {draftTotal > 0 && <span className="text-xs text-text-muted ml-1">= {draftTotal}</span>}
                </Td>
                <Td className={qtyColClass}>
                  <Input
                    type="number"
                    min={0}
                    className={cellInputClass + ' text-right'}
                    value={draft.qty}
                    onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
                  />
                </Td>
                <Td className="text-right">
                  <Input
                    type="number"
                    min={0}
                    className={cellInputClass + ' w-24 text-right'}
                    value={draft.buying_price}
                    onChange={(e) => setDraft({ ...draft, buying_price: e.target.value })}
                  />
                </Td>
                <Td className="text-right">
                  <Input
                    type="number"
                    min={0}
                    className={cellInputClass + ' w-20 text-right'}
                    value={draft.discount_per_set}
                    onChange={(e) => setDraft({ ...draft, discount_per_set: e.target.value })}
                  />
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

            {!isAdding && vouchers.length === 0 && (
              <Tr>
                <Td colSpan={colCount} className="text-center text-text-muted py-8 border-r-0">
                  No factory vouchers yet —{' '}
                  <button type="button" className="text-brand underline underline-offset-2" onClick={openAdd}>
                    add one
                  </button>
                  .
                </Td>
              </Tr>
            )}

            {vouchers.map((voucher) => (
              <Tr key={voucher.id}>
                <Td>{voucher.voucher_no}</Td>
                <Td>
                  <Input
                    key={voucher.voucher_date}
                    type="date"
                    className={cellInputClass}
                    disabled={savingId === voucher.id}
                    defaultValue={voucher.voucher_date}
                    onBlur={(e) => {
                      if (e.target.value && e.target.value !== voucher.voucher_date) {
                        patchVoucher(voucher, { voucher_date: e.target.value })
                      }
                    }}
                  />
                </Td>
                <Td>
                  <Input
                    key={voucher.product_code}
                    className={cellInputClass + ' min-w-[8rem]'}
                    disabled={savingId === voucher.id}
                    defaultValue={voucher.product_code}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== voucher.product_code) {
                        patchVoucher(voucher, { product_code: e.target.value.trim() })
                      }
                    }}
                  />
                </Td>
                <Td>
                  <Textarea
                    key={voucher.factory_name ?? ''}
                    className={cellInputClass + ' min-w-[10rem]'}
                    disabled={savingId === voucher.id}
                    defaultValue={voucher.factory_name ?? ''}
                    onBlur={(e) => {
                      if (e.target.value !== (voucher.factory_name ?? '')) {
                        patchVoucher(voucher, { factory_name: e.target.value || null })
                      }
                    }}
                  />
                </Td>
                <Td>
                  <Input
                    key={formatColorShorthand(voucher.colors)}
                    className={cellInputClass + ' font-mono min-w-[9rem]'}
                    placeholder="black10+pink20"
                    disabled={savingId === voucher.id}
                    defaultValue={formatColorShorthand(voucher.colors)}
                    onBlur={(e) => {
                      if (e.target.value !== formatColorShorthand(voucher.colors)) {
                        patchVoucher(voucher, { colors: parseColorShorthand(e.target.value) })
                      }
                    }}
                  />
                </Td>
                <Td className={qtyColClass}>
                  <Input
                    key={voucher.qty}
                    type="number"
                    min={0}
                    className={cellInputClass + ' text-right'}
                    disabled={savingId === voucher.id}
                    defaultValue={voucher.qty}
                    onBlur={(e) => {
                      const next = Number(e.target.value)
                      if (next !== voucher.qty) patchVoucher(voucher, { qty: next })
                    }}
                  />
                </Td>
                <Td className="text-right">
                  <Input
                    key={voucher.buying_price}
                    type="number"
                    min={0}
                    className={cellInputClass + ' w-24 text-right'}
                    disabled={savingId === voucher.id}
                    defaultValue={voucher.buying_price}
                    onBlur={(e) => {
                      const next = Number(e.target.value)
                      if (next !== voucher.buying_price) patchVoucher(voucher, { buying_price: next })
                    }}
                  />
                </Td>
                <Td className="text-right">
                  <Input
                    key={voucher.discount_per_set ?? ''}
                    type="number"
                    min={0}
                    className={cellInputClass + ' w-20 text-right'}
                    disabled={savingId === voucher.id}
                    defaultValue={voucher.discount_per_set ?? ''}
                    onBlur={(e) => {
                      const raw = e.target.value
                      const current = voucher.discount_per_set ?? ''
                      if (String(raw) !== String(current)) {
                        patchVoucher(voucher, { discount_per_set: raw === '' ? null : Number(raw) })
                      }
                    }}
                  />
                </Td>
                <Td>
                  <Textarea
                    key={voucher.remark ?? ''}
                    className={cellInputClass + ' min-w-[12rem]'}
                    disabled={savingId === voucher.id}
                    defaultValue={voucher.remark ?? ''}
                    onBlur={(e) => {
                      if (e.target.value !== (voucher.remark ?? '')) {
                        patchVoucher(voucher, { remark: e.target.value || null })
                      }
                    }}
                  />
                </Td>
                {needsBranch && <Td className="text-text-muted">{voucher.branch_name ?? '—'}</Td>}
                <Td>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(voucher)}
                    loading={deletingId === voucher.id}
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

export default FactoryVouchersPage
