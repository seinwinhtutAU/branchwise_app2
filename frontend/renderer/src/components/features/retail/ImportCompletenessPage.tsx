import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import type { Profile } from "@renderer/components/features/types";
import { useUrlQuery, invalidateEverything } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import { CalendarIcon } from "@renderer/components/ui/icons";

type ImportKind = "sales" | "inventory";

interface CompletenessDay {
  date: string;
  status: "open" | "closed";
  note: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
}

interface CompletenessTypeSection {
  days: CompletenessDay[];
  open_count: number;
}

interface CompletenessBranch {
  branch_id: string;
  branch_name: string;
  sales: CompletenessTypeSection;
  inventory: CompletenessTypeSection;
}

interface CompletenessResponse {
  checked_through: string;
  branches: CompletenessBranch[];
}

const MANAGEMENT_ROLES = new Set(["development", "admin", "retail_management"]);

interface Props {
  session: Session;
  profile: Profile | null;
}

type DayListMode = "missing" | "ignored";

function DaySection({
  title,
  branchId,
  importType,
  days,
  mode,
  canManage,
  onIgnore,
  onRestore,
  isUpdating,
}: {
  title: string;
  branchId: string;
  importType: ImportKind;
  days: CompletenessDay[];
  mode: DayListMode;
  canManage: boolean;
  onIgnore: (
    branchId: string,
    importType: ImportKind,
    dates: string[],
    note?: string,
  ) => Promise<void>;
  onRestore: (
    branchId: string,
    importType: ImportKind,
    dates: string[],
  ) => Promise<void>;
  isUpdating: boolean;
}): React.JSX.Element {
  const [selectedDates, setSelectedDates] = useState<Set<string>>(
    () => new Set(),
  );
  const [isConfirming, setIsConfirming] = useState(false);
  const [ignoreNote, setIgnoreNote] = useState("");
  const selected = days.filter((day) => selectedDates.has(day.date));
  const isIgnoreMode = mode === "missing";

  function toggleDate(date: string): void {
    setSelectedDates((current) => {
      const next = new Set(current);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });
  }

  async function confirmAction(): Promise<void> {
    const dates = selected.map((day) => day.date);
    if (isIgnoreMode) {
      await onIgnore(
        branchId,
        importType,
        dates,
        ignoreNote.trim() || undefined,
      );
    } else {
      await onRestore(branchId, importType, dates);
    }
    setSelectedDates(new Set());
    setIgnoreNote("");
    setIsConfirming(false);
  }

  if (days.length === 0) return <></>;

  return (
    <div className="flex-1 min-w-[240px]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-text-muted">{title}</div>
        {canManage && selected.length > 0 && !isConfirming && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-muted">
              {selected.length} selected
            </span>
            <Button
              variant={isIgnoreMode ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              loading={isUpdating}
              onClick={() => setIsConfirming(true)}
            >
              {isIgnoreMode
                ? `Ignore ${selected.length}`
                : `Restore ${selected.length}`}
            </Button>
          </div>
        )}
      </div>

      {isConfirming && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border bg-bg-surface p-2">
          <span className="text-xs font-medium text-text-primary">
            {isIgnoreMode
              ? `Ignore ${selected.length} selected day${selected.length === 1 ? "" : "s"}?`
              : `Restore ${selected.length} ignored day${selected.length === 1 ? "" : "s"}?`}
          </span>
          {isIgnoreMode && (
            <Input
              size="sm"
              value={ignoreNote}
              onChange={(event) => setIgnoreNote(event.target.value)}
              placeholder="Reason (optional)"
              className="w-40"
              disabled={isUpdating}
            />
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              disabled={isUpdating}
              onClick={() => setIsConfirming(false)}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2 text-xs"
              loading={isUpdating}
              onClick={() => void confirmAction()}
            >
              Confirm {isIgnoreMode ? "Ignore" : "Restore"}
            </Button>
          </div>
        </div>
      )}

      <div className="grid max-h-72 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
        {days.map((day) => (
          <label
            key={day.date}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-bg-base px-2.5 py-1.5"
          >
            {canManage && (
              <input
                type="checkbox"
                checked={selectedDates.has(day.date)}
                disabled={isUpdating || isConfirming}
                onChange={() => toggleDate(day.date)}
                className="h-3.5 w-3.5 shrink-0 accent-brand"
                aria-label={`Select ${day.date}`}
              />
            )}
            <span className="text-xs font-medium tabular-nums text-text-primary">
              {day.date}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function OverviewStat({
  title,
  section,
}: {
  title: string;
  section: CompletenessTypeSection;
}): React.JSX.Element {
  return (
    <div className="min-w-[180px] flex-1 rounded-md border border-border bg-bg-surface px-3 py-2">
      <div className="text-xs font-semibold text-text-muted">{title}</div>
      {section.open_count === 0 ? (
        <div className="mt-1 text-xs text-success">No missing days</div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge variant="error" dot>
            {section.open_count} missing
          </Badge>
        </div>
      )}
    </div>
  );
}

function BranchOverview({
  branch,
  canManage,
  isUpdating,
  onIgnore,
  onRestore,
}: {
  branch: CompletenessBranch;
  canManage: boolean;
  isUpdating: boolean;
  onIgnore: (
    branchId: string,
    importType: ImportKind,
    dates: string[],
    note?: string,
  ) => Promise<void>;
  onRestore: (
    branchId: string,
    importType: ImportKind,
    dates: string[],
  ) => Promise<void>;
}): React.JSX.Element {
  const [isExpanded, setIsExpanded] = useState(false);
  const openCount = branch.sales.open_count + branch.inventory.open_count;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-base shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold text-text-primary">
            {branch.branch_name}
          </div>
          {openCount > 0 && (
            <Badge variant="error" dot>
              {openCount} to check
            </Badge>
          )}
        </div>
        {openCount > 0 && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setIsExpanded((expanded) => !expanded)}
          >
            {isExpanded ? "Close overview" : "View overview"}
          </Button>
        )}
      </div>

      <div className="p-4">
        <div className="flex flex-wrap gap-2">
          <OverviewStat title="Sales" section={branch.sales} />
          <OverviewStat title="Inventory" section={branch.inventory} />
        </div>

        {isExpanded && (
          <div className="mt-4 border-t border-border pt-4">
            <div className="mb-3 text-xs text-text-muted">
              Select the dates to ignore.
            </div>
            <div className="flex flex-wrap gap-6">
              <DaySection
                title="Sales"
                branchId={branch.branch_id}
                importType="sales"
                days={branch.sales.days.filter((day) => day.status === "open")}
                mode="missing"
                canManage={canManage}
                onIgnore={onIgnore}
                onRestore={onRestore}
                isUpdating={isUpdating}
              />
              <DaySection
                title="Inventory"
                branchId={branch.branch_id}
                importType="inventory"
                days={branch.inventory.days.filter(
                  (day) => day.status === "open",
                )}
                mode="missing"
                canManage={canManage}
                onIgnore={onIgnore}
                onRestore={onRestore}
                isUpdating={isUpdating}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function IgnoreList({
  branches,
  canManage,
  isUpdating,
  onIgnore,
  onRestore,
}: {
  branches: CompletenessBranch[];
  canManage: boolean;
  isUpdating: boolean;
  onIgnore: (
    branchId: string,
    importType: ImportKind,
    dates: string[],
    note?: string,
  ) => Promise<void>;
  onRestore: (
    branchId: string,
    importType: ImportKind,
    dates: string[],
  ) => Promise<void>;
}): React.JSX.Element {
  const branchesWithIgnoredDays = branches.filter(
    (branch) =>
      branch.sales.days.some((day) => day.status === "closed") ||
      branch.inventory.days.some((day) => day.status === "closed"),
  );

  if (branchesWithIgnoredDays.length === 0) {
    return (
      <EmptyState
        icon={<CalendarIcon />}
        title="No ignored days"
        description="Ignored dates will appear here if you need to restore them later."
      />
    );
  }

  return (
    <div className="space-y-3 p-3">
      {branchesWithIgnoredDays.map((branch) => (
        <div
          key={branch.branch_id}
          className="overflow-hidden rounded-lg border border-border bg-bg-base shadow-xs"
        >
          <div className="border-b border-border bg-bg-surface px-4 py-3 text-sm font-semibold text-text-primary">
            {branch.branch_name}
          </div>
          <div className="flex flex-wrap gap-6 p-4">
            <DaySection
              title="Sales"
              branchId={branch.branch_id}
              importType="sales"
              days={branch.sales.days.filter((day) => day.status === "closed")}
              mode="ignored"
              canManage={canManage}
              onIgnore={onIgnore}
              onRestore={onRestore}
              isUpdating={isUpdating}
            />
            <DaySection
              title="Inventory"
              branchId={branch.branch_id}
              importType="inventory"
              days={branch.inventory.days.filter(
                (day) => day.status === "closed",
              )}
              mode="ignored"
              canManage={canManage}
              onIgnore={onIgnore}
              onRestore={onRestore}
              isUpdating={isUpdating}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ImportCompletenessPage({
  session,
  profile,
}: Props): React.JSX.Element {
  const showToast = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  const [view, setView] = useState<"missing" | "ignored">("missing");
  const {
    data: fetchedCompleteness,
    isRefreshing,
    failed,
    reload,
  } = useUrlQuery<CompletenessResponse>(
    `${apiBaseUrl}/api/imports/completeness`,
    session,
    "missing-day check",
  );
  const completeness = fetchedCompleteness ?? null;
  const canManage = MANAGEMENT_ROLES.has(profile?.role ?? "");
  const ignoredCount =
    completeness?.branches.reduce(
      (count, branch) =>
        count +
        branch.sales.days.filter((day) => day.status === "closed").length +
        branch.inventory.days.filter((day) => day.status === "closed").length,
      0,
    ) ?? 0;

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
      await reload();
    } catch {
      showToast("error", "Request failed — is the backend running?");
    } finally {
      setIsUpdating(false);
    }
  }

  function handleClose(
    branchId: string,
    importType: ImportKind,
    dates: string[],
    note?: string,
  ): Promise<void> {
    return postActions("close", branchId, importType, dates, note);
  }

  function handleReopen(
    branchId: string,
    importType: ImportKind,
    dates: string[],
  ): Promise<void> {
    return postActions("reopen", branchId, importType, dates);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-bg-base border border-border rounded-md overflow-hidden shadow-xs">
        <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
              {view === "missing" ? "Missing Days" : "Ignore List"}
            </h2>
            <span className="text-xs text-text-muted hidden sm:inline">
              {view === "missing"
                ? "Days with no Sale or Inventory data at all."
                : "Restore an ignored date only when it needs attention again."}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant={view === "missing" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setView("missing")}
            >
              Missing
            </Button>
            <Button
              variant={view === "ignored" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setView("ignored")}
            >
              Ignore list{ignoredCount > 0 ? ` (${ignoredCount})` : ""}
            </Button>
            <RefreshButton onClick={reload} refreshing={isRefreshing} />
          </div>
        </div>

        {completeness === null && !failed && (
          <div className="p-4 flex flex-col gap-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {completeness === null && failed && (
          <EmptyState
            icon={<CalendarIcon />}
            title="Couldn't load the missing-day check"
            description="Something went wrong reaching the backend."
            action={
              <Button variant="secondary" size="sm" onClick={reload}>
                Try again
              </Button>
            }
          />
        )}

        {completeness !== null && completeness.branches.length === 0 && (
          <EmptyState
            icon={<CalendarIcon />}
            title="No branches yet"
            description="Once a branch has an account and imports data, it'll show up here."
          />
        )}

        {completeness !== null && completeness.branches.length > 0 && (
          <>
            {view === "missing" ? (
              <div className="space-y-3 p-3">
                {completeness.branches.map((branch) => (
                  <BranchOverview
                    key={branch.branch_id}
                    branch={branch}
                    canManage={canManage}
                    isUpdating={isUpdating}
                    onIgnore={handleClose}
                    onRestore={handleReopen}
                  />
                ))}
              </div>
            ) : (
              <IgnoreList
                branches={completeness.branches}
                canManage={canManage}
                isUpdating={isUpdating}
                onIgnore={handleClose}
                onRestore={handleReopen}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default ImportCompletenessPage;
