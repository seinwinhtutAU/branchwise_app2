import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { cn } from '@renderer/lib/utils'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Select } from '@renderer/components/ui/Select'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { HeartPulseIcon } from '@renderer/components/ui/icons'
import { StatTile } from '@renderer/components/features/dashboard/shared'

interface FreshnessRow {
  branch_id: string
  branch_name: string
  sales_last_imported_at: string | null
  inventory_last_imported_at: string | null
  purchase_last_imported_at: string | null
}

type BatchImportType = 'sales' | 'purchase' | 'inventory'
type ReviewStatus = 'review' | 'possible_duplicate'

interface BatchReviewRow {
  batch_id: string
  import_type: BatchImportType
  branch_name: string
  filename: string | null
  confirmed_at: string
  note: string
  status: ReviewStatus
}

interface SlipMismatchRow {
  batch_id: string
  branch_name: string
  slip_id: string
  date: string
  line_total: number
  subtotal_on_slip: number
  difference: number
}

interface ImportHealthResponse {
  batches_checked: number
  batches_to_review: BatchReviewRow[]
  slip_total_mismatches: SlipMismatchRow[]
}

interface Props {
  session: Session
  onViewImportBatch?: (batchId: string) => void
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Files are expected daily, so "fresh" has a narrow window: today is fine, yesterday
// is a soft warning (maybe just not uploaded yet today), anything older — or never
// imported — is a real gap worth someone's attention.
function freshnessBadge(iso: string | null): { variant: 'success' | 'warning' | 'error'; label: string } {
  if (!iso) return { variant: 'error', label: 'Never imported' }
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
  if (days <= 0) return { variant: 'success', label: 'Today' }
  if (days === 1) return { variant: 'warning', label: 'Yesterday' }
  return { variant: 'error', label: `${days} days ago` }
}

function FreshnessCell({ iso }: { iso: string | null }): React.JSX.Element {
  const { variant, label } = freshnessBadge(iso)
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={variant}>{label}</Badge>
      {iso && <span className="text-xs text-text-muted whitespace-nowrap">{formatDateTime(iso)}</span>}
    </div>
  )
}

const TYPE_BADGE: Record<BatchImportType, { variant: 'info' | 'brand' | 'default'; label: string }> = {
  sales: { variant: 'info', label: 'Sales' },
  purchase: { variant: 'brand', label: 'Purchase' },
  inventory: { variant: 'default', label: 'Inventory' }
}

const STATUS_BADGE: Record<ReviewStatus, { variant: 'error' | 'warning'; label: string }> = {
  review: { variant: 'error', label: 'Review' },
  possible_duplicate: { variant: 'warning', label: 'Possible duplicate' }
}

const DAYS_OPTIONS = [7, 30, 90] as const

type Tab = 'freshness' | 'health'

const TABS: { id: Tab; label: string }[] = [
  { id: 'freshness', label: 'Import freshness' },
  { id: 'health', label: 'Import Health' }
]

function OverviewTabBar({ activeTab, onSelect }: { activeTab: Tab; onSelect: (tab: Tab) => void }): React.JSX.Element {
  return (
    <div role="tablist" className="flex flex-wrap gap-1 p-1 rounded-lg bg-bg-subtle w-fit">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            'flex items-center gap-1.5 h-8 px-4 rounded-md text-sm font-medium transition-all duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
            activeTab === tab.id
              ? 'bg-brand-subtle text-brand shadow-sm'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}

function ImportOverviewPage({ session, onViewImportBatch }: Props): React.JSX.Element {
  const showToast = useToast()
  const [activeTab, setActiveTab] = useState<Tab>('freshness')

  const [freshness, setFreshness] = useState<FreshnessRow[] | null>(null)
  const [freshnessLoading, setFreshnessLoading] = useState(false)
  const [freshnessFailed, setFreshnessFailed] = useState(false)

  const [days, setDays] = useState<number>(30)
  const [health, setHealth] = useState<ImportHealthResponse | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [healthFailed, setHealthFailed] = useState(false)

  async function loadFreshness(): Promise<void> {
    setFreshnessLoading(true)
    setFreshnessFailed(false)
    try {
      const response = await fetch(`${apiBaseUrl}/api/imports/freshness`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setFreshnessFailed(true)
        showToast('error', `Failed to load upload freshness: ${response.status}`)
        return
      }
      setFreshness(await response.json())
    } catch {
      setFreshnessFailed(true)
      showToast('error', 'Failed to load upload freshness — is the backend running?')
    } finally {
      setFreshnessLoading(false)
    }
  }

  async function loadHealth(): Promise<void> {
    setHealthLoading(true)
    setHealthFailed(false)
    try {
      const response = await fetch(`${apiBaseUrl}/api/imports/health?days=${days}`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setHealthFailed(true)
        showToast('error', `Failed to load import health: ${response.status}`)
        return
      }
      setHealth(await response.json())
    } catch {
      setHealthFailed(true)
      showToast('error', 'Failed to load import health — is the backend running?')
    } finally {
      setHealthLoading(false)
    }
  }

  async function dismissBatch(batchId: string): Promise<void> {
    try {
      const response = await fetch(`${apiBaseUrl}/api/imports/health/${batchId}/dismiss`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        showToast('error', `Failed to dismiss: ${response.status}`)
        return
      }
      setHealth((prev) =>
        prev ? { ...prev, batches_to_review: prev.batches_to_review.filter((row) => row.batch_id !== batchId) } : prev
      )
      showToast('success', 'Dismissed — already handled batches won\'t clutter this list')
    } catch {
      showToast('error', 'Failed to dismiss — is the backend running?')
    }
  }

  useEffect(() => {
    loadFreshness()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token])

  useEffect(() => {
    loadHealth()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token, days])

  return (
    <div className="flex flex-col gap-6">
      <CardHeader
        title="Import Overview"
        description="Is this import pipeline actually working: are branches uploading on schedule, and when they do, did cleaning and confirm handle the file correctly — separate from Warning, which checks data already saved."
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              loadFreshness()
              loadHealth()
            }}
            loading={freshnessLoading || healthLoading}
          >
            Refresh
          </Button>
        }
      />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <OverviewTabBar activeTab={activeTab} onSelect={setActiveTab} />
        {activeTab === 'health' && (
          <div className="w-40">
            <Select label="Period" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAYS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Last {option} days
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {activeTab === 'freshness' && (
        <>
          {freshness === null && freshnessLoading && <TableSkeleton rows={3} cols={4} />}
          {freshness === null && !freshnessLoading && freshnessFailed && (
            <EmptyState
              icon={<HeartPulseIcon />}
              title="Couldn't load upload freshness"
              description="Something went wrong reaching the backend."
              action={
                <Button variant="secondary" size="sm" onClick={loadFreshness}>
                  Try again
                </Button>
              }
            />
          )}
          {freshness !== null && freshness.length === 0 && (
            <EmptyState icon={<HeartPulseIcon />} title="No branches yet" description="Once a branch has an account and imports data, it'll show up here." />
          )}
          {freshness !== null && freshness.length > 0 && (
            <TableContainer>
              <Thead>
                <Tr>
                  <Th>Branch</Th>
                  <Th>Sales</Th>
                  <Th>Inventory</Th>
                  <Th>Purchase</Th>
                </Tr>
              </Thead>
              <Tbody>
                {freshness.map((row) => (
                  <Tr key={row.branch_id}>
                    <Td>{row.branch_name}</Td>
                    <Td>
                      <FreshnessCell iso={row.sales_last_imported_at} />
                    </Td>
                    <Td>
                      <FreshnessCell iso={row.inventory_last_imported_at} />
                    </Td>
                    <Td>
                      <FreshnessCell iso={row.purchase_last_imported_at} />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </TableContainer>
          )}
        </>
      )}

      {activeTab === 'health' && (
        <>
          {health === null && healthLoading && <TableSkeleton rows={4} cols={4} />}

          {health === null && !healthLoading && healthFailed && (
            <EmptyState
              icon={<HeartPulseIcon />}
              title="Couldn't load import health"
              description="Something went wrong reaching the backend."
              action={
                <Button variant="secondary" size="sm" onClick={loadHealth}>
                  Try again
                </Button>
              }
            />
          )}

          {health !== null && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatTile
                  label="Batches checked"
                  value={String(health.batches_checked)}
                  sub={`last ${days} days · Sales, Purchase, Inventory`}
                />
                <StatTile
                  label="Batches flagged"
                  value={String(health.batches_to_review.length)}
                  sub={health.batches_to_review.length > 0 ? 'worth a second look' : 'nothing flagged'}
                />
                <StatTile
                  label="Slip-total mismatches"
                  value={String(health.slip_total_mismatches.length)}
                  sub="Sales only"
                />
              </div>

              <Card>
                <CardHeader
                  title="Batches to review"
                  description="Covers all three import types — each fails differently at confirm time, so each gets its own kind of check."
                />
                {health.batches_to_review.length === 0 ? (
                  <EmptyState
                    icon={<HeartPulseIcon />}
                    title="Nothing flagged"
                    description={`No Sales, Purchase, or Inventory batch in the last ${days} days looked anomalous.`}
                  />
                ) : (
                  <TableContainer>
                    <Thead>
                      <Tr>
                        <Th>Confirmed</Th>
                        <Th>Type</Th>
                        <Th>Branch</Th>
                        <Th>File</Th>
                        <Th>What we found</Th>
                        <Th>Status</Th>
                        <Th></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {health.batches_to_review.map((row) => (
                        <Tr key={row.batch_id}>
                          <Td className="whitespace-nowrap">{formatDate(row.confirmed_at)}</Td>
                          <Td>
                            <Badge variant={TYPE_BADGE[row.import_type].variant}>
                              {TYPE_BADGE[row.import_type].label}
                            </Badge>
                          </Td>
                          <Td className="font-medium">{row.branch_name}</Td>
                          <Td className="max-w-[16rem] truncate" title={row.filename ?? undefined}>
                            {row.filename}
                          </Td>
                          <Td className="max-w-[28rem]">{row.note}</Td>
                          <Td>
                            <Badge variant={STATUS_BADGE[row.status].variant}>{STATUS_BADGE[row.status].label}</Badge>
                          </Td>
                          <Td>
                            <div className="flex items-center gap-3">
                              {onViewImportBatch && (
                                <button
                                  className="text-brand text-sm font-medium hover:underline whitespace-nowrap"
                                  onClick={() => onViewImportBatch(row.batch_id)}
                                >
                                  View in History →
                                </button>
                              )}
                              <button
                                className="text-text-muted text-sm font-medium hover:underline hover:text-text-secondary whitespace-nowrap"
                                title="Already handled — hide this from Batches to review"
                                onClick={() => dismissBatch(row.batch_id)}
                              >
                                Dismiss
                              </button>
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </TableContainer>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Slip-total mismatches"
                  description="A slip's line items don't add up to its own subtotal row — usually a misread row during cleaning. Sales only, since only Sales' source format has a slip subtotal to check against."
                />
                {health.slip_total_mismatches.length === 0 ? (
                  <EmptyState
                    icon={<HeartPulseIcon />}
                    title="No mismatches"
                    description={`Every slip confirmed in the last ${days} days added up to its own subtotal.`}
                  />
                ) : (
                  <TableContainer>
                    <Thead>
                      <Tr>
                        <Th>Slip ID</Th>
                        <Th>Branch</Th>
                        <Th>Date</Th>
                        <Th className="text-right">Line items total</Th>
                        <Th className="text-right">Subtotal on slip</Th>
                        <Th className="text-right">Difference</Th>
                        <Th></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {health.slip_total_mismatches.map((row) => (
                        <Tr key={`${row.batch_id}-${row.slip_id}`}>
                          <Td className="font-mono text-xs">{row.slip_id}</Td>
                          <Td className="font-medium">{row.branch_name}</Td>
                          <Td className="whitespace-nowrap">{formatDate(row.date)}</Td>
                          <Td className="text-right tabular-nums">{formatMoney(row.line_total)}</Td>
                          <Td className="text-right tabular-nums">{formatMoney(row.subtotal_on_slip)}</Td>
                          <Td className="text-right tabular-nums text-warning font-medium">
                            {formatMoney(row.difference)}
                          </Td>
                          <Td>
                            {onViewImportBatch && (
                              <button
                                className="text-brand text-sm font-medium hover:underline"
                                onClick={() => onViewImportBatch(row.batch_id)}
                              >
                                View in History →
                              </button>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </TableContainer>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  )
}

export default ImportOverviewPage
