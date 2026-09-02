import { Fragment, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { cn } from '@renderer/lib/utils'
import { useCachedFetchMany } from '@renderer/lib/useCachedFetch'
import type { BranchOption } from '@renderer/lib/useBranches'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Select } from '@renderer/components/ui/Select'
import { Skeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { ChevronDownIcon, ChevronUpIcon, WarningIcon } from '@renderer/components/ui/icons'
import { AlertExplanation, PeriodControls } from '@renderer/components/features/dashboard/shared'
import { usePeriodRange } from '@renderer/components/features/dashboard/usePeriodRange'
import {
  dashboardUrl,
  type AlertSeverity,
  type EvidenceTarget,
  type HealthAlert,
  type OverviewData
} from '@renderer/components/features/dashboard/helpers'
import type { Profile } from '@renderer/components/features/types'

// Every business warning the Early Warning engine raised, for every retail branch, in one
// table — the "what needs my attention today" page, as opposed to the Dashboard's
// Overview, which answers "how is this branch doing".
//
// Its own nav section rather than a Dashboard tab: a manager should be able to open it
// directly. It sits beside Dashboard rather than beside Warning even though both list
// things that are wrong — this one is the business going wrong, Warning is the imported
// data being wrong.
//
// Data-quality alerts are deliberately excluded. The Warning page already lists those row
// by row with the tools to fix them, so a summary of them here would split one job across
// two screens.
//
// It issues no requests of its own: it reads the same per-branch overview payloads the
// Dashboard's branch cards fetch, through the shared cache (see lib/useCachedFetch.ts).

const EXCLUDED_DIMENSION = 'data_quality'
const COLUMN_COUNT = 5

const CATEGORY_LABEL: Record<string, string> = {
  sales: 'Sales',
  profit: 'Profit',
  inventory: 'Inventory',
  customer: 'Customer'
}

const CATEGORY_ORDER = ['sales', 'profit', 'inventory', 'customer']

const SEVERITY_META: Record<AlertSeverity, { label: string; badge: 'error' | 'warning'; text: string }> = {
  critical: { label: 'Critical', badge: 'error', text: 'text-error' },
  warning: { label: 'Warning', badge: 'warning', text: 'text-warning' }
}

interface BranchAlert extends HealthAlert {
  branchId: string
  branchName: string
}

function FilterChip({
  label,
  count,
  active,
  onClick
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-8 px-3 rounded-full text-sm font-medium border transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
        active
          ? 'bg-brand-subtle text-brand border-border-brand'
          : 'bg-bg-base text-text-secondary border-border hover:border-border-strong'
      )}
    >
      {label} <span className="tabular-nums text-text-muted">{count}</span>
    </button>
  )
}

/**
 * One alert as a table row, plus its expanded detail row — the same shape the Warning
 * page uses (severity badge, a Details toggle in the last column, an expanded row
 * spanning every column), so the app's two lists of "things that are wrong" read the same
 * way even though one is about the business and the other about the data.
 */
function AlertRow({
  alert,
  onOpenEvidence
}: {
  alert: BranchAlert
  onOpenEvidence: (target: EvidenceTarget, branchId: string) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const meta = SEVERITY_META[alert.severity]

  return (
    <>
      <Tr>
        <Td>
          <Badge variant={meta.badge}>{meta.label}</Badge>
        </Td>
        <Td className="whitespace-nowrap text-text-muted">{CATEGORY_LABEL[alert.dimension]}</Td>
        <Td className="font-medium text-text-primary">{alert.title}</Td>
        <Td className={cn('font-medium', meta.text)}>{alert.summary}</Td>
        <Td>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover"
          >
            Details
            {expanded ? <ChevronUpIcon className="w-3 h-3" /> : <ChevronDownIcon className="w-3 h-3" />}
          </button>
        </Td>
      </Tr>
      {expanded && (
        <Tr>
          <Td colSpan={COLUMN_COUNT} className="bg-bg-raised">
            <div className="py-1">
              <AlertExplanation
                alert={alert}
                onOpenEvidence={(target) => onOpenEvidence(target, alert.branchId)}
              />
            </div>
          </Td>
        </Tr>
      )}
    </>
  )
}

/** A full-width band naming the branch the rows beneath it belong to. */
function BranchHeaderRow({ name, count }: { name: string; count: number }): React.JSX.Element {
  return (
    <tr>
      <td colSpan={COLUMN_COUNT} className="bg-brand-subtle px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-text-primary">{name}</span>
          <Badge>{count}</Badge>
        </div>
      </td>
    </tr>
  )
}

interface Props {
  session: Session
  profile: Profile | null
  branchOptions: BranchOption[]
  onOpenEvidence: (target: EvidenceTarget, branchId: string) => void
}

export function BusinessAlertsPage({
  session,
  profile,
  branchOptions,
  onOpenEvidence
}: Props): React.JSX.Element {
  // Admin has no fixed branch — same convention as everywhere else in the app.
  const isAdmin = profile !== null && profile.branch_id === null
  const range = usePeriodRange('30d')
  const [branchFilter, setBranchFilter] = useState('')
  const [category, setCategory] = useState('')

  // Admin reads every retail branch; a branch account reads only its own.
  const branchIds = isAdmin
    ? branchOptions.map((branch) => branch.id)
    : profile?.branch_id
      ? [profile.branch_id]
      : []
  const urls = branchIds.map((id) =>
    dashboardUrl('overview', id, { period: range.period, dateFrom: range.applied.from, dateTo: range.applied.to })
  )
  const { data, isLoading, isRefreshing, failedCount, reload } = useCachedFetchMany<OverviewData>(
    urls,
    session,
    'alerts'
  )

  const branches = Object.values(data)
  const allAlerts: BranchAlert[] = branches
    .flatMap((branch) =>
      branch.alerts
        .filter((alert) => alert.dimension !== EXCLUDED_DIMENSION)
        .map((alert) => ({ ...alert, branchId: branch.branch_id, branchName: branch.branch_name }))
    )
    // Critical first, then by category so the same kind of problem reads together, then by
    // branch — a stable order, so nothing jumps around between refreshes.
    .sort(
      (a, b) =>
        (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1) ||
        CATEGORY_ORDER.indexOf(a.dimension) - CATEGORY_ORDER.indexOf(b.dimension) ||
        a.branchName.localeCompare(b.branchName)
    )

  // Each chip counts what it would show given the branch filter, so a chip's number always
  // matches what clicking it produces.
  const inBranch = allAlerts.filter((alert) => !branchFilter || alert.branchId === branchFilter)
  const shown = inBranch.filter((alert) => !category || alert.dimension === category)

  // Branch order follows the worst alert each one has, so the branch needing attention
  // first is at the top — same principle as the row order inside a group.
  const groups = branches
    .map((branch) => ({
      branchId: branch.branch_id,
      branchName: branch.branch_name,
      alerts: shown.filter((alert) => alert.branchId === branch.branch_id)
    }))
    .filter((group) => group.alerts.length > 0)
    .sort(
      (a, b) =>
        (a.alerts[0].severity === 'critical' ? 0 : 1) - (b.alerts[0].severity === 'critical' ? 0 : 1) ||
        a.branchName.localeCompare(b.branchName)
    )

  return (
    <div className="flex flex-col">
      <CardHeader
        title="Business Alerts"
        description="Sales, profit, inventory and customer problems detected across every retail branch."
        action={
          <Button variant="secondary" size="sm" onClick={reload} loading={isRefreshing}>
            Refresh
          </Button>
        }
      />

      {/* Every control in one row under the header, same as the Sale/Inventory/Data
          Overview pages, so the page furniture is where a reader already expects it. */}
      <div className="flex flex-wrap items-end gap-3 pb-4 -mt-1">
        <PeriodControls range={range} />
        {branches.length > 1 && (
          <div className="w-48">
            <Select label="Branch" value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">All branches</option>
              {branches.map((branch) => (
                <option key={branch.branch_id} value={branch.branch_id}>
                  {branch.branch_name}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {isAdmin && branchOptions.length === 0 ? (
        <p className="text-sm text-text-muted">Add a retail branch before there is anything to check.</p>
      ) : isLoading ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-96" />
          <Skeleton className="h-64" />
        </div>
      ) : branches.length === 0 ? (
        <EmptyState
          icon={<WarningIcon />}
          title="Couldn't load alerts"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <FilterChip label="All" count={inBranch.length} active={!category} onClick={() => setCategory('')} />
            {CATEGORY_ORDER.map((key) => (
              <FilterChip
                key={key}
                label={CATEGORY_LABEL[key]}
                count={inBranch.filter((alert) => alert.dimension === key).length}
                active={category === key}
                onClick={() => setCategory(category === key ? '' : key)}
              />
            ))}
          </div>

          {failedCount > 0 && (
            <p className="text-sm text-warning">
              {failedCount} branch{failedCount === 1 ? '' : 'es'} couldn&apos;t be loaded, so this list may be
              incomplete.
            </p>
          )}

          {shown.length === 0 ? (
            <Card>
              <p className="text-sm text-success">
                {allAlerts.length === 0
                  ? 'No business warnings for any branch in this period.'
                  : 'No warnings match these filters.'}
              </p>
            </Card>
          ) : (
            <TableContainer>
              <Thead>
                <Tr>
                  <Th>Severity</Th>
                  <Th>Category</Th>
                  <Th>Alert</Th>
                  <Th>Detail</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {/* Grouped by branch rather than carrying a Branch column: with several
                    branches on screen the column repeats the same name down every row, and
                    a band that says it once is easier to read against. */}
                {groups.map((group) => (
                  <Fragment key={group.branchId}>
                    <BranchHeaderRow name={group.branchName} count={group.alerts.length} />
                    {group.alerts.map((alert) => (
                      <AlertRow
                        key={`${alert.branchId}:${alert.id}`}
                        alert={alert}
                        onOpenEvidence={onOpenEvidence}
                      />
                    ))}
                  </Fragment>
                ))}
              </Tbody>
            </TableContainer>
          )}
        </div>
      )}
    </div>
  )
}

export default BusinessAlertsPage
