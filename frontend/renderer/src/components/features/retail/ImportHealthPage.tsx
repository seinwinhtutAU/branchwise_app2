import { useMemo, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import { useStickyAbove } from "@renderer/lib/useStickyAbove";
import { invalidateEverything, useUrlQuery } from "@renderer/lib/queryClient";
import type { Profile } from "@renderer/components/features/types";
import { useToast } from "@renderer/lib/useToast";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import {
  CalendarIcon,
  CheckIcon,
  HeartPulseIcon,
} from "@renderer/components/ui/icons";
import {
  ImportHealthDrawer,
  type CompletenessBranch,
  type CompletenessResponse,
  type DrawerPanel,
  type ImportKind,
  type PurchaseNumberGap,
} from "@renderer/components/features/retail/ImportCompletenessControls";

interface PurchaseNumberIntegrity {
  numbered_purchase_count: number;
  gap_count: number;
  missing_number_count: number;
  gaps: PurchaseNumberGap[];
}

interface FreshnessRow {
  branch_id: string;
  branch_name: string;
  sales_last_imported_at: string | null;
  inventory_last_imported_at: string | null;
  purchase_last_imported_at: string | null;
  sales_data_date: string | null;
  inventory_data_date: string | null;
  sales_earliest_data_date: string | null;
  sales_latest_data_date: string | null;
  inventory_earliest_data_date: string | null;
  inventory_latest_data_date: string | null;
  purchase_earliest_data_date: string | null;
  purchase_latest_data_date: string | null;
  purchase_number_integrity?: PurchaseNumberIntegrity;
}

interface MergedBranch {
  branch_id: string;
  branch_name: string;
  freshness: FreshnessRow | null;
  completeness: CompletenessBranch | null;
}

interface Props {
  session: Session;
  profile: Profile | null;
}

const MANAGEMENT_ROLES = new Set(["development", "admin", "retail_management"]);

function mergeImportHealth(
  freshness: FreshnessRow[],
  completeness: CompletenessResponse,
): MergedBranch[] {
  const merged = new Map<string, MergedBranch>();

  for (const row of freshness) {
    merged.set(row.branch_id, {
      branch_id: row.branch_id,
      branch_name: row.branch_name,
      freshness: row,
      completeness: null,
    });
  }
  for (const branch of completeness.branches) {
    const current = merged.get(branch.branch_id);
    if (current) {
      current.completeness = branch;
    } else {
      merged.set(branch.branch_id, {
        branch_id: branch.branch_id,
        branch_name: branch.branch_name,
        freshness: null,
        completeness: branch,
      });
    }
  }
  return [...merged.values()];
}

function countIgnoredDays(branch: CompletenessBranch): number {
  return (
    branch.sales.days.filter((day) => day.status === "closed").length +
    branch.inventory.days.filter((day) => day.status === "closed").length
  );
}

function daysSinceDataDate(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  const dataDate = new Date(year, month - 1, day);
  const today = new Date();
  const currentDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.floor(
    (currentDate.getTime() - dataDate.getTime()) / (1000 * 60 * 60 * 24),
  );
}

// Plain "when was this last imported" — not an alert judgement, so no colour
// coding: a branch with no open days can still show "3 days ago" here if those
// days were ignored rather than actually imported, and that's a fact worth
// seeing, not a problem worth flagging.
function freshnessLabel(dataDate: string | null): string {
  if (!dataDate) return "No data yet";
  const days = daysSinceDataDate(dataDate);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function dataRangeLabel(
  earliest: string | null,
  latest: string | null,
): string | null {
  if (!earliest || !latest) return null;
  return `${earliest} → ${latest}`;
}

function DataRangeNote({
  category,
  earliest,
  latest,
}: {
  category: IssueCategory;
  earliest: string | null;
  latest: string | null;
}): React.JSX.Element | null {
  const range = dataRangeLabel(earliest, latest);
  if (!range) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px]">
      <CategoryTag category={category} />
      <span className="text-text-secondary">{range}</span>
    </span>
  );
}

/** One "Latest sales: Today" style fact, shown unconditionally next to
 * whatever it's about — freshness is a fact worth knowing regardless of
 * whether that same type also has an open-days problem below it. */
function FreshnessNote({
  label,
  value,
}: {
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <span className="text-[11px] text-text-muted">
      {label}:{" "}
      <span
        className={cn(
          "font-medium",
          value === "Today"
            ? "text-success"
            : value === "Yesterday"
              ? "text-warning"
              : "text-error",
        )}
      >
        {value}
      </span>
    </span>
  );
}

/**
 * Whether a branch needs a decision at all — the only question this page's summary
 * and grouping care about. A purchase file with no numbered purchases, or a sequence
 * with no gap, is not a problem to report; only an actual gap in the numbering is.
 */
function branchNeedsAttention(branch: MergedBranch): boolean {
  const salesMissing = branch.completeness?.sales.open_count ?? 0;
  const inventoryMissing = branch.completeness?.inventory.open_count ?? 0;
  const purchaseMissing =
    branch.freshness?.purchase_number_integrity?.missing_number_count ?? 0;
  return salesMissing > 0 || inventoryMissing > 0 || purchaseMissing > 0;
}

type IssueCategory = "Sales" | "Inventory" | "Purchase";

// The same Sales/Inventory/Purchase colours the Import tab's own file cards use
// (ImportConfirmModal's getFileIcon) — so a tag here points back to the same file
// type wherever else it's shown in the app, rather than inventing a second palette.
const CATEGORY_TAG_STYLE: Record<IssueCategory, string> = {
  Sales: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  Inventory: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  Purchase: "bg-pink-500/15 text-pink-600 dark:text-pink-400",
};

function CategoryTag({ category }: { category: IssueCategory }): React.JSX.Element {
  return (
    <span
      className={cn(
        "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        CATEGORY_TAG_STYLE[category],
      )}
    >
      {category}
    </span>
  );
}

/** One issue line inside a branch's card: which of Sales/Inventory/Purchase it's
 * about, what's wrong, and — when there's something this page can do about it — a
 * button straight to the relevant detail. A purchase gap opens its missing-number
 * list; fixing it still means re-importing the missing purchase file from the Import
 * tab, not picking dates. */
function IssueRow({
  category,
  text,
  actionLabel,
  isActive,
  onClick,
}: {
  category: IssueCategory;
  text: string;
  actionLabel?: string;
  isActive?: boolean;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-error-subtle/50 px-2.5 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <CategoryTag category={category} />
        <span className="text-xs text-text-primary">{text}</span>
      </div>
      {actionLabel && onClick && (
        <button
          type="button"
          onClick={onClick}
          aria-expanded={isActive}
          className={cn(
            "shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            isActive
              ? "border-brand bg-brand text-white"
              : "border-border text-brand hover:bg-brand-subtle",
          )}
        >
          {actionLabel} →
        </button>
      )}
    </div>
  );
}

/**
 * A branch that needs a decision, as a short list of plain-English issues rather than
 * a grid of every metric whether it needs looking at or not — a branch with nothing
 * wrong with its inventory data shouldn't take up the same visual space explaining
 * that as a branch with 60 days of sales missing.
 */
function NeedsAttentionCard({
  branch,
  activePanel,
  onOpenPanel,
}: {
  branch: MergedBranch;
  // Set only when the drawer is currently open on *this* branch — drives which
  // button (if any) shows the active state.
  activePanel: DrawerPanel | null;
  onOpenPanel: (branchId: string, panel: DrawerPanel) => void;
}): React.JSX.Element {
  const completeness = branch.completeness;
  const salesMissing = completeness?.sales.open_count ?? 0;
  const inventoryMissing = completeness?.inventory.open_count ?? 0;
  const integrity = branch.freshness?.purchase_number_integrity;
  const firstGap = integrity?.gaps[0];
  const ignoredCount = completeness ? countIgnoredDays(completeness) : 0;
  const freshness = branch.freshness;

  return (
    <div className="border-b border-border bg-bg-base p-3.5 last:border-b-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <h3 className="text-sm font-semibold text-text-primary">
            {branch.branch_name}
          </h3>
        </div>
        {ignoredCount > 0 && (
          <button
            type="button"
            onClick={() => onOpenPanel(branch.branch_id, "ignored")}
            className="shrink-0 text-[11px] text-text-muted hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
          >
            {ignoredCount} ignored
          </button>
        )}
      </div>
      {/* Freshness is shown unconditionally, whether or not that type also has
          an issue row below — "58 days behind" doesn't say whether that backlog
          is old-and-stuck or just started, and this is where that shows up. */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <FreshnessNote
          label="Latest sales"
          value={freshnessLabel(branch.freshness?.sales_data_date ?? null)}
        />
        <FreshnessNote
          label="Latest inventory"
          value={freshnessLabel(branch.freshness?.inventory_data_date ?? null)}
        />
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <DataRangeNote
          category="Sales"
          earliest={freshness?.sales_earliest_data_date ?? null}
          latest={freshness?.sales_latest_data_date ?? null}
        />
        <DataRangeNote
          category="Inventory"
          earliest={freshness?.inventory_earliest_data_date ?? null}
          latest={freshness?.inventory_latest_data_date ?? null}
        />
        <DataRangeNote
          category="Purchase"
          earliest={freshness?.purchase_earliest_data_date ?? null}
          latest={freshness?.purchase_latest_data_date ?? null}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        {salesMissing > 0 && (
          <IssueRow
            category="Sales"
            text={`${salesMissing} day${salesMissing === 1 ? "" : "s"} of sales data ${salesMissing === 1 ? "hasn't" : "haven't"} been imported yet.`}
            actionLabel="Fix"
            isActive={activePanel === "sales"}
            onClick={() => onOpenPanel(branch.branch_id, "sales")}
          />
        )}
        {inventoryMissing > 0 && (
          <IssueRow
            category="Inventory"
            text={`${inventoryMissing} day${inventoryMissing === 1 ? "" : "s"} of inventory counts ${inventoryMissing === 1 ? "hasn't" : "haven't"} been imported yet.`}
            actionLabel="Fix"
            isActive={activePanel === "inventory"}
            onClick={() => onOpenPanel(branch.branch_id, "inventory")}
          />
        )}
        {firstGap && (integrity?.missing_number_count ?? 0) > 0 && (
          <IssueRow
            category="Purchase"
            actionLabel="View"
            isActive={activePanel === "purchase"}
            onClick={() => onOpenPanel(branch.branch_id, "purchase")}
            text={`${integrity.missing_number_count} purchase number${integrity.missing_number_count === 1 ? "" : "s"} ${integrity.missing_number_count === 1 ? "is" : "are"} missing, between ${firstGap.start_number} and ${firstGap.end_number}.`}
          />
        )}
      </div>
    </div>
  );
}

/** A branch with nothing to do — named, not detailed. There's nothing here worth
 * spending a reader's attention on, so it gets one quiet line rather than a card. */
function UpToDateRow({
  branch,
  onOpenIgnored,
}: {
  branch: MergedBranch;
  onOpenIgnored: () => void;
}): React.JSX.Element {
  const ignoredCount = branch.completeness
    ? countIgnoredDays(branch.completeness)
    : 0;
  const freshness = branch.freshness;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border/60 px-3.5 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
          <span className="font-medium text-text-primary">
            {branch.branch_name}
          </span>
          <span className="text-text-muted">— up to date</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <DataRangeNote
            category="Sales"
            earliest={freshness?.sales_earliest_data_date ?? null}
            latest={freshness?.sales_latest_data_date ?? null}
          />
          <DataRangeNote
            category="Inventory"
            earliest={freshness?.inventory_earliest_data_date ?? null}
            latest={freshness?.inventory_latest_data_date ?? null}
          />
          <DataRangeNote
            category="Purchase"
            earliest={freshness?.purchase_earliest_data_date ?? null}
            latest={freshness?.purchase_latest_data_date ?? null}
          />
        </div>
        <FreshnessNote
          label="Latest sales"
          value={freshnessLabel(branch.freshness?.sales_data_date ?? null)}
        />
        <FreshnessNote
          label="Latest inventory"
          value={freshnessLabel(branch.freshness?.inventory_data_date ?? null)}
        />
      </div>
      {ignoredCount > 0 && (
        <button
          type="button"
          onClick={onOpenIgnored}
          className="shrink-0 text-[11px] text-text-muted hover:text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
        >
          {ignoredCount} ignored
        </button>
      )}
    </div>
  );
}

export default function ImportHealthPage({
  session,
  profile,
}: Props): React.JSX.Element {
  const { aboveRef, containerStyle } = useStickyAbove();
  const showToast = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  const [drawerTarget, setDrawerTarget] = useState<{
    branchId: string;
    panel: DrawerPanel;
  } | null>(null);
  const {
    data: fetchedFreshness,
    isRefreshing: isRefreshingFreshness,
    failed: freshnessFailed,
    reload: reloadFreshness,
  } = useUrlQuery<FreshnessRow[]>(
    `${apiBaseUrl}/api/imports/freshness`,
    session,
    "upload freshness",
  );
  const {
    data: fetchedCompleteness,
    isRefreshing: isRefreshingCompleteness,
    failed: completenessFailed,
    reload: reloadCompleteness,
  } = useUrlQuery<CompletenessResponse>(
    `${apiBaseUrl}/api/imports/completeness`,
    session,
    "missing-day check",
  );

  const isRefreshing = isRefreshingFreshness || isRefreshingCompleteness;
  const isLoading =
    fetchedFreshness === undefined || fetchedCompleteness === undefined;
  const failed =
    (freshnessFailed && fetchedFreshness === undefined) ||
    (completenessFailed && fetchedCompleteness === undefined);
  const branches = useMemo(
    () =>
      fetchedFreshness !== undefined && fetchedCompleteness !== undefined
        ? mergeImportHealth(fetchedFreshness, fetchedCompleteness)
        : [],
    [fetchedCompleteness, fetchedFreshness],
  );
  const canManage = MANAGEMENT_ROLES.has(profile?.role ?? "");
  // Re-derived from `branches` on every render (rather than captured once when the
  // drawer opens) so an ignore/restore inside it is reflected immediately without a
  // stale copy of the branch's completeness data.
  const drawerBranch = drawerTarget
    ? (branches.find((branch) => branch.branch_id === drawerTarget.branchId) ??
      null)
    : null;

  const needingAttention = useMemo(
    () => branches.filter(branchNeedsAttention),
    [branches],
  );
  const upToDate = useMemo(
    () => branches.filter((branch) => !branchNeedsAttention(branch)),
    [branches],
  );

  async function reloadAll(): Promise<void> {
    await Promise.all([reloadFreshness(), reloadCompleteness()]);
  }

  async function postActions(
    path: "close" | "reopen",
    branchId: string,
    importType: ImportKind,
    closureDates: string[],
    note?: string,
  ): Promise<void> {
    setIsUpdating(true);
    try {
      const results = await Promise.all(
        closureDates.map(async (closureDate) => {
          const response = await fetch(
            `${apiBaseUrl}/api/imports/completeness/${path}`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                branch_id: branchId,
                import_type: importType,
                closure_date: closureDate,
                ...(note !== undefined ? { note } : {}),
              }),
            },
          );
          return { response, body: await response.json().catch(() => null) };
        }),
      );
      const failedResult = results.find(({ response }) => !response.ok);
      if (failedResult !== undefined) {
        showToast(
          "error",
          failedResult.body?.detail ??
            `Request failed: ${failedResult.response.status}`,
        );
      } else {
        const action = path === "close" ? "Ignored" : "Restored";
        const dayLabel = closureDates.length === 1 ? "day" : "days";
        showToast("success", `${action} ${closureDates.length} ${dayLabel}.`);
      }
      invalidateEverything();
      await reloadCompleteness();
    } catch {
      showToast("error", "Request failed — is the backend running?");
    } finally {
      setIsUpdating(false);
    }
  }

  function handleIgnore(
    branchId: string,
    importType: ImportKind,
    dates: string[],
    note?: string,
  ): Promise<void> {
    return postActions("close", branchId, importType, dates, note);
  }

  function handleRestore(
    branchId: string,
    importType: ImportKind,
    dates: string[],
  ): Promise<void> {
    return postActions("reopen", branchId, importType, dates);
  }

  function openPanel(branchId: string, panel: DrawerPanel): void {
    setDrawerTarget((current) =>
      current?.branchId === branchId && current.panel === panel
        ? null
        : { branchId, panel },
    );
  }

  return (
    <div className="flex flex-col" style={containerStyle}>
      <div className="overflow-hidden rounded-md border border-border bg-bg-base shadow-xs">
        <div
          ref={aboveRef}
          className="sticky top-14 z-30 border-b border-border bg-bg-base px-4 py-2.5 lg:top-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="mr-1 text-base font-semibold tracking-tight text-text-primary">
                Import Health
              </h2>
              <span className="hidden text-xs text-text-muted sm:inline">
                Which branches are missing sales, inventory or purchase data.
              </span>
              {!isLoading &&
                !failed &&
                (needingAttention.length > 0 ? (
                  <Badge variant="error" dot>
                    {needingAttention.length} branch
                    {needingAttention.length === 1 ? "" : "es"} need attention
                  </Badge>
                ) : (
                  <Badge variant="success" dot>
                    All branches are up to date
                  </Badge>
                ))}
            </div>
            <RefreshButton onClick={reloadAll} refreshing={isRefreshing} />
          </div>
        </div>

        {isLoading && !failed && (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {failed && (
          <EmptyState
            icon={<HeartPulseIcon />}
            title="Couldn't load import health"
            description="Something went wrong reaching the backend."
            action={
              <Button variant="secondary" size="sm" onClick={reloadAll}>
                Try again
              </Button>
            }
          />
        )}

        {!isLoading && !failed && branches.length === 0 && (
          <EmptyState
            icon={<CalendarIcon />}
            title="No branches yet"
            description="Once a branch has an account and imports data, it'll show up here."
          />
        )}

        {!isLoading && !failed && branches.length > 0 && (
          <div className="max-h-[calc(100vh-15rem)] overflow-y-auto">
            {needingAttention.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <CheckIcon className="h-6 w-6 text-success" />
                <p className="text-sm font-medium text-text-primary">
                  Everything's imported.
                </p>
                <p className="text-xs text-text-muted">
                  No sales, inventory or purchase data is missing right now.
                </p>
              </div>
            ) : (
              needingAttention.map((branch) => (
                <NeedsAttentionCard
                  key={branch.branch_id}
                  branch={branch}
                  activePanel={
                    drawerTarget?.branchId === branch.branch_id
                      ? drawerTarget.panel
                      : null
                  }
                  onOpenPanel={openPanel}
                />
              ))
            )}

            {upToDate.length > 0 && (
              <div>
                {needingAttention.length > 0 && (
                  <div className="bg-bg-subtle px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                    Up to date
                  </div>
                )}
                {upToDate.map((branch) => (
                  <UpToDateRow
                    key={branch.branch_id}
                    branch={branch}
                    onOpenIgnored={() => openPanel(branch.branch_id, "ignored")}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <ImportHealthDrawer
        target={drawerTarget}
        branchName={drawerBranch?.branch_name ?? null}
        completeness={drawerBranch?.completeness ?? null}
        purchaseGaps={
          drawerBranch?.freshness?.purchase_number_integrity?.gaps ?? []
        }
        canManage={canManage}
        isUpdating={isUpdating}
        onIgnore={handleIgnore}
        onRestore={handleRestore}
        onClose={() => setDrawerTarget(null)}
      />
    </div>
  );
}
