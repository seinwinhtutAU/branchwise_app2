import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { cn } from '@renderer/lib/utils'
import type { BranchOption } from '@renderer/lib/useBranches'
import { Button } from '@renderer/components/ui/Button'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { DashboardIcon } from '@renderer/components/ui/icons'
import type { Profile } from '@renderer/components/features/types'
import { CostTab } from '@renderer/components/features/dashboard/CostTab'
import { CustomerTab } from '@renderer/components/features/dashboard/CustomerTab'
import { InventoryTab } from '@renderer/components/features/dashboard/InventoryTab'
import { RevenueTab } from '@renderer/components/features/dashboard/RevenueTab'
import { PERIOD_OPTIONS, type PeriodKey } from '@renderer/components/features/dashboard/shared'

interface Props {
  session: Session
  profile: Profile | null
  // Only used for an admin account (no fixed branch) — the dashboard is always one
  // branch at a time, never a cross-branch rollup, so admin needs a way to pick which
  // one. A branch-scoped account never sees this control at all.
  branchOptions: BranchOption[]
  // Every tab's data-quality tile links out to the full Warning page instead of just
  // naming it in text — this is the app-level nav switch that gets it there.
  onViewWarnings: () => void
}

type Tab = 'revenue' | 'cost' | 'inventory' | 'customer'

const TABS: { id: Tab; label: string }[] = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'cost', label: 'Cost' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'customer', label: 'Customer' }
]

function DashboardTabBar({ activeTab, onSelect }: { activeTab: Tab; onSelect: (tab: Tab) => void }): React.JSX.Element {
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

export function DashboardPage({ session, profile, branchOptions, onViewWarnings }: Props): React.JSX.Element {
  // Admin has no fixed branch_id — same convention used everywhere else in the app.
  const isAdmin = profile !== null && profile.branch_id === null
  const [activeTab, setActiveTab] = useState<Tab>('revenue')
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [branchId, setBranchId] = useState('')
  // A custom range (both set) overrides the period preset entirely — see
  // shared.tsx's periodQueryParams. Cleared together, not per-field, since a lone
  // "from" or "to" is a half-finished range, not a usable one.
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const hasCustomRange = !!dateFrom && !!dateTo

  function clearCustomRange(): void {
    setDateFrom('')
    setDateTo('')
  }

  // Defaults admin to the first retail branch once the list loads — a branch-scoped
  // account never needs this (its own branch is resolved server-side regardless of
  // what branch_id, if any, gets sent).
  useEffect(() => {
    if (isAdmin && !branchId && branchOptions.length > 0) {
      setBranchId(branchOptions[0].id)
    }
  }, [isAdmin, branchId, branchOptions])

  const waitingOnBranch = isAdmin && branchOptions.length === 0
  const canLoad = !isAdmin || !!branchId

  return (
    <div className="flex flex-col gap-4">
      <CardHeader title="Dashboard" description="Revenue, cost, inventory, and customer behavior for one branch." />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <DashboardTabBar activeTab={activeTab} onSelect={setActiveTab} />
        <div className="flex flex-wrap items-end gap-3">
          {isAdmin && branchOptions.length > 0 && (
            <div className="w-48">
              <Select label="Branch" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {branchOptions.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {activeTab !== 'inventory' && (
            <>
              <div className="w-44">
                <Select
                  label="Period"
                  value={period}
                  disabled={hasCustomRange}
                  onChange={(e) => setPeriod(e.target.value as PeriodKey)}
                >
                  {PERIOD_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </div>
              <Input
                type="date"
                label="Date from"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <Input
                type="date"
                label="Date to"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
              />
              {(dateFrom || dateTo) && (
                <Button variant="ghost" size="sm" onClick={clearCustomRange}>
                  Clear range
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      {waitingOnBranch && (
        <EmptyState
          icon={<DashboardIcon />}
          title="No retail branches yet"
          description="Add a retail branch before the dashboard has anything to show."
        />
      )}

      {!waitingOnBranch && activeTab === 'revenue' && (
        <RevenueTab
          session={session}
          branchId={branchId}
          period={period}
          dateFrom={dateFrom}
          dateTo={dateTo}
          canLoad={canLoad}
          onViewWarnings={onViewWarnings}
        />
      )}
      {!waitingOnBranch && activeTab === 'cost' && (
        <CostTab
          session={session}
          branchId={branchId}
          period={period}
          dateFrom={dateFrom}
          dateTo={dateTo}
          canLoad={canLoad}
          onViewWarnings={onViewWarnings}
        />
      )}
      {!waitingOnBranch && activeTab === 'inventory' && (
        <InventoryTab
          session={session}
          branchId={branchId}
          canLoad={canLoad}
          onViewWarnings={onViewWarnings}
        />
      )}
      {!waitingOnBranch && activeTab === 'customer' && (
        <CustomerTab
          session={session}
          branchId={branchId}
          period={period}
          dateFrom={dateFrom}
          dateTo={dateTo}
          canLoad={canLoad}
          onViewWarnings={onViewWarnings}
        />
      )}
    </div>
  )
}

export default DashboardPage
