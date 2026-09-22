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

function DaySection({
  title,
  branchId,
  importType,
  section,
  canManage,
  onClose,
  onReopen,
  pendingDate,
}: {
  title: string;
  branchId: string;
  importType: ImportKind;
  section: CompletenessTypeSection;
  canManage: boolean;
  onClose: (branchId: string, importType: ImportKind, date: string) => void;
  onReopen: (branchId: string, importType: ImportKind, date: string) => void;
  pendingDate: string | null;
}): React.JSX.Element {
  if (section.days.length === 0) {
    return (
      <div className="flex-1 min-w-[240px]">
        <div className="text-xs font-semibold text-text-muted mb-1.5">{title}</div>
        <div className="text-xs text-success flex items-center gap-1.5">
          <Badge variant="success" dot>
            No missing days
          </Badge>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-[240px]">
      <div className="text-xs font-semibold text-text-muted mb-1.5 flex items-center gap-1.5">
        {title}
        {section.open_count > 0 && (
          <Badge variant="error" dot>
            {section.open_count} to check
          </Badge>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        {section.days.map((day) => {
          const isPending = pendingDate === `${branchId}:${importType}:${day.date}`;
          return (
            <div
              key={day.date}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-bg-base px-2.5 py-1.5"
            >
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-medium text-text-primary tabular-nums">
                  {day.date}
                </span>
                {day.status === "closed" ? (
                  <span className="text-[11px] text-text-muted truncate">
                    Closed{day.closed_by_name ? ` by ${day.closed_by_name}` : ""}
                    {day.note ? ` — ${day.note}` : ""}
                  </span>
                ) : (
                  <span className="text-[11px] text-error">No data — closed, or forgotten?</span>
                )}
              </div>
              {canManage &&
                (day.status === "open" ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="shrink-0 h-7 px-2 text-xs"
                    loading={isPending}
                    onClick={() => onClose(branchId, importType, day.date)}
                  >
                    Mark closed
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 h-7 px-2 text-xs"
                    loading={isPending}
                    onClick={() => onReopen(branchId, importType, day.date)}
                  >
                    Reopen
                  </Button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ImportCompletenessPage({ session, profile }: Props): React.JSX.Element {
  const showToast = useToast();
  const [pendingDate, setPendingDate] = useState<string | null>(null);
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

  async function postAction(
    path: "close" | "reopen",
    branchId: string,
    importType: ImportKind,
    closureDate: string,
    note?: string,
  ): Promise<void> {
    const key = `${branchId}:${importType}:${closureDate}`;
    setPendingDate(key);
    try {
      const response = await fetch(`${apiBaseUrl}/api/imports/completeness/${path}`, {
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
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        showToast("error", body?.detail ?? `Request failed: ${response.status}`);
        return;
      }
      invalidateEverything();
      await reload();
    } catch {
      showToast("error", "Request failed — is the backend running?");
    } finally {
      setPendingDate(null);
    }
  }

  function handleClose(branchId: string, importType: ImportKind, date: string): void {
    const note = window.prompt("Why was this day closed? (optional)");
    if (note === null) return; // cancelled
    void postAction("close", branchId, importType, date, note.trim() || undefined);
  }

  function handleReopen(branchId: string, importType: ImportKind, date: string): void {
    if (!window.confirm("Reopen this day? It will show as needing a check again.")) return;
    void postAction("reopen", branchId, importType, date);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-bg-base border border-border rounded-md overflow-hidden shadow-xs">
        <div className="px-4 py-2.5 border-b border-border flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
              Missing Days
            </h2>
            <span className="text-xs text-text-muted hidden sm:inline">
              Days with no Sale or Inventory data at all — the branch may have been
              closed, or the file may never have been imported.
            </span>
          </div>
          <RefreshButton onClick={reload} refreshing={isRefreshing} />
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
          <div className="divide-y divide-border">
            {completeness.branches.map((branch) => (
              <div key={branch.branch_id} className="p-4">
                <div className="text-sm font-semibold text-text-primary mb-2.5">
                  {branch.branch_name}
                </div>
                <div className="flex flex-wrap gap-6">
                  <DaySection
                    title="Sales"
                    branchId={branch.branch_id}
                    importType="sales"
                    section={branch.sales}
                    canManage={canManage}
                    onClose={handleClose}
                    onReopen={handleReopen}
                    pendingDate={pendingDate}
                  />
                  <DaySection
                    title="Inventory"
                    branchId={branch.branch_id}
                    importType="inventory"
                    section={branch.inventory}
                    canManage={canManage}
                    onClose={handleClose}
                    onReopen={handleReopen}
                    pendingDate={pendingDate}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ImportCompletenessPage;
