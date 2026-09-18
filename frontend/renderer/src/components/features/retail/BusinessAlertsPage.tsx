import { Fragment, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import { useUrlQueries } from "@renderer/lib/queryClient";
import type { BranchOption } from "@renderer/lib/useBranches";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Select } from "@renderer/components/ui/Select";
import { Skeleton } from "@renderer/components/ui/Skeleton";
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
  WarningIcon,
} from "@renderer/components/ui/icons";
import {
  AlertExplanation,
  PeriodControls,
} from "@renderer/components/features/dashboard/shared";
import { usePeriodRange } from "@renderer/components/features/dashboard/usePeriodRange";
import {
  ACTIONABLE_SEVERITIES,
  SEVERITY_META,
  STATUS_META,
  dashboardUrl,
  type AlertSeverity,
  type EvidenceTarget,
  type HealthAlert,
  type HealthStatus,
  type OverviewData,
} from "@renderer/components/features/dashboard/helpers";
import type { Profile } from "@renderer/components/features/types";

// Every business warning the Early Warning engine raised, for every retail branch, in one
// table — the "what needs my attention today" page, as opposed to the Dashboard's
// Overview, which answers "how is this branch doing".
//
// Its own nav section rather than a Dashboard tab: a manager should be able to open it
// directly. It sits beside Dashboard rather than beside Warning even though both list
// things that are wrong — this one is the business going wrong, Warning is the imported
// data being wrong.
//
// Alerts come at three severities. Critical and warning ask for a decision and are what
// every count in the app counts; `normal` is the drift that asks for nothing today (see
// app/services/early_warning.py) and appears only as a row here, so the list can show a
// branch's whole picture without inflating the number beside the nav item.
//
// A branch with nothing wrong still appears, as a tile in the strip above the table
// carrying its health score and status band. Without it the page is a list of problems in
// which a healthy branch is simply absent, and "not listed" reads as "not loaded" rather
// than "nothing to act on" — the one question a list of problems can never answer is
// "who is fine?".
//
// Data-quality alerts are deliberately excluded. The Warning page already lists those row
// by row with the tools to fix them, so a summary of them here would split one job across
// two screens.
//
// It issues no requests of its own: it reads the same per-branch overview payloads the
// Dashboard's branch cards fetch, through the shared cache (see lib/queryClient.ts).

const EXCLUDED_DIMENSION = "data_quality";
const COLUMN_COUNT = 5;

const CATEGORY_LABEL: Record<string, string> = {
  sales: "Sales",
  profit: "Profit",
  inventory: "Inventory",
  customer: "Customer",
};

const CATEGORY_ORDER = ["sales", "profit", "inventory", "customer"];

// Worst first. `normal` alerts sit at the end of a branch's rows: they are the notices
// that ask for nothing today, so they must never push a decision off the top of the list.
const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  normal: 2,
};

interface BranchAlert extends HealthAlert {
  branchId: string;
  branchName: string;
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-8 px-3 rounded-full text-sm font-medium border transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
        active
          ? "bg-brand-subtle text-brand border-border-brand"
          : "bg-bg-base text-text-secondary border-border hover:border-border-strong",
      )}
    >
      {label} <span className="tabular-nums text-text-muted">{count}</span>
    </button>
  );
}

/**
 * One alert as a table row, plus its expanded detail row — the same shape the Warning
 * page uses (severity badge, a Details toggle in the last column, an expanded row
 * spanning every column), so the app's two lists of "things that are wrong" read the same
 * way even though one is about the business and the other about the data.
 */
function AlertRow({
  alert,
  onOpenEvidence,
}: {
  alert: BranchAlert;
  onOpenEvidence: (target: EvidenceTarget, branchId: string) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const meta = SEVERITY_META[alert.severity];

  return (
    <>
      <Tr>
        <Td>
          <Badge variant={meta.badge}>{meta.label}</Badge>
        </Td>
        <Td className="whitespace-nowrap text-text-muted">
          {CATEGORY_LABEL[alert.dimension]}
        </Td>
        <Td className="font-medium text-text-primary">{alert.title}</Td>
        <Td className={cn("font-medium", meta.text)}>{alert.summary}</Td>
        <Td>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand-hover"
          >
            Details
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
          {/* Same white as the rows above it, so the panel reads as part of the list
              rather than as a grey box dropped into it — the row's own borders are all
              the separation it needs. */}
          <Td colSpan={COLUMN_COUNT} className="bg-bg-base">
            <div className="py-1">
              <AlertExplanation
                alert={alert}
                onOpenEvidence={(target) =>
                  onOpenEvidence(target, alert.branchId)
                }
              />
            </div>
          </Td>
        </Tr>
      )}
    </>
  );
}

/**
 * The row a branch gets when it raised nothing at all.
 *
 * Without it a clean branch is simply missing from the table, and a reader cannot tell
 * "nothing wrong" from "not loaded" or "filtered out". It is only shown when no category
 * chip is active: under a chip, "everything normal" would be a claim about one category
 * dressed up as a claim about the branch.
 */
function AllClearRow(): React.JSX.Element {
  return (
    <Tr>
      <Td>
        <Badge variant={SEVERITY_META.normal.badge}>
          {SEVERITY_META.normal.label}
        </Badge>
      </Td>
      <Td className="text-text-muted">—</Td>
      <Td className="font-medium text-text-primary">
        Everything normal this period
      </Td>
      <Td className="text-text-muted">
        No sales, profit, inventory or customer problems found.
      </Td>
      <Td />
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
        className="bg-brand-subtle px-4 py-2 border-b border-border"
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium text-text-primary">{name}</span>
          {count > 0 && <Badge>{count}</Badge>}
        </div>
      </td>
    </tr>
  );
}

/** One branch's standing on this page, whether or not it raised anything. */
interface BranchStatus {
  branchId: string;
  branchName: string;
  score: number | null;
  status: HealthStatus | null;
  alertCount: number;
  hasCritical: boolean;
}

/**
 * A branch as a tile: its health score, the band that score falls in, and how many alerts
 * it has here — so the branches with none are visible instead of missing.
 *
 * The score and the band come from the same payload the Dashboard's Overview reads, so
 * "Healthy" here is the same judgement, in the same words and the same green, as there.
 * The count is the branch's whole alert count on this page, not the count under the
 * category chips: the tile describes the branch, and the chips describe the filter.
 *
 * Clicking one filters the table to that branch (and again clears it), sharing its state
 * with the Branch selector, so a healthy tile is a control rather than decoration.
 */
function BranchStatusTile({
  branch,
  active,
  onClick,
}: {
  branch: BranchStatus;
  active: boolean;
  onClick: () => void;
}): React.JSX.Element {
  const meta = branch.status ? STATUS_META[branch.status] : null;

  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 min-w-[11rem] px-3 py-2 rounded-lg border text-left transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
        active
          ? "bg-brand-subtle border-border-brand"
          : "bg-bg-base border-border hover:border-border-strong",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-text-primary">
          {branch.branchName}
        </span>
        <Badge variant={meta?.badge ?? "default"}>
          {meta?.label ?? "Not scored"}
        </Badge>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={cn(
            "text-xl font-semibold tabular-nums",
            meta?.text ?? "text-text-muted",
          )}
        >
          {branch.score === null ? "\u2013" : Math.round(branch.score)}
        </span>
        <span className="text-xs text-text-muted">
          {branch.alertCount === 0
            ? "nothing to act on"
            : `${branch.alertCount} alert${branch.alertCount === 1 ? "" : "s"}`}
        </span>
      </div>
    </button>
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
  // Admin has no fixed branch — same convention as everywhere else in the app.
  const isAdmin = profile !== null && profile.branch_id === null;
  const range = usePeriodRange("30d");
  const [branchFilter, setBranchFilter] = useState("");
  const [category, setCategory] = useState("");

  // Admin reads every retail branch; a branch account reads only its own.
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
  const allAlerts: BranchAlert[] = branches
    .flatMap((branch) =>
      branch.alerts
        .filter((alert) => alert.dimension !== EXCLUDED_DIMENSION)
        .map((alert) => ({
          ...alert,
          branchId: branch.branch_id,
          branchName: branch.branch_name,
        })),
    )
    // Critical first, then by category so the same kind of problem reads together, then by
    // branch — a stable order, so nothing jumps around between refreshes.
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        CATEGORY_ORDER.indexOf(a.dimension) -
          CATEGORY_ORDER.indexOf(b.dimension) ||
        a.branchName.localeCompare(b.branchName),
    );

  // Each chip counts what it would show given the branch filter, so a chip's number always
  // matches what clicking it produces.
  const inBranch = allAlerts.filter(
    (alert) => !branchFilter || alert.branchId === branchFilter,
  );
  const shown = inBranch.filter(
    (alert) => !category || alert.dimension === category,
  );

  // Every branch, including the ones that raised nothing — ordered the same way the table
  // is, worst first, so the strip and the list below it read in the same direction and a
  // healthy branch sits at the end rather than in the middle.
  const branchStatuses: BranchStatus[] = branches
    .map((branch) => {
      // What the tile counts is what needs a decision — the same rule the nav badge and
      // the Dashboard's branch cards follow. A branch whose only rows are `normal`
      // notices reads as "nothing to act on", which is exactly what it is.
      const branchAlerts = allAlerts.filter(
        (alert) =>
          alert.branchId === branch.branch_id &&
          ACTIONABLE_SEVERITIES.includes(alert.severity),
      );
      return {
        branchId: branch.branch_id,
        branchName: branch.branch_name,
        score: branch.overall_score,
        status: branch.status,
        alertCount: branchAlerts.length,
        hasCritical: branchAlerts.some(
          (alert) => alert.severity === "critical",
        ),
      };
    })
    .sort(
      (a, b) =>
        Number(b.hasCritical) - Number(a.hasCritical) ||
        b.alertCount - a.alertCount ||
        // An unscored branch sorts last rather than as a 0, for the same reason a score
        // that could not be measured is never reported as 0.
        (a.score ?? 101) - (b.score ?? 101) ||
        a.branchName.localeCompare(b.branchName),
    );

  // Branch order follows the worst alert each one has, so the branch needing attention
  // first is at the top — same principle as the row order inside a group.
  const groups = branches
    .filter((branch) => !branchFilter || branch.branch_id === branchFilter)
    .map((branch) => {
      const groupAlerts = shown.filter(
        (alert) => alert.branchId === branch.branch_id,
      );
      return {
        branchId: branch.branch_id,
        branchName: branch.branch_name,
        alerts: groupAlerts,
        // Only a branch that raised nothing whatsoever gets the all-clear row, and only
        // with no category chip active — under a chip it would be a claim about one
        // category worded as a claim about the branch.
        allClear:
          !category &&
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

  return (
    <div className="flex flex-col">
      <CardHeader
        title="Business Alerts"
        description="How every retail branch is doing, and the sales, profit, inventory and customer problems found in this period."
        action={
          <RefreshButton
            onClick={reload}
            refreshing={isRefreshing}
          />
        }
      />

      {/* Every control in one row under the header, same as the Sale/Inventory/Data
          Overview pages, so the page furniture is where a reader already expects it. */}
      <div className="flex flex-wrap items-end gap-3 pb-4 -mt-1">
        <PeriodControls range={range} />
        {branches.length > 1 && (
          <div className="w-48">
            <Select
              label="Branch"
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
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
      </div>

      {isAdmin && branchOptions.length === 0 ? (
        <p className="text-sm text-text-muted">
          Add a retail branch before there is anything to check.
        </p>
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
          <div className="flex flex-wrap gap-2">
            {branchStatuses.map((branch) => (
              <BranchStatusTile
                key={branch.branchId}
                branch={branch}
                active={branchFilter === branch.branchId}
                onClick={() =>
                  setBranchFilter(
                    branchFilter === branch.branchId ? "" : branch.branchId,
                  )
                }
              />
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <FilterChip
              label="All"
              count={inBranch.length}
              active={!category}
              onClick={() => setCategory("")}
            />
            {CATEGORY_ORDER.map((key) => (
              <FilterChip
                key={key}
                label={CATEGORY_LABEL[key]}
                count={
                  inBranch.filter((alert) => alert.dimension === key).length
                }
                active={category === key}
                onClick={() => setCategory(category === key ? "" : key)}
              />
            ))}
          </div>

          {failedCount > 0 && (
            <p className="text-sm text-warning">
              {failedCount} branch{failedCount === 1 ? "" : "es"} couldn&apos;t
              be loaded, so this list may be incomplete.
            </p>
          )}

          {groups.length === 0 ? (
            <Card>
              <p className="text-sm text-text-secondary">
                No alerts match these filters.
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
                    <BranchHeaderRow
                      name={group.branchName}
                      count={group.alerts.length}
                    />
                    {group.allClear ? (
                      <AllClearRow />
                    ) : (
                      group.alerts.map((alert) => (
                        <AlertRow
                          key={`${alert.branchId}:${alert.id}`}
                          alert={alert}
                          onOpenEvidence={onOpenEvidence}
                        />
                      ))
                    )}
                  </Fragment>
                ))}
              </Tbody>
            </TableContainer>
          )}
        </div>
      )}
    </div>
  );
}

export default BusinessAlertsPage;
