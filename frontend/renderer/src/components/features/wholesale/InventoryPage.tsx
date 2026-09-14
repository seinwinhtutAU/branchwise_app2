import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
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
  EyeIcon,
  InventoryIcon,
  MoreIcon,
  SearchIcon,
  TruckIcon,
  WarehouseIcon,
} from "@renderer/components/ui/icons";
import {
  CellInput,
  FigureCard,
  FloatingLayer,
  MenuItem,
  PAGE_SIZE,
  Panel,
  CopyButton,
  ReadOnlyField,
  Reference,
  SectionLabel,
  SuggestInput,
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
  WholesaleApiError,
  createCustomerDeliveryBatch,
  inventoryMovementsFromWire,
  ordersFromWire,
  type CustomerDeliveryBatchInput,
  type InventoryMovementWire,
  updateCustomerOrderLineAllocation,
  updateCustomerDelivery,
} from "@renderer/components/features/wholesale/api";
import {
  colorQtyPairs,
  colorQtyProblem,
  formatDate,
  formatQty,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  type Unit,
} from "@renderer/components/features/wholesale/units";
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
type InventoryTab = "stock" | "deliveries";
type InventorySection = "overview" | "locations" | "movement" | "allocations";
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

const customerDeliveryDraftSchema = z.object({
  stock_code: z.string(),
  location: z.string(),
  color_breakdown: z.string(),
});

const customerDeliveryFormSchema = z.object({
  order_id: z.string().trim().min(1, "Choose a customer order."),
  order_search: z.string(),
  from_location: z.string(),
  to_location: z.string(),
  delivered_on: z.string().trim().min(1, "Choose a delivery date."),
  note: z.string(),
  drafts: z.array(customerDeliveryDraftSchema),
});

interface CustomerDeliveryFormValues {
  order_id: string;
  order_search: string;
  from_location: string;
  to_location: string;
  delivered_on: string;
  note: string;
  drafts: DeliveryDraftLine[];
}

const deliveryHistoryFormSchema = z.object({
  drafts: z.array(
    z.object({
      movement_id: z.string(),
      movement_type: z.enum(["in", "out"]),
      stock_code: z.string(),
      description: z.string(),
      product_group: z.enum(["man", "lady", "child"]),
      color_breakdown: z.string(),
      quantity_pairs: z.number(),
      location: z.string(),
      moved_on: z.string().trim().min(1, "Choose a delivery date."),
      reference: z.string(),
      counterparty_name: z.string(),
      note: z.string(),
      delivery_address: z.string().optional(),
    }),
  ),
});

interface DeliveryHistoryFormValues {
  drafts: StockMovement[];
}

const STOCK_STATUSES: StockStatus[] = [
  "At Supplier",
  "In Transit",
  "At Receiving",
  "Customer Allocated",
];

export default function InventoryPage({
  session,
  onOpenReceiving,
  initialTab = "stock",
  showTabs = false,
}: {
  session: Session;
  onOpenReceiving: (receivingNo: string) => void;
  initialTab?: InventoryTab;
  showTabs?: boolean;
}): React.JSX.Element {
  const showToast = useToast();
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
  useLoadErrorToast(ordersFailed, "customer orders for inventory allocations");
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
  // fetched here as well so Allocations still has authoritative rows when Inventory is
  // the first wholesale screen opened after a fresh app launch.
  const { orders, receivings, outgoing, shipments, vouchers } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [tab, setTab] = useState<InventoryTab>(initialTab);
  const [selected, setSelected] = useState<{
    stock_code: string;
    location: string;
  } | null>(null);
  const [allocationByLine, setAllocationByLine] = useState<Record<string, number>>({});
  const [allocationColorByLine, setAllocationColorByLine] = useState<Record<string, string>>({});
  const persistedAllocationByLine = useMemo(
    () =>
      Object.fromEntries(
        serverOrders.flatMap((order) =>
          order.lines.map((line) => [line.order_line_id, line.allocated_quantity_pairs ?? 0]),
        ),
      ) as Record<string, number>,
    [serverOrders],
  );
  const persistedAllocationColorByLine = useMemo(
    () =>
      Object.fromEntries(
        serverOrders.flatMap((order) =>
          order.lines.map((line) => [line.order_line_id, line.allocated_color_breakdown ?? ""]),
        ),
      ) as Record<string, string>,
    [serverOrders],
  );
  const effectiveAllocationByLine = useMemo(
    () => ({ ...persistedAllocationByLine, ...allocationByLine }),
    [allocationByLine, persistedAllocationByLine],
  );
  const effectiveAllocationColorByLine = useMemo(
    () => ({ ...persistedAllocationColorByLine, ...allocationColorByLine }),
    [allocationColorByLine, persistedAllocationColorByLine],
  );

  const movements = useMemo(
    () =>
      wire
        ? inventoryMovementsFromWire(wire)
        : [...incomingMovements(receivings), ...outgoing],
    [wire, receivings, outgoing],
  );
  const lines = useMemo(() => stockLines(movements), [movements]);
  const ordersWithAllocations = useMemo(
    () =>
      orders.map((order) => ({
        ...order,
        lines: order.lines.map((line) => ({
          ...line,
          allocated_quantity_pairs: effectiveAllocationByLine[line.order_line_id] ?? 0,
          allocated_color_breakdown: effectiveAllocationColorByLine[line.order_line_id] ?? "",
        })),
      })),
    [effectiveAllocationByLine, effectiveAllocationColorByLine, orders],
  );

  const line =
    selected === null
      ? null
      : (lines.find(
          (entry) =>
            entry.stock_code === selected.stock_code &&
            entry.location === selected.location,
        ) ?? null);

  async function recordBatch(
    input: CustomerDeliveryBatchInput,
  ): Promise<boolean> {
    try {
      const created = await createCustomerDeliveryBatch(session, input);
      await reload();
      showToast(
        "success",
        `${formatQty(created.length)} product${created.length === 1 ? "" : "s"} delivered to the customer.`,
      );
      return true;
    } catch (error) {
      showToast(
        "error",
        error instanceof WholesaleApiError
          ? error.message
          : "Could not record this customer delivery.",
      );
      return false;
    }
  }

  async function editDelivery(movement: StockMovement): Promise<boolean> {
    try {
      await updateCustomerDelivery(session, movement);
      await reload();
      showToast("success", "Delivery updated.");
      return true;
    } catch (error) {
      showToast(
        "error",
        error instanceof WholesaleApiError
          ? error.message
          : "Could not update this delivery.",
      );
      return false;
    }
  }

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

  return tab === "stock" ? (
    <StockList
      lines={lines}
      orders={ordersWithAllocations}
      allocationOrders={serverOrders}
      movements={movements}
      shipments={shipments}
      vouchers={vouchers}
      allocationByLine={effectiveAllocationByLine}
      allocationColorByLine={effectiveAllocationColorByLine}
      onAllocate={async (lineId, quantity, colorValue) => {
        try {
          await updateCustomerOrderLineAllocation(session, lineId, colorValue);
          setAllocationByLine((current) => ({ ...current, [lineId]: quantity }));
          setAllocationColorByLine((current) => ({ ...current, [lineId]: colorValue }));
          showToast("success", "Customer allocation saved.");
        } catch (error) {
          showToast(
            "error",
            error instanceof WholesaleApiError
              ? error.message
              : "Could not save this customer allocation.",
          );
        }
      }}
      tab={tab}
      onTabChange={setTab}
      showTabs={showTabs}
      onOpen={(stockCode, location) => {
        setSelected({ stock_code: stockCode, location });
        setView("detail");
      }}
      onRefresh={reload}
      refreshing={isRefreshing}
    />
  ) : (
    <CustomerDeliveries
      lines={lines}
      orders={ordersWithAllocations}
      movements={movements}
      onRefresh={reload}
      refreshing={isRefreshing}
      onSave={recordBatch}
      onUpdate={editDelivery}
    />
  );
}

function InventoryTabs({
  tab,
  onChange,
}: {
  tab: InventoryTab;
  onChange: (tab: InventoryTab) => void;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Inventory view"
      className="flex overflow-x-auto border-b border-border px-6"
    >
      {(
        [
          ["stock", "Stock"],
          ["deliveries", "Customer deliveries"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          onClick={() => onChange(value)}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-5 py-4 text-sm font-semibold transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            tab === value
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
          ["allocations", "Allocations"],
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

function CustomerDeliveryTabs({
  active,
  onCreate,
  onHistory,
}: {
  active: "create" | "history";
  onCreate: () => void;
  onHistory: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 px-6 pt-3 border-b border-border">
      {(
        [
          ["create", "New delivery", onCreate],
          ["history", "Delivery history", onHistory],
        ] as const
      ).map(([value, label, onClick]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={active === value}
          onClick={onClick}
          className={cn(
            "border-b-2 px-3 pb-3 text-sm font-semibold transition-colors duration-150",
            active === value
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

// ── Customer deliveries ─────────────────────────────────────────────────────

interface DeliveryDraftLine {
  stock_code: string;
  location: string;
  color_breakdown: string;
}

function orderLabel(order: CustomerOrder): string {
  return `${order.order_no} · ${order.customer_name}`;
}

/** Colour quantities reserved by every other open order's allocation for this stock
 *  code — the same rule the server enforces in `allocated_color_pairs_for_stock_code`
 *  (backend/app/services/wholesale/inventory.py). An order is always free to draw on
 *  its own allocation, so its own lines are excluded. */
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

function deliverySources(
  order: CustomerOrder,
  stockCode: string,
  lines: StockLine[],
  movements: StockMovement[],
  orders: CustomerOrder[],
): StockLine[] {
  const needed = colorAvailabilityForOrder(
    order,
    stockCode,
    {},
    movements,
  ).remaining;
  const reserved = reservedColorPairsForStockCode(orders, stockCode, order.order_id);
  return lines.filter((line) => {
    if (line.stock_code !== stockCode) return false;
    const available = subtractColorPairs(line.color_quantities_pairs, reserved);
    return Object.entries(needed).some(([color]) => (available[color] ?? 0) > 0);
  });
}

function partiallyDeliverableOrders(
  orders: CustomerOrder[],
  lines: StockLine[],
  movements: StockMovement[],
): CustomerOrder[] {
  return orders.filter(
    (order) =>
      order.order_status !== "cancelled" &&
      order.lines.some(
        (line) =>
          lineRemaining(line) > 0 &&
          deliverySources(order, line.stock_code, lines, movements, orders).length > 0,
      ),
  );
}

function deliveryLocations(
  order: CustomerOrder,
  lines: StockLine[],
  movements: StockMovement[],
  orders: CustomerOrder[],
): string[] {
  return [
    ...new Set(
      order.lines.flatMap((line) =>
        deliverySources(order, line.stock_code, lines, movements, orders).map(
          (source) => source.location,
        ),
      ),
    ),
  ];
}

function initialDeliveryLines(
  order: CustomerOrder,
  fromLocation: string,
): DeliveryDraftLine[] {
  return order.lines
    .filter((line) => lineRemaining(line) > 0)
    .map((line) => ({
      stock_code: line.stock_code,
      location: fromLocation,
      color_breakdown: "",
    }));
}

interface DeliveryHistoryGroup {
  key: string;
  movements: StockMovement[];
}

function deliveryHistoryGroups(
  movements: StockMovement[],
): DeliveryHistoryGroup[] {
  const groups = new Map<string, StockMovement[]>();
  movements
    .filter((movement) => movement.movement_type === "out")
    .forEach((movement) => {
      // A batch shares its order, date, destination, source and note across each
      // product movement. Those fields let the history read as one delivery instead
      // of exposing the implementation detail that the API stores one row per product.
      const key = [
        movement.reference,
        movement.moved_on,
        movement.location,
        movement.delivery_address ?? "",
        movement.note,
      ].join("|");
      groups.set(key, [...(groups.get(key) ?? []), movement]);
    });

  return [...groups.entries()]
    .map(([key, grouped]) => ({ key, movements: grouped }))
    .sort((a, b) => (a.movements[0].moved_on < b.movements[0].moved_on ? 1 : -1));
}

function deliveryHistoryQuantity(delivery: DeliveryHistoryGroup): number {
  return delivery.movements.reduce((sum, movement) => sum + movement.quantity_pairs, 0);
}

function CustomerDeliveries({
  lines,
  orders,
  movements,
  onRefresh,
  refreshing,
  onSave,
  onUpdate,
}: {
  lines: StockLine[];
  orders: CustomerOrder[];
  movements: StockMovement[];
  onRefresh: () => void;
  refreshing: boolean;
  onSave: (input: CustomerDeliveryBatchInput) => Promise<boolean>;
  onUpdate: (movement: StockMovement) => Promise<boolean>;
}): React.JSX.Element {
  const {
    control,
    handleSubmit,
    setValue,
    trigger,
    formState: { errors, isDirty },
  } = useForm<CustomerDeliveryFormValues>({
    resolver: zodResolver(customerDeliveryFormSchema),
    defaultValues: {
      order_id: "",
      order_search: "",
      from_location: "",
      to_location: "",
      delivered_on: todayIso(),
      note: "",
      drafts: [],
    },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { replace } = useFieldArray({ control, name: "drafts" });
  const values = useWatch({ control }) as CustomerDeliveryFormValues;
  const { order_id: orderId, from_location: fromLocation, drafts } = values;
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<"create" | "history">("create");
  const [selectedDeliveryKey, setSelectedDeliveryKey] = useState<string | null>(
    null,
  );
  const availableOrders = useMemo(
    () => partiallyDeliverableOrders(orders, lines, movements),
    [orders, lines, movements],
  );
  const order = availableOrders.find((entry) => entry.order_id === orderId);

  function selectOrder(nextOrder: CustomerOrder): void {
    const initialLocation =
      deliveryLocations(nextOrder, lines, movements, orders)[0] ?? "";
    setValue("order_id", nextOrder.order_id, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue("order_search", orderLabel(nextOrder), { shouldDirty: true });
    setValue("from_location", initialLocation, { shouldDirty: true });
    setValue("to_location", nextOrder.customer_address ?? "", {
      shouldDirty: true,
    });
    replace(initialDeliveryLines(nextOrder, initialLocation));
    setValue("note", "", { shouldDirty: true });
    setValue("delivered_on", todayIso(), { shouldDirty: true });
  }

  function searchOrder(value: string): void {
    setValue("order_search", value, { shouldDirty: true });
    const selectedOrder = availableOrders.find(
      (customerOrder) => orderLabel(customerOrder) === value,
    );
    if (selectedOrder) {
      selectOrder(selectedOrder);
      return;
    }
    setValue("order_id", "", { shouldDirty: true, shouldValidate: true });
    setValue("from_location", "", { shouldDirty: true });
    setValue("to_location", "", { shouldDirty: true });
    replace([]);
  }

  function changeFromLocation(value: string): void {
    setValue("from_location", value, { shouldDirty: true });
    if (!order) return;
    replace(initialDeliveryLines(order, value));
  }

  function updateDraft(
    stockCode: string,
    patch: Partial<DeliveryDraftLine>,
  ): void {
    const index = drafts.findIndex((draft) => draft.stock_code === stockCode);
    if (index < 0) return;
    setValue(
      `drafts.${index}`,
      { ...drafts[index], ...patch },
      {
        shouldDirty: true,
        shouldValidate: true,
      },
    );
  }

  function stockSources(stockCode: string): StockLine[] {
    return order
      ? deliverySources(order, stockCode, lines, movements, orders).filter(
          (source) => source.location === fromLocation,
        )
      : [];
  }

  function remainingColors(stockCode: string): ColorPairs {
    if (!order) return {};
    return colorAvailabilityForOrder(order, stockCode, {}, movements).remaining;
  }

  // What this order can actually draw from a stock line: its own colour quantities,
  // less whatever other open orders have reserved through Allocations — an order is
  // always free to draw on its own reservation, but never on someone else's.
  function availableColors(stockCode: string, source: StockLine | undefined): ColorPairs {
    if (!order || !source) return {};
    return subtractColorPairs(
      source.color_quantities_pairs,
      reservedColorPairsForStockCode(orders, stockCode, order.order_id),
    );
  }

  function fillAvailable(): void {
    if (!order) return;
    replace(
      drafts.map((draft) => {
        const source = stockSources(draft.stock_code).find(
          (line) => line.location === draft.location,
        );
        if (!source) return draft;
        const usable = availableColors(draft.stock_code, source);
        const needed = colorAvailabilityForOrder(
          order,
          draft.stock_code,
          usable,
          movements,
        ).remaining;
        const deliverable = Object.fromEntries(
          Object.entries(needed).map(([color, pairs]) => [
            color,
            Math.min(pairs, usable[color] ?? 0),
          ]),
        );
        return { ...draft, color_breakdown: formatColorPairs(deliverable) };
      }),
    );
  }

  const draftRows = drafts.map((draft) => {
    const source = stockSources(draft.stock_code).find(
      (line) => line.location === draft.location,
    );
    const needed = remainingColors(draft.stock_code);
    const pairs = colorQtyPairs(draft.color_breakdown, "set");
    const reserved = order
      ? reservedColorPairsForStockCode(orders, draft.stock_code, order.order_id)
      : {};
    const usable = availableColors(draft.stock_code, source);
    const problem =
      draft.color_breakdown.trim() === ""
        ? null
        : (colorQtyProblem(draft.color_breakdown) ??
          deliveryColorProblem(draft.color_breakdown, "set", usable, needed, reserved));
    return { draft, source, needed, pairs, problem };
  });
  const selectedRows = draftRows.filter((row) => row.pairs > 0);
  const canSave =
    order !== undefined &&
    selectedRows.length > 0 &&
    draftRows.every((row) => row.pairs === 0 || row.problem === null);

  async function save(values: CustomerDeliveryFormValues): Promise<void> {
    const order = availableOrders.find(
      (entry) => entry.order_id === values.order_id,
    );
    if (!order || saving) return;
    const isValid = await trigger();
    if (!isValid || !canSave) return;
    setSaving(true);
    const saved = await onSave({
      order_id: order.order_id,
      delivered_on: values.delivered_on,
      delivery_address: values.to_location.trim(),
      note: values.note.trim(),
      lines: selectedRows.map((row) => ({
        stock_code: row.draft.stock_code,
        location: row.draft.location,
        color_breakdown: row.draft.color_breakdown.trim(),
      })),
    });
    setSaving(false);
    if (saved) {
      replace(values.drafts.map((draft) => ({ ...draft, color_breakdown: "" })));
      setValue("note", "", { shouldDirty: true });
    }
  }

  const productsWaiting = availableOrders.reduce(
    (sum, customerOrder) =>
      sum +
      customerOrder.lines.filter(
        (line) =>
          lineRemaining(line) > 0 &&
          deliverySources(customerOrder, line.stock_code, lines, movements, orders)
            .length > 0,
      ).length,
    0,
  );
  const selectedPairs = selectedRows.reduce((sum, row) => sum + row.pairs, 0);
  const deliveryHistory = deliveryHistoryGroups(movements);

  const selectedDelivery = deliveryHistory.find(
    (delivery) => delivery.key === selectedDeliveryKey,
  );

  if (activeTab === "history" && selectedDelivery) {
    return (
      <DeliveryDetail
        delivery={selectedDelivery}
        onBack={() => setSelectedDeliveryKey(null)}
        onUpdate={onUpdate}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <FigureCard
          label="Orders ready to deliver"
          value={formatQty(availableOrders.length)}
          sub="with stock available now"
        />
        <FigureCard
          label="Products to deliver"
          value={formatQty(productsWaiting)}
          sub="available to allocate now"
          tone="neutral"
        />
        <FigureCard
          label="Products selected"
          value={formatQty(selectedRows.length)}
          sub="in this delivery"
        />
        <FigureCard
          label="Delivery quantity"
          value={formatIn(selectedPairs, "set")}
          sub="ready to hand over"
          tone={selectedPairs > 0 ? "success" : "neutral"}
        />
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Customer deliveries
            </h2>
            <p className="mt-0.5 text-sm text-text-muted">
              Select an order and record the products delivered from available
              stock.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            loading={refreshing}
          >
            Refresh
          </Button>
        </div>

        <CustomerDeliveryTabs
          active={activeTab}
          onCreate={() => {
            setSelectedDeliveryKey(null);
            setActiveTab("create");
          }}
          onHistory={() => setActiveTab("history")}
        />

        {activeTab === "create" && (
          <>
            <div className="grid gap-4 border-b border-border bg-bg-subtle px-6 py-4 lg:grid-cols-[minmax(0,1fr)_14rem]">
              <Controller
                control={control}
                name="order_search"
                render={({ field }) => (
                  <SuggestInput
                    label="Customer order"
                    placeholder="Type an order no. or customer name"
                    suggestions={availableOrders.map(orderLabel)}
                    value={field.value}
                    onChange={searchOrder}
                    error={errors.order_id?.message}
                  />
                )}
              />
              <div className="flex items-end">
                <Button
                  className="w-full"
                  variant="secondary"
                  disabled={!order}
                  onClick={fillAvailable}
                >
                  Fill available
                </Button>
              </div>
            </div>

            {!order ? (
              <EmptyState
                icon={<InventoryIcon />}
                title="Choose an order that can be delivered"
                description="Type an order number or customer name. Suggestions only include orders with at least one product and color available in stock now."
              />
            ) : (
              <div className="flex flex-col gap-5 px-6 py-5">
                <div className="grid gap-4 rounded-lg border border-border bg-bg-subtle/50 p-4 lg:grid-cols-3">
                  <ReadOnlyField label="Customer" value={order.customer_name} />
                  <ReadOnlyField
                    label="Customer order no."
                    value={order.order_no}
                    copyable
                  />
                  <div className="hidden lg:block" aria-hidden="true" />
                  <Controller
                    control={control}
                    name="from_location"
                    render={({ field }) => (
                      <SuggestInput
                        label="From location"
                        placeholder="Type or choose a stock location"
                        suggestions={deliveryLocations(order, lines, movements, orders)}
                        value={field.value}
                        onChange={changeFromLocation}
                      />
                    )}
                  />
                  <Controller
                    control={control}
                    name="to_location"
                    render={({ field }) => (
                      <Input
                        label="To location"
                        placeholder="Enter delivery address"
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </div>

                <TableContainer>
                  <Thead className="top-0">
                    <Tr>
                      <Th className="min-w-[18rem]">Product</Th>
                      <Th className="min-w-[12rem]">Stock needed</Th>
                      <Th className="min-w-[13rem]">Available stock</Th>
                      <Th className="min-w-[15rem]">Stock to deliver</Th>
                      <Th className="text-right whitespace-nowrap">Quantity</Th>
                      <Th className="min-w-[10rem]">Status</Th>
                    </Tr>
                  </Thead>
                  <Tbody>
                    {draftRows.length === 0 ? (
                      <Tr>
                        <Td
                          colSpan={6}
                          className="py-8 text-center text-sm text-text-muted"
                        >
                          No outstanding order products are available at this
                          location.
                        </Td>
                      </Tr>
                    ) : (
                      draftRows.map(
                        ({ draft, source, needed, pairs, problem }, index) => {
                          const orderLine = order.lines.find(
                            (line) => line.stock_code === draft.stock_code,
                          );
                          return (
                            <Tr key={draft.stock_code}>
                              <Td>
                                <div className="flex min-w-0 flex-col gap-0.5">
                                  <div className="flex min-w-0 items-center gap-1">
                                    <span className="font-semibold text-brand break-words">
                                      {draft.stock_code || "No stock code"}
                                    </span>
                                    {draft.stock_code && (
                                      <CopyButton
                                        value={draft.stock_code}
                                        what="stock code"
                                      />
                                    )}
                                  </div>
                                  <span className="text-text-secondary">
                                    {orderLine?.description || "—"}
                                  </span>
                                  <span className="text-xs text-text-muted">
                                    {orderLine
                                      ? GROUP_LABELS[orderLine.product_group]
                                      : "—"}
                                  </span>
                                </div>
                              </Td>
                              <Td className="font-mono text-xs text-text-secondary">
                                {formatColorPairs(needed) ||
                                  "Nothing remaining"}
                              </Td>
                              <Td className="font-mono text-xs text-text-secondary">
                                {source ? (
                                  <>
                                    <span className="block">
                                      {formatColorPairs(source.color_quantities_pairs) ||
                                        "—"}
                                    </span>
                                    <span className="mt-0.5 block font-sans text-text-muted">
                                      {formatIn(source.quantity_available_pairs, "set")} in
                                      stock
                                    </span>
                                  </>
                                ) : (
                                  "No stock available"
                                )}
                              </Td>
                              <Td>
                                <Controller
                                  control={control}
                                  name={`drafts.${index}.color_breakdown`}
                                  render={({ field }) => (
                                    <CellInput
                                      label={`Colors to deliver for ${draft.stock_code}`}
                                      placeholder="black2s,pink1s"
                                      value={field.value}
                                      error={problem ?? undefined}
                                      onChange={(color_breakdown) =>
                                        updateDraft(draft.stock_code, {
                                          color_breakdown,
                                        })
                                      }
                                    />
                                  )}
                                />
                              </Td>
                              <Td className="text-right tabular-nums font-medium whitespace-nowrap">
                                {pairs > 0 ? formatIn(pairs, "set") : "—"}
                              </Td>
                              <Td>
                                {problem ? (
                                  <div className="flex flex-col items-start gap-1">
                                    <StatusPill
                                      label="Cannot deliver"
                                      className="bg-error text-white"
                                    />
                                    <span className="text-xs text-error">
                                      {problem}
                                    </span>
                                  </div>
                                ) : !source ? (
                                  <StatusPill
                                    label="Not available"
                                    className="bg-error text-white"
                                  />
                                ) : pairs > 0 ? (
                                  <StatusPill
                                    label="Ready"
                                    className="bg-success text-white"
                                  />
                                ) : (
                                  <StatusPill
                                    label="Not selected"
                                    className="bg-text-secondary text-bg-base"
                                  />
                                )}
                              </Td>
                            </Tr>
                          );
                        },
                      )
                    )}
                  </Tbody>
                </TableContainer>

                <div className="grid items-end gap-4 border-t border-border pt-5 md:grid-cols-[11rem_minmax(0,1fr)_auto]">
                  <Controller
                    control={control}
                    name="delivered_on"
                    render={({ field }) => (
                      <Input
                        label="Delivery date"
                        type="date"
                        value={field.value}
                        onChange={field.onChange}
                        error={errors.delivered_on?.message}
                      />
                    )}
                  />
                  <Controller
                    control={control}
                    name="note"
                    render={({ field }) => (
                      <Input
                        label="Delivery note"
                        placeholder="Collected by the customer"
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                  <Button
                    title={
                      isDirty ? "Delivery changes are pending." : undefined
                    }
                    onClick={handleSubmit(save)}
                    loading={saving}
                    disabled={!canSave}
                  >
                    <CheckIcon className="w-4 h-4" />
                    Deliver {formatQty(selectedRows.length)} product
                    {selectedRows.length === 1 ? "" : "s"}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>

      {activeTab === "history" && (
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-b border-border">
            <div>
              <h2 className="text-base font-semibold text-text-primary tracking-tight">
                Delivery history
              </h2>
              <p className="mt-0.5 text-sm text-text-muted">
                Products already delivered to customers.
              </p>
            </div>
            <span className="text-sm text-text-muted">
              {formatQty(deliveryHistory.length)} deliver
              {deliveryHistory.length === 1 ? "y" : "ies"}
            </span>
          </div>

          <TableContainer className="border-0 rounded-none">
            <Thead>
              <Tr>
                <Th className="whitespace-nowrap">Date</Th>
                <Th className="whitespace-nowrap">Order no.</Th>
                <Th>Customer</Th>
                <Th>Products</Th>
                <Th className="text-right whitespace-nowrap">Quantity</Th>
                <Th>Destination</Th>
                <Th>Note</Th>
                <Th className="w-28" aria-label="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {deliveryHistory.length === 0 ? (
                <Tr>
                  <Td
                    colSpan={8}
                    className="py-8 text-center text-sm text-text-muted"
                  >
                    No customer deliveries recorded yet.
                  </Td>
                </Tr>
              ) : (
                deliveryHistory.map((delivery) => {
                  const first = delivery.movements[0];
                  return (
                    <Tr key={delivery.key}>
                      <Td className="whitespace-nowrap text-text-muted">
                        {formatDate(first.moved_on)}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Reference value={first.reference} what="order no." />
                      </Td>
                      <Td className="whitespace-nowrap font-medium">
                        {first.counterparty_name || "—"}
                      </Td>
                      <Td className="whitespace-normal break-words">
                        <span className="font-medium text-text-primary">
                          {formatQty(delivery.movements.length)} product
                          {delivery.movements.length === 1 ? "" : "s"}
                        </span>
                      </Td>
                      <Td className="text-right tabular-nums font-semibold whitespace-nowrap">
                        {formatIn(deliveryHistoryQuantity(delivery), "set")}
                      </Td>
                      <Td className="text-text-secondary whitespace-normal break-words">
                        {first.delivery_address || "—"}
                      </Td>
                      <Td className="max-w-[16rem] whitespace-normal break-words text-text-secondary">
                        {first.note || "—"}
                      </Td>
                      <Td className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedDeliveryKey(delivery.key)}
                        >
                          View details
                        </Button>
                      </Td>
                    </Tr>
                  );
                })
              )}
            </Tbody>
          </TableContainer>
        </Panel>
      )}
    </div>
  );
}

function DeliveryDetail({
  delivery,
  onBack,
  onUpdate,
}: {
  delivery: DeliveryHistoryGroup;
  onBack: () => void;
  onUpdate: (movement: StockMovement) => Promise<boolean>;
}): React.JSX.Element {
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors, isDirty },
  } = useForm<DeliveryHistoryFormValues>({
    resolver: zodResolver(deliveryHistoryFormSchema),
    defaultValues: { drafts: delivery.movements },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const drafts = useWatch({ control, name: "drafts" }) as StockMovement[];
  const [saving, setSaving] = useState(false);
  const first = drafts[0] ?? delivery.movements[0];
  const hasChanges = drafts.some((draft, index) => {
    const original = delivery.movements[index];
    return (
      draft.location !== original.location ||
      draft.color_breakdown !== original.color_breakdown ||
      draft.moved_on !== original.moved_on ||
      draft.note !== original.note
    );
  });

  function updateDraft(
    movementId: string,
    patch: Partial<StockMovement>,
  ): void {
    const index = drafts.findIndex((draft) => draft.movement_id === movementId);
    if (index < 0) return;
    setValue(
      `drafts.${index}`,
      { ...drafts[index], ...patch },
      {
        shouldDirty: true,
        shouldValidate: true,
      },
    );
  }

  async function saveChanges(values: DeliveryHistoryFormValues): Promise<void> {
    if (!hasChanges || saving) return;
    setSaving(true);
    try {
      for (const [index, draft] of values.drafts.entries()) {
        const original = delivery.movements[index];
        const changed =
          draft.location !== original.location ||
          draft.color_breakdown !== original.color_breakdown ||
          draft.moved_on !== original.moved_on ||
          draft.note !== original.note;
        if (changed && !(await onUpdate(draft))) return;
      }
      setDetailMode("view");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ChevronLeftIcon className="w-4 h-4" />
        Back to delivery history
      </Button>

      <Panel>
        <div className="grid items-center gap-3 px-6 py-4 border-b border-border lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                {first.reference}
              </h2>
              <StatusPill label="Delivered" className="bg-success text-white" />
            </div>
            <p className="mt-0.5 truncate text-sm text-text-muted">
              {first.counterparty_name} · {formatDate(first.moved_on)}
            </p>
          </div>

          <div
            role="tablist"
            aria-label="Delivery detail mode"
            className="order-2 flex w-full rounded-md bg-bg-subtle p-0.5 lg:order-none lg:w-auto lg:justify-self-center"
          >
            {(["view", "edit"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={detailMode === mode}
                onClick={() => setDetailMode(mode)}
                className={cn(
                  "flex-1 rounded-[5px] px-4 py-1.5 text-sm font-medium capitalize transition-colors duration-150 sm:flex-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  detailMode === mode
                    ? "bg-brand text-white shadow-sm"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {mode}
              </button>
            ))}
          </div>

          <div className="order-3 flex items-center gap-2 lg:order-none lg:justify-self-end">
            {detailMode === "edit" && (
              <Button
                size="sm"
                title={
                  isDirty
                    ? "Delivery changes are pending Save changes."
                    : undefined
                }
                onClick={handleSubmit(saveChanges)}
                loading={saving}
                disabled={!hasChanges}
              >
                <CheckIcon className="w-4 h-4" />
                Save changes
              </Button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-6 p-6">
          <section>
            <SectionLabel>Delivery information</SectionLabel>
            <div className="grid gap-4 rounded-lg border border-border bg-bg-subtle/50 p-4 sm:grid-cols-2 lg:grid-cols-3">
              <ReadOnlyField label="Customer" value={first.counterparty_name || "—"} />
              <ReadOnlyField
                label="Customer order no."
                value={first.reference}
                copyable
              />
              <ReadOnlyField
                label="Delivery date"
                value={formatDate(first.moved_on)}
              />
              <ReadOnlyField
                label="From location"
                value={first.location || "—"}
              />
              <ReadOnlyField
                label="Destination"
                value={first.delivery_address || "—"}
                wrap
              />
              <ReadOnlyField label="Note" value={first.note || "—"} wrap />
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <SectionLabel>Products delivered</SectionLabel>
              <span className="text-xs text-text-muted">
                {formatQty(drafts.length)} product
                {drafts.length === 1 ? "" : "s"} ·{" "}
                {formatIn(
                  deliveryHistoryQuantity({ ...delivery, movements: drafts }),
                  "set",
                )}
              </span>
            </div>
            <TableContainer>
              <Thead className="top-0">
                <Tr>
                  <Th className="min-w-[16rem]">Product</Th>
                  <Th>Colors</Th>
                  <Th className="text-right whitespace-nowrap">Quantity</Th>
                  {detailMode === "edit" && (
                    <>
                      <Th>From</Th>
                      <Th className="whitespace-nowrap">Date</Th>
                      <Th>Note</Th>
                    </>
                  )}
                </Tr>
              </Thead>
              <Tbody>
                {drafts.map((movement, index) => (
                  <Tr key={movement.movement_id}>
                    <Td>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex min-w-0 items-center gap-1">
                          <span className="break-words font-semibold text-brand">
                            {movement.stock_code || "No stock code"}
                          </span>
                          {movement.stock_code && (
                            <CopyButton
                              value={movement.stock_code}
                              what="stock code"
                            />
                          )}
                        </div>
                        <span className="break-words text-text-primary">
                          {movement.description || "—"}
                        </span>
                        <span className="text-xs text-text-muted">
                          {GROUP_LABELS[movement.product_group]}
                        </span>
                      </div>
                    </Td>
                    <Td>
                      {detailMode === "edit" ? (
                        <Controller
                          control={control}
                          name={`drafts.${index}.color_breakdown`}
                          render={({ field }) => (
                            <CellInput
                              label={`Colors delivered for ${movement.stock_code}`}
                              placeholder="black2s,pink1s"
                              value={field.value}
                              onChange={(color_breakdown) =>
                                updateDraft(movement.movement_id, { color_breakdown })
                              }
                            />
                          )}
                        />
                      ) : (
                        <span className="font-mono text-xs text-text-secondary break-words">
                          {movement.color_breakdown || "—"}
                        </span>
                      )}
                    </Td>
                    <Td className="text-right tabular-nums font-semibold whitespace-nowrap">
                      {formatIn(
                        colorQtyPairs(movement.color_breakdown, "set"),
                        "set",
                      )}
                    </Td>
                    {detailMode === "edit" && (
                      <>
                        <Td>
                          <Controller
                            control={control}
                            name={`drafts.${index}.location`}
                            render={({ field }) => (
                              <CellInput
                                label={`Source location for ${movement.stock_code}`}
                                placeholder="Source location"
                                value={field.value}
                                onChange={(location) =>
                                  updateDraft(movement.movement_id, {
                                    location,
                                  })
                                }
                              />
                            )}
                          />
                        </Td>
                        <Td>
                          <Controller
                            control={control}
                            name={`drafts.${index}.moved_on`}
                            render={({ field }) => (
                              <CellInput
                                label={`Delivery date for ${movement.stock_code}`}
                                placeholder=""
                                type="date"
                                value={field.value}
                                onChange={(date) =>
                                  updateDraft(movement.movement_id, { moved_on: date })
                                }
                                error={errors.drafts?.[index]?.moved_on?.message}
                              />
                            )}
                          />
                        </Td>
                        <Td>
                          <Controller
                            control={control}
                            name={`drafts.${index}.note`}
                            render={({ field }) => (
                              <CellInput
                                label={`Note for ${movement.stock_code}`}
                                placeholder="Optional note"
                                value={field.value}
                                onChange={(note) =>
                                  updateDraft(movement.movement_id, { note })
                                }
                              />
                            )}
                          />
                        </Td>
                      </>
                    )}
                  </Tr>
                ))}
              </Tbody>
            </TableContainer>
          </section>
        </div>
      </Panel>
    </div>
  );
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
  allocationOrders,
  movements,
  shipments,
  vouchers,
  allocationByLine,
  allocationColorByLine,
  onAllocate,
  tab,
  onTabChange,
  onOpen,
  onRefresh,
  refreshing,
  showTabs,
}: {
  lines: StockLine[];
  orders: CustomerOrder[];
  allocationOrders: CustomerOrder[];
  movements: StockMovement[];
  shipments: Shipment[];
  vouchers: SupplierVoucher[];
  allocationByLine: Record<string, number>;
  allocationColorByLine: Record<string, string>;
  onAllocate: (lineId: string, quantityPairs: number, colorValue: string) => void;
  tab: InventoryTab;
  onTabChange: (tab: InventoryTab) => void;
  onOpen: (stockCode: string, location: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  showTabs: boolean;
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

        {showTabs && <InventoryTabs tab={tab} onChange={onTabChange} />}

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
      {section === "allocations" && (
        <StockAllocationBoard
          lines={lines}
          orders={allocationOrders}
          allocations={allocationByLine}
          allocationColors={allocationColorByLine}
          onAllocate={onAllocate}
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
                <Th className="text-right">Quantity</Th>
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

function AllocationTabs({
  active,
  onChange,
}: {
  active: "new" | "allocated";
  onChange: (tab: "new" | "allocated") => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-1 px-6 pt-3 border-b border-border">
      {(
        [
          ["new", "To Allocate"],
          ["allocated", "Allocated"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={active === value}
          onClick={() => onChange(value)}
          className={cn(
            "border-b-2 px-3 pb-3 text-sm font-semibold transition-colors duration-150",
            active === value
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

function StockAllocationBoard({
  lines,
  orders,
  allocations,
  allocationColors,
  onAllocate,
  onRefresh,
  refreshing,
}: {
  lines: StockLine[];
  orders: CustomerOrder[];
  allocations: Record<string, number>;
  allocationColors: Record<string, string>;
  onAllocate: (lineId: string, quantityPairs: number, colorValue: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"new" | "allocated">("new");
  const [search, setSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const rows = useMemo(
    () =>
      orders
        .filter((order) => order.order_status !== "cancelled")
        .flatMap((order) =>
          order.lines
            .filter(
              (line) =>
                lineRemaining(line) > 0 || (allocations[line.order_line_id] ?? 0) > 0,
            )
            .map((line) => {
              const stockLinesForCode = lines.filter((stock) => stock.stock_code === line.stock_code);
              const onHand = stockLinesForCode.reduce(
                (sum, stock) => sum + Math.max(0, stock.quantity_available_pairs),
                0,
              );
              const alreadyAllocated = orders.reduce(
                (sum, currentOrder) =>
                  sum +
                  currentOrder.lines
                    .filter((orderLine) => orderLine.stock_code === line.stock_code)
                    .reduce((lineSum, orderLine) => lineSum + (allocations[orderLine.order_line_id] ?? 0), 0),
                0,
              );
              const saved = allocations[line.order_line_id] ?? 0;
              const remaining = lineRemaining(line);
              const availableColorPairs = stockLinesForCode.reduce<ColorPairs>((colors, stock) => {
                for (const [color, pairs] of Object.entries(colorPairsForText(stock.colors, "pair"))) {
                  colors[color] = (colors[color] ?? 0) + pairs;
                }
                return colors;
              }, {});
              const reservedColorPairs = orders.reduce<ColorPairs>((colors, currentOrder) => {
                for (const orderLine of currentOrder.lines) {
                  if (orderLine.stock_code !== line.stock_code) continue;
                  const allocation = allocationColors[orderLine.order_line_id] ?? orderLine.allocated_color_breakdown ?? "";
                  for (const [color, pairs] of Object.entries(colorPairsForText(allocation, orderLine.unit))) {
                    colors[color] = (colors[color] ?? 0) + pairs;
                  }
                }
                return colors;
              }, {});
              for (const [color, pairs] of Object.entries(reservedColorPairs)) {
                availableColorPairs[color] = Math.max(0, (availableColorPairs[color] ?? 0) - pairs);
              }
              const ownAllocation = colorPairsForText(
                allocationColors[line.order_line_id] ?? line.allocated_color_breakdown ?? "",
                line.unit,
              );
              for (const [color, pairs] of Object.entries(ownAllocation)) {
                availableColorPairs[color] = (availableColorPairs[color] ?? 0) + pairs;
              }
              return {
                order,
                line,
                remaining,
                saved,
                toAllocate: Math.max(0, remaining - saved),
                available: Math.max(0, onHand - alreadyAllocated),
                editableAvailable: Math.max(0, onHand - alreadyAllocated + saved),
                availableColorPairs,
              };
            }),
        )
        .filter(({ order, line, toAllocate, editableAvailable, saved }) => {
          const query = search.trim().toLowerCase();
          const matchesSearch =
            query === "" ||
            order.order_no.toLowerCase().includes(query) ||
            order.customer_name.toLowerCase().includes(query) ||
            line.stock_code.toLowerCase().includes(query) ||
            line.description.toLowerCase().includes(query);
          const matchesTab =
            activeTab === "new"
              ? toAllocate > 0 && editableAvailable > 0
              : saved > 0;
          return matchesSearch && matchesTab;
        }),
    [activeTab, allocationColors, allocations, lines, orders, search],
  );
  const groups = useMemo(() => {
    const grouped = new Map<string, { order: CustomerOrder; rows: typeof rows }>();
    for (const row of rows) {
      const current = grouped.get(row.order.order_id);
      if (current) current.rows.push(row);
      else grouped.set(row.order.order_id, { order: row.order, rows: [row] });
    }
    return [...grouped.values()];
  }, [rows]);

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-text-primary tracking-tight">Customer Allocations</h2>
          <p className="text-sm text-text-muted mt-0.5">
            {activeTab === "new"
              ? "Reserve available stock against open customer orders."
              : "Review and correct saved customer allocations."}
          </p>
        </div>
        <InventoryRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
      </div>

      <AllocationTabs active={activeTab} onChange={setActiveTab} />

      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
        <div className="w-full sm:w-[28rem]">
          <Input
            aria-label="Search customer allocations"
            placeholder="Search order, customer or product"
            startIcon={<SearchIcon className="w-4 h-4" />}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon={<InventoryIcon />}
          title={activeTab === "new" ? "No orders ready to allocate" : "No saved allocations"}
          description={
            activeTab === "new"
              ? "Open order lines with available stock will appear here."
              : "Saved allocations will appear here so you can correct them."
          }
        />
      ) : (
        <TableContainer className="border-0 rounded-none">
            <Thead>
              <Tr>
                <Th>Product</Th>
                <Th className="text-right">
                  {activeTab === "new" ? "To allocate" : "Remaining qty"}
                </Th>
                <Th className="text-right">Available stock</Th>
                <Th className="w-64">
                  {activeTab === "new" ? "Allocate quantity" : "Saved allocation"}
                </Th>
                <Th className="w-28" />
              </Tr>
            </Thead>
            <Tbody>
              {groups.map(({ order, rows: orderRows }) => (
                <Fragment key={order.order_id}>
                  <Tr className="bg-bg-subtle">
                    <Td colSpan={5}>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-bold text-text-primary">{order.order_no}</span>
                        <span className="text-sm text-text-secondary">{order.customer_name}</span>
                        <span className="text-xs text-text-muted">{formatDate(order.order_date)}</span>
                      </div>
                    </Td>
                  </Tr>
                  {orderRows.map(({ order: rowOrder, line, remaining, toAllocate, saved, available, availableColorPairs }) => {
                    const draft = drafts[line.order_line_id] ?? allocationColors[line.order_line_id] ?? "";
                    const requestedColors = colorPairsForText(draft, line.unit);
                    const quantity = Object.values(requestedColors).reduce((sum, pairs) => sum + pairs, 0);
                    const draftAvailable = Math.max(0, available + saved - quantity);
                    const draftAvailableColorPairs = { ...availableColorPairs };
                    for (const [color, pairs] of Object.entries(requestedColors)) {
                      draftAvailableColorPairs[color] = Math.max(
                        0,
                        (draftAvailableColorPairs[color] ?? 0) - pairs,
                      );
                    }
                    const draftAvailableColors = formatColorPairs(draftAvailableColorPairs);
                    const max = Math.min(remaining, available + saved);
                    const remainingColors = colorPairsForText(line.color_breakdown, line.unit);
                    const colorsFit = Object.entries(requestedColors).every(
                      ([color, pairs]) =>
                        pairs <= (remainingColors[color] ?? 0) &&
                        pairs <= (availableColorPairs[color] ?? 0),
                    );
                    const valid = draft.trim() !== "" && quantity > 0 && quantity <= max && colorsFit;
                    return (
                      <Tr key={line.order_line_id}>
                        <Td className="pl-8">
                          <div className="font-bold text-brand">{line.stock_code}</div>
                          <div className="max-w-[15rem] truncate text-sm text-text-primary" title={line.description}>{line.description}</div>
                        </Td>
                        <Td className="text-right font-semibold tabular-nums whitespace-nowrap">
                          <div>{formatQty(activeTab === "new" ? toAllocate : remaining)} pairs</div>
                          <div className="mt-0.5 text-xs font-normal text-text-muted">{formatColorPairs(remainingColors) || "—"}</div>
                        </Td>
                        <Td
                          className={cn(
                            "text-right font-semibold tabular-nums whitespace-nowrap",
                            draftAvailable > 0 ? "bg-success-subtle" : "bg-bg-subtle",
                          )}
                        >
                          <div className={draftAvailable > 0 ? "text-success" : "text-text-muted"}>
                            {formatQty(draftAvailable)} pairs
                          </div>
                          <div className="mt-0.5 text-xs font-normal text-text-muted">
                            {draftAvailableColors || "—"}
                          </div>
                        </Td>
                        <Td>
                          <input
                            aria-label={`Allocation for ${rowOrder.order_no} ${line.stock_code}`}
                            type="text"
                            value={draft}
                            placeholder="Enter color quantities"
                            aria-invalid={draft.trim() !== "" && !valid}
                            onChange={(event) => setDrafts((current) => ({ ...current, [line.order_line_id]: event.target.value }))}
                            className={cn(
                              "w-full rounded-md border bg-bg-base px-3 py-2 text-sm tabular-nums",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                              "border-border",
                            )}
                          />
                        </Td>
                        <Td>
                          <Button
                            size="sm"
                            disabled={!valid || quantity <= 0}
                            onClick={() => onAllocate(line.order_line_id, quantity, draft)}
                          >
                            {saved > 0 ? "Update" : "Allocate"}
                          </Button>
                          {activeTab === "allocated" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setDrafts((current) => ({
                                  ...current,
                                  [line.order_line_id]: "",
                                }));
                                onAllocate(line.order_line_id, 0, "");
                              }}
                            >
                              Clear
                            </Button>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </Fragment>
              ))}
            </Tbody>
        </TableContainer>
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
  created: "Created",
  processing: "Processing",
  partly_delivered: "Partly delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

const RELATED_ORDER_STATUS_STYLES: Record<
  CustomerOrder["order_status"],
  string
> = {
  created: "bg-text-secondary text-white",
  processing: "bg-brand text-white",
  partly_delivered: "bg-warning text-white",
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

function deliveryColorProblem(
  text: string,
  unit: Unit,
  stockColors: ColorPairs,
  remainingColors: ColorPairs,
  reservedColors: ColorPairs = {},
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
      return (reservedColors[color] ?? 0) > 0
        ? `Color "${color}" is reserved for another customer order.`
        : `Only ${formatIn(stockColors[color] ?? 0, "pair")} of ${color} is in stock.`;
    }
  }
  return null;
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
                  <Th className="text-right whitespace-nowrap">Ordered quantity</Th>
                  <Th className="text-right whitespace-nowrap">Received quantity</Th>
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
                  <Th className="text-right">Quantity</Th>
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
