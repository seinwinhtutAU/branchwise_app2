import { useMemo, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { useSearchShortcut } from "@renderer/lib/useSearchShortcut";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import { Select } from "@renderer/components/ui/Select";
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
  const isMac = typeof window !== "undefined" && Boolean(window.api?.isMac);

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

      <Panel className="shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Customer orders
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Manage all customer orders.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              loading={refreshing}
            >
              Refresh
            </Button>
            <Button onClick={onNew}>
              <PlusIcon className="w-4 h-4" />
              New order
            </Button>
          </div>
        </div>

        {/* Quick Filter Chips Bar */}
        <div className="flex flex-wrap items-center gap-2 px-6 py-2.5 border-b border-border bg-bg-base select-none">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted mr-1">
            Quick Views:
          </span>
          <button
            type="button"
            onClick={() => handleQuickFilter("all")}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 border",
              quickView === "all" && status === "all" && pay === "all"
                ? "bg-brand text-white border-brand shadow-xs"
                : "bg-bg-subtle text-text-secondary border-border hover:bg-bg-raised hover:text-text-primary",
            )}
          >
            <span>All Orders</span>
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
              "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 border",
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
              "inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all duration-150 border",
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

        <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
          <div className="w-full sm:w-[28rem] lg:w-[32rem]">
            <Input
              ref={searchInputRef}
              aria-label="Search orders"
              placeholder="Search customer, order no. or product (/ or ⌘F)"
              startIcon={<SearchIcon className="w-4 h-4" />}
              endIcon={
                <span className="text-[10px] text-text-muted/60 border border-border rounded px-1.5 py-0.5 select-none hidden sm:inline">
                  {isMac ? "⌘F" : "Ctrl+F"}
                </span>
              }
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="w-full sm:w-52">
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as StatusFilter);
                setQuickView("all");
                setPage(1);
              }}
            >
              <option value="all">Any order status</option>
              {ORDER_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {STATUS_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-full sm:w-48">
            <Select
              aria-label="Filter by payment"
              value={pay}
              onChange={(event) => {
                setPay(event.target.value as PayFilter);
                setQuickView("all");
                setPage(1);
              }}
            >
              <option value="all">Any payment</option>
              {PAYMENT_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {PAYMENT_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <CloseIcon className="w-4 h-4" />
              Clear filters
            </Button>
          )}
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
                  <Th className="whitespace-nowrap">Order no.</Th>
                  <Th>Customer</Th>
                  <Th>Date</Th>
                  <Th className="min-w-[17.5rem] whitespace-nowrap">
                    Delivered / Ordered
                  </Th>
                  <Th className="whitespace-nowrap">Order status</Th>
                  <Th className="whitespace-nowrap">Payment status</Th>
                  <Th className="w-28 whitespace-nowrap">Action</Th>
                  <Th className="w-16" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((order) => {
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

                  return (
                    <Tr key={order.order_id} className={rowTint}>
                      <Td className={cn("whitespace-nowrap", firstCellBorder)}>
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

            <div className="px-6 py-3 border-t border-border">
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
