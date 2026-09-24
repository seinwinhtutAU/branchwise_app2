import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { Button } from "@renderer/components/ui/Button";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { DashboardIcon } from "@renderer/components/ui/icons";
import {
  RefreshingHint,
  ChartViewToggle,
  StatTile,
  TrendChart,
  WeekdayHourHeatmap,
  type ChartView,
} from "./shared";
import {
  dashboardUrl,
  WEEKDAY_LABELS,
  formatCount,
  formatPercent,
  previousPeriodLabel,
  type KpiValue,
  type PeriodKey,
} from "./helpers";

interface TransactionCountPoint {
  date: string;
  transaction_count: number;
}

interface FootfallCell {
  weekday: number;
  hour_band: string;
  transaction_count: number;
}

interface HistogramBucket {
  items: number;
  count: number;
}

interface CustomerDashboardData {
  branch_name: string;
  total_transactions: KpiValue;
  // No figure (null) where no zero-selling records were imported for the period.
  conversion_rate: {
    value: number | null;
    previous_value: number | null;
    delta_pct: number | null;
  };
  busiest_hour: FootfallCell | null;
  footfall_heatmap: FootfallCell[];
  transaction_count_trend: TransactionCountPoint[];
  items_per_basket_histogram: HistogramBucket[];
}

function histogramLabel(items: number): string {
  return items >= 6 ? "6+" : String(items);
}

function ItemsPerBasketHistogram({
  buckets,
}: {
  buckets: HistogramBucket[];
}): React.JSX.Element {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (total === 0) {
    return (
      <p className="text-xs text-text-muted py-4 text-center">No transactions in this period.</p>
    );
  }
  const maxCount = Math.max(...buckets.map((b) => b.count), 0);
  return (
    <div className="flex flex-col gap-2 py-0.5">
      {buckets.map((bucket) => (
        <div key={bucket.items} className="flex items-center gap-2.5">
          <span className="w-8 shrink-0 text-xs text-text-secondary font-medium">
            {histogramLabel(bucket.items)}
          </span>
          <div className="flex-1 h-2 rounded-full bg-bg-raised overflow-hidden">
            <div
              className="h-full rounded-full bg-brand transition-all duration-500"
              style={{
                width:
                  maxCount > 0 ? `${Math.max((bucket.count / maxCount) * 100, 1.5)}%` : "0%",
              }}
            />
          </div>
          <span className="w-24 shrink-0 text-right text-xs tabular-nums text-text-primary font-medium">
            {bucket.count.toLocaleString()} (
            {((bucket.count / total) * 100).toFixed(0)}%)
          </span>
        </div>
      ))}
    </div>
  );
}

interface Props {
  session: Session;
  branchId: string;
  period: PeriodKey;
  dateFrom: string;
  dateTo: string;
  month: string;
  canLoad: boolean;
}

export function CustomerTab({
  session,
  branchId,
  period,
  dateFrom,
  dateTo,
  month,
  canLoad,
}: Props): React.JSX.Element {
  const [trendView, setTrendView] = useState<ChartView>("bar");
  // One cached request per (tab, branch, period) — returning to this tab with the same
  // selection shows the numbers it showed last time instead of a skeleton. See
  // lib/queryClient.ts.
  const url = canLoad
    ? dashboardUrl("customer", branchId, { period, dateFrom, dateTo, month })
    : null;
  const { data: fetched, isRefreshing, failed, reload } =
    useUrlQuery<CustomerDashboardData>(url, session, "Customer dashboard");
  const data = fetched ?? null;

  if (!canLoad) return <></>;

  if (data === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load the Customer dashboard"
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
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-18" />
          <Skeleton className="h-18" />
          <Skeleton className="h-18" />
        </div>
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
    );
  }

  const busiest = data.busiest_hour;

  return (
    <div className="flex flex-col gap-3">
      <RefreshingHint show={isRefreshing} />
      <p className="text-xs text-text-muted">
        Shopping patterns, not customer identity — POS data tracks transactions and visits rather than individuals.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
        <StatTile
          label="Total Transactions"
          value={formatCount(data.total_transactions.value)}
          deltaPct={data.total_transactions.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo, "year_ago")}
        />
        <StatTile
          label="Conversion Rate"
          value={
            data.conversion_rate.value === null
              ? "—"
              : formatPercent(data.conversion_rate.value)
          }
          sub={
            data.conversion_rate.value === null
              ? "No zero-selling records in this period"
              : "Sales ÷ (sales + visits that did not buy)"
          }
          deltaPct={data.conversion_rate.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo, "year_ago")}
        />
        <StatTile
          label="Busiest Hour"
          value={
            busiest
              ? `${WEEKDAY_LABELS[busiest.weekday]} ${busiest.hour_band}`
              : "—"
          }
          sub={
            busiest
              ? `${busiest.transaction_count.toLocaleString()} transactions`
              : "No transactions in this period"
          }
        />
      </div>

      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title="Transaction trend"
          description="Number of transactions per day over the selected period."
          action={<ChartViewToggle view={trendView} onChange={setTrendView} />}
        />
        <TrendChart
          points={data.transaction_count_trend}
          getValue={(p) => p.transaction_count}
          formatValue={formatCount}
          ariaLabel="Daily transaction count"
          view={trendView}
        />
      </Card>

      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title="Busy hours by day & hour"
          description="Transaction count by weekday and time of day — store footfall intensity."
        />
        <WeekdayHourHeatmap
          cells={data.footfall_heatmap}
          getValue={(c) => c.transaction_count}
          formatValue={(v) => `${v.toLocaleString()} transactions`}
        />
      </Card>

      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title="Items per transaction"
          description="Distribution of line-item counts per basket."
        />
        <ItemsPerBasketHistogram buckets={data.items_per_basket_histogram} />
      </Card>
    </div>
  );
}

export default CustomerTab;
