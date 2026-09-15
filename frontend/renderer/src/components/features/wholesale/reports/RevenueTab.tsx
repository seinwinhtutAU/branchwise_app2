import { useState } from "react";
import {
  ChartViewToggle,
  StatTile,
  TrendChart,
  TwoLineTrendChart,
  type ChartView,
} from "@renderer/components/features/dashboard/shared";
import type { WholesaleRevenueReport } from "@renderer/components/features/wholesale/api";
import { formatPercent } from "@renderer/components/features/dashboard/helpers";
import {
  ReportError,
  ReportKpiNote,
  ReportLoading,
  ReportRefreshing,
  ReportSection,
  ReportTable,
  ReportTableBody,
  ReportTableHeader,
  EmptyRow,
  type ReportTabProps,
  useWholesaleReport,
  formatKyat,
  formatSets,
  Td,
  Th,
} from "./shared";

function CustomerBars({
  rows,
}: {
  rows: WholesaleRevenueReport["top_customers"];
}): React.JSX.Element {
  if (!rows.length)
    return (
      <p className="text-sm text-text-muted">
        No goods went out to customers in this period.
      </p>
    );
  const max = Math.max(...rows.map((row) => row.delivered_revenue), 0);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.customer_name} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-sm text-text-secondary">
            {row.customer_name}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-raised">
            <div
              className="h-full rounded-full bg-brand"
              style={{
                width: `${max ? (row.delivered_revenue / max) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="w-28 shrink-0 text-right text-sm tabular-nums">
            {formatKyat(row.delivered_revenue)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function RevenueTab(props: ReportTabProps): React.JSX.Element {
  const [view, setView] = useState<ChartView>("bar");
  const query = useWholesaleReport<WholesaleRevenueReport>("revenue", props);
  const note = ReportKpiNote(props);
  if (!query.data)
    return query.failed ? (
      <ReportError title="Revenue" reload={query.reload} />
    ) : (
      <ReportLoading />
    );
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <ReportRefreshing show={query.isRefreshing} />
      <p className="text-sm text-text-muted">
        Revenue is counted when goods are delivered. Orders taken use the order
        date; money collected uses the payment date.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Delivered revenue"
          value={formatKyat(data.delivered_revenue.value)}
          deltaPct={data.delivered_revenue.delta_pct}
          previousLabel={note}
        />
        <StatTile
          label="Ordered value"
          value={formatKyat(data.ordered_value.value)}
          deltaPct={data.ordered_value.delta_pct}
          previousLabel={note}
        />
        <StatTile
          label="Quantity delivered"
          value={formatSets(data.pairs_delivered.value)}
          deltaPct={data.pairs_delivered.delta_pct}
          previousLabel={note}
        />
        <StatTile
          label="Money collected"
          value={formatKyat(data.collected.value)}
          deltaPct={data.collected.delta_pct}
          previousLabel={note}
        />
      </div>
      <ReportSection
        title="Delivered revenue and money collected"
        description="The gap between the lines is sold goods that have not been paid for yet."
      >
        <TwoLineTrendChart
          points={data.trend}
          getPrimaryValue={(point) => point.delivered_revenue}
          getSecondaryValue={(point) => point.collected}
          primaryLabel="Delivered revenue"
          secondaryLabel="Money collected"
          formatValue={formatKyat}
          ariaLabel="Daily delivered revenue and money collected"
        />
      </ReportSection>
      <ReportSection
        title="Daily delivered revenue"
        description="Revenue by delivery date over the selected period."
        action={<ChartViewToggle view={view} onChange={setView} />}
      >
        <TrendChart
          points={data.trend}
          getValue={(point) => point.delivered_revenue}
          formatValue={formatKyat}
          ariaLabel="Daily delivered revenue"
          view={view}
        />
      </ReportSection>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <ReportSection
          title="Top customers"
          description="Customers ranked by delivered revenue."
        >
          <CustomerBars rows={data.top_customers} />
        </ReportSection>
        <ReportSection
          title="Top products"
          description="Delivered revenue, quantity, and quantity-weighted selling price."
        >
          <ReportTable>
            <ReportTableHeader>
              <Th>Product</Th>
              <Th className="text-right">Quantity</Th>
              <Th className="text-right">Ks</Th>
              <Th className="text-right">Avg price</Th>
            </ReportTableHeader>
            <ReportTableBody>
              {data.top_products.length ? (
                data.top_products.map((row) => (
                  <tr key={row.stock_code}>
                    <Td>
                      <span className="font-mono text-xs">
                        {row.stock_code}
                      </span>
                      <span className="ml-2">{row.description}</span>
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatSets(row.pairs_delivered)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatKyat(row.delivered_revenue)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {row.avg_selling_price === null
                        ? "—"
                        : formatKyat(row.avg_selling_price)}
                    </Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={4}>
                  No products were delivered in this period.
                </EmptyRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </ReportSection>
      </div>
      <ReportSection
        title="Orders placed"
        description="Ordered value is separate from delivered revenue; cancelled orders are excluded."
      >
        <ReportTable>
          <ReportTableHeader>
            <Th>Order</Th>
            <Th>Customer</Th>
            <Th className="text-right">Quantity</Th>
            <Th className="text-right">Value</Th>
            <Th className="text-right">Delivered</Th>
            <Th className="text-right">Balance</Th>
          </ReportTableHeader>
          <ReportTableBody>
            {data.orders.length ? (
              data.orders.map((row) => (
                <tr key={row.order_no}>
                  <Td className="font-semibold text-brand">{row.order_no}</Td>
                  <Td>{row.customer_name}</Td>
                  <Td className="text-right tabular-nums">
                    {formatSets(row.pairs_ordered)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatKyat(row.ordered_value)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatPercent(row.delivered_pct)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatKyat(row.balance_due)}
                  </Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={6}>
                No orders were placed in this period.
              </EmptyRow>
            )}
          </ReportTableBody>
        </ReportTable>
      </ReportSection>
    </div>
  );
}
