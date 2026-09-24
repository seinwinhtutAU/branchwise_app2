import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
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
import {
  DashboardCard,
  DashboardError,
  DashboardFooter,
  DashboardLoading,
  RankedBars,
} from "./dashboardParts";
import { formatMmk, formatShare, SERIES_COLORS } from "./dashboardFormat";
import {
  dashboardTabUrl,
  type CostDashboardData,
  type DashboardWindow,
} from "./dashboardApi";

/** The wholesale Dashboard's Cost tab: what the goods cost, what it cost to bring them in,
 *  which factories that money went to, and what is still unpaid to them. */
export function WholesaleCostDashboard({
  session,
  window,
  onOpenVoucher,
}: {
  session: Session;
  window: DashboardWindow;
  onOpenVoucher?: (voucherId: string) => void;
}): React.JSX.Element {
  const { data, isRefreshing, failed, reload } = useUrlQuery<CostDashboardData>(
    dashboardTabUrl("cost", window),
    session,
    "Cost dashboard",
  );

  if (data === undefined) {
    return failed ? (
      <DashboardError title="Cost" reload={reload} />
    ) : (
      <DashboardLoading tiles={4} />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <RefreshingHint show={isRefreshing} />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 sm:gap-3">
        <StatTile
          label="Goods Purchased"
          description="Cost paid for products."
          value={formatMmk(data.goods_purchased)}
          sub="cost of products from factories"
        />
        <StatTile
          label="Cost"
          description="Cost to bring goods in."
          value={formatMmk(data.cost_to_bring_in)}
          sub="cost to bring goods in"
        />
        <StatTile
          label="Total Cost"
          description="Goods purchased plus other costs."
          value={formatMmk(data.total_cost)}
          sub="goods purchased + cost"
        />
        <StatTile
          label="Supplier Balance Due"
          description="Amount still owed to suppliers."
          value={formatMmk(data.supplier_balance_due)}
          sub="amount still unpaid"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
        <DashboardCard
          title="What makes up the cost?"
          description="Total cost of bringing wholesale goods into the business"
        >
          <div className="mb-4 flex items-baseline justify-between text-sm">
            <span className="text-text-secondary">Total cost</span>
            <span className="text-lg font-semibold tabular-nums text-text-primary">
              {formatMmk(data.total_cost)}
            </span>
          </div>
          <div className="mb-4 flex h-3.5 overflow-hidden rounded-sm bg-bg-raised">
            <div
              title={`Goods purchased: ${formatShare(data.goods_share_pct)}`}
              style={{
                width: `${data.goods_share_pct}%`,
                background: SERIES_COLORS.primary,
              }}
            />
            <div
              title={`Cost to bring goods in: ${formatShare(data.cost_share_pct)}`}
              style={{
                width: `${data.cost_share_pct}%`,
                background: SERIES_COLORS.amber,
              }}
            />
          </div>
          {[
            {
              label: "Goods purchased",
              value: data.goods_purchased,
              share: data.goods_share_pct,
              color: SERIES_COLORS.primary,
            },
            {
              label: "Cost to bring goods in",
              value: data.cost_to_bring_in,
              share: data.cost_share_pct,
              color: SERIES_COLORS.amber,
            },
          ].map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3 border-t border-border py-3 text-sm"
            >
              <span className="flex items-center gap-2 text-text-secondary">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: row.color }}
                />
                {row.label}
              </span>
              <span className="tabular-nums text-text-primary">
                {formatMmk(row.value)} · {Math.round(row.share)}%
              </span>
            </div>
          ))}
        </DashboardCard>

        <DashboardCard
          title="Cost by Factory"
          description="Which factories account for the purchase cost"
        >
          {data.factories.length > 0 && (
            <div className="mb-4 flex items-baseline justify-between border-b border-border pb-3 text-sm">
              <span className="text-text-secondary">Total goods purchased</span>
              <span className="text-lg font-semibold tabular-nums text-text-primary">
                {formatMmk(data.goods_purchased)}
              </span>
            </div>
          )}
          <RankedBars
            rows={data.factories.map((factory) => ({
              label: factory.factory_name,
              value: factory.purchased,
            }))}
            formatValue={formatMmk}
            empty="No goods were purchased in this period."
          />
          {data.factory_count > data.factories.length && (
            <p className="mt-3 text-xs text-text-muted">
              Showing the top {data.factories.length} of{" "}
              {formatCount(data.factory_count)} factories.
            </p>
          )}
        </DashboardCard>
      </div>

      <DashboardCard
        title="Supplier Payables"
        description="Outstanding balances requiring payment follow-up"
      >
        <TableContainer>
          <Thead>
            <Tr>
              <Th>Supplier</Th>
              <Th>Voucher</Th>
              <Th>Voucher date</Th>
              <Th className="text-right">Balance due</Th>
              <Th className="text-right">Days open</Th>
            </Tr>
          </Thead>
          <Tbody>
            {data.payables.length === 0 ? (
              <Tr>
                <Td
                  colSpan={5}
                  className="py-8 text-center text-sm text-text-muted"
                >
                  Nothing is owed to suppliers.
                </Td>
              </Tr>
            ) : (
              data.payables.map((payable) => (
                <Tr key={payable.voucher_id}>
                  <Td className="font-medium text-text-primary">
                    {payable.supplier_name}
                  </Td>
                  <Td>
                    {onOpenVoucher ? (
                      <button
                        type="button"
                        onClick={() => onOpenVoucher(payable.voucher_id)}
                        className="font-medium text-brand hover:underline"
                      >
                        {payable.voucher_no}
                      </button>
                    ) : (
                      payable.voucher_no
                    )}
                  </Td>
                  <Td>{formatDate(payable.voucher_date)}</Td>
                  <Td className="text-right tabular-nums">
                    {formatMmk(payable.balance_due)}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {formatCount(payable.days_open)}
                  </Td>
                </Tr>
              ))
            )}
          </Tbody>
        </TableContainer>
        {data.payable_count > data.payables.length && (
          <p className="mt-3 text-xs text-text-muted">
            Showing the newest {data.payables.length} of{" "}
            {formatCount(data.payable_count)} unpaid vouchers.
          </p>
        )}
      </DashboardCard>

      <DashboardFooter note="Total cost = goods purchased + cost to bring goods in · Values shown in MMK" />
    </div>
  );
}
