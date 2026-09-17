import {
  StatTile,
  TwoLineTrendChart,
} from "@renderer/components/features/dashboard/shared";
import type { WholesaleCostReport } from "@renderer/components/features/wholesale/shared/api";
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

function StageBars({
  rows,
}: {
  rows: WholesaleCostReport["freight_by_stage"];
}): React.JSX.Element {
  if (!rows.length)
    return (
      <p className="text-sm text-text-muted">
        No freight or handling costs were recorded in this period.
      </p>
    );
  const max = Math.max(...rows.map((row) => row.amount), 0);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <div key={row.stage} className="flex items-center gap-3">
          <span className="w-36 shrink-0 truncate text-sm text-text-secondary">
            {row.stage}
          </span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-raised">
            <div
              className="h-full rounded-full bg-brand"
              style={{ width: `${max ? (row.amount / max) * 100 : 0}%` }}
            />
          </div>
          <span className="w-28 shrink-0 text-right text-sm tabular-nums">
            {formatKyat(row.amount)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CostTab(props: ReportTabProps): React.JSX.Element {
  const query = useWholesaleReport<WholesaleCostReport>("cost", props);
  const note = ReportKpiNote(props);
  if (!query.data)
    return query.failed ? (
      <ReportError title="Cost & Supplier" reload={query.reload} />
    ) : (
      <ReportLoading />
    );
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <ReportRefreshing show={query.isRefreshing} />
      <p className="text-sm text-text-muted">
        Purchases use the voucher date, goods arriving and freight use the
        receiving date, and supplier payments use the payment date. Gross margin
        is before freight.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Purchases"
          value={formatKyat(data.purchases.value)}
          deltaPct={data.purchases.delta_pct}
          previousLabel={note}
        />
        <StatTile
          label="Freight & handling"
          value={formatKyat(data.freight_and_handling.value)}
          deltaPct={data.freight_and_handling.delta_pct}
          previousLabel={note}
        />
        <StatTile
          label="Gross margin %"
          value={`${data.gross_margin_pct.value.toFixed(1)}%`}
          deltaPct={data.gross_margin_pct.delta_pct}
          previousLabel={note}
        />
        <StatTile
          label="Owed to suppliers"
          value={formatKyat(data.owed_to_suppliers.value)}
          deltaPct={data.owed_to_suppliers.delta_pct}
          previousLabel={note}
        />
      </div>
      <ReportSection
        title="Revenue vs. cost of goods delivered"
        description="Buying price is an estimate based on the latest voucher price available on each delivery date."
      >
        <TwoLineTrendChart
          points={data.trend}
          getPrimaryValue={(point) => point.delivered_revenue}
          getSecondaryValue={(point) => point.cost_of_goods_delivered ?? 0}
          primaryLabel="Delivered revenue"
          secondaryLabel="Cost of goods"
          formatValue={formatKyat}
          ariaLabel="Daily delivered revenue and cost of goods"
        />
      </ReportSection>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <ReportSection
          title="Freight by stage"
          description="Freight is shown separately because a mixed-batch transport charge is not split across products."
        >
          <StageBars rows={data.freight_by_stage} />
        </ReportSection>
        <ReportSection
          title="Spend by supplier"
          description="Voucher spend, quantity, paid amount, and current balance."
        >
          <ReportTable>
            <ReportTableHeader>
              <Th>Supplier</Th>
              <Th className="text-right">Vouchers</Th>
              <Th className="text-right">Quantity</Th>
              <Th className="text-right">Spend</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Balance</Th>
            </ReportTableHeader>
            <ReportTableBody>
              {data.suppliers.length ? (
                data.suppliers.map((row) => (
                  <tr key={row.supplier_name}>
                    <Td>{row.supplier_name}</Td>
                    <Td className="text-right tabular-nums">
                      {formatQty(row.vouchers)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatSets(row.pairs)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatKyat(row.value)}
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
                <EmptyRow colSpan={6}>
                  No supplier purchases in this period.
                </EmptyRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </ReportSection>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <ReportSection
          title="Supplier payables"
          description="Open voucher balances, regardless of when the voucher was entered."
        >
          <ReportTable>
            <ReportTableHeader>
              <Th>Voucher</Th>
              <Th>Supplier</Th>
              <Th>Date</Th>
              <Th className="text-right">Days since</Th>
              <Th className="text-right">Balance</Th>
            </ReportTableHeader>
            <ReportTableBody>
              {data.payables.length ? (
                data.payables.map((row) => (
                  <tr key={row.voucher_no}>
                    <Td className="font-semibold text-brand">
                      {row.voucher_no}
                    </Td>
                    <Td>{row.supplier_name}</Td>
                    <Td>{formatDate(row.voucher_date)}</Td>
                    <Td className="text-right tabular-nums">
                      {formatQty(row.days_since)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatKyat(row.balance_due)}
                    </Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={5}>No supplier balances are open.</EmptyRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </ReportSection>
        <ReportSection
          title="Write-offs"
          description="Goods paid for that will not be sold, valued at the estimated buying price."
        >
          <ReportTable>
            <ReportTableHeader>
              <Th>Reference</Th>
              <Th>Product</Th>
              <Th>Reason</Th>
              <Th className="text-right">Quantity</Th>
              <Th className="text-right">Value</Th>
            </ReportTableHeader>
            <ReportTableBody>
              {data.write_offs.length ? (
                data.write_offs.map((row, index) => (
                  <tr key={`${row.reference}-${index}`}>
                    <Td>{row.reference || "—"}</Td>
                    <Td>
                      <span className="font-mono text-xs">
                        {row.stock_code}
                      </span>{" "}
                      {row.description}
                    </Td>
                    <Td>{(row.reason ?? "").replaceAll("_", " ") || "—"}</Td>
                    <Td className="text-right tabular-nums">
                      {formatSets(row.quantity_pairs)}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatKyat(row.value)}
                    </Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={5}>
                  No write-offs were recorded in this period.
                </EmptyRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </ReportSection>
      </div>
    </div>
  );
}
