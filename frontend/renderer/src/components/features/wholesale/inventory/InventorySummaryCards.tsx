// InventorySummaryCards — overview panel showing physical + pipeline stock.

import { TruckIcon, WarehouseIcon } from "@renderer/components/ui/icons";
import { Panel } from "@renderer/components/features/wholesale/shared/ui";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { formatQty } from "@renderer/components/features/wholesale/shared/shared";
import { cn } from "@renderer/lib/utils";
import { type StockRecord } from "@renderer/components/features/wholesale/inventory/stock";
import { inventoryHealth } from "./inventoryUtils";
import { type InventorySummaryRow, HEALTH_STYLES, type InventoryHealth } from "./types";

// ── Summary Card ──────────────────────────────────────────────────────────────

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

// ── Inventory Insights (health chart) ─────────────────────────────────────────

export function InventoryInsights({
  records,
}: {
  records: StockRecord[];
}): React.JSX.Element {
  const counts: Record<InventoryHealth, number> = {
    Healthy: records.filter((record) => inventoryHealth(record) === "Healthy").length,
    "Low Stock": records.filter((record) => inventoryHealth(record) === "Low Stock").length,
    "Out of Stock": records.filter((record) => inventoryHealth(record) === "Out of Stock").length,
    Overstock: records.filter((record) => inventoryHealth(record) === "Overstock").length,
    "Not arrived yet": records.filter((record) => inventoryHealth(record) === "Not arrived yet").length,
  };
  const total = Math.max(
    1,
    counts.Healthy +
      counts["Low Stock"] +
      counts["Out of Stock"] +
      counts.Overstock +
      counts["Not arrived yet"],
  );
  const healthRows: { label: InventoryHealth; color: string; text: string }[] = [
    { label: "Healthy", color: "bg-success", text: "text-success" },
    { label: "Low Stock", color: "bg-warning", text: "text-warning" },
    { label: "Out of Stock", color: "bg-error", text: "text-error" },
    { label: "Overstock", color: "bg-brand", text: "text-brand" },
    { label: "Not arrived yet", color: "bg-text-secondary", text: "text-text-muted" },
  ];

  return (
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
  );
}

// ── Inventory Summary Cards ───────────────────────────────────────────────────

export function InventorySummaryCards({
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
    { label: "At Supplier", detail: "Not yet shipped", pairs: atSupplierPairs, tone: "gray" },
    { label: "In Transit", detail: "Currently moving between locations", pairs: inTransitPairs, tone: "orange" },
    { label: "At Receiving", detail: "Counted at receiving gates", pairs: atReceivingPairs, tone: "blue" },
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
        title="Pipeline &amp; Committed Stock"
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

export { HEALTH_STYLES };
