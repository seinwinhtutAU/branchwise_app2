import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import {
  ChartViewToggle,
  RefreshingHint,
  TrendChart,
  type ChartView,
} from "@renderer/components/features/dashboard/shared";
import { InfoLabel } from "@renderer/components/ui/InfoTooltip";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { CopyButton } from "@renderer/components/ui/CopyButton";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import {
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

/** The wholesale Dashboard's Revenue tab: structured identically to Retail Revenue with
 *  Money Collected & Receivables KPI cards, full-width Sales trend chart, Top Debtors,
 *  and Top Selling Products table. */
export function WholesaleRevenueDashboard({
  session,
  window,
}: {
  session: Session;
  window: DashboardWindow;
}): React.JSX.Element {
  const [trendView, setTrendView] = useState<ChartView>("bar");
  const { data, isRefreshing, failed, reload } =
    useUrlQuery<RevenueDashboardData>(
      dashboardTabUrl("revenue", window),
      session,
      "Revenue dashboard",
    );

  if (data === undefined) {
    return failed ? (
      <DashboardError title="Revenue" reload={reload} />
    ) : (
      <DashboardLoading tiles={2} />
    );
  }

  const delivered = data.delivered_revenue.value;
  const collectedShare =
    delivered > 0 ? (data.collected.value / delivered) * 100 : 0;
  const points = bucketForDisplay(data.trend, (bucket) =>
    bucket.reduce((sum, day) => sum + day.delivered_revenue, 0),
  );
  const isWeekly = data.trend.length > 14;
  const debtors = data.customer_receivables ?? [];
  const topProducts = data.top_products ?? [];

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <RefreshingHint show={isRefreshing} />

      {/* Top 2 Core Money KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-3">
        {/* 1. Money Received */}
        <div className="bg-bg-base border border-border rounded-lg p-3.5 sm:p-4.5 flex flex-col justify-between shadow-xs">
          <InfoLabel
            className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-text-muted"
            description="Money received from customers."
          >
            Money Received
          </InfoLabel>
          <div className="my-1 sm:my-1.5">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary tabular-nums">
              {formatMmk(data.collected.value)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-text-muted">
            <span>
              {formatShare(collectedShare)} of revenue ({formatMmk(delivered)})
            </span>
            <span className="text-emerald-600 font-medium">Received</span>
          </div>
        </div>

        {/* 2. Unpaid by Customers */}
        <div className="bg-bg-base border border-border rounded-lg p-3.5 sm:p-4.5 flex flex-col justify-between shadow-xs">
          <InfoLabel
            className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-wider text-text-muted"
            description="Money customers still owe."
          >
            Unpaid by Customers
          </InfoLabel>
          <div className="my-1 sm:my-1.5">
            <span className="text-xl sm:text-2xl font-bold tracking-tight tabular-nums text-[#E88B1A]">
              {formatMmk(data.receivables)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-text-muted">
            <span>Still to collect</span>
            <span className="text-[#E88B1A] font-medium">Not paid yet</span>
          </div>
        </div>
      </section>

      {/* Full-width Revenue Trend */}
      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title="Revenue trend"
          description={
            isWeekly
              ? "Revenue from delivered goods, by week."
              : "Revenue from delivered goods, by day."
          }
          action={<ChartViewToggle view={trendView} onChange={setTrendView} />}
        />
        <TrendChart
          points={points}
          getValue={(point) => point.value}
          formatValue={formatMmk}
          ariaLabel="Daily net revenue trend"
          view={trendView}
        />
      </Card>

      {/* Middle Grid: Top Debtors & Factory Contribution */}
      <div className="grid grid-cols-1 items-start gap-3 sm:gap-4 lg:grid-cols-2">
        {/* Customers with unpaid balances */}
        <Card className="p-3.5 sm:p-4">
          <CardHeader
            title="Customers with unpaid balances"
            description="Customers with unpaid balances."
          />
          {debtors.length > 0 ? (
            <div className="mt-2">
              <RankedBars
                rows={debtors.map((d) => ({
                  label: d.customer_name,
                  value: d.balance_due,
                }))}
                formatValue={formatMmk}
                empty="No unpaid customer balances."
              />
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-text-muted">
              All customers have paid.
            </p>
          )}
        </Card>

        {/* Revenue by factory */}
        <Card className="p-3.5 sm:p-4">
          <CardHeader
            title="Revenue by Factory"
            description="Revenue from delivered goods."
          />
          {data.factories.length > 0 ? (
            <div className="mt-2">
              <RankedBars
                rows={data.factories.map((f) => ({
                  label: f.factory_name,
                  value: f.delivered_revenue,
                }))}
                formatValue={formatMmk}
                empty="No factory revenue this period."
              />
            </div>
          ) : (
            <p className="py-8 text-center text-xs text-text-muted">
              No factory revenue this period.
            </p>
          )}
        </Card>
      </div>

      {/* Top Products Table (Matching Retail Top Products Table) */}
      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title="Top products"
          description="Best-selling delivered products."
        />
        {topProducts.length > 0 ? (
          <TableContainer>
            <Thead>
              <Tr>
                <Th className="w-12 text-center">#</Th>
                <Th>
                  <InfoLabel description="Product ID.">Product ID</InfoLabel>
                </Th>
                <Th className="text-right">
                  <InfoLabel description="Sets delivered. 1 set = 6 pairs.">
                    Sets Delivered
                  </InfoLabel>
                </Th>
                <Th className="text-right">
                  <InfoLabel description="Pairs delivered.">
                    Pairs Delivered
                  </InfoLabel>
                </Th>
                <Th className="text-right">
                  <InfoLabel description="Revenue from delivered goods.">
                    Revenue
                  </InfoLabel>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {topProducts.map((p, index) => (
                <Tr key={p.stock_code}>
                  <Td className="text-center font-medium text-text-muted">
                    {index + 1}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className="font-mono text-xs font-semibold text-brand">
                        {p.stock_code}
                      </span>
                      <CopyButton value={p.stock_code} what="stock code" />
                    </div>
                  </Td>
                  <Td className="text-right font-medium tabular-nums text-text-primary">
                    {p.quantity_sets.toLocaleString()} sets
                  </Td>
                  <Td className="text-right text-text-muted tabular-nums">
                    {p.quantity_pairs.toLocaleString()} pairs
                  </Td>
                  <Td className="text-right font-semibold tabular-nums text-text-primary">
                    {formatMmk(p.delivered_revenue)}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </TableContainer>
        ) : (
          <p className="py-8 text-center text-xs text-text-muted">
            No product delivery data recorded for this period.
          </p>
        )}
      </Card>

      <DashboardFooter note="Revenue is recorded when goods are delivered · Payments show money received · Values in MMK" />
    </div>
  );
}

export default WholesaleRevenueDashboard;
