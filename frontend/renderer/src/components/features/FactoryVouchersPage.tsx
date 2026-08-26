import { Fragment, useEffect, useState, type FocusEvent, type KeyboardEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { useWholesaleBranchOptions } from '@renderer/lib/useBranches'
import { cn } from '@renderer/lib/utils'
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
import type { FactoryVoucher, FactoryVoucherLine, Profile } from '@renderer/components/features/types'

interface Props {
  session: Session
  profile: Profile | null
}

const noSpinnerClass =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none'
// Existing rows: transparent until hovered/focused, reads as a clean spreadsheet.
const cellInputClass = `h-8 border-transparent bg-transparent hover:border-border focus:bg-bg-base ${noSpinnerClass}`
// The "New" draft row instead: a visible border by default, so it reads as an empty form
// waiting to be filled rather than blank space.
const draftCellInputClass = `h-8 border-border bg-bg-base hover:border-border-strong focus:border-brand ${noSpinnerClass}`
const qtyColClass = 'min-w-[6rem]'

// The two fields commitDraft() actually requires — everything else is optional. Tints
// the border red once a submit attempt has failed because this cell is still empty, not
// the instant the row opens — the column header carries the "required" hint otherwise.
function requiredDraftClass(value: string, attempted: boolean): string {
  return attempted && value.trim() === '' ? 'border-error focus:border-error' : ''
}

interface LineDraftState {
  product_code: string
  buying_price: string
  colorsText: string
  discount_per_set: string
}

function emptyLineDraft(): LineDraftState {
  return {
    product_code: '',
    buying_price: '',
    colorsText: '',
    discount_per_set: ''
  }
}

interface DraftState extends LineDraftState {
  voucher_date: string
  factory_name: string
  remark: string
  branch_id: string
}

function emptyDraft(): DraftState {
  return {
    ...emptyLineDraft(),
    voucher_date: new Date().toISOString().slice(0, 10),
    factory_name: '',
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
  const [attemptedSubmit, setAttemptedSubmit] = useState(false)
  const [draft, setDraft] = useState<DraftState>(emptyDraft())
  const [creating, setCreating] = useState(false)
  const [savingVoucherId, setSavingVoucherId] = useState<string | null>(null)
  const [savingLineId, setSavingLineId] = useState<string | null>(null)
  const [deletingVoucherId, setDeletingVoucherId] = useState<string | null>(null)
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null)
  const [addingLineVoucherId, setAddingLineVoucherId] = useState<string | null>(null)
  const [lineAttemptedSubmit, setLineAttemptedSubmit] = useState(false)
  const [lineDraft, setLineDraft] = useState<LineDraftState>(emptyLineDraft())
  const [creatingLine, setCreatingLine] = useState(false)

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
    setAttemptedSubmit(false)
    setIsAdding(true)
  }

  function closeAdd(): void {
    setIsAdding(false)
    setAttemptedSubmit(false)
    setDraft(emptyDraft())
  }

  function announceUpdatedOrders(count: number): void {
    if (count > 0) {
      showToast('success', `Priced ${count} customer order${count === 1 ? '' : 's'}`)
    }
  }

  async function commitDraft(opts?: { silent?: boolean }): Promise<void> {
    if (!draft.product_code.trim() || !draft.buying_price) {
      setAttemptedSubmit(true)
      if (!opts?.silent) showToast('error', 'Product code and buying price are required')
      return
    }
    if (needsBranch && !draft.branch_id) {
      setAttemptedSubmit(true)
      if (!opts?.silent) showToast('error', 'Choose which branch this voucher belongs to')
      return
    }
    setCreating(true)
    try {
      const body = {
        voucher_date: draft.voucher_date,
        factory_name: draft.factory_name.trim() || null,
        remark: draft.remark.trim() || null,
        branch_id: needsBranch ? draft.branch_id : null,
        line: {
          product_code: draft.product_code.trim(),
          buying_price: Number(draft.buying_price),
          colors: parseColorShorthand(draft.colorsText),
          discount_per_set: draft.discount_per_set === '' ? null : Number(draft.discount_per_set)
        }
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
    const hasContent = draft.product_code.trim() || draft.colorsText.trim() || draft.buying_price
    if (hasContent) commitDraft({ silent: true })
  }

  function handleDraftKeyDown(e: KeyboardEvent<HTMLTableRowElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitDraft()
    }
  }

  async function patchVoucher(voucher: FactoryVoucher, patch: Record<string, unknown>): Promise<void> {
    setSavingVoucherId(voucher.id)
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
      await load()
    } catch {
      showToast('error', 'Update failed — is the backend running?')
    } finally {
      setSavingVoucherId(null)
    }
  }

  async function patchLine(
    voucher: FactoryVoucher,
    line: FactoryVoucherLine,
    patch: Record<string, unknown>
  ): Promise<void> {
    setSavingLineId(line.id)
    try {
      const response = await fetch(`${apiBaseUrl}/api/factory-vouchers/${voucher.id}/lines/${line.id}`, {
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
      setSavingLineId(null)
    }
  }

  async function handleDeleteVoucher(voucher: FactoryVoucher): Promise<void> {
    if (!window.confirm(`Delete voucher #${voucher.voucher_no} and all its products?`)) return
    setDeletingVoucherId(voucher.id)
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
      setDeletingVoucherId(null)
    }
  }

  async function handleDeleteLine(voucher: FactoryVoucher, line: FactoryVoucherLine): Promise<void> {
    const message =
      voucher.lines.length === 1
        ? `Delete voucher #${voucher.voucher_no}? It has only this one product.`
        : `Delete product ${line.product_code} from voucher #${voucher.voucher_no}?`
    if (!window.confirm(message)) return
    setDeletingLineId(line.id)
    try {
      const response = await fetch(`${apiBaseUrl}/api/factory-vouchers/${voucher.id}/lines/${line.id}`, {
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

  function openAddLine(voucherId: string): void {
    setLineDraft(emptyLineDraft())
    setLineAttemptedSubmit(false)
    setAddingLineVoucherId(voucherId)
  }

  function closeAddLine(): void {
    setAddingLineVoucherId(null)
    setLineAttemptedSubmit(false)
    setLineDraft(emptyLineDraft())
  }

  async function commitLineDraft(voucher: FactoryVoucher, opts?: { silent?: boolean }): Promise<void> {
    if (!lineDraft.product_code.trim() || !lineDraft.buying_price) {
      setLineAttemptedSubmit(true)
      if (!opts?.silent) showToast('error', 'Product code and buying price are required')
      return
    }
    setCreatingLine(true)
    try {
      const body = {
        product_code: lineDraft.product_code.trim(),
        buying_price: Number(lineDraft.buying_price),
        colors: parseColorShorthand(lineDraft.colorsText),
        discount_per_set: lineDraft.discount_per_set === '' ? null : Number(lineDraft.discount_per_set)
      }
      const response = await fetch(`${apiBaseUrl}/api/factory-vouchers/${voucher.id}/lines`, {
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
      announceUpdatedOrders(responseBody.updated_order_count ?? 0)
      closeAddLine()
      await load()
    } catch {
      showToast('error', 'Add failed — is the backend running?')
    } finally {
      setCreatingLine(false)
    }
  }

  function handleLineDraftRowBlur(voucher: FactoryVoucher, e: FocusEvent<HTMLTableRowElement>): void {
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    const hasContent = lineDraft.product_code.trim() || lineDraft.colorsText.trim() || lineDraft.buying_price
    if (hasContent) commitLineDraft(voucher, { silent: true })
  }

  function handleLineDraftKeyDown(voucher: FactoryVoucher, e: KeyboardEvent<HTMLTableRowElement>): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitLineDraft(voucher)
    }
  }

  const draftTotal = colorShorthandTotal(draft.colorsText)
  const lineDraftTotal = colorShorthandTotal(lineDraft.colorsText)
  const colCount = needsBranch ? 11 : 10

  return (
    <div className="flex flex-col gap-4">
      <CardHeader
        title="Factory vouchers"
        description={
          <>
            One voucher can list several products. Matches customer orders by product code.
            Colors as <span className="font-mono">black10+pink20</span>.
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
        <TableContainer className="pb-4">
          <Thead>
            <Tr>
              <Th>No.</Th>
              <Th>Date</Th>
              <Th>Factory</Th>
              <Th>{isAdding ? 'Product code *' : 'Product code'}</Th>
              <Th>Colors</Th>
              <Th className={qtyColClass + ' text-right'}>Qty</Th>
              <Th className="text-right">{isAdding ? 'Buying price *' : 'Buying price'}</Th>
              <Th className="text-right">Discount / set</Th>
              <Th>Remark</Th>
              {needsBranch && <Th>{isAdding ? 'Branch *' : 'Branch'}</Th>}
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
                    value={draft.voucher_date}
                    onChange={(e) => setDraft({ ...draft, voucher_date: e.target.value })}
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
                <Td className="text-right">
                  <Input
                    type="number"
                    min={0}
                    placeholder="Price"
                    className={cn(
                      draftCellInputClass,
                      'w-24 text-right',
                      requiredDraftClass(draft.buying_price, attemptedSubmit)
                    )}
                    value={draft.buying_price}
                    onChange={(e) => setDraft({ ...draft, buying_price: e.target.value })}
                  />
                </Td>
                <Td className="text-right">
                  <Input
                    type="number"
                    min={0}
                    className={draftCellInputClass + ' w-20 text-right'}
                    value={draft.discount_per_set}
                    onChange={(e) => setDraft({ ...draft, discount_per_set: e.target.value })}
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
                {needsBranch && (
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
              <Fragment key={voucher.id}>
                {voucher.lines.map((line, lineIndex) => (
                  <Tr key={line.id}>
                    {lineIndex === 0 && (
                      <>
                        <Td rowSpan={voucher.lines.length} className="align-top">
                          <div className="flex items-center gap-1.5">
                            <span>{voucher.voucher_no}</span>
                            <button
                              type="button"
                              title="Delete voucher"
                              className="text-text-muted hover:text-error disabled:opacity-50"
                              disabled={deletingVoucherId === voucher.id}
                              onClick={() => handleDeleteVoucher(voucher)}
                            >
                              ×
                            </button>
                          </div>
                        </Td>
                        <Td rowSpan={voucher.lines.length} className="align-top">
                          <Input
                            key={voucher.voucher_date}
                            type="date"
                            className={cellInputClass}
                            disabled={savingVoucherId === voucher.id}
                            defaultValue={voucher.voucher_date}
                            onBlur={(e) => {
                              if (e.target.value && e.target.value !== voucher.voucher_date) {
                                patchVoucher(voucher, { voucher_date: e.target.value })
                              }
                            }}
                          />
                        </Td>
                        <Td rowSpan={voucher.lines.length} className="align-top">
                          <Textarea
                            key={voucher.factory_name ?? ''}
                            className={cellInputClass + ' min-w-[10rem]'}
                            disabled={savingVoucherId === voucher.id}
                            defaultValue={voucher.factory_name ?? ''}
                            onBlur={(e) => {
                              if (e.target.value !== (voucher.factory_name ?? '')) {
                                patchVoucher(voucher, { factory_name: e.target.value || null })
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
                            patchLine(voucher, line, { product_code: e.target.value.trim() })
                          }
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
                            patchLine(voucher, line, { colors: parseColorShorthand(e.target.value) })
                          }
                        }}
                      />
                    </Td>
                    <Td className={qtyColClass + ' text-right tabular-nums'}>{line.qty}</Td>
                    <Td className="text-right">
                      <Input
                        key={line.buying_price}
                        type="number"
                        min={0}
                        className={cellInputClass + ' w-24 text-right'}
                        disabled={savingLineId === line.id}
                        defaultValue={line.buying_price}
                        onBlur={(e) => {
                          const next = Number(e.target.value)
                          if (next !== line.buying_price) patchLine(voucher, line, { buying_price: next })
                        }}
                      />
                    </Td>
                    <Td className="text-right">
                      <Input
                        key={line.discount_per_set ?? ''}
                        type="number"
                        min={0}
                        className={cellInputClass + ' w-20 text-right'}
                        disabled={savingLineId === line.id}
                        defaultValue={line.discount_per_set ?? ''}
                        onBlur={(e) => {
                          const raw = e.target.value
                          const current = line.discount_per_set ?? ''
                          if (String(raw) !== String(current)) {
                            patchLine(voucher, line, { discount_per_set: raw === '' ? null : Number(raw) })
                          }
                        }}
                      />
                    </Td>
                    {lineIndex === 0 && (
                      <Td rowSpan={voucher.lines.length} className="align-top">
                        <Textarea
                          key={voucher.remark ?? ''}
                          className={cellInputClass + ' min-w-[12rem]'}
                          disabled={savingVoucherId === voucher.id}
                          defaultValue={voucher.remark ?? ''}
                          onBlur={(e) => {
                            if (e.target.value !== (voucher.remark ?? '')) {
                              patchVoucher(voucher, { remark: e.target.value || null })
                            }
                          }}
                        />
                      </Td>
                    )}
                    {needsBranch && lineIndex === 0 && (
                      <Td rowSpan={voucher.lines.length} className="align-top text-text-muted">
                        {voucher.branch_name ?? '—'}
                      </Td>
                    )}
                    <Td>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteLine(voucher, line)}
                        loading={deletingLineId === line.id}
                      >
                        Delete
                      </Button>
                    </Td>
                  </Tr>
                ))}

                {addingLineVoucherId === voucher.id ? (
                  <Tr
                    className="bg-brand-subtle/40"
                    onBlur={(e) => handleLineDraftRowBlur(voucher, e)}
                    onKeyDown={(e) => handleLineDraftKeyDown(voucher, e)}
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
                    <Td className="text-right">
                      <Input
                        type="number"
                        min={0}
                        placeholder="Price"
                        className={cn(
                          draftCellInputClass,
                          'w-24 text-right',
                          requiredDraftClass(lineDraft.buying_price, lineAttemptedSubmit)
                        )}
                        value={lineDraft.buying_price}
                        onChange={(e) => setLineDraft({ ...lineDraft, buying_price: e.target.value })}
                      />
                    </Td>
                    <Td className="text-right">
                      <Input
                        type="number"
                        min={0}
                        className={draftCellInputClass + ' w-20 text-right'}
                        value={lineDraft.discount_per_set}
                        onChange={(e) => setLineDraft({ ...lineDraft, discount_per_set: e.target.value })}
                      />
                    </Td>
                    <Td className="text-text-muted">—</Td>
                    {needsBranch && <Td className="text-text-muted">—</Td>}
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          loading={creatingLine}
                          onClick={() => commitLineDraft(voucher)}
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
                        onClick={() => openAddLine(voucher.id)}
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
    </div>
  )
}

export default FactoryVouchersPage
