// StockDetail — full detail view for a single stock code.

import { Fragment, useMemo, useState } from "react";
import { Button } from "@renderer/components/ui/Button";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import { ChevronLeftIcon } from "@renderer/components/ui/icons";
import {
  DotPill,
  Panel,
  ReadOnlyField,
  Reference,
  SectionLabel,
} from "@renderer/components/features/wholesale/shared/ui";
import { formatDate } from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/shared/products";
import { cn } from "@renderer/lib/utils";
import {
  type StockRecord,
  type StockMovement,
} from "@renderer/components/features/wholesale/inventory/stock";
import { type CustomerOrder } from "@renderer/components/features/wholesale/orders/customerOrders";
import {
  relatedOrdersFor,
  colorAvailabilityForOrder,
  subtractColorPairs,
  reservedColorPairsForStockCode,
  legacyLineFromRecord,
  formatColorPairs,
  colorsWanted,
  stockPlaces,
  inventoryHealth,
} from "./inventoryUtils";
import { StockDetailTabs } from "./InventoryBadges";
import {
  HEALTH_STYLES,
  MOVEMENT_LABELS,
  MOVEMENT_STYLES,
  RELATED_ORDER_STATUS_LABELS,
  RELATED_ORDER_STATUS_STYLES,
} from "./types";

// ── Stock Balance ─────────────────────────────────────────────────────────────

function StockBalance({ record }: { record: StockRecord }): React.JSX.Element {
  const terms: {
    label: string;
    detail: string;
    pairs: number;
    operator: string | null;
    valueClass: string;
  }[] = [
    {
      label: "On hand",
      detail: "Counted at the gate",
      pairs: Math.max(0, record.on_hand_pairs),
      operator: null,
      valueClass: "text-lg text-text-primary",
    },
    {
      label: "Allocated",
      detail: "Reserved for customers",
      pairs: Math.max(0, record.allocated_pairs),
      operator: "−",
      valueClass: "text-lg text-warning",
    },
    {
      label: "Available",
      detail: "Free to sell or deliver",
      pairs: Math.max(0, record.available_pairs),
      operator: "=",
      valueClass: "text-2xl text-success",
    },
  ];

  return (
    <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
        {terms.map((term) => (
          <Fragment key={term.label}>
            {term.operator !== null && (
              <div
                aria-hidden="true"
                className="flex shrink-0 items-center justify-center text-xl font-semibold text-text-muted sm:px-2"
              >
                {term.operator}
              </div>
            )}
            <div className="flex-1 rounded-lg border border-border bg-bg-base px-4 py-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {term.label}
              </div>
              <div
                className={cn("mt-1 font-bold tabular-nums", term.valueClass)}
              >
                {formatSets(term.pairs)}
              </div>
              <div className="mt-0.5 text-xs text-text-muted">
                {term.detail}
              </div>
            </div>
          </Fragment>
        ))}
      </div>
      <p className="mt-3 text-sm text-text-secondary">
        {record.incoming_pairs > 0
          ? `Another ${formatSets(record.incoming_pairs)} on the way.`
          : "Nothing else on the way."}
      </p>
    </div>
  );
}

// ── Stock Detail ──────────────────────────────────────────────────────────────

export function StockDetail({
  record,
  orders,
  allMovements,
  onOpenReceiving,
  movements,
  onBack,
}: {
  record: StockRecord;
  orders: CustomerOrder[];
  allMovements: StockMovement[];
  onOpenReceiving: (receivingNo: string) => void;
  movements: StockMovement[];
  onBack: () => void;
}): React.JSX.Element {
  const line = legacyLineFromRecord(record);
  const health = inventoryHealth(record);
  const [tab, setTab] = useState<
    "overview" | "orders" | "movement" | "pipeline"
  >("overview");
  const relatedOrders = useMemo(
    () => relatedOrdersFor(line.stock_code, orders),
    [line.stock_code, orders],
  );
  const relatedOrderTotals = useMemo(
    () =>
      relatedOrders.reduce(
        (totals, row) => ({
          ordered: totals.ordered + row.ordered,
          received: totals.received + row.received,
          remaining: totals.remaining + row.remaining,
        }),
        { ordered: 0, received: 0, remaining: 0 },
      ),
    [relatedOrders],
  );
  const places = stockPlaces(record);

  const pipelineStages = [
    {
      label: "At Supplier",
      detail: "Not yet shipped",
      pairs: record.at_supplier_pairs,
    },
    {
      label: "In Transit",
      detail: "On the way",
      pairs: record.in_transit_pairs,
    },
    {
      label: "At Receiving",
      detail: "Physically received at the gate",
      pairs: record.on_hand_pairs,
    },
    {
      label: "Customer Allocated",
      detail: "Reserved against a customer order",
      pairs: record.allocated_pairs,
    },
    {
      label: "Customer Owed",
      detail: "Ordered but not yet reserved",
      pairs: record.owed_to_customers_pairs,
    },
    {
      label: "Delivered",
      detail: "Sent to customers",
      pairs: record.delivered_pairs,
    },
    {
      label: "Lost",
      detail: "Written off from the pipeline",
      pairs: record.lost_pairs,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeftIcon className="w-4 h-4" />
          Back to inventory
        </Button>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-4 pb-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                {line.stock_code}
              </h2>
              <DotPill
                label={health}
                className={HEALTH_STYLES[health].bg}
                dotClassName={HEALTH_STYLES[health].dot}
              />
            </div>
            <p className="mt-0.5 truncate text-sm text-text-muted">
              {line.description} · {GROUP_LABELS[line.product_group]}
            </p>
          </div>
        </div>

        <StockDetailTabs
          tab={tab}
          onChange={setTab}
          orderCount={relatedOrders.length}
          movementCount={movements.length}
        />

        <div className="px-6 py-6 flex flex-col gap-6">
          {tab === "overview" && (
            <section className="flex flex-col gap-5">
              <StockBalance record={record} />
              <div>
                <SectionLabel>Stock information</SectionLabel>
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-text-primary">
                      Product
                    </h3>
                    <dl className="grid gap-3 sm:grid-cols-2">
                      <ReadOnlyField
                        label="Stock code"
                        value={line.stock_code}
                        copyable
                      />
                      <ReadOnlyField
                        label="Group"
                        value={GROUP_LABELS[line.product_group]}
                      />
                      <ReadOnlyField
                        className="sm:col-span-2"
                        label="Description"
                        value={line.description}
                        wrap
                      />
                      <ReadOnlyField
                        className="sm:col-span-2"
                        label="Colors in stock"
                        value={line.colors || "—"}
                        wrap
                      />
                    </dl>
                  </div>
                  <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-text-primary">
                      Where it is
                    </h3>
                    {places.length === 0 ? (
                      <p className="text-sm text-text-muted">Nowhere yet.</p>
                    ) : (
                      <div className="divide-y divide-border">
                        {places.map((place) => (
                          <div
                            key={place.label}
                            className="flex items-center justify-between gap-4 py-2.5"
                          >
                            <span className="min-w-0 truncate text-sm text-text-primary">
                              {place.label}
                            </span>
                            <span className="shrink-0 text-sm font-semibold tabular-nums text-text-primary">
                              {formatSets(place.pairs)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="mt-3 text-xs text-text-muted">
                      Last moved{" "}
                      {record.last_activity_on
                        ? formatDate(record.last_activity_on)
                        : "—"}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          )}

          {tab === "orders" && (
            <section>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <SectionLabel>Related customer orders</SectionLabel>
                <span className="text-xs text-text-muted">
                  Orders that include this stock code
                </span>
              </div>
              <TableContainer>
                <Thead className="top-0">
                  <Tr>
                    <Th className="whitespace-nowrap">Order</Th>
                    <Th>Date</Th>
                    <Th>Ordered colors</Th>
                    <Th className="text-right whitespace-nowrap">
                      Ordered qty
                    </Th>
                    <Th className="text-right whitespace-nowrap">
                      Received qty
                    </Th>
                    <Th className="text-right whitespace-nowrap">
                      Remaining qty
                    </Th>
                    <Th>Order status</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {relatedOrders.length === 0 ? (
                    <Tr>
                      <Td
                        colSpan={7}
                        className="py-8 text-center text-text-muted"
                      >
                        No customer orders use this stock code.
                      </Td>
                    </Tr>
                  ) : (
                    <>
                      {relatedOrders.map(
                        ({ order, ordered, received, remaining }) => {
                          const colorCheck = colorAvailabilityForOrder(
                            order,
                            line.stock_code,
                            subtractColorPairs(
                              line.color_quantities_pairs,
                              reservedColorPairsForStockCode(
                                orders,
                                line.stock_code,
                                order.order_id,
                              ),
                            ),
                            allMovements,
                          );
                          const orderStatusStyle =
                            RELATED_ORDER_STATUS_STYLES[order.order_status] ??
                            RELATED_ORDER_STATUS_STYLES.waiting_for_stock;
                          return (
                            <Tr key={order.order_id}>
                              <Td className="whitespace-nowrap">
                                <Reference
                                  value={order.order_no}
                                  what="order no."
                                />
                                <span className="mt-0.5 block text-sm text-text-secondary">
                                  {order.customer_name}
                                </span>
                              </Td>
                              <Td className="whitespace-nowrap text-text-muted">
                                {formatDate(order.order_date)}
                              </Td>
                              <Td className="font-mono text-xs">
                                <span className="block text-text-secondary">
                                  {colorsWanted(order, line.stock_code)}
                                </span>
                                <span
                                  className={cn(
                                    "mt-0.5 block font-sans text-xs",
                                    Object.keys(colorCheck.missing).length > 0
                                      ? "text-error"
                                      : "text-success",
                                  )}
                                >
                                  {Object.keys(colorCheck.missing).length > 0
                                    ? `Missing ${formatColorPairs(colorCheck.missing)}`
                                    : "Colors available"}
                                </span>
                              </Td>
                              <Td className="text-right tabular-nums font-medium">
                                {formatSets(ordered)}
                              </Td>
                              <Td className="text-right tabular-nums font-medium">
                                {formatSets(received)}
                              </Td>
                              <Td
                                className={cn(
                                  "text-right tabular-nums font-semibold whitespace-nowrap",
                                  remaining > 0 ? "text-error" : "text-success",
                                )}
                              >
                                {formatSets(remaining)}
                              </Td>
                              <Td>
                                <DotPill
                                  label={
                                    RELATED_ORDER_STATUS_LABELS[
                                      order.order_status
                                    ]
                                  }
                                  className={orderStatusStyle.bg}
                                  dotClassName={orderStatusStyle.dot}
                                />
                              </Td>
                            </Tr>
                          );
                        },
                      )}
                      <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                        <Td
                          colSpan={3}
                          className="text-right font-semibold text-text-primary"
                        >
                          Total
                        </Td>
                        <Td className="text-right font-bold tabular-nums">
                          {formatSets(relatedOrderTotals.ordered)}
                        </Td>
                        <Td className="text-right font-bold tabular-nums">
                          {formatSets(relatedOrderTotals.received)}
                        </Td>
                        <Td className="text-right font-bold tabular-nums whitespace-nowrap">
                          {formatSets(relatedOrderTotals.remaining)}
                        </Td>
                        <Td />
                      </Tr>
                    </>
                  )}
                </Tbody>
              </TableContainer>
            </section>
          )}

          {tab === "movement" && (
            <section>
              <TableContainer>
                <Thead className="top-0">
                  <Tr>
                    <Th className="whitespace-nowrap">Date</Th>
                    <Th>Color</Th>
                    <Th>Movement</Th>
                    <Th className="text-right">Qty</Th>
                    <Th>Location</Th>
                    <Th>Reference</Th>
                    <Th>Supplier / Customer</Th>
                    <Th className="w-24" aria-label="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {movements.map((movement) => {
                    const movementStyle = MOVEMENT_STYLES[
                      movement.movement_type
                    ] ?? {
                      bg: "bg-bg-raised text-text-secondary border border-border-strong",
                      dot: "bg-text-muted",
                    };
                    return (
                      <Tr key={movement.movement_id}>
                        <Td className="text-text-muted whitespace-nowrap">
                          {formatDate(movement.moved_on)}
                        </Td>
                        <Td className="font-mono text-xs text-text-secondary whitespace-nowrap">
                          {movement.color_breakdown || "—"}
                        </Td>
                        <Td>
                          <DotPill
                            label={
                              MOVEMENT_LABELS[movement.movement_type] ??
                              movement.movement_type
                            }
                            className={movementStyle.bg}
                            dotClassName={movementStyle.dot}
                          />
                        </Td>
                        <Td
                          className={cn(
                            "text-right tabular-nums font-semibold whitespace-nowrap",
                            movement.movement_type === "in"
                              ? "text-success"
                              : movement.movement_type === "out"
                                ? "text-error"
                                : "text-warning",
                          )}
                        >
                          {movement.movement_type === "in"
                            ? "+"
                            : movement.movement_type === "out"
                              ? "−"
                              : "• "}
                          {formatSets(movement.quantity_pairs)}
                        </Td>
                        <Td className="text-text-secondary whitespace-nowrap">
                          {movement.location}
                        </Td>
                        <Td className="text-text-muted whitespace-nowrap">
                          {movement.reference || "—"}
                        </Td>
                        <Td className="text-text-secondary">
                          {movement.counterparty_name || "—"}
                        </Td>
                        <Td className="text-center whitespace-nowrap">
                          {movement.movement_type === "in" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                onOpenReceiving(movement.reference)
                              }
                            >
                              Open receiving
                            </Button>
                          ) : null}
                        </Td>
                      </Tr>
                    );
                  })}
                  <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                    <Td className="font-semibold" colSpan={3}>
                      Total stock now
                    </Td>
                    <Td className="text-right tabular-nums font-semibold whitespace-nowrap">
                      {formatSets(line.quantity_available_pairs)}
                    </Td>
                    <Td colSpan={4} className="text-text-muted">
                      {formatSets(line.quantity_in_pairs)} received,{" "}
                      {formatSets(line.quantity_out_pairs)} sent out
                    </Td>
                  </Tr>
                </Tbody>
              </TableContainer>
            </section>
          )}

          {tab === "pipeline" && (
            <section>
              <SectionLabel>Pipeline</SectionLabel>
              <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                <div className="divide-y divide-border">
                  {pipelineStages.map((stage) => (
                    <div
                      key={stage.label}
                      className="flex items-center justify-between gap-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text-primary">
                          {stage.label}
                        </div>
                        <div className="text-xs text-text-muted">
                          {stage.detail}
                        </div>
                      </div>
                      <div className="shrink-0 font-semibold tabular-nums text-text-primary">
                        {formatSets(stage.pairs)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </div>
      </Panel>
    </div>
  );
}
