import { useQuery } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { Badge } from "@renderer/components/ui/Badge";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  DashboardIcon,
  ReceivingIcon,
  TruckIcon,
  VoucherIcon,
} from "@renderer/components/ui/icons";
import {
  formatDate,
  formatKyat,
  formatQty,
} from "@renderer/components/features/wholesale/shared";
import {
  FigureCard,
  Panel,
} from "@renderer/components/features/wholesale/ui";
import {
  WHOLESALE_MONITORING_URL,
  type MonitoringActivityRow,
  type MonitoringOrderRow,
  type MonitoringProductRow,
  type MonitoringShipmentRow,
  type MonitoringSnapshot,
  type MonitoringVoucherRow,
} from "@renderer/components/features/wholesale/api";

const MONITORING_QUERY_KEY = ["wholesale", "monitoring"] as const;
const VISIBLE_ROWS = 3;

function relativeTime(value: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    allocating: "Allocating",
    in_transit: "In transit",
    partly_delivered: "Partly delivered",
    ready_to_deliver: "Ready to deliver",
    waiting_at_cargo: "Waiting at cargo",
  };
  return labels[value] ?? value.replaceAll("_", " ");
}

function Count({
  value,
  tone = "neutral",
}: {
  value: number;
  tone?: "neutral" | "warning" | "error" | "success";
}): React.JSX.Element {
  return (
    <span
      className={`text-sm font-semibold tabular-nums ${
        tone === "error"
          ? "text-error"
          : tone === "warning"
            ? "text-warning"
            : tone === "success"
              ? "text-success"
              : "text-text-secondary"
      }`}
    >
      {formatQty(value)}
    </span>
  );
}

function PanelHeader({
  title,
  count,
  tone = "warning",
  summary,
}: {
  title: string;
  count: number;
  tone?: "warning" | "error" | "success";
  summary: string;
}): React.JSX.Element {
  const color = count > 0
    ? tone === "error"
      ? "text-error"
      : tone === "success"
        ? "text-success"
        : "text-warning"
    : "text-success";
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-4 border-b border-border">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-text-primary">
          {title}
        </h2>
        <p className="mt-1 text-xs text-text-muted">{summary}</p>
      </div>
      <div className={`shrink-0 text-xl font-bold leading-none tabular-nums ${color}`}>
        {formatQty(count)}
      </div>
    </div>
  );
}

function EmptyLine({ children }: { children: string }): React.JSX.Element {
  return <p className="px-4 py-5 text-xs text-text-muted">{children}</p>;
}

function CompactList<T>({
  rows,
  empty,
  children,
}: {
  rows: T[];
  empty: string;
  children: (row: T) => React.JSX.Element;
}): React.JSX.Element {
  const visible = rows.slice(0, VISIBLE_ROWS);
  if (visible.length === 0) return <EmptyLine>{empty}</EmptyLine>;
  return <div className="divide-y divide-border">{visible.map(children)}</div>;
}

function SignalButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="w-full px-4 py-2.5 text-left hover:bg-bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand transition-colors"
    >
      {children}
    </button>
  );
}

function MoreHint({ count }: { count: number }): React.JSX.Element | null {
  return count > VISIBLE_ROWS ? (
    <p className="px-4 py-2 border-t border-border text-[11px] text-text-muted">
      +{count - VISIBLE_ROWS} more — open the full list from the sidebar
    </p>
  ) : null;
}

function ActivityItem({
  activity,
  onOpenOrder,
  onOpenVoucher,
  onOpenReceiving,
}: {
  activity: MonitoringActivityRow;
  onOpenOrder: (id: string) => void;
  onOpenVoucher: (id: string) => void;
  onOpenReceiving: (receivingNo: string) => void;
}): React.JSX.Element {
  const target =
    activity.type === "receiving"
      ? activity.receiving_no
        ? () => onOpenReceiving(activity.receiving_no!)
        : undefined
      : activity.order_id
        ? () => onOpenOrder(activity.order_id!)
        : activity.voucher_id
          ? () => onOpenVoucher(activity.voucher_id!)
          : undefined;
  const description =
    activity.type === "receiving"
      ? `Received ${activity.receiving_no ?? "shipment"} from ${activity.supplier_name ?? "supplier"}`
      : activity.type === "delivery"
        ? `Delivered ${activity.stock_code ?? "goods"} to ${activity.customer_name ?? "customer"}`
        : `Recorded ${formatKyat(activity.amount ?? 0)} payment${activity.voucher_no ? ` for ${activity.voucher_no}` : activity.order_no ? ` for ${activity.order_no}` : ""}`;
  const Icon =
    activity.type === "receiving"
      ? ReceivingIcon
      : activity.type === "delivery"
        ? TruckIcon
        : VoucherIcon;
  return (
    <button
      type="button"
      onClick={target}
      disabled={!target}
      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left hover:bg-bg-subtle disabled:hover:bg-transparent disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
    >
      <span className="w-7 h-7 shrink-0 rounded-full bg-brand-subtle text-brand flex items-center justify-center">
        <Icon className="w-3.5 h-3.5" />
      </span>
      <span className="min-w-0 flex-1 truncate text-xs text-text-primary">
        {description}
      </span>
      <time
        className="shrink-0 text-[11px] text-text-muted"
        dateTime={activity.created_at}
      >
        {relativeTime(activity.created_at)}
      </time>
    </button>
  );
}

export default function MonitoringDashboardPage({
  session,
  onOpenShipment,
  onOpenOrder,
  onOpenVoucher,
  onOpenReceiving,
  onOpenStock,
}: {
  session: Session;
  onOpenShipment: (id: string) => void;
  onOpenOrder: (id: string) => void;
  onOpenVoucher: (id: string) => void;
  onOpenReceiving: (receivingNo: string) => void;
  onOpenStock: (stockCode: string) => void;
}): React.JSX.Element {
  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: MONITORING_QUERY_KEY,
    queryFn: () =>
      fetchJson<MonitoringSnapshot>(WHOLESALE_MONITORING_URL, session),
    refetchInterval: 45_000,
  });
  useLoadErrorToast(isError, "wholesale dashboard");

  if (isLoading && !data)
    return (
      <div className="flex justify-center py-24">
        <Spinner className="w-6 h-6 text-text-muted" />
      </div>
    );
  if (isError && !data)
    return (
      <EmptyState
        icon={<DashboardIcon />}
        title="Could not load dashboard"
        description="Check the connection and try again."
      />
    );
  if (!data)
    return <EmptyState icon={<DashboardIcon />} title="No dashboard data" />;

  const fulfillmentTotal =
    data.shipments_in_transit.count + data.orders_pending.count;
  const customerReceivable = data.unpaid_orders.rows.reduce(
    (sum, row) => sum + (row.balance_due ?? 0),
    0,
  );
  const supplierPayable = data.unpaid_vouchers.rows.reduce(
    (sum, row) => sum + row.balance_due,
    0,
  );

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Monitor fulfillment, finance, and inventory at a glance.
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1 text-[11px] text-text-muted whitespace-nowrap">
          <span className="w-2 h-2 rounded-full bg-success" aria-hidden="true" />
          {isFetching ? "Refreshing…" : "Live · 45s refresh"}
        </div>
      </header>

      <section className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <FigureCard
          label="Fulfillment"
          value={formatQty(fulfillmentTotal)}
          sub="shipments and orders needing attention"
          tone={fulfillmentTotal > 0 ? "warning" : "success"}
          className="border-border-strong"
        />
        <FigureCard
          label="Customer receivable"
          value={formatKyat(customerReceivable)}
          sub={`${data.unpaid_orders.count} customer orders outstanding`}
          tone={customerReceivable > 0 ? "error" : "success"}
          className="border-border-strong"
        />
        <FigureCard
          label="Supplier payable"
          value={formatKyat(supplierPayable)}
          sub={`${data.unpaid_vouchers.count} supplier vouchers outstanding`}
          tone={supplierPayable > 0 ? "error" : "success"}
          className="border-border-strong"
        />
        <FigureCard
          label="Inventory"
          value={formatQty(data.zero_stock_products.count)}
          sub="products at zero stock"
          tone={data.zero_stock_products.count > 0 ? "error" : "success"}
          className="border-border-strong"
        />
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel className="border-border-strong">
          <PanelHeader
            title="Fulfillment"
            count={
              data.shipments_in_transit.count + data.orders_pending.count
            }
            summary="total shipments and orders needing attention"
          />
          <div className="grid items-start gap-3 p-3 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Shipments in transit
                </span>
                <Count value={data.shipments_in_transit.count} />
              </div>
              <CompactList
                rows={data.shipments_in_transit.rows}
                empty="No shipments in transit."
              >
                {(row: MonitoringShipmentRow) => (
                  <SignalButton
                    key={row.shipment_id}
                    label={`Open shipment ${row.shipment_no}`}
                    onClick={() => onOpenShipment(row.shipment_id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-brand truncate">
                        {row.shipment_no}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-muted">
                        {row.days_in_transit}d
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted truncate">
                      {row.supplier_name} · {statusLabel(row.shipment_status)}
                    </p>
                  </SignalButton>
                )}
              </CompactList>
              <MoreHint count={data.shipments_in_transit.count} />
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Orders pending
                </span>
                <Count value={data.orders_pending.count} />
              </div>
              <CompactList
                rows={data.orders_pending.rows}
                empty="No orders waiting."
              >
                {(row: MonitoringOrderRow) => (
                  <SignalButton
                    key={row.order_id}
                    label={`Open order ${row.order_no}`}
                    onClick={() => onOpenOrder(row.order_id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-brand truncate">
                        {row.order_no}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-muted">
                        {row.days_open ?? 0}d
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted truncate">
                      {row.customer_name} · {statusLabel(row.order_status ?? "pending")}
                    </p>
                  </SignalButton>
                )}
              </CompactList>
              <MoreHint count={data.orders_pending.count} />
            </div>
          </div>
        </Panel>

        <Panel className="border-border-strong">
          <PanelHeader
            title="Finance"
            count={data.unpaid_vouchers.count + data.unpaid_orders.count}
            tone="error"
            summary="total unpaid records"
          />
          <div className="grid items-start gap-3 p-3 lg:grid-cols-2">
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Supplier payable
                </span>
                <Count value={data.unpaid_vouchers.count} tone="error" />
              </div>
              <CompactList
                rows={data.unpaid_vouchers.rows}
                empty="No supplier balances due."
              >
                {(row: MonitoringVoucherRow) => (
                  <SignalButton
                    key={row.voucher_id}
                    label={`Open voucher ${row.voucher_no}`}
                    onClick={() => onOpenVoucher(row.voucher_id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-brand truncate">
                        {row.voucher_no}
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-error">
                        {formatKyat(row.balance_due)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted truncate">
                      {row.supplier_name} · {formatDate(row.voucher_date)}
                    </p>
                  </SignalButton>
                )}
              </CompactList>
              <MoreHint count={data.unpaid_vouchers.count} />
            </div>
            <div className="overflow-hidden rounded-lg border border-border">
              <div className="flex items-center justify-between px-4 pt-3 pb-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Customer receivable
                </span>
                <Count value={data.unpaid_orders.count} tone="error" />
              </div>
              <CompactList
                rows={data.unpaid_orders.rows}
                empty="No customer balances due."
              >
                {(row: MonitoringOrderRow) => (
                  <SignalButton
                    key={row.order_id}
                    label={`Open unpaid order ${row.order_no}`}
                    onClick={() => onOpenOrder(row.order_id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-brand truncate">
                        {row.order_no}
                      </span>
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-error">
                        {formatKyat(row.balance_due ?? 0)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted truncate">
                      {row.customer_name} · {formatDate(row.order_date)}
                    </p>
                  </SignalButton>
                )}
              </CompactList>
              <MoreHint count={data.unpaid_orders.count} />
            </div>
          </div>
        </Panel>

        <Panel className="border-border-strong">
          <PanelHeader
            title="Inventory"
            count={data.zero_stock_products.count}
            tone="error"
            summary="total products at zero stock"
          />
          <CompactList
            rows={data.zero_stock_products.rows}
            empty="Every active product has stock."
          >
            {(row: MonitoringProductRow) => (
              <SignalButton
                key={row.product_id}
                label={`Open stock for ${row.stock_code}`}
                onClick={() => onOpenStock(row.stock_code)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-brand truncate">
                    {row.stock_code}
                  </span>
                  <Badge variant="error" className="px-1.5 py-0 text-[10px]">
                    zero
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-text-muted truncate">
                  {row.description} · {statusLabel(row.product_group)}
                </p>
              </SignalButton>
            )}
          </CompactList>
          <MoreHint count={data.zero_stock_products.count} />
        </Panel>

        <Panel className="border-border-strong">
          <PanelHeader
            title="Recent activity"
            count={data.recent_activity.length}
            tone="success"
            summary="total latest events"
          />
          {data.recent_activity.length === 0 ? (
            <EmptyLine>No recent activity.</EmptyLine>
          ) : (
            <div className="divide-y divide-border">
              {data.recent_activity.slice(0, 5).map((activity) => (
                <ActivityItem
                  key={`${activity.type}-${activity.activity_id}`}
                  activity={activity}
                  onOpenOrder={onOpenOrder}
                  onOpenVoucher={onOpenVoucher}
                  onOpenReceiving={onOpenReceiving}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
