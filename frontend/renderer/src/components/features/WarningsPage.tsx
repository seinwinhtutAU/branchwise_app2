import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { cn } from '@renderer/lib/utils'
import { Button } from '@renderer/components/ui/Button'
import { Badge } from '@renderer/components/ui/Badge'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { WarningIcon, ChevronDownIcon, ChevronUpIcon } from '@renderer/components/ui/icons'

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
  // Which confirmed import this bad value came from, if any — lets the row link
  // straight to Import History instead of the user hunting for the right batch to
  // revert. Null for checks that can span several imports (nothing single to point at).
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
  onCountChange?: (count: number) => void
  warningWindowDays: number
  onViewImportBatch?: (batchId: string) => void
}

const CATEGORY_ORDER = ['Sale', 'Inventory', 'Purchase', 'Daily check'] as const
type Category = (typeof CATEGORY_ORDER)[number]

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
  sale_missing_product: 'Inventory',
  inventory_numeric: 'Inventory',
  purchase_numeric: 'Purchase',
  purchase_missing_product: 'Inventory',
  reconciliation_uom: 'Daily check',
  reconciliation_mismatch: 'Daily check'
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

interface FlatRow {
  key: string
  severity: 'warning' | 'critical'
  row: WarningRow
}

const SOURCE_IMPORT_LABEL = 'Source Import'

function WarningRowItem({
  item,
  showDateColumn,
  onViewImportBatch
}: {
  item: FlatRow
  showDateColumn: boolean
  onViewImportBatch?: (batchId: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { row, severity } = item
  const dateLabel = showDateColumn ? dateFieldLabel(row.fields) : undefined
  const baseExtraFields = row.fields.filter((f) => !PRIMARY_LABELS.includes(f.label) && f.label !== dateLabel)
  // Not a real field from the backend — a synthetic entry so the source import slots
  // into the same bordered grid as everything else, rendered as a link instead of text.
  const extraFields = row.source_import
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
          </Td>
        </Tr>
      )}
    </>
  )
}

function WarningCategoryCard({
  category,
  sections,
  showTitle,
  onViewImportBatch
}: {
  category: Category
  sections: WarningSection[]
  showTitle: boolean
  onViewImportBatch?: (batchId: string) => void
}): React.JSX.Element {
  const items: FlatRow[] = sections.flatMap((section) =>
    section.rows.map((row, i) => ({ key: `${section.id}:${i}`, severity: section.severity, row }))
  )
  // Critical first, so the thing most worth acting on is always at the top of the card.
  const sorted = [...items].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))

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

  return (
    <div className="flex flex-col gap-3">
      {showTitle ? (
        <h3 className="flex items-center gap-2 text-base font-semibold text-text-primary tracking-tight">
          {category}
          <Badge>{items.length}</Badge>
          {asOfDate && <span className="text-xs font-normal text-text-muted">as of {asOfDate}</span>}
        </h3>
      ) : (
        asOfDate && <p className="text-xs text-text-muted">as of {asOfDate}</p>
      )}
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
          {sorted.map((item) => (
            <WarningRowItem
              key={item.key}
              item={item}
              showDateColumn={showDateColumn}
              onViewImportBatch={onViewImportBatch}
            />
          ))}
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
              ? 'bg-bg-base text-text-primary shadow-sm'
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
  onCountChange,
  warningWindowDays,
  onViewImportBatch
}: Props): React.JSX.Element {
  const showToast = useToast()
  const [sections, setSections] = useState<WarningSection[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('All')

  async function load(): Promise<void> {
    setLoading(true)
    setLoadFailed(false)
    try {
      const response = await fetch(`${apiBaseUrl}/api/warnings?days=${warningWindowDays}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load warnings: ${response.status}`)
        return
      }
      const body = await response.json()
      setSections(body.sections)
      onCountChange?.(
        (body.sections as WarningSection[]).reduce((sum, s) => sum + s.rows.length, 0)
      )
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load warnings — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token, warningWindowDays])

  const totalIssues = sections?.reduce((sum, section) => sum + section.rows.length, 0) ?? 0

  function categoryCount(category: Category): number {
    return (
      sections
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
      <CardHeader
        title="Warning"
        description={`Short, actionable data problems, grouped by area — open a row's Details for the full record. The Sale/Purchase "fix these numbers" checks cover the last ${warningWindowDays === 1 ? 'day' : `${warningWindowDays} days`} (change this in Settings); missing-inventory-record checks always show, regardless of date.`}
        action={
          <Button variant="secondary" size="sm" onClick={load} loading={loading}>
            Refresh
          </Button>
        }
      />

      {sections === null && loading && <TableSkeleton rows={4} cols={4} />}

      {sections === null && !loading && loadFailed && (
        <EmptyState
          icon={<WarningIcon />}
          title="Couldn't load warnings"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      )}

      {sections !== null && totalIssues === 0 && (
        <EmptyState
          icon={<WarningIcon />}
          title="All clear"
          description="No data-quality warnings right now."
        />
      )}

      {sections !== null && totalIssues > 0 && (
        <div className="flex flex-col gap-4">
          <WarningTabBar activeTab={activeTab} onSelect={setActiveTab} counts={tabCounts} />
          <div className="flex flex-col gap-6">
            {(activeTab === 'All' ? ALL_TAB_ORDER : [activeTab]).map((category) => {
              const categorySections = sections.filter(
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
                  onViewImportBatch={onViewImportBatch}
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
