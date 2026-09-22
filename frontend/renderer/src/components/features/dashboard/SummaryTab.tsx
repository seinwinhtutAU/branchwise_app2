import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { Button } from "@renderer/components/ui/Button";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { DashboardIcon } from "@renderer/components/ui/icons";
import { cn } from "@renderer/lib/utils";
import { RefreshingHint } from "./shared";
import {
  dashboardUrl,
  formatCompactMmk,
  formatExecutiveDate,
  formatExecutivePeriod,
  type PeriodKey,
  type SummaryDashboardData,
} from "./helpers";

interface Props {
  session: Session;
  branchId: string;
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  canLoad: boolean;
  onOpenDashboard?: (tab: "revenue" | "cost" | "inventory" | "customer") => void;
}

function DrilldownCard({
  children,
  label,
  onClick,
  className,
}: {
  children: React.ReactNode;
  label: string;
  onClick?: () => void;
  className: string;
}): React.JSX.Element {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? label : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      className={className}
    >
      {children}
    </div>
  );
}

/**
 * Donut Chart for Inventory Condition (Dead stock % vs Active)
 * Uses the app's main brand color token.
 */
function InventoryDonutChart({
  deadStockPct,
  deadStockCount,
  activeCount,
  totalCount,
}: {
  deadStockPct: number;
  deadStockCount: number;
  activeCount: number;
  totalCount: number;
}): React.JSX.Element {
  const size = 116;
  const strokeWidth = 18;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const deadPctClamped = Math.min(Math.max(deadStockPct, 0), 100);
  const deadStrokeDash = (deadPctClamped / 100) * circumference;

  return (
    <div className="flex items-center justify-between gap-3 py-1">
      {/* SVG Donut */}
      <div className="relative flex items-center justify-center shrink-0">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="-rotate-90 transform"
        >
          {/* Active Stock Ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-bg-raised transition-all duration-500"
          />
          {/* Dead Stock Progress Ring */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeDasharray={`${deadStrokeDash} ${circumference}`}
            strokeLinecap="butt"
            className="text-brand transition-all duration-500"
          />
        </svg>
        {/* Center Percentage Label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-lg font-extrabold text-text-primary tracking-tight">
            {deadStockPct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-col gap-2 text-xs text-text-secondary">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-brand shrink-0" />
          <span className="font-semibold text-text-primary">
            {deadStockCount.toLocaleString()}
          </span>{" "}
          <span>dead stock</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-bg-raised border border-border shrink-0" />
          <span className="font-semibold text-text-primary">
            {activeCount.toLocaleString()}
          </span>{" "}
          <span>active</span>
        </div>
        <div className="text-[11px] text-text-muted mt-0.5 pt-1 border-t border-border">
          {totalCount.toLocaleString()} products tracked
        </div>
      </div>
    </div>
  );
}

/**
 * Hourly Demand Vertical Bar Chart
 * Uses crisp SVG bars styled with the app's main brand color token.
 */
function HourlyDemandBarChart({
  hourly,
}: {
  hourly: { hour: string; count: number; net_revenue: number }[];
}): React.JSX.Element {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (hourly.length === 0) {
    return (
      <div className="h-28 flex items-center justify-center text-xs text-text-muted">
        No hourly demand recorded in this period.
      </div>
    );
  }

  const maxCount = Math.max(...hourly.map((h) => h.count), 0);
  const chartHeight = 72;
  const chartWidth = 360;
  const barCount = hourly.length;
  const slotWidth = chartWidth / barCount;
  const barWidth = Math.max(5, Math.min(16, slotWidth - 4));

  const hovered = hoverIndex !== null ? hourly[hoverIndex] : null;

  return (
    <div className="py-2 flex flex-col gap-1.5 relative">
      {/* Tooltip text readout */}
      <div className="h-4 text-[11px] text-text-secondary">
        {hovered ? (
          <span>
            <strong className="text-text-primary">{hovered.hour}:00</strong> — {hovered.count} {hovered.count === 1 ? "transaction" : "transactions"}
            {hovered.net_revenue > 0 && ` (${formatCompactMmk(hovered.net_revenue)} MMK)`}
          </span>
        ) : (
          <span className="text-text-muted">Hover a bar to see transaction count.</span>
        )}
      </div>

      <svg
        viewBox={`0 0 ${chartWidth} ${chartHeight + 20}`}
        className="w-full overflow-visible"
        role="img"
        aria-label="Customer demand by hour"
      >
        {/* Baseline line */}
        <line
          x1={0}
          y1={chartHeight}
          x2={chartWidth}
          y2={chartHeight}
          stroke="var(--color-border)"
          strokeWidth={1}
        />

        {hourly.map((item, i) => {
          const barHeight = maxCount > 0 && item.count > 0
            ? Math.max(6, (item.count / maxCount) * (chartHeight - 8))
            : (item.count > 0 ? 6 : 2);
          const x = i * slotWidth + (slotWidth - barWidth) / 2;
          const y = chartHeight - barHeight;
          const isHovered = hoverIndex === i;

          return (
            <g key={item.hour}>
              {/* The bar */}
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={item.count > 0 ? 3 : 1}
                ry={item.count > 0 ? 3 : 1}
                fill={
                  item.count > 0
                    ? isHovered
                      ? "var(--color-brand-hover)"
                      : "var(--color-brand)"
                    : "var(--color-bg-raised)"
                }
                className="transition-colors duration-150 cursor-pointer"
              />

              {/* Hit target for hover */}
              <rect
                x={i * slotWidth}
                y={0}
                width={slotWidth}
                height={chartHeight + 20}
                fill="transparent"
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex((curr) => (curr === i ? null : curr))}
              />

              {/* X-axis hour label */}
              <text
                x={i * slotWidth + slotWidth / 2}
                y={chartHeight + 14}
                textAnchor="middle"
                className={cn(
                  "text-[10px] font-medium select-none pointer-events-none",
                  isHovered ? "fill-brand font-bold" : "fill-text-muted"
                )}
              >
                {item.hour}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SummaryTab({
  session,
  branchId,
  period,
  dateFrom,
  dateTo,
  canLoad,
  onOpenDashboard,
}: Props): React.JSX.Element {
  const url = canLoad
    ? dashboardUrl("summary", branchId, { period, dateFrom, dateTo })
    : null;

  const { data: fetched, isRefreshing, failed, reload } =
    useUrlQuery<SummaryDashboardData>(url, session, "Summary dashboard");
  const data = fetched ?? null;

  if (!canLoad) {
    return (
      <EmptyState
        icon={<DashboardIcon />}
        title="Select a branch"
        description="Choose a retail branch above to view its business summary."
      />
    );
  }

  if (data === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load the Summary dashboard"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      );
    }

    return (
      <div className="space-y-4">
        <Skeleton className="h-14 w-full rounded-xl" />
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-56 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const { kpis, category_revenue, inventory_condition, customer_demand, top_products, recommendations } = data;
  const maxCategoryRevenue = Math.max(...category_revenue.map((c) => c.net_revenue), 1);

  // Derive Period description for Net Revenue card subtitle
  let periodSubtitle = "sales";
  if (data.period === "today") periodSubtitle = "today's sales";
  else if (data.period === "yesterday") periodSubtitle = "yesterday's sales";
  else if (data.period === "7d") periodSubtitle = "7-day sales";
  else if (data.period === "30d") periodSubtitle = "30-day sales";
  else periodSubtitle = "period sales";

  return (
    <div className="flex flex-col gap-3">
      <RefreshingHint show={isRefreshing} />

      {/* Main Executive Container */}
      <div className="p-3.5 sm:p-4.5 rounded-xl bg-bg-base border border-border shadow-xs space-y-3">
        
        {/* Header Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-2 border-b border-border">
          <div className="flex items-baseline gap-2">
            <h1 className="text-base sm:text-lg font-bold tracking-tight text-text-primary">
              {data.branch_name} Retail
            </h1>
          </div>

          <div className="flex items-center gap-3 text-xs text-text-muted flex-wrap">
            <div>
              <span>Period: </span>
              <span className="font-semibold text-text-primary">
                {formatExecutivePeriod(data.date_from, data.date_to)}
              </span>
            </div>
            {data.as_of && (
              <div>
                <span>Snapshot: </span>
                <span className="font-semibold text-text-primary">
                  {formatExecutiveDate(data.as_of)}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* 6 Top KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          {/* 1. Net Revenue */}
          <DrilldownCard
            label="Revenue dashboard"
            onClick={onOpenDashboard ? () => onOpenDashboard("revenue") : undefined}
            className="bg-bg-subtle p-3 rounded-lg border border-border flex flex-col justify-between"
          >
            <span className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Net Revenue
            </span>
            <div className="my-0.5">
              <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
                {formatCompactMmk(kpis.net_revenue)}
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] text-text-muted truncate">
              MMK · {periodSubtitle}
            </span>
          </DrilldownCard>

          {/* 2. Gross Profit */}
          <DrilldownCard
            label="Cost dashboard"
            onClick={onOpenDashboard ? () => onOpenDashboard("cost") : undefined}
            className="bg-bg-subtle p-3 rounded-lg border border-border flex flex-col justify-between"
          >
            <span className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Gross Profit
            </span>
            <div className="my-0.5">
              <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
                {formatCompactMmk(kpis.gross_profit)}
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] text-text-muted truncate">
              MMK · before op. costs
            </span>
          </DrilldownCard>

          {/* 3. Profit Margin */}
          <DrilldownCard
            label="Cost dashboard"
            onClick={onOpenDashboard ? () => onOpenDashboard("cost") : undefined}
            className="bg-bg-subtle p-3 rounded-lg border border-border flex flex-col justify-between"
          >
            <span className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Profit Margin
            </span>
            <div className="my-0.5">
              <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
                {kpis.profit_margin_pct.toFixed(1)}%
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] text-text-muted truncate">
              Profit ÷ net revenue
            </span>
          </DrilldownCard>

          {/* 4. Transactions */}
          <DrilldownCard
            label="Customer dashboard"
            onClick={onOpenDashboard ? () => onOpenDashboard("customer") : undefined}
            className="bg-bg-subtle p-3 rounded-lg border border-border flex flex-col justify-between"
          >
            <span className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Transactions
            </span>
            <div className="my-0.5">
              <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
                {kpis.transaction_count.toLocaleString()}
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] text-text-muted truncate">
              Avg sale: {formatCompactMmk(kpis.avg_sale)} MMK
            </span>
          </DrilldownCard>

          {/* 5. Quantity Sold */}
          <DrilldownCard
            label="Revenue dashboard"
            onClick={onOpenDashboard ? () => onOpenDashboard("revenue") : undefined}
            className="bg-bg-subtle p-3 rounded-lg border border-border flex flex-col justify-between"
          >
            <span className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Quantity Sold
            </span>
            <div className="my-0.5">
              <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
                {kpis.quantity_sold.toLocaleString()}
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] text-text-muted truncate">
              Across {kpis.selling_sku_count.toLocaleString()} SKUs
            </span>
          </DrilldownCard>

          {/* 6. Dead Stock */}
          <DrilldownCard
            label="Inventory dashboard"
            onClick={onOpenDashboard ? () => onOpenDashboard("inventory") : undefined}
            className="bg-bg-subtle p-3 rounded-lg border border-border flex flex-col justify-between"
          >
            <span className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Dead Stock
            </span>
            <div className="my-0.5">
              <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary">
                {kpis.dead_stock_count.toLocaleString()}
              </span>
            </div>
            <span className="text-[10px] sm:text-[11px] text-text-muted truncate">
              {kpis.dead_stock_pct.toFixed(1)}% of {kpis.total_products_count.toLocaleString()} items
            </span>
          </DrilldownCard>
        </div>

        {/* Middle Row - 3 Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {/* Card 1: Revenue by product category */}
          <DrilldownCard
            label="Revenue dashboard"
            onClick={onOpenDashboard ? () => onOpenDashboard("revenue") : undefined}
            className="bg-bg-subtle p-3.5 sm:p-4 rounded-lg border border-border flex flex-col justify-between"
          >
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Revenue by product category
              </h2>
              <p className="text-[11px] text-text-muted mb-2.5">
                Net sales value in MMK
              </p>

              {category_revenue.length === 0 ? (
                <p className="text-xs text-text-muted py-6 text-center">
                  No categorized sales in this period.
                </p>
              ) : (
                <div className="flex flex-col gap-2 py-0.5">
                  {category_revenue.slice(0, 6).map((cat) => {
                    const fillPct = (cat.net_revenue / maxCategoryRevenue) * 100;
                    return (
                      <div key={cat.category} className="flex items-center gap-2.5">
                        <span className="w-14 shrink-0 text-xs font-medium text-text-secondary truncate">
                          {cat.category}
                        </span>
                        <div className="flex-1 h-2 rounded-full bg-bg-raised overflow-hidden">
                          <div
                            className="h-full rounded-full bg-brand transition-all duration-500"
                            style={{ width: `${Math.max(fillPct, 8)}%` }}
                          />
                        </div>
                        <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-text-primary">
                          {formatCompactMmk(cat.net_revenue)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </DrilldownCard>

          {/* Card 2: Inventory condition */}
          <DrilldownCard
            label="Inventory dashboard"
            onClick={onOpenDashboard ? () => onOpenDashboard("inventory") : undefined}
            className="bg-bg-subtle p-3.5 sm:p-4 rounded-lg border border-border flex flex-col justify-between gap-2.5"
          >
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Inventory condition
              </h2>
              <p className="text-[11px] text-text-muted mb-1">
                No sales in the last 90 days
              </p>

              <InventoryDonutChart
                deadStockPct={inventory_condition.dead_stock_pct}
                deadStockCount={inventory_condition.dead_stock_count}
                activeCount={inventory_condition.active_stock_count}
                totalCount={inventory_condition.total_products_count}
              />
            </div>

            {/* Risk Callout */}
            <div className="bg-brand-subtle text-brand border border-brand/20 rounded-md p-2 text-xs leading-relaxed">
              {inventory_condition.risk_alert}
            </div>
          </DrilldownCard>

          {/* Card 3: Customer demand by hour */}
          <DrilldownCard
            label="Customer dashboard"
            onClick={onOpenDashboard ? () => onOpenDashboard("customer") : undefined}
            className="bg-bg-subtle p-3.5 sm:p-4 rounded-lg border border-border flex flex-col justify-between gap-2.5"
          >
            <div>
              <h2 className="text-sm font-semibold text-text-primary">
                Customer demand by hour
              </h2>
              <p className="text-[11px] text-text-muted mb-0.5 truncate">
                {customer_demand.summary}
              </p>

              <HourlyDemandBarChart hourly={customer_demand.hourly} />
            </div>

            {/* Peak Period Callout */}
            <div className="bg-brand-subtle text-brand border border-brand/20 rounded-md p-2 text-xs space-y-0.5">
              <div className="font-semibold text-brand">
                Peak period: {customer_demand.peak_period}
              </div>
              <div className="text-[11px] text-text-secondary truncate">
                {customer_demand.peak_hour_desc}
              </div>
            </div>
          </DrilldownCard>
        </div>

        {/* Bottom Row - 2 Cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {/* Card 1: Top products by revenue */}
          <DrilldownCard
            label="Revenue dashboard"
            onClick={onOpenDashboard ? () => onOpenDashboard("revenue") : undefined}
            className="bg-bg-subtle p-3.5 sm:p-4 rounded-lg border border-border"
          >
            <h2 className="text-sm font-semibold text-text-primary mb-2.5">
              Top products by revenue
            </h2>

            {top_products.length === 0 ? (
              <p className="text-xs text-text-muted py-6 text-center">
                No products sold in this period.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {top_products.map((product) => (
                  <div
                    key={product.stock_code}
                    className="py-1.5 first:pt-0 last:pb-0 flex items-center justify-between gap-2.5 text-xs sm:text-sm"
                  >
                    <div className="truncate font-medium text-text-secondary">
                      <span className="font-mono text-xs font-semibold text-brand mr-1.5">{product.stock_code}</span>
                      {product.description && (
                        <span className="text-text-primary">
                          · {product.description}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 font-semibold tabular-nums text-text-primary">
                      {formatCompactMmk(product.net_revenue)} MMK
                    </span>
                  </div>
                ))}
              </div>
            )}
          </DrilldownCard>

          {/* Card 2: Recommended decisions */}
          <div className="bg-bg-subtle p-3.5 sm:p-4 rounded-lg border border-border">
            <h2 className="text-sm font-semibold text-text-primary mb-2.5">
              Recommended decisions
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {recommendations.map((rec) => (
                <div
                  key={rec.id}
                  className="bg-bg-base p-3 rounded-lg border border-border flex flex-col justify-between hover:border-brand/30 transition-colors"
                >
                  <h3 className="text-xs font-bold text-text-primary mb-1">
                    {rec.title}
                  </h3>
                  <p className="text-[11px] leading-relaxed text-text-secondary">
                    {rec.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
