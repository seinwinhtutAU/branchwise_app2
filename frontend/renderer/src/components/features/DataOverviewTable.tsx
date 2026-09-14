import { useEffect, useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
} from "@tanstack/react-table";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { cn } from "@renderer/lib/utils";
import { useToast } from "@renderer/lib/useToast";
import { formatBuyingPriceSource } from "@renderer/lib/buyingPriceSource";
import { downloadCsv } from "@renderer/lib/csv";
import { downloadExcel } from "@renderer/lib/excel";
import { Button } from "@renderer/components/ui/Button";
import { CardHeader } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
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
import { DownloadIcon, OverviewIcon } from "@renderer/components/ui/icons";
import { useStickyAbove } from "@renderer/lib/useStickyAbove";
import { useSettled } from "@renderer/lib/useSettled";
import "@renderer/lib/reactTable";

interface OverviewRow {
  Branch: string | null;
  Date: string;
  SlipID: string;
  SlipNumber: string;
  LineNo: number;
  LineID: string;
  StockCode: string;
  Description: string;
  Location: string | null;
  Selling_Price: number | null;
  Qty: number | null;
  UOM: string | null;
  Discount_Amount: number | null;
  Amount: number | null;
  Net_Amount: number | null;
  Time: string | null;
  Buying_Price: number | null;
  Buying_Price_Source: string | null;
  Group: string | null;
  profit: number | null;
  profit_margin_pct: number | null;
}

interface OverviewResponse {
  rows: OverviewRow[];
  total: number;
  groups: string[];
  branches: string[];
}

interface Props {
  session: Session;
  branchOptions: string[];
  showBuyingPriceSource: boolean;
}

// green = from sale.csv, blue = from inventory, pink = from purchase.
// A column can light up more than one band (e.g. StockCode appears in all three).
type Band = "sale" | "inventory" | "purchase";

interface OverviewColumn {
  key: keyof OverviewRow;
  label: string;
  bands: Band[];
  align?: "right";
}

const COLUMNS: OverviewColumn[] = [
  { key: "Branch", label: "Branch", bands: ["sale"] },
  { key: "Date", label: "Date", bands: ["sale"] },
  { key: "SlipID", label: "Slip ID", bands: [] },
  { key: "SlipNumber", label: "Slip Number", bands: ["sale"] },
  { key: "LineNo", label: "Line No", bands: ["sale"], align: "right" },
  { key: "LineID", label: "Line ID", bands: [] },
  {
    key: "StockCode",
    label: "Stock Code",
    bands: ["sale", "inventory", "purchase"],
  },
  { key: "Description", label: "Description", bands: ["inventory"] },
  { key: "Location", label: "Location", bands: ["inventory"] },
  {
    key: "Selling_Price",
    label: "Selling Price",
    bands: ["sale"],
    align: "right",
  },
  { key: "Qty", label: "Qty", bands: ["sale"], align: "right" },
  { key: "UOM", label: "UOM", bands: ["sale"] },
  {
    key: "Discount_Amount",
    label: "Discount Amount",
    bands: ["sale"],
    align: "right",
  },
  { key: "Amount", label: "Amount", bands: ["sale"], align: "right" },
  { key: "Net_Amount", label: "Net Amount", bands: ["sale"], align: "right" },
  { key: "Time", label: "Time", bands: ["sale"] },
  {
    key: "Buying_Price",
    label: "Buying Price",
    bands: ["inventory", "purchase"],
    align: "right",
  },
  { key: "Buying_Price_Source", label: "Buying Price Source", bands: [] },
  { key: "Group", label: "Group", bands: ["inventory"] },
  { key: "profit", label: "Profit", bands: [], align: "right" },
  {
    key: "profit_margin_pct",
    label: "Profit Margin %",
    bands: [],
    align: "right",
  },
];

const BAND_ORDER: Band[] = ["sale", "inventory", "purchase"];
const BAND_COLOR: Record<Band, string> = {
  sale: "bg-emerald-400",
  inventory: "bg-sky-400",
  purchase: "bg-pink-400",
};
const BAND_LABEL: Record<Band, string> = {
  sale: "Sale",
  inventory: "Inventory",
  purchase: "Purchase",
};

// How long a text/date filter must sit unchanged before it's sent to the backend — same
// idea, and same delay, as DashboardPage's custom date range: a native date input fires
// a change per keystroke, and this table's search box shouldn't refetch per letter typed.
const FILTER_SETTLE_MS = 400;
const PAGE_SIZE = 50;
const EMPTY_ROWS: never[] = [];

function SourceLegend(): React.JSX.Element {
  return (
    <div className="flex flex-row flex-wrap items-center gap-4 mb-4">
      {BAND_ORDER.map((band) => (
        <div key={band} className="flex items-center gap-1.5">
          <div className={cn("h-3 w-5 rounded-sm", BAND_COLOR[band])} />
          <span className="text-sm text-text-secondary">
            {BAND_LABEL[band]}
          </span>
        </div>
      ))}
    </div>
  );
}

function SourceStrip({ bands }: { bands: Band[] }): React.JSX.Element {
  return (
    <div className="flex flex-row gap-1 mb-1.5" aria-hidden="true">
      {BAND_ORDER.filter((band) => bands.includes(band)).map((band) => (
        <div
          key={band}
          className={cn("h-2.5 w-4 rounded-sm", BAND_COLOR[band])}
        />
      ))}
    </div>
  );
}

function formatNumber(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCell(col: OverviewColumn, value: unknown): string {
  if (col.key === "Buying_Price_Source")
    return formatBuyingPriceSource(value as string | null);
  if (value === null || value === undefined || value === "") return "—";
  if (col.key === "profit_margin_pct")
    return `${formatNumber(value as number)}%`;
  if (
    [
      "Selling_Price",
      "Qty",
      "Discount_Amount",
      "Amount",
      "Net_Amount",
      "Buying_Price",
      "profit",
    ].includes(col.key)
  ) {
    return formatNumber(value as number);
  }
  return String(value);
}

function DataOverviewTable({
  session,
  branchOptions,
  showBuyingPriceSource,
}: Props): React.JSX.Element {
  const showToast = useToast();
  const { aboveRef, containerStyle } = useStickyAbove();

  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<"csv" | "excel" | null>(null);

  // What's actually fetched — settled text/date filters, applied instantly for the two
  // dropdowns (a select fires once per choice, not per keystroke, so it needs no delay).
  const appliedSearch = useSettled(search, FILTER_SETTLE_MS);
  const appliedDateFrom = useSettled(dateFrom, FILTER_SETTLE_MS);
  const appliedDateTo = useSettled(dateTo, FILTER_SETTLE_MS);

  useEffect(() => {
    setPage(1);
  }, [
    appliedSearch,
    branchFilter,
    groupFilter,
    appliedDateFrom,
    appliedDateTo,
  ]);

  const visibleColumns = useMemo(
    () =>
      showBuyingPriceSource
        ? COLUMNS
        : COLUMNS.filter((col) => col.key !== "Buying_Price_Source"),
    [showBuyingPriceSource],
  );

  const hasActiveFilters =
    search !== "" ||
    branchFilter !== "" ||
    groupFilter !== "" ||
    dateFrom !== "" ||
    dateTo !== "";

  function clearFilters(): void {
    setSearch("");
    setBranchFilter("");
    setGroupFilter("");
    setDateFrom("");
    setDateTo("");
  }

  function buildParams(extra?: Record<string, string>): URLSearchParams {
    const params = new URLSearchParams();
    if (appliedSearch) params.set("search", appliedSearch);
    if (branchFilter) params.set("branch", branchFilter);
    if (groupFilter) params.set("group", groupFilter);
    if (appliedDateFrom) params.set("date_from", appliedDateFrom);
    if (appliedDateTo) params.set("date_to", appliedDateTo);
    if (extra)
      for (const [key, value] of Object.entries(extra)) params.set(key, value);
    return params;
  }

  const url = useMemo(() => {
    const params = buildParams({
      page: String(page),
      page_size: String(PAGE_SIZE),
    });
    return `${apiBaseUrl}/api/data-overview?${params.toString()}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appliedSearch,
    branchFilter,
    groupFilter,
    appliedDateFrom,
    appliedDateTo,
    page,
  ]);

  const { data, isRefreshing, failed, reload } =
    useUrlQuery<OverviewResponse>(url, session, "data overview");

  const rows = data?.rows ?? null;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tableColumns = useMemo<ColumnDef<OverviewRow, unknown>[]>(
    () =>
      visibleColumns.map((col) => ({
        id: String(col.key),
        accessorFn: (row: OverviewRow) => row[col.key],
        header: () => (
          <>
            <SourceStrip bands={col.bands} />
            {col.label}
          </>
        ),
        cell: (info) => formatCell(col, info.getValue()),
        meta: { align: col.align },
      })),
    [visibleColumns],
  );
  const pagination: PaginationState = {
    pageIndex: page - 1,
    pageSize: PAGE_SIZE,
  };
  const table = useReactTable({
    data: rows ?? EMPTY_ROWS,
    columns: tableColumns,
    state: { pagination },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(pagination) : updater;
      setPage(next.pageIndex + 1);
    },
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    pageCount: totalPages,
  });

  // Strands nobody: if a background refresh (someone else's import) shrinks the result
  // set out from under a page the user is sitting on, snap back to the last real page
  // instead of showing an empty one.
  useEffect(() => {
    if (rows !== null && page > totalPages) setPage(totalPages);
  }, [rows, totalPages, page]);

  function overviewCsvRows(source: OverviewRow[]): string[][] {
    return source.map((row) =>
      visibleColumns.map((col) => {
        if (col.key === "Buying_Price_Source")
          return formatBuyingPriceSource(row[col.key] as string | null);
        const value = row[col.key];
        return value === null || value === undefined ? "" : String(value);
      }),
    );
  }

  // Every page load only fetches one page of rows, so a full export needs its own
  // request — deliberate and user-triggered, unlike the old full-history fetch this
  // replaced (see backend/app/routers/data_overview.py for why that mattered).
  async function fetchAllForExport(): Promise<OverviewRow[] | null> {
    const params = buildParams({ export: "true" });
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/data-overview?${params.toString()}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as OverviewResponse;
      return body.rows;
    } catch {
      showToast(
        "error",
        "Failed to prepare the export — is the backend running?",
      );
      return null;
    }
  }

  async function handleDownloadCsv(): Promise<void> {
    if (total === 0) return;
    setExporting("csv");
    const allRows = await fetchAllForExport();
    setExporting(null);
    if (!allRows) return;
    downloadCsv(
      "data-overview.csv",
      visibleColumns.map((col) => col.label),
      overviewCsvRows(allRows),
    );
  }

  async function handleDownloadExcel(): Promise<void> {
    if (total === 0) return;
    setExporting("excel");
    const allRows = await fetchAllForExport();
    setExporting(null);
    if (!allRows) return;
    downloadExcel(
      "data-overview.xlsx",
      "Data overview",
      visibleColumns.map((col) => col.label),
      overviewCsvRows(allRows),
    );
  }

  return (
    <div className="flex flex-col" style={containerStyle}>
      <div ref={aboveRef} className="sticky top-14 lg:top-0 z-30 bg-bg-subtle">
        <CardHeader
          title="Data overview"
          description="Sale line items merged with inventory and purchase data by stock code."
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownloadCsv}
                disabled={total === 0}
                loading={exporting === "csv"}
              >
                <DownloadIcon className="w-4 h-4" />
                CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownloadExcel}
                disabled={total === 0}
                loading={exporting === "excel"}
              >
                <DownloadIcon className="w-4 h-4" />
                Excel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={reload}
                loading={isRefreshing}
              >
                Refresh
              </Button>
            </div>
          }
        />

        <SourceLegend />

        {(total > 0 || hasActiveFilters) && (
          <div className="flex flex-wrap items-end gap-3 pb-4 -mt-1">
            <Input
              label="Search"
              placeholder="Stock code or description"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
            />

            {(() => {
              const options =
                branchOptions.length > 0
                  ? branchOptions
                  : (data?.branches ?? []);
              return options.length > 1 ? (
                <div className="w-40">
                  <Select
                    label="Branch"
                    value={branchFilter}
                    onChange={(e) => setBranchFilter(e.target.value)}
                  >
                    <option value="">All</option>
                    {options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null;
            })()}

            {(() => {
              const groupOptions = data?.groups ?? [];
              return groupOptions.length > 1 ? (
                <div className="w-40">
                  <Select
                    label="Group"
                    value={groupFilter}
                    onChange={(e) => setGroupFilter(e.target.value)}
                  >
                    <option value="">All</option>
                    {groupOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null;
            })()}

            <div className="flex items-end gap-2">
              <Input
                type="date"
                label="Date from"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
              <Input
                type="date"
                label="Date to"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>

      {rows === null && !failed && <TableSkeleton rows={6} cols={8} />}

      {rows === null && failed && (
        <EmptyState
          icon={<OverviewIcon />}
          title="Couldn't load data overview"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      )}

      {rows !== null && total === 0 && !hasActiveFilters && (
        <EmptyState
          icon={<OverviewIcon />}
          title="No sales data yet"
          description="Import a sales file to see it here, merged with inventory and purchase data."
        />
      )}

      {rows !== null && total === 0 && hasActiveFilters && (
        <EmptyState
          icon={<OverviewIcon />}
          title="No rows match your filters"
          description="Try widening the date range or clearing a filter."
          action={
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}

      {rows !== null && rows.length > 0 && (
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
              {table.getRowModel().rows.map((row) => (
                <Tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <Td
                      key={cell.id}
                      className={cn(
                        "whitespace-nowrap",
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

          <Pagination
            page={page}
            totalPages={totalPages}
            totalItems={total}
            pageSize={PAGE_SIZE}
            onPageChange={(nextPage) => table.setPageIndex(nextPage - 1)}
          />
        </>
      )}
    </div>
  );
}

export default DataOverviewTable;
