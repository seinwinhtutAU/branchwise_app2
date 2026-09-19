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
import { HistoryIcon } from "@renderer/components/ui/icons";
import { useStickyAbove } from "@renderer/lib/useStickyAbove";
import { distinctValues, inDateRange } from "@renderer/lib/filters";
import "@renderer/lib/reactTable";
import type {
  PendingImport,
  Profile,
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
}

interface Props {
  session: Session;
  onViewBatch: (batchId: string) => void;
  branchOptions: string[];
  profile: Profile | null;
  // Set when arriving here from a Warning row's "Source Import" link — scrolls that
  // exact row into view and rings it so it's obvious which one to revert.
  highlightBatchId?: string | null;
  // Hands off a picked-and-parsed file to the app-level confirm flow — used by each
  // row's "Reimport" button.
  onFileReady?: (pending: PendingImport) => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
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
const EMPTY_ROWS: never[] = [];

const STATUS_BADGE_VARIANT: Record<string, "success" | "info" | "default"> = {
  completed: "success",
  reimported: "info",
};

function statusBadgeVariant(status: string): "success" | "info" | "default" {
  return STATUS_BADGE_VARIANT[status] ?? "default";
}

function importTypeLabel(importType: string): string {
  return importType.charAt(0).toUpperCase() + importType.slice(1);
}

function ImportHistoryTable({
  session,
  onViewBatch,
  branchOptions,
  profile,
  highlightBatchId,
  onFileReady,
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
  } = useImportFilePicker(session, onFileReady);

  const handleReimport = useCallback((row: ImportBatchRow): void => {
    triggerFilePicker({
      endpoint: `/api/imports/${row.import_type}`,
      importLabel: importTypeLabel(row.import_type),
      revertBatchId: row.id,
      replacingFilename: row.filename,
    });
  }, [triggerFilePicker]);

  const [typeFilter, setTypeFilter] = useState("");
  // Defaults to hiding Removed/Reimported rows — they're kept as an audit trail, not
  // something worth seeing on every visit. Still reachable via the Status filter itself.
  const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUS_FILTER);
  const [branchFilter, setBranchFilter] = useState("");
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
    branchFilter !== "" ||
    dateFrom !== "" ||
    dateTo !== "";

  // Resets to genuinely unfiltered (Status included) rather than back to the Completed
  // default — this doubles as the "no rows match your filters" empty state's escape
  // hatch, which must always be able to reveal *something*, even if every row in
  // history happens to be Removed/Reimported right now.
  function clearFilters(): void {
    setTypeFilter("");
    setStatusFilter("");
    setBranchFilter("");
    setDateFrom("");
    setDateTo("");
  }

  const handleRevert = useCallback(async (batchId: string): Promise<void> => {
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
        showToast("error", body?.detail ?? `Revert failed: ${response.status}`);
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
  }, [session, showToast]);

  const filteredRows = useMemo(() => {
    if (!rows) return null;
    return rows.filter(
      (row) =>
        (!typeFilter || row.import_type === typeFilter) &&
        (!statusFilter || row.status === statusFilter) &&
        (!branchFilter || row.branch_name === branchFilter) &&
        inDateRange(row.created_at, { from: dateFrom, to: dateTo }),
    );
  }, [rows, typeFilter, statusFilter, branchFilter, dateFrom, dateTo]);

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
        cell: (info) => String(info.getValue()),
      },
      {
        id: "filename",
        accessorFn: (row) => row.filename,
        header: "Filename",
        cell: (info) => String(info.getValue() ?? "—"),
      },
      {
        id: "branch",
        accessorFn: (row) => row.branch_name,
        header: "Branch",
        cell: (info) => String(info.getValue() ?? "—"),
      },
      {
        id: "uploaded_by",
        accessorFn: (row) => row.uploaded_by_name,
        header: "Uploaded by",
        cell: (info) => String(info.getValue() ?? "—"),
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
        id: "created",
        accessorFn: (row) => row.created_at,
        header: "Created",
        cell: (info) => formatDate(String(info.getValue())),
      },
      {
        id: "actions",
        accessorFn: () => null,
        header: "",
        cell: (info) => {
          const row = info.row.original;
          if (row.status !== "completed") return null;
          if (isRetailRevertLocked(row, profile)) {
            return (
              <span
                className="text-xs text-text-muted"
                title="Retail accounts can only reimport or remove an import within 1 day of importing it"
              >
                Locked
              </span>
            );
          }
          return (
            <div className="flex items-center gap-1.5 justify-end">
              <Button
                variant="secondary"
                size="sm"
                title="Pick a corrected file to replace this import"
                disabled={picking}
                onClick={(event) => {
                  event.stopPropagation();
                  handleReimport(row);
                }}
              >
                Reimport
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation();
                  void handleRevert(row.id);
                }}
                loading={revertingId === row.id}
              >
                Remove
              </Button>
            </div>
          );
        },
      },
    ],
    [
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

  const typeOptions = useMemo(() => (rows ? distinctValues(rows, "import_type") : []), [rows]);
  const statusOptions = useMemo(() => (rows ? distinctValues(rows, "status") : []), [rows]);
  const branchOptionsList = useMemo(() => {
    if (!rows) return [];
    return branchOptions.length > 0 ? branchOptions : distinctValues(rows, "branch_name");
  }, [rows, branchOptions]);

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
                Every confirmed upload — reimport a corrected file to replace a mistaken one, or remove it outright.
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <RefreshButton
                onClick={reload}
                refreshing={isRefreshing}
              />
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
                      <option key={opt} value={opt} className="capitalize">
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

              {statusOptions.length > 1 && (
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
              )}

              {branchOptionsList.length > 1 && (
                <div className="w-36 max-w-full">
                  <Select
                    size="sm"
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                  >
                    <option value="">All branches</option>
                    {branchOptionsList.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
              )}

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
                          cell.column.id === "type" && "capitalize font-medium",
                          cell.column.id === "filename" &&
                            "max-w-[14rem] truncate font-mono text-xs",
                          cell.column.id === "created" &&
                            "text-text-muted whitespace-nowrap text-xs",
                          cell.column.columnDef.meta?.align === "right" &&
                            "text-right tabular-nums",
                        )}
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

