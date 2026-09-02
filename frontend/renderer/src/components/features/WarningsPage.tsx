import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useCachedFetch } from '@renderer/lib/useCachedFetch'
import { cn } from '@renderer/lib/utils'
import { useImportFilePicker } from '@renderer/lib/useImportFilePicker'
import { Button } from '@renderer/components/ui/Button'
import { Badge } from '@renderer/components/ui/Badge'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Select } from '@renderer/components/ui/Select'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { WarningIcon, ChevronDownIcon, ChevronUpIcon } from '@renderer/components/ui/icons'
import type { PendingImport, Profile } from '@renderer/components/features/types'

interface WarningField {
  label: string
  value: string
}

interface SourceImport {
  id: string
  filename: string | null
  date: string
}

interface WarningRow {
  note: string
  fields: WarningField[]
  // Labels of the field(s) that are actually the problem — e.g. ["Qty"] for a zero-qty
  // sale line. Empty when nothing single field is "the" issue (a missing inventory
  // record is an absence, not a bad value).
  highlight: string[]
  // Which confirmed import this bad value came from, if any. Null for checks that can
  // span several imports (nothing single to point at).
  source_import: SourceImport | null
}

interface WarningSection {
  id: string
  title: string
  description: string
  severity: 'warning' | 'critical'
  rows: WarningRow[]
}

interface Props {
  session: Session
  profile: Profile | null
  onCountChange?: (count: number) => void
  saleWindowDays: number
  purchaseWindowDays: number
  // Every real branch, for the Branch filter dropdown — admin accounts see every
  // branch's rows merged together (retail and wholesale, though wholesale never has any
  // sale/inventory/purchase data to warn about), so admin is the only role that can
  // usefully narrow down to one. A branch-scoped account already only ever sees its own
  // branch's rows, so passing an empty list here (as App.tsx does for non-admin) hides
  // the filter entirely rather than showing a pointless single-option dropdown.
  branchOptions: string[]
  onViewImportBatch?: (batchId: string) => void
  // Hands off a picked-and-parsed file to the app-level confirm flow — used by every
  // "Reimport to fix" button below.
  onFileReady?: (pending: PendingImport) => void
}

type ImportType = 'sales' | 'inventory' | 'purchase'

const IMPORT_TYPE_ENDPOINT: Record<ImportType, string> = {
  sales: '/api/imports/sales',
  purchase: '/api/imports/purchase',
  inventory: '/api/imports/inventory'
}

const IMPORT_TYPE_LABEL: Record<ImportType, string> = {
  sales: 'Sales',
  purchase: 'Purchase',
  inventory: 'Inventory'
}

type Category = 'Sale' | 'Inventory' | 'Purchase' | 'Daily check'

// Order used by the "All" tab — daily check surfaces first since it's the one most
// likely to hide a real stock-count problem, ahead of the per-transaction checks.
const ALL_TAB_ORDER: Category[] = ['Daily check', 'Sale', 'Inventory', 'Purchase']

type Tab = 'All' | Category
const TAB_ORDER: Tab[] = ['All', 'Daily check', 'Sale', 'Inventory', 'Purchase']

// Which broad area each backend check belongs under — purely a display grouping. The
// backend still returns one row per check (each has its own detail fields), but every
// check's row now boils down to the same shape once you pull out Branch/Stock
// Code/Description: an identity, plus a short action.
const SECTION_CATEGORY: Record<string, Category> = {
  sale_numeric: 'Sale',
  missing_product: 'Inventory',
  inventory_numeric: 'Inventory',
  purchase_numeric: 'Purchase',
  reconciliation_uom: 'Daily check',
  reconciliation_mismatch: 'Daily check'
}

// Every category's rows are grouped by which import produced them (see buildBatchGroups)
// so each group's "Reimport to fix" button can revert that one batch and replace it with
// a corrected file in one action — the only fix path, for every category:
// - Sale/Purchase: the bad value lives inside the uploaded file itself, so a corrected
//   re-import only takes effect once that exact batch is removed first (re-confirming
//   otherwise skips already-imported slips as duplicates for Sale, or double-counts for
//   Purchase).
// - Inventory/Daily check: `stock_levels` is append-only, so a bad snapshot doesn't
//   strictly need removing — "current stock" is always just the latest one. But the
//   daily reconciliation check compares the latest snapshot against the one right
//   before it, so a bad value can still get used as "the prior count" for one more
//   comparison even after being superseded by a newer, correct snapshot. Reimport-ing
//   the specific bad batch (instead of just adding a new one alongside it) avoids that
//   by removing it from history outright — simpler for staff than having to reason
//   about which fix applies to which category.

// Which upload endpoint a category's Reimport buttons parse against.
const CATEGORY_IMPORT_TYPE: Record<Category, ImportType> = {
  Sale: 'sales',
  Purchase: 'purchase',
  Inventory: 'inventory',
  'Daily check': 'inventory'
}

const RETAIL_REMOVE_WINDOW_MS = 24 * 60 * 60 * 1000

function isRemoveLocked(dateIso: string, profile: Profile | null): boolean {
  return profile?.role === 'retail' && Date.now() - new Date(dateIso).getTime() > RETAIL_REMOVE_WINDOW_MS
}

const PRIMARY_LABELS = ['Branch', 'Stock Code', 'Description']

// Every check names its date field a little differently depending on which real list
// page it mirrors (Sale/Purchase call it "Date", Inventory calls it "Last Updated",
// and a missing-product row only has a "Last Date" it was seen on) — try them in order
// so the main table can show one "Date" column regardless of which check a row is from.
const DATE_LABELS = ['Date', 'Last Updated', 'Last Date']

function fieldValue(fields: WarningField[], label: string): string {
  return fields.find((f) => f.label === label)?.value ?? '—'
}

function distinctBranches(sections: WarningSection[] | null): string[] {
  if (!sections) return []
  const values = new Set<string>()
  for (const section of sections) {
    for (const row of section.rows) {
      const branch = fieldValue(row.fields, 'Branch')
      if (branch && branch !== '—') values.add(branch)
    }
  }
  return Array.from(values).sort()
}

function filterSectionsByBranch(
  sections: WarningSection[] | null,
  branch: string
): WarningSection[] | null {
  if (!sections || !branch) return sections
  return sections.map((section) => ({
    ...section,
    rows: section.rows.filter((row) => fieldValue(row.fields, 'Branch') === branch)
  }))
}

function dateFieldLabel(fields: WarningField[]): string | undefined {
  return DATE_LABELS.find((label) => fields.some((f) => f.label === label))
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

interface FlatRow {
  key: string
  severity: 'warning' | 'critical'
  row: WarningRow
}

// Critical first, so the thing most worth acting on is always at the top.
function bySeverity(a: FlatRow, b: FlatRow): number {
  return a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1
}

const SOURCE_IMPORT_LABEL = 'Source Import'

function formatDateLabel(iso: string): string {
  if (iso === '—') return iso
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// A reconciliation mismatch row always has these fields (see
// inventory_reconciliation_warnings) — used to pick DailyCheckDetails over the generic
// label/value grid, since only mismatch rows tell this particular story.
function isReconciliationMismatch(row: WarningRow): boolean {
  return row.fields.some((f) => f.label === 'Expected Qty')
}

// A plain-language, chronological walkthrough of the reconciliation math — "here's what
// you started with, here's what sold/came in, here's what we expected vs. what's
// actually there" — rather than the generic unordered label/value grid every other
// check uses. Staff need to follow the story to trust the number, not just see six
// unlabeled figures.
// One line of the two-column grid below — an optional date caption above a
// label/value pair, so a reader can tell at a glance which snapshot a figure is from.
// One tile in the stat strip below — a small caption (date or nothing), a label, and a
// prominent value. Deliberately roomier/bigger than the rest of the warnings table (this
// is the one place worth slowing down to actually read the numbers).
function DailyCheckStat({
  date,
  label,
  value,
  valueClass,
  sub
}: {
  date?: string
  label: React.ReactNode
  value: React.ReactNode
  valueClass?: string
  sub?: string
}): React.JSX.Element {
  return (
    <div className="px-4 py-3 min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-text-muted h-3.5">{date}</div>
      <div className="text-xs text-text-secondary mt-0.5 truncate">{label}</div>
      <div className={cn('text-base font-semibold tabular-nums mt-0.5', valueClass)}>{value}</div>
      {sub && <div className="text-[11px] text-text-muted tabular-nums mt-1">{sub}</div>}
    </div>
  )
}

function DailyCheckDetails({
  row,
  severity,
  onViewImportBatch
}: {
  row: WarningRow
  severity: 'warning' | 'critical'
  onViewImportBatch?: (batchId: string) => void
}): React.JSX.Element {
  const since = formatDateLabel(fieldValue(row.fields, 'Since'))
  const until = formatDateLabel(fieldValue(row.fields, 'Until'))
  const priorQty = fieldValue(row.fields, 'Prior Qty')
  const sold = fieldValue(row.fields, 'Sold')
  const purchased = fieldValue(row.fields, 'Purchased')
  const expected = fieldValue(row.fields, 'Expected Qty')
  const actual = fieldValue(row.fields, 'Actual Qty')
  const difference = fieldValue(row.fields, 'Difference')
  // Matches the backend's actual formula (prior + purchased − sold = expected), so the
  // number isn't just asserted — the reader can see exactly how it was derived.
  const calculation = `${priorQty} + ${purchased} − ${sold} = ${expected}`

  return (
    <div className="w-full text-xs">
      <div className="px-4 py-2.5 font-medium text-text-primary border-b border-border">Daily Check Details</div>
      <div className="grid grid-cols-3 divide-x divide-border border-b border-border">
        <DailyCheckStat date={since} label="On-Hand Qty" value={priorQty} />
        <DailyCheckStat date={until} label="Sale Qty" value={`−${sold}`} valueClass="text-error" />
        <DailyCheckStat date={until} label="Purchase Qty" value={`+${purchased}`} valueClass="text-success" />
      </div>
      <div className="grid grid-cols-3 divide-x divide-border bg-bg-raised">
        <DailyCheckStat label={`Expected Qty (${until})`} value={expected} sub={calculation} />
        <DailyCheckStat label={`Actual Qty (${until})`} value={actual} />
        <DailyCheckStat
          label="Difference"
          value={difference}
          valueClass={severity === 'critical' ? 'text-error' : 'text-warning'}
        />
      </div>
      {row.source_import && (
        <div className="border-t border-border px-4 py-2.5 flex items-center justify-between gap-3">
          <span className="text-text-secondary">Source Import</span>
          <button
            type="button"
            onClick={() => onViewImportBatch?.(row.source_import!.id)}
            className="text-brand hover:text-brand-hover underline underline-offset-2 whitespace-nowrap"
          >
            {row.source_import.filename ?? 'View import'} →
          </button>
        </div>
      )}
    </div>
  )
}

function WarningRowItem({
  item,
  showDateColumn,
  showSourceImportLink,
  onViewImportBatch
}: {
  item: FlatRow
  showDateColumn: boolean
  showSourceImportLink: boolean
  onViewImportBatch?: (batchId: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { row, severity } = item
  const isMismatch = isReconciliationMismatch(row)
  const dateLabel = showDateColumn ? dateFieldLabel(row.fields) : undefined
  const baseExtraFields = row.fields.filter((f) => !PRIMARY_LABELS.includes(f.label) && f.label !== dateLabel)
  // Not a real field from the backend — a synthetic entry so the source import slots
  // into the same details grid as everything else, rendered as a link instead of text.
  const extraFields =
    showSourceImportLink && row.source_import
      ? [...baseExtraFields, { label: SOURCE_IMPORT_LABEL, value: row.source_import.filename ?? 'View import' }]
      : baseExtraFields
  const columnCount = showDateColumn ? 7 : 6

  return (
    <>
      <Tr>
        <Td>
          <Badge variant={severity === 'critical' ? 'error' : 'warning'}>
            {severity === 'critical' ? 'Critical' : 'Warning'}
          </Badge>
        </Td>
        <Td className="whitespace-nowrap">{fieldValue(row.fields, 'Branch')}</Td>
        {showDateColumn && (
          <Td className="whitespace-nowrap">{dateLabel ? fieldValue(row.fields, dateLabel) : '—'}</Td>
        )}
        <Td className="font-mono text-xs whitespace-nowrap">{fieldValue(row.fields, 'Stock Code')}</Td>
        <Td>{fieldValue(row.fields, 'Description')}</Td>
        <Td className={cn('font-medium', severity === 'critical' ? 'text-error' : 'text-warning')}>
          {row.note}
        </Td>
        <Td>
          {extraFields.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover"
            >
              Details
              {expanded ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
            </button>
          )}
        </Td>
      </Tr>
      {expanded && (
        <Tr>
          <Td colSpan={columnCount} className="bg-bg-subtle p-0">
            {isMismatch ? (
              <DailyCheckDetails row={row} severity={severity} onViewImportBatch={onViewImportBatch} />
            ) : (
            <table className="w-full border-collapse text-xs">
              <tbody>
                {chunk(extraFields, 4).map((rowFields, rowIndex) => (
                  <tr key={rowIndex}>
                    {rowFields.map((field) => {
                      const isBad = row.highlight.includes(field.label)
                      const isSourceImport = field.label === SOURCE_IMPORT_LABEL && row.source_import
                      return (
                        <td
                          key={field.label}
                          className={cn(
                            'border border-border px-2 py-1 align-top',
                            isBad && (severity === 'critical' ? 'bg-error-subtle' : 'bg-warning-subtle')
                          )}
                        >
                          <div className="text-[10px] uppercase tracking-wide text-text-muted">
                            {field.label}
                          </div>
                          {isSourceImport ? (
                            <button
                              type="button"
                              onClick={() => onViewImportBatch?.(row.source_import!.id)}
                              className="text-brand hover:text-brand-hover underline underline-offset-2"
                            >
                              {field.value} →
                            </button>
                          ) : (
                            <div
                              className={cn(
                                'tabular-nums',
                                isBad
                                  ? cn('font-semibold', severity === 'critical' ? 'text-error' : 'text-warning')
                                  : 'text-text-secondary'
                              )}
                            >
                              {field.value}
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            )}
          </Td>
        </Tr>
      )}
    </>
  )
}

interface BatchGroup {
  key: string
  sourceImport: SourceImport | null
  items: FlatRow[]
}

// Buckets a category's rows by which import produced them, so reimporting one bad file
// clears a whole cluster of warnings in one action instead of hunting through a flat
// list. Rows with no source_import — missing-product checks always lack one (they can
// span several imports, so there's no single batch to point at), and it's theoretically
// possible but rare for a Sale/Purchase/Inventory row too, since import_batch_id is
// nullable — fall into a trailing "not linked to an import" bucket with no action.
function buildBatchGroups(items: FlatRow[]): BatchGroup[] {
  const groups = new Map<string, BatchGroup>()
  for (const item of items) {
    const key = item.row.source_import?.id ?? 'no-batch'
    const existing = groups.get(key)
    if (existing) {
      existing.items.push(item)
    } else {
      groups.set(key, { key, sourceImport: item.row.source_import, items: [item] })
    }
  }
  return Array.from(groups.values()).sort((a, b) => {
    if (a.key === 'no-batch') return 1
    if (b.key === 'no-batch') return -1
    return (b.sourceImport?.date ?? '').localeCompare(a.sourceImport?.date ?? '')
  })
}

// A full-width table row rather than a bordered card — group boundaries read as a
// divider within the same table (like a spreadsheet sub-total row) instead of nested
// boxes.
function BatchGroupHeaderRow({
  group,
  columnCount,
  profile,
  disabled,
  onImportToFix
}: {
  group: BatchGroup
  columnCount: number
  profile: Profile | null
  disabled?: boolean
  onImportToFix?: (batchId: string, filename: string | null) => void
}): React.JSX.Element {
  const meta = group.sourceImport
  const locked = meta ? isRemoveLocked(meta.date, profile) : false

  return (
    <tr>
      <td colSpan={columnCount} className="bg-brand-subtle px-4 py-2 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-text-primary">{meta?.filename ?? 'Missing stock code from Inventory'}</span>
            <Badge>{group.items.length}</Badge>
            {meta && <span className="text-xs font-normal text-text-muted">imported {formatDate(meta.date)}</span>}
          </div>
          {meta && (
            <Button
              variant="primary"
              size="sm"
              disabled={locked || disabled}
              title={locked ? 'Retail accounts can only remove an import within 1 day of importing it.' : undefined}
              onClick={() => onImportToFix?.(meta.id, meta.filename)}
            >
              Reimport to fix
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}

function WarningCategoryCard({
  category,
  sections,
  showTitle,
  profile,
  disabled,
  onViewImportBatch,
  onImportToFix
}: {
  category: Category
  sections: WarningSection[]
  showTitle: boolean
  profile: Profile | null
  disabled?: boolean
  onViewImportBatch?: (batchId: string) => void
  // Called from a batch group's "Reimport to fix" button, with that batch's id/filename.
  onImportToFix?: (importType: ImportType, batchId: string, filename: string | null) => void
}): React.JSX.Element {
  const importType = CATEGORY_IMPORT_TYPE[category]
  const items: FlatRow[] = sections.flatMap((section) =>
    section.rows.map((row, i) => ({ key: `${section.id}:${i}`, severity: section.severity, row }))
  )

  // Daily check rows compare two inventory snapshots rather than describing one
  // transaction, so a per-row Date column doesn't fit them the way it does Sale/
  // Inventory/Purchase — instead just show the most recent snapshot date next to the
  // card title.
  const showDateColumn = category !== 'Daily check'
  const asOfDate = showDateColumn
    ? null
    : items
        .map((item) => fieldValue(item.row.fields, 'Until'))
        .filter((v) => v !== '—')
        .sort()
        .at(-1)

  const columnCount = showDateColumn ? 7 : 6
  const titleBar = showTitle ? (
    <h3 className="flex items-center gap-2 text-base font-semibold text-text-primary tracking-tight">
      {category}
      <Badge>{items.length}</Badge>
      {asOfDate && <span className="text-xs font-normal text-text-muted">as of {asOfDate}</span>}
    </h3>
  ) : (
    asOfDate && <p className="text-xs text-text-muted">as of {asOfDate}</p>
  )

  return (
    <div className="flex flex-col gap-3">
      {titleBar}
      <TableContainer>
        <Thead>
          <Tr>
            <Th>Severity</Th>
            <Th>Branch</Th>
            {showDateColumn && <Th>Date</Th>}
            <Th>Stock Code</Th>
            <Th>Description</Th>
            <Th className="min-w-[18rem]">What to do</Th>
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {buildBatchGroups(items).flatMap((group) => [
            <BatchGroupHeaderRow
              key={`group:${group.key}`}
              group={group}
              columnCount={columnCount}
              profile={profile}
              disabled={disabled}
              onImportToFix={(batchId, filename) => onImportToFix?.(importType, batchId, filename)}
            />,
            ...[...group.items].sort(bySeverity).map((item) => (
              <WarningRowItem
                key={item.key}
                item={item}
                showDateColumn={showDateColumn}
                showSourceImportLink
                onViewImportBatch={onViewImportBatch}
              />
            ))
          ])}
        </Tbody>
      </TableContainer>
    </div>
  )
}

function WarningTabBar({
  activeTab,
  onSelect,
  counts
}: {
  activeTab: Tab
  onSelect: (tab: Tab) => void
  counts: Record<Tab, number>
}): React.JSX.Element {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 p-1 rounded-lg bg-bg-subtle w-fit">
      {TAB_ORDER.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={activeTab === tab}
          onClick={() => onSelect(tab)}
          className={cn(
            'flex items-center gap-1.5 h-8 px-3 rounded-md text-sm font-medium transition-all duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
            activeTab === tab
              ? 'bg-brand-subtle text-brand shadow-sm'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          {tab}
          <Badge variant={activeTab === tab ? 'brand' : 'default'}>{counts[tab]}</Badge>
        </button>
      ))}
    </div>
  )
}

function WarningsPage({
  session,
  profile,
  onCountChange,
  saleWindowDays,
  purchaseWindowDays,
  branchOptions,
  onViewImportBatch,
  onFileReady
}: Props): React.JSX.Element {
  // Cached like the dashboard tabs — coming back to the Warning page from somewhere
  // else shows the rows it showed last time rather than a skeleton, and refetches only
  // when the window settings change, an import is confirmed or reverted, or the entry
  // ages out. See lib/useCachedFetch.ts.
  const { data, isRefreshing, failed, reload } = useCachedFetch<{ sections: WarningSection[] }>(
    `${apiBaseUrl}/api/warnings?sale_days=${saleWindowDays}&purchase_days=${purchaseWindowDays}`,
    session,
    'Warning page'
  )
  const sections = data?.sections ?? null
  const [activeTab, setActiveTab] = useState<Tab>('All')
  const [branchFilter, setBranchFilter] = useState('')
  const { trigger: triggerFilePicker, input: filePickerInput, picking } = useImportFilePicker(session, onFileReady)

  // Rows are always fetched for every branch this account can see; the Branch filter
  // only narrows what's displayed/counted below — it never triggers a re-fetch, and it
  // never touches onCountChange's total (that badge stays a business-wide count
  // regardless of which branch is selected here).
  const displaySections = useMemo(
    () => filterSectionsByBranch(sections, branchFilter),
    [sections, branchFilter]
  )
  const branchFilterOptions = branchOptions.length > 0 ? branchOptions : distinctBranches(sections)

  // The nav badge's count follows whatever the fetch produced, cached or fresh — it is
  // a business-wide total, so it deliberately ignores the Branch filter below.
  useEffect(() => {
    if (sections) onCountChange?.(sections.reduce((sum, section) => sum + section.rows.length, 0))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections])

  // Opens the file picker right here on the Warning page — batchId/filename tag the
  // resulting PendingImport so confirming it also removes that batch first (see
  // ImportReviewPage.handleConfirm).
  function handleImportToFix(importType: ImportType, batchId: string, filename: string | null): void {
    triggerFilePicker({
      endpoint: IMPORT_TYPE_ENDPOINT[importType],
      importLabel: IMPORT_TYPE_LABEL[importType],
      revertBatchId: batchId,
      replacingFilename: filename
    })
  }

  const totalIssues = displaySections?.reduce((sum, section) => sum + section.rows.length, 0) ?? 0

  function categoryCount(category: Category): number {
    return (
      displaySections
        ?.filter((s) => SECTION_CATEGORY[s.id] === category)
        .reduce((sum, s) => sum + s.rows.length, 0) ?? 0
    )
  }

  const tabCounts: Record<Tab, number> = {
    All: totalIssues,
    Sale: categoryCount('Sale'),
    Inventory: categoryCount('Inventory'),
    Purchase: categoryCount('Purchase'),
    'Daily check': categoryCount('Daily check')
  }

  return (
    <div className="flex flex-col gap-4">
      {filePickerInput}
      <div className="bg-bg-subtle overflow-hidden">
        <CardHeader
          title="Warning"
          description={`Short, actionable data problems, grouped by area — open a row's Details for the full record. The Sale "fix these numbers" check (and the missing-inventory-record check's sale side) covers the last ${saleWindowDays === 1 ? 'day' : `${saleWindowDays} days`}; Purchase (and its purchase side) covers the last ${purchaseWindowDays === 1 ? 'day' : `${purchaseWindowDays} days`} (business-wide — an admin can change these in Settings).`}
          action={
            <Button variant="secondary" size="sm" onClick={reload} loading={isRefreshing}>
              Refresh
            </Button>
          }
        />
      </div>

      {sections === null && !failed && <TableSkeleton rows={4} cols={4} />}

      {sections === null && failed && (
        <EmptyState
          icon={<WarningIcon />}
          title="Couldn't load warnings"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      )}

      {sections !== null && branchFilterOptions.length > 1 && (
        <div className="w-48">
          <Select label="Branch" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
            <option value="">All retail branches</option>
            {branchFilterOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </Select>
        </div>
      )}

      {sections !== null && totalIssues === 0 && (
        <EmptyState
          icon={<WarningIcon />}
          title="All clear"
          description={
            branchFilter
              ? `No data-quality warnings for ${branchFilter} right now.`
              : 'No data-quality warnings right now.'
          }
        />
      )}

      {sections !== null && totalIssues > 0 && (
        <div className="flex flex-col gap-4">
          <WarningTabBar activeTab={activeTab} onSelect={setActiveTab} counts={tabCounts} />
          <div className="flex flex-col gap-6">
            {(activeTab === 'All' ? ALL_TAB_ORDER : [activeTab]).map((category) => {
              const categorySections = (displaySections ?? []).filter(
                (s) => SECTION_CATEGORY[s.id] === category && s.rows.length > 0
              )
              if (categorySections.length === 0) {
                if (activeTab === 'All') return null
                return (
                  <EmptyState
                    key={category}
                    icon={<WarningIcon />}
                    title="All clear"
                    description={`No ${category.toLowerCase()} warnings right now.`}
                  />
                )
              }
              return (
                <WarningCategoryCard
                  key={category}
                  category={category}
                  sections={categorySections}
                  showTitle={activeTab === 'All'}
                  profile={profile}
                  disabled={picking}
                  onViewImportBatch={onViewImportBatch}
                  onImportToFix={handleImportToFix}
                />
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default WarningsPage
