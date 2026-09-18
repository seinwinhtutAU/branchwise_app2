import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import type { Session } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import type { BranchOption } from "@renderer/lib/useBranches";
import { refreshEverything } from "@renderer/lib/queryClient";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { CardHeader } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Select } from "@renderer/components/ui/Select";
import { DashboardIcon } from "@renderer/components/ui/icons";
import type { Profile } from "@renderer/components/features/types";
import { CostTab } from "@renderer/components/features/dashboard/CostTab";
import { CustomerTab } from "@renderer/components/features/dashboard/CustomerTab";
import { InventoryTab } from "@renderer/components/features/dashboard/InventoryTab";
import {
  OverviewTab,
  type EvidenceTarget,
} from "@renderer/components/features/dashboard/OverviewTab";
import { RevenueTab } from "@renderer/components/features/dashboard/RevenueTab";
import { PeriodControls } from "@renderer/components/features/dashboard/shared";
import { usePeriodRange } from "@renderer/components/features/dashboard/usePeriodRange";

interface Props {
  session: Session;
  // Set when another section sends the user here — the Business Alerts page opens the
  // evidence tab for a specific branch, and that has to survive the section switch.
  initialTab?: Tab;
  initialBranchId?: string;
  profile: Profile | null;
  // Only used for an admin account (no fixed branch) — the dashboard is always one
  // branch at a time, never a cross-branch rollup, so admin needs a way to pick which
  // one. A branch-scoped account never sees this control at all.
  branchOptions: BranchOption[];
  // Every tab's data-quality tile links out to the full Warning page instead of just
  // naming it in text — this is the app-level nav switch that gets it there.
  onViewWarnings: () => void;
  // The Overview branch page explains a score; the alerts behind it live on their own
  // page, so it links there rather than repeating them.
  onViewBusinessAlerts: () => void;
  // The Inventory tab's Low Stock / Dead Stock tables show only their top few rows — this
  // opens the matching full, paginated list on the Inventory nav page for the rest.
  onViewInventoryList: (tab: "lowStock" | "deadStock") => void;
  // Which branch the Overview tab has open. Owned by App so it survives this page
  // unmounting the tab on every tab switch — see App.tsx.
  overviewBranchId: string | null;
  onOverviewBranchChange: (branchId: string | null) => void;
}

type Tab = "overview" | "revenue" | "cost" | "inventory" | "customer";

// Overview first, and first on load: it's the decision page, and the four that follow
// are the evidence behind whichever part of it is red (see docs/branch_health.md).
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "revenue", label: "Revenue" },
  { id: "cost", label: "Cost" },
  { id: "inventory", label: "Inventory" },
  { id: "customer", label: "Customer" },
];

function DashboardTabBar({
  activeTab,
  onSelect,
}: {
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 p-1 rounded-lg bg-bg-subtle w-fit"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            "flex items-center gap-1.5 h-8 px-4 rounded-md text-sm font-medium transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
            activeTab === tab.id
              ? "bg-brand-subtle text-brand shadow-sm"
              : "text-text-muted hover:text-text-secondary",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function DashboardPage({
  session,
  profile,
  branchOptions,
  onViewWarnings,
  onViewBusinessAlerts,
  onViewInventoryList,
  overviewBranchId,
  onOverviewBranchChange,
  initialTab,
  initialBranchId,
}: Props): React.JSX.Element {
  // Admin has no fixed branch_id — same convention used everywhere else in the app.
  const isAdmin = profile !== null && profile.branch_id === null;
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? "overview");
  const [branchId, setBranchId] = useState(initialBranchId ?? "");
  // 30d, not today: Overview is the landing tab and it is built on vs-previous-period
  // growth, where one day against the day before is mostly noise. The control is shared
  // across tabs, so switching keeps whatever is selected.
  const range = usePeriodRange("30d");
  const { period } = range;
  const appliedRange = range.applied;

  // Defaults admin to the first retail branch once the list loads — a branch-scoped
  // account never needs this (its own branch is resolved server-side regardless of
  // what branch_id, if any, gets sent).
  useEffect(() => {
    if (isAdmin && !branchId && branchOptions.length > 0) {
      setBranchId(branchOptions[0].id);
    }
  }, [isAdmin, branchId, branchOptions]);

  const waitingOnBranch = isAdmin && branchOptions.length === 0;
  const canLoad = !isAdmin || !!branchId;

  // Refresh asks every query to refetch rather than reaching into this one tab: each tab
  // owns its own request (Overview owns two — the branch cards and whichever branch it
  // has open), so a button wired to one of them would leave the rest showing the numbers
  // the reader just asked to update. The figures stay on screen while it happens; see
  // refreshEverything. useIsFetching() is React Query's own count of in-flight queries
  // anywhere in the app, the direct replacement for the old cache's useFetchInFlight.
  const isFetching = useIsFetching() > 0;

  return (
    <div className="flex flex-col gap-4">
      <CardHeader
        title="Dashboard"
        description="Branch health across every retail branch, and revenue, cost, inventory and customer detail one branch at a time."
        action={
          <RefreshButton
            onClick={refreshEverything}
            refreshing={isFetching}
          />
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <DashboardTabBar activeTab={activeTab} onSelect={setActiveTab} />
        <div className="flex flex-wrap items-end gap-3">
          {isAdmin && branchOptions.length > 0 && activeTab !== "overview" && (
            <div className="w-48">
              <Select
                label="Branch"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
              >
                {branchOptions.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {activeTab !== "inventory" && <PeriodControls range={range} />}
        </div>
      </div>

      {waitingOnBranch && (
        <EmptyState
          icon={<DashboardIcon />}
          title="No retail branches yet"
          description="Add a retail branch before the dashboard has anything to show."
        />
      )}

      {!waitingOnBranch && activeTab === "overview" && (
        <OverviewTab
          session={session}
          isAdmin={isAdmin}
          branchOptions={branchOptions}
          branchId={branchId}
          period={period}
          dateFrom={appliedRange.from}
          dateTo={appliedRange.to}
          canLoad={canLoad}
          onViewBusinessAlerts={onViewBusinessAlerts}
          openBranchId={overviewBranchId}
          onOpenBranchChange={onOverviewBranchChange}
          // A red dimension or alert is only useful if you can go look at what produced
          // it — four of the five open the tab holding that evidence, and Data Quality
          // leaves the dashboard for the Warning page entirely. The branch comes along
          // too, so drilling in from a branch card shows that branch, not whichever one
          // the shared selector happened to be on.
          onOpenEvidence={(
            target: EvidenceTarget,
            evidenceBranchId: string,
          ) => {
            setBranchId(evidenceBranchId);
            if (target === "warnings") onViewWarnings();
            else setActiveTab(target);
          }}
        />
      )}
      {!waitingOnBranch && activeTab === "revenue" && (
        <RevenueTab
          session={session}
          branchId={branchId}
          period={period}
          dateFrom={appliedRange.from}
          dateTo={appliedRange.to}
          canLoad={canLoad}
          onViewWarnings={onViewWarnings}
        />
      )}
      {!waitingOnBranch && activeTab === "cost" && (
        <CostTab
          session={session}
          branchId={branchId}
          period={period}
          dateFrom={appliedRange.from}
          dateTo={appliedRange.to}
          canLoad={canLoad}
          onViewWarnings={onViewWarnings}
        />
      )}
      {!waitingOnBranch && activeTab === "inventory" && (
        <InventoryTab
          session={session}
          branchId={branchId}
          canLoad={canLoad}
          onViewWarnings={onViewWarnings}
          onViewInventoryList={onViewInventoryList}
        />
      )}
      {!waitingOnBranch && activeTab === "customer" && (
        <CustomerTab
          session={session}
          branchId={branchId}
          period={period}
          dateFrom={appliedRange.from}
          dateTo={appliedRange.to}
          canLoad={canLoad}
          onViewWarnings={onViewWarnings}
        />
      )}
    </div>
  );
}

export default DashboardPage;
