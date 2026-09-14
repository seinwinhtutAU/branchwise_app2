import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  DollarIcon,
  InventoryIcon,
  SalesIcon,
  TruckIcon,
} from "@renderer/components/ui/icons";
import {
  FigureCard,
  Panel,
  type Tone,
} from "@renderer/components/features/wholesale/ui";
import {
  CUSTOMER_ORDERS_URL,
  inventoryMovementsFromWire,
  ordersFromWire,
  RECEIVINGS_URL,
  receivingsFromWire,
  SHIPMENTS_URL,
  shipmentsFromWire,
  SUPPLIER_VOUCHERS_URL,
  vouchersFromWire,
  WHOLESALE_INVENTORY_URL,
  type InventoryMovementWire,
  type ReceivingWire,
  type ShipmentWire,
  type SupplierVoucherWire,
} from "@renderer/components/features/wholesale/api";
import {
  formatDate,
  formatKyat,
  formatQty,
} from "@renderer/components/features/wholesale/shared";
import {
  orderAmount,
  orderBalance,
  paidAmount as paidOrderAmount,
  remainingQty,
  type CustomerOrder,
} from "@renderer/components/features/wholesale/customerOrders";
import {
  voucherAmount,
  voucherBalance,
} from "@renderer/components/features/wholesale/supplierVouchers";
import {
  shipmentPairs,
  shipmentStatus,
  type Shipment,
} from "@renderer/components/features/wholesale/shipments";
import { stockLines, type StockLine } from "@renderer/components/features/wholesale/stock";

type ReportTab = "sales" | "inventory" | "payments" | "delivery";

const REPORT_TABS: Array<{
  id: ReportTab;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  { id: "sales", label: "Sales", description: "Orders and revenue", icon: <SalesIcon /> },
  { id: "inventory", label: "Inventory", description: "Stock and movements", icon: <InventoryIcon /> },
  { id: "payments", label: "Payments", description: "Receivables and payables", icon: <DollarIcon /> },
  { id: "delivery", label: "Delivery", description: "Shipments and status", icon: <TruckIcon /> },
];

const QUERY_KEYS = {
  orders: ["wholesale", "reports", "orders"] as const,
  vouchers: ["wholesale", "reports", "vouchers"] as const,
  shipments: ["wholesale", "reports", "shipments"] as const,
  inventory: ["wholesale", "reports", "inventory"] as const,
  receivings: ["wholesale", "reports", "receivings"] as const,
};

function inDateRange(value: string, fromDate: string, toDate: string): boolean {
  const date = value.slice(0, 10);
  return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
}

function statusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function EmptyRows({ colSpan, children }: { colSpan: number; children: string }): React.JSX.Element {
  return (
    <Tr>
      <Td colSpan={colSpan} className="py-10 text-center text-sm text-text-muted">
        {children}
      </Td>
    </Tr>
  );
}

function ReportSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Panel className="border-border-strong">
      <div className="border-b border-border px-5 py-4">
        <h2 className="font-semibold text-text-primary">{title}</h2>
        <p className="mt-1 text-sm text-text-muted">{description}</p>
      </div>
      {children}
    </Panel>
  );
}

function ReportTabs({
  active,
  onChange,
}: {
  active: ReportTab;
  onChange: (tab: ReportTab) => void;
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-border-strong bg-bg-base p-2 lg:grid-cols-4">
      {REPORT_TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
            active === tab.id
              ? "bg-brand-subtle text-brand"
              : "text-text-muted hover:bg-bg-subtle hover:text-text-primary"
          }`}
        >
          <span className="shrink-0">{tab.icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{tab.label}</span>
            <span className="mt-0.5 block truncate text-xs text-text-muted">
              {tab.description}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export default function ReportsPage({ session }: { session: Session }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ReportTab>("sales");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const ordersQuery = useQuery({
    queryKey: QUERY_KEYS.orders,
    queryFn: () => fetchJson<CustomerOrder[]>(CUSTOMER_ORDERS_URL, session),
  });
  const vouchersQuery = useQuery({
    queryKey: QUERY_KEYS.vouchers,
    queryFn: () => fetchJson<SupplierVoucherWire[]>(SUPPLIER_VOUCHERS_URL, session),
  });
  const shipmentsQuery = useQuery({
    queryKey: QUERY_KEYS.shipments,
    queryFn: () => fetchJson<ShipmentWire[]>(SHIPMENTS_URL, session),
  });
  const inventoryQuery = useQuery({
    queryKey: QUERY_KEYS.inventory,
    queryFn: () => fetchJson<InventoryMovementWire[]>(WHOLESALE_INVENTORY_URL, session),
  });
  const receivingsQuery = useQuery({
    queryKey: QUERY_KEYS.receivings,
    queryFn: () => fetchJson<ReceivingWire[]>(RECEIVINGS_URL, session),
  });

  useLoadErrorToast(ordersQuery.isError, "sales report");
  useLoadErrorToast(vouchersQuery.isError, "payment report supplier data");
  useLoadErrorToast(shipmentsQuery.isError, "delivery report");
  useLoadErrorToast(inventoryQuery.isError, "inventory report");
  useLoadErrorToast(receivingsQuery.isError, "payment report shipment costs");

  const isLoading = [
    ordersQuery,
    vouchersQuery,
    shipmentsQuery,
    inventoryQuery,
    receivingsQuery,
  ].some((query) => query.isLoading);
  const isRefreshing = [
    ordersQuery,
    vouchersQuery,
    shipmentsQuery,
    inventoryQuery,
    receivingsQuery,
  ].some((query) => query.isFetching);
  const hasError = [
    ordersQuery,
    vouchersQuery,
    shipmentsQuery,
    inventoryQuery,
    receivingsQuery,
  ].every((query) => query.isError);

  const orders = useMemo(
    () => (ordersQuery.data ? ordersFromWire(ordersQuery.data) : []),
    [ordersQuery.data],
  );
  const vouchers = useMemo(
    () => (vouchersQuery.data ? vouchersFromWire(vouchersQuery.data) : []),
    [vouchersQuery.data],
  );
  const shipments = useMemo(
    () => (shipmentsQuery.data ? shipmentsFromWire(shipmentsQuery.data) : []),
    [shipmentsQuery.data],
  );
  const movements = useMemo(
    () =>
      inventoryQuery.data
        ? inventoryMovementsFromWire(inventoryQuery.data)
        : [],
    [inventoryQuery.data],
  );
  const receivings = useMemo(
    () =>
      receivingsQuery.data ? receivingsFromWire(receivingsQuery.data) : [],
    [receivingsQuery.data],
  );

  const filteredOrders = useMemo(
    () => orders.filter((order) => inDateRange(order.order_date, fromDate, toDate)),
    [fromDate, orders, toDate],
  );
  const filteredVouchers = useMemo(
    () => vouchers.filter((voucher) => inDateRange(voucher.voucher_date, fromDate, toDate)),
    [fromDate, toDate, vouchers],
  );
  const filteredShipments = useMemo(
    () => shipments.filter((shipment) => inDateRange(shipment.sent_on, fromDate, toDate)),
    [fromDate, shipments, toDate],
  );
  const filteredMovements = useMemo(
    () => movements.filter((movement) => inDateRange(movement.moved_on, fromDate, toDate)),
    [fromDate, movements, toDate],
  );
  const filteredReceivings = useMemo(
    () => receivings.filter((receiving) => inDateRange(receiving.received_on, fromDate, toDate)),
    [fromDate, receivings, toDate],
  );
  const inventoryRows = useMemo(
    () => stockLines(filteredMovements),
    [filteredMovements],
  );

  const salesTotal = filteredOrders.reduce((sum, order) => sum + orderAmount(order), 0);
  const salesQuantity = filteredOrders.reduce(
    (sum, order) => sum + order.total_quantity_pairs,
    0,
  );
  const salesOutstanding = filteredOrders.reduce((sum, order) => sum + orderBalance(order), 0);
  const customerPaid = filteredOrders.reduce((sum, order) => sum + paidOrderAmount(order), 0);
  const supplierOutstanding = filteredVouchers.reduce((sum, voucher) => sum + voucherBalance(voucher), 0);
  const shipmentCosts = filteredReceivings.reduce(
    (sum, receiving) => sum + receiving.costs.reduce((costTotal, cost) => costTotal + cost.amount, 0),
    0,
  );
  const availablePairs = inventoryRows.reduce(
    (sum, row) => sum + row.quantity_available_pairs,
    0,
  );
  const incomingPairs = filteredMovements
    .filter((movement) => movement.movement_type === "in")
    .reduce((sum, movement) => sum + movement.quantity_pairs, 0);
  const outgoingPairs = filteredMovements
    .filter((movement) => movement.movement_type === "out")
    .reduce((sum, movement) => sum + movement.quantity_pairs, 0);
  const zeroStockCount = new Set(
    inventoryRows
      .filter((row) => row.quantity_available_pairs <= 0)
      .map((row) => row.stock_code),
  ).size;
  const deliveredShipments = filteredShipments.filter(
    (shipment) => shipmentStatus(shipment) === "completed",
  ).length;
  const inTransitShipments = filteredShipments.length - deliveredShipments;
  const deliveredPairs = filteredShipments
    .filter((shipment) => shipmentStatus(shipment) === "completed")
    .reduce((sum, shipment) => sum + shipmentPairs(shipment), 0);

  async function refreshReports(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.orders }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.vouchers }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.shipments }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.inventory }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.receivings }),
    ]);
  }

  if (isLoading && !ordersQuery.data && !vouchersQuery.data) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-text-muted" />
      </div>
    );
  }
  if (hasError && !ordersQuery.data && !vouchersQuery.data) {
    return (
      <EmptyState
        icon={<SalesIcon />}
        title="Could not load reports"
        description="Check the connection and try again."
      />
    );
  }

  const metrics: Array<{
    label: string;
    value: string;
    sub: string;
    tone: Tone;
  }> =
    tab === "sales"
      ? [
          { label: "Total sales", value: formatKyat(salesTotal), sub: `${formatQty(filteredOrders.length)} orders`, tone: "brand" },
          { label: "Total quantity", value: formatQty(salesQuantity), sub: "pairs ordered", tone: "neutral" },
          { label: "Outstanding", value: formatKyat(salesOutstanding), sub: "customer receivables", tone: salesOutstanding > 0 ? "error" : "success" },
          { label: "Not finished", value: formatQty(filteredOrders.filter((order) => remainingQty(order) > 0).length), sub: "orders still in progress", tone: "warning" },
        ]
      : tab === "inventory"
        ? [
            { label: "Available stock", value: formatQty(availablePairs), sub: "pairs available", tone: "success" },
            { label: "Incoming", value: formatQty(incomingPairs), sub: "pairs received", tone: "brand" },
            { label: "Outgoing", value: formatQty(outgoingPairs), sub: "pairs delivered", tone: "warning" },
            { label: "Zero stock", value: formatQty(zeroStockCount), sub: "products need replenishment", tone: zeroStockCount > 0 ? "error" : "success" },
          ]
        : tab === "payments"
          ? [
              { label: "Customer receivable", value: formatKyat(salesOutstanding), sub: `${formatQty(filteredOrders.length)} orders`, tone: salesOutstanding > 0 ? "error" : "success" },
              { label: "Supplier payable", value: formatKyat(supplierOutstanding), sub: `${formatQty(filteredVouchers.length)} vouchers`, tone: supplierOutstanding > 0 ? "error" : "success" },
              { label: "Customer paid", value: formatKyat(customerPaid), sub: "recorded payments", tone: "success" },
              { label: "Shipment costs", value: formatKyat(shipmentCosts), sub: "cargo and receiving costs", tone: "neutral" },
            ]
          : [
              { label: "Total shipments", value: formatQty(filteredShipments.length), sub: "shipments in period", tone: "brand" },
              { label: "Delivered", value: formatQty(deliveredShipments), sub: `${formatQty(deliveredPairs)} pairs delivered`, tone: "success" },
              { label: "In progress", value: formatQty(inTransitShipments), sub: "shipments not completed", tone: inTransitShipments > 0 ? "warning" : "success" },
              { label: "Delivery rate", value: `${filteredShipments.length ? Math.round((deliveredShipments / filteredShipments.length) * 100) : 0}%`, sub: "shipments completed", tone: deliveredShipments === filteredShipments.length ? "success" : "warning" },
            ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">Reports</h1>
          <p className="mt-1 text-sm text-text-muted">
            Review sales, inventory, payments, and delivery performance.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void refreshReports()} loading={isRefreshing}>
          Refresh
        </Button>
      </header>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
        <Input
          label="From date"
          type="date"
          value={fromDate}
          onChange={(event) => setFromDate(event.target.value)}
        />
        <Input
          label="To date"
          type="date"
          value={toDate}
          onChange={(event) => setToDate(event.target.value)}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setFromDate("");
            setToDate("");
          }}
          disabled={!fromDate && !toDate}
        >
          Clear dates
        </Button>
      </div>

      <ReportTabs active={tab} onChange={setTab} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <FigureCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            sub={metric.sub}
            tone={metric.tone}
            className="border-border-strong"
          />
        ))}
      </div>

      {tab === "sales" && (
        <ReportSection title="Sales report" description="Customer orders and sales totals for the selected period.">
          <TableContainer className="rounded-none border-0">
            <Thead>
              <Tr>
                <Th>Order</Th>
                <Th>Customer</Th>
                <Th>Date</Th>
                <Th className="text-right">Quantity</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Balance</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filteredOrders.length === 0 ? (
                <EmptyRows colSpan={7}>No sales found for this period.</EmptyRows>
              ) : (
                filteredOrders.map((order) => (
                  <Tr key={order.order_id}>
                    <Td className="font-semibold text-brand">{order.order_no}</Td>
                    <Td className="font-medium">{order.customer_name}</Td>
                    <Td>{formatDate(order.order_date)}</Td>
                    <Td className="text-right tabular-nums">{formatQty(order.total_quantity_pairs)}</Td>
                    <Td className="text-right tabular-nums whitespace-nowrap">{formatKyat(orderAmount(order))}</Td>
                    <Td className="text-right tabular-nums whitespace-nowrap">{formatKyat(orderBalance(order))}</Td>
                    <Td>{statusLabel(order.order_status)}</Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </TableContainer>
        </ReportSection>
      )}

      {tab === "inventory" && (
        <ReportSection title="Inventory report" description="Stock balances and movement totals for the selected period.">
          <TableContainer className="rounded-none border-0">
            <Thead>
              <Tr>
                <Th>Stock code</Th>
                <Th>Description</Th>
                <Th>Location</Th>
                <Th className="text-right">Incoming</Th>
                <Th className="text-right">Outgoing</Th>
                <Th className="text-right">Available</Th>
                <Th>Last moved</Th>
              </Tr>
            </Thead>
            <Tbody>
              {inventoryRows.length === 0 ? (
                <EmptyRows colSpan={7}>No inventory movements found for this period.</EmptyRows>
              ) : (
                inventoryRows.map((row: StockLine) => (
                  <Tr key={`${row.stock_code}-${row.location}`}>
                    <Td className="font-semibold text-brand">{row.stock_code}</Td>
                    <Td>{row.description}</Td>
                    <Td>{row.location}</Td>
                    <Td className="text-right tabular-nums">{formatQty(row.quantity_in_pairs)}</Td>
                    <Td className="text-right tabular-nums">{formatQty(row.quantity_out_pairs)}</Td>
                    <Td className={`text-right font-semibold tabular-nums ${row.quantity_available_pairs <= 0 ? "text-error" : "text-success"}`}>
                      {formatQty(row.quantity_available_pairs)}
                    </Td>
                    <Td>{row.last_moved_on ? formatDate(row.last_moved_on) : "—"}</Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </TableContainer>
        </ReportSection>
      )}

      {tab === "payments" && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          <ReportSection title="Customer receivables" description="Amounts customers still owe on their orders.">
            <TableContainer className="rounded-none border-0">
              <Thead>
                <Tr>
                  <Th>Customer</Th>
                  <Th>Order</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Balance</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filteredOrders.length === 0 ? (
                  <EmptyRows colSpan={4}>No customer receivables found.</EmptyRows>
                ) : (
                  filteredOrders.map((order) => (
                    <Tr key={order.order_id}>
                      <Td className="font-medium">{order.customer_name}</Td>
                      <Td className="font-semibold text-brand">{order.order_no}</Td>
                      <Td className="text-right tabular-nums whitespace-nowrap">{formatKyat(orderAmount(order))}</Td>
                      <Td className="text-right font-semibold tabular-nums whitespace-nowrap">{formatKyat(orderBalance(order))}</Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </TableContainer>
          </ReportSection>
          <ReportSection title="Supplier payables" description="Amounts still owed to suppliers for their vouchers.">
            <TableContainer className="rounded-none border-0">
              <Thead>
                <Tr>
                  <Th>Supplier</Th>
                  <Th>Voucher</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Balance</Th>
                </Tr>
              </Thead>
              <Tbody>
                {filteredVouchers.length === 0 ? (
                  <EmptyRows colSpan={4}>No supplier payables found.</EmptyRows>
                ) : (
                  filteredVouchers.map((voucher) => (
                    <Tr key={voucher.voucher_id}>
                      <Td className="font-medium">{voucher.supplier_name}</Td>
                      <Td className="font-semibold text-brand">{voucher.voucher_no}</Td>
                      <Td className="text-right tabular-nums whitespace-nowrap">{formatKyat(voucherAmount(voucher))}</Td>
                      <Td className="text-right font-semibold tabular-nums whitespace-nowrap">{formatKyat(voucherBalance(voucher))}</Td>
                    </Tr>
                  ))
                )}
              </Tbody>
            </TableContainer>
          </ReportSection>
        </div>
      )}

      {tab === "delivery" && (
        <ReportSection title="Delivery report" description="Shipment progress and delivered quantities for the selected period.">
          <TableContainer className="rounded-none border-0">
            <Thead>
              <Tr>
                <Th>Shipment</Th>
                <Th>Supplier</Th>
                <Th>Sent date</Th>
                <Th>Destination</Th>
                <Th className="text-right">Packages</Th>
                <Th className="text-right">Pairs</Th>
                <Th>Status</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filteredShipments.length === 0 ? (
                <EmptyRows colSpan={7}>No deliveries found for this period.</EmptyRows>
              ) : (
                filteredShipments.map((shipment: Shipment) => (
                  <Tr key={shipment.shipment_id}>
                    <Td className="font-semibold text-brand">{shipment.shipment_no}</Td>
                    <Td className="font-medium">{shipment.supplier_name}</Td>
                    <Td>{formatDate(shipment.sent_on)}</Td>
                    <Td>{shipment.final_destination}</Td>
                    <Td className="text-right tabular-nums">{formatQty(shipment.total_packages)}</Td>
                    <Td className="text-right tabular-nums">{formatQty(shipmentPairs(shipment))}</Td>
                    <Td>{statusLabel(shipmentStatus(shipment))}</Td>
                  </Tr>
                ))
              )}
            </Tbody>
          </TableContainer>
        </ReportSection>
      )}
    </div>
  );
}
