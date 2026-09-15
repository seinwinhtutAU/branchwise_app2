import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { type AppSettings } from "@renderer/lib/appSettings";
import {
  CellInput,
  CurrencySelect,
  EDITABLE,
  GroupSelect,
  FigureCard,
  FloatingLayer,
  MenuItem,
  MismatchIconButton,
  PAGE_SIZE,
  Panel,
  PaymentsTable,
  CopyButton,
  ProductCell,
  ReadOnlyField,
  Required,
  Reference,
  ReviewFact,
  RowProgress,
  SOFT_BLUE,
  SOFT_RED,
  SectionLabel,
  StepBar,
  SuggestInput,
} from "@renderer/components/features/wholesale/ui";
import { cn } from "@renderer/lib/utils";
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
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardIcon,
  CloseIcon,
  MoreIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  TruckIcon,
  WarehouseIcon,
} from "@renderer/components/ui/icons";
import {
  lineRemaining,
  nextAction,
  orderAmount,
  orderBalance,
  paidAmount,
  ORDER_STATUSES,
  paidPct,
  paymentStatus,
  receivedPct,
  remainingQty,
  type CustomerOrder,
  type CustomerOrderLine,
  type OrderStatus,
} from "@renderer/components/features/wholesale/customerOrders";
import {
  colorQtyPairs,
  colorQtyProblem,
  duplicateStockCodeProblem,
  formatDate,
  formatKyat,
  formatQty,
  mismatchDescription,
  nextReference,
  todayIso,
  type PaymentStatus,
} from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  formatSets,
  PAIRS_PER,
  pricedAmount,
} from "@renderer/components/features/wholesale/units";
import {
  hydrateOrders,
  saveOrders,
  useWholesale,
} from "@renderer/components/features/wholesale/store";
import {
  CUSTOMER_ORDERS_URL,
  WHOLESALE_INVENTORY_URL,
  WholesaleApiError,
  addCustomerOrderPayment,
  cancelCustomerOrder,
  createCustomerDeliveryBatch,
  createCustomerOrder,
  ordersFromWire,
  removeCustomerOrderPayment,
  updateCustomerOrder,
  updateCustomerOrderLineAllocation,
  WHOLESALE_WRITE_OFFS_URL,
  writeOffCustomerOrderLine,
  type WriteOffReason,
  type WriteOffWire,
  type CustomerDeliveryBatchInput,
  inventoryMovementsFromWire,
  type InventoryMovementWire,
  type NewCustomerOrderInput,
} from "@renderer/components/features/wholesale/api";
import {
  colorPairsForText,
  serializeColorPairs,
  stockLines,
  type ColorPairs,
  type StockLine,
} from "@renderer/components/features/wholesale/stock";
import { ColorQtyPicker } from "@renderer/components/features/wholesale/ColorQtyPicker";
import {
  GROUP_LABELS,
  type ProductGroup,
} from "@renderer/components/features/wholesale/products";
import {
  KNOWN_CUSTOMERS,
  STOCK_CODES,
  SUPPLIER_NAMES,
  productOf,
  useHydrateMasterData,
} from "@renderer/components/features/wholesale/masterData";
import { WriteOffModal } from "@renderer/components/features/wholesale/WriteOffModal";
import {
  DEFAULT_CURRENCY,
  formatOriginalAmount,
  formatRate,
  isForeignCurrency,
  previewKyatAmount,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/currency";

/** An aggregate may combine products quoted in different units, so it is stored in pairs
 * and shown the way the business reads a quantity: sets, with any leftover pairs.
 * Individual lines use their own unit below. */
const sets = (qty: number): string => formatSets(qty);

// The wholesale Customer Orders screen. Its shape follows wholesale_prototype's own
// Customer Orders page — figure cards across the top, then one panel holding the header,
// the filter row, the table and the pagination footer; a read-only detail sheet; and a
// three-step wizard for a new order — while its fields follow the ERD in
// diagram/wholesale/erd.mmd. What it does not take from the prototype is the palette:
// colour comes from this app's own tokens, repointed to blue for the whole wholesale
// workspace (see `.workspace-wholesale` in globals.css).
//
// Customer Orders reads and writes the backend now, through React Query rather than the
// hand-rolled useCachedFetch — see @renderer/lib/queryClient.ts. The shared store is
// still hydrated with the query's own answer after each fetch, since other screens
// (Supplier Vouchers' waiting list, Inventory) still read orders from there; nothing
// recomputes what the query already got right.

const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;

type View = "list" | "detail" | "allocate" | "new";
type StatusFilter = OrderStatus | "all";
type PayFilter = PaymentStatus | "all";

const STATUS_LABELS: Record<OrderStatus, string> = {
  new: "New",
  allocating: "Allocating",
  ready_to_deliver: "Ready to deliver",
  partly_delivered: "Partially delivered",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

// Filled, not tinted: the shared Badge's subtle variants read as a highlighted background
// rather than a state, so each status is solid colour with the inverse text over it. Every
// value is a token, so the lifecycle remains legible in the workspace theme.
const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
};

const PAYMENT_STYLES: Record<PaymentStatus, string> = {
  unpaid: "bg-error text-white",
  partial: "bg-warning text-white",
  paid: "bg-success text-white",
};

const PAYMENT_STATUSES: PaymentStatus[] = ["unpaid", "partial", "paid"];

const STATUS_STYLES: Record<OrderStatus, string> = {
  new: "bg-text-secondary text-bg-base",
  allocating: "bg-warning text-white",
  ready_to_deliver: "bg-brand text-white",
  partly_delivered: "bg-warning text-white",
  fulfilled: "bg-success text-white",
  cancelled: "bg-error text-white",
};

function StatusBadge({ status }: { status: OrderStatus }): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap",
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/** The original amount and exchange rate a line was priced at, shown under its Kyat
 *  figure only when the line was actually saved in a foreign currency — an MMK line
 *  (the default) shows nothing extra. */
function CurrencyNote({
  currency_code,
  original_amount,
  exchange_rate,
}: {
  currency_code?: string;
  original_amount?: number | null;
  exchange_rate?: number | null;
}): React.JSX.Element | null {
  if (
    !currency_code ||
    !isForeignCurrency(currency_code) ||
    original_amount == null ||
    exchange_rate == null
  )
    return null;
  return (
    <span className="block text-[10px] font-normal text-text-muted whitespace-nowrap">
      {formatOriginalAmount(currency_code, original_amount)} ×{" "}
      {formatRate(exchange_rate)}
    </span>
  );
}

function PaymentBadge({
  status,
}: {
  status: PaymentStatus;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap",
        PAYMENT_STYLES[status],
      )}
    >
      {PAYMENT_LABELS[status]}
    </span>
  );
}

export default function CustomerOrdersPage({
  session,
  settings,
  initialOrderId,
  onInitialOrderOpened,
}: {
  session: Session;
  settings: AppSettings | null;
  initialOrderId?: string | null;
  onInitialOrderOpened?: () => void;
}): React.JSX.Element {
  const showToast = useToast();
  useHydrateMasterData(session);
  const queryClient = useQueryClient();
  const {
    data: wire,
    isFetching: isRefreshing,
    isError,
  } = useQuery({
    queryKey: ORDERS_QUERY_KEY,
    queryFn: () => fetchJson<CustomerOrder[]>(CUSTOMER_ORDERS_URL, session),
  });
  useLoadErrorToast(isError, "customer orders");
  const { data: writeOffs = [], isError: writeOffsFailed } = useQuery({
    queryKey: ["wholesale", "write-offs"],
    queryFn: () => fetchJson<WriteOffWire[]>(WHOLESALE_WRITE_OFFS_URL, session),
  });
  useLoadErrorToast(writeOffsFailed, "mismatch explanations");
  const {
    data: inventoryWire,
    isFetching: isInventoryFetching,
    isError: inventoryFailed,
  } = useQuery({
    queryKey: ["wholesale", "inventory"],
    queryFn: () =>
      fetchJson<InventoryMovementWire[]>(WHOLESALE_INVENTORY_URL, session),
  });
  useLoadErrorToast(inventoryFailed, "wholesale inventory for allocations");
  const inventoryLines = useMemo<StockLine[]>(
    () =>
      inventoryWire
        ? stockLines(inventoryMovementsFromWire(inventoryWire))
        : [],
    [inventoryWire],
  );
  // The shared store still holds orders — other screens (Supplier Vouchers' waiting
  // list, Inventory) read them from there — so this query's answer, which React Query
  // already keeps correct on its own, is pushed in as-is rather than recomputed.
  useEffect(() => {
    if (wire) hydrateOrders(ordersFromWire(wire));
  }, [wire]);
  const { orders } = useWholesale();

  async function reload(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
    await queryClient.invalidateQueries({
      queryKey: ["wholesale", "write-offs"],
    });
  }

  async function saveAllocation(
    lineId: string,
    colorBreakdown: string,
  ): Promise<void> {
    await updateCustomerOrderLineAllocation(session, lineId, colorBreakdown);
  }

  async function finishAllocationSave(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY });
    showToast("success", "Customer allocation saved.");
  }

  async function saveDelivery(
    input: CustomerDeliveryBatchInput,
  ): Promise<void> {
    try {
      await createCustomerDeliveryBatch(session, input);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ["wholesale", "inventory"] }),
      ]);
      showToast("success", "Customer delivery recorded.");
    } catch (error) {
      showToast(
        "error",
        error instanceof WholesaleApiError
          ? error.message
          : "Could not record this customer delivery.",
      );
      throw error;
    }
  }

  async function writeOffOrderLine(
    lineId: string,
    quantity: number,
    reason: WriteOffReason,
    note: string,
  ): Promise<void> {
    await writeOffCustomerOrderLine(session, lineId, {
      quantity,
      reason,
      note,
    });
    await reload();
    showToast("success", "Write-off recorded.");
  }

  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fulfillTab, setFulfillTab] = useState<"allocate" | "deliver">("allocate");

  const selected =
    orders.find((order) => order.order_id === selectedId) ?? null;

  useEffect(() => {
    if (!initialOrderId) return;
    const target = orders.find((order) => order.order_id === initialOrderId);
    if (!target) return;
    setSelectedId(target.order_id);
    setView("detail");
    onInitialOrderOpened?.();
  }, [initialOrderId, onInitialOrderOpened, orders]);

  function openOrder(orderId: string): void {
    setSelectedId(orderId);
    setView("detail");
  }

  function openAllocation(
    orderId: string,
    tab: "allocate" | "deliver" = "allocate",
  ): void {
    setSelectedId(orderId);
    setFulfillTab(tab);
    setView("allocate");
  }

  function cancelOrder(orderId: string): void {
    cancelCustomerOrder(session, orderId)
      .then(reload)
      .catch((error) =>
        showToast(
          "error",
          error instanceof WholesaleApiError
            ? error.message
            : "Could not cancel the order.",
        ),
      );
  }

  async function persistOrder(
    order: CustomerOrder,
    originalOrder: CustomerOrder,
  ): Promise<void> {
    try {
      await updateCustomerOrder(session, order.order_id, {
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        customer_address: order.customer_address,
        order_date: order.order_date,
        lines: order.lines,
      });

      const originalPayments = originalOrder.payment.payments;
      // A payment added but left at its default of 0 (the row exists but nobody has
      // typed an amount into it yet) is not a real payment — drop it rather than send
      // it to a server that rejects anything not greater than zero. Zeroing an existing
      // payment's amount is treated the same way: as taking that payment back.
      const currentPayments = order.payment.payments.filter(
        (payment) => payment.amount > 0,
      );
      const changed = (
        left: (typeof currentPayments)[number],
        right: (typeof currentPayments)[number],
      ): boolean =>
        left.paid_on !== right.paid_on ||
        left.amount !== right.amount ||
        left.note !== right.note;

      // There is no update endpoint for a payment, so an edit removes the old row and
      // adds the new one (removing first keeps the balance check, which sums every
      // existing payment, from double-counting the row being edited). If the add then
      // fails, put the original payment back rather than leaving it simply gone.
      for (const payment of originalPayments) {
        const next = currentPayments.find(
          (candidate) => candidate.payment_id === payment.payment_id,
        );
        if (!next) {
          await removeCustomerOrderPayment(
            session,
            order.order_id,
            payment.payment_id,
          );
        } else if (changed(payment, next)) {
          await removeCustomerOrderPayment(
            session,
            order.order_id,
            payment.payment_id,
          );
          try {
            await addCustomerOrderPayment(session, order.order_id, next);
          } catch (error) {
            await addCustomerOrderPayment(session, order.order_id, payment);
            throw error;
          }
        }
      }

      for (const payment of currentPayments) {
        const previous = originalPayments.find(
          (candidate) => candidate.payment_id === payment.payment_id,
        );
        if (!previous) {
          await addCustomerOrderPayment(session, order.order_id, payment);
        }
      }

      await reload();
      showToast("success", "Order saved.");
    } catch (error) {
      showToast(
        "error",
        error instanceof WholesaleApiError
          ? error.message
          : "Could not save the order.",
      );
    }
  }

  function addOrder(order: CustomerOrder): void {
    const input: NewCustomerOrderInput = {
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      customer_address: order.customer_address,
      order_date: order.order_date,
      lines: order.lines,
    };
    createCustomerOrder(session, input)
      .then(async (created) => {
        saveOrders((current) => [created, ...current]);
        setSelectedId(created.order_id);
        setView("detail");
        await reload();
      })
      .catch((error) =>
        showToast(
          "error",
          error instanceof WholesaleApiError
            ? error.message
            : "Could not create the order.",
        ),
      );
  }

  if (view === "new") {
    return (
      <NewOrderForm
        nextOrderNo={nextOrderNo(orders)}
        settings={settings}
        onCancel={() => setView("list")}
        onCreate={addOrder}
      />
    );
  }

  if (view === "detail" && selected) {
    return (
      <OrderDetail
        order={selected}
        settings={settings}
        onSave={persistOrder}
        onBack={() => setView("list")}
        onWriteOff={writeOffOrderLine}
        writeOffs={writeOffs}
      />
    );
  }

  if (view === "allocate" && selected) {
    return (
      <AllocateAndDeliveryView
        order={selected}
        orders={orders}
        inventoryLines={inventoryLines}
        inventoryLoading={isInventoryFetching}
        initialTab={fulfillTab}
        onSaveAllocation={saveAllocation}
        onSaveAllocationsComplete={finishAllocationSave}
        onSaveDelivery={saveDelivery}
        onBack={() => setView("list")}
      />
    );
  }

  return (
    <OrderList
      orders={orders}
      onOpen={openOrder}
      onAllocate={openAllocation}
      onCancel={cancelOrder}
      onNew={() => setView("new")}
      onRefresh={reload}
      refreshing={isRefreshing}
    />
  );
}

function nextOrderNo(orders: CustomerOrder[]): string {
  return nextReference(
    "ORD",
    orders.map((order) => order.order_no),
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

function OrderList({
  orders,
  onOpen,
  onAllocate,
  onCancel,
  onNew,
  onRefresh,
  refreshing,
}: {
  orders: CustomerOrder[];
  onOpen: (orderId: string) => void;
  onAllocate: (orderId: string, tab: "allocate" | "deliver") => void;
  onCancel: (orderId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [pay, setPay] = useState<PayFilter>("all");
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
  const awaitingAllocationPairs = openOrders.reduce(
    (sum, order) =>
      sum +
      order.lines.reduce(
        (lineSum, line) =>
          lineSum +
          Math.max(
            0,
            lineRemaining(line) - (line.allocated_quantity_pairs ?? 0),
          ),
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
      return matchesQuery && matchesStatus && matchesPay;
    });
  }, [orders, search, status, pay]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isFiltered = search.trim() !== "" || status !== "all" || pay !== "all";

  function resetFilters(): void {
    setSearch("");
    setStatus("all");
    setPay("all");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Each figure is a way into the list below it, not just a number to read. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <FigureCard
          label="Open Orders"
          value={formatQty(openOrders.length)}
          sub="not fulfilled or cancelled"
        />
        <FigureCard
          label="Awaiting Allocation"
          value={sets(awaitingAllocationPairs)}
          sub="across all open orders"
          tone={awaitingAllocationPairs > 0 ? "warning" : "success"}
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

      <Panel>
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

        <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
          <div className="w-full sm:w-[28rem] lg:w-[32rem]">
            <Input
              aria-label="Search orders"
              placeholder="Search customer, order no. or product"
              startIcon={<SearchIcon className="w-4 h-4" />}
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
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right whitespace-nowrap">
                    Remaining qty
                  </Th>
                  <Th className="min-w-[11rem] whitespace-nowrap">
                    Fulfillment progress
                  </Th>
                  <Th className="whitespace-nowrap">Order status</Th>
                  <Th className="whitespace-nowrap">Payment status</Th>
                  <Th className="w-28 whitespace-nowrap">Action</Th>
                  <Th className="w-12" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((order) => {
                  const remaining = remainingQty(order);
                  const action = nextAction(order);
                  const rowTint =
                    action === "allocate"
                      ? "bg-warning-subtle/30 hover:bg-warning-subtle/50"
                      : action === "deliver"
                        ? "bg-brand-subtle/30 hover:bg-brand-subtle/50"
                        : undefined;
                  const firstCellBorder =
                    action === "allocate"
                      ? "border-l-4 border-l-warning"
                      : action === "deliver"
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
                      <Td className="text-right tabular-nums font-medium">
                        {sets(order.total_quantity_pairs)}
                      </Td>
                      <Td className="text-right tabular-nums font-semibold text-error">
                        {sets(remaining)}
                      </Td>
                      <Td>
                        <RowProgress
                          pct={receivedPct(order)}
                          label={`Fulfillment progress for ${order.order_no}`}
                        />
                      </Td>
                      <Td>
                        <StatusBadge status={order.order_status} />
                      </Td>
                      <Td>
                        <PaymentBadge status={paymentStatus(order)} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {action && (
                          <Button
                            size="sm"
                            onClick={() => onAllocate(order.order_id, action)}
                          >
                            {action === "deliver" ? "Deliver" : "Allocate"}
                          </Button>
                        )}
                      </Td>
                      <Td className="text-right">
                        <RowMenu
                          onOpen={() => onOpen(order.order_id)}
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
            <div className="border-t border-border px-6 py-2 text-xs text-text-muted">
              Amber — waiting to be allocated. Blue — allocated, waiting to go out.
            </div>
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

/** The prototype's per-row three-dot menu, carrying only the actions that actually do
 *  something with no backend behind them. */
function RowMenu({
  onOpen,
  onCancel,
}: {
  onOpen: () => void;
  onCancel?: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="Order actions"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "p-1.5 rounded-md text-text-muted",
          "transition-colors duration-150",
          "hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <MoreIcon className="w-4 h-4" />
      </button>
      {open && (
        <FloatingLayer
          anchorRef={ref}
          align="right"
          className="min-w-44 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in"
        >
          <MenuItem
            icon={<PencilIcon className="w-4 h-4" />}
            label="Open order"
            onClick={() => {
              setOpen(false);
              onOpen();
            }}
          />
          {onCancel && (
            <MenuItem
              icon={<CloseIcon className="w-4 h-4" />}
              label="Cancel order"
              danger
              onClick={() => {
                setOpen(false);
                onCancel();
              }}
            />
          )}
        </FloatingLayer>
      )}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function mergeColorPairs(target: ColorPairs, source: ColorPairs): ColorPairs {
  for (const [color, pairs] of Object.entries(source)) {
    target[color] = (target[color] ?? 0) + pairs;
  }
  return target;
}

function subtractColorPairs(
  colors: ColorPairs,
  reserved: ColorPairs,
): ColorPairs {
  return Object.fromEntries(
    Object.entries(colors).map(([color, pairs]) => [
      color,
      Math.max(0, pairs - (reserved[color] ?? 0)),
    ]),
  );
}

function availableStockColors(
  stockCode: string,
  inventoryLines: StockLine[],
): ColorPairs {
  return inventoryLines
    .filter((line) => line.stock_code === stockCode)
    .reduce(
      (colors, line) => mergeColorPairs(colors, line.color_quantities_pairs),
      {},
    );
}

function allocationsFromOtherOrders(
  orders: CustomerOrder[],
  stockCode: string,
  orderId: string,
): ColorPairs {
  return orders
    .filter(
      (order) =>
        order.order_id !== orderId && order.order_status !== "cancelled",
    )
    .reduce(
      (colors, order) =>
        order.lines
          .filter((line) => line.stock_code === stockCode)
          .reduce(
            (result, line) =>
              mergeColorPairs(
                result,
                colorPairsForText(
                  line.allocated_color_breakdown ?? "",
                  line.unit,
                ),
              ),
            colors,
          ),
      {},
    );
}

function formatColorPairs(colorPairs: ColorPairs): string {
  return Object.entries(colorPairs)
    .filter(([, pairs]) => pairs > 0)
    .map(([color, pairs]) =>
      pairs % 6 === 0 ? `${color}${pairs / 6}s` : `${color}${pairs}p`,
    )
    .join(", ");
}

function AllocationLineRow({
  line,
  order,
  orders,
  inventoryLines,
  inventoryLoading,
  draftPairs,
  onDraftChange,
}: {
  line: CustomerOrderLine;
  order: CustomerOrder;
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  inventoryLoading: boolean;
  draftPairs: ColorPairs;
  onDraftChange: (next: ColorPairs) => void;
}): React.JSX.Element {
  const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
  const stockColors = availableStockColors(line.stock_code, inventoryLines);
  const reservedByOthers = allocationsFromOtherOrders(
    orders,
    line.stock_code,
    order.order_id,
  );
  const ownColors = colorPairsForText(
    line.allocated_color_breakdown ?? "",
    line.unit,
    line.unit_conversions,
  );
  // Keep the current allocation available for edit validation, but subtract it from
  // the stock amount shown as still available for a new allocation.
  const availableForEdit = subtractColorPairs(stockColors, reservedByOthers);
  const availableToAllocate = subtractColorPairs(availableForEdit, ownColors);
  const availablePairs = Object.values(availableToAllocate).reduce(
    (sum, pairs) => sum + pairs,
    0,
  );
  const hasAvailableStock = availablePairs > 0;
  const hasCurrentAllocation = (line.allocated_quantity_pairs ?? 0) > 0;
  const orderColors = colorPairsForText(
    line.color_breakdown,
    line.unit,
    line.unit_conversions,
  );

  const availableForPicker: ColorPairs = {};
  const allColors = new Set([
    ...Object.keys(orderColors),
    ...Object.keys(draftPairs),
  ]);
  for (const color of allColors) {
    const maxOrder = orderColors[color] ?? 0;
    const maxStock = availableForEdit[color] ?? 0;
    availableForPicker[color] = Math.max(0, Math.min(maxOrder, maxStock));
  }

  const serialized = serializeColorPairs(draftPairs, setSize);
  const colorError = colorQtyProblem(serialized);
  const requestedPairs = Object.values(draftPairs).reduce(
    (sum, pairs) => sum + pairs,
    0,
  );
  const validationMessage =
    colorError ??
    (requestedPairs > lineRemaining(line)
      ? `Allocation cannot exceed ${formatIn(lineRemaining(line), line.unit, line.unit_conversions)}.`
      : null);

  return (
    <Tr>
      <Td>
        <div className="flex min-w-[12rem] flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold text-brand">
              {line.stock_code || "No stock code"}
            </span>
            <span className="text-xs text-text-muted">
              {GROUP_LABELS[line.product_group]}
            </span>
          </div>
          <span className="font-semibold text-text-primary">
            {line.description || "Unnamed product"}
          </span>
          <span className="text-xs text-text-secondary">
            <span className="font-semibold text-text-primary">Colors:</span>{" "}
            <span className="font-bold text-brand">
              {line.color_breakdown || "—"}
            </span>
          </span>
        </div>
      </Td>
      <Td className="whitespace-nowrap text-right tabular-nums">
        {formatIn(line.quantity_pairs, line.unit, line.unit_conversions)}
      </Td>
      <Td className="whitespace-nowrap text-right tabular-nums text-success">
        {formatIn(
          line.delivered_quantity_pairs,
          line.unit,
          line.unit_conversions,
        )}
      </Td>
      <Td className="whitespace-nowrap text-right tabular-nums font-semibold text-error">
        {formatIn(lineRemaining(line), line.unit, line.unit_conversions)}
      </Td>
      <Td>
        <span className="font-bold text-brand">
          {line.allocated_color_breakdown || "Not allocated"}
        </span>
      </Td>
      <Td>
        <div className="min-w-[12rem]">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold text-brand tabular-nums">
              {inventoryLoading ? "—" : formatSets(availablePairs)}
            </span>
            {!inventoryLoading && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-xs font-semibold",
                  hasAvailableStock
                    ? "bg-success-subtle text-success"
                    : hasCurrentAllocation
                      ? "bg-brand-subtle text-brand"
                      : "bg-error-subtle text-error",
                )}
              >
                {hasAvailableStock
                  ? "Available"
                  : hasCurrentAllocation
                    ? "Fully allocated"
                    : "Not available"}
              </span>
            )}
          </div>
          <div className="mt-0.5 text-xs text-text-secondary">
            {inventoryLoading
              ? "Checking stock…"
              : hasAvailableStock
                ? `Available to allocate: ${formatColorPairs(availableToAllocate)}`
                : hasCurrentAllocation
                  ? "No stock remains for another allocation."
                  : "No stock is available for this item."}
          </div>
        </div>
      </Td>
      <Td className="min-w-[21rem]">
        <ColorQtyPicker
          available={availableForPicker}
          setSize={setSize}
          value={draftPairs}
          onChange={onDraftChange}
          disabled={inventoryLoading}
        />
        {validationMessage && (
          <div className="mt-1 text-xs font-medium text-error">
            {validationMessage}
          </div>
        )}
        {!validationMessage && serialized !== "" && (
          <div className="mt-1 text-xs text-text-muted">
            {formatSets(requestedPairs, { ...PAIRS_PER, set: setSize })} selected
          </div>
        )}
      </Td>
    </Tr>
  );
}

function AllocationTable({
  order,
  orders,
  inventoryLines,
  inventoryLoading,
  onSaveAllocation,
  onSaveAllocationsComplete,
}: {
  order: CustomerOrder;
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  inventoryLoading: boolean;
  onSaveAllocation: (lineId: string, colorBreakdown: string) => Promise<void>;
  onSaveAllocationsComplete: () => Promise<void>;
}): React.JSX.Element {
  const showToast = useToast();
  const [drafts, setDrafts] = useState<Record<string, ColorPairs>>(() => {
    const initial: Record<string, ColorPairs> = {};
    for (const line of order.lines) {
      initial[line.order_line_id] = colorPairsForText(
        line.allocated_color_breakdown ?? "",
        line.unit,
        line.unit_conversions,
      );
    }
    return initial;
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const initial: Record<string, ColorPairs> = {};
    for (const line of order.lines) {
      initial[line.order_line_id] = colorPairsForText(
        line.allocated_color_breakdown ?? "",
        line.unit,
        line.unit_conversions,
      );
    }
    setDrafts(initial);
  }, [order]);

  const changedLines = order.lines.filter((line) => {
    const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
    const currentDraft = drafts[line.order_line_id] ?? {};
    const serialized = serializeColorPairs(currentDraft, setSize);
    return serialized.trim() !== (line.allocated_color_breakdown ?? "").trim();
  });

  const hasValidationErrors = order.lines.some((line) => {
    const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
    const currentDraft = drafts[line.order_line_id] ?? {};
    const requestedPairs = Object.values(currentDraft).reduce(
      (sum, p) => sum + p,
      0,
    );
    const serialized = serializeColorPairs(currentDraft, setSize);
    const colorError = colorQtyProblem(serialized);
    return colorError !== null || requestedPairs > lineRemaining(line);
  });

  const canSave =
    changedLines.length > 0 &&
    !hasValidationErrors &&
    !saving &&
    !inventoryLoading;

  async function handleSaveAllocations(): Promise<void> {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      for (const line of changedLines) {
        const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
        const currentDraft = drafts[line.order_line_id] ?? {};
        const serialized = serializeColorPairs(currentDraft, setSize);
        try {
          await onSaveAllocation(line.order_line_id, serialized);
        } catch {
          const label = line.description || line.stock_code || "product";
          showToast("error", `Could not save allocation for ${label}.`);
          return;
        }
      }
      await onSaveAllocationsComplete();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <TableContainer>
        <Thead className="top-0">
          <Tr>
            <Th className="min-w-[12rem]">Product</Th>
            <Th className="text-right whitespace-nowrap">Ordered qty</Th>
            <Th className="text-right whitespace-nowrap">Delivered qty</Th>
            <Th className="text-right whitespace-nowrap">Remaining qty</Th>
            <Th className="min-w-[13rem]">Allocated colors</Th>
            <Th className="min-w-[12rem]">Available to allocate</Th>
            <Th className="min-w-[21rem]">Allocate colors</Th>
          </Tr>
        </Thead>
        <Tbody>
          {order.lines.map((line) => (
            <AllocationLineRow
              key={line.order_line_id}
              line={line}
              order={order}
              orders={orders}
              inventoryLines={inventoryLines}
              inventoryLoading={inventoryLoading}
              draftPairs={drafts[line.order_line_id] ?? {}}
              onDraftChange={(next) =>
                setDrafts((prev) => ({
                  ...prev,
                  [line.order_line_id]: next,
                }))
              }
            />
          ))}
        </Tbody>
      </TableContainer>

      <div className="flex justify-end">
        <Button
          onClick={() => void handleSaveAllocations()}
          loading={saving}
          disabled={!canSave}
        >
          Save allocations
        </Button>
      </div>
    </div>
  );
}

function deliveryLocationsForLine(
  line: CustomerOrderLine,
  inventoryLines: StockLine[],
): string[] {
  return [
    ...new Set(
      inventoryLines
        .filter((stockLine) => stockLine.stock_code === line.stock_code)
        .map((stockLine) => stockLine.location)
        .filter(Boolean),
    ),
  ];
}

function availableDeliveryColors(
  line: CustomerOrderLine,
  order: CustomerOrder,
  orders: CustomerOrder[],
  inventoryLines: StockLine[],
  location: string,
): ColorPairs {
  const stockColors = inventoryLines
    .filter(
      (stockLine) =>
        stockLine.stock_code === line.stock_code &&
        stockLine.location === location,
    )
    .reduce(
      (colors, stockLine) =>
        mergeColorPairs(colors, stockLine.color_quantities_pairs),
      {},
    );
  return subtractColorPairs(
    stockColors,
    allocationsFromOtherOrders(orders, line.stock_code, order.order_id),
  );
}

function deliveryValidationMessage(
  line: CustomerOrderLine,
  draft: string,
  allocatedColors: ColorPairs,
  availableColors: ColorPairs,
  inventoryLoading: boolean,
): string | null {
  if (draft.trim() === "" || inventoryLoading) return null;
  const parseError = colorQtyProblem(draft);
  if (parseError) return parseError;
  const requestedColors = colorPairsForText(
    draft,
    line.unit,
    line.unit_conversions,
  );
  const requestedPairs = Object.values(requestedColors).reduce(
    (sum, pairs) => sum + pairs,
    0,
  );
  if (requestedPairs > lineRemaining(line))
    return `Delivery cannot exceed ${formatIn(lineRemaining(line), line.unit, line.unit_conversions)}.`;
  for (const [color, pairs] of Object.entries(requestedColors)) {
    if (pairs > (allocatedColors[color] ?? 0))
      return `Only ${formatSets(allocatedColors[color] ?? 0)} of ${color} is allocated for delivery.`;
    if (pairs > (availableColors[color] ?? 0))
      return `Only ${formatSets(availableColors[color] ?? 0)} of ${color} is available at this location.`;
  }
  return null;
}

function DeliveryView({
  order,
  orders,
  inventoryLines,
  inventoryLoading,
  onSaveDelivery,
}: {
  order: CustomerOrder;
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  inventoryLoading: boolean;
  onSaveDelivery: (input: CustomerDeliveryBatchInput) => Promise<void>;
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<Record<string, ColorPairs>>({});
  const [fromLocation, setFromLocation] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(todayIso());
  const [deliveryAddress, setDeliveryAddress] = useState(
    order.customer_address || "",
  );
  const [deliveryNote, setDeliveryNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(
    () => setDeliveryAddress(order.customer_address || ""),
    [order.customer_address],
  );

  const locationOptions = [
    ...new Set(
      order.lines.flatMap((line) =>
        deliveryLocationsForLine(line, inventoryLines),
      ),
    ),
  ];
  const selectedLocation = fromLocation || locationOptions[0] || "";
  const rows = order.lines.map((line) => {
    const allocatedColors = colorPairsForText(
      line.allocated_color_breakdown ?? "",
      line.unit,
      line.unit_conversions,
    );
    const availableColors = availableDeliveryColors(
      line,
      order,
      orders,
      inventoryLines,
      selectedLocation,
    );
    const draftPairs = drafts[line.order_line_id] ?? {};
    const setSize = line.unit_conversions?.set ?? PAIRS_PER.set;
    const pairs = Object.values(draftPairs).reduce((sum, value) => sum + value, 0);
    const serialized = serializeColorPairs(draftPairs, setSize);
    return {
      line,
      draftPairs,
      pairs,
      serialized,
      allocatedColors,
      availableColors,
      problem: deliveryValidationMessage(
        line,
        serialized,
        allocatedColors,
        availableColors,
        inventoryLoading,
      ),
    };
  });
  const selectedRows = rows.filter((row) => row.pairs > 0);
  const canSave =
    !inventoryLoading &&
    deliveryDate.trim() !== "" &&
    selectedLocation !== "" &&
    selectedRows.length > 0 &&
    selectedRows.every((row) => row.problem === null);

  async function saveDelivery(): Promise<void> {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await onSaveDelivery({
        order_id: order.order_id,
        delivered_on: deliveryDate,
        delivery_address: deliveryAddress.trim(),
        note: deliveryNote.trim(),
        lines: selectedRows.map((row) => ({
          stock_code: row.line.stock_code,
          location: selectedLocation,
          color_breakdown: serializeColorPairs(
            drafts[row.line.order_line_id] ?? {},
            row.line.unit_conversions?.set ?? PAIRS_PER.set,
          ),
          unit: row.line.unit,
        })),
      });
      setDrafts({});
      setDeliveryNote("");
      setDeliveryDate(todayIso());
      setFromLocation("");
      setDeliveryAddress(order.customer_address || "");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border-strong pb-4">
        <div>
          <h3 className="text-base font-semibold text-text-primary">
            Delivery details
          </h3>
          <p className="mt-1 text-sm text-text-secondary">
            Record the stock handed to this customer.
          </p>
        </div>
        <span className="text-sm font-semibold tabular-nums text-brand">
          {formatSets(selectedRows.reduce((sum, row) => sum + row.pairs, 0))}{" "}
          selected
        </span>
        <div className="grid w-full gap-3 sm:grid-cols-4">
          <Select
            label="From location"
            value={selectedLocation}
            onChange={(event) => setFromLocation(event.target.value)}
            disabled={inventoryLoading || locationOptions.length === 0}
          >
            {locationOptions.length === 0 ? (
              <option value="">No stock location</option>
            ) : (
              locationOptions.map((location) => (
                <option key={location} value={location}>
                  {location}
                </option>
              ))
            )}
          </Select>
          <Input
            label="Delivery date"
            type="date"
            value={deliveryDate}
            onChange={(event) => setDeliveryDate(event.target.value)}
          />
          <Input
            label="Delivery address"
            value={deliveryAddress}
            onChange={(event) => setDeliveryAddress(event.target.value)}
            placeholder="Customer address"
          />
          <Input
            label="Delivery note"
            value={deliveryNote}
            onChange={(event) => setDeliveryNote(event.target.value)}
            placeholder="Optional note"
          />
        </div>
      </div>

      <TableContainer>
        <Thead className="top-0">
          <Tr>
            <Th className="min-w-[12rem]">Product</Th>
            <Th className="text-right whitespace-nowrap">Remaining</Th>
            <Th className="min-w-[13rem]">Allocated colors</Th>
            <Th className="min-w-[13rem]">Available to deliver</Th>
            <Th className="min-w-[21rem]">Deliver colors</Th>
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row) => {
            const deliverableColors = Object.entries(
              row.allocatedColors,
            ).reduce<ColorPairs>((colors, [color, pairs]) => {
              const deliverablePairs = Math.min(
                pairs,
                row.availableColors[color] ?? 0,
              );
              if (deliverablePairs > 0) colors[color] = deliverablePairs;
              return colors;
            }, {});
            const availablePairs = Object.values(deliverableColors).reduce(
              (sum, pairs) => sum + pairs,
              0,
            );
            const setSize = row.line.unit_conversions?.set ?? PAIRS_PER.set;
            return (
              <Tr key={row.line.order_line_id}>
                <Td>
                  <div className="flex min-w-[12rem] flex-col gap-0.5">
                    <span className="font-bold text-brand">
                      {row.line.stock_code || "No stock code"}
                    </span>
                    <span className="font-semibold text-text-primary">
                      {row.line.description || "Unnamed product"}
                    </span>
                  </div>
                </Td>
                <Td className="whitespace-nowrap text-right font-semibold tabular-nums text-error">
                  {formatIn(
                    lineRemaining(row.line),
                    row.line.unit,
                    row.line.unit_conversions,
                  )}
                </Td>
                <Td>
                  <span className="font-bold text-brand">
                    {formatColorPairs(row.allocatedColors) || "No allocation"}
                  </span>
                </Td>
                <Td>
                  <div className="min-w-[13rem]">
                    <div className="font-semibold tabular-nums text-brand">
                      {inventoryLoading
                        ? "—"
                        : formatSets(availablePairs)}
                    </div>
                    <div className="mt-0.5 text-xs text-text-secondary">
                      {inventoryLoading
                        ? "Checking stock…"
                        : formatColorPairs(deliverableColors) ||
                          "No allocated colors available."}
                    </div>
                  </div>
                </Td>
                <Td className="min-w-[21rem]">
                  <ColorQtyPicker
                    available={deliverableColors}
                    setSize={setSize}
                    value={row.draftPairs}
                    onChange={(next) =>
                      setDrafts((current) => ({
                        ...current,
                        [row.line.order_line_id]: next,
                      }))
                    }
                    disabled={
                      (row.line.allocated_quantity_pairs ?? 0) <= 0 ||
                      inventoryLoading ||
                      selectedLocation === ""
                    }
                  />
                  {row.problem && (
                    <div className="mt-1 text-xs font-medium text-error">
                      {row.problem}
                    </div>
                  )}
                  {!row.problem && row.serialized !== "" && (
                    <div className="mt-1 text-xs text-text-muted">
                      {formatSets(row.pairs, { ...PAIRS_PER, set: setSize })} selected
                    </div>
                  )}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </TableContainer>

      <div className="flex justify-end">
        <Button
          onClick={() => void saveDelivery()}
          loading={saving}
          disabled={!canSave}
        >
          Record delivery
        </Button>
      </div>
    </div>
  );
}

function AllocateAndDeliveryView({
  order,
  orders,
  inventoryLines,
  inventoryLoading,
  initialTab = "allocate",
  onSaveAllocation,
  onSaveAllocationsComplete,
  onSaveDelivery,
  onBack,
}: {
  order: CustomerOrder;
  orders: CustomerOrder[];
  inventoryLines: StockLine[];
  inventoryLoading: boolean;
  initialTab?: "allocate" | "deliver";
  onSaveAllocation: (lineId: string, colorBreakdown: string) => Promise<void>;
  onSaveAllocationsComplete: () => Promise<void>;
  onSaveDelivery: (input: CustomerDeliveryBatchInput) => Promise<void>;
  onBack: () => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<"allocate" | "deliver">(initialTab);
  const allocatedPairs = order.lines.reduce(
    (sum, line) => sum + (line.allocated_quantity_pairs ?? 0),
    0,
  );
  const availableToAllocatePairs = order.lines.reduce((sum, line) => {
    const stockColors = availableStockColors(line.stock_code, inventoryLines);
    const reservedByOthers = allocationsFromOtherOrders(
      orders,
      line.stock_code,
      order.order_id,
    );
    const ownColors = colorPairsForText(
      line.allocated_color_breakdown ?? "",
      line.unit,
      line.unit_conversions,
    );
    const availableForEdit = subtractColorPairs(stockColors, reservedByOthers);
    const availableToAllocate = subtractColorPairs(availableForEdit, ownColors);
    const lineAvailablePairs = Object.values(availableToAllocate).reduce(
      (acc, p) => acc + p,
      0,
    );
    return sum + lineAvailablePairs;
  }, 0);
  const availableToDeliverPairs = order.lines.reduce((sum, line) => {
    const allocatedColors = colorPairsForText(
      line.allocated_color_breakdown ?? "",
      line.unit,
      line.unit_conversions,
    );
    const stockColors = availableStockColors(line.stock_code, inventoryLines);
    const reservedByOthers = allocationsFromOtherOrders(
      orders,
      line.stock_code,
      order.order_id,
    );
    const availableStock = subtractColorPairs(stockColors, reservedByOthers);
    const lineDeliverablePairs = Object.entries(allocatedColors).reduce(
      (acc, [color, allocated]) =>
        acc + Math.min(allocated, availableStock[color] ?? 0),
      0,
    );
    return sum + lineDeliverablePairs;
  }, 0);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  return (
    <div className="flex flex-col gap-3">
      <Button variant="ghost" size="sm" onClick={onBack} className="self-start">
        <ChevronLeftIcon className="w-4 h-4" />
        Back to orders
      </Button>
      <Panel className="border-border-strong">
        <div className="border-b border-border-strong px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-semibold tracking-tight text-text-primary">
                  Fulfill order
                </h2>
                <StatusBadge status={order.order_status} />
              </div>
              <p className="mt-1 text-sm text-text-muted">
                {order.order_no} · {order.customer_name} ·{" "}
                {formatDate(order.order_date)}
              </p>
            </div>
          </div>
          <div className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-3">
            <FigureCard
              label="Delivered qty"
              value={sets(order.delivered_quantity_pairs)}
              sub="sent to customer"
              tone={order.delivered_quantity_pairs > 0 ? "success" : "neutral"}
              className="border-border-strong"
            />
            <FigureCard
              label="Allocated qty"
              value={sets(allocatedPairs)}
              sub="reserved from stock"
              tone={allocatedPairs > 0 ? "brand" : "neutral"}
              className="border-border-strong"
            />
            <FigureCard
              label="Remaining qty"
              value={sets(remainingQty(order))}
              sub="waiting to fulfill"
              tone={remainingQty(order) > 0 ? "error" : "success"}
              className="border-border-strong"
            />
          </div>
          <div
            role="tablist"
            aria-label="Fulfill order tab"
            className="mt-4 inline-flex w-full sm:w-auto items-center gap-1.5 rounded-lg bg-bg-subtle p-1 border border-border"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "allocate"}
              onClick={() => setTab("allocate")}
              className={cn(
                "flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                tab === "allocate"
                  ? "bg-brand text-white shadow-sm font-semibold"
                  : "text-text-muted hover:text-text-primary hover:bg-bg-base/60",
              )}
            >
              <ClipboardIcon className="w-4 h-4 shrink-0" />
              <span>Allocate stock</span>
              <span
                className={cn(
                  "ml-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                  tab === "allocate"
                    ? "bg-success text-white"
                    : "bg-success-subtle text-success",
                )}
              >
                {inventoryLoading ? "—" : sets(availableToAllocatePairs)}
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "deliver"}
              onClick={() => setTab("deliver")}
              className={cn(
                "flex-1 sm:flex-none inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                tab === "deliver"
                  ? "bg-brand text-white shadow-sm font-semibold"
                  : "text-text-muted hover:text-text-primary hover:bg-bg-base/60",
              )}
            >
              <TruckIcon className="w-4 h-4 shrink-0" />
              <span>Deliver to customer</span>
              <span
                className={cn(
                  "ml-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
                  tab === "deliver"
                    ? "bg-success text-white"
                    : "bg-success-subtle text-success",
                )}
              >
                {inventoryLoading ? "—" : sets(availableToDeliverPairs)}
              </span>
            </button>
          </div>
        </div>
        <div className="px-5 py-4">
          {tab === "allocate" ? (
            <AllocationTable
              order={order}
              orders={orders}
              inventoryLines={inventoryLines}
              inventoryLoading={inventoryLoading}
              onSaveAllocation={onSaveAllocation}
              onSaveAllocationsComplete={onSaveAllocationsComplete}
            />
          ) : allocatedPairs <= 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
              <WarehouseIcon className="h-10 w-10 text-text-muted" />
              <div className="flex flex-col gap-1">
                <p className="text-base font-semibold text-text-primary">
                  Nothing is allocated yet
                </p>
                <p className="text-sm text-text-muted">
                  Allocate stock first before recording a delivery.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setTab("allocate")}
              >
                Go to allocation
              </Button>
            </div>
          ) : (
            <DeliveryView
              order={order}
              orders={orders}
              inventoryLines={inventoryLines}
              inventoryLoading={inventoryLoading}
              onSaveDelivery={onSaveDelivery}
            />
          )}
        </div>
      </Panel>
    </div>
  );
}

const customerOrderDetailLineSchema = z.object({
  order_line_id: z.string(),
  stock_code: z.string(),
  description: z.string(),
  product_group: z.enum(["man", "lady", "child"]),
  supplier_name: z.string(),
  color_breakdown: z.string(),
  unit: z.enum(["pair", "set", "dozen"]),
  quantity_pairs: z.number().finite(),
  delivered_quantity_pairs: z.number().finite().min(0),
  allocated_quantity_pairs: z.number().finite().min(0).optional(),
  allocated_color_breakdown: z.string().optional(),
  selling_price: z.number().finite().min(0),
  currency_code: z.string().optional(),
  original_selling_price: z.number().finite().min(0).nullable().optional(),
  exchange_rate: z.number().finite().min(0).nullable().optional(),
});

const customerOrderDetailSchema = z.object({
  order: z.object({
    order_id: z.string(),
    order_no: z.string(),
    customer_name: z.string().trim().min(1, "Enter a customer name."),
    customer_phone: z.string(),
    customer_address: z.string(),
    order_date: z.string().trim().min(1, "Choose an order date."),
    total_quantity_pairs: z.number().finite().min(0),
    delivered_quantity_pairs: z.number().finite().min(0),
    order_status: z.enum([
      "new",
      "allocating",
      "ready_to_deliver",
      "partly_delivered",
      "fulfilled",
      "cancelled",
    ]),
    payment: z.object({
      account_id: z.string(),
      payments: z.array(
        z.object({
          payment_id: z.string(),
          paid_on: z.string(),
          amount: z.number().finite().min(0),
          note: z.string(),
        }),
      ),
    }),
    lines: z.array(customerOrderDetailLineSchema),
  }),
});

interface CustomerOrderDetailFormValues {
  order: CustomerOrder;
}

function OrderDetail({
  order: initialOrder,
  settings,
  onSave,
  onBack,
  onWriteOff,
  writeOffs,
}: {
  order: CustomerOrder;
  settings: AppSettings | null;
  onSave: (order: CustomerOrder, originalOrder: CustomerOrder) => Promise<void>;
  onBack: () => void;
  onWriteOff: (
    lineId: string,
    quantity: number,
    reason: WriteOffReason,
    note: string,
  ) => Promise<void>;
  writeOffs: WriteOffWire[];
}): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  const [addingLineId, setAddingLineId] = useState<string | null>(null);
  const [writeOffLine, setWriteOffLine] = useState<CustomerOrderLine | null>(
    null,
  );
  const {
    control,
    getValues,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<CustomerOrderDetailFormValues>({
    resolver: zodResolver(customerOrderDetailSchema),
    defaultValues: { order: initialOrder },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const {
    fields: lineFields,
    append,
    remove,
    replace,
  } = useFieldArray({
    control,
    name: "order.lines",
  });
  const order = useWatch({ control, name: "order" }) as CustomerOrder;

  useEffect(() => {
    reset({ order: initialOrder });
    setAddingLineId(null);
  }, [initialOrder, reset]);

  async function saveChanges(
    values: CustomerOrderDetailFormValues,
  ): Promise<void> {
    setSaving(true);
    try {
      await onSave(values.order, initialOrder);
    } finally {
      setSaving(false);
    }
  }

  const pct = receivedPct(order);

  // total_quantity_pairs/delivered_quantity_pairs are the server's own running totals across order.lines (see
  // _out in the router) — recomputed here the same way whenever a line changes, so the
  // header figures never lag behind an edit still sitting unsaved on screen.
  function apply(patch: Partial<CustomerOrder>): void {
    if (patch.lines) {
      replace(patch.lines);
      setValue(
        "order.total_quantity_pairs",
        patch.lines.reduce((sum, line) => sum + line.quantity_pairs, 0),
        { shouldDirty: true, shouldValidate: true },
      );
      setValue(
        "order.delivered_quantity_pairs",
        patch.lines.reduce(
          (sum, line) => sum + line.delivered_quantity_pairs,
          0,
        ),
        { shouldDirty: true, shouldValidate: true },
      );
    }
    if (patch.payment) {
      setValue("order.payment", patch.payment, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
    for (const [key, value] of Object.entries(patch)) {
      if (key === "lines" || key === "payment") continue;
      setValue(`order.${key}` as "order.customer_name", value as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  // Editing a line is editing the order: the quantity is re-read from the colours, the
  // same rule the wizard follows, so the two can never be written down differently.
  function setLine(index: number, patch: Partial<CustomerOrderLine>): void {
    const lines = getValues("order.lines").map((line, position) =>
      position === index ? { ...line, ...patch } : line,
    );
    apply({ lines });
  }

  function setColors(index: number, colors: string): void {
    setLine(index, {
      color_breakdown: colors,
      quantity_pairs: colorQtyPairs(colors, "set"),
    });
  }

  function setStockCode(index: number, code: string): void {
    const known = productOf(code);
    setLine(
      index,
      known
        ? {
            stock_code: code,
            description: known.description,
            product_group: known.product_group,
            unit: "set",
            unit_conversions: known.default_unit_conversions ?? PAIRS_PER,
          }
        : { stock_code: code },
    );
  }

  function addLine(): void {
    const lineId = `col-${Date.now()}`;
    setAddingLineId(lineId);
    append({
      order_line_id: lineId,
      stock_code: "",
      description: "",
      product_group: "man",
      supplier_name: "",
      color_breakdown: "",
      unit: "set",
      quantity_pairs: 0,
      delivered_quantity_pairs: 0,
      selling_price: 0,
      currency_code: DEFAULT_CURRENCY,
      original_selling_price: null,
      exchange_rate: null,
    });
  }

  function removeLine(index: number): void {
    if (order.lines[index]?.order_line_id === addingLineId) {
      setAddingLineId(null);
    }
    const lines = order.lines.filter((_, position) => position !== index);
    remove(index);
    setValue(
      "order.total_quantity_pairs",
      lines.reduce((sum, line) => sum + line.quantity_pairs, 0),
      { shouldDirty: true, shouldValidate: true },
    );
    setValue(
      "order.delivered_quantity_pairs",
      lines.reduce((sum, line) => sum + line.delivered_quantity_pairs, 0),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  function cancelAddLine(): void {
    if (!addingLineId) return;
    apply({
      lines: order.lines.filter((line) => line.order_line_id !== addingLineId),
    });
    setAddingLineId(null);
  }

  function setPayment(
    paymentId: string,
    patch: Partial<CustomerOrder["payment"]["payments"][number]>,
  ): void {
    apply({
      payment: {
        ...order.payment,
        payments: order.payment.payments.map((payment) =>
          payment.payment_id === paymentId ? { ...payment, ...patch } : payment,
        ),
      },
    });
  }

  function addPayment(
    payment: CustomerOrder["payment"]["payments"][number],
  ): void {
    apply({
      payment: {
        ...order.payment,
        payments: [...order.payment.payments, payment],
      },
    });
  }

  function removePayment(paymentId: string): void {
    apply({
      payment: {
        ...order.payment,
        payments: order.payment.payments.filter(
          (payment) => payment.payment_id !== paymentId,
        ),
      },
    });
  }

  const amount = orderAmount(order);
  const balance = orderBalance(order);
  const paid = paidAmount(order);
  const paidShare = paidPct(order);
  const hasChanges = isDirty;

  return (
    <>
      <div className="flex flex-col gap-5">
        <div>
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeftIcon className="w-4 h-4" />
            Back to orders
          </Button>
        </div>

        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                  {order.order_no}
                </h2>
                <StatusBadge status={order.order_status} />
                <PaymentBadge status={paymentStatus(order)} />
              </div>
              <p className="mt-0.5 truncate text-sm text-text-muted">
                {order.customer_name} · {formatDate(order.order_date)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => void handleSubmit(saveChanges)()}
                loading={saving}
                disabled={!hasChanges}
              >
                <CheckIcon className="w-4 h-4" />
                Save changes
              </Button>
            </div>
          </div>

          <div className="px-6 py-6 flex flex-col gap-10">
            <section>
              <SectionLabel>Order information</SectionLabel>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-text-primary">
                    Customer
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Controller
                      control={control}
                      name="order.customer_name"
                      render={({ field }) => (
                        <Input
                          label="Customer name"
                          className={EDITABLE}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          error={errors.order?.customer_name?.message}
                        />
                      )}
                    />
                    <Controller
                      control={control}
                      name="order.customer_phone"
                      render={({ field }) => (
                        <Input
                          label="Phone"
                          className={EDITABLE}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                        />
                      )}
                    />
                    <div className="sm:col-span-2">
                      <label className="mb-1.5 block text-sm font-medium text-text-secondary">
                        Address
                      </label>
                      <Controller
                        control={control}
                        name="order.customer_address"
                        render={({ field }) => (
                          <CellInput
                            label="Address"
                            placeholder="Customer address"
                            multiline
                            value={field.value}
                            onChange={field.onChange}
                          />
                        )}
                      />
                    </div>
                  </div>
                </div>
                <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-text-primary">
                    Order
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ReadOnlyField
                      label="Order no."
                      value={order.order_no}
                      copyable
                    />
                    <Controller
                      control={control}
                      name="order.order_date"
                      render={({ field }) => (
                        <Input
                          label="Order date"
                          type="date"
                          className={EDITABLE}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          error={errors.order?.order_date?.message}
                        />
                      )}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <SectionLabel>Products</SectionLabel>
                <div className="w-full sm:w-80 md:w-96">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-text-secondary">
                      Delivery
                    </span>
                    <span className="tabular-nums font-semibold text-text-primary">
                      {sets(order.delivered_quantity_pairs)} /{" "}
                      {sets(order.total_quantity_pairs)} ({pct}
                      %)
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={pct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Fulfillment progress"
                    className="h-2 rounded-full bg-bg-raised overflow-hidden"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                        pct === 100 ? "bg-success" : "bg-brand",
                      )}
                      style={{ width: String(pct) + "%" }}
                    />
                  </div>
                </div>
              </div>
              <TableContainer>
                <Thead className="top-0">
                  <Tr>
                    <Th className="min-w-[10rem] whitespace-nowrap">
                      Supplier / Factory
                    </Th>
                    <Th className="min-w-[18rem]">Product</Th>
                    <Th className="min-w-[11rem]">Colors</Th>
                    <Th className="text-right whitespace-nowrap">
                      Ordered qty
                    </Th>
                    <Th className="text-right whitespace-nowrap">
                      Delivered qty
                    </Th>
                    <Th className="text-right whitespace-nowrap">
                      Remaining qty
                    </Th>
                    <Th className="text-right min-w-[10rem]">
                      Selling price
                      <span className="block text-xs font-normal text-text-muted">
                        per set
                      </span>
                    </Th>
                    <Th className="text-right">Amount</Th>
                    <Th className="text-center">Mismatch</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {lineFields.map((field, index) => {
                    const line = order.lines[index];
                    if (!line) return null;
                    const explanation = writeOffs.find(
                      (entry) => entry.subject_id === line.order_line_id,
                    );
                    return (
                      <Tr key={field.id}>
                        <Td>
                          <Controller
                            control={control}
                            name={`order.lines.${index}.supplier_name`}
                            render={({ field: supplierField }) => (
                              <SuggestInput
                                bare
                                label={`Supplier for product ${index + 1}`}
                                placeholder="Choose…"
                                suggestions={SUPPLIER_NAMES}
                                value={supplierField.value}
                                onChange={supplierField.onChange}
                              />
                            )}
                          />
                        </Td>
                        <Td className="min-w-[18rem]">
                          <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1">
                              <Controller
                                control={control}
                                name={`order.lines.${index}.stock_code`}
                                render={({ field: stockField }) => (
                                  <SuggestInput
                                    bare
                                    label={`Stock code for product ${index + 1}`}
                                    placeholder="A1001"
                                    suggestions={STOCK_CODES}
                                    value={stockField.value}
                                    onChange={(next) => {
                                      stockField.onChange(next);
                                      setStockCode(index, next);
                                    }}
                                    error={
                                      duplicateStockCodeProblem(
                                        order.lines,
                                        index,
                                      ) ?? undefined
                                    }
                                  />
                                )}
                              />
                              <CopyButton
                                value={line.stock_code}
                                what="stock code"
                              />
                            </div>
                            <Controller
                              control={control}
                              name={`order.lines.${index}.description`}
                              render={({ field: descriptionField }) => (
                                <CellInput
                                  label={`Description for product ${index + 1}`}
                                  placeholder="Men's leather sandal"
                                  multiline
                                  value={descriptionField.value}
                                  onChange={descriptionField.onChange}
                                />
                              )}
                            />
                            <Controller
                              control={control}
                              name={`order.lines.${index}.product_group`}
                              render={({ field: groupField }) => (
                                <GroupSelect
                                  label={`Group for product ${index + 1}`}
                                  value={groupField.value}
                                  onChange={groupField.onChange}
                                />
                              )}
                            />
                          </div>
                        </Td>
                        <Td>
                          <Controller
                            control={control}
                            name={`order.lines.${index}.color_breakdown`}
                            render={({ field: colorField }) => (
                              <CellInput
                                label={`Colors for product ${index + 1}`}
                                placeholder="Enter color qty"
                                multiline
                                value={colorField.value}
                                onChange={(next) => {
                                  colorField.onChange(next);
                                  setColors(index, next);
                                }}
                                error={
                                  colorQtyProblem(line.color_breakdown) ??
                                  (line.quantity_pairs <
                                  line.delivered_quantity_pairs
                                    ? `${sets(line.delivered_quantity_pairs)} have already gone to the customer.`
                                    : undefined)
                                }
                              />
                            )}
                          />
                        </Td>
                        <Td className="text-right tabular-nums">
                          {sets(line.quantity_pairs)}
                        </Td>
                        <Td className="text-right tabular-nums font-medium text-success">
                          {sets(line.delivered_quantity_pairs)}
                        </Td>
                        <Td className="text-right tabular-nums font-semibold text-error">
                          <div className="flex flex-col items-end gap-1">
                            <span
                              className={
                                (line.lost_quantity_pairs ?? 0) > 0
                                  ? "text-warning"
                                  : undefined
                              }
                            >
                              {sets(lineRemaining(line))}
                              {(line.lost_quantity_pairs ?? 0) > 0 &&
                                !explanation && (
                                  <span className="ml-1 text-xs font-medium text-warning">
                                    (
                                    {sets(line.lost_quantity_pairs ?? 0)}{" "}
                                    written off)
                                  </span>
                                )}
                            </span>
                            {explanation && (
                              <span
                                className="text-[10px] font-medium text-warning"
                                title={
                                  explanation
                                    ? mismatchDescription(explanation)
                                    : undefined
                                }
                              >
                                {mismatchDescription(explanation)}
                              </span>
                            )}
                          </div>
                        </Td>
                        <Td>
                          <div className="flex flex-col gap-1">
                            <CurrencySelect
                              label={`Currency for product ${index + 1}`}
                              value={
                                (line.currency_code as CurrencyCode) ||
                                DEFAULT_CURRENCY
                              }
                              onChange={(code) => {
                                if (code === DEFAULT_CURRENCY) {
                                  setLine(index, {
                                    currency_code: DEFAULT_CURRENCY,
                                    original_selling_price: null,
                                    exchange_rate: null,
                                  });
                                  return;
                                }
                                const original =
                                  line.original_selling_price ?? 0;
                                const prefillRate =
                                  line.exchange_rate ??
                                  (settings?.today_exchange_rates[code]
                                    ? Number(
                                        settings.today_exchange_rates[code],
                                      )
                                    : null);
                                setLine(index, {
                                  currency_code: code,
                                  original_selling_price: original,
                                  exchange_rate: prefillRate,
                                  selling_price:
                                    prefillRate != null
                                      ? previewKyatAmount(
                                          original,
                                          prefillRate,
                                        )
                                      : line.selling_price,
                                });
                              }}
                              className="w-full"
                            />
                            {line.currency_code &&
                            isForeignCurrency(line.currency_code) ? (
                              <>
                                <CellInput
                                  label={`Original price for product ${index + 1}`}
                                  placeholder="Original price"
                                  className="text-right"
                                  value={String(
                                    line.original_selling_price ?? "",
                                  )}
                                  onChange={(next) => {
                                    const original = Number(next) || 0;
                                    const rate = line.exchange_rate ?? 0;
                                    setLine(index, {
                                      original_selling_price: original,
                                      selling_price: previewKyatAmount(
                                        original,
                                        rate,
                                      ),
                                    });
                                  }}
                                />
                                <CellInput
                                  label={`Exchange rate for product ${index + 1}`}
                                  placeholder="Exchange rate"
                                  className="text-right"
                                  value={String(line.exchange_rate ?? "")}
                                  onChange={(next) => {
                                    const rate = Number(next) || 0;
                                    const original =
                                      line.original_selling_price ?? 0;
                                    setLine(index, {
                                      exchange_rate: rate,
                                      selling_price: previewKyatAmount(
                                        original,
                                        rate,
                                      ),
                                    });
                                  }}
                                />
                                <span className="text-right text-[10px] text-text-muted tabular-nums">
                                  = {formatKyat(line.selling_price)}
                                </span>
                              </>
                            ) : (
                              <Controller
                                control={control}
                                name={`order.lines.${index}.selling_price`}
                                render={({ field: priceField }) => (
                                  <CellInput
                                    label={`Selling price for product ${index + 1}`}
                                    placeholder="0"
                                    numeric
                                    className="text-right"
                                    value={String(priceField.value)}
                                    onChange={(next) => {
                                      priceField.onChange(
                                        Number(next) || 0,
                                      );
                                      setLine(index, {
                                        selling_price: Number(next) || 0,
                                      });
                                    }}
                                    error={
                                      errors.order?.lines?.[index]
                                        ?.selling_price?.message
                                    }
                                  />
                                )}
                              />
                            )}
                          </div>
                        </Td>
                        <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                          {formatKyat(
                            pricedAmount(
                              line.quantity_pairs,
                              line.unit,
                              line.selling_price,
                              line.unit_conversions,
                            ),
                          )}
                          <button
                            type="button"
                            onClick={() => removeLine(index)}
                            title="Remove this product"
                            aria-label={`Remove product ${index + 1}`}
                            className={cn(
                              "ml-2 p-1 rounded-md align-middle transition-colors duration-150",
                              SOFT_RED,
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error",
                            )}
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </Td>
                        <Td className="text-center">
                          <MismatchIconButton
                            explained={Boolean(explanation)}
                            disabled={lineRemaining(line) <= 0}
                            onClick={() => setWriteOffLine(line)}
                          />
                        </Td>
                      </Tr>
                    );
                  })}
                  <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                    <Td className="font-semibold" colSpan={3}>
                      Total
                    </Td>
                    <Td className="text-right tabular-nums font-semibold">
                      {sets(order.total_quantity_pairs)}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold text-success">
                      {sets(order.delivered_quantity_pairs)}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold text-error">
                      {sets(remainingQty(order))}
                    </Td>
                    <Td />
                    <Td className="text-right tabular-nums font-semibold text-brand">
                      {formatKyat(orderAmount(order))}
                    </Td>
                    <Td />
                  </Tr>
                </Tbody>
              </TableContainer>
              <div className="mt-3">
                <Button size="sm" onClick={addLine}>
                  <PlusIcon className="w-4 h-4" />
                  Add product
                </Button>
                {addingLineId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelAddLine}
                    className={cn(SOFT_RED, "ml-2")}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </section>

            <section>
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <SectionLabel>Payment</SectionLabel>
                <div className="w-full sm:w-80 md:w-96">
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-medium text-text-secondary">
                      Paid so far
                    </span>
                    <span className="tabular-nums font-semibold text-text-primary">
                      {formatKyat(paid)} / {formatKyat(amount)} ({paidShare}%)
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={paidShare}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Paid so far"
                    className="h-2 rounded-full bg-bg-raised overflow-hidden"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                        paidShare === 100 ? "bg-success" : "bg-warning",
                      )}
                      style={{ width: String(paidShare) + "%" }}
                    />
                  </div>
                </div>
              </div>
              <PaymentsTable
                payments={order.payment.payments}
                balance={balance}
                who="customer"
                onAdd={addPayment}
                onUpdate={(payment) => setPayment(payment.payment_id, payment)}
                onRemove={removePayment}
                readOnly={false}
              />
            </section>
          </div>
        </Panel>
      </div>
      <WriteOffModal
        open={writeOffLine !== null}
        subject={
          writeOffLine
            ? `${order.order_no} · ${writeOffLine.stock_code}`
            : "this order line"
        }
        remaining={writeOffLine ? lineRemaining(writeOffLine) : 0}
        unit={writeOffLine?.unit ?? "pair"}
        onClose={() => setWriteOffLine(null)}
        onSubmit={(quantity, reason, note) =>
          onWriteOff(writeOffLine!.order_line_id, quantity, reason, note)
        }
      />
    </>
  );
}

// ── New order ────────────────────────────────────────────────────────────────

interface DraftLine {
  stock_code: string;
  description: string;
  product_group: ProductGroup;
  supplier_name: string;
  color_breakdown: string;
  unit: "pair" | "set" | "dozen";
  unit_conversions: { pair: number; set: number; dozen: number };
  selling_price: string;
  currency_code: CurrencyCode;
  original_selling_price: string;
  exchange_rate: string;
}

const draftLineSchema = z
  .object({
    stock_code: z.string(),
    description: z.string(),
    product_group: z.enum(["man", "lady", "child"]),
    supplier_name: z.string(),
    color_breakdown: z.string(),
    unit: z.enum(["pair", "set", "dozen"]),
    unit_conversions: z.object({
      pair: z.number().int().positive(),
      set: z.number().int().positive(),
      dozen: z.number().int().positive(),
    }),
    selling_price: z
      .string()
      .regex(/^\d*$/, "Selling price can only contain numbers."),
    currency_code: z.enum(["MMK", "THB", "USD"]),
    original_selling_price: z
      .string()
      .regex(/^\d*\.?\d*$/, "Original price can only contain numbers."),
    exchange_rate: z
      .string()
      .regex(/^\d*\.?\d*$/, "Exchange rate can only contain numbers."),
  })
  .superRefine((line, context) => {
    const hasProductDetails =
      line.stock_code.trim() !== "" ||
      line.description.trim() !== "" ||
      line.supplier_name.trim() !== "" ||
      line.color_breakdown.trim() !== "" ||
      line.selling_price.trim() !== "";

    // Empty rows are allowed while staff are drafting. Once anything is entered in a
    // row, Zod gives the basic, local field errors; quantity syntax and server-backed
    // availability rules remain in their existing validation paths.
    if (!hasProductDetails) return;

    if (line.stock_code.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["stock_code"],
        message: "Enter a stock code.",
      });
    }
    if (line.description.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["description"],
        message: "Enter a description.",
      });
    }
    if (line.color_breakdown.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["color_breakdown"],
        message: "Enter colors and quantities.",
      });
    }
    if (line.currency_code !== "MMK") {
      if (line.original_selling_price.trim() === "") {
        context.addIssue({
          code: "custom",
          path: ["original_selling_price"],
          message: "Enter the original price.",
        });
      }
      if (line.exchange_rate.trim() === "" || Number(line.exchange_rate) <= 0) {
        context.addIssue({
          code: "custom",
          path: ["exchange_rate"],
          message: "Enter an exchange rate greater than zero.",
        });
      }
    }
  });

const customerOrderFormSchema = z
  .object({
    order_date: z.string().trim().min(1, "Choose an order date."),
    customer_name: z.string().trim().min(1, "Enter a customer name."),
    customer_phone: z.string(),
    customer_address: z.string(),
    lines: z.array(draftLineSchema),
  })
  .superRefine((values, context) => {
    if (!values.lines.some((line) => line.stock_code.trim() !== "")) {
      context.addIssue({
        code: "custom",
        path: ["lines"],
        message: "Add at least one product.",
      });
    }
  });

interface CustomerOrderFormValues {
  order_date: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  lines: DraftLine[];
}

/** The pairs one drafted row comes to: its colors read in its own unit. */
function draftPairs(line: DraftLine): number {
  return colorQtyPairs(line.color_breakdown, line.unit, line.unit_conversions);
}

const EMPTY_LINE: DraftLine = {
  stock_code: "",
  description: "",
  product_group: "man",
  supplier_name: "",
  color_breakdown: "",
  unit: "set",
  unit_conversions: PAIRS_PER,
  selling_price: "",
  currency_code: DEFAULT_CURRENCY,
  original_selling_price: "",
  exchange_rate: "",
};

const STEPS = ["Customer", "Products", "Review"] as const;

// A name field with our own suggestion list under it. The obvious choice — a native
// `<datalist>` — is drawn by the operating system, not the page, so it ignored the app's
// theme entirely and came up as a black OS menu. This is plain markup, so it follows the
// same tokens as every other dropdown, and it can show a name that is not on the list as
// a new customer rather than silently offering nothing.
function CustomerPicker({
  value,
  onChange,
  onBlur,
  error,
}: {
  value: string;
  onChange: (name: string) => void;
  onBlur?: () => void;
  error?: string;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const query = value.trim().toLowerCase();
  const matches = KNOWN_CUSTOMERS.filter((customer) =>
    query === "" ? true : customer.name.toLowerCase().includes(query),
  );

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  function choose(name: string): void {
    onChange(name);
    setOpen(false);
  }

  function handleKey(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => {
        if (matches.length === 0) return 0;
        return (current + step + matches.length) % matches.length;
      });
      return;
    }
    if (event.key === "Enter" && open && matches[highlight]) {
      event.preventDefault();
      choose(matches[highlight].name);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative" ref={ref}>
        <Input
          label={<Required>Customer name</Required>}
          className={EDITABLE}
          placeholder="Type a name, or pick one already known"
          value={value}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          error={error}
          onChange={(event) => {
            onChange(event.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={onBlur}
          onKeyDown={handleKey}
        />
        {open && (
          <FloatingLayer
            anchorRef={ref}
            matchAnchorWidth
            className="bg-bg-base border border-border rounded-md shadow-lg animate-fade-in"
          >
            <ul role="listbox" className="max-h-52 overflow-y-auto py-1">
              {matches.map((customer, index) => (
                <li key={customer.name}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlight}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(customer.name)}
                    className={cn(
                      "w-full text-left px-3 py-2 text-sm transition-colors duration-150",
                      index === highlight
                        ? "bg-brand-subtle text-brand"
                        : "text-text-secondary hover:bg-bg-subtle hover:text-text-primary",
                    )}
                  >
                    {customer.name}
                  </button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="px-3 py-2 text-sm text-text-muted">
                  No customer by that name yet — carry on and a new one is
                  created.
                </li>
              )}
            </ul>
          </FloatingLayer>
        )}
      </div>
    </div>
  );
}

function NewOrderForm({
  nextOrderNo: orderNo,
  settings,
  onCancel,
  onCreate,
}: {
  nextOrderNo: string;
  settings: AppSettings | null;
  onCancel: () => void;
  onCreate: (order: CustomerOrder) => void;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const {
    control,
    register,
    handleSubmit,
    clearErrors,
    setError,
    setValue,
    trigger,
    formState: { errors, isDirty },
  } = useForm<CustomerOrderFormValues>({
    resolver: zodResolver(customerOrderFormSchema),
    defaultValues: {
      order_date: todayIso(),
      customer_name: "",
      customer_phone: "",
      customer_address: "",
      lines: [{ ...EMPTY_LINE }],
    },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "lines",
  });
  const values = useWatch({ control }) as CustomerOrderFormValues;
  const lines = values.lines;
  const { order_date: orderDate, customer_name: customerName } = values;
  const customerPhone = values.customer_phone;
  const customerAddress = values.customer_address;

  const filledLines = lines.filter((line) => line.stock_code.trim() !== "");
  const totalQty = filledLines.reduce((sum, line) => sum + draftPairs(line), 0);
  const totalAmount = filledLines.reduce(
    (sum, line) =>
      sum +
      pricedAmount(
        draftPairs(line),
        line.unit,
        Number(line.selling_price) || 0,
        line.unit_conversions,
      ),
    0,
  );
  // Picking a customer already known fills in their phone and address rather than making
  // staff retype them; a name nobody has used before simply creates a new customer.
  function pickCustomer(name: string): void {
    setValue("customer_name", name, {
      shouldDirty: true,
      shouldValidate: true,
    });
    const known = KNOWN_CUSTOMERS.find((entry) => entry.name === name);
    if (known) {
      setValue("customer_phone", known.phone, { shouldDirty: true });
      setValue("customer_address", known.address, { shouldDirty: true });
    }
  }

  // Typing a code we already sell fills the rest of the product in. Staff should not be
  // retyping "Men's leather sandal" every time A1001 is ordered, and a product written two
  // slightly different ways is a product that cannot be counted as one.
  function setStockCode(index: number, code: string): void {
    const known = productOf(code);
    setValue(`lines.${index}.stock_code`, code, {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (known) {
      setValue(`lines.${index}.description`, known.description, {
        shouldDirty: true,
        shouldValidate: true,
      });
      setValue(`lines.${index}.product_group`, known.product_group, {
        shouldDirty: true,
      });
      setValue(`lines.${index}.unit`, "set", {
        shouldDirty: true,
        shouldValidate: true,
      });
      setValue(
        `lines.${index}.unit_conversions`,
        known.default_unit_conversions ?? PAIRS_PER,
        {
          shouldDirty: true,
          shouldValidate: true,
        },
      );
    }
  }

  function removeLine(index: number): void {
    if (fields.length === 1) {
      replace([{ ...EMPTY_LINE }]);
      return;
    }
    remove(index);
  }

  // Picking a currency for a draft line: MMK clears the foreign-currency fields back
  // to nothing; any other currency prefills the exchange rate from Settings' current
  // rate (only ever a prefill — the field stays editable) and, once both an original
  // price and a rate exist, keeps selling_price (the Kyat figure everything else on
  // this form reads) in step with their product.
  function setLineCurrency(index: number, code: CurrencyCode): void {
    setValue(`lines.${index}.currency_code`, code, {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (code === "MMK") {
      setValue(`lines.${index}.original_selling_price`, "", {
        shouldDirty: true,
      });
      setValue(`lines.${index}.exchange_rate`, "", { shouldDirty: true });
      return;
    }
    const current = lines[index];
    const rate =
      current?.exchange_rate || settings?.today_exchange_rates[code] || "";
    setValue(`lines.${index}.exchange_rate`, rate, { shouldDirty: true });
    recomputeForeignPrice(index, current?.original_selling_price ?? "", rate);
  }

  function recomputeForeignPrice(
    index: number,
    original: string,
    rate: string,
  ): void {
    const preview = previewKyatAmount(Number(original) || 0, Number(rate) || 0);
    setValue(`lines.${index}.selling_price`, String(preview), {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  async function moveToProducts(): Promise<void> {
    const valid = await trigger([
      "order_date",
      "customer_name",
      "customer_phone",
      "customer_address",
    ]);
    if (valid) setStep(1);
  }

  async function moveToReview(): Promise<void> {
    clearErrors("lines");
    const valid = await trigger("lines");
    const colorProblem = lines.findIndex(
      (line) => colorQtyProblem(line.color_breakdown) !== null,
    );
    if (colorProblem >= 0) {
      setError(`lines.${colorProblem}.color_breakdown`, {
        type: "validate",
        message:
          colorQtyProblem(lines[colorProblem].color_breakdown) ?? undefined,
      });
    }
    const duplicateStockCode = lines.findIndex(
      (_, index) => duplicateStockCodeProblem(lines, index) !== null,
    );
    if (duplicateStockCode >= 0) {
      setError(`lines.${duplicateStockCode}.stock_code`, {
        type: "validate",
        message:
          duplicateStockCodeProblem(lines, duplicateStockCode) ?? undefined,
      });
    }
    const hasProductQuantity = filledLines.some((line) => draftPairs(line) > 0);
    if (!hasProductQuantity) {
      setError("lines", {
        type: "validate",
        message: "Add a product with at least one color qty.",
      });
    }
    if (
      valid &&
      colorProblem < 0 &&
      duplicateStockCode < 0 &&
      hasProductQuantity
    ) {
      setStep(2);
    }
  }

  function submit(values: CustomerOrderFormValues): void {
    const now = Date.now();
    const orderLines: CustomerOrderLine[] = values.lines
      .filter((line) => line.stock_code.trim() !== "")
      .map((line, index) => ({
        order_line_id: `col-${now}-${index}`,
        stock_code: line.stock_code.trim(),
        description: line.description.trim(),
        product_group: line.product_group,
        supplier_name: line.supplier_name.trim() || "—",
        color_breakdown: line.color_breakdown.trim(),
        unit: line.unit,
        unit_conversions: line.unit_conversions,
        quantity_pairs: draftPairs(line),
        // Nothing has been given to the customer at the moment an order is written down.
        delivered_quantity_pairs: 0,
        selling_price: Number(line.selling_price) || 0,
        currency_code: line.currency_code,
        original_selling_price: isForeignCurrency(line.currency_code)
          ? Number(line.original_selling_price) || 0
          : null,
        exchange_rate: isForeignCurrency(line.currency_code)
          ? Number(line.exchange_rate) || 0
          : null,
      }));
    onCreate({
      order_id: `co-${now}`,
      order_no: orderNo,
      customer_name: values.customer_name.trim(),
      customer_phone: values.customer_phone.trim(),
      customer_address: values.customer_address.trim(),
      order_date: values.order_date,
      total_quantity_pairs: orderLines.reduce(
        (sum, line) => sum + line.quantity_pairs,
        0,
      ),
      delivered_quantity_pairs: 0,
      order_status: "new",
      // Nothing has been paid at the moment an order is written down, so the account
      // starts unpaid.
      payment: { account_id: `pa-${now}`, payments: [] },
      lines: orderLines,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button
          variant="ghost"
          size="sm"
          title={isDirty ? "This new order has unsaved changes." : undefined}
          onClick={onCancel}
        >
          <ChevronLeftIcon className="w-4 h-4" />
          Back to orders
        </Button>
      </div>

      <Panel>
        <div className="px-6 py-5 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight mb-5">
            New customer order
          </h2>
          <StepBar steps={STEPS} step={step} />
        </div>

        {step === 0 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <SectionLabel>Step 1 — customer information</SectionLabel>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Input
                label="Order date"
                type="date"
                className={EDITABLE}
                error={errors.order_date?.message}
                {...register("order_date")}
              />
              <Controller
                control={control}
                name="customer_name"
                render={({ field }) => (
                  <CustomerPicker
                    value={field.value}
                    onChange={pickCustomer}
                    onBlur={field.onBlur}
                    error={errors.customer_name?.message}
                  />
                )}
              />
              <Input
                label="Phone"
                className={EDITABLE}
                placeholder="09-…"
                error={errors.customer_phone?.message}
                {...register("customer_phone")}
              />
              <Input
                label="Address"
                className={EDITABLE}
                placeholder="Street, town"
                error={errors.customer_address?.message}
                {...register("customer_address")}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void moveToProducts()}>
                Next: products
                <ChevronRightIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <div>
              <SectionLabel>Step 2 — products</SectionLabel>
              <p className="text-sm text-text-muted -mt-1">
                One row per stock code. Write the colors together with their
                counts and unit — black10s,pink2p — and the qty works
                itself out.
              </p>
            </div>

            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="min-w-[18rem]">Product</Th>
                  <Th className="min-w-[13rem]">Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right min-w-[8rem]">Selling price<span className="block text-xs font-normal text-text-muted">per set</span></Th>
                  <Th className="text-right min-w-[8rem]">Amount</Th>
                </Tr>
              </Thead>
              <Tbody>
                {fields.map((field, index) => {
                  const line = lines[index] ?? EMPTY_LINE;
                  const lineQty = draftPairs(line);
                  const lineAmount = pricedAmount(
                    lineQty,
                    line.unit,
                    Number(line.selling_price) || 0,
                    line.unit_conversions,
                  );
                  return (
                    <Tr key={field.id}>
                      <Td className="min-w-[18rem]">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <div className="flex min-w-0 items-start gap-1">
                            <Controller
                              control={control}
                              name={`lines.${index}.stock_code`}
                              render={() => (
                                <SuggestInput
                                  bare
                                  label={`Stock code for product ${index + 1}`}
                                  placeholder="A1001"
                                  suggestions={STOCK_CODES}
                                  value={line.stock_code}
                                  onChange={(next) => setStockCode(index, next)}
                                  error={
                                    errors.lines?.[index]?.stock_code
                                      ?.message ??
                                    duplicateStockCodeProblem(lines, index) ??
                                    undefined
                                  }
                                />
                              )}
                            />
                            <CopyButton
                              value={line.stock_code}
                              what="stock code"
                            />
                          </div>
                          <Controller
                            control={control}
                            name={`lines.${index}.description`}
                            render={({ field: descriptionField }) => (
                              <CellInput
                                label={`Description for product ${index + 1}`}
                                placeholder="Men's leather sandal"
                                multiline
                                value={descriptionField.value}
                                onChange={descriptionField.onChange}
                                error={
                                  errors.lines?.[index]?.description?.message
                                }
                              />
                            )}
                          />
                          <Controller
                            control={control}
                            name={`lines.${index}.product_group`}
                            render={({ field: groupField }) => (
                              <GroupSelect
                                label={`Group for product ${index + 1}`}
                                value={groupField.value}
                                onChange={groupField.onChange}
                              />
                            )}
                          />
                        </div>
                      </Td>
                      <Td>
                        <Controller
                          control={control}
                          name={`lines.${index}.color_breakdown`}
                          render={({ field: colorField }) => (
                            <CellInput
                              label={`Colors for product ${index + 1}`}
                              placeholder="Enter color qty"
                              multiline
                              value={colorField.value}
                              onChange={colorField.onChange}
                              error={
                                errors.lines?.[index]?.color_breakdown
                                  ?.message ??
                                colorQtyProblem(line.color_breakdown) ??
                                undefined
                              }
                            />
                          )}
                        />
                        <span className="mt-1 block text-xs text-text-muted">
                          {lineQty > 0
                            ? formatIn(
                                lineQty,
                                line.unit,
                                line.unit_conversions,
                              )
                            : "Every color needs a unit — s sets, p pairs, d dozens"}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                        {formatIn(lineQty, line.unit, line.unit_conversions)}
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-1">
                          <CurrencySelect
                            label={`Currency for product ${index + 1}`}
                            value={line.currency_code || DEFAULT_CURRENCY}
                            onChange={(code) => setLineCurrency(index, code)}
                            className="w-full"
                          />
                          {isForeignCurrency(line.currency_code) ? (
                            <>
                              <Controller
                                control={control}
                                name={`lines.${index}.original_selling_price`}
                                render={({ field: originalField }) => (
                                  <CellInput
                                    label={`Original price for product ${index + 1}`}
                                    placeholder="Original price"
                                    className="text-right"
                                    value={originalField.value}
                                    onChange={(next) => {
                                      const filtered = next.replace(
                                        /[^0-9.]/g,
                                        "",
                                      );
                                      originalField.onChange(filtered);
                                      recomputeForeignPrice(
                                        index,
                                        filtered,
                                        line.exchange_rate,
                                      );
                                    }}
                                    error={
                                      errors.lines?.[index]
                                        ?.original_selling_price?.message
                                    }
                                  />
                                )}
                              />
                              <Controller
                                control={control}
                                name={`lines.${index}.exchange_rate`}
                                render={({ field: rateField }) => (
                                  <CellInput
                                    label={`Exchange rate for product ${index + 1}`}
                                    placeholder="Exchange rate"
                                    className="text-right"
                                    value={rateField.value}
                                    onChange={(next) => {
                                      const filtered = next.replace(
                                        /[^0-9.]/g,
                                        "",
                                      );
                                      rateField.onChange(filtered);
                                      recomputeForeignPrice(
                                        index,
                                        line.original_selling_price,
                                        filtered,
                                      );
                                    }}
                                    error={
                                      errors.lines?.[index]?.exchange_rate
                                        ?.message
                                    }
                                  />
                                )}
                              />
                              <span className="text-right text-[10px] text-text-muted tabular-nums">
                                = {formatKyat(Number(line.selling_price) || 0)}
                              </span>
                            </>
                          ) : (
                            <Controller
                              control={control}
                              name={`lines.${index}.selling_price`}
                              render={({ field: priceField }) => (
                                <CellInput
                                  label={`Selling price for product ${index + 1}`}
                                  placeholder="0"
                                  numeric
                                  className="text-right"
                                  value={priceField.value}
                                  onChange={priceField.onChange}
                                  error={
                                    errors.lines?.[index]?.selling_price
                                      ?.message
                                  }
                                />
                              )}
                            />
                          )}
                        </div>
                      </Td>
                      <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                        {formatKyat(lineAmount)}
                        <Button
                          variant="ghost"
                          size="sm"
                          className={cn("ml-2 align-middle", SOFT_RED)}
                          aria-label={`Remove row ${index + 1}`}
                          onClick={() => removeLine(index)}
                        >
                          <TrashIcon className="w-4 h-4" />
                        </Button>
                      </Td>
                    </Tr>
                  );
                })}
                <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                  <Td className="font-semibold" colSpan={2}>
                    Total
                  </Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {sets(totalQty)}
                  </Td>
                  <Td />
                  <Td className="text-right tabular-nums font-semibold text-brand">
                    {formatKyat(totalAmount)}
                  </Td>
                </Tr>
              </Tbody>
            </TableContainer>

            {errors.lines?.message && (
              <p className="text-sm text-error">{errors.lines.message}</p>
            )}

            <div>
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() => append({ ...EMPTY_LINE })}
              >
                <PlusIcon className="w-4 h-4" />
                Add another product
              </Button>
            </div>

            <div className="flex justify-between">
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() => setStep(0)}
              >
                <ChevronLeftIcon className="w-4 h-4" />
                Back
              </Button>
              <Button onClick={() => void moveToReview()}>
                Next: review
                <ChevronRightIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <SectionLabel>Step 3 — review &amp; confirm</SectionLabel>
            <dl className="grid gap-4 grid-cols-1 sm:grid-cols-4 bg-bg-subtle border border-border rounded-lg p-4">
              <ReviewFact label="Order no." value={orderNo} />
              <ReviewFact label="Order date" value={formatDate(orderDate)} />
              <ReviewFact label="Customer" value={customerName || "—"} />
              <ReviewFact label="Phone" value={customerPhone || "—"} />
              <ReviewFact
                label="Address"
                value={customerAddress || "—"}
                className="sm:col-span-4"
              />
            </dl>
            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="whitespace-nowrap">Supplier / Factory</Th>
                  <Th className="min-w-[18rem]">Product</Th>
                  <Th className="min-w-[13rem]">Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right min-w-[8rem]">Selling price<span className="block text-xs font-normal text-text-muted">per set</span></Th>
                  <Th className="text-right min-w-[8rem]">Amount</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filledLines.map((line, index) => {
                  const qty = draftPairs(line);
                  return (
                    <Tr key={index}>
                      <Td className="text-text-secondary">
                        {line.supplier_name || "—"}
                      </Td>
                      <Td className="min-w-[18rem]">
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <div className="flex items-center gap-1">
                            <span className="font-semibold text-brand break-words">
                              {line.stock_code}
                            </span>
                            {line.stock_code && (
                              <CopyButton
                                value={line.stock_code}
                                what="stock code"
                              />
                            )}
                          </div>
                          <ProductCell
                            description={line.description}
                            product_group={line.product_group}
                          />
                        </div>
                      </Td>
                      <Td className="font-mono text-xs text-text-secondary break-words">
                        {line.color_breakdown || "—"}
                      </Td>
                      <Td className="text-right tabular-nums">{sets(qty)}</Td>
                      <Td className="text-right tabular-nums text-text-secondary">
                        {formatKyat(Number(line.selling_price) || 0)}
                        <CurrencyNote
                          currency_code={line.currency_code}
                          original_amount={
                            Number(line.original_selling_price) || 0
                          }
                          exchange_rate={Number(line.exchange_rate) || 0}
                        />
                      </Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatKyat(
                          pricedAmount(
                            qty,
                            line.unit,
                            Number(line.selling_price) || 0,
                            line.unit_conversions,
                          ),
                        )}
                      </Td>
                    </Tr>
                  );
                })}
                <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                  <Td className="font-semibold" colSpan={3}>
                    Total
                  </Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {sets(totalQty)}
                  </Td>
                  <Td />
                  <Td className="text-right tabular-nums font-semibold text-brand">
                    {formatKyat(totalAmount)}
                  </Td>
                </Tr>
              </Tbody>
            </TableContainer>
            <div className="flex justify-between">
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() => setStep(1)}
              >
                <ChevronLeftIcon className="w-4 h-4" />
                Back
              </Button>
              <Button onClick={handleSubmit(submit)}>
                <CheckIcon className="w-4 h-4" />
                Confirm order
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
