import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import { useUrlQueries } from "@renderer/lib/queryClient";
import type { BranchOption } from "@renderer/lib/useBranches";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Select } from "@renderer/components/ui/Select";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import { Panel } from "@renderer/components/ui/Panel";
import {
  CheckIcon,
  CloseIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import {
  AlertExplanation,
  PeriodControls,
} from "@renderer/components/features/dashboard/shared";
import { usePeriodRange } from "@renderer/components/features/dashboard/usePeriodRange";
import {
  EVIDENCE_LABEL,
  SEVERITY_META,
  dashboardUrl,
  type AlertSeverity,
  type EvidenceTarget,
  type HealthAlert,
  type OverviewData,
} from "@renderer/components/features/dashboard/helpers";
import type { Profile } from "@renderer/components/features/types";

type Tab = "all" | "sales" | "inventory" | "customer" | "data_quality";
type SeverityFilter = "all" | AlertSeverity;

const CATEGORY_LABEL: Record<string, string> = {
  sales: "Sales",
  inventory: "Inventory",
  customer: "Customer",
  data_quality: "Data quality",
};

const CATEGORY_ORDER = [
  "sales",
  "inventory",
  "customer",
  "data_quality",
] as const;

// Worst first. `normal` alerts sit at the end of a branch's rows.
const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  normal: 2,
};

interface BranchAlert extends HealthAlert {
  branchId: string;
  branchName: string;
}

/** One alert in the master list — a single compact row, selectable. */
function AlertListRow({
  alert,
  active,
  showBranch,
  onSelect,
}: {
  alert: BranchAlert;
  active: boolean;
  showBranch: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const meta = SEVERITY_META[alert.severity];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active}
      className={cn(
        "w-full text-left px-3 py-2.5 border-b border-border/70 transition-colors cursor-pointer",
        "flex items-start gap-2.5",
        active ? "bg-brand-subtle" : "hover:bg-bg-subtle/70",
      )}
    >
      <span
        className={cn("mt-1.5 w-2 h-2 rounded-full shrink-0", meta.dot)}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          {showBranch && (
            <span className="font-medium text-text-secondary truncate">
              {alert.branchName}
            </span>
          )}
          <span className="truncate">
            {CATEGORY_LABEL[alert.dimension] ?? alert.dimension}
          </span>
        </div>
        <div
          className={cn(
            "text-xs font-medium mt-0.5 truncate",
            active ? "text-text-primary" : "text-text-primary",
          )}
        >
          {alert.title}
        </div>
        <div className="text-xs mt-0.5 truncate text-text-muted">
          {alert.summary}
        </div>
      </div>
    </button>
  );
}

/** The branch name banding the rows beneath it in the master list. */
function BranchListHeader({
  name,
  count,
}: {
  name: string;
  count: number;
}): React.JSX.Element {
  return (
    <div className="sticky top-0 z-10 bg-bg-subtle px-3 py-1.5 border-b border-border/80 flex items-center justify-between">
      <span className="text-xs font-semibold text-text-primary truncate">
        {name}
      </span>
      {count > 0 ? (
        <Badge variant="brand" className="text-[11px] px-1.5 py-0 shrink-0">
          {count}
        </Badge>
      ) : (
        <span className="text-[11px] text-text-muted shrink-0">
          All clear
        </span>
      )}
    </div>
  );
}

/** The right-hand panel: the selected alert's action, then its supporting evidence. */
function AlertInspector({
  alert,
  showBranch,
  onOpenEvidence,
}: {
  alert: BranchAlert;
  showBranch: boolean;
  onOpenEvidence: (target: EvidenceTarget, branchId: string) => void;
}): React.JSX.Element {
  const meta = SEVERITY_META[alert.severity];
  return (
    <div className="flex flex-col gap-4 p-4 overflow-y-auto h-full">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={meta.badge} dot>
            {meta.label}
          </Badge>
          <span className="text-xs font-medium text-text-muted">
            {CATEGORY_LABEL[alert.dimension] ?? alert.dimension}
          </span>
          {showBranch && (
            <span className="text-xs text-text-muted">
              · {alert.branchName}
            </span>
          )}
        </div>
        <h3 className="text-base font-semibold text-text-primary">
          {alert.title}
        </h3>
        <p className="text-sm text-text-secondary">{alert.summary}</p>
      </div>

      {/* What to do lives at the top of the panel — it's the thing this whole page
          exists to produce, so it must be visible without scrolling past the
          evidence first. */}
      <div className="rounded-lg border border-brand-pill bg-brand-subtle p-3 flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-brand">
          What to do
        </span>
        <p className="text-sm text-text-primary">{alert.recommended_action}</p>
        <Button
          variant="secondary"
          size="sm"
          className="self-start h-7 px-2.5 text-xs"
          onClick={() => onOpenEvidence(alert.link, alert.branchId)}
        >
          {EVIDENCE_LABEL[alert.link]} →
        </Button>
      </div>

      <div className="border-t border-border pt-4">
        <AlertExplanation alert={alert} />
      </div>
    </div>
  );
}

/** The right-hand panel when nothing needs a decision. */
function InspectorAllClear(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <EmptyState
        icon={<CheckIcon />}
        title="Everything normal"
        description="Nothing needs your attention for this selection right now."
      />
    </div>
  );
}

interface Props {
  session: Session;
  profile: Profile | null;
  branchOptions: BranchOption[];
  onOpenEvidence: (target: EvidenceTarget, branchId: string) => void;
}

export function BusinessAlertsPage({
  session,
  profile,
  branchOptions,
  onOpenEvidence,
}: Props): React.JSX.Element {
  const isAdmin = profile !== null && profile.branch_id === null;
  const range = usePeriodRange("30d");
  const [branchFilter, setBranchFilter] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const branchIds = isAdmin
    ? branchOptions.map((branch) => branch.id)
    : profile?.branch_id
      ? [profile.branch_id]
      : [];
  const urls = branchIds.map((id) =>
    dashboardUrl("overview", id, {
      period: range.period,
      dateFrom: range.applied.from,
      dateTo: range.applied.to,
    }),
  );
  const { data, isLoading, isRefreshing, failedCount, reload } =
    useUrlQueries<OverviewData>(urls, session, "alerts");

  const branches = Object.values(data);
  const showBranch = branches.length > 1;
  const allAlerts: BranchAlert[] = useMemo(
    () =>
      branches
        .flatMap((branch) =>
          branch.alerts.map((alert) => ({
            ...alert,
            branchId: branch.branch_id,
            branchName: branch.branch_name,
          })),
        )
        .sort(
          (a, b) =>
            SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
            CATEGORY_ORDER.indexOf(
              a.dimension as (typeof CATEGORY_ORDER)[number],
            ) -
              CATEGORY_ORDER.indexOf(
                b.dimension as (typeof CATEGORY_ORDER)[number],
              ) ||
            a.branchName.localeCompare(b.branchName),
        ),
    [branches],
  );

  const inBranch = useMemo(
    () =>
      allAlerts.filter(
        (alert) => !branchFilter || alert.branchId === branchFilter,
      ),
    [allAlerts, branchFilter],
  );

  const category = activeTab === "all" ? "" : activeTab;

  const shown = useMemo(() => {
    return inBranch.filter((alert) => {
      const matchCategory = !category || alert.dimension === category;
      const matchSeverity =
        severityFilter === "all" || alert.severity === severityFilter;
      return matchCategory && matchSeverity;
    });
  }, [inBranch, category, severityFilter]);

  const categoryCounts = useMemo(
    () => ({
      all: inBranch.length,
      sales: inBranch.filter((a) => a.dimension === "sales").length,
      inventory: inBranch.filter((a) => a.dimension === "inventory").length,
      customer: inBranch.filter((a) => a.dimension === "customer").length,
      data_quality: inBranch.filter((a) => a.dimension === "data_quality")
        .length,
    }),
    [inBranch],
  );

  const severityCounts = useMemo(
    () => ({
      all: inBranch.length,
      critical: inBranch.filter((a) => a.severity === "critical").length,
      warning: inBranch.filter((a) => a.severity === "warning").length,
      normal: inBranch.filter((a) => a.severity === "normal").length,
    }),
    [inBranch],
  );

  const isFiltered =
    branchFilter !== "" || activeTab !== "all" || severityFilter !== "all";

  const resetFilters = (): void => {
    setBranchFilter("");
    setActiveTab("all");
    setSeverityFilter("all");
  };

  const groups = useMemo(() => {
    return branches
      .filter((branch) => !branchFilter || branch.branch_id === branchFilter)
      .map((branch) => {
        const groupAlerts = shown.filter(
          (alert) => alert.branchId === branch.branch_id,
        );
        return {
          branchId: branch.branch_id,
          branchName: branch.branch_name,
          alerts: groupAlerts,
          allClear:
            !category &&
            severityFilter === "all" &&
            groupAlerts.length === 0 &&
            allAlerts.every((alert) => alert.branchId !== branch.branch_id),
        };
      })
      .filter((group) => group.alerts.length > 0 || group.allClear)
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.alerts[0]?.severity ?? "normal"] -
            SEVERITY_RANK[b.alerts[0]?.severity ?? "normal"] ||
          a.branchName.localeCompare(b.branchName),
      );
  }, [branches, branchFilter, shown, category, severityFilter, allAlerts]);

  // Keep a selection alive across refetches/filters: stay on the same alert while it's
  // still in view, otherwise fall back to the first row so the inspector is never blank
  // while rows are actually on screen.
  useEffect(() => {
    if (shown.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!shown.some((alert) => alert.id === selectedId)) {
      setSelectedId(shown[0].id);
    }
  }, [shown, selectedId]);

  const selectedAlert = shown.find((alert) => alert.id === selectedId) ?? null;

  // The master-detail grid gets an explicit pixel height rather than a fixed
  // max-height guess: measured from wherever the filter bar actually ends (which
  // moves with window width, since the category/severity pills wrap at narrower
  // widths) down to the bottom of the window, so the panel always fills the space
  // instead of stopping early and leaving blank page background beneath it.
  const filterBarRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    function measure(): void {
      const el = filterBarRef.current;
      if (!el) return;
      const bottomGap = 14; // matches main's own bottom padding (py-3.5)
      const available = window.innerHeight - el.getBoundingClientRect().bottom - bottomGap;
      setGridHeight(Math.max(320, available));
    }
    measure();
    window.addEventListener("resize", measure);
    const observer = new ResizeObserver(measure);
    if (filterBarRef.current) observer.observe(filterBarRef.current);
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <Panel className="shadow-xs">
        <div
          ref={filterBarRef}
          className="sticky top-14 lg:top-0 z-30 bg-bg-base px-4 py-2.5 border-b border-border space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
                Business Alerts
              </h2>
              <span className="text-xs text-text-muted hidden sm:inline">
                {shown.length} alert{shown.length === 1 ? "" : "s"} across{" "}
                {groups.length} branch{groups.length === 1 ? "" : "es"}.
              </span>
              {isFiltered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={resetFilters}
                  className="text-xs h-6 px-1.5 text-text-muted hover:text-error"
                >
                  <CloseIcon className="w-3.5 h-3.5" />
                  Clear
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <PeriodControls range={range} />
              {branches.length > 1 && (
                <div className="w-36 sm:w-44">
                  <Select
                    size="sm"
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                    className="h-8 text-xs"
                  >
                    <option value="">All branches</option>
                    {branches.map((branch) => (
                      <option key={branch.branch_id} value={branch.branch_id}>
                        {branch.branch_name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <RefreshButton onClick={reload} refreshing={isRefreshing} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
            <div className="flex items-center gap-1 bg-bg-subtle/70 p-0.5 rounded-md border border-border text-xs">
              {(
                [
                  "all",
                  "sales",
                  "inventory",
                  "customer",
                  "data_quality",
                ] as Tab[]
              ).map((tab) => {
                const count = categoryCounts[tab];
                const active = activeTab === tab;
                const label = tab === "all" ? "All" : CATEGORY_LABEL[tab];
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "px-2 py-0.5 rounded font-medium transition-colors text-xs whitespace-nowrap cursor-pointer",
                      active
                        ? "bg-brand text-white font-semibold shadow-xs"
                        : "text-text-muted hover:text-text-primary",
                    )}
                  >
                    {label} ({count})
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 bg-bg-subtle/70 p-0.5 rounded-md border border-border text-xs">
              <button
                type="button"
                onClick={() => setSeverityFilter("all")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs whitespace-nowrap cursor-pointer",
                  severityFilter === "all"
                    ? "bg-brand text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                All Severities ({severityCounts.all})
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter("critical")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs whitespace-nowrap cursor-pointer",
                  severityFilter === "critical"
                    ? "bg-error text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-error",
                )}
              >
                Critical ({severityCounts.critical})
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter("warning")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs whitespace-nowrap cursor-pointer",
                  severityFilter === "warning"
                    ? "bg-warning text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-warning",
                )}
              >
                Warning ({severityCounts.warning})
              </button>
              <button
                type="button"
                onClick={() => setSeverityFilter("normal")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs whitespace-nowrap cursor-pointer",
                  severityFilter === "normal"
                    ? "bg-brand text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                Normal ({severityCounts.normal})
              </button>
            </div>
          </div>
        </div>

        {isAdmin && branchOptions.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-muted">
            Add a retail branch before there is anything to check.
          </div>
        ) : isLoading ? (
          <div className="p-6 flex flex-col gap-4">
            <Skeleton className="h-10 w-96" />
            <Skeleton className="h-64" />
          </div>
        ) : branches.length === 0 ? (
          <div className="p-8">
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
          </div>
        ) : (
          <div>
            {failedCount > 0 && (
              <div className="p-3 bg-warning/10 text-xs text-warning border-b border-warning/20">
                {failedCount} branch{failedCount === 1 ? "" : "es"}{" "}
                couldn&apos;t be loaded, so this list may be incomplete.
              </div>
            )}

            {groups.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  icon={<WarningIcon />}
                  title="No alerts match this filter"
                  description="No alerts found for the selected branch or category."
                  action={
                    isFiltered ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={resetFilters}
                      >
                        Reset Filters
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              // Master-detail split: a narrow scrollable list of every alert on the
              // left, and one wide inspector panel on the right showing the selected
              // alert's action and evidence — so reading an alert never means
              // navigating away from the list of the others.
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,22rem)_1fr] divide-y lg:divide-y-0 lg:divide-x divide-border">
                <div
                  className="overflow-y-auto"
                  style={{ height: gridHeight ?? undefined }}
                >
                  {groups.map((group) => (
                    <div key={group.branchId}>
                      {showBranch && (
                        <BranchListHeader
                          name={group.branchName}
                          count={group.alerts.length}
                        />
                      )}
                      {group.allClear ? (
                        <div className="px-3 py-4 text-xs text-text-muted">
                          Everything normal — nothing to do.
                        </div>
                      ) : (
                        group.alerts.map((alert) => (
                          <AlertListRow
                            key={`${alert.branchId}:${alert.id}`}
                            alert={alert}
                            active={selectedId === alert.id}
                            showBranch={false}
                            onSelect={() => setSelectedId(alert.id)}
                          />
                        ))
                      )}
                    </div>
                  ))}
                </div>
                <div
                  className="overflow-y-auto"
                  style={{ height: gridHeight ?? undefined }}
                >
                  {selectedAlert ? (
                    <AlertInspector
                      alert={selectedAlert}
                      showBranch={showBranch}
                      onOpenEvidence={onOpenEvidence}
                    />
                  ) : (
                    <InspectorAllClear />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

export default BusinessAlertsPage;
