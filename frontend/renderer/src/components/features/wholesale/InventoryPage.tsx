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
  ProductCell,
  ReadOnlyField,
  Reference,
  SectionLabel,
  StatusPill,
} from "@renderer/components/features/wholesale/ui";
import {
  allocatedPairs,
  incomingMovements,
  movementsFor,
  ordersWaitingFor,
  stockLines,
  stockPurpose,
  type StockLine,
  type StockPurpose,
  type StockMovement,
} from "@renderer/components/features/wholesale/stock";
import {
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
  colorQtyProblem,
  formatDate,
  formatQty,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  fromPairs,
  toPairs,
  type Unit,
} from "@renderer/components/features/wholesale/units";
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
};

const STATUS_STYLES: Record<StockPurpose, string> = {
  waiting: "bg-brand text-white",
  for_sale: "bg-success text-white",
};

const STOCK_PURPOSES: StockPurpose[] = ["waiting", "for_sale"];

export default function InventoryPage({ session }: { session: Session }): React.JSX.Element {
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
        movements={movementsFor(movements, line.stock_code, line.location)}
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
      onRecordOut={recordOut}
      onRefresh={reload}
      refreshing={isRefreshing}
    />
  );
}

/** Every delivery waiting to be made, across every product and place. Staff do not start
 *  their day from "what do we hold?" — they start from "what do we owe?", and that is one
 *  list to work down rather than a product to open and a table to find inside it. */
function toDeliver(
  lines: StockLine[],
  orders: CustomerOrder[],
): { line: StockLine; order: CustomerOrder }[] {
  const rows: { line: StockLine; order: CustomerOrder }[] = [];
  for (const line of lines) {
    for (const order of ordersWaitingFor(line.stock_code, orders)) {
      rows.push({ line, order });
    }
  }
  return rows.sort((a, b) =>
    a.order.order_date < b.order.order_date ? 1 : -1,
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

function StockList({
  lines,
  orders,
  onOpen,
  onRecordOut,
  onRefresh,
  refreshing,
}: {
  lines: StockLine[];
  orders: CustomerOrder[];
  onOpen: (stockCode: string, location: string) => void;
  onRecordOut: (movement: StockMovement, orderId: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [tab, setTab] = useState<"stock" | "deliver">("stock");
  const [deliverTo, setDeliverTo] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const deliveries = useMemo(() => toDeliver(lines, orders), [lines, orders]);
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
              {tab === "stock"
                ? "What is held at each place."
                : "Every delivery waiting to be made."}
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
            <div className="flex rounded-md bg-bg-subtle p-0.5 gap-0.5">
              {(
                [
                  ["stock", "Stock"],
                  ["deliver", `To deliver (${formatQty(deliveries.length)})`],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  aria-current={tab === id ? "page" : undefined}
                  className={cn(
                    "h-8 px-4 rounded-[5px] text-sm font-medium transition-colors duration-150",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                    // Blue and filled, the way the Retail/Wholesale switcher marks the
                    // workspace you are in. A white-on-grey pill was too quiet to answer
                    // "which list am I looking at?" at a glance.
                    tab === id
                      ? "bg-brand text-white shadow-sm"
                      : "text-text-secondary hover:text-text-primary",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {tab === "deliver" ? (
          <DeliveryList
            deliveries={deliveries}
            deliverTo={deliverTo}
            onDeliverTo={setDeliverTo}
            onRecordOut={onRecordOut}
          />
        ) : (
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
                      <Th className="whitespace-nowrap">Stock code</Th>
                      <Th className="w-48">Product</Th>
                      <Th>Place</Th>
                      <Th>Colors</Th>
                      <Th className="text-right">Received</Th>
                      <Th className="text-right whitespace-nowrap">Sent out</Th>
                      <Th className="text-right whitespace-nowrap">In stock</Th>
                      <Th className="text-right whitespace-nowrap">
                        Orders waiting
                      </Th>
                      <Th className="whitespace-nowrap">Last moved</Th>
                      <Th>Status</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {visible.map((line) => (
                      <Tr key={`${line.stock_code}@${line.location}`}>
                        <Td className="whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                onOpen(line.stock_code, line.location)
                              }
                              className={cn(
                                "font-semibold text-brand rounded-sm",
                                "hover:underline underline-offset-2",
                                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                              )}
                            >
                              {line.stock_code}
                            </button>
                            <CopyButton
                              value={line.stock_code}
                              what="stock code"
                            />
                          </span>
                        </Td>
                        <Td>
                          <ProductCell
                            description={line.description}
                            group={line.group}
                          />
                        </Td>
                        <Td className="text-text-secondary">{line.location}</Td>
                        <Td className="font-mono text-xs text-text-secondary">
                          {line.colors || "—"}
                        </Td>
                        <Td className="text-right tabular-nums text-text-secondary whitespace-nowrap">
                          {show(line.pairs_in)}
                        </Td>
                        <Td className="text-right tabular-nums text-text-secondary whitespace-nowrap">
                          {show(line.pairs_out)}
                        </Td>
                        <Td
                          className={cn(
                            "text-right tabular-nums font-semibold",
                            line.in_stock <= 0
                              ? "text-text-muted"
                              : "text-text-primary",
                          )}
                        >
                          {show(line.in_stock)}
                        </Td>
                        <Td className="text-right tabular-nums font-semibold text-brand">
                          {formatQty(
                            ordersWaitingFor(line.stock_code, orders).length,
                          )}
                        </Td>
                        <Td className="text-text-muted whitespace-nowrap">
                          {formatDate(line.last_moved)}
                        </Td>
                        <Td>
                          <StockBadge line={line} orders={orders} />
                        </Td>
                      </Tr>
                    ))}
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
        )}
      </Panel>
    </div>
  );
}

/** The day's work: one row per product a customer is still waiting for, wherever it is
 *  held. Pressing Deliver opens the boxes under that row. */
function DeliveryList({
  deliveries,
  deliverTo,
  onDeliverTo,
  onRecordOut,
}: {
  deliveries: { line: StockLine; order: CustomerOrder }[];
  deliverTo: string | null;
  onDeliverTo: (key: string | null) => void;
  onRecordOut: (movement: StockMovement, orderId: string) => void;
}): React.JSX.Element {
  if (deliveries.length === 0) {
    return (
      <EmptyState
        icon={<InventoryIcon />}
        title="Nothing waiting"
        description="No customer is waiting on anything that is in stock. What is here is free to sell."
      />
    );
  }

  return (
    <TableContainer className="border-0 rounded-none">
      <Thead>
        <Tr>
          <Th className="whitespace-nowrap">Stock code</Th>
          <Th className="w-48">Product</Th>
          <Th>Place</Th>
          <Th className="text-right whitespace-nowrap">In stock</Th>
          <Th>Customer</Th>
          <Th>Address</Th>
          <Th>Colors</Th>
          <Th className="whitespace-nowrap">Order no.</Th>
          <Th className="text-right whitespace-nowrap">Remaining qty</Th>
          <Th className="w-32" aria-label="Deliver" />
        </Tr>
      </Thead>
      <Tbody>
        {deliveries.map(({ line, order }) => {
          const key = `${line.stock_code}@${line.location}@${order.order_no}`;
          return (
            <Fragment key={key}>
              <Tr>
                <Td className="font-semibold whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    {line.stock_code}
                    <CopyButton value={line.stock_code} what="stock code" />
                  </span>
                </Td>
                <Td>
                  <ProductCell
                    description={line.description}
                    group={line.group}
                  />
                </Td>
                <Td className="text-text-secondary">{line.location}</Td>
                <Td
                  className={cn(
                    "text-right tabular-nums font-semibold",
                    line.in_stock > 0 ? "text-text-primary" : "text-text-muted",
                  )}
                >
                  {formatIn(line.in_stock, "set")}
                </Td>
                <Td className="font-medium whitespace-nowrap">
                  {order.customer_name}
                </Td>
                <Td className="text-text-secondary">
                  {order.customer_address}
                </Td>
                <Td className="font-mono text-xs text-text-secondary">
                  {colorsWanted(order, line.stock_code)}
                </Td>
                <Td className="whitespace-nowrap">
                  <Reference value={order.order_no} what="order no." />
                </Td>
                <Td className="text-right tabular-nums font-semibold text-error whitespace-nowrap">
                  {formatIn(remainingOf(order, line.stock_code), "set")}
                </Td>
                <Td className="text-right">
                  {deliverTo === key ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDeliverTo(null)}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={line.in_stock <= 0}
                      onClick={() => onDeliverTo(key)}
                    >
                      Deliver
                    </Button>
                  )}
                </Td>
              </Tr>
              {deliverTo === key && (
                <DeliverRow
                  line={line}
                  order={order}
                  onCancel={() => onDeliverTo(null)}
                  onSave={(movement) => {
                    onRecordOut(movement, order.order_id);
                    onDeliverTo(null);
                  }}
                />
              )}
            </Fragment>
          );
        })}
      </Tbody>
    </TableContainer>
  );
}

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

function StockDetail({
  line,
  orders,
  movements,
  onUpdateDelivery,
  onDeleteDelivery,
  onBack,
}: {
  line: StockLine;
  orders: CustomerOrder[];
  movements: StockMovement[];
  onUpdateDelivery: (movement: StockMovement) => void;
  onDeleteDelivery: (movementId: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<string | null>(null);

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
          <h2 className="text-lg font-semibold text-text-primary tracking-tight">
            Stock details
          </h2>
          <StockBadge line={line} orders={orders} />
        </div>

        <div className="px-6 py-6 flex flex-col gap-8">
          <section>
            <SectionLabel>This line</SectionLabel>
            <dl className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <ReadOnlyField
                label="Stock code"
                value={line.stock_code}
                copyable
              />
              <ReadOnlyField label="Description" value={line.description} />
              <ReadOnlyField label="Group" value={GROUP_LABELS[line.group]} />
              {/* Beside the group rather than across the whole row: a colour line is a
                  short piece of text, and a box four columns wide made it look like a
                  paragraph. */}
              <ReadOnlyField label="Colors in stock" value={line.colors} />
              <ReadOnlyField label="Place" value={line.location} />
              <ReadOnlyField
                label="In stock"
                value={formatIn(line.in_stock, "set")}
              />
              <ReadOnlyField
                label="Last moved"
                value={formatDate(line.last_moved)}
              />
            </dl>
          </section>

          <section>
            <SectionLabel>Movements</SectionLabel>
            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="whitespace-nowrap">Date</Th>
                  <Th>What happened</Th>
                  <Th>Colors</Th>
                  <Th className="text-right">Quantity</Th>
                  <Th>From / to</Th>
                  <Th>Note</Th>
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
                          "text-right tabular-nums font-semibold",
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
                      <Td className="text-text-muted">
                        {movement.note || "—"}
                      </Td>
                      {/* Only what went out can be corrected here. What came in is the
                          gate's own count, and the place to put that right is the
                          receiving it was counted on. */}
                      <Td className="text-center whitespace-nowrap">
                        {movement.kind === "in" ? (
                          <span className="text-xs text-text-muted">
                            Fix in Receiving
                          </span>
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
                    In stock now
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
  onCancel,
  onSave,
}: {
  line: StockLine;
  order: CustomerOrder;
  onCancel: () => void;
  onSave: (movement: StockMovement) => void;
}): React.JSX.Element {
  const [colorQty, setColorQty] = useState("");
  const [sets, setSets] = useState("");
  // A delivery is typed in its own unit, not whatever the page happens to be showing.
  const [entryUnit, setEntryUnit] = useState<Unit>("set");
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");

  const amount = toPairs(Number(sets) || 0, entryUnit);
  // Two ceilings, and the lower one wins: we cannot hand over what is not on the shelf,
  // and we cannot hand a customer more of a product than they asked for.
  const owed = remainingOf(order, line.stock_code);
  const tooMuchStock = amount > line.in_stock;
  const tooMuchOrder = amount > owed;
  const tooMany = tooMuchStock || tooMuchOrder;
  const canSave = amount > 0 && !tooMany && colorQtyProblem(colorQty) === null;

  return (
    <Tr className="bg-brand-subtle hover:bg-brand-subtle">
      <Td colSpan={10}>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 items-end">
          <label className="block">
            <span className="block text-xs text-text-muted mb-1">Colors</span>
            <CellInput
              label={`Colors delivered to ${order.customer_name}`}
              placeholder="black10s,pink2p"
              error={colorQtyProblem(colorQty) ?? undefined}
              value={colorQty}
              onChange={setColorQty}
            />
          </label>
          <label className="block">
            <span className="block text-xs text-text-muted mb-1">
              Quantity <span className="text-error">*</span>
            </span>
            <QuantityInput
              compact
              label={`How many delivered to ${order.customer_name}`}
              unitLabel="Unit this delivery is counted in"
              value={sets}
              unit={entryUnit}
              onChange={setSets}
              onUnitChange={setEntryUnit}
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
  const [qty, setQty] = useState(String(fromPairs(movement.pairs, "set")));
  const [unit, setUnit] = useState<Unit>("set");
  const [date, setDate] = useState(movement.date);
  const [note, setNote] = useState(movement.note);

  const pairs = toPairs(Number(qty) || 0, unit);
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
      <Td>
        <QuantityInput
          compact
          label="How many were delivered"
          unitLabel="Unit this delivery is counted in"
          value={qty}
          unit={unit}
          onChange={setQty}
          onUnitChange={setUnit}
        />
      </Td>
      <Td className="text-text-secondary">
        <span className="block">{movement.party || "—"}</span>
        <span className="block text-xs text-text-muted">
          {movement.reference}
        </span>
      </Td>
      <Td>
        <CellInput
          label="Note on this delivery"
          placeholder="Take a note"
          value={note}
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
