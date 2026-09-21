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
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
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
  OverviewIcon,
  SearchIcon,
} from "@renderer/components/ui/icons";
import { CopyButton } from "@renderer/components/ui/CopyButton";
import { TabBar, type TabItem } from "@renderer/components/ui/Tabs";
import { useStickyAbove } from "@renderer/lib/useStickyAbove";
import { useSettled } from "@renderer/lib/useSettled";
import {
  ExportDateRangeDialog,
  type ExportDateRange,
} from "@renderer/components/features/ExportDateRangeDialog";
import {
  SimpleDataTable,
  type DataTableColumn,
  type DataTableFilter,
} from "@renderer/components/features/SimpleDataTable";
import {
  InventoryPage,
  type InventorySubTab,
} from "@renderer/components/features/retail/InventoryPage";
import "@renderer/lib/reactTable";

export type DataOverviewSubTab = "overview" | "sale" | "inventory" | "purchase";

export interface SaleRow {
  Branch: string | null;
  Date: string;
  Time: string | null;
  SlipID: string;
  SlipNumber: string;
  LineNo: number;
  LineID: string;
  StockCode: string;
  Description: string;
  Selling_Price: number | null;
  Qty: number | null;
  UOM: string | null;
  Discount_Amount: number | null;
  Amount: number | null;
  Net_Amount: number | null;
  Location: string | null;
  Buying_Price: number | null;
  Buying_Price_Source: string | null;
  Profit: number | null;
  Profit_Margin_Pct: number | null;
}

export interface PurchaseRow {
  Branch: string | null;
  PurchaseNumber: string | null;
  Date: string;
  StockCode: string;
  Description: string;
  Quantity: number | null;
  UOM: string | null;
  Buying_Price: number | null;
  Location: string | null;
}

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

export interface DataOverviewTableProps {
  session: Session;
  branchOptions: string[];
  showBuyingPriceSource: boolean;
  saleColumns?: DataTableColumn<SaleRow>[];
  saleFilters?: DataTableFilter<SaleRow>[];
  purchaseColumns?: DataTableColumn<PurchaseRow>[];
  purchaseFilters?: DataTableFilter<PurchaseRow>[];
  saleListWindowDays?: number;
  purchaseListWindowDays?: number;
  initialTab?: DataOverviewSubTab;
  onTabChange?: (tab: DataOverviewSubTab) => void;
  inventoryTarget?: InventorySubTab | null;
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

const DEFAULT_SALE_COLUMNS: DataTableColumn<SaleRow>[] = [
  { key: "Branch", label: "Branch" },
  { key: "Date", label: "Date" },
  { key: "Time", label: "Time" },
  { key: "SlipID", label: "Slip ID" },
  { key: "SlipNumber", label: "Slip Number" },
  { key: "LineNo", label: "Line No", align: "right" },
  { key: "LineID", label: "Line ID" },
  { key: "StockCode", label: "Stock Code", copyable: true },
  { key: "Description", label: "Description" },
  { key: "Selling_Price", label: "Selling Price", align: "right" },
  { key: "Qty", label: "Qty", align: "right" },
  { key: "UOM", label: "UOM" },
  { key: "Discount_Amount", label: "Discount Amount", align: "right" },
  { key: "Amount", label: "Amount", align: "right" },
  { key: "Net_Amount", label: "Net Amount", align: "right" },
  { key: "Location", label: "Location" },
  { key: "Buying_Price", label: "Buying Price", align: "right" },
  {
    key: "Buying_Price_Source",
    label: "Buying Price Source",
    format: (value) => formatBuyingPriceSource(value as string | null),
  },
  { key: "Profit", label: "Profit", align: "right" },
  {
    key: "Profit_Margin_Pct",
    label: "Profit Margin %",
    align: "right",
    format: (value) =>
      value === null || value === undefined
        ? "—"
        : `${(value as number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
  },
];

const DEFAULT_PURCHASE_COLUMNS: DataTableColumn<PurchaseRow>[] = [
  { key: "PurchaseNumber", label: "Purchase Number", copyable: true },
  { key: "Branch", label: "Branch" },
  { key: "Date", label: "Date" },
  { key: "StockCode", label: "Stock Code", copyable: true },
  { key: "Description", label: "Description" },
  { key: "Quantity", label: "Quantity", align: "right" },
  { key: "UOM", label: "UOM" },
  { key: "Buying_Price", label: "Buying Price", align: "right" },
  { key: "Location", label: "Location" },
];

const SUB_TABS: TabItem<DataOverviewSubTab>[] = [
  {
    id: "overview",
    label: "Data Overview",
    icon: <OverviewIcon className="w-4 h-4" />,
  },
  {
    id: "sale",
    label: (
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm bg-emerald-400 shrink-0" />
        <span>Sale</span>
      </span>
    ),
  },
  {
    id: "inventory",
    label: (
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm bg-sky-400 shrink-0" />
        <span>Inventory</span>
      </span>
    ),
  },
  {
    id: "purchase",
    label: (
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded-sm bg-pink-400 shrink-0" />
        <span>Purchase</span>
      </span>
    ),
  },
];

const FILTER_SETTLE_MS = 400;
const PAGE_SIZE = 20;
const EMPTY_ROWS: never[] = [];

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

interface MergedTableProps {
  session: Session;
  branchOptions: string[];
  showBuyingPriceSource: boolean;
}

function MergedDataOverviewTable({
  session,
  branchOptions,
  showBuyingPriceSource,
}: MergedTableProps): React.JSX.Element {
  const showToast = useToast();
  const { aboveRef, containerStyle } = useStickyAbove();

  const [search, setSearch] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState<"csv" | "excel" | null>(null);
  const [exportFormat, setExportFormat] = useState<"csv" | "excel" | null>(null);

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

  const { data, isRefreshing, failed, reload } = useUrlQuery<OverviewResponse>(
    url,
    session,
    "data overview",
  );

  const rows = data?.rows ?? null;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const tableColumns = useMemo<ColumnDef<OverviewRow, unknown>[]>(
    () =>
      visibleColumns.map((col) => {
        const isCopyable = col.key === "StockCode";
        return {
          id: String(col.key),
          accessorFn: (row: OverviewRow) => row[col.key],
          header: () => (
            <>
              <SourceStrip bands={col.bands} />
              {col.label}
            </>
          ),
          cell: isCopyable
            ? (info) => {
                const val = info.getValue();
                const str =
                  val === null || val === undefined || val === ""
                    ? ""
                    : String(val);
                if (!str) return <span className="text-text-muted">—</span>;
                return (
                  <div className="flex items-center gap-1 whitespace-nowrap">
                    <span className="font-mono text-xs font-semibold text-brand">
                      {str}
                    </span>
                    <CopyButton value={str} what={col.label.toLowerCase()} />
                  </div>
                );
              }
            : (info) => formatCell(col, info.getValue()),
          meta: { align: col.align },
        };
      }),
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

  async function fetchAllForExport(exportRange: ExportDateRange): Promise<OverviewRow[] | null> {
    // The download range is intentionally separate from all table filter controls.
    const params = new URLSearchParams({ export: "true" });
    params.set("date_from", exportRange.from);
    params.set("date_to", exportRange.to);
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

  async function handleDownloadCsv(exportRange: ExportDateRange): Promise<void> {
    setExporting("csv");
    const allRows = await fetchAllForExport(exportRange);
    setExporting(null);
    if (!allRows) return;
    downloadCsv(
      `data-overview_${exportRange.from}_to_${exportRange.to}.csv`,
      visibleColumns.map((col) => col.label),
      overviewCsvRows(allRows),
    );
  }

  async function handleDownloadExcel(exportRange: ExportDateRange): Promise<void> {
    setExporting("excel");
    const allRows = await fetchAllForExport(exportRange);
    setExporting(null);
    if (!allRows) return;
    downloadExcel(
      `data-overview_${exportRange.from}_to_${exportRange.to}.xlsx`,
      "Data overview",
      visibleColumns.map((col) => col.label),
      overviewCsvRows(allRows),
    );
  }

  return (
    <div className="flex flex-col" style={containerStyle}>
      {exportFormat && (
        <ExportDateRangeDialog
          session={session}
          boundsEndpoint="/api/data-overview/date-bounds"
          format={exportFormat}
          title="Data overview"
          onClose={() => setExportFormat(null)}
          onConfirm={(range) => {
            const format = exportFormat;
            setExportFormat(null);
            if (format === "csv") void handleDownloadCsv(range);
            else void handleDownloadExcel(range);
          }}
        />
      )}
      <div className="bg-bg-base border border-border rounded-md overflow-hidden shadow-xs">
        <div
          ref={aboveRef}
          className="sticky top-14 lg:top-0 z-30 bg-bg-base px-4 py-2.5 border-b border-border space-y-2.5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <OverviewIcon className="w-4 h-4 text-brand shrink-0" />
              <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
                Data Overview
              </h2>
              <span className="text-xs text-text-muted hidden sm:inline">
                Merged sales, inventory, and purchase records. Click on any
                source below to open its dedicated table.
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setExportFormat("csv")}
                disabled={rows === null}
                loading={exporting === "csv"}
              >
                <DownloadIcon className="w-4 h-4" />
                CSV
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setExportFormat("excel")}
                disabled={rows === null}
                loading={exporting === "excel"}
              >
                <DownloadIcon className="w-4 h-4" />
                Excel
              </Button>
              <RefreshButton onClick={reload} refreshing={isRefreshing} />
            </div>
          </div>

          {(total > 0 || hasActiveFilters) && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
              <div className="w-56 max-w-full">
                <Input
                  size="sm"
                  placeholder="Stock code or description"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  startIcon={<SearchIcon className="w-3.5 h-3.5" />}
                  className="h-8 text-xs"
                />
              </div>

              {(() => {
                const options =
                  branchOptions.length > 0
                    ? branchOptions
                    : (data?.branches ?? []);
                return options.length > 1 ? (
                  <div className="w-36 max-w-full">
                    <Select
                      size="sm"
                      value={branchFilter}
                      onChange={(e) => setBranchFilter(e.target.value)}
                      className="h-8 text-xs"
                    >
                      <option value="">All Branches</option>
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
                  <div className="w-36 max-w-full">
                    <Select
                      size="sm"
                      value={groupFilter}
                      onChange={(e) => setGroupFilter(e.target.value)}
                      className="h-8 text-xs"
                    >
                      <option value="">All Groups</option>
                      {groupOptions.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </Select>
                  </div>
                ) : null;
              })()}

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

        {rows === null && !failed && (
          <TableSkeleton rows={6} cols={COLUMNS.length + 1} />
        )}

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
                  <Tr key={row.id}>
                    <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                      {(page - 1) * PAGE_SIZE + idx + 1}
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
                page={page}
                totalPages={totalPages}
                totalItems={total}
                pageSize={PAGE_SIZE}
                onPageChange={(nextPage) => table.setPageIndex(nextPage - 1)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function DataOverviewTable({
  session,
  branchOptions,
  showBuyingPriceSource,
  saleColumns,
  saleFilters,
  purchaseColumns,
  purchaseFilters,
  saleListWindowDays = 90,
  purchaseListWindowDays = 90,
  initialTab = "overview",
  onTabChange,
  inventoryTarget,
}: DataOverviewTableProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<DataOverviewSubTab>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const handleSelectTab = (tab: DataOverviewSubTab): void => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  const resolvedSaleColumns = useMemo(
    () =>
      saleColumns ??
      (showBuyingPriceSource
        ? DEFAULT_SALE_COLUMNS
        : DEFAULT_SALE_COLUMNS.filter(
            (col) => col.key !== "Buying_Price_Source",
          )),
    [saleColumns, showBuyingPriceSource],
  );

  const resolvedSaleFilters: DataTableFilter<SaleRow>[] = useMemo(
    () =>
      saleFilters ?? [
        {
          type: "search",
          keys: ["StockCode", "Description"],
          placeholder: "Stock code or description",
          serverParam: "search",
        },
        {
          type: "select",
          key: "Branch",
          label: "Branch",
          options: branchOptions,
          serverParam: "branch",
        },
        {
          type: "dateRange",
          key: "Date",
          label: "Date",
          serverParam: { from: "date_from", to: "date_to" },
        },
      ],
    [saleFilters, branchOptions],
  );

  const resolvedPurchaseColumns = purchaseColumns ?? DEFAULT_PURCHASE_COLUMNS;

  const resolvedPurchaseFilters: DataTableFilter<PurchaseRow>[] = useMemo(
    () =>
      purchaseFilters ?? [
        {
          type: "search",
          keys: ["StockCode", "Description"],
          placeholder: "Stock code or description",
          serverParam: "search",
        },
        {
          type: "select",
          key: "Branch",
          label: "Branch",
          options: branchOptions,
          serverParam: "branch",
        },
        {
          type: "dateRange",
          key: "Date",
          label: "Date",
          serverParam: { from: "date_from", to: "date_to" },
        },
      ],
    [purchaseFilters, branchOptions],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="border-b border-border">
        <TabBar
          tabs={SUB_TABS}
          activeTab={activeTab}
          onSelect={handleSelectTab}
        />
      </div>

      {activeTab === "overview" && (
        <MergedDataOverviewTable
          session={session}
          branchOptions={branchOptions}
          showBuyingPriceSource={showBuyingPriceSource}
        />
      )}

      {activeTab === "sale" && (
        <SimpleDataTable<SaleRow>
          session={session}
          endpoint="/api/sales"
          title="Sale"
          description="Recent sales transactions and line-item profitability."
          icon={
            <div className="h-3.5 w-5 rounded-sm bg-emerald-400 shrink-0" />
          }
          columns={resolvedSaleColumns}
          filters={resolvedSaleFilters}
          rowKey={(row, i) => `${row.SlipNumber}-${i}`}
          emptyTitle="No sales yet"
          emptyDescription="Import a sales file to see it here."
          defaultWindowDays={saleListWindowDays}
          serverPaged
        />
      )}

      {activeTab === "inventory" && (
        <InventoryPage
          session={session}
          branchOptions={branchOptions}
          initialTab={inventoryTarget ?? undefined}
        />
      )}

      {activeTab === "purchase" && (
        <SimpleDataTable<PurchaseRow>
          session={session}
          endpoint="/api/purchases"
          title="Purchase"
          description="Supplier purchase orders and receiving history."
          icon={<div className="h-3.5 w-5 rounded-sm bg-pink-400 shrink-0" />}
          columns={resolvedPurchaseColumns}
          filters={resolvedPurchaseFilters}
          rowKey={(row, i) => `${row.StockCode}-${row.Date}-${i}`}
          emptyTitle="No purchases yet"
          emptyDescription="Import a purchase file to see it here."
          defaultWindowDays={purchaseListWindowDays}
          serverPaged
        />
      )}
    </div>
  );
}
