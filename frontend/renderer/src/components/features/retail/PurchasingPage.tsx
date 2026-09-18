import { useState, useMemo } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { cn } from "@renderer/lib/utils";
import { Card } from "@renderer/components/ui/Card";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import { EmptyState } from "@renderer/components/ui/EmptyState";
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
import { CopyButton } from "@renderer/components/ui/CopyButton";
import {
  ClipboardIcon,
  DownloadIcon,
  SearchIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import type { Profile } from "@renderer/components/features/types";

export interface PurchasingItem {
  StockCode: string;
  Description: string;
  GroupName: string;
  ABC_Class: "A" | "B" | "C" | "N";
  PriceRange: "Low" | "Mid" | "High";
  SellingPrice: number | null;
  BuyingPrice: number | null;
  TotalQtySold: number;
  TotalSalesValue: number;
  AvgMonthlySales: number;
  OnHandQty: number;
  StockCoverageMonths: number;
  StockStatus: string;
  SuggestedReorderQty: number;
  RecentPurchaseQty: number;
  LastPurchaseDate: string | null;
  PurchaseNote: string;
  Recommendation:
    | "Urgent Reorder"
    | "Reorder"
    | "Hold / Monitor"
    | "Review / Do Not Reorder";
}

interface PurchasingSummary {
  total_products: number;
  urgent_reorder_count: number;
  reorder_count: number;
  hold_monitor_count: number;
  review_count: number;
  total_suggested_units: number;
}

interface PurchasingResponse {
  branch_id: string;
  branch_name: string;
  target_months: number;
  summary: PurchasingSummary;
  total: number;
  rows: PurchasingItem[];
}

export interface BranchOption {
  id: string;
  name: string;
}

interface Props {
  session: Session;
  profile: Profile | null;
  branchOptions: BranchOption[];
}

type RecommendationFilter =
  | "all"
  | "Urgent Reorder"
  | "Reorder"
  | "Hold / Monitor"
  | "Review / Do Not Reorder";

type AbcFilter = "all" | "A" | "B" | "C" | "N";

const TARGET_MONTH_OPTIONS = [
  { value: "1", label: "1 Month Buffer" },
  { value: "2", label: "2 Months Buffer" },
  { value: "3", label: "3 Months Buffer (Recommended)" },
  { value: "6", label: "6 Months Buffer" },
];

export function PurchasingPage({
  session,
  profile,
  branchOptions,
}: Props): React.JSX.Element {
  const isAdmin = profile !== null && profile.branch_id === null;

  const [selectedBranch, setSelectedBranch] = useState<string>(
    isAdmin && branchOptions.length > 0 ? branchOptions[0].id : "",
  );
  const [targetMonths, setTargetMonths] = useState<string>("3");
  const [activeRecFilter, setActiveRecFilter] =
    useState<RecommendationFilter>("all");
  const [activeAbcFilter, setActiveAbcFilter] = useState<AbcFilter>("all");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const pageSize = 50;

  // Construct URL query for data fetching
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("target_months", targetMonths);
    if (selectedBranch) params.set("branch_id", selectedBranch);
    if (search.trim()) params.set("search", search.trim());
    if (activeRecFilter !== "all") params.set("recommendation", activeRecFilter);
    if (activeAbcFilter !== "all") params.set("abc_class", activeAbcFilter);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));

    return `${apiBaseUrl}/api/purchasing/recommendations?${params.toString()}`;
  }, [
    targetMonths,
    selectedBranch,
    search,
    activeRecFilter,
    activeAbcFilter,
    page,
  ]);

  const { data, isRefreshing, failed, reload } =
    useUrlQuery<PurchasingResponse>(
      queryUrl,
      session,
      "purchasing recommendations",
    );

  const summary = data?.summary ?? {
    total_products: 0,
    urgent_reorder_count: 0,
    reorder_count: 0,
    hold_monitor_count: 0,
    review_count: 0,
    total_suggested_units: 0,
  };

  const rows = data?.rows ?? [];
  const totalItems = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  // Reset to page 1 whenever filters or branch change
  function handleRecFilter(filter: RecommendationFilter): void {
    setActiveRecFilter(filter);
    setPage(1);
  }

  function handleAbcFilter(abc: AbcFilter): void {
    setActiveAbcFilter(abc);
    setPage(1);
  }

  function handleSearchChange(e: React.ChangeEvent<HTMLInputElement>): void {
    setSearch(e.target.value);
    setPage(1);
  }

  // Direct CSV file download via API
  async function handleExport(reorderOnly: boolean): Promise<void> {
    try {
      setIsExporting(true);
      const params = new URLSearchParams();
      params.set("target_months", targetMonths);
      params.set("reorder_only", String(reorderOnly));
      if (selectedBranch) params.set("branch_id", selectedBranch);

      const exportUrl = `${apiBaseUrl}/api/purchasing/export?${params.toString()}`;
      const res = await fetch(exportUrl, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!res.ok) {
        throw new Error(`Export failed with status: ${res.status}`);
      }

      const blob = await res.blob();
      const contentDisposition = res.headers.get("Content-Disposition");
      let filename = reorderOnly
        ? "reorder_list.csv"
        : "purchasing_decision.csv";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];
      }

      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error("Export error:", err);
    } finally {
      setIsExporting(false);
    }
  }

  function renderRecBadge(rec: PurchasingItem["Recommendation"]): React.JSX.Element {
    switch (rec) {
      case "Urgent Reorder":
        return <Badge variant="error">Urgent Reorder</Badge>;
      case "Reorder":
        return <Badge variant="warning">Reorder</Badge>;
      case "Hold / Monitor":
        return <Badge variant="info">Hold / Monitor</Badge>;
      case "Review / Do Not Reorder":
        return <Badge variant="default">Review</Badge>;
      default:
        return <Badge variant="default">{rec}</Badge>;
    }
  }

  function renderAbcBadge(abc: PurchasingItem["ABC_Class"]): React.JSX.Element {
    switch (abc) {
      case "A":
        return <Badge variant="brand">A</Badge>;
      case "B":
        return <Badge variant="info">B</Badge>;
      case "C":
        return <Badge variant="default">C</Badge>;
      case "N":
        return <Badge variant="default">No Sales</Badge>;
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* Top Header & Export Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-text-primary tracking-tight">
              Purchasing Decision Support
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-brand-subtle text-brand font-medium">
              Decision Engine
            </span>
          </div>
          <p className="text-sm text-text-muted mt-0.5">
            ABC revenue contribution, inventory run-rate, and automated replenishment recommendations.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <RefreshButton
            onClick={reload}
            refreshing={isRefreshing}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() => handleExport(false)}
            disabled={isExporting || totalItems === 0}
            className="flex items-center gap-1.5"
          >
            <DownloadIcon className="w-4 h-4" />
            Export All Decisions
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => handleExport(true)}
            disabled={isExporting || summary.urgent_reorder_count + summary.reorder_count === 0}
            className="flex items-center gap-1.5 shadow-xs"
          >
            <DownloadIcon className="w-4 h-4" />
            Export Reorder List (CSV)
          </Button>
        </div>
      </div>

      {/* KPI Cards Summary Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* Urgent Reorder */}
        <Card
          interactive
          onClick={() => handleRecFilter("Urgent Reorder")}
          className={cn(
            "p-3.5 border transition-all",
            activeRecFilter === "Urgent Reorder"
              ? "ring-2 ring-error border-transparent bg-error-subtle/10"
              : "hover:border-error/50",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-error uppercase tracking-wider">
              Urgent Reorder
            </span>
            <Badge variant="error" className="text-[10px] px-1.5 py-0">
              A & Out of Stock
            </Badge>
          </div>
          <p className="text-2xl font-bold text-text-primary mt-2">
            {summary.urgent_reorder_count}
          </p>
          <p className="text-xs text-text-muted mt-0.5">Products lost revenue</p>
        </Card>

        {/* Regular Reorder */}
        <Card
          interactive
          onClick={() => handleRecFilter("Reorder")}
          className={cn(
            "p-3.5 border transition-all",
            activeRecFilter === "Reorder"
              ? "ring-2 ring-warning border-transparent bg-warning-subtle/10"
              : "hover:border-warning/50",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-warning uppercase tracking-wider">
              Reorder
            </span>
            <Badge variant="warning" className="text-[10px] px-1.5 py-0">
              Low Stock
            </Badge>
          </div>
          <p className="text-2xl font-bold text-text-primary mt-2">
            {summary.reorder_count}
          </p>
          <p className="text-xs text-text-muted mt-0.5">Below target coverage</p>
        </Card>

        {/* Suggested Reorder Units */}
        <Card className="p-3.5 border border-brand/20 bg-brand-subtle/10">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-brand uppercase tracking-wider">
              Suggested Units
            </span>
            <Badge variant="brand" className="text-[10px] px-1.5 py-0">
              Total Units
            </Badge>
          </div>
          <p className="text-2xl font-bold text-brand mt-2">
            {summary.total_suggested_units.toLocaleString()}
          </p>
          <p className="text-xs text-text-muted mt-0.5">Recommended order volume</p>
        </Card>

        {/* Hold / Monitor */}
        <Card
          interactive
          onClick={() => handleRecFilter("Hold / Monitor")}
          className={cn(
            "p-3.5 border transition-all",
            activeRecFilter === "Hold / Monitor"
              ? "ring-2 ring-info border-transparent bg-info-subtle/10"
              : "hover:border-info/50",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-info uppercase tracking-wider">
              Hold / Monitor
            </span>
            <Badge variant="info" className="text-[10px] px-1.5 py-0">
              Adequate Stock
            </Badge>
          </div>
          <p className="text-2xl font-bold text-text-primary mt-2">
            {summary.hold_monitor_count}
          </p>
          <p className="text-xs text-text-muted mt-0.5">Sufficient inventory</p>
        </Card>

        {/* Review / Do Not Reorder */}
        <Card
          interactive
          onClick={() => handleRecFilter("Review / Do Not Reorder")}
          className={cn(
            "p-3.5 border transition-all",
            activeRecFilter === "Review / Do Not Reorder"
              ? "ring-2 ring-border-strong border-transparent bg-bg-subtle"
              : "hover:border-border-strong",
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Review / Hold
            </span>
            <Badge variant="default" className="text-[10px] px-1.5 py-0">
              No Sales
            </Badge>
          </div>
          <p className="text-2xl font-bold text-text-primary mt-2">
            {summary.review_count}
          </p>
          <p className="text-xs text-text-muted mt-0.5">Audit before purchase</p>
        </Card>
      </div>

      {/* Control Filter Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 bg-bg-subtle/50 rounded-lg border border-border">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Admin Branch Selector */}
          {isAdmin && branchOptions.length > 0 && (
            <div className="w-48">
              <Select
                value={selectedBranch}
                onChange={(e) => {
                  setSelectedBranch(e.target.value);
                  setPage(1);
                }}
                className="h-8 text-xs"
              >
                {branchOptions.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Buffer Selection */}
          <div className="w-56">
            <Select
              value={targetMonths}
              onChange={(e) => {
                setTargetMonths(e.target.value);
                setPage(1);
              }}
              className="h-8 text-xs"
            >
              {TARGET_MONTH_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </div>

          {/* Recommendation Tab Pills */}
          <div className="flex items-center gap-1 bg-bg-base p-0.5 rounded-md border border-border text-xs">
            <button
              type="button"
              onClick={() => handleRecFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-colors",
                activeRecFilter === "all"
                  ? "bg-brand-subtle text-brand font-semibold shadow-xs"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              All ({summary.total_products})
            </button>
            <button
              type="button"
              onClick={() => handleRecFilter("Urgent Reorder")}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-colors",
                activeRecFilter === "Urgent Reorder"
                  ? "bg-error-subtle text-error font-semibold shadow-xs"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              Urgent ({summary.urgent_reorder_count})
            </button>
            <button
              type="button"
              onClick={() => handleRecFilter("Reorder")}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-colors",
                activeRecFilter === "Reorder"
                  ? "bg-warning-subtle text-warning font-semibold shadow-xs"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              Reorder ({summary.reorder_count})
            </button>
            <button
              type="button"
              onClick={() => handleRecFilter("Hold / Monitor")}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-colors",
                activeRecFilter === "Hold / Monitor"
                  ? "bg-info-subtle text-info font-semibold shadow-xs"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              Hold ({summary.hold_monitor_count})
            </button>
            <button
              type="button"
              onClick={() => handleRecFilter("Review / Do Not Reorder")}
              className={cn(
                "px-2.5 py-1 rounded font-medium transition-colors",
                activeRecFilter === "Review / Do Not Reorder"
                  ? "bg-bg-raised text-text-secondary font-semibold shadow-xs"
                  : "text-text-muted hover:text-text-primary",
              )}
            >
              Review ({summary.review_count})
            </button>
          </div>
        </div>

        {/* Search Input & ABC Pills */}
        <div className="flex items-center gap-2">
          {/* ABC Filter Pills */}
          <div className="flex items-center gap-1 bg-bg-base p-0.5 rounded-md border border-border text-xs">
            {(["all", "A", "B", "C", "N"] as AbcFilter[]).map((abc) => (
              <button
                key={abc}
                type="button"
                onClick={() => handleAbcFilter(abc)}
                className={cn(
                  "px-2 py-1 rounded font-medium transition-colors",
                  activeAbcFilter === abc
                    ? "bg-brand-subtle text-brand font-semibold shadow-xs"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {abc === "all" ? "All ABC" : abc}
              </button>
            ))}
          </div>

          <div className="relative w-52 sm:w-64">
            <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            <Input
              type="text"
              placeholder="Search code or description..."
              value={search}
              onChange={handleSearchChange}
              className="h-8 pl-8 text-xs"
            />
          </div>
        </div>
      </div>

      {/* Main Table Content */}
      <div className="flex flex-col gap-2">
        {failed ? (
          <EmptyState
            icon={<WarningIcon className="w-6 h-6 text-error" />}
            title="Failed to load purchasing recommendations"
            description="Could not connect to the decision engine. Please try reloading."
            action={
              <Button variant="secondary" size="sm" onClick={() => reload()}>
                Retry
              </Button>
            }
          />
        ) : !data && isRefreshing ? (
          <TableSkeleton rows={10} cols={12} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon className="w-6 h-6" />}
            title="No matching products found"
            description="Try changing your search keywords or adjusting the filter criteria."
            action={
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setActiveRecFilter("all");
                  setActiveAbcFilter("all");
                }}
              >
                Clear Filters
              </Button>
            }
          />
        ) : (
          <>
            <TableContainer>
              <Thead>
                <Tr>
                  <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
                    #
                  </Th>
                  <Th className="w-36">Recommendation</Th>
                  <Th className="w-28">Stock Code</Th>
                  <Th className="min-w-[14rem]">Description</Th>
                  <Th className="w-20">ABC</Th>
                  <Th className="w-20">Tier</Th>
                  <Th className="w-24 text-right">Selling Price</Th>
                  <Th className="w-24 text-right">On Hand</Th>
                  <Th className="w-24 text-right">Monthly Sales</Th>
                  <Th className="w-24 text-right">Coverage</Th>
                  <Th className="w-28 text-right bg-brand-subtle/10 font-semibold text-brand">
                    Suggested Reorder
                  </Th>
                  <Th className="w-40">Recent Purchase Note</Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((row, index) => {
                  const isOutOfStock = row.OnHandQty <= 0;
                  const hasSuggested = row.SuggestedReorderQty > 0;
                  const hasRecentPurchase =
                    row.PurchaseNote === "Recent Purchase Exists";

                  return (
                    <Tr key={row.StockCode}>
                      {/* Row Index */}
                      <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                        {(page - 1) * pageSize + index + 1}
                      </Td>

                      {/* Recommendation */}
                      <Td className="whitespace-nowrap">
                        {renderRecBadge(row.Recommendation)}
                      </Td>

                      {/* Stock Code */}
                      <Td>
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="font-mono text-xs font-semibold text-brand">{row.StockCode}</span>
                          <CopyButton value={row.StockCode} what="stock code" />
                        </div>
                      </Td>

                      {/* Description */}
                      <Td>
                        <div className="flex flex-col">
                          <span className="font-medium text-text-primary line-clamp-1">
                            {row.Description || "—"}
                          </span>
                          {row.GroupName && (
                            <span className="text-[11px] text-text-muted">
                              {row.GroupName}
                            </span>
                          )}
                        </div>
                      </Td>

                      {/* ABC */}
                      <Td>{renderAbcBadge(row.ABC_Class)}</Td>

                      {/* Price Tier */}
                      <Td>
                        <span className="text-xs font-medium text-text-secondary">
                          {row.PriceRange}
                        </span>
                      </Td>

                      {/* Selling Price */}
                      <Td className="text-right text-xs tabular-nums text-text-secondary">
                        {row.SellingPrice != null
                          ? row.SellingPrice.toLocaleString()
                          : "—"}
                      </Td>

                      {/* On Hand Qty */}
                      <Td
                        className={cn(
                          "text-right text-xs tabular-nums font-medium",
                          isOutOfStock ? "text-error font-bold" : "text-text-primary",
                        )}
                      >
                        {row.OnHandQty}
                      </Td>

                      {/* Avg Monthly Sales */}
                      <Td className="text-right text-xs tabular-nums text-text-secondary">
                        {row.AvgMonthlySales > 0
                          ? row.AvgMonthlySales.toFixed(1)
                          : "0.0"}
                      </Td>

                      {/* Stock Coverage Months */}
                      <Td className="text-right text-xs tabular-nums text-text-secondary">
                        {row.StockCoverageMonths > 0
                          ? `${row.StockCoverageMonths.toFixed(1)} mo`
                          : isOutOfStock
                            ? "0 mo"
                            : "—"}
                      </Td>

                      {/* Suggested Reorder Qty */}
                      <Td
                        className={cn(
                          "text-right text-sm tabular-nums font-bold bg-brand-subtle/10",
                          hasSuggested ? "text-brand" : "text-text-muted font-normal",
                        )}
                      >
                        {hasSuggested ? (
                          <span className="inline-flex items-center justify-end gap-1">
                            +{row.SuggestedReorderQty}
                          </span>
                        ) : (
                          "0"
                        )}
                      </Td>

                      {/* Recent Purchase Alert */}
                      <Td>
                        {hasRecentPurchase ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-600 border border-amber-500/20 whitespace-nowrap">
                              <WarningIcon className="w-3 h-3 text-amber-600 shrink-0" />
                              Order Pending ({row.RecentPurchaseQty})
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-text-muted">—</span>
                        )}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableContainer>

            {/* Pagination Controls */}
            <div className="pt-2">
              <Pagination
                page={page}
                totalPages={totalPages}
                totalItems={totalItems}
                pageSize={pageSize}
                onPageChange={(newPage) => setPage(newPage)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PurchasingPage;
