import { Fragment, useMemo, useState } from "react";
import { type Session } from "@renderer/lib/auth";
import { useCachedFetch } from "@renderer/lib/useCachedFetch";
import { useToast } from "@renderer/lib/useToast";
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
  InventoryIcon,
  PencilIcon,
  SearchIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  CellInput,
  SOFT_BLUE,
  SOFT_RED,
  FigureCard,
  PAGE_SIZE,
  Panel,
  QuantityInput,
  CopyButton,
  ReadOnlyField,
  Reference,
  SectionLabel,
  StatusPill,
} from "@renderer/components/features/wholesale/ui";
import {
  allocatedPairs,
  colorPairsForMovements,
  colorPairsForOrder,
  colorPairsForText,
  incomingMovements,
  movementsFor,
  ordersWaitingFor,
  stockLines,
  stockPurpose,
  type StockLine,
  type StockPurpose,
  type StockMovement,
  type ColorPairs,
} from "@renderer/components/features/wholesale/stock";
import {
  lineRemaining,
  remainingOf,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/customerOrders";
import {
  useWholesale,
} from "@renderer/components/features/wholesale/store";
import {
  WHOLESALE_INVENTORY_URL,
  WholesaleApiError,
  createCustomerDelivery,
  deleteCustomerDelivery,
  inventoryMovementsFromWire,
  updateCustomerDelivery,
} from "@renderer/components/features/wholesale/api";
import {
  colorQtyPairs,
  colorQtyProblem,
  formatDate,
  formatQty,
  quantityFromColors,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import { formatIn, type Unit } from "@renderer/components/features/wholesale/units";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/products";

// What the business is holding, and where. The receiving gate records one delivery at a
// time and never changes again; this screen is the running total across all of them, less
// whatever has gone out — the number a person needs before promising a customer anything.
//
// Everything coming in is worked out from the receivings, so nothing is typed twice: open
// a package at the gate, and its sets are on this screen the same moment. Only what leaves
// is recorded here.

type View = "list" | "detail";
type StatusFilter = StockPurpose | "all";

const STATUS_LABELS: Record<StockPurpose, string> = {
  waiting: "Allocated",
  for_sale: "Available",
  out_of_stock: "Out of stock",
};

const STATUS_STYLES: Record<StockPurpose, string> = {
  waiting: "bg-brand text-white",
  for_sale: "bg-success text-white",
  out_of_stock: "bg-text-secondary text-bg-base",
};

const STOCK_PURPOSES: StockPurpose[] = ["waiting", "for_sale", "out_of_stock"];

export default function InventoryPage({
  session,
  onOpenReceiving,
}: {
  session: Session;
  onOpenReceiving: (receivingNo: string) => void;
}): React.JSX.Element {
  const showToast = useToast();
  const { data: wire, isRefreshing, reload } = useCachedFetch<StockMovement[]>(
    WHOLESALE_INVENTORY_URL,
    session,
    "wholesale inventory",
  );
  // Nothing here is this page's own: stock is what the gate has counted less what has
  // gone out to customers, and both belong to the whole workspace.
  const { orders, receivings, outgoing } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<{
    stock_code: string;
    location: string;
  } | null>(null);

  const movements = useMemo(
    () => wire ? inventoryMovementsFromWire(wire) : [...incomingMovements(receivings), ...outgoing],
    [wire, receivings, outgoing],
  );
  const lines = useMemo(() => stockLines(movements), [movements]);

  const line =
    selected === null
      ? null
      : (lines.find(
          (entry) =>
            entry.stock_code === selected.stock_code &&
            entry.location === selected.location,
        ) ?? null);

  // Handing goods over is one action, not two: the pairs leave the shelf and the same
  // pairs are credited to the customer's order.
  function recordOut(movement: StockMovement, orderId: string): void {
    createCustomerDelivery(session, orderId, movement)
      .then(reload)
      .catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not record the delivery."));
  }

  if (view === "detail" && line) {
    return (
      <StockDetail
        orders={orders}
        line={line}
        allMovements={movements}
        movements={movementsFor(movements, line.stock_code, line.location)}
        onOpenReceiving={onOpenReceiving}
        onRecordOut={recordOut}
        onUpdateDelivery={(movement) => updateCustomerDelivery(session, movement).then(reload).catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not correct the delivery."))}
        onDeleteDelivery={(movementId) => deleteCustomerDelivery(session, movementId).then(reload).catch((error) => showToast("error", error instanceof WholesaleApiError ? error.message : "Could not remove the delivery."))}
        onBack={() => setView("list")}
      />
    );
  }

  return (
    <StockList
      lines={lines}
      orders={orders}
      onOpen={(stockCode, location) => {
        setSelected({ stock_code: stockCode, location });
        setView("detail");
      }}
      onRefresh={reload}
      refreshing={isRefreshing}
    />
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

function StockList({
  lines,
  orders,
  onOpen,
  onRefresh,
  refreshing,
}: {
  lines: StockLine[];
  orders: CustomerOrder[];
  onOpen: (stockCode: string, location: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  // Held in pairs, read in sets — the unit the business trades in.
  const show = (pairs: number): string => formatIn(pairs, "set");
  const totalSets = lines.reduce((sum, line) => sum + line.in_stock, 0);
  const locations = [...new Set(lines.map((line) => line.location))];
  // Counted in pairs promised, not in lines: a line holding 40 sets against an order for
  // 3 is mostly free stock, and calling all 40 "allocated" would say the opposite.
  const waitingSets = lines.reduce(
    (sum, line) => sum + allocatedPairs(line, orders),
    0,
  );
  const freeSets = totalSets - waitingSets;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return lines.filter((line) => {
      const matchesQuery =
        query === "" ||
        line.stock_code.toLowerCase().includes(query) ||
        line.description.toLowerCase().includes(query) ||
        line.location.toLowerCase().includes(query) ||
        line.colors.toLowerCase().includes(query);
      const matchesLocation = location === "all" || line.location === location;
      const matchesStatus =
        status === "all" || stockPurpose(line, orders) === status;
      return matchesQuery && matchesLocation && matchesStatus;
    });
  }, [lines, orders, search, location, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isFiltered =
    search.trim() !== "" || location !== "all" || status !== "all";

  function resetFilters(): void {
    setSearch("");
    setLocation("all");
    setStatus("all");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <FigureCard
          label="In stock"
          value={show(totalSets)}
          sub="across every place"
        />
        <FigureCard
          label="Products"
          value={formatQty(new Set(lines.map((line) => line.stock_code)).size)}
          sub="stock codes held"
          tone="neutral"
        />
        <FigureCard
          label="Allocated"
          value={show(waitingSets)}
          sub="already promised to customers"
        />
        <FigureCard
          label="Available"
          value={show(freeSets)}
          sub="nobody has claimed it"
          tone="success"
        />
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Inventory
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              What is held at each place. Open a stock line to deliver it to a
              related customer order.
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
          </div>
        </div>

        <>
            <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
              <div className="w-full sm:w-80">
                <Input
                  aria-label="Search stock"
                  placeholder="Search product, place or color"
                  startIcon={<SearchIcon className="w-4 h-4" />}
                  value={search}
                  onChange={(event) => {
                    setSearch(event.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="w-full sm:w-64">
                <Select
                  aria-label="Filter by place"
                  value={location}
                  onChange={(event) => {
                    setLocation(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">Any place</option>
                  {locations.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-full sm:w-48">
                <Select
                  aria-label="Filter by status"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as StatusFilter);
                    setPage(1);
                  }}
                >
                  <option value="all">Any status</option>
                  {STOCK_PURPOSES.map((option) => (
                    <option key={option} value={option}>
                      {STATUS_LABELS[option]}
                    </option>
                  ))}
                </Select>
              </div>
              {isFiltered && (
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Clear filters
                </Button>
              )}
            </div>

            {visible.length === 0 ? (
              <EmptyState
                icon={<InventoryIcon />}
                title={isFiltered ? "No stock matches" : "Nothing in stock yet"}
                description={
                  isFiltered
                    ? "Nothing here matches what you searched for. Try a different code or place."
                    : "Stock appears here as packages are opened at the receiving gate."
                }
                action={
                  isFiltered ? (
                    <Button variant="secondary" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  ) : undefined
                }
              />
            ) : (
              <>
                <TableContainer className="border-0 rounded-none">
                  <Thead>
                    <Tr>
                      <Th className="min-w-[14rem]">Product</Th>
                      <Th>Place</Th>
                      <Th>Colors</Th>
                      <Th className="text-right whitespace-nowrap">
                        Total stock
                      </Th>
                      <Th className="text-right whitespace-nowrap">Allocated</Th>
                      <Th className="text-right whitespace-nowrap">Available</Th>
                      <Th className="text-right whitespace-nowrap">
                        Orders waiting
                      </Th>
                      <Th>Status</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {visible.map((line) => {
                      const allocated = allocatedPairs(line, orders);
                      const available = Math.max(0, line.in_stock - allocated);
                      return (
                      <Tr key={`${line.stock_code}@${line.location}`}>
                        <Td>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <div className="flex min-w-0 items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  onOpen(line.stock_code, line.location)
                                }
                                className={cn(
                                  "font-semibold text-brand break-words rounded-sm",
                                  "hover:underline underline-offset-2",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                                )}
                              >
                                {line.stock_code || "No stock code"}
                              </button>
                              {line.stock_code && (
                                <CopyButton
                                  value={line.stock_code}
                                  what="stock code"
                                />
                              )}
                            </div>
                            <span className="break-words text-text-primary">
                              {line.description || "—"}
                            </span>
                            <span className="text-xs text-text-muted">
                              {GROUP_LABELS[line.group]}
                            </span>
                          </div>
                        </Td>
                        <Td className="text-text-secondary">{line.location}</Td>
                        <Td className="font-mono text-xs text-text-secondary">
                          {line.colors || "—"}
                        </Td>
                        <Td className="text-right tabular-nums font-semibold whitespace-nowrap text-text-primary">
                          {show(line.in_stock)}
                        </Td>
                        <Td className="text-right tabular-nums font-semibold whitespace-nowrap">
                          {show(allocated)}
                        </Td>
                        <Td className="text-right tabular-nums font-semibold whitespace-nowrap text-success">
                          {show(available)}
                        </Td>
                        <Td className="text-right tabular-nums font-semibold text-brand">
                          {formatQty(
                            ordersWaitingFor(line.stock_code, orders).length,
                          )}
                        </Td>
                        <Td>
                          <StockBadge line={line} orders={orders} />
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
        </>
      </Panel>
    </div>
  );
}

/** The day's work: one row per product a customer is still waiting for, wherever it is
 *  held. Pressing Deliver opens the boxes under that row. */
function StockBadge({
  line,
  orders,
}: {
  line: StockLine;
  orders: CustomerOrder[];
}): React.JSX.Element {
  const purpose = stockPurpose(line, orders);
  return (
    <StatusPill
      label={STATUS_LABELS[purpose]}
      className={STATUS_STYLES[purpose]}
    />
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

const MOVEMENT_LABELS: Record<StockMovement["kind"], string> = {
  in: "Received at gate",
  out: "Delivered to customer",
};

const MOVEMENT_STYLES: Record<StockMovement["kind"], string> = {
  in: "bg-success text-white",
  out: "bg-brand text-white",
};

const RELATED_ORDER_STATUS_LABELS: Record<CustomerOrder["order_status"], string> = {
  created: "Created",
  processing: "Processing",
  completed: "Completed",
  cancelled: "Cancelled",
};

const RELATED_ORDER_STATUS_STYLES: Record<CustomerOrder["order_status"], string> = {
  created: "bg-text-secondary text-white",
  processing: "bg-brand text-white",
  completed: "bg-success text-white",
  cancelled: "bg-error text-white",
};

interface RelatedOrderRow {
  order: CustomerOrder;
  ordered: number;
  received: number;
  remaining: number;
}

function relatedOrdersFor(
  stockCode: string,
  orders: CustomerOrder[],
): RelatedOrderRow[] {
  return orders
    .filter(
      (order) =>
        order.order_status !== "cancelled" &&
        order.lines.some((line) => line.stock_code === stockCode),
    )
    .map((order) => {
      const lines = order.lines.filter((line) => line.stock_code === stockCode);
      return {
        order,
        ordered: lines.reduce((sum, line) => sum + line.wanted_qty, 0),
        received: lines.reduce((sum, line) => sum + line.received_qty, 0),
        remaining: lines.reduce((sum, line) => sum + lineRemaining(line), 0),
      };
    })
    .sort((a, b) => (a.order.order_date < b.order.order_date ? 1 : -1));
}

interface ColorAvailability {
  missing: ColorPairs;
  remaining: ColorPairs;
}

function colorAvailabilityForOrder(
  order: CustomerOrder,
  stockCode: string,
  stockColors: ColorPairs,
  allMovements: StockMovement[],
): ColorAvailability {
  const ordered = colorPairsForOrder(order, stockCode);
  const delivered = colorPairsForMovements(
    allMovements,
    (movement) =>
      movement.kind === "out" &&
      movement.reference === order.order_no &&
      movement.stock_code === stockCode,
  );
  const remaining: ColorPairs = {};
  const missing: ColorPairs = {};
  for (const [color, pairs] of Object.entries(ordered)) {
    const stillNeeded = Math.max(0, pairs - (delivered[color] ?? 0));
    if (stillNeeded <= 0) continue;
    remaining[color] = stillNeeded;
    const shortfall = Math.max(0, stillNeeded - (stockColors[color] ?? 0));
    if (shortfall > 0) missing[color] = shortfall;
  }
  return { missing, remaining };
}

function formatColorPairs(pairs: ColorPairs): string {
  return Object.entries(pairs)
    .filter(([, quantity]) => quantity > 0)
    .map(([color, quantity]) =>
      quantity % 6 === 0
        ? `${color}${quantity / 6}s`
        : `${color}${quantity}p`,
    )
    .join(", ");
}

function deliveryColorProblem(
  text: string,
  unit: Unit,
  stockColors: ColorPairs,
  remainingColors: ColorPairs,
): string | null {
  if (text.trim() === "") return "Add at least one color to this delivery.";
  const requested = colorPairsForText(text, unit);
  for (const [color, pairs] of Object.entries(requested)) {
    if ((remainingColors[color] ?? 0) <= 0) {
      return `Color "${color}" is not still needed on this order.`;
    }
    if (pairs > (remainingColors[color] ?? 0)) {
      return `Only ${formatIn(remainingColors[color], "pair")} of ${color} is still needed.`;
    }
    if (pairs > (stockColors[color] ?? 0)) {
      return `Only ${formatIn(stockColors[color] ?? 0, "pair")} of ${color} is in stock.`;
    }
  }
  return null;
}

function StockDetail({
  line,
  orders,
  allMovements,
  onOpenReceiving,
  onRecordOut,
  movements,
  onUpdateDelivery,
  onDeleteDelivery,
  onBack,
}: {
  line: StockLine;
  orders: CustomerOrder[];
  allMovements: StockMovement[];
  onOpenReceiving: (receivingNo: string) => void;
  onRecordOut: (movement: StockMovement, orderId: string) => void;
  movements: StockMovement[];
  onUpdateDelivery: (movement: StockMovement) => void;
  onDeleteDelivery: (movementId: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);
  const [deliverTo, setDeliverTo] = useState<string | null>(null);
  const allocated = allocatedPairs(line, orders);
  const available = Math.max(0, line.in_stock - allocated);
  const relatedOrders = useMemo(
    () => relatedOrdersFor(line.stock_code, orders),
    [line.stock_code, orders],
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeftIcon className="w-4 h-4" />
          Back to inventory
        </Button>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                {line.stock_code}
              </h2>
              <StockBadge line={line} orders={orders} />
            </div>
            <p className="mt-0.5 truncate text-sm text-text-muted">
              {line.description} · {GROUP_LABELS[line.group]}
            </p>
          </div>
        </div>

        <div className="px-6 py-6 flex flex-col gap-8">
          <section>
            <SectionLabel>Stock information</SectionLabel>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                <h3 className="mb-3 text-sm font-semibold text-text-primary">
                  Product
                </h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <ReadOnlyField label="Stock code" value={line.stock_code} copyable />
                  <ReadOnlyField label="Group" value={GROUP_LABELS[line.group]} />
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
                  Inventory
                </h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <ReadOnlyField label="Place" value={line.location} wrap />
                  <ReadOnlyField
                    label="Total stock"
                    value={formatIn(line.in_stock, "set")}
                  />
                  <ReadOnlyField
                    label="Allocated"
                    value={formatIn(allocated, "set")}
                  />
                  <ReadOnlyField
                    label="Available"
                    value={formatIn(available, "set")}
                  />
                  <ReadOnlyField
                    label="Last moved"
                    value={formatDate(line.last_moved)}
                  />
                </dl>
              </div>
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SectionLabel>Related customer orders</SectionLabel>
              <span className="text-xs text-text-muted">
                Orders that include this stock code
              </span>
            </div>
            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="whitespace-nowrap">Order no.</Th>
                  <Th>Customer</Th>
                  <Th>Date</Th>
                  <Th>Ordered colors</Th>
                  <Th>Stock colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right whitespace-nowrap">Received qty</Th>
                  <Th className="text-right whitespace-nowrap">Qty to deliver</Th>
                  <Th>Order status</Th>
                  <Th className="w-28" aria-label="Deliver" />
                </Tr>
              </Thead>
              <Tbody>
                {relatedOrders.length === 0 ? (
                  <Tr>
                  <Td colSpan={10} className="py-8 text-center text-text-muted">
                      No customer orders use this stock code.
                    </Td>
                  </Tr>
                ) : (
                  relatedOrders.map(({ order, ordered, received, remaining }) => {
                    const colorCheck = colorAvailabilityForOrder(
                      order,
                      line.stock_code,
                      line.color_pairs,
                      allMovements,
                    );
                    return (
                    <Fragment key={order.order_id}>
                      <Tr>
                        <Td className="whitespace-nowrap">
                          <Reference value={order.order_no} what="order no." />
                        </Td>
                        <Td className="font-medium whitespace-nowrap">
                          {order.customer_name}
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
                        <Td className="font-mono text-xs text-text-secondary break-words">
                          {line.colors || "—"}
                        </Td>
                        <Td className="text-right tabular-nums font-medium">
                          {formatIn(ordered, "set")}
                        </Td>
                        <Td className="text-right tabular-nums font-medium">
                          {formatIn(received, "set")}
                        </Td>
                        <Td
                          className={cn(
                            "text-right tabular-nums font-semibold whitespace-nowrap",
                            remaining > 0 ? "text-error" : "text-success",
                          )}
                        >
                          {formatIn(remaining, "set")}
                        </Td>
                        <Td>
                          <StatusPill
                            label={RELATED_ORDER_STATUS_LABELS[order.order_status]}
                            className={RELATED_ORDER_STATUS_STYLES[order.order_status]}
                          />
                        </Td>
                        <Td className="text-right">
                          {deliverTo === order.order_id ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeliverTo(null)}
                            >
                              Cancel
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              disabled={
                                line.in_stock <= 0 ||
                                remaining <= 0 ||
                                Object.keys(colorCheck.missing).length > 0
                              }
                              onClick={() => setDeliverTo(order.order_id)}
                            >
                              Deliver
                            </Button>
                          )}
                        </Td>
                      </Tr>
                      {deliverTo === order.order_id && (
                        <DeliverRow
                          line={line}
                          order={order}
                          stockColors={line.color_pairs}
                          remainingColors={colorCheck.remaining}
                          onCancel={() => setDeliverTo(null)}
                          onSave={(movement) => {
                            onRecordOut(movement, order.order_id);
                            setDeliverTo(null);
                          }}
                        />
                      )}
                    </Fragment>
                    );
                  })
                )}
              </Tbody>
            </TableContainer>
          </section>

          <section>
            <SectionLabel>Movement history</SectionLabel>
            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="whitespace-nowrap">Date</Th>
                  <Th>What happened</Th>
                  <Th>Colors</Th>
                  <Th className="w-40 max-w-40 text-right">Quantity</Th>
                  <Th>From / to</Th>
                  <Th className="w-56 min-w-56">Note</Th>
                  <Th className="w-24" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {movements.map((movement) =>
                  editing === movement.movement_id ? (
                    <EditMovementRow
                      key={movement.movement_id}
                      movement={movement}
                      onCancel={() => setEditing(null)}
                      onSave={(patch) => {
                        onUpdateDelivery({ ...movement, ...patch });
                        setEditing(null);
                      }}
                    />
                  ) : (
                    <Tr key={movement.movement_id}>
                      <Td className="text-text-muted whitespace-nowrap">
                        {formatDate(movement.date)}
                      </Td>
                      <Td>
                        <StatusPill
                          label={MOVEMENT_LABELS[movement.kind]}
                          className={MOVEMENT_STYLES[movement.kind]}
                        />
                      </Td>
                      <Td className="font-mono text-xs text-text-secondary">
                        {movement.color_qty || "—"}
                      </Td>
                      <Td
                        className={cn(
                          "w-40 max-w-40 text-right tabular-nums font-semibold whitespace-nowrap",
                          movement.kind === "in"
                            ? "text-success"
                            : "text-error",
                        )}
                      >
                        {movement.kind === "in" ? "+" : "−"}
                        {formatIn(movement.pairs, "set")}
                      </Td>
                      <Td className="text-text-secondary">
                        <span className="block">{movement.party || "—"}</span>
                        <span className="block text-xs text-text-muted">
                          {movement.reference}
                        </span>
                      </Td>
                      <Td className="w-56 min-w-56 whitespace-normal break-words text-text-muted">
                        {movement.note || "—"}
                      </Td>
                      {/* Only what went out can be corrected here. What came in is the
                          gate's own count, and the place to put that right is the
                          receiving it was counted on. */}
                      <Td className="text-center whitespace-nowrap">
                        {movement.kind === "in" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpenReceiving(movement.reference)}
                          >
                            Open receiving
                          </Button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => setEditing(movement.movement_id)}
                              title="Correct this delivery"
                              aria-label={`Correct the delivery to ${movement.party}`}
                              className={cn(
                                "p-1.5 rounded-md transition-colors duration-150",
                                SOFT_BLUE,
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                              )}
                            >
                              <PencilIcon className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                            onDeleteDelivery(movement.movement_id)
                              }
                              title="Remove this delivery"
                              aria-label={`Remove the delivery to ${movement.party}`}
                              className={cn(
                                "ml-1 p-1.5 rounded-md transition-colors duration-150",
                                SOFT_RED,
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error",
                              )}
                            >
                              <TrashIcon className="w-4 h-4" />
                            </button>
                          </>
                        )}
                      </Td>
                    </Tr>
                  ),
                )}
                <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                  <Td className="font-semibold" colSpan={3}>
                    Total stock now
                  </Td>
                  <Td className="text-right tabular-nums font-semibold whitespace-nowrap">
                    {formatIn(line.in_stock, "set")}
                  </Td>
                  <Td colSpan={3} className="text-text-muted">
                    {formatIn(line.pairs_in, "set")} received,{" "}
                    {formatIn(line.pairs_out, "set")} sent out
                  </Td>
                </Tr>
              </Tbody>
            </TableContainer>
          </section>
        </div>
      </Panel>
    </div>
  );
}

/** Recording what leaves. What comes in is never typed here — it is already known from
 *  the receiving that brought it. */
/** The colours this order asked for of one stock code — what to look for when the boxes
 *  are opened, rather than having to go back to the order to find out. */
function colorsWanted(order: CustomerOrder, stockCode: string): string {
  const colors = order.lines
    .filter((line) => line.stock_code === stockCode)
    .map((line) => line.color_qty)
    .filter((color) => color.trim() !== "");
  return colors.join(",") || "—";
}

/** The delivery boxes, opening in the table directly under the order they belong to. The
 *  customer and the order are already known from that row, so all that is left to type is
 *  what is going and when — in the table's own cells, not a form somewhere else on the
 *  page. */
function DeliverRow({
  line,
  order,
  stockColors,
  remainingColors,
  onCancel,
  onSave,
}: {
  line: StockLine;
  order: CustomerOrder;
  stockColors: ColorPairs;
  remainingColors: ColorPairs;
  onCancel: () => void;
  onSave: (movement: StockMovement) => void;
}): React.JSX.Element {
  const [colorQty, setColorQty] = useState("");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");

  // The colors are the only place the quantity is typed — the same rule every other
  // colour line in the app follows (see quantityFromColors in ./shared). A second,
  // separately-typed quantity box used to sit next to this one and could say something
  // different from what the colors actually added up to; only the colors were ever sent
  // to the server, so the box was validating a number nobody was really saving.
  const amount = colorQtyPairs(colorQty, "set");
  const shown = quantityFromColors(colorQty, "set");
  // Two ceilings, and the lower one wins: we cannot hand over what is not on the shelf,
  // and we cannot hand a customer more of a product than they asked for.
  const owed = remainingOf(order, line.stock_code);
  const tooMuchStock = amount > line.in_stock;
  const tooMuchOrder = amount > owed;
  const tooMany = tooMuchStock || tooMuchOrder;
  const colorsProblem =
    colorQtyProblem(colorQty) ??
    deliveryColorProblem(colorQty, "set", stockColors, remainingColors);
  const canSave = amount > 0 && !tooMany && colorsProblem === null;

  return (
    <Tr className="bg-brand-subtle hover:bg-brand-subtle">
      <Td colSpan={10}>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 items-end">
          <label className="block">
            <span className="block text-xs text-text-muted mb-1">
              Colors <span className="text-error">*</span>
            </span>
            <CellInput
              label={`Colors delivered to ${order.customer_name}`}
              placeholder="black10s,pink2p"
              error={colorsProblem ?? undefined}
              value={colorQty}
              onChange={setColorQty}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-text-muted mb-1">Quantity</span>
            <QuantityInput
              compact
              readOnly
              label={`How many delivered to ${order.customer_name}`}
              unitLabel="Unit this delivery is counted in"
              value={String(shown.qty)}
              unit={shown.unit}
              onChange={() => {}}
              onUnitChange={() => {}}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-text-muted mb-1">Date</span>
            <CellInput
              label="Date delivered"
              placeholder=""
              type="date"
              value={date}
              onChange={setDate}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-text-muted mb-1">Note</span>
            <CellInput
              label="Note on this delivery"
              placeholder="Take a note"
              value={note}
              onChange={setNote}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={!canSave}
              onClick={() =>
                onSave({
                  movement_id: `mv-${Date.now()}`,
                  kind: "out",
                  stock_code: line.stock_code,
                  description: line.description,
                  group: line.group,
                  color_qty: colorQty.trim(),
                  pairs: amount,
                  location: line.location,
                  date,
                  reference: order.order_no,
                  party: order.customer_name,
                  note: note.trim(),
                })
              }
            >
              <CheckIcon className="w-4 h-4" />
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        </div>
        {tooMuchStock && (
          <p className="text-xs text-error mt-2">
            Only {formatIn(line.in_stock, "set")} are in stock here.
          </p>
        )}
        {!tooMuchStock && tooMuchOrder && (
          <p className="text-xs text-error mt-2">
            {order.customer_name} is only owed {formatIn(owed, "set")} of this
            product.
          </p>
        )}
      </Td>
    </Tr>
  );
}

/** Correcting a delivery, in the row it is written on. A delivery is the only record that
 *  a customer was given something, so putting it right here is what puts the customer's
 *  order right — there is no second figure to go and adjust. */
function EditMovementRow({
  movement,
  onCancel,
  onSave,
}: {
  movement: StockMovement;
  onCancel: () => void;
  onSave: (patch: Partial<StockMovement>) => void;
}): React.JSX.Element {
  const [colorQty, setColorQty] = useState(movement.color_qty);
  const [date, setDate] = useState(movement.date);
  const [note, setNote] = useState(movement.note);

  // The colors are the only place the quantity is typed — see the matching note in
  // DeliverRow above. Editing used to offer a separate quantity box that was silently
  // dropped when this saved; only the colors were ever sent to the server.
  const pairs = colorQtyPairs(colorQty, "set");
  const shown = quantityFromColors(colorQty, "set");
  const canSave = pairs > 0 && colorQtyProblem(colorQty) === null;

  return (
    <Tr className="bg-brand-subtle hover:bg-brand-subtle">
      <Td>
        <CellInput
          label="Date of this delivery"
          placeholder=""
          type="date"
          value={date}
          onChange={setDate}
        />
      </Td>
      <Td className="text-text-muted text-sm">Sent to customer</Td>
      <Td>
        <CellInput
          label="Colors delivered"
          placeholder="black10s,pink2p"
          value={colorQty}
          onChange={setColorQty}
          error={colorQtyProblem(colorQty) ?? undefined}
        />
      </Td>
      <Td className="w-40 max-w-40">
        <QuantityInput
          compact
          readOnly
          label="How many were delivered"
          unitLabel="Unit this delivery is counted in"
          value={String(shown.qty)}
          unit={shown.unit}
          onChange={() => {}}
          onUnitChange={() => {}}
        />
      </Td>
      <Td className="text-text-secondary">
        <span className="block">{movement.party || "—"}</span>
        <span className="block text-xs text-text-muted">
          {movement.reference}
        </span>
      </Td>
      <Td className="w-56 min-w-56 align-top">
        <CellInput
          label="Note on this delivery"
          placeholder="Take a note"
          value={note}
          multiline
          onChange={setNote}
        />
      </Td>
      <Td className="text-center whitespace-nowrap">
        <Button
          size="sm"
          disabled={!canSave}
          onClick={() =>
            onSave({
              color_qty: colorQty.trim(),
              pairs,
              date,
              note: note.trim(),
            })
          }
        >
          <CheckIcon className="w-4 h-4" />
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </Td>
    </Tr>
  );
}
