import type { WholesaleInventoryReport } from "@renderer/components/features/wholesale/api";
import {
  ReportError,
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

function Bars({
  rows,
  label,
}: {
  rows: {
    stage?: string;
    location?: string;
    pairs?: number;
    on_hand_pairs?: number;
  }[];
  label: "stage" | "location";
}): React.JSX.Element {
  if (!rows.length)
    return <p className="text-sm text-text-muted">No stock is recorded yet.</p>;
  const max = Math.max(
    ...rows.map((row) =>
      label === "stage" ? (row.pairs ?? 0) : (row.on_hand_pairs ?? 0),
    ),
    0,
  );
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const value =
          label === "stage" ? (row.pairs ?? 0) : (row.on_hand_pairs ?? 0);
        return (
          <div key={row[label] as string} className="flex items-center gap-3">
            <span className="w-32 shrink-0 truncate text-sm text-text-secondary">
              {row[label]}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-raised">
              <div
                className="h-full rounded-full bg-brand"
                style={{ width: `${max ? (value / max) * 100 : 0}%` }}
              />
            </div>
            <span className="w-36 shrink-0 text-right text-sm tabular-nums">
              {formatSets(value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function InventoryTab(props: ReportTabProps): React.JSX.Element {
  const query = useWholesaleReport<WholesaleInventoryReport>(
    "inventory",
    props,
  );
  if (!query.data)
    return query.failed ? (
      <ReportError title="Inventory" reload={query.reload} />
    ) : (
      <ReportLoading />
    );
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <ReportRefreshing show={query.isRefreshing} />
      <p className="text-sm text-text-muted">
        Stock totals are as of now and come from the whole pipeline. Received
        and delivered figures follow the selected dates; they do not change the
        on-hand snapshot.
      </p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReportSection
          title="On hand"
          description="Stock currently at a receiving location."
        >
          <div className="text-2xl font-semibold tabular-nums">
            {formatSets(data.on_hand.value)}
          </div>
        </ReportSection>
        <ReportSection
          title="Available"
          description="On hand less customer allocations."
        >
          <div className="text-2xl font-semibold tabular-nums">
            {formatSets(data.available.value)}
          </div>
        </ReportSection>
        <ReportSection
          title="Incoming"
          description="At supplier plus in transit."
        >
          <div className="text-2xl font-semibold tabular-nums">
            {formatSets(data.incoming.value)}
          </div>
        </ReportSection>
        <ReportSection
          title="Stock value"
          description="On hand at estimated buying price."
        >
          <div className="text-2xl font-semibold tabular-nums">
            {formatKyat(data.stock_value.value)}
          </div>
        </ReportSection>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <ReportSection
          title="Stock by location"
          description="Current on-hand stock by gate."
        >
          <Bars rows={data.locations} label="location" />
        </ReportSection>
        <ReportSection
          title="Pipeline stages"
          description="The whole wholesale pipeline at a glance."
        >
          <Bars rows={data.pipeline} label="stage" />
        </ReportSection>
      </div>
      <ReportSection
        title="Period movements"
        description="These two figures follow the selected period; the stock totals above do not."
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-text-muted">Received</div>
            <div className="text-xl font-semibold tabular-nums">
              {formatSets(data.received_in_period)}
            </div>
          </div>
          <div>
            <div className="text-sm text-text-muted">Delivered</div>
            <div className="text-xl font-semibold tabular-nums">
              {formatSets(data.delivered_in_period)}
            </div>
          </div>
        </div>
      </ReportSection>
      <ReportSection
        title="Stock by product and location"
        description="Current stock records from stock_records(), the source of truth for this tab."
      >
        <ReportTable>
          <ReportTableHeader>
            <Th>Product</Th>
            <Th>Location</Th>
            <Th className="text-right">On hand</Th>
            <Th className="text-right">Available</Th>
            <Th className="text-right">Allocated</Th>
            <Th className="text-right">Incoming</Th>
          </ReportTableHeader>
          <ReportTableBody>
            {data.products.flatMap((product) =>
              product.locations.length
                ? product.locations.map((location) => (
                    <tr key={`${product.stock_code}-${location.location}`}>
                      <Td>
                        <span className="font-mono text-xs">
                          {product.stock_code}
                        </span>{" "}
                        {product.description}
                      </Td>
                      <Td>{location.location}</Td>
                      <Td className="text-right tabular-nums">
                        {formatSets(location.on_hand_pairs)}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatSets(product.available_pairs)}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatSets(product.allocated_pairs)}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatSets(product.incoming_pairs)}
                      </Td>
                    </tr>
                  ))
                : [
                    <tr key={product.stock_code}>
                      <Td>
                        <span className="font-mono text-xs">
                          {product.stock_code}
                        </span>{" "}
                        {product.description}
                      </Td>
                      <Td>—</Td>
                      <Td className="text-right tabular-nums">
                        {formatSets(product.on_hand_pairs)}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatSets(product.available_pairs)}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatSets(product.allocated_pairs)}
                      </Td>
                      <Td className="text-right tabular-nums">
                        {formatSets(product.incoming_pairs)}
                      </Td>
                    </tr>,
                  ],
            )}
          </ReportTableBody>
        </ReportTable>
      </ReportSection>
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <ReportSection
          title="Cannot supply"
          description="Customers are waiting, but there is nothing on hand or on the way."
        >
          <ReportTable>
            <ReportTableHeader>
              <Th>Product</Th>
              <Th className="text-right">Customers waiting</Th>
            </ReportTableHeader>
            <ReportTableBody>
              {data.cannot_supply.length ? (
                data.cannot_supply.map((row) => (
                  <tr key={row.stock_code}>
                    <Td>
                      {row.stock_code} {row.description}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {formatSets(row.owed_to_customers_pairs)}
                    </Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={2}>
                  Nothing is currently impossible to supply.
                </EmptyRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </ReportSection>
        <ReportSection
          title="Not moving"
          description="On hand products with the last movement date and days since then."
        >
          <ReportTable>
            <ReportTableHeader>
              <Th>Product</Th>
              <Th>Date last moved</Th>
              <Th className="text-right">Days since</Th>
            </ReportTableHeader>
            <ReportTableBody>
              {data.not_moving.length ? (
                data.not_moving.map((row) => (
                  <tr key={row.stock_code}>
                    <Td>
                      {row.stock_code} {row.description}
                    </Td>
                    <Td>
                      {row.last_movement_on
                        ? formatDate(row.last_movement_on)
                        : "Never"}
                    </Td>
                    <Td className="text-right tabular-nums">
                      {row.days_since === null
                        ? "—"
                        : formatQty(row.days_since)}
                    </Td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={3}>
                  Every on-hand product has moved recently.
                </EmptyRow>
              )}
            </ReportTableBody>
          </ReportTable>
        </ReportSection>
      </div>
    </div>
  );
}
