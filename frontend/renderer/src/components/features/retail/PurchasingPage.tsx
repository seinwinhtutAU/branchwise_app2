import { useState, useMemo, useEffect } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { cn } from "@renderer/lib/utils";
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  FloatingPortal,
  useHover,
  useClick,
  useDismiss,
  useRole,
  useInteractions,
} from "@floating-ui/react";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { Input } from "@renderer/components/ui/Input";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { TableSkeleton } from "@renderer/components/ui/Skeleton";
import { Panel } from "@renderer/components/ui/Panel";
import { FigureCard } from "@renderer/components/features/wholesale/shared/ui";
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
import { InfoLabel } from "@renderer/components/ui/InfoTooltip";
import {
  ClipboardIcon,
  DownloadIcon,
  SearchIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import type { Profile } from "@renderer/components/features/types";

function AbcHelpPopover({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "bottom",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const hover = useHover(context, {
    move: false,
    delay: { open: 100, close: 150 },
  });
  const click = useClick(context);
  const dismiss = useDismiss(context, { outsidePressEvent: "mousedown" });
  const role = useRole(context, { role: "tooltip" });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    click,
    dismiss,
    role,
  ]);

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        {...getReferenceProps()}
        className={cn(
          "inline-flex items-center justify-center p-0.5 rounded text-text-muted hover:text-brand hover:bg-brand-subtle/30 transition-colors focus:outline-none cursor-pointer",
          isOpen && "text-brand bg-brand-subtle/30",
          className,
        )}
        aria-label="ABC Analysis Info"
      >
        <span aria-hidden="true" className="text-[13px] leading-none">
          ⓘ
        </span>
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 max-w-64 rounded-md border border-border bg-bg-base px-2.5 py-2 text-left text-xs leading-relaxed text-text-secondary shadow-lg"
          >
            A ≈ 80% of revenue, B ≈ 15%, C ≈ 5%; N has no sales.
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function RecommendationHelpPopover({
  className,
}: {
  className?: string;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "bottom",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [offset(6), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const hover = useHover(context, {
    move: false,
    delay: { open: 100, close: 150 },
  });
  const click = useClick(context);
  const dismiss = useDismiss(context, { outsidePressEvent: "mousedown" });
  const role = useRole(context, { role: "tooltip" });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    click,
    dismiss,
    role,
  ]);

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        {...getReferenceProps()}
        className={cn(
          "inline-flex items-center justify-center p-0.5 rounded text-text-muted hover:text-brand hover:bg-brand-subtle/30 transition-colors focus:outline-none cursor-pointer",
          isOpen && "text-brand bg-brand-subtle/30",
          className,
        )}
        aria-label="Recommendation Info"
      >
        <span aria-hidden="true" className="text-[13px] leading-none">
          ⓘ
        </span>
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 max-w-64 rounded-md border border-border bg-bg-base px-2.5 py-2 text-left text-xs leading-relaxed text-text-secondary shadow-lg"
          >
            Urgent: no stock. Reorder: below target. Hold: enough stock. Review:
            no recent sales.
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

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
  TargetBufferMonths?: number;
  Recommendation:
    "Urgent Reorder" | "Reorder" | "Hold / Monitor" | "Review / Do Not Reorder";
}

interface PurchasingSummary {
  total_products: number;
  urgent_reorder_count: number;
  reorder_count: number;
  hold_monitor_count: number;
  review_count: number;
  total_suggested_units: number;
  a_count?: number;
  b_count?: number;
  c_count?: number;
  n_count?: number;
  buffer_months?: { a: number; b: number; c: number };
}

interface PurchasingResponse {
  branch_id: string;
  branch_name: string;
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
  selectedBranchId?: string;
}

type RecommendationFilter =
  | "all"
  | "Urgent Reorder"
  | "Reorder"
  | "Hold / Monitor"
  | "Review / Do Not Reorder";

type AbcFilter = "all" | "A" | "B" | "C" | "N";

export function PurchasingPage({
  session,
  profile,
  branchOptions,
  selectedBranchId = "",
}: Props): React.JSX.Element {
  const isAdmin = profile !== null && profile.branch_id === null;

  // Follows the left-nav branch switcher choice
  const activeBranchId =
    (isAdmin ? selectedBranchId : "") ||
    (isAdmin && branchOptions.length > 0 ? branchOptions[0].id : "");

  const [activeRecFilter, setActiveRecFilter] =
    useState<RecommendationFilter>("all");
  const [activeAbcFilter, setActiveAbcFilter] = useState<AbcFilter>("all");
  const [search, setSearch] = useState<string>("");
  const [page, setPage] = useState<number>(1);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const pageSize = 20;

  useEffect(() => {
    setPage(1);
  }, [selectedBranchId]);

  // Construct URL query for data fetching
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (activeBranchId) params.set("branch_id", activeBranchId);
    if (search.trim()) params.set("search", search.trim());
    if (activeRecFilter !== "all")
      params.set("recommendation", activeRecFilter);
    if (activeAbcFilter !== "all") params.set("abc_class", activeAbcFilter);
    params.set("page", String(page));
    params.set("page_size", String(pageSize));

    return `${apiBaseUrl}/api/purchasing/recommendations?${params.toString()}`;
  }, [activeBranchId, search, activeRecFilter, activeAbcFilter, page]);

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
    a_count: 0,
    b_count: 0,
    c_count: 0,
    n_count: 0,
  };

  const rows = data?.rows ?? [];
  const totalItems = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  const aCount =
    summary.a_count ?? rows.filter((r) => r.ABC_Class === "A").length;
  const bCount =
    summary.b_count ?? rows.filter((r) => r.ABC_Class === "B").length;
  const cCount =
    summary.c_count ?? rows.filter((r) => r.ABC_Class === "C").length;
  const nCount =
    summary.n_count ?? rows.filter((r) => r.ABC_Class === "N").length;

  const hasActiveFilters =
    search.trim() !== "" ||
    activeRecFilter !== "all" ||
    activeAbcFilter !== "all";

  function clearFilters(): void {
    setSearch("");
    setActiveRecFilter("all");
    setActiveAbcFilter("all");
    setPage(1);
  }

  // Reset to page 1 whenever filters or branch change
  function handleRecFilter(filter: RecommendationFilter): void {
    setActiveRecFilter((prev) => (prev === filter ? "all" : filter));
    setPage(1);
  }

  function handleAbcFilter(abc: AbcFilter): void {
    setActiveAbcFilter((prev) => (prev === abc ? "all" : abc));
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
      params.set("reorder_only", String(reorderOnly));
      if (activeBranchId) params.set("branch_id", activeBranchId);

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

  function renderRecBadge(
    rec: PurchasingItem["Recommendation"],
  ): React.JSX.Element {
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

  const ABC_CONFIG: Record<
    PurchasingItem["ABC_Class"],
    { label: string; shortDesc: string; longDesc: string }
  > = {
    A: {
      label: "A (Top 80%)",
      shortDesc: "Top 80% Rev",
      longDesc: "Class A: Top 80% revenue drivers (Core best sellers)",
    },
    B: {
      label: "B (Mid 15%)",
      shortDesc: "Mid 15% Rev",
      longDesc: "Class B: Next 15% revenue drivers (Steady sellers)",
    },
    C: {
      label: "C (Tail 5%)",
      shortDesc: "Tail 5% Rev",
      longDesc: "Class C: Bottom 5% revenue drivers (Slow movers)",
    },
    N: {
      label: "N (No Sales)",
      shortDesc: "No Sales",
      longDesc: "Class N: No sales recorded in the period",
    },
  };

  function renderAbcBadge(abc: PurchasingItem["ABC_Class"]): React.JSX.Element {
    const config = ABC_CONFIG[abc];
    switch (abc) {
      case "A":
        return (
          <Badge variant="brand" title={config.longDesc}>
            A
          </Badge>
        );
      case "B":
        return (
          <Badge variant="info" title={config.longDesc}>
            B
          </Badge>
        );
      case "C":
        return (
          <Badge variant="default" title={config.longDesc}>
            C
          </Badge>
        );
      case "N":
        return (
          <Badge variant="default" title={config.longDesc}>
            N
          </Badge>
        );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* KPI Cards Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FigureCard
          label={
            <InfoLabel description="A-tier products that are out of stock and need immediate attention.">
              Urgent Reorder
            </InfoLabel>
          }
          value={String(summary.urgent_reorder_count)}
          sub="A-tier & out of stock"
          tone="error"
        />

        <FigureCard
          label={
            <InfoLabel description="Products below their target stock buffer.">
              Reorder
            </InfoLabel>
          }
          value={String(summary.reorder_count)}
          sub="below target buffer"
          tone="warning"
        />

        <FigureCard
          label={
            <InfoLabel description="Total units recommended for the current reorder list.">
              Suggested Units
            </InfoLabel>
          }
          value={summary.total_suggested_units.toLocaleString()}
          sub="recommended order volume"
          tone="brand"
        />
      </div>

      {/* Unified Table Panel */}
      <Panel className="shadow-xs">
        <div className="sticky top-14 lg:top-0 z-30 bg-bg-base px-4 py-2.5 border-b border-border space-y-2.5">
          {/* Top Bar: Title & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
                Reorder Recommendations
              </h2>
              <span className="text-xs text-text-muted hidden sm:inline">
                ABC tier stock buffer replenishment suggestions.
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleExport(false)}
                disabled={isExporting || totalItems === 0}
                className="flex items-center gap-1.5"
              >
                <DownloadIcon className="w-4 h-4" />
                CSV (All)
              </Button>

              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleExport(true)}
                disabled={
                  isExporting ||
                  summary.urgent_reorder_count + summary.reorder_count === 0
                }
                className="flex items-center gap-1.5"
              >
                <DownloadIcon className="w-4 h-4" />
                Reorder List
              </Button>

              <RefreshButton onClick={reload} refreshing={isRefreshing} />
            </div>
          </div>

          {/* Filter Row: Search & Pills aligned to the left */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/60">
            <div className="w-52 sm:w-60 max-w-full">
              <Input
                size="sm"
                type="text"
                placeholder="Stock code or description…"
                value={search}
                onChange={handleSearchChange}
                startIcon={<SearchIcon className="w-3.5 h-3.5" />}
                className="h-8 text-xs"
              />
            </div>

            {/* Recommendation Tab Pills */}
            <div className="flex items-center gap-1 bg-bg-subtle/70 p-0.5 rounded-md border border-border text-xs">
              <button
                type="button"
                onClick={() => handleRecFilter("all")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs",
                  activeRecFilter === "all"
                    ? "bg-brand text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                All ({summary.total_products})
              </button>
              <button
                type="button"
                onClick={() => handleRecFilter("Urgent Reorder")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs",
                  activeRecFilter === "Urgent Reorder"
                    ? "bg-error text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-error",
                )}
              >
                Urgent ({summary.urgent_reorder_count})
              </button>
              <button
                type="button"
                onClick={() => handleRecFilter("Reorder")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs",
                  activeRecFilter === "Reorder"
                    ? "bg-warning text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-warning",
                )}
              >
                Reorder ({summary.reorder_count})
              </button>
              <button
                type="button"
                onClick={() => handleRecFilter("Hold / Monitor")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs",
                  activeRecFilter === "Hold / Monitor"
                    ? "bg-info text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-info",
                )}
              >
                Hold ({summary.hold_monitor_count})
              </button>
              <button
                type="button"
                onClick={() => handleRecFilter("Review / Do Not Reorder")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs",
                  activeRecFilter === "Review / Do Not Reorder"
                    ? "bg-text-secondary text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                Review ({summary.review_count})
              </button>
              <RecommendationHelpPopover />
            </div>

            {/* ABC Filter Pills */}
            <div className="flex items-center gap-1 bg-bg-subtle/70 p-0.5 rounded-md border border-border text-xs">
              <button
                type="button"
                onClick={() => handleAbcFilter("all")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs",
                  activeAbcFilter === "all"
                    ? "bg-brand text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                All ABC ({summary.total_products})
              </button>
              <button
                type="button"
                onClick={() => handleAbcFilter("A")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs",
                  activeAbcFilter === "A"
                    ? "bg-brand text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                A ({aCount})
              </button>
              <button
                type="button"
                onClick={() => handleAbcFilter("B")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs",
                  activeAbcFilter === "B"
                    ? "bg-brand text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                B ({bCount})
              </button>
              <button
                type="button"
                onClick={() => handleAbcFilter("C")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs",
                  activeAbcFilter === "C"
                    ? "bg-brand text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                C ({cCount})
              </button>
              <button
                type="button"
                onClick={() => handleAbcFilter("N")}
                className={cn(
                  "px-2 py-0.5 rounded font-medium transition-colors text-xs",
                  activeAbcFilter === "N"
                    ? "bg-brand text-white font-semibold shadow-xs"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                N ({nCount})
              </button>
              <AbcHelpPopover />
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
        </div>

        {/* Table Content */}
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
          <TableSkeleton rows={10} cols={10} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon className="w-6 h-6" />}
            title="No matching products found"
            description="Try changing your search keywords or adjusting the filter criteria."
            action={
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                Clear Filters
              </Button>
            }
          />
        ) : (
          <>
            <TableContainer
              className="border-0 rounded-none overflow-y-auto"
              style={{
                maxHeight: "calc(100vh - var(--sticky-offset, 0px) - 8rem)",
              }}
            >
              <Thead className="top-0">
                <Tr>
                  <Th className="w-36">
                    <div className="inline-flex items-center gap-1">
                      <span>Recommendation</span>
                      <RecommendationHelpPopover />
                    </div>
                  </Th>
                  <Th className="w-28">
                    <InfoLabel description="Unique code used to identify the product.">
                      Stock Code
                    </InfoLabel>
                  </Th>
                  <Th className="min-w-[14rem]">
                    <InfoLabel description="Name of the product.">
                      Description
                    </InfoLabel>
                  </Th>
                  <Th className="w-24">
                    <InfoLabel description="Product group from the source data.">
                      Group
                    </InfoLabel>
                  </Th>
                  <Th
                    className="w-28 text-right bg-brand-subtle/10 font-semibold text-brand"
                    title="Reorder Qty = (Monthly Sales × ABC Target Buffer) - On Hand (Configurable in Settings)"
                  >
                    <InfoLabel description="Suggested units to order based on sales and the target stock buffer.">
                      Reorder Qty
                    </InfoLabel>
                  </Th>
                  <Th className="w-20 text-right">
                    <InfoLabel description="Current quantity available in stock.">
                      On Hand
                    </InfoLabel>
                  </Th>
                  <Th className="w-24 text-right">
                    <InfoLabel description="Units sold in the current monthly sales period.">
                      Monthly Sales
                    </InfoLabel>
                  </Th>
                  <Th className="w-20 text-center">
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>ABC</span>
                      <AbcHelpPopover />
                    </div>
                  </Th>
                  <Th className="w-24 text-right">
                    <InfoLabel description="Recorded buying price for one unit.">
                      Buying Price
                    </InfoLabel>
                  </Th>
                  <Th className="w-24 text-right">
                    <InfoLabel description="Selling price for one unit.">
                      Selling Price
                    </InfoLabel>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {rows.map((row) => {
                  const isOutOfStock = row.OnHandQty <= 0;
                  const hasSuggested = row.SuggestedReorderQty > 0;

                  return (
                    <Tr key={row.StockCode}>
                      {/* Recommendation */}
                      <Td className="whitespace-nowrap">
                        {renderRecBadge(row.Recommendation)}
                      </Td>

                      {/* Stock Code */}
                      <Td>
                        <div className="flex items-center gap-1 whitespace-nowrap">
                          <span className="font-mono text-xs font-semibold text-brand">
                            {row.StockCode}
                          </span>
                          <CopyButton value={row.StockCode} what="stock code" />
                        </div>
                      </Td>

                      {/* Description */}
                      <Td>
                        <span className="font-medium text-text-primary line-clamp-1">
                          {row.Description || "—"}
                        </span>
                      </Td>

                      {/* Group */}
                      <Td>
                        <span className="text-xs text-text-secondary whitespace-nowrap">
                          {row.GroupName || "—"}
                        </span>
                      </Td>

                      {/* Reorder Qty */}
                      <Td
                        className={cn(
                          "text-right text-sm tabular-nums font-bold bg-brand-subtle/10",
                          hasSuggested
                            ? "text-brand"
                            : "text-text-muted font-normal",
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

                      {/* On Hand Qty */}
                      <Td
                        className={cn(
                          "text-right text-xs tabular-nums font-medium",
                          isOutOfStock
                            ? "text-error font-bold"
                            : "text-text-primary",
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

                      {/* ABC */}
                      <Td>{renderAbcBadge(row.ABC_Class)}</Td>

                      {/* Buying Price */}
                      <Td className="text-right text-xs tabular-nums text-text-secondary">
                        {row.BuyingPrice != null
                          ? row.BuyingPrice.toLocaleString()
                          : "—"}
                      </Td>

                      {/* Selling Price */}
                      <Td className="text-right text-xs tabular-nums text-text-secondary">
                        {row.SellingPrice != null
                          ? row.SellingPrice.toLocaleString()
                          : "—"}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableContainer>

            {/* Docked Pagination */}
            <div className="border-t border-border bg-bg-base">
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
      </Panel>
    </div>
  );
}

export default PurchasingPage;
