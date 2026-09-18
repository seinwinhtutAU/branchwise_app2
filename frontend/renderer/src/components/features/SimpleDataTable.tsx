import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
} from "@tanstack/react-table";
import "@renderer/lib/reactTable";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { useSettled } from "@renderer/lib/useSettled";
import { cn } from "@renderer/lib/utils";
import { downloadCsv } from "@renderer/lib/csv";
import { downloadExcel } from "@renderer/lib/excel";
import {
  distinctValues,
  inDateRange,
  matchesSearch,
} from "@renderer/lib/filters";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { ColumnHeaderFilter } from "@renderer/components/ui/ColumnHeaderFilter";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
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
import { DownloadIcon } from "@renderer/components/ui/icons";
import { CopyButton } from "@renderer/components/ui/CopyButton";
import { useStickyAbove } from "@renderer/lib/useStickyAbove";

export interface DataTableColumn<T> {
  key: keyof T;
  label: string;
  align?: "right";
  format?: (value: T[keyof T]) => string;
  /** If true, renders the cell value in a monospace font with a copy-to-clipboard button. */
  copyable?: boolean;
}

export type DataTableFilter<T> =
  | {
      type: "search";
      keys: (keyof T)[];
      placeholder?: string;
      /** serverPaged only — the query param this search is sent as (see Props.serverPaged). */
      serverParam?: string;
    }
  | {
      type: "select";
      key: keyof T;
      label: string;
      options?: string[];
      /** serverPaged only — the query param this filter is sent as (see Props.serverPaged). */
      serverParam?: string;
    }
  | {
      type: "dateRange";
      key: keyof T;
      label: string;
      /**
       * When set, the date range is sent to the server as these query param
       * names (e.g. `{ from: 'date_from', to: 'date_to' }`) instead of only
       * filtering client-side — for endpoints whose backing table grows
       * without bound (sales, purchases), so the browser isn't asked to load
       * the entire history on every visit.
       */
      serverParam?: { from: string; to: string };
    };

interface ServerPage<T> {
  rows: T[];
  total: number;
}

interface Props<T extends object> {
  session: Session;
  endpoint: string;
  title: string;
  description: string;
  icon: ReactNode;
  columns: DataTableColumn<T>[];
  filters?: DataTableFilter<T>[];
  rowKey: (row: T, index: number) => string;
  emptyTitle: string;
  emptyDescription: string;
  /**
   * Pre-fills the dateRange filter's "from" field on first load, for endpoints that
   * default to a recent window server-side when no date_from is sent (see the
   * `serverParam` doc on DataTableFilter). Purely a starting point — the user can still
   * clear or widen it same as any other filter value.
   */
  defaultWindowDays?: number;
  /**
   * Fetches and paginates one page of rows at a time from the server (endpoint must
   * return `{ rows, total }` and accept `page`/`page_size`, plus every filter's
   * `serverParam`, and an `export=true` override for CSV/Excel that ignores paging) —
   * instead of the default, which loads the whole result set once and pages/filters it
   * in memory. Turn this on only for a backing table that grows without bound (sales,
   * purchases); a small one (like Inventory's latest-snapshot table) is already cheap
   * enough that the default is simpler and just as fast.
   */
  serverPaged?: boolean;
  /**
   * Set false to skip the title/description heading entirely — for a caller that
   * already shows its own heading just above (e.g. a tabbed page whose tab label
   * already says what this table is), so the two don't repeat each other. `title`/
   * `description` are still used for the CSV/Excel filename and the error-toast label
   * either way. Defaults true.
   */
  showHeading?: boolean;
  /**
   * Set false to skip just the title line (keeping the description and the action
   * row) — for a caller whose tab label already names this table but whose
   * `description` still adds something the tab label doesn't say. Ignored when
   * `showHeading` is false. Defaults true.
   */
  showTitle?: boolean;
}

const PAGE_SIZE = 50;
const FILTER_SETTLE_MS = 400;
// A stable reference for "no data yet" so the table's `data` prop doesn't get a fresh
// array identity — and therefore a needless row-model recompute — on every render.
const EMPTY_ROWS: never[] = [];

function defaultFormat(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }
  return String(value);
}

function toCsvValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Matches the backend's own "date_from = today - (days - 1)" so the pre-filled date
// picker reflects exactly what an unfiltered request would already return.
function daysAgoIso(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - (days - 1));
  return date.toISOString().slice(0, 10);
}

export function SimpleDataTable<T extends object>({
  session,
  endpoint,
  title,
  description,
  icon,
  columns,
  filters,
  rowKey,
  emptyTitle,
  emptyDescription,
  defaultWindowDays,
  serverPaged,
  showHeading = true,
  showTitle = true,
}: Props<T>): React.JSX.Element {
  const showToast = useToast();
  const { aboveRef, containerStyle } = useStickyAbove();

  const [search, setSearch] = useState("");
  const [selectValues, setSelectValues] = useState<Record<string, string>>({});
  const [dateFrom, setDateFrom] = useState(() =>
    defaultWindowDays ? daysAgoIso(defaultWindowDays) : "",
  );
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<"csv" | "excel" | null>(null);

  const dateRangeFilter = filters?.find((f) => f.type === "dateRange");
  const dateServerParam =
    dateRangeFilter?.type === "dateRange"
      ? dateRangeFilter.serverParam
      : undefined;
  const searchFilter = filters?.find((f) => f.type === "search");
  const searchServerParam =
    searchFilter?.type === "search" ? searchFilter.serverParam : undefined;

  // Settled (debounced) versions of the free-typed filters — see useSettled. Only
  // matters for serverPaged, where these feed the fetch URL; harmless to compute either
  // way since a value nobody reads costs nothing.
  const settledSearch = useSettled(search, FILTER_SETTLE_MS);
  const settledDateFrom = useSettled(dateFrom, FILTER_SETTLE_MS);
  const settledDateTo = useSettled(dateTo, FILTER_SETTLE_MS);

  function buildServerParams(extra?: Record<string, string>): URLSearchParams {
    const params = new URLSearchParams();
    if (dateServerParam) {
      if (settledDateFrom) params.set(dateServerParam.from, settledDateFrom);
      if (settledDateTo) params.set(dateServerParam.to, settledDateTo);
    }
    if (searchServerParam && settledSearch)
      params.set(searchServerParam, settledSearch);
    if (filters) {
      for (const filter of filters) {
        if (filter.type !== "select" || !filter.serverParam) continue;
        const value = selectValues[String(filter.key)];
        if (value) params.set(filter.serverParam, value);
      }
    }
    if (extra)
      for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return params;
  }

  // The server-side date range is part of the URL and therefore part of the cache key;
  // the search box and the select filters are not (in the default, non-serverPaged
  // mode) because they narrow the rows this component already has without going back to
  // the server.
  let url = `${apiBaseUrl}${endpoint}`;
  if (serverPaged) {
    const params = buildServerParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
    url += `?${params.toString()}`;
  } else if (dateServerParam) {
    const params = new URLSearchParams();
    if (dateFrom) params.set(dateServerParam.from, dateFrom);
    if (dateTo) params.set(dateServerParam.to, dateTo);
    const query = params.toString();
    if (query) url += `?${query}`;
  }
  const { data: fetched, isRefreshing, failed, reload } = useUrlQuery<
    T[] | ServerPage<T>
  >(url, session, title.toLowerCase());
  const data = fetched ?? null;
  const rows =
    data === null
      ? null
      : serverPaged
        ? (data as ServerPage<T>).rows
        : (data as T[]);
  const total = serverPaged
    ? ((data as ServerPage<T> | null)?.total ?? 0)
    : null;

  // Resets to page 1 whenever a settled filter changes — otherwise narrowing the result
  // set can strand the user on a now-empty page.
  useEffect(() => {
    if (serverPaged) setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    serverPaged,
    settledSearch,
    settledDateFrom,
    settledDateTo,
    JSON.stringify(selectValues),
  ]);

  const hasActiveFilters =
    search !== "" ||
    dateFrom !== "" ||
    dateTo !== "" ||
    Object.values(selectValues).some(Boolean);

  function clearFilters(): void {
    setSearch("");
    setDateFrom("");
    setDateTo("");
    setSelectValues({});
  }

  // Only used in the default (non-serverPaged) mode — serverPaged rows are already
  // exactly one filtered, paginated page as the backend sent them.
  const filteredRows = useMemo(() => {
    if (serverPaged) return rows;
    if (!rows) return null;
    if (!filters || filters.length === 0) return rows;
    return rows.filter((row) =>
      filters.every((filter) => {
        if (filter.type === "search") {
          return (
            !search ||
            filter.keys.some((key) => matchesSearch(row[key], search))
          );
        }
        if (filter.type === "select") {
          const selected = selectValues[String(filter.key)];
          return !selected || String(row[filter.key] ?? "") === selected;
        }
        return inDateRange(row[filter.key], { from: dateFrom, to: dateTo });
      }),
    );
  }, [rows, filters, search, selectValues, dateFrom, dateTo, serverPaged]);

  // Column defs, built once from the caller's plain DataTableColumn list — `meta.align`
  // is what the header/cell renderers below read instead of re-deriving it from `col`.
  const tableColumns = useMemo<ColumnDef<T, unknown>[]>(
    () =>
      columns.map((col) => ({
        id: String(col.key),
        accessorFn: (row: T) => row[col.key],
        header: col.label,
        cell: col.copyable
          ? (info) => {
              const val = info.getValue();
              const str = val === null || val === undefined || val === "" ? "" : String(val);
              if (!str) return <span className="text-text-muted">—</span>;
              return (
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <span className="font-mono text-xs font-semibold text-brand">{str}</span>
                  <CopyButton value={str} what={col.label.toLowerCase()} />
                </div>
              );
            }
          : (info) => (col.format ?? defaultFormat)(info.getValue() as T[keyof T]),
        meta: { align: col.align },
      })),
    [columns],
  );

  // Client-paginated mode's own page state — the server-paged case reuses `page`/setPage
  // above instead, since there the server (not this table) already did the paging.
  const [clientPageIndex, setClientPageIndex] = useState(0);
  const pagination: PaginationState = serverPaged
    ? { pageIndex: page - 1, pageSize: PAGE_SIZE }
    : { pageIndex: clientPageIndex, pageSize: PAGE_SIZE };

  const table = useReactTable({
    data: (serverPaged ? rows : filteredRows) ?? EMPTY_ROWS,
    columns: tableColumns,
    state: { pagination },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(pagination) : updater;
      if (serverPaged) setPage(next.pageIndex + 1);
      else setClientPageIndex(next.pageIndex);
    },
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: serverPaged ? undefined : getPaginationRowModel(),
    manualPagination: serverPaged,
    pageCount: serverPaged
      ? Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE))
      : undefined,
  });

  const totalPages = serverPaged
    ? Math.max(1, Math.ceil((total ?? 0) / PAGE_SIZE))
    : table.getPageCount();
  const renderedRows = table.getRowModel().rows;
  const currentPage = serverPaged ? page : clientPageIndex + 1;
  const totalItems = serverPaged ? (total ?? 0) : (filteredRows?.length ?? 0);
  const setCurrentPage = serverPaged
    ? setPage
    : (p: number) => setClientPageIndex(p - 1);

  // Jumps back to page 1 whenever the filtered set changes underneath us — otherwise a
  // filter change can strand the user on a now-empty page.
  useEffect(() => {
    if (!serverPaged) setClientPageIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredRows]);

  // Snaps back to the last real page if a background refresh shrinks the result set out
  // from under the page the user is sitting on.
  useEffect(() => {
    if (serverPaged && page > totalPages) setPage(totalPages);
  }, [serverPaged, page, totalPages]);

  function csvRows(source: T[]): string[][] {
    return source.map((row) => columns.map((col) => toCsvValue(row[col.key])));
  }

  async function fetchAllForExport(): Promise<T[] | null> {
    const params = buildServerParams({ export: "true" });
    try {
      const response = await fetch(
        `${apiBaseUrl}${endpoint}?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as ServerPage<T>;
      return body.rows;
    } catch {
      showToast(
        "error",
        `Failed to prepare the export — is the backend running?`,
      );
      return null;
    }
  }

  async function handleDownloadCsv(): Promise<void> {
    if (serverPaged) {
      if (totalItems === 0) return;
      setExporting("csv");
      const allRows = await fetchAllForExport();
      setExporting(null);
      if (!allRows) return;
      downloadCsv(
        `${slugify(title)}.csv`,
        columns.map((col) => col.label),
        csvRows(allRows),
      );
      return;
    }
    if (!filteredRows || filteredRows.length === 0) return;
    downloadCsv(
      `${slugify(title)}.csv`,
      columns.map((col) => col.label),
      csvRows(filteredRows),
    );
  }

  async function handleDownloadExcel(): Promise<void> {
    if (serverPaged) {
      if (totalItems === 0) return;
      setExporting("excel");
      const allRows = await fetchAllForExport();
      setExporting(null);
      if (!allRows) return;
      downloadExcel(
        `${slugify(title)}.xlsx`,
        title,
        columns.map((col) => col.label),
        csvRows(allRows),
      );
      return;
    }
    if (!filteredRows || filteredRows.length === 0) return;
    downloadExcel(
      `${slugify(title)}.xlsx`,
      title,
      columns.map((col) => col.label),
      csvRows(filteredRows),
    );
  }

  const actionButtons = (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleDownloadCsv}
        disabled={
          serverPaged
            ? totalItems === 0
            : !filteredRows || filteredRows.length === 0
        }
        loading={exporting === "csv"}
      >
        <DownloadIcon className="w-4 h-4" />
        CSV
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleDownloadExcel}
        disabled={
          serverPaged
            ? totalItems === 0
            : !filteredRows || filteredRows.length === 0
        }
        loading={exporting === "excel"}
      >
        <DownloadIcon className="w-4 h-4" />
        Excel
      </Button>
      <RefreshButton
        onClick={reload}
        refreshing={isRefreshing}
      />
    </div>
  );

  return (
    <div className="flex flex-col" style={containerStyle}>
      <div ref={aboveRef} className="sticky top-14 lg:top-0 z-30 bg-bg-subtle pb-2 pt-1 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            {showHeading && (showTitle ? title : undefined) && (
              <div>
                <h3 className="text-base font-semibold text-text-primary tracking-tight">
                  {title}
                </h3>
                {description && (
                  <p className="text-xs text-text-muted">{description}</p>
                )}
              </div>
            )}
            {hasActiveFilters && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {search && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-subtle text-brand text-xs font-medium">
                    Search: {search}
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="hover:opacity-75 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                )}
                {Object.entries(selectValues).map(([k, v]) =>
                  v ? (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-subtle text-brand text-xs font-medium"
                    >
                      {k}: {v}
                      <button
                        type="button"
                        onClick={() =>
                          setSelectValues((prev) => ({ ...prev, [k]: "" }))
                        }
                        className="hover:opacity-75 font-bold cursor-pointer"
                      >
                        ×
                      </button>
                    </span>
                  ) : null,
                )}
                {(dateFrom || dateTo) && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand-subtle text-brand text-xs font-medium">
                    Date: {dateFrom || "…"} – {dateTo || "…"}
                    <button
                      type="button"
                      onClick={() => {
                        setDateFrom("");
                        setDateTo("");
                      }}
                      className="hover:opacity-75 font-bold cursor-pointer"
                    >
                      ×
                    </button>
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="text-xs h-6 px-1.5 text-text-muted hover:text-error"
                >
                  Clear all
                </Button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {actionButtons}
          </div>
        </div>
      </div>

      {rows === null && !failed && (
        <TableSkeleton rows={6} cols={columns.length + 1} />
      )}

      {rows === null && failed && (
        <EmptyState
          icon={icon}
          title={`Couldn't load ${title.toLowerCase()}`}
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      )}

      {rows !== null && totalItems === 0 && !hasActiveFilters && (
        <EmptyState
          icon={icon}
          title={emptyTitle}
          description={emptyDescription}
        />
      )}

      {rows !== null && totalItems === 0 && hasActiveFilters && (
        <EmptyState
          icon={icon}
          title="No rows match your filters"
          description="Try widening the date range or clearing a filter."
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}

      {rows !== null && totalItems > 0 && (
        <>
          <TableContainer
            className="overflow-y-auto border-0 rounded-none"
            style={{
              maxHeight: "calc(100vh - var(--sticky-offset, 0px) - 5rem)",
            }}
          >
            <Thead className="top-0">
              {table.getHeaderGroups().map((headerGroup) => (
                <Tr key={headerGroup.id}>
                  <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
                    #
                  </Th>
                  {headerGroup.headers.map((header) => {
                    const colKey = header.column.id as keyof T;
                    const matchingFilter = filters?.find((f) => {
                      if (f.type === "search") return f.keys.includes(colKey);
                      return f.key === colKey;
                    });
                    const align = header.column.columnDef.meta?.align;
                    const headerLabel = flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    );

                    if (!matchingFilter) {
                      return (
                        <Th
                          key={header.id}
                          className={
                            align === "right" ? "text-right" : undefined
                          }
                        >
                          {headerLabel}
                        </Th>
                      );
                    }

                    if (matchingFilter.type === "select") {
                      const options =
                        matchingFilter.options ??
                        (rows ? distinctValues(rows, matchingFilter.key) : []);
                      const activeVal =
                        selectValues[String(matchingFilter.key)] ?? "";
                      return (
                        <Th
                          key={header.id}
                          className={
                            align === "right" ? "text-right" : undefined
                          }
                        >
                          <ColumnHeaderFilter
                            label={headerLabel}
                            isActive={Boolean(activeVal)}
                            align={align === "right" ? "right" : "left"}
                          >
                            {(close) => (
                              <div className="flex flex-col gap-2">
                                <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                                  Filter: {matchingFilter.label}
                                </div>
                                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectValues((prev) => ({
                                        ...prev,
                                        [String(matchingFilter.key)]: "",
                                      }));
                                      close();
                                    }}
                                    className={cn(
                                      "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                      !activeVal
                                        ? "bg-brand/10 font-bold text-brand"
                                        : "hover:bg-bg-raised text-text-secondary",
                                    )}
                                  >
                                    <span>All</span>
                                  </button>
                                  {options.map((opt) => (
                                    <button
                                      key={opt}
                                      type="button"
                                      onClick={() => {
                                        setSelectValues((prev) => ({
                                          ...prev,
                                          [String(matchingFilter.key)]: opt,
                                        }));
                                        close();
                                      }}
                                      className={cn(
                                        "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                        activeVal === opt
                                          ? "bg-brand/10 font-bold text-brand"
                                          : "hover:bg-bg-raised text-text-secondary",
                                      )}
                                    >
                                      <span className="truncate">{opt}</span>
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </ColumnHeaderFilter>
                        </Th>
                      );
                    }

                    if (matchingFilter.type === "dateRange") {
                      const isDateActive = Boolean(dateFrom || dateTo);
                      return (
                        <Th
                          key={header.id}
                          className={
                            align === "right" ? "text-right" : undefined
                          }
                        >
                          <ColumnHeaderFilter
                            label={headerLabel}
                            isActive={isDateActive}
                            align={align === "right" ? "right" : "left"}
                          >
                            {(close) => (
                              <div className="flex flex-col gap-2 min-w-[14rem]">
                                <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                                  Date Range: {matchingFilter.label}
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  <Input
                                    type="date"
                                    label="From"
                                    value={dateFrom}
                                    onChange={(e) => setDateFrom(e.target.value)}
                                  />
                                  <Input
                                    type="date"
                                    label="To"
                                    value={dateTo}
                                    onChange={(e) => setDateTo(e.target.value)}
                                  />
                                </div>
                                {isDateActive && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs self-end text-error"
                                    onClick={() => {
                                      setDateFrom("");
                                      setDateTo("");
                                      close();
                                    }}
                                  >
                                    Clear
                                  </Button>
                                )}
                              </div>
                            )}
                          </ColumnHeaderFilter>
                        </Th>
                      );
                    }

                    if (matchingFilter.type === "search") {
                      return (
                        <Th
                          key={header.id}
                          className={
                            align === "right" ? "text-right" : undefined
                          }
                        >
                          <ColumnHeaderFilter
                            label={headerLabel}
                            isActive={Boolean(search)}
                            align={align === "right" ? "right" : "left"}
                          >
                            {(close) => (
                              <div className="flex flex-col gap-2 min-w-[12rem]">
                                <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                                  Search
                                </div>
                                <Input
                                  placeholder={
                                    matchingFilter.placeholder ?? "Search…"
                                  }
                                  value={search}
                                  onChange={(e) => setSearch(e.target.value)}
                                  autoFocus
                                />
                                {search && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs self-end text-error"
                                    onClick={() => {
                                      setSearch("");
                                      close();
                                    }}
                                  >
                                    Clear
                                  </Button>
                                )}
                              </div>
                            )}
                          </ColumnHeaderFilter>
                        </Th>
                      );
                    }

                    return (
                      <Th
                        key={header.id}
                        className={
                          align === "right" ? "text-right" : undefined
                        }
                      >
                        {headerLabel}
                      </Th>
                    );
                  })}
                </Tr>
              ))}
            </Thead>
            <Tbody>
              {renderedRows.map((row, idx) => (
                <Tr key={rowKey(row.original, row.index)}>
                  <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                    {(currentPage - 1) * PAGE_SIZE + idx + 1}
                  </Td>
                  {row.getVisibleCells().map((cell) => (
                    <Td
                      key={cell.id}
                      className={cn(
                        "whitespace-nowrap",
                        cell.column.columnDef.meta?.align === "right" &&
                          "text-right tabular-nums",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </Td>
                  ))}
                </Tr>
              ))}
            </Tbody>
          </TableContainer>

          <Pagination
            page={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            pageSize={PAGE_SIZE}
            onPageChange={setCurrentPage}
          />
        </>
      )}
    </div>
  );
}

export default SimpleDataTable;
