import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
} from "@tanstack/react-table";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { invalidateEverything, useUrlQuery } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import { formatRetailDateTime } from "@renderer/lib/retailDateTime";
import { useImportFilePicker } from "@renderer/lib/useImportFilePicker";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { Badge } from "@renderer/components/ui/Badge";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { DateInput } from "@renderer/components/ui/DateInput";
import { Select } from "@renderer/components/ui/Select";
import { TableSkeleton } from "@renderer/components/ui/Skeleton";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import { Pagination } from "@renderer/components/ui/Pagination";
import {
  DownloadIcon,
  HistoryIcon,
  MoreVerticalIcon,
  TrashIcon,
  UploadIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import {
  FloatingLayer,
  MenuItem,
} from "@renderer/components/features/wholesale/shared/ui";
import { useDismissableMenu } from "@renderer/components/features/wholesale/shared/useDismissableMenu";
import { useStickyAbove } from "@renderer/lib/useStickyAbove";
import { distinctValues, inDateRange } from "@renderer/lib/filters";
import "@renderer/lib/reactTable";
import type {
  PendingImport,
  Profile,
  SelectedImportFile,
} from "@renderer/components/features/types";

const RETAIL_REVERT_WINDOW_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 20;

function isRetailRevertLocked(
  row: ImportBatchRow,
  profile: Profile | null,
): boolean {
  return (
    profile?.role === "retail" &&
    Date.now() - new Date(row.created_at).getTime() > RETAIL_REVERT_WINDOW_MS
  );
}

interface ImportBatchRow {
  id: string;
  import_type: string;
  filename: string | null;
  branch_name: string | null;
  uploaded_by_name: string | null;
  status: string;
  summary: Record<string, unknown>;
  created_at: string;
  reverted_at: string | null;
  storage_key?: string | null;
  has_file?: boolean;
}

interface Props {
  session: Session;
  onViewBatch: (batchId: string) => void;
  branchOptions: string[];
  branchFilter?: string;
  profile: Profile | null;
  // Set when arriving here from a Warning row's "Source Import" link — scrolls that
  // exact row into view and rings it so it's obvious which one to revert.
  highlightBatchId?: string | null;
  // Hands off a picked-and-parsed file to the app-level confirm flow — used by each
  // row's "Reimport" button.
  onFileReady?: (pending: PendingImport) => void;
  onFileSelected?: (file: SelectedImportFile) => void;
}

// Display only — the backend/DB status values are still 'completed'/'reverted'/
// 'reimported' (see ImportBatchStatus), this just gives the reader three unambiguous
// words: Completed (still active), Removed (deleted, no replacement), Reimported
// (replaced by a corrected file) — without touching the revert action, endpoint, or
// audit columns (reverted_at/reverted_by) that still use the old names internally.
const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  reverted: "Removed",
  reimported: "Reimported",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const DEFAULT_STATUS_FILTER = "completed";
const IMPORT_STATUS_OPTIONS = ["completed", "reverted", "reimported"];
const EMPTY_ROWS: never[] = [];

const STATUS_BADGE_VARIANT: Record<string, "success" | "info" | "default"> = {
  completed: "success",
  reimported: "info",
};

function statusBadgeVariant(status: string): "success" | "info" | "default" {
  return STATUS_BADGE_VARIANT[status] ?? "default";
}

function importTypeLabel(importType: string): string {
  if (importType === "general") return "General File";
  return importType.charAt(0).toUpperCase() + importType.slice(1);
}

interface ImportHistoryActionsProps {
  row: ImportBatchRow;
  isAdmin: boolean;
  isLocked: boolean;
  picking: boolean;
  downloading: boolean;
  reverting: boolean;
  onDownload: (row: ImportBatchRow) => void;
  onReimport: (row: ImportBatchRow) => void;
  onRevert: (batchId: string) => void;
}

function ImportHistoryActions({
  row,
  isAdmin,
  isLocked,
  picking,
  downloading,
  reverting,
  onDownload,
  onReimport,
  onRevert,
}: ImportHistoryActionsProps): React.JSX.Element | null {
  const { open, setOpen, ref, toggle } = useDismissableMenu();
  const isGeneralFile = row.import_type === "general";
  const canDownload = isAdmin || isGeneralFile;
  const canManageImport =
    !isGeneralFile && row.status === "completed" && !isLocked;

  if (!canDownload && !canManageImport) {
    if (row.status === "completed" && isLocked) {
      return (
        <span
          className="text-xs text-text-muted"
          title="Retail accounts can only reimport or remove an import within 1 day of importing it"
        >
          Locked
        </span>
      );
    }
    return null;
  }

  return (
    <div
      className="relative inline-block"
      ref={ref}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-label="Import actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={downloading || picking || reverting}
        disabled={downloading || picking || reverting}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        className={cn(
          "p-1.5 rounded-md text-text-muted",
          "transition-colors duration-150",
          "hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <MoreVerticalIcon className="w-4 h-4" />
      </button>
      {open && (
        <FloatingLayer
          anchorRef={ref}
          align="right"
          className="min-w-48 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in"
        >
          {canDownload && (
            <MenuItem
              icon={<DownloadIcon className="w-4 h-4" />}
              label="Download original file"
              onClick={() => {
                setOpen(false);
                onDownload(row);
              }}
            />
          )}
          {canManageImport && (
            <>
              <MenuItem
                icon={<UploadIcon className="w-4 h-4" />}
                label="Reimport corrected file"
                onClick={() => {
                  setOpen(false);
                  onReimport(row);
                }}
              />
              <MenuItem
                icon={<TrashIcon className="w-4 h-4" />}
                label="Remove import"
                danger
                onClick={() => {
                  setOpen(false);
                  onRevert(row.id);
                }}
              />
            </>
          )}
          {(downloading || picking || reverting) && (
            <span className="sr-only">Action in progress</span>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}

function ImportHistoryTable({
  session,
  onViewBatch,
  branchOptions: _branchOptions,
  branchFilter: branchFilterProp = "",
  profile,
  highlightBatchId,
  onFileReady,
  onFileSelected,
}: Props): React.JSX.Element {
  const showToast = useToast();
  const {
    data: fetchedRows,
    isRefreshing,
    failed,
    reload,
  } = useUrlQuery<ImportBatchRow[]>(
    `${apiBaseUrl}/api/imports/history`,
    session,
    "import history",
  );
  const rows = fetchedRows ?? null;
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const { aboveRef, containerStyle } = useStickyAbove();
  const highlightRowRef = useRef<HTMLTableRowElement | null>(null);
  const {
    trigger: triggerFilePicker,
    input: filePickerInput,
    picking,
  } = useImportFilePicker(session, onFileReady, onFileSelected);

  const handleReimport = useCallback(
    (row: ImportBatchRow): void => {
      triggerFilePicker({
        endpoint: `/api/imports/${row.import_type}`,
        importLabel: importTypeLabel(row.import_type),
        revertBatchId: row.id,
        replacingFilename: row.filename,
      });
    },
    [triggerFilePicker],
  );

  const [typeFilter, setTypeFilter] = useState("");
  // Defaults to hiding Removed/Reimported rows — they're kept as an audit trail, not
  // something worth seeing on every visit. Still reachable via the Status filter itself.
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS_FILTER);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Only scrolls the row into view if it's on the current (default, unfiltered) page —
  // a highlight from Warnings always arrives with filters cleared and page 1, so this
  // covers the case it's meant for without needing to hunt across pages/filters.
  useEffect(() => {
    if (highlightBatchId && highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [highlightBatchId, rows]);

  const hasActiveFilters =
    typeFilter !== "" ||
    statusFilter !== DEFAULT_STATUS_FILTER ||
    dateFrom !== "" ||
    dateTo !== "";

  // Resets to genuinely unfiltered (Status included) rather than back to the Completed
  // default — this doubles as the "no rows match your filters" empty state's escape
  // hatch, which must always be able to reveal *something*, even if every row in
  // history happens to be Removed/Reimported right now.
  function clearFilters(): void {
    setTypeFilter("");
    setStatusFilter("");
    setDateFrom("");
    setDateTo("");
  }

  const handleRevert = useCallback(
    async (batchId: string): Promise<void> => {
      if (
        !window.confirm("Remove this import? This deletes the data it created.")
      )
        return;

      setRevertingId(batchId);
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/imports/history/${batchId}/revert`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
          },
        );
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          showToast(
            "error",
            body?.detail ?? `Revert failed: ${response.status}`,
          );
          return;
        }
        // The batch's sale/inventory/purchase rows are gone, so every cached page is now
        // wrong — including this one, which refetches itself as a result. See
        // invalidateEverything.
        invalidateEverything();
      } catch {
        showToast("error", "Revert failed — is the backend running?");
      } finally {
        setRevertingId(null);
      }
    },
    [session, showToast],
  );

  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownload = useCallback(
    async (row: ImportBatchRow): Promise<void> => {
      setDownloadingId(row.id);
      try {
        const response = await fetch(
          `${apiBaseUrl}/api/imports/history/${row.id}/download`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
          },
        );
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          showToast(
            "error",
            body?.detail ?? `Download failed (${response.status})`,
          );
          return;
        }
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = row.filename || `import_${row.id}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
        showToast("success", "File downloaded successfully.");
      } catch {
        showToast("error", "Network error while downloading the file.");
      } finally {
        setDownloadingId(null);
      }
    },
    [session.access_token, showToast],
  );

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    return rows.filter(
      (row) =>
        (!typeFilter || row.import_type === typeFilter) &&
        (!statusFilter || row.status === statusFilter) &&
        (!branchFilterProp || row.branch_name === branchFilterProp) &&
        inDateRange(row.created_at, { from: dateFrom, to: dateTo }),
    );
  }, [rows, typeFilter, statusFilter, branchFilterProp, dateFrom, dateTo]);

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  });

  const tableColumns = useMemo<ColumnDef<ImportBatchRow, unknown>[]>(
    () => [
      {
        id: "type",
        accessorFn: (row) => row.import_type,
        header: "Type",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="min-w-0">
              <div className="font-medium text-text-primary capitalize">
                {importTypeLabel(row.import_type)}
              </div>
              {row.filename && (
                <div
                  className="font-mono text-xs text-text-muted truncate max-w-[16rem] sm:max-w-[20rem]"
                  title={row.filename}
                >
                  {row.filename}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: "branch",
        accessorFn: (row) => row.branch_name,
        header: "Branch",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div>
              <div>{row.branch_name ?? "All branches"}</div>
              {row.uploaded_by_name && (
                <div className="text-[11px] text-text-muted">
                  by {row.uploaded_by_name}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: "status",
        accessorFn: (row) => row.status,
        header: "Status",
        cell: (info) => {
          const status = String(info.getValue());
          return (
            <Badge variant={statusBadgeVariant(status)}>
              {statusLabel(status)}
            </Badge>
          );
        },
      },
      {
        id: "date",
        accessorFn: (row) => row.created_at,
        header: "Date",
        cell: (info) => formatRetailDateTime(String(info.getValue())),
      },
      {
        id: "actions",
        accessorFn: () => null,
        header: "",
        cell: (info) => {
          const row = info.row.original;
          const isAdmin =
            profile?.role === "admin" || profile?.role === "development";
          const issueCount = row.summary?.issue_count;
          const hasIssues = typeof issueCount === "number" && issueCount > 0;
          const issueLabel = hasIssues
            ? `${issueCount} validation issue${issueCount === 1 ? "" : "s"} found — click to inspect origin vs clean data`
            : null;
          return (
            <div
              className="flex items-center justify-end gap-1"
              onClick={(event) => event.stopPropagation()}
            >
              {issueLabel && (
                <span
                  aria-label={issueLabel}
                  title={issueLabel}
                  className="inline-flex items-center justify-center p-1.5 text-amber-500"
                >
                  <WarningIcon className="w-4 h-4" />
                </span>
              )}
              <ImportHistoryActions
                row={row}
                isAdmin={isAdmin}
                isLocked={isRetailRevertLocked(row, profile)}
                picking={picking}
                downloading={downloadingId === row.id}
                reverting={revertingId === row.id}
                onDownload={(selectedRow) => void handleDownload(selectedRow)}
                onReimport={handleReimport}
                onRevert={(batchId) => void handleRevert(batchId)}
              />
            </div>
          );
        },
      },
    ],
    [
      downloadingId,
      handleDownload,
      handleReimport,
      handleRevert,
      picking,
      profile,
      revertingId,
    ],
  );

  const table = useReactTable({
    data: filteredRows ?? EMPTY_ROWS,
    columns: tableColumns,
    state: { pagination },
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  useEffect(() => {
    table.setPageIndex(0);
  }, [filteredRows, table]);

  const totalPages = Math.max(1, table.getPageCount());
  const currentPage = pagination.pageIndex + 1;
  const pageSize = pagination.pageSize;

  const typeOptions = useMemo(
    () => (rows ? distinctValues(rows, "import_type") : []),
    [rows],
  );
  // Keep the status picker available even when all current rows are completed. A user
  // must still be able to switch to the audit states (Removed/Reimported) without first
  // creating a row of one of those types.
  const statusOptions = useMemo(() => {
    const presentStatuses = rows ? distinctValues(rows, "status") : [];
    return [
      ...IMPORT_STATUS_OPTIONS,
      ...presentStatuses.filter(
        (status) => !IMPORT_STATUS_OPTIONS.includes(status),
      ),
    ];
  }, [rows]);

  return (
    <div className="flex flex-col" style={containerStyle}>
      {filePickerInput}
      <div className="bg-bg-base border border-border rounded-md overflow-hidden shadow-xs">
        <div
          ref={aboveRef}
          className="sticky top-14 lg:top-0 z-30 bg-bg-base px-4 py-2.5 border-b border-border space-y-2.5"
        >
          {/* Top Row: Title & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
                Import History
              </h2>
              <span className="text-xs text-text-muted hidden sm:inline">
                Includes general files stored unchanged, alongside
                your confirmed retail imports.
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <RefreshButton onClick={reload} refreshing={isRefreshing} />
            </div>
          </div>

          {/* Filter Row: Compact inline filters */}
          {rows && rows.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
              {typeOptions.length > 1 && (
                <div className="w-32 max-w-full">
                  <Select
                    size="sm"
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="">All types</option>
                    {typeOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {importTypeLabel(opt)}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              <div className="w-32 max-w-full">
                <Select
                  size="sm"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="">All statuses</option>
                  {statusOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {statusLabel(opt)}
                    </option>
                  ))}
                </Select>
              </div>

              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <span className="font-medium select-none">From</span>
                <div className="w-36">
                  <DateInput
                    size="sm"
                    placeholder="YYYY-MM-DD"
                    value={dateFrom}
                    onChange={setDateFrom}
                  />
                </div>
                <span className="font-medium select-none">To</span>
                <div className="w-36">
                  <DateInput
                    size="sm"
                    placeholder="YYYY-MM-DD"
                    value={dateTo}
                    onChange={setDateTo}
                  />
                </div>
              </div>

              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-xs h-8 px-2 text-text-muted hover:text-error transition-colors"
                >
                  Clear
                </Button>
              )}
            </div>
          )}
        </div>

        {rows === null && !failed && <TableSkeleton rows={6} cols={8} />}

        {rows === null && failed && (
          <EmptyState
            icon={<HistoryIcon />}
            title="Couldn't load import history"
            description="Something went wrong reaching the backend."
            action={
              <Button variant="secondary" size="sm" onClick={reload}>
                Try again
              </Button>
            }
          />
        )}

        {rows !== null && rows.length === 0 && (
          <EmptyState
            icon={<HistoryIcon />}
            title="No imports yet"
            description="Confirmed sales, inventory, and purchase imports will show up here."
          />
        )}

        {rows !== null &&
          rows.length > 0 &&
          filteredRows !== null &&
          filteredRows.length === 0 && (
            <EmptyState
              icon={<HistoryIcon />}
              title="No imports match your filters"
              description="Try widening the date range or clearing a filter."
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              }
            />
          )}

        {filteredRows !== null && filteredRows.length > 0 && (
          <>
            <TableContainer
              className="overflow-y-auto border-0 rounded-none"
              style={{
                maxHeight: "calc(100vh - var(--sticky-offset, 0px) - 8rem)",
              }}
            >
              <Thead className="top-0">
                {table.getHeaderGroups().map((headerGroup) => (
                  <Tr key={headerGroup.id}>
                    <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
                      #
                    </Th>
                    {headerGroup.headers.map((header) => (
                      <Th
                        key={header.id}
                        className={
                          header.column.columnDef.meta?.align === "right"
                            ? "text-right"
                            : undefined
                        }
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </Th>
                    ))}
                  </Tr>
                ))}
              </Thead>
              <Tbody>
                {table.getRowModel().rows.map((row, idx) => (
                  <Tr
                    key={row.original.id}
                    ref={
                      row.original.id === highlightBatchId
                        ? highlightRowRef
                        : undefined
                    }
                    onClick={() => onViewBatch(row.original.id)}
                    className={cn(
                      "cursor-pointer hover:bg-bg-subtle/50 transition-colors",
                      row.original.id === highlightBatchId &&
                        "ring-2 ring-inset ring-brand bg-brand-subtle",
                    )}
                  >
                    <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                      {(currentPage - 1) * pageSize + idx + 1}
                    </Td>
                    {row.getVisibleCells().map((cell) => (
                      <Td
                        key={cell.id}
                        className={cn(
                          cell.column.id === "type" &&
                            "max-w-[16rem] sm:max-w-[20rem]",
                          cell.column.id === "created" &&
                            "text-text-muted whitespace-nowrap text-xs",
                          cell.column.columnDef.meta?.align === "right" &&
                            "text-right tabular-nums",
                        )}
                        onClick={
                          cell.column.id === "actions"
                            ? (event) => event.stopPropagation()
                            : undefined
                        }
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </Td>
                    ))}
                  </Tr>
                ))}
              </Tbody>
            </TableContainer>

            <div className="border-t border-border bg-bg-base">
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                totalItems={filteredRows.length}
                pageSize={pageSize}
                onPageChange={(nextPage) => table.setPageIndex(nextPage - 1)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ImportHistoryTable;
