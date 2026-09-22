import { useEffect, useState } from "react";
import { FloatingPortal } from "@floating-ui/react";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { CloseIcon } from "@renderer/components/ui/icons";

export type ImportKind = "sales" | "inventory";

export interface CompletenessDay {
  date: string;
  status: "open" | "closed";
  note: string | null;
  closed_at: string | null;
  closed_by_name: string | null;
}

export interface CompletenessTypeSection {
  days: CompletenessDay[];
  open_count: number;
}

export interface CompletenessBranch {
  branch_id: string;
  branch_name: string;
  sales: CompletenessTypeSection;
  inventory: CompletenessTypeSection;
}

export interface CompletenessResponse {
  checked_through: string;
  branches: CompletenessBranch[];
}

export type DayListMode = "missing" | "ignored";

export interface DaySectionActions {
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
}

export interface DaySectionProps extends DaySectionActions {
  title: string;
  branchId: string;
  importType: ImportKind;
  days: CompletenessDay[];
  mode: DayListMode;
  canManage: boolean;
  isUpdating: boolean;
}

export function DaySection({
  title,
  branchId,
  importType,
  days,
  mode,
  canManage,
  onIgnore,
  onRestore,
  isUpdating,
}: DaySectionProps): React.JSX.Element {
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
    <div className="min-w-0 flex-1">
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

/** Which branch/panel the Import Health drawer is open on, or closed when null. */
export type DrawerPanel = "sales" | "inventory" | "ignored";

export interface ImportHealthDrawerTarget {
  branchId: string;
  panel: DrawerPanel;
}

interface ImportHealthDrawerProps extends DaySectionActions {
  target: ImportHealthDrawerTarget | null;
  branchName: string | null;
  completeness: CompletenessBranch | null;
  canManage: boolean;
  isUpdating: boolean;
  onClose: () => void;
}

/**
 * The missing/ignored-day detail for one branch, as a slide-over rather than an
 * inline expansion — resolving a branch's open days used to push every row beneath
 * it down the page, which meant the table you were scanning kept jumping around as
 * you worked through branches. A drawer keeps the table still.
 */
export function ImportHealthDrawer({
  target,
  branchName,
  completeness,
  canManage,
  isUpdating,
  onIgnore,
  onRestore,
  onClose,
}: ImportHealthDrawerProps): React.JSX.Element | null {
  const isOpen = target !== null && completeness !== null;

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !target || !completeness) return null;

  const panelLabel =
    target.panel === "ignored"
      ? "Dates you've chosen to skip"
      : target.panel === "sales"
        ? "Sales days to import"
        : "Inventory days to import";

  return (
    <FloatingPortal>
      {/* An invisible click-catcher, not a dimmed backdrop — the page behind stays
          exactly as it was, so switching branches or re-checking a figure never
          means closing the drawer first. Clicking it (or Escape) still closes. */}
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <aside
        aria-label="Import health details"
        className="animate-slide-in-right fixed top-0 right-0 z-50 flex h-full w-full flex-col border-l border-border bg-bg-base shadow-2xl sm:w-[26rem]"
      >
        <div className="flex items-center justify-between border-b border-border bg-bg-subtle px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold text-text-primary">
              {branchName}
            </h2>
            <p className="text-xs text-text-muted">{panelLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close (Esc)"
            className="flex h-7 w-7 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {target.panel === "ignored" ? (
            <div className="flex flex-col gap-5">
              <p className="text-xs text-text-muted">
                These dates were marked as not needing an import. Tick one and
                restore it if you do need to bring it back.
              </p>
              <DaySection
                title="Sales"
                branchId={target.branchId}
                importType="sales"
                days={completeness.sales.days.filter(
                  (day) => day.status === "closed",
                )}
                mode="ignored"
                canManage={canManage}
                onIgnore={onIgnore}
                onRestore={onRestore}
                isUpdating={isUpdating}
              />
              <DaySection
                title="Inventory"
                branchId={target.branchId}
                importType="inventory"
                days={completeness.inventory.days.filter(
                  (day) => day.status === "closed",
                )}
                mode="ignored"
                canManage={canManage}
                onIgnore={onIgnore}
                onRestore={onRestore}
                isUpdating={isUpdating}
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-xs text-text-muted">
                These days are still missing a file. If a day genuinely has no
                data, tick it and choose Ignore instead of leaving it open.
              </p>
              <DaySection
                title={target.panel === "sales" ? "Sales" : "Inventory"}
                branchId={target.branchId}
                importType={target.panel}
                days={(target.panel === "sales"
                  ? completeness.sales
                  : completeness.inventory
                ).days.filter((day) => day.status === "open")}
                mode="missing"
                canManage={canManage}
                onIgnore={onIgnore}
                onRestore={onRestore}
                isUpdating={isUpdating}
              />
            </div>
          )}
        </div>
      </aside>
    </FloatingPortal>
  );
}
