import { Fragment, useMemo, useState } from "react";
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
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import {
  AlertExplanation,
  PeriodControls,
} from "@renderer/components/features/dashboard/shared";
import { usePeriodRange } from "@renderer/components/features/dashboard/usePeriodRange";
import {
  SEVERITY_META,
  dashboardUrl,
  type AlertSeverity,
  type EvidenceTarget,
  type HealthAlert,
  type OverviewData,
} from "@renderer/components/features/dashboard/helpers";
import type { Profile } from "@renderer/components/features/types";

const COLUMN_COUNT = 6;

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

/**
 * One alert as a table row, plus its expanded detail row.
 */
function AlertRow({
  index,
  alert,
  onOpenEvidence,
}: {
  index: number;
  alert: BranchAlert;
  onOpenEvidence: (target: EvidenceTarget, branchId: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const meta = SEVERITY_META[alert.severity];

  return (
    <>
      <Tr className="hover:bg-bg-subtle/50 transition-colors">
        <Td className="w-12 text-center text-xs font-mono text-text-muted">
          {index}
        </Td>
        <Td className="w-28">
          <Badge variant={meta.badge} dot>
            {meta.label}
          </Badge>
        </Td>
        <Td className="w-28 whitespace-nowrap text-xs font-medium text-text-muted">
          {CATEGORY_LABEL[alert.dimension] ?? alert.dimension}
        </Td>
        <Td className="font-medium text-text-primary text-xs">{alert.title}</Td>
        <Td className={cn("text-xs font-medium", meta.text)}>
          {alert.summary}
        </Td>
        <Td className="w-20 text-right">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium cursor-pointer"
          >
            {expanded ? "Hide" : "Details"}
            {expanded ? (
              <ChevronUpIcon className="w-3 h-3" />
            ) : (
              <ChevronDownIcon className="w-3 h-3" />
            )}
          </button>
        </Td>
      </Tr>
      {expanded && (
        <Tr>
          <Td
            colSpan={COLUMN_COUNT}
            className="bg-bg-subtle/40 px-6 py-4 border-y border-border/70"
          >
            <AlertExplanation
              alert={alert}
              onOpenEvidence={(target) =>
                onOpenEvidence(target, alert.branchId)
              }
            />
          </Td>
        </Tr>
      )}
    </>
  );
}

/**
 * The row a branch gets when it raised nothing at all.
 */
function AllClearRow(): React.JSX.Element {
  return (
    <Tr>
      <Td className="w-12 text-center text-xs font-mono text-text-muted">—</Td>
      <Td className="w-28">
        <Badge variant={SEVERITY_META.normal.badge} dot>
          {SEVERITY_META.normal.label}
        </Badge>
      </Td>
      <Td className="w-28 text-text-muted text-xs">—</Td>
      <Td className="font-medium text-text-primary text-xs">
        Everything normal this period
      </Td>
      <Td className="text-text-muted text-xs">
        No sales, inventory, customer, or data-quality problems found.
      </Td>
      <Td className="w-20" />
    </Tr>
  );
}

/** A full-width band naming the branch the rows beneath it belong to. */
function BranchHeaderRow({
  name,
  count,
}: {
  name: string;
  count: number;
}): React.JSX.Element {
  return (
    <tr>
      <td
        colSpan={COLUMN_COUNT}
        className="bg-bg-subtle px-4 py-2 border-b border-border/80 font-medium"
      >
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold text-text-primary">{name}</span>
          {count > 0 ? (
            <Badge variant="brand" className="text-[11px] px-1.5 py-0">
              {count} {count === 1 ? "alert" : "alerts"}
            </Badge>
          ) : (
            <span className="text-[11px] text-text-muted">All clear</span>
          )}
        </div>
      </td>
    </tr>
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

  return (
    <div className="flex flex-col gap-6">
      {/* Unified Table Panel */}
      <Panel className="shadow-xs">
        <div className="sticky top-14 lg:top-0 z-30 bg-bg-base px-4 py-2.5 border-b border-border space-y-2.5">
          {/* Top Bar: Title & Branch Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
                Branch Anomaly Alerts
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

          {/* Filter Row: Categories and Severities */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
            {/* Category Tab Pills */}
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

            {/* Severity Filter Pills */}
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

        {/* Content Body */}
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
              <TableContainer>
                <Thead>
                  <Tr>
                    <Th className="w-12 text-center font-mono">#</Th>
                    <Th className="w-28">Severity</Th>
                    <Th className="w-28">Category</Th>
                    <Th className="min-w-[180px]">Alert</Th>
                    <Th className="min-w-[240px]">Detail</Th>
                    <Th className="w-20 text-right" />
                  </Tr>
                </Thead>
                <Tbody>
                  {groups.map((group) => {
                    let rowCounter = 0;
                    return (
                      <Fragment key={group.branchId}>
                        <BranchHeaderRow
                          name={group.branchName}
                          count={group.alerts.length}
                        />
                        {group.allClear ? (
                          <AllClearRow />
                        ) : (
                          group.alerts.map((alert) => {
                            rowCounter += 1;
                            return (
                              <AlertRow
                                key={`${alert.branchId}:${alert.id}`}
                                index={rowCounter}
                                alert={alert}
                                onOpenEvidence={onOpenEvidence}
                              />
                            );
                          })
                        )}
                      </Fragment>
                    );
                  })}
                </Tbody>
              </TableContainer>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}

export default BusinessAlertsPage;
