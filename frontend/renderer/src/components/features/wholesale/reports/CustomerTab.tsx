import { useState } from "react";
import { CollapsibleKpiSummary } from "@renderer/components/ui/CollapsibleKpiSummary";
import {
  ChartViewToggle,
  StatTile,
  TrendChart,
  type ChartView,
} from "@renderer/components/features/dashboard/shared";
import type { WholesaleCustomerReport } from "@renderer/components/features/wholesale/shared/api";
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
  formatDate,
  formatKyat,
  formatQty,
  formatSets,
  Td,
  Th,
} from "./shared";

function CustomerBars({
  rows,
}: {
  rows: WholesaleCustomerReport["top_customers"];
}): React.JSX.Element {
  if (!rows.length)
    return (
      <p className="text-sm text-text-muted">
        No named customers bought in this period.
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

export function CustomerTab(props: ReportTabProps): React.JSX.Element {
  const [view, setView] = useState<ChartView>("bar");
  const query = useWholesaleReport<WholesaleCustomerReport>("customer", props);
  const note = ReportKpiNote(props);
  if (!query.data)
    return query.failed ? (
      <ReportError title="Customer" reload={query.reload} />
    ) : (
      <ReportLoading />
    );
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <ReportRefreshing show={query.isRefreshing} />
      <p className="text-sm text-text-muted">
        Customer names are matched case-insensitively after trimming, so “Ma Su
        Su” and “ma su su ” are one customer. Orders use the order date;
        collections use the payment date.
      </p>
      <CollapsibleKpiSummary storageKey="wholesale_report_customer" title="Customer KPIs">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Active customers"
            value={formatQty(data.active_customers.value)}
            deltaPct={data.active_customers.delta_pct}
            previousLabel={note}
          />
          <StatTile
            label="New customers"
            value={formatQty(data.new_customers.value)}
            deltaPct={data.new_customers.delta_pct}
            previousLabel={note}
          />
          <StatTile
            label="Average order value"
            value={formatKyat(data.average_order_value.value)}
            deltaPct={data.average_order_value.delta_pct}
            previousLabel={note}
          />
          <StatTile
            label="Owed by customers"
            value={formatKyat(data.receivables.value)}
          />
        </div>
      </CollapsibleKpiSummary>
      <ReportSection
        title="Daily order count"
        description="Orders placed in the selected period."
      >
        <div className="mb-3 flex justify-end">
          <ChartViewToggle view={view} onChange={setView} />
        </div>
        <TrendChart
          points={data.trend}
          getValue={(point) => point.order_count}
          formatValue={formatQty}
          ariaLabel="Daily wholesale order count"
          view={view}
        />
      </ReportSection>
      <ReportSection
        title="Top customers by delivered revenue"
        description="The ten customers who received the most value in this period."
      >
        <CustomerBars rows={data.top_customers} />
      </ReportSection>
      <ReportSection
        title="Customer ranking"
        description="Orders, quantity ordered, quantity delivered, delivered value, paid, and balance."
      >
        <ReportTable>
          <ReportTableHeader>
            <Th>Customer</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Ordered</Th>
            <Th className="text-right">Delivered</Th>
            <Th className="text-right">Ks delivered</Th>
            <Th className="text-right">Paid</Th>
            <Th className="text-right">Balance</Th>
          </ReportTableHeader>
          <ReportTableBody>
            {data.ranking.length ? (
              data.ranking.map((row) => (
                <tr key={row.customer_name}>
                  <Td className="font-medium">{row.customer_name}</Td>
                  <Td className="text-right tabular-nums">
                    {formatQty(row.orders)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatSets(row.pairs_ordered)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatSets(row.pairs_delivered)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatKyat(row.delivered_revenue)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatKyat(row.paid)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatKyat(row.balance)}
                  </Td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={7}>
                No customers placed orders in this period.
              </EmptyRow>
            )}
          </ReportTableBody>
        </ReportTable>
      </ReportSection>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <ReportSection
          title="Orders still open"
          description="Orders with undelivered stock or an outstanding balance."
        >
          <ReportTable>
            <ReportTableHeader>
              <Th>Order</Th>
              <Th>Customer</Th>
              <Th>Date</Th>
              <Th className="text-right">Days open</Th>
              <Th className="text-right">Balance</Th>
            </ReportTableHeader>
            <ReportTableBody>
              {data.open_orders.length ? (
                data.open_orders.map((row) => (
                  <tr key={row.order_no}>
                    <Td className="font-semibold text-brand">{row.order_no}</Td>
                    <Td>{row.customer_name}</Td>
                    <Td>{formatDate(row.order_date)}</Td>
                    <Td className="text-right tabular-nums">
                      {formatQty(row.days_open)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatKyat(row.balance_due)}
                    </Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={5}>
                  No orders are still open in this period.
                </EmptyRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </ReportSection>
        <ReportSection
          title="Quiet customers"
          description="Bought before, but nothing in this period — a list worth phoning."
        >
          <ReportTable>
            <ReportTableHeader>
              <Th>Customer</Th>
            </ReportTableHeader>
            <ReportTableBody>
              {data.quiet_customers.length ? (
                data.quiet_customers.map((row) => (
                  <tr key={row.customer_name}>
                    <Td>{row.customer_name}</Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={1}>
                  No earlier customers are quiet in this period.
                </EmptyRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </ReportSection>
      </div>
      <p className="text-sm text-text-muted">
        Average fulfilment time for fully delivered orders in this period:{" "}
        {data.fulfilment_days.value.toFixed(1)} days.
      </p>
    </div>
  );
}
