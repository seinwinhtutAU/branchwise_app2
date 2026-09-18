import { useMemo, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { useSearchShortcut } from "@renderer/lib/useSearchShortcut";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { CollapsibleKpiSummary } from "@renderer/components/ui/CollapsibleKpiSummary";
import { ColumnHeaderFilter } from "@renderer/components/ui/ColumnHeaderFilter";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  ClipboardIcon,
  CloseIcon,
  PlusIcon,
  SearchIcon,
} from "@renderer/components/ui/icons";
import {
  FigureCard,
  PAGE_SIZE,
  Panel,
  Reference,
  RowProgress,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  formatDate,
  formatKyat,
  formatQty,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  ORDER_STATUSES,
  lineRemaining,
  nextAction,
  orderBalance,
  paymentStatus,
  readyToDeliver,
  receivedPct,
  remainingQty,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/orders/customerOrders";
import { type StockLine } from "@renderer/components/features/wholesale/inventory/stock";
import {
  PAYMENT_LABELS,
  PAYMENT_STATUSES,
  STATUS_LABELS,
  sets,
  type PayFilter,
  type StatusFilter,
} from "./types";
import { PaymentBadge, RowMenu, StatusBadge } from "./OrderBadges";

export function OrderList({
  orders,
  inventoryLines,
  onOpen,
  onPay,
  onAllocate,
  onCancel,
  onNew,
  onRefresh,
  refreshing,
}: {
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  onOpen: (orderId: string) => void;
  onPay: (orderId: string) => void;
  onAllocate: (orderId: string, tab: "allocate" | "deliver") => void;
  onCancel: (orderId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [pay, setPay] = useState<PayFilter>("all");
  type QuickView = "all" | "ready_to_deliver" | "unpaid";
  const [quickView, setQuickView] = useState<QuickView>("all");
  const [page, setPage] = useState(1);

  // Cancelled orders are excluded from every figure: a cancelled order is not work
  // waiting to be done, and counting it overstates what is still owed.
  const live = orders.filter((order) => order.order_status !== "cancelled");
  const openOrders = live.filter((order) => order.order_status !== "fulfilled");
  const readyToDeliverPairs = openOrders.reduce(
    (sum, order) =>
      sum +
      order.lines.reduce(
        (lineSum, line) =>
          lineSum +
          Math.min(lineRemaining(line), line.allocated_quantity_pairs ?? 0),
        0,
      ),
    0,
  );
  const remainingAll = openOrders.reduce(
    (sum, order) => sum + remainingQty(order),
    0,
  );
  // orderBalance already returns 0 for a cancelled order, so this is what customers
  // still owe on work that actually stands.
  const unpaid = live.reduce((sum, order) => sum + orderBalance(order), 0);
  const unpaidCount = live.filter((order) => orderBalance(order) > 0).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return orders.filter((order) => {
      const matchesQuery =
        query === "" ||
        order.customer_name.toLowerCase().includes(query) ||
        order.order_no.toLowerCase().includes(query) ||
        order.lines.some(
          (line) =>
            line.stock_code.toLowerCase().includes(query) ||
            line.description.toLowerCase().includes(query),
        );
      const matchesStatus = status === "all" || order.order_status === status;
      const matchesPay = pay === "all" ? true : paymentStatus(order) === pay;
      const matchesQuickView =
        quickView === "all"
          ? true
          : quickView === "ready_to_deliver"
            ? readyToDeliver(order)
            : quickView === "unpaid"
              ? paymentStatus(order) === "unpaid" &&
                order.order_status !== "cancelled"
              : true;

      return matchesQuery && matchesStatus && matchesPay && matchesQuickView;
    });
  }, [orders, search, status, pay, quickView, inventoryLines]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isFiltered =
    search.trim() !== "" ||
    status !== "all" ||
    pay !== "all" ||
    quickView !== "all";

  const searchInputRef = useSearchShortcut();

  // Quick filter counts based on actionable operational status
  const countAll = orders.length;
  const countReadyToDeliver = orders.filter(readyToDeliver).length;
  const countUnpaid = orders.filter(
    (o) => paymentStatus(o) === "unpaid" && o.order_status !== "cancelled",
  ).length;

  function resetFilters(): void {
    setSearch("");
    setStatus("all");
    setPay("all");
    setQuickView("all");
    setPage(1);
  }

  function handleQuickFilter(view: QuickView): void {
    setQuickView(view);
    setStatus("all");
    setPay("all");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <CollapsibleKpiSummary storageKey="wholesale_orders" title="Orders Summary">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <FigureCard
            label="Open Orders"
            value={formatQty(openOrders.length)}
            sub="not fulfilled or cancelled"
          />
          <FigureCard
            label="Ready to Deliver"
            value={sets(readyToDeliverPairs)}
            sub="allocated, ready to send"
            tone={readyToDeliverPairs > 0 ? "brand" : "success"}
          />
          <FigureCard
            label="Qty Remaining to Deliver"
            value={sets(remainingAll)}
            sub="across all open orders"
            tone={remainingAll > 0 ? "error" : "success"}
          />
          <FigureCard
            label="Unpaid amount"
            value={formatKyat(unpaid)}
            sub={`${unpaidCount} order${unpaidCount === 1 ? "" : "s"} not fully paid`}
            tone={unpaid > 0 ? "error" : "success"}
          />
        </div>
      </CollapsibleKpiSummary>

      <Panel className="shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-bg-base">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
              Orders
            </h2>
            <div className="flex items-center gap-1.5 flex-wrap select-none">
              <button
                type="button"
                onClick={() => handleQuickFilter("all")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium transition-all duration-150 border cursor-pointer",
                  quickView === "all" && status === "all" && pay === "all"
                    ? "bg-brand text-white border-brand shadow-xs"
                    : "bg-bg-subtle text-text-secondary border-border hover:bg-bg-raised hover:text-text-primary",
                )}
              >
                <span>All</span>
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px] font-semibold tabular-nums",
                    quickView === "all" && status === "all" && pay === "all"
                      ? "bg-white/20 text-white"
                      : "bg-bg-raised text-text-muted",
                  )}
                >
                  {countAll}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFilter("ready_to_deliver")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium transition-all duration-150 border cursor-pointer",
                  quickView === "ready_to_deliver"
                    ? "bg-brand text-white border-brand shadow-xs"
                    : "bg-bg-subtle text-text-secondary border-border hover:bg-bg-raised hover:text-text-primary",
                )}
              >
                <span>Ready to Deliver</span>
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px] font-semibold tabular-nums",
                    quickView === "ready_to_deliver"
                      ? "bg-white/20 text-white"
                      : "bg-brand-subtle text-brand font-bold",
                  )}
                >
                  {countReadyToDeliver}
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleQuickFilter("unpaid")}
                className={cn(
                  "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium transition-all duration-150 border cursor-pointer",
                  quickView === "unpaid"
                    ? "bg-error text-white border-error shadow-xs"
                    : "bg-bg-subtle text-text-secondary border-border hover:bg-bg-raised hover:text-text-primary",
                )}
              >
                <span>Unpaid</span>
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[10px] font-semibold tabular-nums",
                    quickView === "unpaid"
                      ? "bg-white/20 text-white"
                      : "bg-error-subtle text-error font-bold",
                  )}
                >
                  {countUnpaid}
                </span>
              </button>
            </div>
            {isFiltered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="text-xs h-6 px-1.5 text-text-muted hover:text-error"
              >
                <CloseIcon className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="w-48 sm:w-56">
              <Input
                ref={searchInputRef}
                aria-label="Search orders"
                placeholder="Search orders… (/)"
                startIcon={<SearchIcon className="w-3.5 h-3.5" />}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="h-8 text-xs"
              />
            </div>
            <RefreshButton
              onClick={onRefresh}
              refreshing={refreshing}
            />
            <Button onClick={onNew} size="sm" className="h-8 text-xs">
              <PlusIcon className="w-3.5 h-3.5" />
              New order
            </Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<ClipboardIcon />}
            title={isFiltered ? "No orders match" : "No orders yet"}
            description={
              isFiltered
                ? "Nothing here matches what you searched for. Try a different name or status."
                : "When a customer asks for shoes, add the order here so the quantities are written down."
            }
            action={
              isFiltered ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={onNew}>
                  <PlusIcon className="w-4 h-4" />
                  New order
                </Button>
              )
            }
          />
        ) : (
          <>
            <TableContainer className="border-0 rounded-none">
              <Thead>
                <Tr>
                  <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">#</Th>
                  <Th className="whitespace-nowrap">Order no.</Th>
                  <Th>Customer</Th>
                  <Th>Date</Th>
                  <Th className="min-w-[17.5rem] whitespace-nowrap">
                    Delivered / Ordered
                  </Th>
                  <Th className="whitespace-nowrap">
                    <ColumnHeaderFilter
                      label="Order status"
                      isActive={status !== "all"}
                    >
                      {(close) => (
                        <div className="flex flex-col gap-1.5">
                          <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                            Filter by Status
                          </div>
                          <div className="space-y-0.5 max-h-48 overflow-y-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setStatus("all");
                                setPage(1);
                                close();
                              }}
                              className={cn(
                                "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                status === "all"
                                  ? "bg-brand/10 font-bold text-brand"
                                  : "hover:bg-bg-raised text-text-secondary",
                              )}
                            >
                              <span>All statuses</span>
                            </button>
                            {ORDER_STATUSES.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => {
                                  setStatus(opt);
                                  setQuickView("all");
                                  setPage(1);
                                  close();
                                }}
                                className={cn(
                                  "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                  status === opt
                                    ? "bg-brand/10 font-bold text-brand"
                                    : "hover:bg-bg-raised text-text-secondary",
                                )}
                              >
                                <span>{STATUS_LABELS[opt]}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </ColumnHeaderFilter>
                  </Th>
                  <Th className="whitespace-nowrap">
                    <ColumnHeaderFilter
                      label="Payment status"
                      isActive={pay !== "all"}
                    >
                      {(close) => (
                        <div className="flex flex-col gap-1.5">
                          <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                            Filter by Payment
                          </div>
                          <div className="space-y-0.5 max-h-48 overflow-y-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setPay("all");
                                setPage(1);
                                close();
                              }}
                              className={cn(
                                "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                pay === "all"
                                  ? "bg-brand/10 font-bold text-brand"
                                  : "hover:bg-bg-raised text-text-secondary",
                              )}
                            >
                              <span>All payments</span>
                            </button>
                            {PAYMENT_STATUSES.map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => {
                                  setPay(opt);
                                  setQuickView("all");
                                  setPage(1);
                                  close();
                                }}
                                className={cn(
                                  "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                  pay === opt
                                    ? "bg-brand/10 font-bold text-brand"
                                    : "hover:bg-bg-raised text-text-secondary",
                                )}
                              >
                                <span>{PAYMENT_LABELS[opt]}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </ColumnHeaderFilter>
                  </Th>
                  <Th className="w-28 whitespace-nowrap">Action</Th>
                  <Th className="w-16" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((order, index) => {
                  const remaining = remainingQty(order);
                  const action = nextAction(order);
                  const rowTint =
                    action === "deliver"
                      ? "bg-brand-subtle/30 hover:bg-brand-subtle/50"
                      : undefined;
                  const firstCellBorder =
                    action === "deliver"
                      ? "border-l-4 border-l-brand"
                      : undefined;
                  const rowNum = (safePage - 1) * PAGE_SIZE + index + 1;

                  return (
                    <Tr key={order.order_id} className={rowTint}>
                      <Td className={cn("text-center text-xs font-mono text-text-muted tabular-nums select-none", firstCellBorder)}>
                        {rowNum}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Reference
                          value={order.order_no}
                          what="order no."
                          onClick={() => onOpen(order.order_id)}
                        />
                      </Td>
                      <Td className="font-medium whitespace-nowrap">
                        {order.customer_name}
                      </Td>
                      <Td className="text-text-muted whitespace-nowrap">
                        {formatDate(order.order_date)}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <div className="flex flex-col gap-1.5 w-full min-w-[16.5rem] max-w-[21rem]">
                          <div className="flex items-center justify-between gap-4 text-xs font-mono">
                            <span className="font-semibold text-text-primary whitespace-nowrap shrink-0">
                              {sets(order.delivered_quantity_pairs)}
                              <span className="text-text-muted/60 font-normal">
                                {" "}
                                /{" "}
                              </span>
                              <span className="text-text-secondary font-normal">
                                {sets(order.total_quantity_pairs)}
                              </span>
                            </span>
                            {remaining > 0 ? (
                              <span className="text-error text-[11px] font-sans font-medium whitespace-nowrap shrink-0">
                                {sets(remaining)} left
                              </span>
                            ) : (
                              <span className="text-success text-[11px] font-sans font-medium whitespace-nowrap shrink-0">
                                Fulfilled
                              </span>
                            )}
                          </div>
                          <RowProgress
                            pct={receivedPct(order)}
                            label={`Fulfillment progress for ${order.order_no}`}
                          />
                        </div>
                      </Td>
                      <Td>
                        <StatusBadge status={order.order_status} />
                      </Td>
                      <Td>
                        <PaymentBadge status={paymentStatus(order)} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {action ? (
                          <Button
                            size="sm"
                            onClick={() =>
                              onAllocate(order.order_id, "deliver")
                            }
                          >
                            Deliver
                          </Button>
                        ) : (
                          order.order_status === "waiting_for_stock" && (
                            <span className="text-xs text-text-muted">
                              Waiting for stock
                            </span>
                          )
                        )}
                      </Td>
                      <Td className="text-right">
                        <RowMenu
                          onOpen={() => onOpen(order.order_id)}
                          onPay={
                            order.order_status === "cancelled"
                              ? undefined
                              : () => onPay(order.order_id)
                          }
                          onAllocate={
                            order.order_status === "cancelled" ||
                            order.order_status === "fulfilled"
                              ? undefined
                              : () => onAllocate(order.order_id, "allocate")
                          }
                          onCancel={
                            order.order_status === "cancelled"
                              ? undefined
                              : () => onCancel(order.order_id)
                          }
                        />
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableContainer>

            <div className="px-4 py-1.5 border-t border-border">
              <Pagination
                page={safePage}
                totalPages={totalPages}
                totalItems={filtered.length}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
              />
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
