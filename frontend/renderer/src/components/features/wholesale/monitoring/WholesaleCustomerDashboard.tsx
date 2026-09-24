import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { Badge, type BadgeVariant } from "@renderer/components/ui/Badge";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  RefreshingHint,
  StatTile,
} from "@renderer/components/features/dashboard/shared";
import { formatCount } from "@renderer/components/features/dashboard/helpers";
import { formatDate } from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import {
  DashboardCard,
  DashboardError,
  DashboardFooter,
  DashboardLoading,
  DonutChart,
  RankedBars,
} from "./dashboardParts";
import { formatMmk, formatShare, SERIES_COLORS } from "./dashboardFormat";
import {
  dashboardTabUrl,
  type AwaitingOrderStatus,
  type CustomerDashboardData,
  type DashboardWindow,
} from "./dashboardApi";

const STATUS_LABEL: Record<
  AwaitingOrderStatus,
  { label: string; variant: BadgeVariant }
> = {
  partly_delivered: { label: "Partly delivered", variant: "warning" },
  ready_to_deliver: { label: "Ready to deliver", variant: "success" },
  waiting_for_stock: { label: "Waiting for stock", variant: "info" },
};

function signed(value: number): string {
  return value > 0 ? `+${formatCount(value)}` : formatCount(value);
}

/** The wholesale Dashboard's Customer tab: who ordered, what they ordered, and which
 *  orders still need following up. */
export function WholesaleCustomerDashboard({
  session,
  window,
  onOpenOrder,
}: {
  session: Session;
  window: DashboardWindow;
  onOpenOrder?: (orderId: string) => void;
}): React.JSX.Element {
  const { data, isRefreshing, failed, reload } =
    useUrlQuery<CustomerDashboardData>(
      dashboardTabUrl("customer", window),
      session,
      "Customer dashboard",
    );

  if (data === undefined) {
    return failed ? (
      <DashboardError title="Customer" reload={reload} />
    ) : (
      <DashboardLoading tiles={4} />
    );
  }

  const active = data.active_customers;
  const change =
    active.previous_value === null
      ? null
      : active.value - active.previous_value;
  const status = data.delivery_status;

  return (
    <div className="flex flex-col gap-3">
      <RefreshingHint show={isRefreshing} />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 sm:gap-3">
        <StatTile
          label="Active Customers"
          description="Customers with an order this period."
          value={formatCount(active.value)}
          sub={
            change === null
              ? "no earlier period to compare"
              : `${signed(change)} vs previous period`
          }
        />
        <StatTile
          label="New Customers"
          description="Customers with their first order."
          value={formatCount(data.new_customers.value)}
          sub="first recorded order"
        />
        <StatTile
          label="Repeat Customers"
          description="Customers who ordered before."
          value={formatCount(data.repeat_customers.value)}
          sub={`${formatShare(data.repeat_customers.share_of_active_pct)} of active customers`}
        />
        <StatTile
          label="Open Orders"
          description="Orders not fully delivered."
          value={formatCount(data.open_orders)}
          sub="awaiting full delivery"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <DashboardCard
          title="Top Customers by Order Value"
          description="Customers ranked by non-cancelled order value"
        >
          {data.top_customers.length > 0 && (
            <div className="mb-4 flex items-baseline justify-between border-b border-border pb-3 text-sm">
              <span className="text-text-secondary">Total ordered value</span>
              <span className="text-lg font-semibold tabular-nums text-text-primary">
                {formatMmk(data.total_ordered_value)}
              </span>
            </div>
          )}
          <RankedBars
            rows={data.top_customers.map((customer) => ({
              label: customer.customer_name,
              value: customer.ordered_value,
            }))}
            formatValue={formatMmk}
            empty="No orders were placed in this period."
          />
        </DashboardCard>

        <DashboardCard
          title="Customer Delivery Status"
          description="Orders placed in the period, by how much has been delivered"
        >
          <div className="flex flex-wrap items-center justify-center gap-6 py-2">
            <DonutChart
              centerValue={formatCount(data.order_count)}
              centerLabel="orders"
              slices={[
                {
                  label: "Fulfilled",
                  value: status.fulfilled,
                  color: SERIES_COLORS.green,
                },
                {
                  label: "Partly delivered",
                  value: status.partly_delivered,
                  color: SERIES_COLORS.purple,
                },
                {
                  label: "Awaiting delivery",
                  value: status.awaiting_delivery,
                  color: SERIES_COLORS.amber,
                },
              ]}
            />
            <ul className="flex flex-col gap-2.5 text-sm">
              {[
                {
                  label: "Fulfilled",
                  value: status.fulfilled,
                  color: SERIES_COLORS.green,
                },
                {
                  label: "Partly delivered",
                  value: status.partly_delivered,
                  color: SERIES_COLORS.purple,
                },
                {
                  label: "Awaiting delivery",
                  value: status.awaiting_delivery,
                  color: SERIES_COLORS.amber,
                },
              ].map((item) => (
                <li key={item.label} className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: item.color }}
                  />
                  <span className="w-36 text-text-secondary">{item.label}</span>
                  <span className="font-semibold tabular-nums text-text-primary">
                    {formatCount(item.value)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </DashboardCard>
      </div>

      <DashboardCard
        title="Orders Awaiting Delivery"
        description="Customers and orders that need follow-up"
      >
        <TableContainer>
          <Thead>
            <Tr>
              <Th>Customer</Th>
              <Th>Order</Th>
              <Th>Order date</Th>
              <Th className="text-right">Remaining</Th>
              <Th>Status</Th>
            </Tr>
          </Thead>
          <Tbody>
            {data.awaiting_orders.length === 0 ? (
              <Tr>
                <Td
                  colSpan={5}
                  className="py-8 text-center text-sm text-text-muted"
                >
                  Every order has been delivered.
                </Td>
              </Tr>
            ) : (
              data.awaiting_orders.map((order) => {
                const meta = STATUS_LABEL[order.status];
                return (
                  <Tr key={order.order_id}>
                    <Td className="font-medium text-text-primary">
                      {order.customer_name}
                    </Td>
                    <Td>
                      {onOpenOrder ? (
                        <button
                          type="button"
                          onClick={() => onOpenOrder(order.order_id)}
                          className="font-medium text-brand hover:underline"
                        >
                          {order.order_no}
                        </button>
                      ) : (
                        order.order_no
                      )}
                    </Td>
                    <Td>{formatDate(order.order_date)}</Td>
                    <Td className="text-right tabular-nums">
                      {formatSets(order.remaining_pairs)}
                    </Td>
                    <Td>
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                    </Td>
                  </Tr>
                );
              })
            )}
          </Tbody>
        </TableContainer>
        {data.open_orders > data.awaiting_orders.length && (
          <p className="mt-3 text-xs text-text-muted">
            Showing the newest {data.awaiting_orders.length} of{" "}
            {formatCount(data.open_orders)} open orders.
          </p>
        )}
      </DashboardCard>

      <DashboardFooter note="Orders use order date · Delivery status uses delivered quantities" />
    </div>
  );
}
