import { useState } from 'react'
import type { Session } from '@renderer/lib/auth'
import { cn } from '@renderer/lib/utils'
import { useCachedFetch } from '@renderer/lib/useCachedFetch'
import type { BranchOption } from '@renderer/lib/useBranches'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Card } from '@renderer/components/ui/Card'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Skeleton } from '@renderer/components/ui/Skeleton'
import { ChevronDownIcon, ChevronUpIcon, DashboardIcon, WarningIcon } from '@renderer/components/ui/icons'
import { AlertExplanation, MeasureValue, RefreshingHint } from './shared'
import {
  ACTIONABLE_SEVERITIES,
  EVIDENCE_LABEL,
  PERIOD_OPTIONS,
  SEVERITY_META,
  STATUS_META,
  dashboardUrl,
  dateRangeLabel,
  previousPeriodLabel,
  type AlertSeverity,
  type DimensionScore,
  type EvidenceTarget,
  type HealthAlert,
  type HealthStatus,
  type OverviewData,
  type PeriodKey,
  type SubMetric
} from './helpers'

// The Overview tab, in two pages:
//
//   1. every retail branch at once, one card each — admin only, and where admin lands
//   2. one branch in detail
//
// A branch-scoped account has only one branch, so it skips straight to page 2.
//
// Both pages read the same `GET /api/dashboard/overview?branch_id=…` payload, one
// request per branch. That is deliberate rather than a single all-branches endpoint:
// the cards fire their requests in parallel, so page 1 costs about what one branch
// costs, and opening a branch afterwards is instant because page 2 reads the very same
// cache entry the card already filled (see lib/useCachedFetch.ts).
//
// The guiding rule for the layout is that a screen showing every branch, or every
// dimension, or every alert, can only afford one line each. Anything more and it stops
// being scannable, which is the entire point of the page. Detail is one click away,
// never on by default.

// Which evidence tab each dimension's own numbers came from.
const DIMENSION_EVIDENCE: Record<string, EvidenceTarget> = {
  sales: 'revenue',
  profit: 'cost',
  inventory: 'inventory',
  customer: 'customer',
  data_quality: 'warnings'
}

// The same thresholds the backend uses for a dimension's status (see health_status),
// applied to any 0-100 score — so a measure's own bar is coloured by how that measure
// actually did. Colouring a measure by its dimension's status painted a 99 red just
// because the dimension around it was critical.
function statusForScore(score: number | null): HealthStatus | null {
  if (score === null) return null
  if (score >= 80) return 'healthy'
  if (score >= 60) return 'needs_attention'
  return 'critical'
}

/** The worst severity in a list, for a dot or a border that stands for all of them. */
function worstSeverity(alerts: HealthAlert[]): AlertSeverity {
  if (alerts.some((alert) => alert.severity === 'critical')) return 'critical'
  if (alerts.some((alert) => alert.severity === 'warning')) return 'warning'
  return 'normal'
}


function scoreTone(score: number | null): string {
  const status = statusForScore(score)
  return status === null ? 'text-text-muted' : STATUS_META[status].text
}

/** A thin bar, used at two sizes: beside a dimension score and inside a branch card. */
function ScoreBar({ score, status, className }: { score: number | null; status: HealthStatus | null; className?: string }): React.JSX.Element {
  return (
    <div className={cn('h-1.5 rounded-full bg-bg-raised overflow-hidden', className)} role="presentation">
      {score !== null && status && (
        <div
          className={cn('h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none', STATUS_META[status].bar)}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      )}
    </div>
  )
}

// --- page 1: every retail branch --------------------------------------------------------

function BranchSummaryCard({
  session,
  branch,
  period,
  dateFrom,
  dateTo,
  onOpen
}: {
  session: Session
  branch: BranchOption
  period: PeriodKey
  dateFrom: string
  dateTo: string
  onOpen: (branchId: string) => void
}): React.JSX.Element {
  // Each card owns its own request, so the branches load in parallel and page 2 later
  // reads the same cache entry instead of fetching again.
  const { data, isRefreshing, failed, reload } = useCachedFetch<OverviewData>(
    dashboardUrl('overview', branch.id, { period, dateFrom, dateTo }),
    session,
    `${branch.name} health`
  )

  if (data === null) {
    return failed ? (
      <Card className="flex flex-col gap-3">
        <h3 className="text-base font-semibold text-text-primary">{branch.name}</h3>
        <p className="text-sm text-text-muted">Couldn&apos;t load this branch.</p>
        <Button variant="secondary" size="sm" className="self-start" onClick={reload}>
          Try again
        </Button>
      </Card>
    ) : (
      <Skeleton className="h-64" />
    )
  }

  const meta = data.status ? STATUS_META[data.status] : null
  // Alerts arrive worst-first, so the first actionable one is the worst — and `normal`
  // alerts are left out of the count for the same reason they are left out of the nav
  // badge: a number a manager reacts to should only count what needs a decision.
  const actionable = data.alerts.filter((alert) => ACTIONABLE_SEVERITIES.includes(alert.severity))
  const worst = actionable[0] ?? null

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-text-primary tracking-tight">{data.branch_name}</h3>
        <div className="flex items-center gap-2">
          <RefreshingHint show={isRefreshing} />
          {meta ? <Badge variant={meta.badge}>{meta.label}</Badge> : <Badge>Not scored</Badge>}
        </div>
      </div>

      {/* Score on the left, the five dimensions on the right — so a wider card gets
          wider rather than taller, which is what keeps two per row readable. */}
      <div className="flex gap-6">
        <div className="w-24 shrink-0 flex flex-col items-center gap-1.5">
          <span className={cn('text-4xl font-semibold tracking-tight tabular-nums', meta?.text ?? 'text-text-muted')}>
            {data.overall_score === null ? '–' : Math.round(data.overall_score)}
          </span>
          <ScoreBar score={data.overall_score} status={data.status} className="w-full" />
          <span className="text-xs text-text-muted">out of 100</span>
        </div>

        {data.overall_score === null ? (
          <p className="text-sm text-text-secondary self-center">
            No data imported for this branch yet.
          </p>
        ) : (
          <dl className="flex-1 min-w-0 flex flex-col gap-1.5">
            {data.dimensions.map((dimension) => (
              <div key={dimension.key} className="flex items-center gap-3 text-sm">
                <dt className="w-20 shrink-0 text-text-secondary">{dimension.label}</dt>
                <dd className={cn('w-7 shrink-0 text-right tabular-nums', scoreTone(dimension.score))}>
                  {dimension.score === null ? '–' : Math.round(dimension.score)}
                </dd>
                <ScoreBar score={dimension.score} status={dimension.status} className="flex-1 min-w-0" />
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 pt-3 border-t border-border">
        {actionable.length === 0 ? (
          <span className="text-sm text-success">Nothing to act on</span>
        ) : (
          <span className="flex items-center gap-2 min-w-0 text-sm">
            <WarningIcon className={cn('w-4 h-4 shrink-0', SEVERITY_META[actionable[0].severity].text)} />
            <span className="text-text-secondary shrink-0">
              {actionable.length} {actionable.length === 1 ? 'alert' : 'alerts'}
            </span>
            {worst && <span className="text-text-muted truncate">· {worst.summary}</span>}
          </span>
        )}
        <button
          type="button"
          onClick={() => onOpen(branch.id)}
          className="shrink-0 text-sm text-brand hover:text-brand-hover font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
        >
          Open branch →
        </button>
      </div>
    </Card>
  )
}

// --- page 2: one branch -----------------------------------------------------------------

const MEASURE_COLUMN_COUNT = 5

/**
 * One measure, and — when opened — where its number came from.
 *
 * "View Revenue" was the old answer to "how is this measured", and it was the wrong one:
 * the Revenue tab shows related data, not the calculation, so the reader still had to
 * take the number on faith. Three questions get answered here instead, on the row itself:
 * what the measure means, which figures produced this value, and why that value scores
 * what it does.
 *
 * The last of those is rendered straight from `bands` — the very table the backend scored
 * against — so the explanation cannot drift away from the arithmetic.
 */
function MeasureRow({
  subMetric,
  alerts,
  onOpenEvidence
}: {
  subMetric: SubMetric
  // The business alerts about this measure — an alert explains the very number in this
  // row, so it belongs inside it rather than in a separate list further down the page.
  alerts: HealthAlert[]
  onOpenEvidence: (target: EvidenceTarget) => void
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  return (
    <>
      <Tr>
        <Td>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 text-left text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
          >
            {subMetric.label}
            {alerts.length > 0 && (
              <span
                // A quiet flag that there is an alert to read inside — without it the row
                // looks like every other one and nobody opens it.
                title={alerts.map((alert) => alert.title).join(' · ')}
                className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  SEVERITY_META[worstSeverity(alerts)].dot
                )}
              />
            )}
            {expanded ? (
              <ChevronUpIcon className="w-3 h-3 text-text-muted" />
            ) : (
              <ChevronDownIcon className="w-3 h-3 text-text-muted" />
            )}
          </button>
        </Td>
        <Td className="text-right tabular-nums text-text-primary whitespace-nowrap">
          {subMetric.value === null ? '—' : <MeasureValue value={subMetric.value} unit={subMetric.unit} />}
        </Td>
        <Td className={cn('text-right tabular-nums font-medium whitespace-nowrap', scoreTone(subMetric.score))}>
          {subMetric.score === null ? '—' : Math.round(subMetric.score)}
        </Td>
        <Td>
          <ScoreBar score={subMetric.score} status={statusForScore(subMetric.score)} className="w-24" />
        </Td>
        <Td className="text-right tabular-nums text-text-muted whitespace-nowrap">
          {Math.round(subMetric.weight * 100)}%
        </Td>
      </Tr>

      {expanded && (
        <Tr>
          <Td colSpan={MEASURE_COLUMN_COUNT} className="bg-bg-raised">
            <div className="flex flex-col gap-3 py-1 text-sm">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  What it measures
                </span>
                <p className="text-text-secondary">{subMetric.definition}</p>
              </div>

              {subMetric.calculation && (
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Where the number comes from
                  </span>
                  <p className="text-text-primary">{subMetric.calculation}</p>
                </div>
              )}

              <div>
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  How it scores
                </span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-0.5">
                  {subMetric.bands.map(([bandValue, bandScore]) => (
                    <span key={bandValue} className="text-text-secondary tabular-nums">
                      <MeasureValue value={bandValue} unit={subMetric.unit} />
                      <span className="text-text-muted"> → {Math.round(bandScore)}</span>
                    </span>
                  ))}
                </div>
                {subMetric.value !== null && subMetric.score !== null && (
                  <p className="text-text-primary mt-1">
                    This period: <MeasureValue value={subMetric.value} unit={subMetric.unit} /> →{' '}
                    <span className={cn('font-medium', scoreTone(subMetric.score))}>
                      {Math.round(subMetric.score)}
                    </span>
                  </p>
                )}
              </div>

              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    'border-l-4 pl-4 pt-3 border-t border-border',
                    SEVERITY_META[alert.severity].accent
                  )}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Badge variant={SEVERITY_META[alert.severity].badge}>
                      {SEVERITY_META[alert.severity].label}
                    </Badge>
                    <span className="text-sm font-medium text-text-primary">{alert.title}</span>
                  </div>
                  <AlertExplanation alert={alert} onOpenEvidence={onOpenEvidence} />
                </div>
              ))}
            </div>
          </Td>
        </Tr>
      )}
    </>
  )
}

/**
 * A dimension as a full-width band, with its own measures as the rows beneath it — the
 * same grouped-table shape the Business Alerts page uses for branches.
 *
 * This page answers one question: *why is this score what it is.* So every measure that
 * feeds a dimension is here with the value it actually had, the 0-100 that value earned,
 * and how much of the dimension it counts for. Nothing is hidden and nothing is
 * summarised — a reader can add the rows up.
 *
 * It deliberately does **not** list the branch's alerts. Those have their own page now,
 * and repeating them here would make two pages that answer the same question badly
 * instead of two that answer different questions well.
 */
function DimensionRows({
  dimension,
  alerts,
  onOpenEvidence
}: {
  dimension: DimensionScore
  alerts: HealthAlert[]
  onOpenEvidence: (target: EvidenceTarget) => void
}): React.JSX.Element {
  const evidence = DIMENSION_EVIDENCE[dimension.key]
  const meta = dimension.status ? STATUS_META[dimension.status] : null
  // The weight actually used: a dimension nobody could measure is dropped and the rest
  // re-normalised, so the figure on screen has to be the one that produced the score.
  const weight = dimension.effective_weight ?? dimension.weight

  return (
    <>
      <tr>
        <td colSpan={MEASURE_COLUMN_COUNT} className="bg-brand-subtle px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-semibold text-text-primary">{dimension.label}</span>
            <span className={cn('text-sm font-semibold tabular-nums', scoreTone(dimension.score))}>
              {dimension.score === null ? '–' : Math.round(dimension.score)} / 100
            </span>
            {meta ? <Badge variant={meta.badge}>{meta.label}</Badge> : <Badge>Not scored</Badge>}
            <span className="text-xs text-text-muted">
              {Math.round(weight * 100)}% of the score
            </span>
            <button
              type="button"
              onClick={() => onOpenEvidence(evidence)}
              className="ml-auto text-sm text-brand hover:text-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
            >
              {EVIDENCE_LABEL[evidence]} →
            </button>
          </div>
        </td>
      </tr>

      {dimension.score === null ? (
        <Tr>
          <Td colSpan={MEASURE_COLUMN_COUNT} className="text-text-secondary">
            {dimension.insufficient_data_reason}
          </Td>
        </Tr>
      ) : (
        dimension.sub_metrics.map((subMetric) => (
          <MeasureRow
            key={subMetric.key}
            subMetric={subMetric}
            alerts={alerts.filter((alert) => alert.measure === subMetric.key)}
            onOpenEvidence={onOpenEvidence}
          />
        ))
      )}
    </>
  )
}

function BranchDetail({
  session,
  branchId,
  period,
  dateFrom,
  dateTo,
  onBack,
  onOpenEvidence,
  onViewBusinessAlerts
}: {
  session: Session
  branchId: string
  period: PeriodKey
  dateFrom: string
  dateTo: string
  // null for a branch-scoped account: it has one branch, so there is no list to go back to.
  onBack: (() => void) | null
  onOpenEvidence: (target: EvidenceTarget) => void
  onViewBusinessAlerts: () => void
}): React.JSX.Element {
  const { data, isRefreshing, failed, reload } = useCachedFetch<OverviewData>(
    dashboardUrl('overview', branchId, { period, dateFrom, dateTo }),
    session,
    'Overview dashboard'
  )

  if (data === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load the Overview dashboard"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      )
    }
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const meta = data.status ? STATUS_META[data.status] : null
  const weakest =
    data.dimensions
      .filter((dimension) => dimension.score !== null && dimension.status !== 'healthy')
      .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))[0] ?? null
  // Data-quality alerts are counted by the Warning page, not this pointer — same split
  // the Business Alerts page itself makes.
  const businessAlertCount = data.alerts.filter(
    (alert) => alert.dimension !== 'data_quality' && ACTIONABLE_SEVERITIES.includes(alert.severity)
  ).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-brand hover:text-brand-hover font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
          >
            ← All branches
          </button>
        ) : (
          <span />
        )}
        <RefreshingHint show={isRefreshing} />
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight">{data.branch_name}</h2>
          <span className={cn('text-lg font-semibold tabular-nums', meta?.text ?? 'text-text-muted')}>
            {data.overall_score === null ? '–' : Math.round(data.overall_score)} / 100
          </span>
          {meta ? <Badge variant={meta.badge}>{meta.label}</Badge> : <Badge>Not scored</Badge>}
        </div>
        <p className="text-sm text-text-muted">
          {dateRangeLabel(data.date_from, data.date_to)} · {previousPeriodLabel(period, dateFrom, dateTo)}
          {weakest && ` · ${weakest.label} is the weakest area`}
        </p>
      </div>

      <TableContainer>
        <Thead>
          <Tr>
            <Th>Measure</Th>
            <Th className="text-right">Value</Th>
            <Th className="text-right">Score</Th>
            <Th />
            <Th className="text-right">Weight</Th>
          </Tr>
        </Thead>
        <Tbody>
          {data.dimensions.map((dimension) => (
            <DimensionRows
              key={dimension.key}
              dimension={dimension}
              alerts={data.alerts}
              onOpenEvidence={onOpenEvidence}
            />
          ))}
        </Tbody>
      </TableContainer>

      {businessAlertCount > 0 && (
        <p className="text-sm text-text-muted">
          {data.branch_name} has {businessAlertCount} business{' '}
          {businessAlertCount === 1 ? 'alert' : 'alerts'}.{' '}
          <button
            type="button"
            onClick={onViewBusinessAlerts}
            className="text-brand hover:text-brand-hover underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
          >
            View in Business Alerts →
          </button>
        </p>
      )}
    </div>
  )
}

// --- the tab ----------------------------------------------------------------------------

interface Props {
  session: Session
  isAdmin: boolean
  // Every retail branch — admin only. A branch account gets an empty list and never
  // sees page 1.
  branchOptions: BranchOption[]
  branchId: string
  period: PeriodKey
  dateFrom: string
  dateTo: string
  canLoad: boolean
  // Sets the branch the other four tabs show, so drilling into evidence from a branch
  // card lands on that branch rather than whatever was selected before.
  onOpenEvidence: (target: EvidenceTarget, branchId: string) => void
  onViewBusinessAlerts: () => void
  // null = the all-branches page. Owned by App, because this component is unmounted on
  // every Dashboard tab switch and coming back should return to the branch being read.
  openBranchId: string | null
  onOpenBranchChange: (branchId: string | null) => void
}

export type { EvidenceTarget }

export function OverviewTab({
  session,
  isAdmin,
  branchOptions,
  branchId,
  period,
  dateFrom,
  dateTo,
  canLoad,
  onOpenEvidence,
  onViewBusinessAlerts,
  openBranchId,
  onOpenBranchChange
}: Props): React.JSX.Element {

  if (!canLoad && isAdmin && branchOptions.length === 0) return <></>

  if (isAdmin && openBranchId === null) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text-muted">
          All retail branches ·{' '}
          {dateFrom && dateTo
            ? dateRangeLabel(dateFrom, dateTo)
            : PERIOD_OPTIONS.find((option) => option.value === period)?.label}
        </p>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {branchOptions.map((branch) => (
            <BranchSummaryCard
              key={branch.id}
              session={session}
              branch={branch}
              period={period}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onOpen={onOpenBranchChange}
            />
          ))}
        </div>
      </div>
    )
  }

  const shownBranchId = isAdmin ? (openBranchId as string) : branchId
  return (
    <BranchDetail
      session={session}
      branchId={shownBranchId}
      period={period}
      dateFrom={dateFrom}
      dateTo={dateTo}
      onBack={isAdmin ? () => onOpenBranchChange(null) : null}
      onOpenEvidence={(target) => onOpenEvidence(target, shownBranchId)}
      onViewBusinessAlerts={onViewBusinessAlerts}
    />
  )
}

export default OverviewTab
