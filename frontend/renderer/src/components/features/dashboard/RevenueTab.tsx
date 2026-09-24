import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { Button } from "@renderer/components/ui/Button";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import { DashboardIcon, SalesIcon } from "@renderer/components/ui/icons";
import { CopyButton } from "@renderer/components/ui/CopyButton";
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
  formatCount,
  formatMoney,
  previousPeriodLabel,
  type KpiValue,
  type PeriodKey,
} from "./helpers";

interface TrendPoint {
  date: string;
  net_revenue: number;
}

interface TopProduct {
  stock_code: string;
  description: string;
  qty: number;
  net_revenue: number;
  avg_selling_price: number | null;
}

interface HeatmapCell {
  weekday: number;
  hour_band: string;
  net_revenue: number;
}

interface RevenueDashboardData {
  branch_name: string;
  net_revenue: KpiValue;
  transaction_count: KpiValue;
  avg_basket: KpiValue;
  quantity_sold: KpiValue;
  trend: TrendPoint[];
  top_products: TopProduct[];
  heatmap: HeatmapCell[];
}

function TopProductsTable({
  products,
}: {
  products: TopProduct[];
}): React.JSX.Element {
  if (products.length === 0) {
    return (
      <EmptyState
        icon={<SalesIcon />}
        title="No sales in this period"
        description="Top products will appear once there's sales data for the selected period."
      />
    );
  }
  return (
    <TableContainer>
      <Thead>
        <Tr>
          <Th>#</Th>
          <Th>Stock Code</Th>
          <Th>Description</Th>
          <Th className="text-right">Qty</Th>
          <Th className="text-right">Selling Price</Th>
          <Th className="text-right">Net Revenue</Th>
        </Tr>
      </Thead>
      <Tbody>
        {products.map((product, i) => (
          <Tr key={product.stock_code}>
            <Td className="text-text-muted">{i + 1}</Td>
            <Td>
              <div className="flex items-center gap-1 whitespace-nowrap">
                <span className="font-mono text-xs font-semibold text-brand">{product.stock_code}</span>
                <CopyButton value={product.stock_code} what="stock code" />
              </div>
            </Td>
            <Td>{product.description}</Td>
            <Td className="text-right tabular-nums">
              {product.qty.toLocaleString()}
            </Td>
            <Td className="text-right tabular-nums">
              {product.avg_selling_price === null
                ? "—"
                : formatMoney(product.avg_selling_price)}
            </Td>
            <Td className="text-right tabular-nums">
              {formatMoney(product.net_revenue)}
            </Td>
          </Tr>
        ))}
      </Tbody>
    </TableContainer>
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

export function RevenueTab({
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
    ? dashboardUrl("revenue", branchId, { period, dateFrom, dateTo, month })
    : null;
  const { data: fetched, isRefreshing, failed, reload } =
    useUrlQuery<RevenueDashboardData>(url, session, "Revenue dashboard");
  const data = fetched ?? null;

  if (!canLoad) return <></>;

  if (data === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load the Revenue dashboard"
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
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-18" />
          <Skeleton className="h-18" />
          <Skeleton className="h-18" />
          <Skeleton className="h-18" />
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <RefreshingHint show={isRefreshing} />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <StatTile
          label="Net Revenue"
          value={formatMoney(data.net_revenue.value)}
          deltaPct={data.net_revenue.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo, "year_ago")}
        />
        <StatTile
          label="Transactions"
          value={formatCount(data.transaction_count.value)}
          deltaPct={data.transaction_count.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo, "year_ago")}
        />
        <StatTile
          label="Average Sale Value"
          value={formatMoney(data.avg_basket.value)}
          deltaPct={data.avg_basket.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo, "year_ago")}
        />
        <StatTile
          label="Quantity Sold"
          value={formatCount(data.quantity_sold.value)}
          deltaPct={data.quantity_sold.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo, "year_ago")}
        />
      </div>

      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title="Sales trend"
          description="Daily net revenue over the selected period."
          action={<ChartViewToggle view={trendView} onChange={setTrendView} />}
        />
        <TrendChart
          points={data.trend}
          getValue={(p) => p.net_revenue}
          formatValue={formatMoney}
          ariaLabel="Daily net revenue trend"
          view={trendView}
        />
      </Card>

      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title="Sales by day & hour"
          description="Revenue concentration by weekday and time of day — useful for staffing decisions."
        />
        <WeekdayHourHeatmap
          cells={data.heatmap}
          getValue={(c) => c.net_revenue}
          formatValue={formatMoney}
        />
      </Card>

      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title="Top products"
          description="Ranked by net revenue in the selected period."
        />
        <TopProductsTable products={data.top_products} />
      </Card>
    </div>
  );
}

export default RevenueTab;
