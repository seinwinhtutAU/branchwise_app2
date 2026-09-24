import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import {
  ChartViewToggle,
  RefreshingHint,
  StatTile,
  TrendChart,
  type ChartView,
} from "@renderer/components/features/dashboard/shared";
import { formatCount } from "@renderer/components/features/dashboard/helpers";
import {
  DashboardCard,
  DashboardError,
  DashboardFooter,
  DashboardLoading,
  RankedBars,
} from "./dashboardParts";
import { bucketForDisplay, formatMmk, formatShare } from "./dashboardFormat";
import {
  dashboardTabUrl,
  type DashboardWindow,
  type RevenueDashboardData,
} from "./dashboardApi";

const FACTORIES_SHOWN = 6;

/** The wholesale Dashboard's Revenue tab: what was delivered and collected in the
 *  period, who owes, and what the stock on the shelf is worth. */
export function WholesaleRevenueDashboard({
  session,
  window,
}: {
  session: Session;
  window: DashboardWindow;
}): React.JSX.Element {
  const [view, setView] = useState<ChartView>("line");
  const { data, isRefreshing, failed, reload } = useUrlQuery<RevenueDashboardData>(
    dashboardTabUrl("revenue", window),
    session,
    "Revenue dashboard",
  );

  if (data === undefined) {
    return failed ? (
      <DashboardError title="Revenue" reload={reload} />
    ) : (
      <DashboardLoading tiles={6} />
    );
  }

  const delivered = data.delivered_revenue.value;
  const collectedShare = delivered > 0 ? (data.collected.value / delivered) * 100 : 0;
  const points = bucketForDisplay(data.trend, (bucket) =>
    bucket.reduce((sum, day) => sum + day.delivered_revenue, 0),
  );
  const isWeekly = data.trend.length > 14;
  const factories = data.factories.slice(0, FACTORIES_SHOWN);

  return (
    <div className="flex flex-col gap-3">
      <RefreshingHint show={isRefreshing} />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6 sm:gap-3">
        <StatTile
          label="Delivered Revenue"
          value={formatMmk(delivered)}
          deltaPct={data.delivered_revenue.delta_pct}
          previousLabel="vs previous period"
        />
        <StatTile
          label="Money Collected"
          value={formatMmk(data.collected.value)}
          sub={`${formatShare(collectedShare)} of delivered revenue`}
        />
        <StatTile
          label="Outstanding Receivables"
          value={formatMmk(data.receivables)}
          sub="as of selected end date"
        />
        <StatTile
          label="Potential Stock Sales Value"
          value={formatMmk(data.potential_stock_sales_value)}
          sub="on-hand stock at selling price"
        />
        <StatTile
          label="Inventory Cost Value"
          value={formatMmk(data.inventory_cost_value)}
          sub="on-hand stock at buying cost"
        />
        <StatTile
          label="Potential Gross Profit on Stock"
          value={formatMmk(data.potential_gross_profit)}
          sub="sales value minus cost value"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <DashboardCard
          title="Delivered Revenue Over Time"
          description={
            isWeekly
              ? "Revenue recognized when goods are delivered, by week"
              : "Revenue recognized when goods are delivered, by day"
          }
        >
          <div className="flex justify-end pb-1">
            <ChartViewToggle view={view} onChange={setView} />
          </div>
          <TrendChart
            points={points}
            getValue={(point) => point.value}
            formatValue={formatMmk}
            ariaLabel="Delivered revenue over time"
            view={view}
          />
        </DashboardCard>

        <DashboardCard
          title="Revenue by Factory"
          description="Factories ranked by delivered revenue"
        >
          {factories.length > 0 && (
            <div className="mb-4 flex items-baseline justify-between border-b border-border pb-3 text-sm">
              <span className="text-text-secondary">Top factory contribution</span>
              <span className="text-lg font-semibold tabular-nums text-text-primary">
                {formatShare(data.top_factory_share_pct)}
              </span>
            </div>
          )}
          <RankedBars
            rows={factories.map((factory) => ({
              label: factory.factory_name,
              value: factory.delivered_revenue,
            }))}
            formatValue={formatMmk}
            empty="No goods were delivered in this period."
          />
          {data.factories.length > FACTORIES_SHOWN && (
            <p className="mt-3 text-xs text-text-muted">
              Showing the top {FACTORIES_SHOWN} of {formatCount(data.factories.length)} factories.
            </p>
          )}
        </DashboardCard>
      </div>

      <DashboardFooter note="Revenue is recognized on delivery · Stock values use latest known prices · Values shown in MMK" />
    </div>
  );
}
