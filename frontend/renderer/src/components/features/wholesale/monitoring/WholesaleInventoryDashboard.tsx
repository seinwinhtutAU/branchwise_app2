import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import {
  RefreshingHint,
  StatTile,
} from "@renderer/components/features/dashboard/shared";
import { formatCount } from "@renderer/components/features/dashboard/helpers";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import {
  DashboardCard,
  DashboardError,
  DashboardFooter,
  DashboardLoading,
  RankedBars,
} from "./dashboardParts";
import { SERIES_COLORS } from "./dashboardFormat";
import { dashboardTabUrl, type InventoryDashboardData } from "./dashboardApi";

const PAIRS_PER_SET = 6;

function sets(pairs: number): number {
  return pairs / PAIRS_PER_SET;
}

function groupLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function FlowStep({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "plain" | "brand" | "purple" | "green";
}): React.JSX.Element {
  const background = {
    plain: "var(--color-bg-subtle)",
    brand: "var(--color-brand-subtle)",
    purple: "#f1e9fb",
    green: "#e6f5ee",
  }[tone];
  return (
    <div
      className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-lg px-2 py-5"
      style={{ background }}
    >
      <span className="text-2xl font-bold tabular-nums text-text-primary">
        {formatCount(sets(value))}
      </span>
      <span className="mt-1 text-xs text-text-muted">{label}</span>
    </div>
  );
}

const Arrow = (): React.JSX.Element => (
  <span aria-hidden className="shrink-0 self-center text-text-muted">
    ›
  </span>
);

/** The wholesale Dashboard's Inventory tab: where the stock is right now and how much of
 *  it is spoken for. A point in time — it has no period. */
export function WholesaleInventoryDashboard({
  session,
}: {
  session: Session;
}): React.JSX.Element {
  const { data, isRefreshing, failed, reload } = useUrlQuery<InventoryDashboardData>(
    dashboardTabUrl("inventory"),
    session,
    "Inventory dashboard",
  );

  if (data === undefined) {
    return failed ? (
      <DashboardError title="Inventory" reload={reload} />
    ) : (
      <DashboardLoading tiles={6} />
    );
  }

  const groupTotals = data.groups.map(
    (group) => group.available_pairs + group.committed_pairs + group.incoming_pairs,
  );
  const widest = Math.max(...groupTotals, 1);
  const locationColors = [SERIES_COLORS.primary, SERIES_COLORS.green, SERIES_COLORS.amber, SERIES_COLORS.purple];

  return (
    <div className="flex flex-col gap-3">
      <RefreshingHint show={isRefreshing} />
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6 sm:gap-3">
        <StatTile
          label="Total Inventory Items"
          value={formatCount(data.total_products)}
          sub="products being managed"
        />
        <StatTile
          label="Physical Stock"
          value={formatSets(data.on_hand_pairs)}
          sub="received and on hand"
        />
        <StatTile
          label="Available to Sell"
          value={formatSets(data.available_pairs)}
          sub="not committed"
        />
        <StatTile
          label="Customer Committed"
          value={formatSets(data.committed_pairs)}
          sub="reserved for orders"
        />
        <StatTile
          label="Incoming Stock"
          value={formatSets(data.incoming_pairs)}
          sub={`${formatCount(sets(data.at_supplier_pairs))} supplier · ${formatCount(sets(data.in_transit_pairs))} transit`}
        />
        <StatTile
          label="Customer Backlog"
          value={formatSets(data.backlog_pairs)}
          sub="still owed to customers"
        />
      </div>

      <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-3">
        <DashboardCard
          className="lg:col-span-2"
          title="Inventory Flow"
          description="Current position across the wholesale pipeline (sets)"
        >
          <div className="flex items-stretch gap-1.5 sm:gap-2">
            <FlowStep value={data.at_supplier_pairs} label="At supplier" tone="plain" />
            <Arrow />
            <FlowStep value={data.in_transit_pairs} label="In transit" tone="plain" />
            <Arrow />
            <FlowStep value={data.on_hand_pairs} label="On hand" tone="brand" />
            <Arrow />
            <FlowStep value={data.committed_pairs} label="Committed" tone="purple" />
            <Arrow />
            <FlowStep value={data.available_pairs} label="Available" tone="green" />
          </div>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-xs text-text-muted">
            <span>Incoming: {formatSets(data.incoming_pairs)}</span>
            <span>Physical: {formatSets(data.on_hand_pairs)}</span>
            <span>Sellable: {formatSets(data.available_pairs)}</span>
          </div>
        </DashboardCard>

        <DashboardCard title="Stock by Location" description="Physical stock distribution">
          {data.locations.length > 0 && (
            <div className="mb-4 flex items-baseline justify-between border-b border-border pb-3 text-sm">
              <span className="text-text-secondary">Total physical stock</span>
              <span className="text-lg font-semibold tabular-nums text-text-primary">
                {formatSets(data.on_hand_pairs)}
              </span>
            </div>
          )}
          <RankedBars
            rows={data.locations.map((location) => ({
              label: location.location,
              value: sets(location.on_hand_pairs),
            }))}
            colors={data.locations.map((_, index) => locationColors[index % locationColors.length])}
            formatValue={(value) => formatCount(value)}
            empty="No stock is on hand."
          />
        </DashboardCard>
      </div>

      <DashboardCard
        title="Stock Composition by Product Group"
        description="Available, customer-committed, and incoming stock by product group (sets)"
      >
        {data.groups.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">No products are being managed yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {data.groups.map((group, index) => (
              <div key={group.product_group} className="flex items-center gap-3 text-sm">
                <span className="w-16 shrink-0 text-text-secondary">{groupLabel(group.product_group)}</span>
                <div className="flex h-7 flex-1 overflow-hidden rounded-sm bg-bg-raised">
                  {[
                    { pairs: group.available_pairs, color: SERIES_COLORS.primary, label: "Available" },
                    { pairs: group.committed_pairs, color: SERIES_COLORS.purple, label: "Customer committed" },
                    { pairs: group.incoming_pairs, color: SERIES_COLORS.amber, label: "Incoming" },
                  ].map((segment) => (
                    <div
                      key={segment.label}
                      title={`${segment.label}: ${formatSets(segment.pairs)}`}
                      style={{
                        width: `${(segment.pairs / widest) * 100}%`,
                        background: segment.color,
                      }}
                    />
                  ))}
                </div>
                <span className="w-14 shrink-0 text-right font-semibold tabular-nums text-text-primary">
                  {formatCount(sets(groupTotals[index]))}
                </span>
              </div>
            ))}
            <div className="flex flex-wrap gap-4 pl-[76px] text-xs text-text-muted">
              {[
                { label: "Available", color: SERIES_COLORS.primary },
                { label: "Customer committed", color: SERIES_COLORS.purple },
                { label: "Incoming", color: SERIES_COLORS.amber },
              ].map((item) => (
                <span key={item.label} className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </DashboardCard>

      <DashboardFooter note="Quantities shown in sets · 1 set = 6 pairs" />
    </div>
  );
}
