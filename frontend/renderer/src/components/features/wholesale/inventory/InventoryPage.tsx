// Root coordinator for the Inventory feature.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import {
  allocatedPairs,
  colorPairsForText,
  incomingMovements,
  stockLines,
  type StockMovement,
  type StockRecord,
} from "@renderer/components/features/wholesale/inventory/stock";
import { type CustomerOrder } from "@renderer/components/features/wholesale/orders/customerOrders";
import { type Shipment } from "@renderer/components/features/wholesale/delivery/shipments";
import { type SupplierVoucher } from "@renderer/components/features/wholesale/vouchers/supplierVouchers";
import { hydrateOrders, useWholesale } from "@renderer/components/features/wholesale/shared/store";
import {
  CUSTOMER_ORDERS_URL,
  WHOLESALE_INVENTORY_URL,
  WHOLESALE_STOCK_URL,
  inventoryMovementsFromWire,
  ordersFromWire,
  stockRecordsFromWire,
  type InventoryMovementWire,
  type StockRecordWire,
} from "@renderer/components/features/wholesale/shared/api";
import {
  INVENTORY_QUERY_KEY,
  ORDERS_QUERY_KEY,
  STOCK_QUERY_KEY,
} from "./types";
import {
  incomingPairsForLine,
  formatColorPairs,
} from "./inventoryUtils";
import { StockList } from "./StockList";
import { StockDetail } from "./StockDetail";
import { lineRemaining } from "@renderer/components/features/wholesale/orders/customerOrders";

// This page loads the whole inventory/stock/orders dataset up front so StockList can do
// its own client-side search, location filter and pagination — the backend's default
// page size (100) silently truncated a branch with more SKUs or open orders than that,
// so ask for enough rows to cover realistic totals instead.
const LOAD_ALL_PAGE_SIZE = "?page_size=2000";

// ── Legacy fallback stock record builder ──────────────────────────────────────

function legacyStockRecords(
  lines: ReturnType<typeof stockLines>,
  orders: CustomerOrder[],
  movements: StockMovement[],
  shipments: Shipment[],
  vouchers: SupplierVoucher[],
): StockRecord[] {
  const byCode = new Map<string, ReturnType<typeof stockLines>[0]>();
  const ensure = (stockCode: string, line?: Partial<ReturnType<typeof stockLines>[0]>): ReturnType<typeof stockLines>[0] => {
    const existing = byCode.get(stockCode);
    if (existing) return existing;
    const created: ReturnType<typeof stockLines>[0] = {
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
    const atSupplier = incoming;
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

// ── InventoryPage ─────────────────────────────────────────────────────────────

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
    queryFn: () => fetchJson<InventoryMovementWire[]>(`${WHOLESALE_INVENTORY_URL}${LOAD_ALL_PAGE_SIZE}`, session),
  });
  useLoadErrorToast(isError, "wholesale inventory");
  const {
    data: stockWire,
    isFetching: isStockRefreshing,
    isError: stockFailed,
  } = useQuery({
    queryKey: STOCK_QUERY_KEY,
    queryFn: () => fetchJson<StockRecordWire[]>(`${WHOLESALE_STOCK_URL}${LOAD_ALL_PAGE_SIZE}`, session),
  });
  useLoadErrorToast(stockFailed, "wholesale stock records");
  const { data: orderWire, isError: ordersFailed } = useQuery({
    queryKey: ORDERS_QUERY_KEY,
    queryFn: () => fetchJson<CustomerOrder[]>(`${CUSTOMER_ORDERS_URL}${LOAD_ALL_PAGE_SIZE}`, session),
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
  const { orders, receivings, outgoing, shipments, vouchers } = useWholesale();
  const [view, setView] = useState<"list" | "detail">("list");
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
