import { useEffect, useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import type { Session } from "@renderer/lib/auth";
import type { BranchOption } from "@renderer/lib/useBranches";
import { refreshEverything } from "@renderer/lib/queryClient";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { TabBar } from "@renderer/components/ui/Tabs";
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
import { SummaryTab } from "@renderer/components/features/dashboard/SummaryTab";
import { PeriodControls } from "@renderer/components/features/dashboard/shared";
import { DASHBOARD_PERIOD_OPTIONS } from "@renderer/components/features/dashboard/helpers";
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
  // The left-nav branch switcher's current choice ("" = All branches) and setter — the
  // page's own branch picker was removed in favour of that one control (see AppShell).
  selectedBranchId: string;
  onBranchChange: (branchId: string) => void;
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
  onViewChecking?: () => void;
  onViewImport?: () => void;
  /** Admin accounts are restricted to the Summary and Health tabs. */
  showAdvancedTabs: boolean;
}

type Tab = "summary" | "overview" | "revenue" | "cost" | "inventory" | "customer";

// Summary gives the executive dashboard snapshot; Health gives the branch health scores.
const TABS: { id: Tab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "overview", label: "Health" },
  { id: "revenue", label: "Revenue" },
  { id: "cost", label: "Cost" },
  { id: "inventory", label: "Inventory" },
  { id: "customer", label: "Customer" },
];

function DashboardTabBar({
  activeTab,
  onSelect,
  showAdvancedTabs,
}: {
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
  showAdvancedTabs: boolean;
}): React.JSX.Element {
  return (
    <TabBar<Tab>
      tabs={showAdvancedTabs ? TABS : TABS.filter((tab) => tab.id === "summary" || tab.id === "overview")}
      activeTab={activeTab}
      onSelect={onSelect}
      className="border-b-0 w-auto"
    />
  );
}

export function DashboardPage({
  session,
  profile,
  branchOptions,
  selectedBranchId,
  onBranchChange,
  onViewWarnings,
  onViewBusinessAlerts,
  onViewInventoryList,
  overviewBranchId,
  onOverviewBranchChange,
  initialTab,
  initialBranchId,
  onViewChecking,
  onViewImport,
  showAdvancedTabs,
}: Props): React.JSX.Element {
  // Admin has no fixed branch_id — same convention used everywhere else in the app.
  const isAdmin = profile !== null && profile.branch_id === null;
  const [activeTab, setActiveTab] = useState<Tab>(initialTab ?? "overview");
  const [branchId, setBranchId] = useState(
    initialBranchId ?? selectedBranchId ?? "",
  );
  // Yesterday, not today: a full completed day reads more sensibly than a still-filling
  // one, on every tab this control drives — including Overview's vs-previous-period
  // growth. The control is shared across tabs, so switching keeps whatever is selected.
  const range = usePeriodRange("yesterday");
  const { period, month } = range;
  const appliedRange = range.applied;

  useEffect(() => {
    if (!showAdvancedTabs && !["summary", "overview"].includes(activeTab)) {
      setActiveTab("overview");
    }
  }, [activeTab, showAdvancedTabs]);

  // Follows the left-nav branch switcher — "All branches" there just leaves this page
  // showing whichever branch it already had, since (unlike Business Alerts) it always
  // needs exactly one.
  useEffect(() => {
    if (isAdmin && selectedBranchId) {
      setBranchId(selectedBranchId);
    }
  }, [isAdmin, selectedBranchId]);

  // Defaults admin to the first retail branch once the list loads — when the sidebar is
  // on "All branches" and nothing has been picked yet. A branch-scoped account never
  // needs this (its own branch is resolved server-side regardless of what branch_id, if
  // any, gets sent).
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
    <div className="flex flex-col gap-3">
      {/* Streamlined Dashboard Navigation & Filters Toolbar */}
      <div className="flex flex-col gap-2 pb-2 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight text-text-primary shrink-0 hidden sm:block">
              Dashboard
            </h1>
            <DashboardTabBar
              activeTab={activeTab}
              onSelect={setActiveTab}
              showAdvancedTabs={showAdvancedTabs}
            />
          </div>

          <RefreshButton onClick={refreshEverything} refreshing={isFetching} />
        </div>

        {activeTab !== "inventory" && (
          <PeriodControls range={range} options={DASHBOARD_PERIOD_OPTIONS} />
        )}
      </div>

      {waitingOnBranch && (
        <EmptyState
          icon={<DashboardIcon />}
          title="No branches yet"
          description="Add a branch before the dashboard has anything to show."
        />
      )}

      {!waitingOnBranch && activeTab === "summary" && (
        <SummaryTab
          session={session}
          branchId={branchId}
          period={period}
          dateFrom={appliedRange.from}
          dateTo={appliedRange.to}
          month={month}
          canLoad={canLoad}
          onOpenDashboard={showAdvancedTabs ? setActiveTab : undefined}
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
          month={month}
          canLoad={canLoad}
          onViewBusinessAlerts={onViewBusinessAlerts}
          openBranchId={overviewBranchId}
          onOpenBranchChange={onOverviewBranchChange}
          // A red dimension or alert is only useful if you can go look at what produced
          // it — four of the five open the tab holding that evidence, and Data Quality
          // leaves the dashboard for the Warning page entirely. The branch comes along
          // too, so drilling in from a branch card shows that branch, not whichever one
          // the shared selector happened to be on — and the left-nav switcher follows
          // along too, so it doesn't disagree with what's now on screen.
          onOpenEvidence={(
            target: EvidenceTarget,
            evidenceBranchId: string,
          ) => {
            setBranchId(evidenceBranchId);
            onBranchChange(evidenceBranchId);
            if (target === "warnings") {
              onViewWarnings();
            } else if (target === "checking") {
              onViewChecking?.();
            } else if (target === "import") {
              onViewImport?.();
            } else if (showAdvancedTabs) {
              setActiveTab(target);
            }
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
          month={month}
          canLoad={canLoad}
        />
      )}
      {!waitingOnBranch && activeTab === "cost" && (
        <CostTab
          session={session}
          branchId={branchId}
          period={period}
          dateFrom={appliedRange.from}
          dateTo={appliedRange.to}
          month={month}
          canLoad={canLoad}
        />
      )}
      {!waitingOnBranch && activeTab === "inventory" && (
        <InventoryTab
          session={session}
          branchId={branchId}
          canLoad={canLoad}
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
          month={month}
          canLoad={canLoad}
        />
      )}
    </div>
  );
}

export default DashboardPage;
