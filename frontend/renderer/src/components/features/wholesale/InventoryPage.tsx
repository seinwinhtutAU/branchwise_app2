import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
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
  ChevronLeftIcon,
  EyeIcon,
  InventoryIcon,
  MoreIcon,
  SearchIcon,
  TruckIcon,
  WarehouseIcon,
} from "@renderer/components/ui/icons";
import {
  FloatingLayer,
  MenuItem,
  PAGE_SIZE,
  Panel,
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
  stockLines,
  type MovementKind,
  type StockLine,
  type StockMovement,
  type ColorPairs,
} from "@renderer/components/features/wholesale/stock";
import {
  lineRemaining,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/customerOrders";
import {
  intoFinal,
  shipmentPairs,
  type Shipment,
} from "@renderer/components/features/wholesale/shipments";
import { hydrateOrders, useWholesale } from "@renderer/components/features/wholesale/store";
import {
  CUSTOMER_ORDERS_URL,
  WHOLESALE_INVENTORY_URL,
  inventoryMovementsFromWire,
  ordersFromWire,
  type InventoryMovementWire,
} from "@renderer/components/features/wholesale/api";
import {
  formatDate,
  formatQty,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import { formatIn } from "@renderer/components/features/wholesale/units";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/products";
import {
  remainingQty,
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/supplierVouchers";

// What the business is holding, and where. The receiving gate records one delivery at a
// time and never changes again; this screen is the running total across all of them, less
// whatever has gone out — the number a person needs before promising a customer anything.
//
// Everything coming in is worked out from the receivings, so nothing is typed twice: open
// a package at the gate, and its sets are on this screen the same moment. Only what leaves
// is recorded here. Read through React Query (see @renderer/lib/queryClient.ts) rather
// than the hand-rolled useCachedFetch.

const INVENTORY_QUERY_KEY = ["wholesale", "inventory"] as const;
const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;

type View = "list" | "detail";
type InventorySection = "overview" | "locations" | "movement";
type StockStatus =
  | "At Supplier"
  | "In Transit"
  | "At Receiving"
  | "Customer Allocated";
type StatusFilter = StockStatus | "all";
type InventoryHealth = "Healthy" | "Low Stock" | "Out of Stock" | "Overstock";

const LOW_STOCK_THRESHOLD = 20;
const OVERSTOCK_THRESHOLD = 150;
const ESTIMATED_PAIR_PRICE = 19500;

const STOCK_STATUSES: StockStatus[] = [
  "At Supplier",
  "In Transit",
  "At Receiving",
  "Customer Allocated",
];

export default function InventoryPage({
  session,
  onOpenReceiving,
}: {
  session: Session;
  onOpenReceiving: (receivingNo: string) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const {
    data: wire,
    isFetching: isRefreshing,
    isError,
  } = useQuery({
    queryKey: INVENTORY_QUERY_KEY,
    queryFn: () => fetchJson<InventoryMovementWire[]>(WHOLESALE_INVENTORY_URL, session),
  });
  useLoadErrorToast(isError, "wholesale inventory");
  const { data: orderWire, isError: ordersFailed } = useQuery({
    queryKey: ORDERS_QUERY_KEY,
    queryFn: () => fetchJson<CustomerOrder[]>(CUSTOMER_ORDERS_URL, session),
  });
  useLoadErrorToast(ordersFailed, "customer orders for stock records");
  useEffect(() => {
    if (orderWire) hydrateOrders(ordersFromWire(orderWire));
  }, [orderWire]);
  const serverOrders = useMemo(
    () => (orderWire ? ordersFromWire(orderWire) : []),
    [orderWire],
  );
  async function reload(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: INVENTORY_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY }),
    ]);
  }
  // Nothing here is this page's own: stock is what the gate has counted less what has
  // gone out to customers, and both belong to the whole workspace. Customer orders are
  // fetched here so Stock Record can show the current orders waiting on each product.
  const { orders, receivings, outgoing, shipments, vouchers } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<{
    stock_code: string;
    location: string;
  } | null>(null);

  const movements = useMemo(
    () =>
      wire
        ? inventoryMovementsFromWire(wire)
        : [...incomingMovements(receivings), ...outgoing],
    [wire, receivings, outgoing],
  );
  const lines = useMemo(() => stockLines(movements), [movements]);
  const ordersWithAllocations = orderWire ? serverOrders : orders;

  const line =
    selected === null
      ? null
      : (lines.find(
          (entry) =>
            entry.stock_code === selected.stock_code &&
            entry.location === selected.location,
        ) ?? null);

  if (view === "detail" && line) {
    return (
      <StockDetail
        orders={ordersWithAllocations}
        line={line}
        allMovements={movements}
        shipments={shipments}
        vouchers={vouchers}
        movements={movementsFor(movements, line.stock_code, line.location)}
        onOpenReceiving={onOpenReceiving}
        onBack={() => setView("list")}
      />
    );
  }

  return (
    <StockList
      lines={lines}
      orders={ordersWithAllocations}
      movements={movements}
      shipments={shipments}
      vouchers={vouchers}
      onOpen={(stockCode, location) => {
        setSelected({ stock_code: stockCode, location });
        setView("detail");
      }}
      onRefresh={reload}
      refreshing={isRefreshing}
    />
  );
}

function InventorySectionTabs({
  section,
  onChange,
}: {
  section: InventorySection;
  onChange: (section: InventorySection) => void;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Inventory information"
      className="flex items-center gap-1 border-b border-border"
    >
      {(
        [
          ["overview", "Overview"],
          ["locations", "Stock Record"],
          ["movement", "Movement"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={section === value}
          onClick={() => onChange(value)}
          className={cn(
            "-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            section === value
              ? "border-brand text-brand"
              : "border-transparent text-text-muted hover:text-text-primary",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function InventoryRefreshButton({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  return (
    <Button variant="secondary" size="sm" onClick={onRefresh} loading={refreshing}>
      Refresh
    </Button>
  );
}

/** Colour quantities reserved by every other open order's allocation for a stock code.
 * An order is always free to draw on its own allocation, but never on another order's. */
function reservedColorPairsForStockCode(
  orders: CustomerOrder[],
  stockCode: string,
  excludingOrderId: string,
): ColorPairs {
  const reserved: ColorPairs = {};
  for (const other of orders) {
    if (other.order_status === "cancelled" || other.order_id === excludingOrderId) continue;
    for (const line of other.lines) {
      if (line.stock_code !== stockCode) continue;
      for (const [color, pairs] of Object.entries(
        colorPairsForText(line.allocated_color_breakdown ?? "", line.unit),
      )) {
        reserved[color] = (reserved[color] ?? 0) + pairs;
      }
    }
  }
  return reserved;
}

function subtractColorPairs(colors: ColorPairs, reserved: ColorPairs): ColorPairs {
  const result: ColorPairs = {};
  for (const [color, pairs] of Object.entries(colors)) {
    result[color] = Math.max(0, pairs - (reserved[color] ?? 0));
  }
  return result;
}

// ── List ─────────────────────────────────────────────────────────────────────

function StockRowMenu({ onView }: { onView: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
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
        aria-label="Stock actions"
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
            icon={<EyeIcon className="w-4 h-4" />}
            label="View details"
            onClick={() => {
              setOpen(false);
              onView();
            }}
          />
        </FloatingLayer>
      )}
    </div>
  );
}

function StockList({
  lines,
  orders,
  movements,
  shipments,
  vouchers,
  onOpen,
  onRefresh,
  refreshing,
}: {
      lines: StockLine[];
      orders: CustomerOrder[];
      movements: StockMovement[];
      shipments: Shipment[];
      vouchers: SupplierVoucher[];
  onOpen: (stockCode: string, location: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [healthFilter, setHealthFilter] = useState<InventoryHealth | "all">("all");
  const [page, setPage] = useState(1);
  const [section, setSection] = useState<InventorySection>("overview");

  const locations = [...new Set(lines.map((line) => line.location))];

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
        status === "all" ||
        stockStatusForLine(line, orders, movements, shipments, vouchers) === status;
      const matchesHealth =
        healthFilter === "all" || inventoryHealth(line) === healthFilter;
      return matchesQuery && matchesLocation && matchesStatus && matchesHealth;
    });
  }, [
    lines,
    orders,
    movements,
    shipments,
    vouchers,
    search,
    location,
    status,
    healthFilter,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isFiltered =
    search.trim() !== "" ||
    location !== "all" ||
    status !== "all" ||
    healthFilter !== "all";

  function resetFilters(): void {
    setSearch("");
    setLocation("all");
    setStatus("all");
    setHealthFilter("all");
    setPage(1);
  }

  const physicalPairs = lines.reduce(
    (sum, line) => sum + Math.max(0, line.quantity_available_pairs),
    0,
  );
  const gatePairs = movements
    .filter((movement) => movement.movement_type === "in")
    .reduce((sum, movement) => sum + movement.quantity_pairs, 0);
  const allocatedPairsTotal = lines.reduce(
    (sum, line) => sum + allocatedPairs(line, orders),
    0,
  );
  const warehousePairs = Math.max(0, physicalPairs - gatePairs);
  const physicalHealth = lines.filter((line) => line.quantity_available_pairs > 0);
  const lowStockCount = physicalHealth.filter(
    (line) => inventoryHealth(line) === "Low Stock",
  ).length;
  const outOfStockCount = lines.filter(
    (line) => inventoryHealth(line) === "Out of Stock",
  ).length;
  const receivedToday = movements
    .filter((movement) => movement.movement_type === "in" && movement.moved_on === todayIso())
    .reduce((sum, movement) => sum + movement.quantity_pairs, 0);
  const deliveredToday = movements
    .filter((movement) => movement.movement_type === "out" && movement.moved_on === todayIso())
    .reduce((sum, movement) => sum + movement.quantity_pairs, 0);

  return (
    <div className="flex flex-col gap-4">
      <InventorySectionTabs section={section} onChange={setSection} />

      {section === "overview" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-text-primary tracking-tight">Inventory Overview</h2>
              <p className="text-sm text-text-muted mt-0.5">A quick view of stock, availability, and movement.</p>
            </div>
            <InventoryRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
          </div>
          <InventorySummaryCards
            lines={lines}
            orders={orders}
            movements={movements}
            shipments={shipments}
          />
          <InventoryInsights
            physicalPairs={physicalPairs}
            warehousePairs={warehousePairs}
            gatePairs={gatePairs}
            allocatedPairs={allocatedPairsTotal}
            receivedToday={receivedToday}
            deliveredToday={deliveredToday}
            lowStockCount={lowStockCount}
            outOfStockCount={outOfStockCount}
            physicalLines={physicalHealth}
            compact
          />
        </>
      )}

      {section === "locations" && <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Stock Records
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              All inventory items across all locations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InventoryRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
          </div>
        </div>

        <>
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
            <div className="w-full sm:w-[28rem] lg:w-[32rem]">
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
                <option value="all">Any location</option>
                {locations.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-full sm:w-48">
              <Select
                aria-label="Filter by stock status"
                value={status}
                onChange={(event) => {
                  setStatus(event.target.value as StatusFilter);
                  setPage(1);
                }}
              >
                <option value="all">All Stock Status</option>
                {STOCK_STATUSES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>
            <div className="w-full sm:w-48">
              <Select
                aria-label="Filter by stock health"
                value={healthFilter}
                onChange={(event) => {
                  setHealthFilter(event.target.value as InventoryHealth | "all");
                  setPage(1);
                }}
              >
                <option value="all">All stock health</option>
                <option value="Healthy">Healthy</option>
                <option value="Low Stock">Low Stock</option>
                <option value="Out of Stock">Out of Stock</option>
                <option value="Overstock">Overstock</option>
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
                    <Th className="min-w-[12rem]">Product</Th>
                    <Th>Color</Th>
                    <Th className="min-w-[15rem]">Stock</Th>
                    <Th>Location</Th>
                    <Th>Stock Status</Th>
                    <Th>Stock Health</Th>
                    <Th>Last Movement</Th>
                    <Th className="w-12" aria-label="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {visible.map((line) => {
                    const allocated = allocatedPairs(line, orders);
                    const available = Math.max(0, line.quantity_available_pairs - allocated);
                    const stockStatus = stockStatusForLine(line, orders, movements, shipments, vouchers);
                    const health = inventoryHealth(line);
                    const incoming = incomingPairsForLine(line.stock_code, shipments, vouchers);
                    const lastMovement = movementsFor(movements, line.stock_code, line.location)[0];
                    return (
                      <Tr key={`${line.stock_code}@${line.location}`}>
                        <Td>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onOpen(line.stock_code, line.location)}
                                className={cn(
                                  "whitespace-nowrap font-bold text-brand hover:underline underline-offset-2",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                                )}
                              >
                                {line.stock_code || "No stock code"}
                              </button>
                              {line.stock_code && <CopyButton value={line.stock_code} what="stock code" />}
                            </div>
                            <div className="mt-1 max-w-[14rem]">
                              <span className="block truncate text-sm text-text-primary" title={line.description}>
                                {line.description || "—"}
                              </span>
                              <span className="text-xs text-text-muted">{GROUP_LABELS[line.product_group]}</span>
                            </div>
                          </div>
                        </Td>
                        <Td className="font-mono text-xs text-text-secondary">
                          {line.colors || "—"}
                        </Td>
                        <Td>
                          <div className="grid grid-cols-2 text-sm">
                            <div className="border-b border-r border-border p-2">
                              <div className="text-text-muted">On hand</div>
                              <div className="font-semibold tabular-nums text-text-primary">{formatQty(line.quantity_available_pairs)} pairs</div>
                            </div>
                            <div className="border-b border-border p-2">
                              <div className="text-text-muted">Allocated</div>
                              <div className="font-semibold tabular-nums text-purple-500">{formatQty(allocated)} pairs</div>
                            </div>
                            <div className="border-r border-border p-2">
                              <div className="text-text-muted">Available</div>
                              <div className="font-semibold tabular-nums text-success">{formatQty(available)} pairs</div>
                            </div>
                            <div className="p-2">
                              <div className="text-text-muted">Incoming</div>
                              <div className="font-semibold tabular-nums text-warning">{formatQty(incoming)} pairs</div>
                            </div>
                          </div>
                        </Td>
                        <Td className="whitespace-nowrap text-text-secondary">{line.location}</Td>
                        <Td>
                          <StatusPill
                            label={stockStatus}
                            className={STOCK_STATUS_STYLES[stockStatus]}
                          />
                        </Td>
                        <Td><StatusPill label={health} className={HEALTH_STYLES[health]} /></Td>
                        <Td className="text-text-muted whitespace-nowrap">
                          {lastMovement ? formatDate(lastMovement.moved_on) : "—"}
                        </Td>
                        <Td>
                          <StockRowMenu onView={() => onOpen(line.stock_code, line.location)} />
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
      </Panel>}
      {section === "movement" && (
        <InventoryMovementTable
          movements={movements}
          onOpen={onOpen}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      )}
    </div>
  );
}

function InventoryMovementTable({
  movements,
  onOpen,
  onRefresh,
  refreshing,
}: {
  movements: StockMovement[];
  onOpen: (stockCode: string, location: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<MovementKind | "all">("all");
  const [location, setLocation] = useState("all");
  const [page, setPage] = useState(1);
  const locations = [...new Set(movements.map((movement) => movement.location).filter(Boolean))].sort();
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...movements]
      .filter((movement) => {
        const matchesQuery =
          query === "" ||
          movement.stock_code.toLowerCase().includes(query) ||
          movement.description.toLowerCase().includes(query) ||
          movement.location.toLowerCase().includes(query) ||
          movement.reference.toLowerCase().includes(query) ||
          movement.counterparty_name.toLowerCase().includes(query);
        return (
          matchesQuery &&
          (kind === "all" || movement.movement_type === kind) &&
          (location === "all" || movement.location === location)
        );
      })
      .sort((a, b) => (a.moved_on < b.moved_on ? 1 : -1));
  }, [movements, search, kind, location]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function reset(): void {
    setSearch("");
    setKind("all");
    setLocation("all");
    setPage(1);
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-text-primary tracking-tight">Inventory Movement</h2>
          <p className="text-sm text-text-muted mt-0.5">Confirmed stock received and delivered.</p>
        </div>
        <InventoryRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
      </div>
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
        <div className="w-full sm:w-[28rem]">
          <Input
            aria-label="Search inventory movement"
            placeholder="Search product, stock code or reference"
            startIcon={<SearchIcon className="w-4 h-4" />}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            aria-label="Filter movement type"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as MovementKind | "all");
              setPage(1);
            }}
          >
            <option value="all">All movements</option>
            <option value="in">Received</option>
            <option value="out">Delivered</option>
          </Select>
        </div>
        <div className="w-full sm:w-56">
          <Select
            aria-label="Filter movement location"
            value={location}
            onChange={(event) => {
              setLocation(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">Any location</option>
            {locations.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        {(search !== "" || kind !== "all" || location !== "all") && (
          <Button variant="ghost" size="sm" onClick={reset}>Clear filters</Button>
        )}
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon={<InventoryIcon />}
          title="No movements found"
          description="Try a different search or movement type."
          action={(search !== "" || kind !== "all" || location !== "all") ? <Button variant="secondary" onClick={reset}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          <TableContainer className="border-0 rounded-none">
            <Thead>
              <Tr>
                <Th>Date</Th>
                <Th>Product</Th>
                <Th>Color</Th>
                <Th>Movement</Th>
                <Th className="text-right">Qty</Th>
                <Th>Location</Th>
                <Th>Reference</Th>
                <Th>Supplier / Customer</Th>
                <Th className="w-12" aria-label="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {visible.map((movement) => (
                <Tr key={movement.movement_id}>
                  <Td className="text-text-muted whitespace-nowrap">{formatDate(movement.moved_on)}</Td>
                  <Td>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpen(movement.stock_code, movement.location)}
                        className={cn(
                          "font-bold text-brand hover:underline underline-offset-2",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                        )}
                      >
                        {movement.stock_code || "No stock code"}
                      </button>
                      <div className="max-w-[15rem] truncate text-sm text-text-primary" title={movement.description}>
                        {movement.description || "—"}
                      </div>
                      <div className="text-xs text-text-muted">
                        {GROUP_LABELS[movement.product_group]}
                      </div>
                    </div>
                  </Td>
                  <Td className="font-mono text-xs text-text-secondary whitespace-nowrap">
                    {movement.color_breakdown || "—"}
                  </Td>
                  <Td>
                    <StatusPill
                      label={movement.movement_type === "in" ? "Received" : "Delivered"}
                      className={movement.movement_type === "in" ? "bg-success text-white" : "bg-brand text-white"}
                    />
                  </Td>
                  <Td className="text-right font-semibold tabular-nums whitespace-nowrap">
                    <span className={movement.movement_type === "in" ? "text-success" : "text-error"}>
                      {movement.movement_type === "in" ? "+" : "−"}{formatQty(movement.quantity_pairs)} pairs
                    </span>
                  </Td>
                  <Td className="text-text-secondary whitespace-nowrap">{movement.location}</Td>
                  <Td className="text-text-muted whitespace-nowrap">{movement.reference || "—"}</Td>
                  <Td className="text-text-secondary">{movement.counterparty_name || "—"}</Td>
                  <Td><StockRowMenu onView={() => onOpen(movement.stock_code, movement.location)} /></Td>
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
    </Panel>
  );
}

interface InventorySummaryRow {
  label: string;
  detail: string;
  pairs: number;
  tone: "green" | "blue" | "orange" | "purple" | "gray";
}

function inventoryHealth(line: StockLine): InventoryHealth {
  const onHand = Math.max(0, line.quantity_available_pairs);
  if (onHand <= 0) return "Out of Stock";
  if (onHand > OVERSTOCK_THRESHOLD) return "Overstock";
  if (onHand < LOW_STOCK_THRESHOLD) return "Low Stock";
  return "Healthy";
}

function isReceivingGateLine(line: StockLine, movements: StockMovement[]): boolean {
  return movements.some(
    (movement) =>
      movement.movement_type === "in" && movement.location === line.location,
  );
}

const STOCK_STATUS_STYLES: Record<StockStatus, string> = {
  "At Supplier": "bg-text-secondary text-bg-base",
  "In Transit": "bg-warning text-white",
  "At Receiving": "bg-brand text-white",
  "Customer Allocated": "bg-purple-400 text-white",
};

function stockStatusForLine(
  line: StockLine,
  orders: CustomerOrder[],
  movements: StockMovement[],
  shipments: Shipment[],
  vouchers: SupplierVoucher[],
): StockStatus {
  const allocated = allocatedPairs(line, orders);
  if (allocated > 0 && allocated >= line.quantity_available_pairs) {
    return "Customer Allocated";
  }
  if (isReceivingGateLine(line, movements)) return "At Receiving";
  const openVoucherNos = new Set(
    vouchers
      .filter(
        (voucher) =>
          remainingQty(voucher) > 0 &&
          voucher.lines.some((entry) => entry.stock_code === line.stock_code),
      )
      .map((voucher) => voucher.voucher_no),
  );
  let inTransit = false;
  for (const shipment of shipments) {
    if (!openVoucherNos.has(shipment.voucher_no)) continue;
    const reachedFinal = Math.min(intoFinal(shipment), shipment.final_received_packages);
    if (shipment.total_packages > shipment.packages_sent_by_cargo) return "At Supplier";
    if (shipment.packages_sent_by_cargo > reachedFinal) inTransit = true;
  }
  if (inTransit) return "In Transit";
  return "At Receiving";
}

function incomingPairsForLine(
  stockCode: string,
  shipments: Shipment[],
  vouchers: SupplierVoucher[],
): number {
  const openVoucherNos = new Set(
    shipments
      .filter((shipment) => shipment.final_received_packages < shipment.total_packages)
      .map((shipment) => shipment.voucher_no),
  );
  return vouchers.reduce((sum, voucher) => {
    if (!openVoucherNos.has(voucher.voucher_no)) return sum;
    const line = voucher.lines.find((entry) => entry.stock_code === stockCode);
    if (!line) return sum;
    const remaining = remainingQty(voucher);
    if (remaining <= 0 || voucher.total_quantity_pairs <= 0) return sum;
    return sum + Math.round((line.quantity_pairs * remaining) / voucher.total_quantity_pairs);
  }, 0);
}

const HEALTH_STYLES: Record<InventoryHealth, string> = {
  Healthy: "bg-success text-white",
  "Low Stock": "bg-warning text-white",
  "Out of Stock": "bg-error text-white",
  Overstock: "bg-brand text-white",
};

function InventoryInsights({
  physicalPairs,
  warehousePairs,
  gatePairs,
  allocatedPairs: allocated,
  receivedToday,
  deliveredToday,
  lowStockCount,
  outOfStockCount,
  physicalLines,
  compact,
}: {
  physicalPairs: number;
  warehousePairs: number;
  gatePairs: number;
  allocatedPairs: number;
  receivedToday: number;
  deliveredToday: number;
  lowStockCount: number;
  outOfStockCount: number;
  physicalLines: StockLine[];
  compact?: boolean;
}): React.JSX.Element {
  const counts: Record<InventoryHealth, number> = {
    Healthy: physicalLines.filter((line) => inventoryHealth(line) === "Healthy").length,
    "Low Stock": lowStockCount,
    "Out of Stock": outOfStockCount,
    Overstock: physicalLines.filter((line) => inventoryHealth(line) === "Overstock").length,
  };
  const total = Math.max(1, physicalLines.length);
  const value = physicalPairs * ESTIMATED_PAIR_PRICE;
  const fmtValue = (amount: number): string =>
    amount >= 1_000_000
      ? `${(amount / 1_000_000).toFixed(1)}M MMK`
      : `${Math.round(amount / 1_000)}K MMK`;
  const healthRows: { label: InventoryHealth; color: string; text: string }[] = [
    { label: "Healthy", color: "bg-success", text: "text-success" },
    { label: "Low Stock", color: "bg-warning", text: "text-warning" },
    { label: "Out of Stock", color: "bg-error", text: "text-error" },
  ];

  if (compact) {
    return (
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Panel className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-text-primary">Inventory value</h3>
              <p className="mt-0.5 text-xs text-text-muted">Physical stock value.</p>
            </div>
            <div className="text-right">
              <div className="text-2xl font-extrabold text-brand">{fmtValue(value)}</div>
            </div>
          </div>
        </Panel>
        <Panel className="p-5">
          <h3 className="text-base font-bold text-text-primary">Stock health</h3>
          <div className="mt-4 space-y-2.5">
            {healthRows.map((row) => {
              const count = counts[row.label];
              const pct = Math.round((count / total) * 100);
              return (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-text-muted">{row.label}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg-subtle">
                    <div className={cn("h-full rounded-full", row.color)} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={cn("w-16 text-right text-xs font-bold", row.text)}>{formatQty(count)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-text-muted">{formatQty(physicalLines.length)} physical stock SKUs</p>
        </Panel>
      </div>
    );
  }

  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div>
            <h3 className="text-base font-bold text-text-primary">Inventory Value</h3>
            <p className="mt-0.5 text-xs text-text-muted">
              Physical stock value based on warehouse holdings. Management reference only.
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-extrabold text-brand">{fmtValue(value)}</div>
          </div>
        </div>
        <div className="grid gap-3 border-t border-border p-4 sm:grid-cols-3 sm:p-5">
          {[
            ["Warehouse Stock Value", warehousePairs, "text-success"],
              ["At Receiving Stock Value", gatePairs, "text-brand"],
            ["Allocated Stock Value", allocated, "text-purple-500"],
          ].map(([label, pairs, color]) => (
            <div key={String(label)} className="rounded-xl border border-border bg-bg-subtle px-4 py-3">
              <div className="mb-1 text-xs text-text-muted">{label}</div>
              <div className={cn("text-lg font-extrabold", String(color))}>
                {fmtValue(Number(pairs) * ESTIMATED_PAIR_PRICE)}
              </div>
              <div className="text-xs text-text-muted">{formatQty(Number(pairs))} pairs × 19.5K est.</div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel className="p-4 sm:p-5">
          <h3 className="mb-3 text-base font-bold text-text-primary">Inventory Health Overview</h3>
          <div className="space-y-2.5">
            {healthRows.map((row) => {
              const count = counts[row.label];
              const pct = Math.round((count / total) * 100);
              return (
                <div key={row.label} className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-xs text-text-muted">{row.label}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-bg-subtle">
                    <div className={cn("h-full rounded-full", row.color)} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={cn("w-20 text-right text-xs font-bold", row.text)}>
                    {pct}% ({formatQty(count)})
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-text-muted">Based on {formatQty(physicalLines.length)} physical stock SKUs.</p>
        </Panel>

        <Panel className="p-4 sm:p-5">
          <h3 className="mb-3 text-base font-bold text-text-primary">Today&apos;s Inventory Movement</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["Received", receivedToday, "text-success", "+"],
              ["Delivered", deliveredToday, "text-error", "−"],
              ["Net Change", receivedToday - deliveredToday, "text-brand", receivedToday >= deliveredToday ? "+" : "−"],
            ].map(([label, amount, color, sign]) => (
              <div key={String(label)} className="rounded-xl border border-border bg-bg-subtle p-4 text-center">
                <div className={cn("text-xs font-semibold uppercase tracking-wide", String(color))}>{label}</div>
                <div className={cn("mt-1 text-2xl font-extrabold", String(color))}>
                  {sign}{formatQty(Math.abs(Number(amount)))}
                </div>
                <div className="text-xs text-text-muted">pairs {label === "Net Change" ? "net today" : String(label).toLowerCase()}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs italic text-text-muted">Confirmed transactions only.</p>
        </Panel>
      </div>
    </>
  );
}

function pairsForShipmentStage(
  shipment: Shipment,
  packages: number,
): number {
  if (packages <= 0 || shipment.total_packages <= 0) return 0;
  return Math.round(
    (shipmentPairs(shipment) * Math.max(0, packages)) / shipment.total_packages,
  );
}

function InventorySummaryCards({
  lines,
  orders,
  movements,
  shipments,
}: {
  lines: StockLine[];
  orders: CustomerOrder[];
  movements: StockMovement[];
  shipments: Shipment[];
}): React.JSX.Element {
  const physicalRows = lines
    .filter((line) => line.quantity_available_pairs > 0)
    .reduce<{ location: string; pairs: number; gate: boolean }[]>((rows, line) => {
      const existing = rows.find((row) => row.location === line.location);
      const gate = movements.some(
        (movement) =>
          movement.movement_type === "in" && movement.location === line.location,
      );
      if (existing) existing.pairs += line.quantity_available_pairs;
      else rows.push({ location: line.location, pairs: line.quantity_available_pairs, gate });
      return rows;
    }, [])
    .sort((a, b) => b.pairs - a.pairs);
  const physicalPairs = physicalRows.reduce((sum, row) => sum + row.pairs, 0);
  const emptyLocations = lines.filter((line) => line.quantity_available_pairs <= 0).length;

  const atSupplierPairs = shipments.reduce(
    (sum, shipment) =>
      sum + pairsForShipmentStage(
        shipment,
        Math.max(0, shipment.total_packages - shipment.packages_sent_by_cargo),
      ),
    0,
  );
  const inTransitPairs = shipments.reduce((sum, shipment) => {
    const reachedFinal = Math.min(
      intoFinal(shipment),
      shipment.final_received_packages,
    );
    return sum + pairsForShipmentStage(shipment, shipment.packages_sent_by_cargo - reachedFinal);
  }, 0);
  const receivingGatePairs = movements
    .filter((movement) => movement.movement_type === "in")
    .reduce((sum, movement) => sum + movement.quantity_pairs, 0);
  const committedPairs = lines.reduce(
    (sum, line) => sum + allocatedPairs(line, orders),
    0,
  );
  const incomingRows: InventorySummaryRow[] = [
    {
      label: "At Supplier",
      detail: "Not yet shipped",
      pairs: atSupplierPairs,
      tone: "gray",
    },
    {
      label: "In Transit",
      detail: "Currently moving between locations",
      pairs: inTransitPairs,
      tone: "orange",
    },
    {
      label: "At Receiving",
      detail: "Physically received at gate",
      pairs: receivingGatePairs,
      tone: "blue",
    },
    {
      label: "Customer Allocated",
      detail: "Reserved for customers",
      pairs: committedPairs,
      tone: "purple",
    },
  ];
  const incomingCommittedPairs = incomingRows.reduce((sum, row) => sum + row.pairs, 0);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SummaryCard
        title="Physical Stock"
        description="Goods physically present at controlled locations."
        total={physicalPairs}
        icon={<WarehouseIcon className="h-6 w-6" />}
        iconClassName="bg-success-subtle text-success"
        totalClassName="text-success"
      >
        <div className="divide-y divide-border border-t border-border">
          {physicalRows.slice(0, 6).map((row) => (
            <div key={row.location} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className={cn("h-3 w-3 shrink-0 rounded-full", row.gate ? "bg-brand" : "bg-success")} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary sm:text-base">
                {row.location}
              </span>
              <span className="shrink-0 rounded-full bg-bg-subtle px-3 py-1 text-xs font-medium text-text-muted">
              {row.gate ? "At Receiving" : "Warehouse"}
            </span>
              <span className="shrink-0 text-right text-sm font-bold tabular-nums text-text-primary sm:text-base">
                {formatQty(row.pairs)} pairs
              </span>
            </div>
          ))}
          {emptyLocations > 0 && (
            <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-text-muted sm:px-5">
              <span className="text-lg leading-none">⌄</span>
              Show all locations ({formatQty(emptyLocations)} empty)
            </div>
          )}
        </div>
      </SummaryCard>

      <SummaryCard
        title="Incoming & Committed Stock"
        description="Stock not yet in warehouse or reserved for customers."
        total={incomingCommittedPairs}
        icon={<TruckIcon className="h-6 w-6" />}
        iconClassName="bg-brand-subtle text-brand"
        totalClassName="text-brand"
      >
        <div className="border-t border-border">
          <div className="px-5 pb-1 pt-4 text-xs font-bold uppercase tracking-widest text-text-muted sm:px-6">
            Incoming
          </div>
          {incomingRows.slice(0, 3).map((row) => (
            <SummaryRow key={row.label} row={row} />
          ))}
          <div className="border-t border-border px-5 pb-1 pt-4 text-xs font-bold uppercase tracking-widest text-text-muted sm:px-6">
            Committed
          </div>
          <SummaryRow row={incomingRows[3]} />
        </div>
      </SummaryCard>
    </div>
  );
}

function SummaryCard({
  title,
  description,
  total,
  icon,
  iconClassName,
  totalClassName,
  children,
}: {
  title: string;
  description: string;
  total: number;
  icon: React.ReactNode;
  iconClassName: string;
  totalClassName: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-bg-base shadow-sm">
      <div className="flex items-start gap-3 px-4 py-4 sm:px-5 sm:py-5">
        <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", iconClassName)}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold tracking-tight text-text-primary sm:text-base">{title}</h2>
          <p className="mt-0.5 text-xs text-text-muted sm:text-sm">{description}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("text-xl font-bold leading-none tabular-nums sm:text-2xl", totalClassName)}>
            {formatQty(total)}
          </div>
          <div className="mt-1 text-sm text-text-muted">total pairs</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function SummaryRow({ row }: { row: InventorySummaryRow }): React.JSX.Element {
  const dotClass = {
    green: "bg-success",
    blue: "bg-brand",
    orange: "bg-warning",
    purple: "bg-purple-400",
    gray: "bg-text-muted",
  }[row.tone];
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 sm:px-5">
      <span className={cn("h-3 w-3 shrink-0 rounded-full", dotClass)} />
      <span className="min-w-0 flex-1 text-sm font-semibold text-text-primary">{row.label}</span>
      <span className="hidden text-xs italic text-text-muted md:block">{row.detail}</span>
      <span className="shrink-0 text-sm font-bold tabular-nums text-text-primary">
        {formatQty(row.pairs)} pairs
      </span>
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

const MOVEMENT_LABELS: Record<StockMovement["movement_type"], string> = {
  in: "Received",
  out: "Delivered",
};

const MOVEMENT_STYLES: Record<StockMovement["movement_type"], string> = {
  in: "bg-success text-white",
  out: "bg-brand text-white",
};

const RELATED_ORDER_STATUS_LABELS: Record<
  CustomerOrder["order_status"],
  string
> = {
  new: "New",
  allocating: "Allocating",
  ready_to_deliver: "Ready to deliver",
  partly_delivered: "Partially delivered",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

const RELATED_ORDER_STATUS_STYLES: Record<
  CustomerOrder["order_status"],
  string
> = {
  new: "bg-text-secondary text-white",
  allocating: "bg-warning text-white",
  ready_to_deliver: "bg-brand text-white",
  partly_delivered: "bg-warning text-white",
  fulfilled: "bg-success text-white",
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
        ordered: lines.reduce((sum, line) => sum + line.quantity_pairs, 0),
        received: lines.reduce((sum, line) => sum + line.delivered_quantity_pairs, 0),
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
      movement.movement_type === "out" &&
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

function formatColorPairs(quantity_pairs: ColorPairs): string {
  return Object.entries(quantity_pairs)
    .filter(([, quantity]) => quantity > 0)
    .map(([color, quantity]) =>
      quantity % 6 === 0 ? `${color}${quantity / 6}s` : `${color}${quantity}p`,
    )
    .join(", ");
}

function StockDetail({
  line,
  orders,
  allMovements,
  shipments,
  vouchers,
  onOpenReceiving,
  movements,
  onBack,
}: {
  line: StockLine;
  orders: CustomerOrder[];
  allMovements: StockMovement[];
  shipments: Shipment[];
  vouchers: SupplierVoucher[];
  onOpenReceiving: (receivingNo: string) => void;
  movements: StockMovement[];
  onBack: () => void;
}): React.JSX.Element {
  const allocated = allocatedPairs(line, orders);
  const available = Math.max(0, line.quantity_available_pairs - allocated);
  const incoming = incomingPairsForLine(line.stock_code, shipments, vouchers);
  const stockStatus = stockStatusForLine(line, orders, movements, shipments, vouchers);
  const health = inventoryHealth(line);
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
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Stock status
                </span>
                <StatusPill
                  label={stockStatus}
                  className={STOCK_STATUS_STYLES[stockStatus]}
                />
                <span className="ml-1 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Stock health
                </span>
                <StatusPill label={health} className={HEALTH_STYLES[health]} />
              </div>
            </div>
            <p className="mt-0.5 truncate text-sm text-text-muted">
              {line.description} · {GROUP_LABELS[line.product_group]}
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
                  Inventory
                </h3>
                <dl className="grid gap-3 sm:grid-cols-2">
                  <ReadOnlyField label="Location" value={line.location} wrap />
                  <ReadOnlyField
                    label="On hand"
                    value={formatIn(line.quantity_available_pairs, "set")}
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
                    label="Incoming"
                    value={formatIn(incoming, "set")}
                  />
                  <ReadOnlyField
                    label="Last moved"
                    value={formatDate(line.last_moved_on)}
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
                  <Th className="whitespace-nowrap">Order</Th>
                  <Th>Date</Th>
                  <Th>Product</Th>
                  <Th>Ordered colors</Th>
                  <Th>Stock colors</Th>
                  <Th className="text-right whitespace-nowrap">Ordered qty</Th>
                  <Th className="text-right whitespace-nowrap">Received qty</Th>
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
                      colSpan={9}
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
                          reservedColorPairsForStockCode(orders, line.stock_code, order.order_id),
                        ),
                        allMovements,
                      );
                      return (
                        <Tr key={order.order_id}>
                          <Td className="whitespace-nowrap">
                            <Reference value={order.order_no} what="order no." />
                            <span className="mt-0.5 block text-sm text-text-secondary">
                              {order.customer_name}
                            </span>
                          </Td>
                          <Td className="whitespace-nowrap text-text-muted">{formatDate(order.order_date)}</Td>
                          <Td className="pl-8">
                              <div className="font-bold text-brand">{line.stock_code}</div>
                              <div className="max-w-[15rem] truncate text-sm text-text-primary" title={line.description}>
                                {line.description || "—"}
                              </div>
                              <div className="text-xs text-text-muted">{GROUP_LABELS[line.product_group]}</div>
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
                              label={
                                RELATED_ORDER_STATUS_LABELS[order.order_status]
                              }
                              className={
                                RELATED_ORDER_STATUS_STYLES[order.order_status]
                              }
                            />
                          </Td>
                        </Tr>
                      );
                    },
                    )}
                    <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                      <Td colSpan={5} className="text-right font-semibold text-text-primary">
                        Total
                      </Td>
                      <Td className="text-right font-bold tabular-nums">
                        {formatIn(relatedOrderTotals.ordered, "set")}
                      </Td>
                      <Td className="text-right font-bold tabular-nums">
                        {formatIn(relatedOrderTotals.received, "set")}
                      </Td>
                      <Td className="text-right font-bold tabular-nums whitespace-nowrap">
                        {formatIn(relatedOrderTotals.remaining, "set")}
                      </Td>
                      <Td />
                    </Tr>
                  </>
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
                  <Th>Product</Th>
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
                {movements.map((movement) => (
                  <Tr key={movement.movement_id}>
                    <Td className="text-text-muted whitespace-nowrap">
                      {formatDate(movement.moved_on)}
                    </Td>
                    <Td>
                      <div className="min-w-0">
                        <div className="font-bold text-brand">{movement.stock_code || "No stock code"}</div>
                        <div className="max-w-[15rem] truncate text-sm text-text-primary" title={movement.description}>
                          {movement.description || "—"}
                        </div>
                        <div className="text-xs text-text-muted">
                          {GROUP_LABELS[movement.product_group]}
                        </div>
                      </div>
                    </Td>
                    <Td className="font-mono text-xs text-text-secondary whitespace-nowrap">
                      {movement.color_breakdown || "—"}
                    </Td>
                    <Td>
                      <StatusPill
                        label={MOVEMENT_LABELS[movement.movement_type]}
                        className={MOVEMENT_STYLES[movement.movement_type]}
                      />
                    </Td>
                    <Td
                      className={cn(
                        "text-right tabular-nums font-semibold whitespace-nowrap",
                        movement.movement_type === "in" ? "text-success" : "text-error",
                      )}
                    >
                      {movement.movement_type === "in" ? "+" : "−"}
                      {formatQty(movement.quantity_pairs)} pairs
                    </Td>
                    <Td className="text-text-secondary whitespace-nowrap">{movement.location}</Td>
                    <Td className="text-text-muted whitespace-nowrap">{movement.reference || "—"}</Td>
                    <Td className="text-text-secondary">{movement.counterparty_name || "—"}</Td>
                    <Td className="text-center whitespace-nowrap">
                      {movement.movement_type === "in" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onOpenReceiving(movement.reference)}
                        >
                          Open receiving
                        </Button>
                      ) : null}
                    </Td>
                  </Tr>
                ))}
                <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                  <Td className="font-semibold" colSpan={4}>
                    Total stock now
                  </Td>
                  <Td className="text-right tabular-nums font-semibold whitespace-nowrap">
                    {formatQty(line.quantity_available_pairs)} pairs
                  </Td>
                  <Td colSpan={4} className="text-text-muted">
                    {formatQty(line.quantity_in_pairs)} pairs received, {formatQty(line.quantity_out_pairs)} pairs sent out
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

/** The colours this order asked for of one stock code — what to look for when the boxes
 *  are opened, rather than having to go back to the order to find out. */
function colorsWanted(order: CustomerOrder, stockCode: string): string {
  const colors = order.lines
    .filter((line) => line.stock_code === stockCode)
    .map((line) => line.color_breakdown)
    .filter((color) => color.trim() !== "");
  return colors.join(",") || "—";
}
