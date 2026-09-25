import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import { useUrlQueries } from "@renderer/lib/queryClient";
import type { BranchOption } from "@renderer/lib/useBranches";
import { Badge, type BadgeVariant } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { EmptyState } from "@renderer/components/ui/EmptyState";
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
import { useToast } from "@renderer/lib/useToast";
import { useImportFilePicker } from "@renderer/lib/useImportFilePicker";
import { downloadExcel } from "@renderer/lib/excel";
import {
  CheckIcon,
  CloseIcon,
  WarningIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  UploadIcon,
  DownloadIcon,
} from "@renderer/components/ui/icons";
import { AlertFacts } from "@renderer/components/features/dashboard/shared";
import {
  SEVERITY_META,
  dashboardUrl,
  type AlertSeverity,
  type HealthAlert,
  type OverviewData,
} from "@renderer/components/features/dashboard/helpers";
import type {
  PendingImport,
  Profile,
} from "@renderer/components/features/types";

type Tab =
  "all" | "sales" | "inventory" | "reorder" | "customer" | "data_quality";
type SeverityFilter = "all" | AlertSeverity;

const CATEGORY_LABEL: Record<string, string> = {
  sales: "Sales",
  inventory: "Inventory",
  reorder: "Reorder",
  customer: "Customer",
  data_quality: "Data quality",
};

const CATEGORY_META: Record<
  string,
  { label: string; variant: BadgeVariant; className: string }
> = {
  sales: {
    label: "Sales",
    variant: "brand",
    className: "bg-brand-subtle text-brand border-brand/20",
  },
  inventory: {
    label: "Inventory",
    variant: "brand",
    className: "bg-brand-subtle text-brand border-brand/20",
  },
  reorder: {
    label: "Reorder",
    variant: "brand",
    className: "bg-brand-subtle text-brand border-brand/20",
  },
  customer: {
    label: "Customer",
    variant: "brand",
    className: "bg-brand-subtle text-brand border-brand/20",
  },
  data_quality: {
    label: "Data quality",
    variant: "brand",
    className: "bg-brand-subtle text-brand border-brand/20",
  },
};

const CATEGORY_ORDER = [
  "sales",
  "inventory",
  "reorder",
  "customer",
  "data_quality",
] as const;

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warning: 1,
  normal: 2,
};

interface BranchAlert extends HealthAlert {
  branchId: string;
  branchName: string;
}

const alertKey = (alert: BranchAlert): string =>
  `${alert.branchId}:${alert.id}`;

/** One alert in the master list — compact row. */
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
      id={`alert-row-${alertKey(alert)}`}
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
          <Badge
            variant={CATEGORY_META[alert.dimension]?.variant ?? "default"}
            className={cn(
              "text-[10px] px-1.5 py-0",
              CATEGORY_META[alert.dimension]?.className,
            )}
          >
            {CATEGORY_META[alert.dimension]?.label ??
              CATEGORY_LABEL[alert.dimension] ??
              alert.dimension}
          </Badge>
        </div>
        <div className="text-xs font-medium mt-0.5 truncate text-text-primary">
          {alert.title}
        </div>
      </div>
    </button>
  );
}

/** The branch name header in master list. */
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
        <span className="text-[11px] text-text-muted shrink-0">All clear</span>
      )}
    </div>
  );
}

function getSection4Title(alert: BranchAlert): string {
  if (alert.id === "urgent_reorder") {
    return "Suggested products to reorder";
  }
  if (alert.id === "stock_allocation") {
    return "Suggested products to transfer";
  }
  if (alert.id === "physical_stock_audit") {
    return "Products requiring count";
  }
  if (alert.id === "footwear_aging") {
    return "Aged products to review";
  }
  if (alert.id === "seasonal_demand_spike") {
    return "Upcoming demand surge products";
  }
  if (alert.id === "sale_data_quality") {
    return "Sales records to fix";
  }
  if (alert.id === "purchase_data_quality") {
    return "Purchase records to fix";
  }
  if (alert.id === "purchase_number_sequence_gap") {
    const total = alert.table?.total_count;
    return total !== undefined
      ? `Missing purchase numbers (${total})`
      : "Missing purchase numbers";
  }
  if (alert.id === "weekly_pattern_demand") {
    return "Sales pattern";
  }
  return "Supporting Info";
}

/**
 * Standard 4-section Alert Inspector:
 * 1. Title
 * 2. Description
 * 3. Recommended actions
 * 4. Supporting info / item breakdown (capped to prevent data overload)
 */
function AlertInspector({
  alert,
  showBranch,
  currentIndex,
  totalCount,
  onNavigate,
  session,
  onFileReady,
  onReloadAlerts,
}: {
  alert: BranchAlert;
  showBranch: boolean;
  currentIndex: number;
  totalCount: number;
  onNavigate: (delta: number) => void;
  session: Session;
  onFileReady?: (pending: PendingImport) => void;
  onReloadAlerts?: () => void;
}): React.JSX.Element {
  const showToast = useToast();
  const meta = SEVERITY_META[alert.severity];

  const [isVerifying, setIsVerifying] = useState(false);

  // In-place file picker for uploads and re-imports
  const {
    trigger: triggerFilePicker,
    input: filePickerInput,
    picking,
  } = useImportFilePicker(session, onFileReady);

  // Export table to Excel
  function handleExportTable(): void {
    if (!alert.table) return;
    const rows = alert.table.export_rows ?? alert.table.rows;
    downloadExcel(
      `${alert.id}_${alert.branchName}_${new Date().toISOString().slice(0, 10)}.xlsx`,
      "Alert Data",
      alert.table.columns.map((c) => c.label),
      rows,
    );
    showToast("success", `Exported ${rows.length} rows to Excel`);
  }

  // Stock audit verification
  async function handleVerifyStockAudit(): Promise<void> {
    setIsVerifying(true);
    try {
      const res = await fetch(`${apiBaseUrl}/api/checking/verify`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        showToast(
          data.success ? "success" : "info",
          data.message || "Recount verification complete",
        );
        onReloadAlerts?.();
      } else {
        showToast("error", "Verification check failed");
      }
    } catch {
      showToast("error", "Failed to connect to verification service");
    } finally {
      setIsVerifying(false);
    }
  }

  const tableRows = alert.table?.rows ?? [];
  const hasActionButtons =
    alert.id === "daily_import_missing_sales" ||
    alert.id === "daily_import_missing_inventory" ||
    alert.id === "sale_data_quality" ||
    alert.id === "purchase_data_quality" ||
    alert.id === "purchase_number_sequence_gap" ||
    alert.id === "physical_stock_audit";

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-base">
      {filePickerInput}

      {/* Header Bar with In-Inspector Stepper */}
      <div className="px-4 py-2.5 border-b border-border bg-bg-subtle/50 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <Badge variant={meta.badge} dot>
            {meta.label}
          </Badge>
          <Badge
            variant={CATEGORY_META[alert.dimension]?.variant ?? "default"}
            className={cn(
              "text-[11px] px-1.5 py-0",
              CATEGORY_META[alert.dimension]?.className,
            )}
          >
            {CATEGORY_META[alert.dimension]?.label ??
              CATEGORY_LABEL[alert.dimension] ??
              alert.dimension}
          </Badge>
          {showBranch && (
            <span className="text-xs font-semibold text-text-secondary truncate">
              · {alert.branchName}
            </span>
          )}
        </div>

        {/* Stepper controls */}
        <div className="flex items-center gap-1 bg-bg-base border border-border rounded p-0.5 shadow-2xs">
          <Button
            variant="ghost"
            size="sm"
            disabled={currentIndex <= 0}
            onClick={() => onNavigate(-1)}
            title="Previous alert"
            className="h-6 px-1.5 text-xs gap-0.5"
          >
            <ChevronLeftIcon className="w-3.5 h-3.5" />
            <span>Prev</span>
          </Button>
          <span className="text-xs font-mono font-medium text-text-muted px-1.5 select-none border-x border-border/60">
            {currentIndex + 1} of {totalCount}
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={currentIndex >= totalCount - 1}
            onClick={() => onNavigate(1)}
            title="Next alert"
            className="h-6 px-1.5 text-xs gap-0.5"
          >
            <span>Next</span>
            <ChevronRightIcon className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Body: Title -> Description -> Recommended Actions -> Table / Breakdown */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-5 space-y-3.5">
        {/* 1. Title */}
        <h2 className="text-base font-bold text-text-primary tracking-tight leading-snug shrink-0">
          {alert.title}
        </h2>

        {/* 2. Description */}
        <p className="text-xs text-text-secondary leading-relaxed shrink-0">
          {alert.summary}
        </p>

        {/* 3. Why this alert */}
        <div className="rounded-lg border border-border bg-bg-subtle/60 p-3 shrink-0">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Why this alert
          </span>
          <p className="mt-1 text-xs text-text-secondary leading-relaxed">
            {alert.what_happened}
          </p>
        </div>

        {/* 4. Recommended Actions */}
        <div className="rounded-lg border border-brand-pill bg-brand-subtle p-3.5 space-y-2.5 shadow-2xs shrink-0">
          <span className="text-[11px] font-bold uppercase tracking-wider text-brand">
            Recommended Action
          </span>
          <p className="text-xs font-medium text-text-primary leading-relaxed">
            {alert.recommended_action}
          </p>

          {/* Action buttons (only when interactive actions exist) */}
          {hasActionButtons && (
            <div className="pt-2 border-t border-brand-pill/60 flex flex-wrap items-center gap-2">
              {alert.id === "daily_import_missing_sales" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={picking}
                  onClick={() =>
                    triggerFilePicker({
                      endpoint: "/api/imports/sales",
                      importLabel: "Sales",
                    })
                  }
                  className="h-8 text-xs font-semibold"
                >
                  <UploadIcon className="w-3.5 h-3.5 mr-1.5" />
                  Upload Today's Sales File
                </Button>
              )}

              {alert.id === "daily_import_missing_inventory" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={picking}
                  onClick={() =>
                    triggerFilePicker({
                      endpoint: "/api/imports/inventory",
                      importLabel: "Inventory",
                    })
                  }
                  className="h-8 text-xs font-semibold"
                >
                  <UploadIcon className="w-3.5 h-3.5 mr-1.5" />
                  Upload Today's Inventory File
                </Button>
              )}

              {alert.id === "sale_data_quality" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={picking}
                  onClick={() =>
                    triggerFilePicker({
                      endpoint: "/api/imports/sales",
                      importLabel: "Sales",
                    })
                  }
                  className="h-8 text-xs font-semibold"
                >
                  <UploadIcon className="w-3.5 h-3.5 mr-1.5" />
                  Re-import Sales File to Fix
                </Button>
              )}

              {alert.id === "purchase_data_quality" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={picking}
                  onClick={() =>
                    triggerFilePicker({
                      endpoint: "/api/imports/purchase",
                      importLabel: "Purchase",
                    })
                  }
                  className="h-8 text-xs font-semibold"
                >
                  <UploadIcon className="w-3.5 h-3.5 mr-1.5" />
                  Re-import Purchase File to Fix
                </Button>
              )}

              {alert.id === "physical_stock_audit" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={isVerifying}
                  onClick={handleVerifyStockAudit}
                  className="h-8 text-xs font-semibold"
                >
                  <CheckIcon className="w-3.5 h-3.5 mr-1.5 text-success" />
                  {isVerifying ? "Verifying..." : "Verify Recount"}
                </Button>
              )}

              {alert.id === "purchase_number_sequence_gap" && (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={picking}
                  onClick={() =>
                    triggerFilePicker({
                      endpoint: "/api/imports/purchase",
                      importLabel: "Purchase",
                    })
                  }
                  className="h-8 text-xs font-semibold"
                >
                  <UploadIcon className="w-3.5 h-3.5 mr-1.5" />
                  Import Missing Purchases
                </Button>
              )}
            </div>
          )}
        </div>

        {/* 4. Table / Item Breakdown */}
        {(alert.context ||
          (alert.facts && alert.facts.length > 0) ||
          (alert.table && tableRows.length > 0)) && (
          <div className="flex-1 flex flex-col min-h-0 space-y-2.5 pt-1">
            <div className="flex items-center justify-between gap-2 shrink-0">
              <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                {getSection4Title(alert)}
                {tableRows.length > 0 &&
                  alert.id !== "purchase_number_sequence_gap" && (
                  <span className="ml-1 font-normal text-text-muted/70">
                    ({tableRows.length})
                  </span>
                )}
              </span>

              {/* Download Excel button right next to the table title */}
              {alert.table && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleExportTable}
                  title="Export to Excel"
                  className="h-6 px-1.5 text-xs text-text-secondary hover:text-brand gap-1"
                >
                  <DownloadIcon className="w-3.5 h-3.5" />
                  <span className="text-[11px] font-medium">Excel</span>
                </Button>
              )}
            </div>

            {/* Context note */}
            {alert.context && (
              <p className="text-xs text-text-muted shrink-0">
                {alert.context}
              </p>
            )}

            {/* Key figures / Facts */}
            {(alert.facts ?? []).length > 0 && (
              <div className="shrink-0">
                <AlertFacts facts={alert.facts!} />
              </div>
            )}

            {/* Scrollable Table (expands to fill all remaining vertical height) */}
            {alert.table && tableRows.length > 0 && (
              <TableContainer className="flex-1 min-h-[220px] overflow-y-auto">
                <Thead className="top-0">
                  <Tr>
                    {alert.table.columns.map((column) => (
                      <Th
                        key={column.label}
                        className={
                          column.align === "right" ? "text-right" : undefined
                        }
                      >
                        {column.label}
                      </Th>
                    ))}
                  </Tr>
                </Thead>
                <Tbody>
                  {tableRows.map((row, idx) => (
                    <Tr key={`row-${idx}`}>
                      {row.map((cell, cellIdx) => (
                        <Td
                          key={alert.table!.columns[cellIdx]?.label ?? cellIdx}
                          className={cn(
                            "whitespace-nowrap text-xs",
                            alert.table!.columns[cellIdx]?.align === "right" &&
                              "text-right tabular-nums",
                            String(cell).includes("Order") &&
                              "font-semibold text-brand",
                            String(cell).includes("Transfer") &&
                              "font-semibold text-brand",
                            String(cell).includes("days") &&
                              parseFloat(String(cell)) < 2 &&
                              "font-bold text-error",
                          )}
                        >
                          {cell}
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </Tbody>
              </TableContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Right-hand panel when nothing is selected or all clear. */
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
  branchFilter: string;
  onFileReady?: (pending: PendingImport) => void;
}

export function BusinessAlertsPage({
  session,
  profile,
  branchOptions,
  branchFilter,
  onFileReady,
}: Props): React.JSX.Element {
  const isAdmin = profile !== null && profile.branch_id === null;
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const branchIds = isAdmin
    ? branchOptions.map((branch) => branch.id)
    : profile?.branch_id
      ? [profile.branch_id]
      : [];
  const urls = branchIds.map((id) =>
    // Same URL the nav badge in App.tsx requests, so the badge and this page share one
    // cached response. No period control: the alerts don't depend on one.
    dashboardUrl("overview", id, { period: "30d", dateFrom: "", dateTo: "" }),
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
      reorder: inBranch.filter((a) => a.dimension === "reorder").length,
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

  const isFiltered = activeTab !== "all" || severityFilter !== "all";

  const resetFilters = (): void => {
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

  // Keep a selection alive across refetches/filters
  useEffect(() => {
    if (shown.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!shown.some((alert) => alertKey(alert) === selectedId)) {
      setSelectedId(alertKey(shown[0]));
    }
  }, [shown, selectedId]);

  const currentIndex = shown.findIndex(
    (alert) => alertKey(alert) === selectedId,
  );
  const selectedAlert = currentIndex !== -1 ? shown[currentIndex] : null;

  // In-Inspector sequential navigation
  const handleNavigate = (delta: number): void => {
    if (shown.length === 0) return;
    const cur = shown.findIndex((alert) => alertKey(alert) === selectedId);
    const nextIdx = Math.max(
      0,
      Math.min(shown.length - 1, (cur === -1 ? 0 : cur) + delta),
    );
    setSelectedId(alertKey(shown[nextIdx]));
  };

  // Keyboard navigation: J/K or Up/Down arrows to step through alerts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J") {
        e.preventDefault();
        handleNavigate(1);
      } else if (e.key === "ArrowUp" || e.key === "k" || e.key === "K") {
        e.preventDefault();
        handleNavigate(-1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  // Smooth scroll active row into view
  useEffect(() => {
    if (selectedId) {
      const el = document.getElementById(`alert-row-${selectedId}`);
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedId]);

  const filterBarRef = useRef<HTMLDivElement>(null);
  const [gridHeight, setGridHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    function measure(): void {
      const el = filterBarRef.current;
      if (!el) return;
      const bottomGap = 14;
      const available =
        window.innerHeight - el.getBoundingClientRect().bottom - bottomGap;
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
                  "reorder",
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
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,22rem)_1fr] divide-y lg:divide-y-0 lg:divide-x divide-border">
                {/* Left: Master Alert List */}
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
                            key={alertKey(alert)}
                            alert={alert}
                            active={selectedId === alertKey(alert)}
                            showBranch={false}
                            onSelect={() => setSelectedId(alertKey(alert))}
                          />
                        ))
                      )}
                    </div>
                  ))}
                </div>

                {/* Right: Clean 4-Section Inspector */}
                <div
                  className="overflow-hidden"
                  style={{ height: gridHeight ?? undefined }}
                >
                  {selectedAlert ? (
                    <AlertInspector
                      alert={selectedAlert}
                      showBranch={showBranch}
                      currentIndex={currentIndex >= 0 ? currentIndex : 0}
                      totalCount={shown.length}
                      onNavigate={handleNavigate}
                      session={session}
                      onFileReady={onFileReady}
                      onReloadAlerts={reload}
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
