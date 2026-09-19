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
import { DashboardIcon, ScaleIcon } from "@renderer/components/ui/icons";
import { CopyButton } from "@renderer/components/ui/CopyButton";
import {
  RefreshingHint,
  ChartViewToggle,
  StatTile,
  TrendChart,
  TwoLineTrendChart,
  WarningsTile,
  type ChartView,
} from "./shared";
import {
  dashboardUrl,
  formatMoney,
  formatPercent,
  previousPeriodLabel,
  type KpiValue,
  type PeriodKey,
  type SaleWarningRow,
} from "./helpers";

interface CostTrendPoint {
  date: string;
  net_revenue: number;
  estimated_cost: number | null;
  margin_pct: number | null;
}

interface CostProduct {
  stock_code: string;
  description: string;
  qty: number;
  net_revenue: number;
  // Never null here — a product with no cost estimate at all is excluded from this
  // ranking server-side (see build_cost_dashboard), since it can't be ranked by profit.
  estimated_cost: number;
  estimated_margin: number;
  margin_pct: number;
}

interface CostDashboardData {
  branch_name: string;
  estimated_cogs: KpiValue;
  estimated_gross_margin_pct: KpiValue;
  estimated_margin_per_basket: KpiValue;
  trend: CostTrendPoint[];
  products: CostProduct[];
  purchase_warnings: SaleWarningRow[];
}

function TopProfitProductsTable({
  products,
}: {
  products: CostProduct[];
}): React.JSX.Element {
  if (products.length === 0) {
    return (
      <EmptyState
        icon={<ScaleIcon />}
        title="No priced products in this period"
        description="Top profit products will appear once there's sales data with a purchase or stock record to estimate cost against."
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
          <Th className="text-right">Net Revenue</Th>
          <Th className="text-right">Est. Cost</Th>
          <Th className="text-right">Est. Margin</Th>
          <Th className="text-right">Margin %</Th>
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
              {formatMoney(product.net_revenue)}
            </Td>
            <Td className="text-right tabular-nums">
              {formatMoney(product.estimated_cost)}
            </Td>
            <Td className="text-right tabular-nums font-medium text-text-primary">
              {formatMoney(product.estimated_margin)}
            </Td>
            <Td className="text-right tabular-nums">
              {formatPercent(product.margin_pct)}
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
  canLoad: boolean;
  onViewWarnings: () => void;
}

export function CostTab({
  session,
  branchId,
  period,
  dateFrom,
  dateTo,
  canLoad,
  onViewWarnings,
}: Props): React.JSX.Element {
  const [marginTrendView, setMarginTrendView] = useState<ChartView>("line");
  // One cached request per (tab, branch, period) — returning to this tab with the same
  // selection shows the numbers it showed last time instead of a skeleton. See
  // lib/queryClient.ts.
  const url = canLoad
    ? dashboardUrl("cost", branchId, { period, dateFrom, dateTo })
    : null;
  const { data: fetched, isRefreshing, failed, reload } =
    useUrlQuery<CostDashboardData>(url, session, "Cost dashboard");
  const data = fetched ?? null;

  if (!canLoad) return <></>;

  if (data === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load the Cost dashboard"
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-18" />
          <Skeleton className="h-18" />
          <Skeleton className="h-18" />
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <RefreshingHint show={isRefreshing} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
        <StatTile
          label="Estimated Cost of Goods Sold"
          value={formatMoney(data.estimated_cogs.value)}
          deltaPct={data.estimated_cogs.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
        <StatTile
          label="Estimated Gross Margin"
          value={formatPercent(data.estimated_gross_margin_pct.value)}
          deltaPct={data.estimated_gross_margin_pct.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
        <StatTile
          label="Estimated Margin per Transaction"
          value={formatMoney(data.estimated_margin_per_basket.value)}
          deltaPct={data.estimated_margin_per_basket.delta_pct}
          previousLabel={previousPeriodLabel(period, dateFrom, dateTo)}
        />
      </div>

      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title="Gross margin trend"
          description="Estimated gross margin % by day over the selected period."
          action={
            <ChartViewToggle
              view={marginTrendView}
              onChange={setMarginTrendView}
            />
          }
        />
        <TrendChart
          points={data.trend}
          getValue={(p) => p.margin_pct ?? 0}
          formatValue={formatPercent}
          ariaLabel="Daily estimated gross margin percentage"
          view={marginTrendView}
        />
      </Card>

      <Card className="p-3.5 sm:p-4">
        <CardHeader
          title="Revenue vs. cost per day"
          description="The gap between the two lines is the day's estimated margin."
        />
        <TwoLineTrendChart
          points={data.trend}
          getPrimaryValue={(p) => p.net_revenue}
          getSecondaryValue={(p) => p.estimated_cost ?? 0}
          primaryLabel="Net Revenue"
          secondaryLabel="Est. Cost"
          formatValue={formatMoney}
          ariaLabel="Daily net revenue and estimated cost"
        />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <Card className="p-3.5 sm:p-4 lg:col-span-2">
          <CardHeader
            title="Top profit products"
            description="Ranked by estimated Ks profit, not revenue — the products actually worth pushing more."
          />
          <TopProfitProductsTable products={data.products} />
        </Card>
        <Card className="p-3.5 sm:p-4 lg:col-span-1">
          <CardHeader
            title="Purchase data quality"
            description="Bad values on purchase lines in the selected period."
          />
          <WarningsTile
            warnings={data.purchase_warnings}
            label="Purchase"
            onViewWarnings={onViewWarnings}
          />
        </Card>
      </div>
    </div>
  );
}

export default CostTab;
