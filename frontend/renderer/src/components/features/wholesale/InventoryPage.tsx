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
  stockLines,
  type MovementKind,
  type StockLine,
  type StockRecord,
  type StockMovement,
  type ColorPairs,
} from "@renderer/components/features/wholesale/stock";
import {
  lineRemaining,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/customerOrders";
import { type Shipment } from "@renderer/components/features/wholesale/shipments";
import { hydrateOrders, useWholesale } from "@renderer/components/features/wholesale/store";
import {
  CUSTOMER_ORDERS_URL,
  WHOLESALE_INVENTORY_URL,
  WHOLESALE_STOCK_URL,
  inventoryMovementsFromWire,
  ordersFromWire,
  stockRecordsFromWire,
  type InventoryMovementWire,
  type StockRecordWire,
} from "@renderer/components/features/wholesale/api";
import {
  formatDate,
  formatQty,
} from "@renderer/components/features/wholesale/shared";
import { formatSets } from "@renderer/components/features/wholesale/units";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/products";
import {
  remainingQty,
  type SupplierVoucher,
} from "@renderer/components/features/wholesale/supplierVouchers";

// Stock Records is the running product-level picture across supplier vouchers, shipments,
// receivings, customer orders and deliveries. The server computes the pipeline figures;
// the legacy movement query remains for the Movement tab and offline fallback.

const INVENTORY_QUERY_KEY = ["wholesale", "inventory"] as const;
const STOCK_QUERY_KEY = ["wholesale", "stock"] as const;
const ORDERS_QUERY_KEY = ["wholesale", "orders"] as const;

type View = "list" | "detail";
type InventorySection = "overview" | "locations" | "movement";
type StockStatus =
  | "At Supplier"
  | "In Transit"
  | "At Receiving"
  | "Customer Allocated"
  | "Customer Ordered"
  | "Finished";
type StatusFilter = StockStatus | "all";
type InventoryHealth =
  | "Healthy"
  | "Low Stock"
  | "Out of Stock"
  | "Overstock"
  | "Not arrived yet";

const LOW_STOCK_THRESHOLD = 20;
const OVERSTOCK_THRESHOLD = 150;
const ESTIMATED_PAIR_PRICE = 19500;

const STOCK_STATUSES: StockStatus[] = [
  "At Supplier",
  "In Transit",
  "At Receiving",
  "Customer Allocated",
  "Customer Ordered",
  "Finished",
];

export default function InventoryPage({
  session,
  onOpenReceiving,
  initialStockCode,
  onInitialStockOpened,
}: {
  session: Session;
  onOpenReceiving: (receivingNo: string) => void;
  initialStockCode?: string | null;
  onInitialStockOpened?: () => void;
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
  const {
    data: stockWire,
    isFetching: isStockRefreshing,
    isError: stockFailed,
  } = useQuery({
    queryKey: STOCK_QUERY_KEY,
    queryFn: () => fetchJson<StockRecordWire[]>(WHOLESALE_STOCK_URL, session),
  });
  useLoadErrorToast(stockFailed, "wholesale stock records");
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
      queryClient.invalidateQueries({ queryKey: STOCK_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: ORDERS_QUERY_KEY }),
    ]);
  }
  // Nothing here is this page's own: stock is what the gate has counted less what has
  // gone out to customers, and both belong to the whole workspace. Customer orders are
  // fetched here so Stock Record can show the current orders waiting on each product.
  const { orders, receivings, outgoing, shipments, vouchers } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selected, setSelected] = useState<string | null>(null);

  const movements = useMemo(
    () =>
      wire
        ? inventoryMovementsFromWire(wire)
        : [...incomingMovements(receivings), ...outgoing],
    [wire, receivings, outgoing],
  );
  const lines = useMemo(() => stockLines(movements), [movements]);
  const ordersWithAllocations = orderWire ? serverOrders : orders;
  const records = useMemo(
    () =>
      stockWire
        ? stockRecordsFromWire(stockWire)
        : legacyStockRecords(lines, ordersWithAllocations, movements, shipments, vouchers),
    [stockWire, lines, ordersWithAllocations, movements, shipments, vouchers],
  );

  const { data: detailMovementWire } = useQuery({
    queryKey: ["wholesale", "movements", selected],
    enabled: selected !== null,
    queryFn: () =>
      fetchJson<InventoryMovementWire[]>(
        `${WHOLESALE_INVENTORY_URL}/movements/${encodeURIComponent(selected ?? "")}`,
        session,
      ),
  });

  const record =
    selected === null
      ? null
      : (records.find((entry) => entry.stock_code === selected) ?? null);

  useEffect(() => {
    if (!initialStockCode || selected || (!wire && !isError)) return;
    const target = records.find((entry) => entry.stock_code === initialStockCode);
    if (!target) {
      onInitialStockOpened?.();
      return;
    }
    setSelected(target.stock_code);
    onInitialStockOpened?.();
  }, [initialStockCode, isError, records, onInitialStockOpened, selected, wire]);

  if (view === "detail" && record) {
    return (
      <StockDetail
        orders={ordersWithAllocations}
        record={record}
        allMovements={movements}
        movements={
          detailMovementWire
            ? inventoryMovementsFromWire(detailMovementWire)
            : movements.filter((movement) => movement.stock_code === record.stock_code)
        }
        onOpenReceiving={onOpenReceiving}
        onBack={() => setView("list")}
      />
    );
  }

  return (
    <StockList
      records={records}
      movements={movements}
      onOpen={(stockCode) => {
        setSelected(stockCode);
        setView("detail");
      }}
      onRefresh={reload}
      refreshing={isRefreshing || isStockRefreshing}
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
        colorPairsForText(line.allocated_color_breakdown ?? "", line.unit, line.unit_conversions),
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
  records,
  movements,
  onOpen,
  onRefresh,
  refreshing,
}: {
      records: StockRecord[];
      movements: StockMovement[];
  onOpen: (stockCode: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [source, setSource] = useState("all");
  const [healthFilter, setHealthFilter] = useState<InventoryHealth | "all">("all");
  const [page, setPage] = useState(1);
  const [section, setSection] = useState<InventorySection>("overview");

  const locations = [...new Set(records.flatMap((record) => record.locations.map((entry) => entry.location)))].sort();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => {
      const matchesQuery =
        query === "" ||
        record.stock_code.toLowerCase().includes(query) ||
        record.description.toLowerCase().includes(query) ||
        record.colors.toLowerCase().includes(query) ||
        record.locations.some((entry) => entry.location.toLowerCase().includes(query)) ||
        [
          ...record.voucher_nos,
          ...record.shipment_nos,
          ...record.order_nos,
          ...record.receiving_nos,
        ].some((reference) => reference.toLowerCase().includes(query));
      const matchesLocation = location === "all" || record.locations.some((entry) => entry.location === location);
      const matchesStatus = status === "all" || record.status === status;
      const matchesSource = source === "all" || record.sources.includes(source);
      const matchesHealth =
        healthFilter === "all" || inventoryHealth(record) === healthFilter;
      return matchesQuery && matchesLocation && matchesStatus && matchesSource && matchesHealth;
    });
  }, [
    records,
    search,
    location,
    status,
    source,
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
    source !== "all" ||
    healthFilter !== "all";

  function resetFilters(): void {
    setSearch("");
    setLocation("all");
    setStatus("all");
    setSource("all");
    setHealthFilter("all");
    setPage(1);
  }

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
            records={records}
          />
          <InventoryInsights records={records} compact />
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
                <option value="Not arrived yet">Not arrived yet</option>
              </Select>
            </div>
            <div className="w-full sm:w-56">
              <Select
                aria-label="Filter by source"
                value={source}
                onChange={(event) => {
                  setSource(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">Anywhere</option>
                <option value="voucher">On a supplier voucher</option>
                <option value="shipment">On a shipment</option>
                <option value="order">On a customer order</option>
                <option value="receiving">Received</option>
                <option value="delivery">Delivered</option>
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
                  : "Products appear here as soon as they are on a supplier voucher, a shipment or a customer order — not only once they arrive."
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
                    <Th>Available</Th>
                    <Th>Color</Th>
                    <Th>Stock Status</Th>
                    <Th>Stock Health</Th>
                    <Th>Last moved</Th>
                    <Th className="w-12" aria-label="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {visible.map((record) => {
                    const health = inventoryHealth(record);
                    return (
                      <Tr key={record.stock_code}>
                        <Td>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onOpen(record.stock_code)}
                                className={cn(
                                  "whitespace-nowrap font-bold text-brand hover:underline underline-offset-2",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                                )}
                              >
                                {record.stock_code || "No stock code"}
                              </button>
                              {record.stock_code && <CopyButton value={record.stock_code} what="stock code" />}
                            </div>
                            <div className="mt-1 max-w-[14rem]">
                              <span className="block truncate text-sm text-text-primary" title={record.description}>
                                {record.description || "—"}
                              </span>
                              <span className="text-xs text-text-muted">{GROUP_LABELS[record.product_group]}</span>
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <div className="text-xs text-text-muted">Available</div>
                          <div className="font-semibold tabular-nums text-success">
                            {formatSets(record.available_pairs)}
                          </div>
                        </Td>
                        <Td className="font-mono text-xs text-text-secondary whitespace-nowrap">
                          {record.colors || "—"}
                        </Td>
                        <Td>
                          <StatusPill
                            label={record.status}
                            className={STOCK_STATUS_STYLES[record.status as StockStatus] ?? "bg-text-secondary text-white"}
                          />
                        </Td>
                        <Td><StatusPill label={health} className={HEALTH_STYLES[health]} /></Td>
                        <Td className="text-text-muted whitespace-nowrap">
                          {record.last_activity_on ? formatDate(record.last_activity_on) : "—"}
                        </Td>
                        <Td>
                          <StockRowMenu onView={() => onOpen(record.stock_code)} />
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
  onOpen: (stockCode: string) => void;
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
                        onClick={() => onOpen(movement.stock_code)}
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
                      {movement.movement_type === "in" ? "+" : "−"}{formatSets(movement.quantity_pairs)}
                    </span>
                  </Td>
                  <Td className="text-text-secondary whitespace-nowrap">{movement.location}</Td>
                  <Td className="text-text-muted whitespace-nowrap">{movement.reference || "—"}</Td>
                  <Td className="text-text-secondary">{movement.counterparty_name || "—"}</Td>
                  <Td><StockRowMenu onView={() => onOpen(movement.stock_code)} /></Td>
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

function inventoryHealth(record: StockRecord | StockLine): InventoryHealth {
  const onHand = "on_hand_pairs" in record
    ? Math.max(0, record.on_hand_pairs)
    : Math.max(0, record.quantity_available_pairs);
  if (onHand <= 0) {
    return "on_hand_pairs" in record && !record.has_receiving_history
      ? "Not arrived yet"
      : "Out of Stock";
  }
  if (onHand > OVERSTOCK_THRESHOLD) return "Overstock";
  if (onHand < LOW_STOCK_THRESHOLD) return "Low Stock";
  return "Healthy";
}

const STOCK_STATUS_STYLES: Record<StockStatus, string> = {
  "At Supplier": "bg-text-secondary text-bg-base",
  "In Transit": "bg-warning text-white",
  "At Receiving": "bg-brand text-white",
  "Customer Allocated": "bg-purple-400 text-white",
  "Customer Ordered": "bg-error text-white",
  Finished: "bg-text-secondary text-white",
};

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
  "Not arrived yet": "bg-text-secondary text-white",
};

function legacyLineFromRecord(record: StockRecord): StockLine {
  const firstLocation = record.locations[0];
  return {
    stock_code: record.stock_code,
    description: record.description,
    product_group: record.product_group,
    location: firstLocation?.location ?? "",
    quantity_in_pairs: record.on_hand_pairs + record.delivered_pairs,
    quantity_out_pairs: record.delivered_pairs,
    quantity_available_pairs: record.on_hand_pairs,
    last_moved_on: record.last_activity_on ?? "",
    colors: record.colors,
    color_quantities_pairs: record.color_quantities_pairs,
  };
}

/** Keep a useful picture on screen when the stock endpoint has not resolved yet.
 * This deliberately mirrors only the old, locally available data; once the server
 * response arrives it replaces these approximations with authoritative figures. */
function legacyStockRecords(
  lines: StockLine[],
  orders: CustomerOrder[],
  movements: StockMovement[],
  shipments: Shipment[],
  vouchers: SupplierVoucher[],
): StockRecord[] {
  const byCode = new Map<string, StockLine>();
  const ensure = (stockCode: string, line?: Partial<StockLine>): StockLine => {
    const existing = byCode.get(stockCode);
    if (existing) return existing;
    const created: StockLine = {
      stock_code: stockCode,
      description: line?.description ?? "",
      product_group: line?.product_group ?? "man",
      location: line?.location ?? "",
      quantity_in_pairs: line?.quantity_in_pairs ?? 0,
      quantity_out_pairs: line?.quantity_out_pairs ?? 0,
      quantity_available_pairs: line?.quantity_available_pairs ?? 0,
      last_moved_on: line?.last_moved_on ?? "",
      colors: line?.colors ?? "",
      color_quantities_pairs: line?.color_quantities_pairs ?? {},
    };
    byCode.set(stockCode, created);
    return created;
  };
  lines.forEach((line) => ensure(line.stock_code, line));
  vouchers.forEach((voucher) => voucher.lines.forEach((line) => {
    const colors = colorPairsForText(line.color_breakdown, line.unit, line.unit_conversions);
    ensure(line.stock_code, {
      description: line.description,
      product_group: line.product_group,
      colors: formatColorPairs(colors),
      color_quantities_pairs: colors,
    });
  }));
  orders.forEach((order) => order.lines.forEach((line) => {
    const colors = colorPairsForText(line.color_breakdown, line.unit, line.unit_conversions);
    ensure(line.stock_code, {
      description: line.description,
      product_group: line.product_group,
      colors: formatColorPairs(colors),
      color_quantities_pairs: colors,
    });
  }));
  movements.forEach((movement) => {
    const colors = colorPairsForText(movement.color_breakdown, "set", movement.unit_conversions);
    ensure(movement.stock_code, {
      description: movement.description,
      product_group: movement.product_group,
      colors: formatColorPairs(colors),
      color_quantities_pairs: colors,
    });
  });

  return [...byCode.keys()].sort().map((stockCode) => {
    const line = byCode.get(stockCode)!;
    const productLines = lines.filter((entry) => entry.stock_code === stockCode);
    const productMovements = movements.filter((entry) => entry.stock_code === stockCode);
    const productOrders = orders.filter((order) => order.order_status !== "cancelled" && order.lines.some((entry) => entry.stock_code === stockCode));
    const voucherNos = vouchers.filter((voucher) => voucher.lines.some((entry) => entry.stock_code === stockCode)).map((voucher) => voucher.voucher_no);
    const shipmentNos = shipments.filter((shipment) => voucherNos.includes(shipment.voucher_no)).map((shipment) => shipment.shipment_no);
    const orderNos = productOrders.map((order) => order.order_no);
    const receivingMovements = productMovements.filter((movement) => movement.movement_type === "in");
    const locations = productLines.map((entry) => ({
      location: entry.location,
      on_hand_pairs: Math.max(0, entry.quantity_available_pairs),
      colors: entry.colors,
      last_moved_on: entry.last_moved_on || null,
    })).filter((entry) => entry.location);
    const customerOrdered = productOrders.reduce((sum, order) => sum + order.lines.filter((entry) => entry.stock_code === stockCode).reduce((subtotal, entry) => subtotal + entry.quantity_pairs, 0), 0);
    const owed = productOrders.reduce((sum, order) => sum + order.lines.filter((entry) => entry.stock_code === stockCode).reduce((subtotal, entry) => subtotal + lineRemaining(entry), 0), 0);
    const delivered = productMovements.filter((movement) => movement.movement_type === "out").reduce((sum, movement) => sum + movement.quantity_pairs, 0);
    const allocated = productLines.reduce((sum, entry) => sum + allocatedPairs(entry, orders), 0);
    const incoming = incomingPairsForLine(stockCode, shipments, vouchers);
    const atSupplier = shipmentNos.length > 0 ? incoming : incoming;
    const sources = new Set<string>();
    if (voucherNos.length) sources.add("voucher");
    if (shipmentNos.length) sources.add("shipment");
    if (productOrders.length) sources.add("order");
    if (receivingMovements.length) sources.add("receiving");
    if (productMovements.some((movement) => movement.movement_type === "out")) sources.add("delivery");
    const lastActivity = [...productMovements.map((entry) => entry.moved_on), ...productOrders.map((entry) => entry.order_date), ...vouchers.filter((voucher) => voucher.lines.some((entry) => entry.stock_code === stockCode)).map((entry) => entry.voucher_date), ...shipments.filter((entry) => shipmentNos.includes(entry.shipment_no)).map((entry) => entry.sent_on)].sort().at(-1) ?? null;
    const onHand = Math.max(0, line.quantity_available_pairs);
    const available = Math.max(0, onHand - allocated);
    const status = onHand > 0 && allocated >= onHand
      ? "Customer Allocated"
      : onHand > 0
        ? "At Receiving"
        : incoming > 0
          ? "At Supplier"
          : owed > 0
            ? "Customer Ordered"
            : "Finished";
    return {
      stock_code: stockCode,
      description: line.description,
      product_group: line.product_group,
      on_hand_pairs: onHand,
      allocated_pairs: allocated,
      available_pairs: available,
      at_supplier_pairs: atSupplier,
      in_transit_pairs: 0,
      incoming_pairs: incoming,
      customer_ordered_pairs: customerOrdered,
      owed_to_customers_pairs: owed,
      delivered_pairs: delivered,
      lost_pairs: productOrders.reduce((sum, order) => sum + order.lines.filter((entry) => entry.stock_code === stockCode).reduce((subtotal, entry) => subtotal + (entry.lost_quantity_pairs ?? 0), 0), 0),
      colors: line.colors,
      color_quantities_pairs: line.color_quantities_pairs,
      locations,
      sources: [...sources],
      voucher_nos: [...new Set(voucherNos)],
      shipment_nos: [...new Set(shipmentNos)],
      order_nos: [...new Set(orderNos)],
      receiving_nos: [...new Set(receivingMovements.map((entry) => entry.reference))],
      status,
      last_activity_on: lastActivity,
      has_receiving_history: receivingMovements.length > 0,
    };
  });
}

function InventoryInsights({
  records,
  compact,
}: {
  records: StockRecord[];
  compact?: boolean;
}): React.JSX.Element {
  const physicalPairs = records.reduce((sum, record) => sum + Math.max(0, record.on_hand_pairs), 0);
  const availablePairs = records.reduce((sum, record) => sum + Math.max(0, record.available_pairs), 0);
  const allocated = records.reduce((sum, record) => sum + Math.max(0, record.allocated_pairs), 0);
  const incomingPairs = records.reduce((sum, record) => sum + Math.max(0, record.incoming_pairs), 0);
  const receivedToday = records.reduce((sum, record) => sum + Math.max(0, record.received_today_pairs ?? 0), 0);
  const deliveredToday = records.reduce((sum, record) => sum + Math.max(0, record.delivered_today_pairs ?? 0), 0);
  const counts: Record<InventoryHealth, number> = {
    Healthy: records.filter((record) => inventoryHealth(record) === "Healthy").length,
    "Low Stock": records.filter((record) => inventoryHealth(record) === "Low Stock").length,
    "Out of Stock": records.filter((record) => inventoryHealth(record) === "Out of Stock").length,
    Overstock: records.filter((record) => inventoryHealth(record) === "Overstock").length,
    "Not arrived yet": records.filter((record) => inventoryHealth(record) === "Not arrived yet").length,
  };
  const total = Math.max(1, records.length);
  const value = physicalPairs * ESTIMATED_PAIR_PRICE;
  const fmtValue = (amount: number): string =>
    amount >= 1_000_000
      ? `${(amount / 1_000_000).toFixed(1)}M MMK`
      : `${Math.round(amount / 1_000)}K MMK`;
  const healthRows: { label: InventoryHealth; color: string; text: string }[] = [
    { label: "Healthy", color: "bg-success", text: "text-success" },
    { label: "Low Stock", color: "bg-warning", text: "text-warning" },
    { label: "Out of Stock", color: "bg-error", text: "text-error" },
    { label: "Not arrived yet", color: "bg-text-secondary", text: "text-text-muted" },
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
          <p className="mt-3 text-xs text-text-muted">{formatQty(records.length)} stock-record SKUs</p>
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
            ["Available Stock Value", availablePairs, "text-success"],
            ["Incoming Stock Value", incomingPairs, "text-brand"],
            ["Allocated Stock Value", allocated, "text-purple-500"],
          ].map(([label, pairs, color]) => (
            <div key={String(label)} className="rounded-xl border border-border bg-bg-subtle px-4 py-3">
              <div className="mb-1 text-xs text-text-muted">{label}</div>
              <div className={cn("text-lg font-extrabold", String(color))}>
                {fmtValue(Number(pairs) * ESTIMATED_PAIR_PRICE)}
              </div>
              <div className="text-xs text-text-muted">{formatSets(Number(pairs))} × 19.5K per pair est.</div>
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
          <p className="mt-3 text-xs text-text-muted">Based on {formatQty(records.length)} stock records.</p>
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
                  {sign}{formatSets(Math.abs(Number(amount)))}
                </div>
                <div className="text-xs text-text-muted">{label === "Net Change" ? "net today" : String(label).toLowerCase()}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs italic text-text-muted">Confirmed transactions only.</p>
        </Panel>
      </div>
    </>
  );
}

function InventorySummaryCards({
  records,
}: {
  records: StockRecord[];
}): React.JSX.Element {
  const physicalRows = records
    .flatMap((record) => record.locations.map((location) => ({
      stockCode: record.stock_code,
      location: location.location,
      pairs: location.on_hand_pairs,
    })))
    .filter((row) => row.pairs > 0)
    .sort((a, b) => b.pairs - a.pairs);
  const physicalPairs = records.reduce((sum, record) => sum + Math.max(0, record.on_hand_pairs), 0);
  const emptyLocations = records.filter((record) => record.locations.length === 0).length;
  const atSupplierPairs = records.reduce((sum, record) => sum + record.at_supplier_pairs, 0);
  const inTransitPairs = records.reduce((sum, record) => sum + record.in_transit_pairs, 0);
  const atReceivingPairs = records.reduce((sum, record) => sum + Math.max(0, record.on_hand_pairs), 0);
  const committedPairs = records.reduce((sum, record) => sum + record.allocated_pairs, 0);
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
      detail: "Counted at receiving gates",
      pairs: atReceivingPairs,
      tone: "blue",
    },
  ];
  const committedRow: InventorySummaryRow = {
    label: "Customer Allocated",
    detail: "Reserved for customers",
    pairs: committedPairs,
    tone: "purple",
  };
  const incomingCommittedPairs = incomingRows.reduce((sum, row) => sum + row.pairs, committedRow.pairs);
  const onTheWayPairs = atSupplierPairs + inTransitPairs;

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
            <div key={`${row.stockCode}-${row.location}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <span className="h-3 w-3 shrink-0 rounded-full bg-success" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary sm:text-base">
                {row.stockCode} · {row.location}
              </span>
              <span className="shrink-0 rounded-full bg-bg-subtle px-3 py-1 text-xs font-medium text-text-muted">
              On hand
            </span>
              <span className="shrink-0 text-right text-sm font-bold tabular-nums text-text-primary sm:text-base">
                {formatSets(row.pairs)}
              </span>
            </div>
          ))}
          {/* An empty shelf is almost never an empty business — it usually means the
              goods are still on the road, or the boxes that arrived have not been
              opened yet. Saying which one stops this card reading as broken. */}
          {physicalRows.length === 0 && (
            <div className="px-4 py-5 text-sm text-text-muted sm:px-5">
              {onTheWayPairs > 0 ? (
                <>
                  Nothing on the shelf yet. {formatSets(onTheWayPairs)} on the
                  way — stock only counts here once its packages are opened in
                  Receiving.
                </>
              ) : (
                <>No stock at any location yet.</>
              )}
            </div>
          )}
          {emptyLocations > 0 && (
            <div className="px-4 py-3 text-sm text-text-muted sm:px-5">
              {formatQty(emptyLocations)} product
              {emptyLocations === 1 ? " has" : "s have"} not arrived anywhere yet.
            </div>
          )}
        </div>
      </SummaryCard>

      <SummaryCard
        title="Pipeline & Committed Stock"
        description="Stock at each shipment stage and amounts reserved for customers."
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
          <SummaryRow row={committedRow} />
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
            {formatSets(total)}
          </div>
          <div className="mt-1 text-sm text-text-muted">total quantity</div>
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
        {formatSets(row.pairs)}
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
  const allocated = record.allocated_pairs;
  const available = record.available_pairs;
  const incoming = record.incoming_pairs;
  const stockStatus = record.status as StockStatus;
  const health = inventoryHealth(record);
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
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                {line.stock_code}
              </h2>
              <StatusPill
                label={stockStatus}
                className={STOCK_STATUS_STYLES[stockStatus]}
              />
              <StatusPill label={health} className={HEALTH_STYLES[health]} />
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
                  <ReadOnlyField
                    label="Location"
                    value={record.locations.length === 0 ? "Not arrived yet" : record.locations.map((entry) => entry.location).join(", ")}
                    wrap
                  />
                  <ReadOnlyField
                    label="On hand"
                    value={formatSets(record.on_hand_pairs)}
                  />
                  <ReadOnlyField
                    label="Allocated"
                    value={formatSets(allocated)}
                  />
                  <ReadOnlyField
                    label="Available"
                    value={formatSets(available)}
                  />
                  <ReadOnlyField
                    label="Incoming"
                    value={formatSets(incoming)}
                  />
                  <ReadOnlyField
                    label="Last moved"
                    value={record.last_activity_on ? formatDate(record.last_activity_on) : "—"}
                  />
                </dl>
              </div>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-bg-subtle/50 p-4">
              <h3 className="mb-3 text-sm font-semibold text-text-primary">Pipeline</h3>
              <div className="divide-y divide-border">
                {pipelineStages.map((stage) => (
                  <div key={stage.label} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text-primary">{stage.label}</div>
                      <div className="text-xs text-text-muted">{stage.detail}</div>
                    </div>
                    <div className="shrink-0 font-semibold tabular-nums text-text-primary">
                      {formatSets(stage.pairs)}
                    </div>
                  </div>
                ))}
                {record.locations.length > 0 && (
                  <div className="py-3">
                    <div className="text-sm font-medium text-text-primary">On-hand locations</div>
                    <div className="mt-2 space-y-1.5">
                      {record.locations.map((location) => (
                        <div key={location.location} className="flex items-center justify-between gap-4 text-xs">
                          <span className="truncate text-text-muted">{location.location}</span>
                          <span className="shrink-0 font-semibold tabular-nums text-text-secondary">
                            {formatSets(location.on_hand_pairs)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                      {formatSets(movement.quantity_pairs)}
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
                    {formatSets(line.quantity_available_pairs)}
                  </Td>
                  <Td colSpan={4} className="text-text-muted">
                    {formatSets(line.quantity_in_pairs)} received, {formatSets(line.quantity_out_pairs)} sent out
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
