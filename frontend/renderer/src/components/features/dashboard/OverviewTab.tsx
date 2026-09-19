import { useMemo } from "react";
import type { Session } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import { useUrlQuery, useUrlQueries } from "@renderer/lib/queryClient";
import type { BranchOption } from "@renderer/lib/useBranches";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { Panel } from "@renderer/components/ui/Panel";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import {
  CheckIcon,
  ChevronLeftIcon,
  DashboardIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import { MeasureValue, RefreshingHint } from "./shared";
import {
  ACTIONABLE_SEVERITIES,
  EVIDENCE_LABEL,
  STATUS_META,
  dashboardUrl,
  dateRangeLabel,
  previousPeriodLabel,
  type DimensionScore,
  type EvidenceTarget,
  type HealthAlert,
  type HealthStatus,
  type OverviewData,
  type PeriodKey,
} from "./helpers";

// Which evidence tab each dimension's own numbers came from.
const DIMENSION_EVIDENCE: Record<string, EvidenceTarget> = {
  sales: "revenue",
  profit: "cost",
  inventory: "inventory",
  customer: "customer",
  data_quality: "warnings",
};

const DIMENSION_ICONS: Record<string, string> = {
  sales: "📈",
  profit: "💰",
  inventory: "📦",
  customer: "👥",
  data_quality: "🛡️",
};

function statusForScore(score: number | null): HealthStatus | null {
  if (score === null) return null;
  if (score >= 80) return "healthy";
  if (score >= 60) return "needs_attention";
  return "critical";
}

function scoreTone(score: number | null): string {
  const status = statusForScore(score);
  return status === null ? "text-text-muted" : STATUS_META[status].text;
}

function ScoreBar({
  score,
  status,
  className,
}: {
  score: number | null;
  status: HealthStatus | null;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "h-1.5 rounded-full bg-bg-raised overflow-hidden",
        className,
      )}
      role="presentation"
    >
      {score !== null && status && (
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
            STATUS_META[status].bar,
          )}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      )}
    </div>
  );
}

// ========================================================================================
// 1. Multi-Branch Overview Table (Admin Page 1)
// ========================================================================================

function MultiBranchComparisonView({
  session,
  branchOptions,
  period,
  dateFrom,
  dateTo,
  onOpen,
}: {
  session: Session;
  branchOptions: BranchOption[];
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  onOpen: (branchId: string) => void;
}): React.JSX.Element {
  const urls = branchOptions.map((b) =>
    dashboardUrl("overview", b.id, { period, dateFrom, dateTo }),
  );
  const { data, isLoading, isRefreshing, failedCount, reload } =
    useUrlQueries<OverviewData>(urls, session, "all branches health");

  const branchList = Object.values(data);

  // Summary statistics across all branches
  // Sort branches by health score descending
  const sortedBranches = useMemo(() => {
    return [...branchList].sort(
      (a, b) => (b.overall_score ?? -1) - (a.overall_score ?? -1),
    );
  }, [branchList]);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (branchList.length === 0 && failedCount > 0) {
    return (
      <EmptyState
        icon={<WarningIcon />}
        title="Couldn't load branch health data"
        description="Something went wrong reaching the backend."
        action={
          <Button variant="secondary" size="sm" onClick={reload}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Multi-Branch Health Cards Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Retail Branches Health
            </h2>
            <p className="text-xs text-text-muted mt-0.5">
              Comprehensive health scores and operational pillar performance per branch.
            </p>
          </div>
          <RefreshingHint show={isRefreshing} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedBranches.map((branch, index) => (
            <BranchHealthCard
              key={branch.branch_id}
              branch={branch}
              rank={index + 1}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function BranchHealthCard({
  branch,
  rank,
  onOpen,
}: {
  branch: OverviewData;
  rank: number;
  onOpen: (branchId: string) => void;
}): React.JSX.Element {
  const meta = branch.status ? STATUS_META[branch.status] : null;
  const actionableAlerts = branch.alerts.filter(
    (a) =>
      a.dimension !== "data_quality" &&
      ACTIONABLE_SEVERITIES.includes(a.severity),
  );

  const dimensionKeys = [
    { key: "sales", label: "Sales", icon: "📈" },
    { key: "profit", label: "Profit", icon: "💰" },
    { key: "inventory", label: "Inventory", icon: "📦" },
    { key: "customer", label: "Customer", icon: "👥" },
    { key: "data_quality", label: "Data Quality", icon: "🛡️" },
  ];

  return (
    <Panel
      className={cn(
        "flex flex-col justify-between p-4 sm:p-5 rounded-lg border border-border bg-bg-base shadow-xs",
        "hover:border-border-strong hover:shadow-sm transition-all cursor-pointer group",
      )}
      onClick={() => onOpen(branch.branch_id)}
    >
      <div>
        {/* Card Header: Rank & Branch Name & Status Badge */}
        <div className="flex items-start justify-between gap-2 pb-3 border-b border-border/70">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex items-center justify-center w-6 h-6 rounded-full bg-bg-subtle text-text-secondary text-xs font-bold font-mono shrink-0">
              #{rank}
            </span>
            <h3 className="font-bold text-base text-text-primary truncate group-hover:text-brand transition-colors">
              {branch.branch_name}
            </h3>
          </div>
          {meta && (
            <Badge variant={meta.badge} className="text-xs px-2 py-0.5 shrink-0">
              {meta.label}
            </Badge>
          )}
        </div>

        {/* Overall Score Section */}
        <div className="py-4">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-xs font-medium text-text-muted">
              Overall Health Score
            </span>
            <div className="flex items-baseline gap-1">
              <span
                className={cn(
                  "text-2xl font-extrabold tabular-nums",
                  scoreTone(branch.overall_score),
                )}
              >
                {branch.overall_score === null
                  ? "—"
                  : Math.round(branch.overall_score)}
              </span>
              <span className="text-xs text-text-muted">/ 100</span>
            </div>
          </div>
          <ScoreBar
            score={branch.overall_score}
            status={branch.status}
            className="h-2 w-full"
          />
        </div>

        {/* 4 Dimension Progress Bars */}
        <div className="space-y-2.5 pt-2 pb-3 border-t border-border/60">
          <span className="text-[11px] font-semibold text-text-muted tracking-wider uppercase">
            Pillars Performance
          </span>
          <div className="space-y-2">
            {dimensionKeys.map(({ key, label, icon }) => {
              const dim = branch.dimensions.find((d) => d.key === key);
              const score = dim?.score ?? null;
              const status = statusForScore(score);
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-text-secondary font-medium">
                      <span>{icon}</span>
                      <span>{label}</span>
                    </span>
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        scoreTone(score),
                      )}
                    >
                      {score === null ? "—" : `${Math.round(score)} / 100`}
                    </span>
                  </div>
                  <ScoreBar score={score} status={status} className="h-1.5 w-full" />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Card Footer: Alerts + Open Action */}
      <div className="pt-3 mt-2 border-t border-border/70 flex items-center justify-between gap-2">
        <div className="text-xs">
          {actionableAlerts.length > 0 ? (
            <span className="inline-flex items-center gap-1 text-warning font-medium">
              <WarningIcon className="w-3.5 h-3.5 shrink-0" />
              <span>
                {actionableAlerts.length}{" "}
                {actionableAlerts.length === 1 ? "active alert" : "active alerts"}
              </span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-success font-medium text-[11px]">
              <CheckIcon className="w-3.5 h-3.5 shrink-0" />
              <span>All indicators clear</span>
            </span>
          )}
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(branch.branch_id);
          }}
          className="text-xs h-7 px-2.5 text-brand group-hover:bg-brand group-hover:text-white transition-all shrink-0"
        >
          View Health →
        </Button>
      </div>
    </Panel>
  );
}

// ========================================================================================
// 2. Single-Branch Health Matrix View (Page 2)
// ========================================================================================

function DimensionMatrixCard({
  dimension,
  alerts,
  onOpenEvidence,
}: {
  dimension: DimensionScore;
  alerts: HealthAlert[];
  onOpenEvidence: (target: EvidenceTarget) => void;
}): React.JSX.Element {
  const evidence = DIMENSION_EVIDENCE[dimension.key];
  const meta = dimension.status ? STATUS_META[dimension.status] : null;
  const icon = DIMENSION_ICONS[dimension.key] ?? "📊";
  const weight = dimension.effective_weight ?? dimension.weight;
  const actionableAlerts = alerts.filter(
    (a) =>
      a.dimension === dimension.key && ACTIONABLE_SEVERITIES.includes(a.severity),
  );

  return (
    <div className="p-4 rounded-xl border border-border bg-bg-base flex flex-col justify-between gap-3 shadow-xs hover:border-border/80 transition-all">
      {/* Top Title & Header */}
      <div>
        <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-border/70">
          <div className="flex items-center gap-2">
            <span className="text-base">{icon}</span>
            <div>
              <span className="font-semibold text-sm text-text-primary">
                {dimension.label} Health
              </span>
              <span className="ml-2 text-[11px] text-text-muted">
                {Math.round(weight * 100)}% weight
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "font-bold text-sm tabular-nums",
                scoreTone(dimension.score),
              )}
            >
              {dimension.score === null ? "—" : Math.round(dimension.score)}
            </span>
            <span className="text-xs text-text-muted">/ 100</span>
            {meta && (
              <Badge variant={meta.badge} className="text-[10px] px-1.5 py-0">
                {meta.label}
              </Badge>
            )}
          </div>
        </div>

        {/* SubMetrics Grid */}
        {dimension.score === null ? (
          <p className="text-xs text-text-muted py-3">
            {dimension.insufficient_data_reason ?? "Insufficient data for this dimension."}
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 py-3">
            {dimension.sub_metrics.map((m) => (
              <div
                key={m.key}
                className="p-2 rounded-lg bg-bg-subtle/60 border border-border/50 flex flex-col justify-between"
              >
                <div className="text-[11px] text-text-muted truncate" title={m.label}>
                  {m.label}
                </div>
                <div className="flex items-baseline justify-between gap-1 mt-1">
                  <span className="font-semibold text-xs text-text-primary truncate">
                    {m.value === null ? "—" : <MeasureValue value={m.value} unit={m.unit} />}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-bold tabular-nums",
                      scoreTone(m.score),
                    )}
                  >
                    {m.score === null ? "" : `${Math.round(m.score)} pts`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer / Alerts & Direct Link */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60 text-xs">
        {actionableAlerts.length > 0 ? (
          <span className="text-[11px] font-medium text-warning flex items-center gap-1">
            <WarningIcon className="w-3.5 h-3.5 shrink-0" />
            {actionableAlerts.length} alert(s) in this area
          </span>
        ) : (
          <span className="text-[11px] text-text-muted">Operating smoothly</span>
        )}

        <button
          type="button"
          onClick={() => onOpenEvidence(evidence)}
          className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover font-medium cursor-pointer"
        >
          {EVIDENCE_LABEL[evidence]} →
        </button>
      </div>
    </div>
  );
}

function BranchDetailView({
  session,
  branchId,
  period,
  dateFrom,
  dateTo,
  onBack,
  onOpenEvidence,
  onViewBusinessAlerts,
}: {
  session: Session;
  branchId: string;
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  onBack: (() => void) | null;
  onOpenEvidence: (target: EvidenceTarget) => void;
  onViewBusinessAlerts: () => void;
}): React.JSX.Element {
  const { data: fetched, isRefreshing, failed, reload } = useUrlQuery<OverviewData>(
    dashboardUrl("overview", branchId, { period, dateFrom, dateTo }),
    session,
    "Branch health detail",
  );
  const data = fetched ?? null;

  if (data === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load branch health"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  const actionableAlerts = data.alerts.filter(
    (a) =>
      a.dimension !== "data_quality" &&
      ACTIONABLE_SEVERITIES.includes(a.severity),
  );

  return (
    <div className="flex flex-col gap-5">
      {/* Top Header Row with Back Button */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onBack}
              className="flex items-center gap-1.5 text-xs h-8"
            >
              <ChevronLeftIcon className="w-3.5 h-3.5" />
              All Branches
            </Button>
          )}
          <div>
            <h2 className="text-lg font-bold text-text-primary tracking-tight">
              {data.branch_name} Health Overview
            </h2>
            <p className="text-xs text-text-muted">
              {dateRangeLabel(data.date_from, data.date_to)} ·{" "}
              {previousPeriodLabel(period, dateFrom, dateTo)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {actionableAlerts.length > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onViewBusinessAlerts}
              className="text-xs text-brand hover:text-brand-hover h-8 px-3"
            >
              View in Business Alerts →
            </Button>
          )}
          <RefreshingHint show={isRefreshing} />
        </div>
      </div>

      {/* 5 Dimension Matrix Cards (2 grids per row) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.dimensions.map((dim) => (
          <DimensionMatrixCard
            key={dim.key}
            dimension={dim}
            alerts={data.alerts}
            onOpenEvidence={onOpenEvidence}
          />
        ))}
      </div>
    </div>
  );
}

// ========================================================================================
// 3. Main Exported Component
// ========================================================================================

interface Props {
  session: Session;
  isAdmin: boolean;
  branchOptions: BranchOption[];
  branchId: string;
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  canLoad: boolean;
  onOpenEvidence: (target: EvidenceTarget, branchId: string) => void;
  onViewBusinessAlerts: () => void;
  openBranchId: string | null;
  onOpenBranchChange: (branchId: string | null) => void;
}

export type { EvidenceTarget };

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
  onOpenBranchChange,
}: Props): React.JSX.Element {
  if (!canLoad && isAdmin && branchOptions.length === 0) return <></>;

  // When Admin is in All-Branches overview mode
  if (isAdmin && openBranchId === null) {
    return (
      <MultiBranchComparisonView
        session={session}
        branchOptions={branchOptions}
        period={period}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onOpen={onOpenBranchChange}
      />
    );
  }

  const shownBranchId = isAdmin ? (openBranchId as string) : branchId;
  return (
    <BranchDetailView
      session={session}
      branchId={shownBranchId}
      period={period}
      dateFrom={dateFrom}
      dateTo={dateTo}
      onBack={isAdmin ? () => onOpenBranchChange(null) : null}
      onOpenEvidence={(target) => onOpenEvidence(target, shownBranchId)}
      onViewBusinessAlerts={onViewBusinessAlerts}
    />
  );
}

export default OverviewTab;

