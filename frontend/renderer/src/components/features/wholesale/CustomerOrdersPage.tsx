import { useEffect, useMemo, useRef, useState } from "react";
import { type Session } from "@renderer/lib/auth";
import { useCachedFetch } from "@renderer/lib/useCachedFetch";
import { useToast } from "@renderer/lib/useToast";
import {
  CellInput,
  EDITABLE,
  GroupSelect,
  FigureCard,
  MenuItem,
  PAGE_SIZE,
  Panel,
  PaymentsTable,
  CopyButton,
  ProductCell,
  ReadOnlyField,
  Required,
  Reference,
  ReviewFact,
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
  EyeIcon,
  MoreIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  lineRemaining,
  orderAmount,
  orderBalance,
  paidAmount,
  ORDER_STATUSES,
  paidPct,
  paymentStatus,
  receivedPct,
  remainingQty,
  KNOWN_CUSTOMERS,
  type CustomerOrder,
  type CustomerOrderLine,
  type OrderStatus,
} from "@renderer/components/features/wholesale/customerOrders";
import {
  colorQtyPairs,
  colorQtyProblem,
  SUPPLIER_NAMES,
  formatDate,
  formatKyat,
  formatQty,
  nextReference,
  onlyDigits,
  todayIso,
  type PaymentStatus,
} from "@renderer/components/features/wholesale/shared";
import { formatIn } from "@renderer/components/features/wholesale/units";
import {
  hydrateOrders,
  saveOrders,
  useWholesale,
} from "@renderer/components/features/wholesale/store";
import {
  CUSTOMER_ORDERS_URL,
  WholesaleApiError,
  addCustomerOrderPayment,
  cancelCustomerOrder,
  createCustomerOrder,
  ordersFromWire,
  removeCustomerOrderPayment,
  updateCustomerOrder,
  type NewCustomerOrderInput,
} from "@renderer/components/features/wholesale/api";
import {
  GROUP_LABELS,
  PRODUCT_GROUPS,
  STOCK_CODES,
  productOf,
  type ProductGroup,
} from "@renderer/components/features/wholesale/products";

/** A quantity of goods, written in sets — the unit the business trades in. Pairs stay
 *  the figure underneath, so nothing is ever converted twice. */
const sets = (qty: number): string => formatIn(qty, "set");

// The wholesale Customer Orders screen. Its shape follows wholesale_prototype's own
// Customer Orders page — figure cards across the top, then one panel holding the header,
// the filter row, the table and the pagination footer; a read-only detail sheet; and a
// three-step wizard for a new order — while its fields follow the ERD in
// diagram/wholesale/erd.mmd. What it does not take from the prototype is the palette:
// colour comes from this app's own tokens, repointed to blue for the whole wholesale
// workspace (see `.workspace-wholesale` in globals.css).
//
// Customer Orders reads and writes the backend now. The shared store is still hydrated
// after each fetch because Inventory has not moved to its own API phase yet.

type View = "list" | "detail" | "new";
type StatusFilter = OrderStatus | "all";
type PayFilter = PaymentStatus | "all";

const STATUS_LABELS: Record<OrderStatus, string> = {
  created: "Created",
  processing: "Processing",
  completed: "Completed",
  cancelled: "Cancelled",
};

// Filled, not tinted: the shared Badge's subtle variants read as a highlighted background
// rather than a state, so each status is solid colour with the inverse text over it. Every
// value is a token, so all four follow the workspace's blue and the theme.
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
  created: "bg-text-secondary text-bg-base",
  processing: "bg-brand text-white",
  completed: "bg-success text-white",
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

export default function CustomerOrdersPage({ session }: { session: Session }): React.JSX.Element {
  const showToast = useToast();
  const { data: wire, isRefreshing, reload } = useCachedFetch<CustomerOrder[]>(
    CUSTOMER_ORDERS_URL,
    session,
    "customer orders",
  );
  useEffect(() => {
    if (wire) hydrateOrders(ordersFromWire(wire));
  }, [wire]);
  const { orders } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    orders.find((order) => order.order_id === selectedId) ?? null;

  function openOrder(orderId: string): void {
    setSelectedId(orderId);
    setView("detail");
  }

  function cancelOrder(orderId: string): void {
    cancelCustomerOrder(session, orderId)
      .then(reload)
      .catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not cancel the order."));
  }

  async function persistOrder(order: CustomerOrder): Promise<void> {
    try {
      await updateCustomerOrder(session, order.order_id, {
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        customer_address: order.customer_address,
        order_date: order.order_date,
        lines: order.lines,
      });
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
      .catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not create the order."));
  }

  if (view === "new") {
    return (
      <NewOrderForm
        nextOrderNo={nextOrderNo(orders)}
        onCancel={() => setView("list")}
        onCreate={addOrder}
      />
    );
  }

  if (view === "detail" && selected) {
    return (
      <OrderDetail
        order={selected}
        onSave={persistOrder}
        onAddPayment={(payment) => addCustomerOrderPayment(session, selected.order_id, payment).then(reload).catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not add the payment."))}
        onRemovePayment={(paymentId) => removeCustomerOrderPayment(session, selected.order_id, paymentId).then(reload).catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not remove the payment."))}
        onBack={() => setView("list")}
      />
    );
  }

  return (
    <OrderList
      orders={orders}
      onOpen={openOrder}
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
  onCancel,
  onNew,
  onRefresh,
  refreshing,
}: {
  orders: CustomerOrder[];
  onOpen: (orderId: string) => void;
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
  const totalQty = live.reduce((sum, order) => sum + order.total_qty, 0);
  const remainingAll = live.reduce(
    (sum, order) => sum + remainingQty(order),
    0,
  );
  const unfinished = live.filter((order) => remainingQty(order) > 0).length;
  const outstanding = live.reduce((sum, order) => sum + orderBalance(order), 0);
  const owingCount = live.filter((order) => orderBalance(order) > 0).length;

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
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
        <FigureCard
          label="Total orders"
          value={formatQty(live.length)}
          sub="orders in the system"
        />
        <FigureCard
          label="Total ordered"
          value={sets(totalQty)}
          sub="across all orders"
          tone="neutral"
        />
        <FigureCard
          label="Remaining"
          value={sets(remainingAll)}
          sub={`of ${sets(totalQty)} not yet delivered`}
          tone={remainingAll > 0 ? "error" : "success"}
        />
        <FigureCard
          label="Orders not finished"
          value={formatQty(unfinished)}
          sub={`of ${formatQty(live.length)} waiting on goods`}
          tone={unfinished > 0 ? "warning" : "success"}
        />
        <FigureCard
          label="Unpaid amount"
          value={formatKyat(outstanding)}
          sub={`${owingCount} order${owingCount === 1 ? "" : "s"} not fully paid`}
          tone={outstanding > 0 ? "error" : "success"}
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
          <div className="w-full sm:w-80">
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
                  <Th className="whitespace-nowrap">Order status</Th>
                  <Th className="whitespace-nowrap">Payment status</Th>
                  <Th className="w-12" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((order) => {
                  const remaining = remainingQty(order);
                  return (
                    <Tr key={order.order_id}>
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
                      <Td className="text-right tabular-nums font-medium">
                        {sets(order.total_qty)}
                      </Td>
                      <Td className="text-right tabular-nums font-semibold text-error">
                        {sets(remaining)}
                      </Td>
                      <Td>
                        <StatusBadge status={order.order_status} />
                      </Td>
                      <Td>
                        <PaymentBadge status={paymentStatus(order)} />
                      </Td>
                      <Td className="text-right">
                        <RowMenu
                          onView={() => onOpen(order.order_id)}
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

/** The prototype's per-row three-dot menu, carrying only the actions that actually do
 *  something with no backend behind them. */
function RowMenu({
  onView,
  onCancel,
}: {
  onView: () => void;
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
        <div className="absolute right-0 top-9 z-30 min-w-44 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in">
          <MenuItem
            icon={<EyeIcon className="w-4 h-4" />}
            label="View details"
            onClick={() => {
              setOpen(false);
              onView();
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
        </div>
      )}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function OrderDetail({
  order: initialOrder,
  onSave,
  onAddPayment,
  onRemovePayment,
  onBack,
}: {
  order: CustomerOrder;
  onSave: (order: CustomerOrder) => Promise<void>;
  onAddPayment: (payment: CustomerOrder["payment"]["payments"][number]) => void;
  onRemovePayment: (paymentId: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  const [order, setOrder] = useState(initialOrder);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setOrder(initialOrder);
  }, [initialOrder]);

  async function saveChanges(): Promise<void> {
    setSaving(true);
    try {
      await onSave(order);
    } finally {
      setSaving(false);
    }
  }

  const remaining = remainingQty(order);
  const pct = receivedPct(order);

  function apply(patch: Partial<CustomerOrder>): void {
    setOrder((current) => ({ ...current, ...patch }));
  }

  // Editing a line is editing the order: the quantity is re-read from the colours, the
  // same rule the wizard follows, so the two can never be written down differently.
  function setLine(index: number, patch: Partial<CustomerOrderLine>): void {
    apply({
      lines: order.lines.map((line, position) =>
        position === index ? { ...line, ...patch } : line,
      ),
    });
  }

  function setColors(index: number, colors: string): void {
    setLine(index, {
      color_qty: colors,
      wanted_qty: colorQtyPairs(colors, "set"),
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
            group: known.group,
          }
        : { stock_code: code },
    );
  }

  function addLine(): void {
    apply({
      lines: [
        ...order.lines,
        {
          order_line_id: `col-${Date.now()}`,
          stock_code: "",
          description: "",
          group: "man",
          supplier_name: "",
          color_qty: "",
          unit: "set",
          wanted_qty: 0,
          received_qty: 0,
          selling_price: 0,
        },
      ],
    });
  }

  function removeLine(index: number): void {
    apply({
      lines: order.lines.filter((_, position) => position !== index),
    });
  }
  const amount = orderAmount(order);
  const balance = orderBalance(order);
  const paid = paidAmount(order);
  const paidShare = paidPct(order);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeftIcon className="w-4 h-4" />
          Back to orders
        </Button>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold text-text-primary tracking-tight">
              Order details
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={order.order_status} />
            <PaymentBadge status={paymentStatus(order)} />
            <Button
              size="sm"
              onClick={() => void saveChanges()}
              loading={saving}
            >
              <CheckIcon className="w-4 h-4" />
              Save changes
            </Button>
          </div>
        </div>

        <div className="px-6 py-6 flex flex-col gap-8">
          <section>
            <SectionLabel>Customer &amp; order information</SectionLabel>
            {/* The order number is the one thing that cannot change — it is how this
                order is referred to everywhere else. Everything a customer can correct
                about themselves is typed straight in. */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <ReadOnlyField
                label="Order no."
                value={order.order_no}
                copyable
              />
              <Input
                label="Order date"
                type="date"
                className={EDITABLE}
                value={order.order_date}
                onChange={(event) =>
                  apply({ order_date: event.target.value })
                }
              />
              <Input
                label="Customer"
                className={EDITABLE}
                value={order.customer_name}
                onChange={(event) =>
                  apply({ customer_name: event.target.value })
                }
              />
              <Input
                label="Phone"
                className={EDITABLE}
                value={order.customer_phone}
                onChange={(event) =>
                  apply({ customer_phone: event.target.value })
                }
              />
              <Input
                label="Address"
                className={cn(EDITABLE, "sm:col-span-2 lg:col-span-4")}
                value={order.customer_address}
                onChange={(event) =>
                  apply({ customer_address: event.target.value })
                }
              />
            </div>
          </section>

          <section>
            <SectionLabel>Products</SectionLabel>
            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="min-w-[10rem] whitespace-nowrap">
                    Supplier / Factory
                  </Th>
                  <Th className="min-w-[9rem]">Stock code</Th>
                  <Th className="min-w-[12rem]">Product</Th>
                  <Th className="min-w-[11rem]">Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right whitespace-nowrap">Received qty</Th>
                  <Th className="text-right whitespace-nowrap">
                    Remaining qty
                  </Th>
                  <Th className="text-right min-w-[7rem]">Selling price</Th>
                  <Th className="text-right">Amount</Th>
                </Tr>
              </Thead>
              <Tbody>
                {order.lines.map((line, index) => (
                  <Tr key={line.order_line_id}>
                    <Td>
                      <SuggestInput
                        bare
                        label={`Supplier for line ${index + 1}`}
                        placeholder="Choose…"
                        suggestions={SUPPLIER_NAMES}
                        value={line.supplier_name}
                        onChange={(next) =>
                          setLine(index, { supplier_name: next })
                        }
                      />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <SuggestInput
                          bare
                          label={`Stock code for line ${index + 1}`}
                          placeholder="A1001"
                          suggestions={STOCK_CODES}
                          value={line.stock_code}
                          onChange={(next) => setStockCode(index, next)}
                        />
                        <CopyButton value={line.stock_code} what="stock code" />
                      </div>
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-1.5">
                        <CellInput
                          label={`Description for line ${index + 1}`}
                          placeholder="Men's leather sandal"
                          value={line.description}
                          onChange={(next) =>
                            setLine(index, { description: next })
                          }
                        />
                        <GroupSelect
                          label={`Group for line ${index + 1}`}
                          value={line.group}
                          onChange={(group) => setLine(index, { group })}
                        />
                      </div>
                    </Td>
                    <Td>
                      <CellInput
                        label={`Colors for line ${index + 1}`}
                        placeholder="black10s,pink2p"
                        value={line.color_qty}
                        onChange={(next) => setColors(index, next)}
                        error={
                          colorQtyProblem(line.color_qty) ??
                          (line.wanted_qty < line.received_qty
                            ? `${sets(line.received_qty)} have already gone to the customer.`
                            : undefined)
                        }
                      />
                    </Td>
                    <Td className="text-right tabular-nums">
                      {sets(line.wanted_qty)}
                    </Td>
                    <Td className="text-right tabular-nums font-medium text-success">
                      {sets(line.received_qty)}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold text-error">
                      {sets(lineRemaining(line))}
                    </Td>
                    <Td>
                      <CellInput
                        label={`Selling price for line ${index + 1}`}
                        placeholder="0"
                        numeric
                        className="text-right"
                        value={String(line.selling_price)}
                        onChange={(next) =>
                          setLine(index, { selling_price: Number(next) || 0 })
                        }
                      />
                    </Td>
                    <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                      {formatKyat(line.wanted_qty * line.selling_price)}
                      <button
                        type="button"
                        onClick={() => removeLine(index)}
                        title="Remove this product"
                        aria-label={`Remove product on line ${index + 1}`}
                        className={cn(
                          "ml-2 p-1 rounded-md align-middle transition-colors duration-150",
                          SOFT_RED,
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error",
                        )}
                      >
                        <TrashIcon className="w-4 h-4" />
                      </button>
                    </Td>
                  </Tr>
                ))}
                <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                  <Td className="font-semibold" colSpan={4}>
                    Total
                  </Td>
                  <Td className="text-right tabular-nums font-semibold">
                    {sets(order.total_qty)}
                  </Td>
                  <Td className="text-right tabular-nums font-semibold text-success">
                    {sets(order.received_qty)}
                  </Td>
                  <Td className="text-right tabular-nums font-semibold text-error">
                    {sets(remainingQty(order))}
                  </Td>
                  <Td />
                  <Td className="text-right tabular-nums font-semibold text-brand">
                    {formatKyat(orderAmount(order))}
                  </Td>
                </Tr>
              </Tbody>
            </TableContainer>
            <div className="mt-3">
              <Button
                variant="ghost"
                size="sm"
                className={SOFT_BLUE}
                onClick={addLine}
              >
                <PlusIcon className="w-4 h-4" />
                Add product
              </Button>
            </div>
          </section>

          <section>
            <SectionLabel>Delivery</SectionLabel>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 mb-4">
              <BigFigure label="Ordered qty" value={sets(order.total_qty)} />
              <BigFigure
                label="Received qty"
                value={sets(order.received_qty)}
                tone="success"
              />
              <BigFigure
                label="Remaining qty"
                value={sets(remaining)}
                tone="error"
              />
            </div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium text-text-secondary">
                Delivery progress
              </span>
              <span className="tabular-nums font-semibold text-text-primary">
                {sets(order.received_qty)} / {sets(order.total_qty)} ({pct}%)
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Delivery progress"
              className="h-2 rounded-full bg-bg-raised overflow-hidden"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                  pct === 100 ? "bg-success" : "bg-brand",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </section>

          <section>
            <SectionLabel>Payment</SectionLabel>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3 mb-4">
              <MoneyFigure label="Order total" value={formatKyat(amount)} />
              <MoneyFigure
                label="Paid so far"
                value={formatKyat(paid)}
                tone="success"
              />
              <MoneyFigure
                label="Unpaid amount"
                value={formatKyat(balance)}
                tone={balance > 0 ? "error" : "success"}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm mb-2">
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
              className="h-2 rounded-full bg-bg-raised overflow-hidden mb-5"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                  paidShare === 100 ? "bg-success" : "bg-warning",
                )}
                style={{ width: `${paidShare}%` }}
              />
            </div>
            {/* Every figure above is the sum of this table. Customers pay in parts —
                a deposit, something on collection — so the parts are what is kept. */}
            <PaymentsTable
              payments={order.payment.payments}
              balance={balance}
              who="customer"
              onAdd={onAddPayment}
              onRemove={onRemovePayment}
            />
          </section>
        </div>
      </Panel>
    </div>
  );
}

function BigFigure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "success" | "error";
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-center",
        tone === "success" && "bg-success-subtle border-success/30",
        tone === "warning" && "bg-warning-subtle border-warning/30",
        tone === "error" && "bg-error-subtle border-error/30",
        tone === "neutral" && "bg-bg-subtle border-border",
      )}
    >
      <div className="text-xs uppercase tracking-wide text-text-muted mb-1">
        {label}
      </div>
      <div
        className={cn(
          "text-xl font-bold tabular-nums leading-none",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
          tone === "error" && "text-error",
          tone === "neutral" && "text-text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function MoneyFigure({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "error";
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 text-center",
        tone === "success" && "bg-success-subtle border-success/30",
        tone === "error" && "bg-error-subtle border-error/30",
        tone === "neutral" && "bg-bg-subtle border-border",
      )}
    >
      <div className="text-xs uppercase tracking-wide text-text-muted mb-1">
        {label}
      </div>
      <div
        className={cn(
          "text-base font-bold tabular-nums leading-none",
          tone === "success" && "text-success",
          tone === "error" && "text-error",
          tone === "neutral" && "text-text-primary",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ── New order ────────────────────────────────────────────────────────────────

interface DraftLine {
  stock_code: string;
  description: string;
  group: ProductGroup;
  supplier_name: string;
  color_qty: string;
  selling_price: string;
}

/** The pairs one drafted row comes to: its colors read in its own unit. */
function draftPairs(line: DraftLine): number {
  // A colour with no letter of its own is counted in sets.
  return colorQtyPairs(line.color_qty, "set");
}

const EMPTY_LINE: DraftLine = {
  stock_code: "",
  description: "",
  group: "man",
  supplier_name: "",
  color_qty: "",
  selling_price: "",
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
}: {
  value: string;
  onChange: (name: string) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  const query = value.trim().toLowerCase();
  const matches = KNOWN_CUSTOMERS.filter((customer) =>
    query === "" ? true : customer.name.toLowerCase().includes(query),
  );
  const exact = KNOWN_CUSTOMERS.some(
    (customer) => customer.name.toLowerCase() === query,
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
          onChange={(event) => {
            onChange(event.target.value);
            setHighlight(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKey}
        />
        {open && (
          <ul
            role="listbox"
            className="absolute z-30 left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto bg-bg-base border border-border rounded-md shadow-lg py-1 animate-fade-in"
          >
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
        )}
      </div>
      <p className="text-xs text-text-muted">
        {value.trim() !== "" && !exact
          ? `"${value.trim()}" is new — saving this order adds them as a customer.`
          : "A name nobody has used before creates a new customer."}
      </p>
    </div>
  );
}

function NewOrderForm({
  nextOrderNo: orderNo,
  onCancel,
  onCreate,
}: {
  nextOrderNo: string;
  onCancel: () => void;
  onCreate: (order: CustomerOrder) => void;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [orderDate, setOrderDate] = useState(todayIso());
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }]);

  const filledLines = lines.filter((line) => line.stock_code.trim() !== "");
  const totalQty = filledLines.reduce((sum, line) => sum + draftPairs(line), 0);
  const totalAmount = filledLines.reduce(
    (sum, line) => sum + draftPairs(line) * (Number(line.selling_price) || 0),
    0,
  );
  const canLeaveCustomer = customerName.trim() !== "";
  const colorProblem = lines
    .map((line) => colorQtyProblem(line.color_qty))
    .find((problem) => problem !== null);
  // Every row that names a product has to say how much of it: a stock code with no
  // colours counts nothing, and a line worth nothing on an order is a line nobody can
  // deliver against.
  const emptyColors = filledLines.some((line) => line.color_qty.trim() === "");
  const canLeaveProducts =
    filledLines.length > 0 &&
    totalQty > 0 &&
    !emptyColors &&
    colorProblem === undefined;

  // Picking a customer already known fills in their phone and address rather than making
  // staff retype them; a name nobody has used before simply creates a new customer.
  function pickCustomer(name: string): void {
    setCustomerName(name);
    const known = KNOWN_CUSTOMERS.find((entry) => entry.name === name);
    if (known) {
      setCustomerPhone(known.phone);
      setCustomerAddress(known.address);
    }
  }

  function updateLine(index: number, patch: Partial<DraftLine>): void {
    setLines((current) =>
      current.map((line, position) =>
        position === index ? { ...line, ...patch } : line,
      ),
    );
  }

  // Typing a code we already sell fills the rest of the product in. Staff should not be
  // retyping "Men's leather sandal" every time A1001 is ordered, and a product written two
  // slightly different ways is a product that cannot be counted as one.
  function setStockCode(index: number, code: string): void {
    const known = productOf(code);
    updateLine(
      index,
      known
        ? {
            stock_code: code,
            description: known.description,
            group: known.group,
          }
        : { stock_code: code },
    );
  }

  function removeLine(index: number): void {
    setLines((current) =>
      current.length === 1
        ? [{ ...EMPTY_LINE }]
        : current.filter((_, position) => position !== index),
    );
  }

  function submit(): void {
    const now = Date.now();
    const orderLines: CustomerOrderLine[] = filledLines.map((line, index) => ({
      order_line_id: `col-${now}-${index}`,
      stock_code: line.stock_code.trim(),
      description: line.description.trim(),
      group: line.group,
      supplier_name: line.supplier_name.trim() || "—",
      color_qty: line.color_qty.trim(),
      unit: "set",
      wanted_qty: draftPairs(line),
      // Nothing has been given to the customer at the moment an order is written down.
      received_qty: 0,
      selling_price: Number(line.selling_price) || 0,
    }));
    onCreate({
      order_id: `co-${now}`,
      order_no: orderNo,
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      customer_address: customerAddress.trim(),
      order_date: orderDate,
      total_qty: orderLines.reduce((sum, line) => sum + line.wanted_qty, 0),
      received_qty: 0,
      order_status: "created",
      // Nothing has been paid at the moment an order is written down, so the account
      // starts unpaid.
      payment: { account_id: `pa-${now}`, payments: [] },
      lines: orderLines,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
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
                value={orderDate}
                onChange={(event) => setOrderDate(event.target.value)}
              />
              <CustomerPicker value={customerName} onChange={pickCustomer} />
              <Input
                label="Phone"
                className={EDITABLE}
                placeholder="09-…"
                value={customerPhone}
                onChange={(event) => setCustomerPhone(event.target.value)}
              />
              <Input
                label="Address"
                className={EDITABLE}
                placeholder="Street, town"
                value={customerAddress}
                onChange={(event) => setCustomerAddress(event.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <Button disabled={!canLeaveCustomer} onClick={() => setStep(1)}>
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
                counts and unit — black10s,pink2p — and the quantity works
                itself out.
              </p>
            </div>

            <div className="border border-border rounded-lg divide-y divide-border">
              {lines.map((line, index) => {
                const lineQty = draftPairs(line);
                const lineAmount = lineQty * (Number(line.selling_price) || 0);
                return (
                  <div
                    key={index}
                    className="grid gap-3 grid-cols-1 md:grid-cols-12 items-start p-3"
                  >
                    <div className="md:col-span-3">
                      <SuggestInput
                        label={<Required>Stock code</Required>}
                        placeholder="A1001"
                        suggestions={STOCK_CODES}
                        value={line.stock_code}
                        onChange={(next) => setStockCode(index, next)}
                      />
                    </div>
                    <div className="md:col-span-5">
                      <Input
                        label="Description"
                        className={EDITABLE}
                        placeholder="Men's leather sandal"
                        value={line.description}
                        onChange={(event) =>
                          updateLine(index, { description: event.target.value })
                        }
                      />
                    </div>
                    <div className="md:col-span-4">
                      <Select
                        label="Group"
                        className={EDITABLE}
                        value={line.group}
                        onChange={(event) =>
                          updateLine(index, {
                            group: event.target.value as ProductGroup,
                          })
                        }
                      >
                        {PRODUCT_GROUPS.map((group) => (
                          <option key={group} value={group}>
                            {GROUP_LABELS[group]}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="md:col-span-3">
                      <Select
                        label="Supplier / Factory"
                        className={EDITABLE}
                        value={line.supplier_name}
                        onChange={(event) =>
                          updateLine(index, {
                            supplier_name: event.target.value,
                          })
                        }
                      >
                        <option value="">Choose…</option>
                        {SUPPLIER_NAMES.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="md:col-span-4">
                      <Input
                        label={<Required>Colors</Required>}
                        className={EDITABLE}
                        placeholder="black10s,pink2p"
                        value={line.color_qty}
                        onChange={(event) =>
                          updateLine(index, { color_qty: event.target.value })
                        }
                        error={colorQtyProblem(line.color_qty) ?? undefined}
                        hint={
                          lineQty > 0
                            ? sets(lineQty)
                            : "Every color needs a unit — s sets, p pairs, d dozens"
                        }
                      />
                    </div>
                    <div className="md:col-span-3">
                      <Input
                        label="Selling price"
                        type="text"
                        inputMode="numeric"
                        placeholder="0"
                        className={cn(EDITABLE, "text-right")}
                        value={line.selling_price}
                        onChange={(event) =>
                          updateLine(index, {
                            selling_price: onlyDigits(event.target.value),
                          })
                        }
                        hint={lineAmount > 0 ? formatKyat(lineAmount) : " "}
                      />
                    </div>
                    <div className="md:col-span-2 flex md:justify-end md:pt-7">
                      <Button
                        variant="ghost"
                        size="sm"
                        className={SOFT_RED}
                        aria-label={`Remove row ${index + 1}`}
                        onClick={() => removeLine(index)}
                      >
                        <TrashIcon className="w-4 h-4" />
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}

              <div className="grid gap-3 grid-cols-1 md:grid-cols-12 items-center p-3 bg-bg-subtle">
                <span className="md:col-span-5 text-sm font-semibold text-text-primary">
                  Total
                </span>
                <span className="md:col-span-3 text-sm font-semibold tabular-nums text-text-primary">
                  {sets(totalQty)}
                </span>
                <span className="md:col-span-2 text-sm font-semibold tabular-nums text-brand md:text-right">
                  {formatKyat(totalAmount)}
                </span>
                <span className="hidden md:block md:col-span-2" />
              </div>
            </div>

            <div>
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() =>
                  setLines((current) => [...current, { ...EMPTY_LINE }])
                }
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
              <Button disabled={!canLeaveProducts} onClick={() => setStep(2)}>
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
                  <Th>Stock code</Th>
                  <Th className="w-48">Product</Th>
                  <Th>Colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right">Selling price</Th>
                  <Th className="text-right">Amount</Th>
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
                      <Td className="font-semibold text-brand">
                        {line.stock_code}
                      </Td>
                      <Td>
                        <ProductCell
                          description={line.description}
                          group={line.group}
                        />
                      </Td>
                      <Td className="font-mono text-xs text-text-secondary">
                        {line.color_qty || "—"}
                      </Td>
                      <Td className="text-right tabular-nums">{sets(qty)}</Td>
                      <Td className="text-right tabular-nums text-text-secondary">
                        {formatKyat(Number(line.selling_price) || 0)}
                      </Td>
                      <Td className="text-right tabular-nums font-medium">
                        {formatKyat(qty * (Number(line.selling_price) || 0))}
                      </Td>
                    </Tr>
                  );
                })}
                <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                  <Td className="font-semibold" colSpan={4}>
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
              <Button onClick={submit}>
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
