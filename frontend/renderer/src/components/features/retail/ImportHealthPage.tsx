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
import { CalendarIcon, HeartPulseIcon } from "@renderer/components/ui/icons";
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

function dataRangeLabel(
  earliest: string | null,
  latest: string | null,
): string | null {
  if (!earliest || !latest) return null;
  return `${earliest} → ${latest}`;
}

function hasAnyDataRange(freshness: FreshnessRow | null): boolean {
  return Boolean(
    dataRangeLabel(
      freshness?.sales_earliest_data_date ?? null,
      freshness?.sales_latest_data_date ?? null,
    ) ||
    dataRangeLabel(
      freshness?.inventory_earliest_data_date ?? null,
      freshness?.inventory_latest_data_date ?? null,
    ) ||
    dataRangeLabel(
      freshness?.purchase_earliest_data_date ?? null,
      freshness?.purchase_latest_data_date ?? null,
    ),
  );
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
    <>
      <CategoryTag category={category} />
      <span className="pl-2 text-left text-[11px] text-text-secondary">
        {range}
      </span>
    </>
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

function branchStatus(branch: MergedBranch): "error" | "warning" | "success" {
  if (branchNeedsAttention(branch)) return "error";
  if (branch.completeness && countIgnoredDays(branch.completeness) > 0) {
    return "warning";
  }
  return "success";
}

type IssueCategory = "Sales" | "Inventory" | "Purchase";

// Keep all import categories on the logo colour so a branch card stays calm and
// consistent; the category name carries the distinction without adding more colours.
const CATEGORY_TAG_STYLE: Record<IssueCategory, string> = {
  Sales: "bg-brand-subtle text-brand border border-brand/15",
  Inventory: "bg-brand-subtle text-brand border border-brand/15",
  Purchase: "bg-brand-subtle text-brand border border-brand/15",
};

function CategoryTag({
  category,
}: {
  category: IssueCategory;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "shrink-0 justify-self-start rounded px-1.5 py-0.5 text-left text-[10px] font-semibold uppercase tracking-wide",
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
    <div className="col-span-3 grid grid-cols-[subgrid] items-center gap-x-2 rounded-md bg-error-subtle/50 px-2.5 py-1.5">
      <CategoryTag category={category} />
      <span className="min-w-0 text-left text-xs text-warning">{text}</span>
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
    <div className="relative overflow-hidden rounded-lg border border-brand/20 bg-bg-base text-left shadow-xs">
      <div className="p-4">
        <div className="mb-3 flex items-start justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
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
        {hasAnyDataRange(freshness) && (
          <div className="mb-3 border-b border-border/60 pb-3">
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Data range
            </div>
            <div className="grid grid-cols-[max-content_1fr] items-center gap-y-1.5">
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
          </div>
        )}
        <div className="grid grid-cols-[max-content_minmax(0,1fr)_max-content] gap-y-1.5">
          {salesMissing > 0 && (
            <IssueRow
              category="Sales"
              text={`${salesMissing} missing sales day${salesMissing === 1 ? "" : "s"}`}
              actionLabel="Check missing"
              isActive={activePanel === "sales"}
              onClick={() => onOpenPanel(branch.branch_id, "sales")}
            />
          )}
          {inventoryMissing > 0 && (
            <IssueRow
              category="Inventory"
              text={`${inventoryMissing} missing inventory day${inventoryMissing === 1 ? "" : "s"}`}
              actionLabel="Check missing"
              isActive={activePanel === "inventory"}
              onClick={() => onOpenPanel(branch.branch_id, "inventory")}
            />
          )}
          {firstGap && (integrity?.missing_number_count ?? 0) > 0 && (
            <IssueRow
              category="Purchase"
              actionLabel="Check missing"
              isActive={activePanel === "purchase"}
              onClick={() => onOpenPanel(branch.branch_id, "purchase")}
              text={`${integrity.missing_number_count} missing purchase number${integrity.missing_number_count === 1 ? "" : "s"}`}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** A branch with no open import issue, shown as a compact status card. */
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
  const status = branchStatus(branch);
  const statusLabel =
    status === "warning" ? "Review ignored days" : "Up to date";
  return (
    <div className="relative overflow-hidden rounded-lg border border-brand/20 bg-bg-base text-left shadow-xs">
      <div className="p-4">
        <div className="mb-3 flex items-start justify-between gap-3 border-b border-border/60 pb-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-text-primary">
              {branch.branch_name}
            </h3>
            <Badge variant={status} dot>
              {statusLabel}
            </Badge>
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
        {hasAnyDataRange(freshness) && (
          <>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Data range
            </div>
            <div className="grid grid-cols-[max-content_1fr] items-center gap-y-1.5">
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
          </>
        )}
      </div>
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
          <div className="max-h-[calc(100vh-15rem)] overflow-y-auto p-3">
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {[...needingAttention, ...upToDate].map((branch) =>
                branchNeedsAttention(branch) ? (
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
                ) : (
                  <UpToDateRow
                    key={branch.branch_id}
                    branch={branch}
                    onOpenIgnored={() => openPanel(branch.branch_id, "ignored")}
                  />
                ),
              )}
            </div>
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
