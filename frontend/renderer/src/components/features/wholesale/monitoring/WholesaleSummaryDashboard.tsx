import type { Session } from "@renderer/lib/auth";
import type { Profile } from "@renderer/components/features/types";
import { ChevronRightIcon } from "@renderer/components/ui/icons";
import {
  type WholesaleSummaryData,
} from "./monitoringApi";

function formatMmkShort(amount: number): string {
  if (amount >= 1_000_000) {
    const m = (amount / 1_000_000).toFixed(1);
    return `${m.endsWith(".0") ? m.slice(0, -2) : m}M`;
  }
  if (amount >= 1_000) {
    const k = (amount / 1_000).toFixed(1);
    return `${k.endsWith(".0") ? k.slice(0, -2) : k}K`;
  }
  return amount.toLocaleString();
}

interface WholesaleSummaryDashboardProps {
  session: Session;
  profile?: Profile | null;
  summaryData: WholesaleSummaryData;
  onOpenStock?: (stockCode: string) => void;
  onOpenOrder?: (orderId: string) => void;
  onOpenVoucher?: (voucherId: string) => void;
  onOpenShipment?: (shipmentId: string) => void;
  onOpenReceiving?: (receivingNo: string) => void;
}

export function WholesaleSummaryDashboard({
  summaryData,
  onOpenStock,
  onOpenOrder,
  onOpenVoucher,
}: WholesaleSummaryDashboardProps): React.JSX.Element {
  const data = summaryData;

  const totalPhysicalSets = data.physical_stock_sets;
  // The period's real revenue — zero when nothing was delivered, never a sample figure.
  const totalWholesaleRevenue = data.revenue_this_period;

  return (
    <div className="flex flex-col gap-5 text-text-primary">
      {/* Top 5 KPI Metric Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {/* PHYSICAL STOCK */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            PHYSICAL STOCK
          </p>
          <div className="my-2">
            <span className="text-3xl font-extrabold text-text-primary tracking-tight tabular-nums">
              {data.physical_stock_sets.toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-text-muted">sets on hand</p>
        </div>

        {/* AVAILABLE TO SELL */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            AVAILABLE TO SELL
          </p>
          <div className="my-2">
            <span className="text-3xl font-extrabold text-text-primary tracking-tight tabular-nums">
              {data.available_sets.toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-[#0D9488] font-medium">sets uncommitted</p>
        </div>

        {/* CUSTOMER COMMITTED */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            CUSTOMER COMMITTED
          </p>
          <div className="my-2">
            <span className="text-3xl font-extrabold text-text-primary tracking-tight tabular-nums">
              {data.committed_sets.toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-text-muted">sets allocated</p>
        </div>

        {/* INCOMING STOCK */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            INCOMING STOCK
          </p>
          <div className="my-2">
            <span className="text-3xl font-extrabold text-text-primary tracking-tight tabular-nums">
              {data.incoming_stock_sets.toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-text-muted">
            {data.supplier_sets} supplier · {data.transit_sets} transit
          </p>
        </div>

        {/* CUSTOMER BACKLOG */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-4 sm:p-5 shadow-2xs flex flex-col justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            CUSTOMER BACKLOG
          </p>
          <div className="my-2">
            <span className="text-3xl font-extrabold text-text-primary tracking-tight tabular-nums">
              {data.backlog_sets.toLocaleString()}
            </span>
          </div>
          <p className="text-xs text-[#E88B1A] font-medium">sets waiting for stock</p>
        </div>
      </section>

      {/* 2x2 Grid Section */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Card 1: Inventory Flow */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold tracking-tight text-text-primary">
                Inventory Flow
              </h2>
              <button
                type="button"
                onClick={() => onOpenStock?.("")}
                className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1 group"
              >
                <span>View inventory</span>
                <ChevronRightIcon className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Where stock is across the wholesale pipeline
            </p>

            {/* 5 Step Pipeline Boxes */}
            <div className="flex items-center justify-between gap-1.5 sm:gap-2 mt-5">
              {/* Step 1: At supplier */}
              <div className="flex-1 bg-slate-50 border border-slate-100 rounded-xl py-4 sm:py-5 px-1.5 sm:px-2 text-center flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-text-primary tabular-nums">
                  {data.pipeline?.supplier_sets ?? data.supplier_sets}
                </span>
                <span className="text-[11px] sm:text-xs text-text-muted mt-1 whitespace-nowrap">
                  At supplier
                </span>
              </div>

              <span className="text-slate-300 font-semibold text-xs select-none">&gt;</span>

              {/* Step 2: In transit */}
              <div className="flex-1 bg-slate-50 border border-slate-100 rounded-xl py-4 sm:py-5 px-1.5 sm:px-2 text-center flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-text-primary tabular-nums">
                  {data.pipeline?.transit_sets ?? data.transit_sets}
                </span>
                <span className="text-[11px] sm:text-xs text-text-muted mt-1 whitespace-nowrap">
                  In transit
                </span>
              </div>

              <span className="text-slate-300 font-semibold text-xs select-none">&gt;</span>

              {/* Step 3: On hand */}
              <div className="flex-1 bg-[#EEF2FF] border border-[#E0E7FF] rounded-xl py-4 sm:py-5 px-1.5 sm:px-2 text-center flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-[#1E1B4B] tabular-nums">
                  {data.pipeline?.on_hand_sets ?? data.physical_stock_sets}
                </span>
                <span className="text-[11px] sm:text-xs text-[#4338CA] font-medium mt-1 whitespace-nowrap">
                  On hand
                </span>
              </div>

              <span className="text-slate-300 font-semibold text-xs select-none">&gt;</span>

              {/* Step 4: Allocated */}
              <div className="flex-1 bg-[#F5F3FF] border border-[#EDE9FE] rounded-xl py-4 sm:py-5 px-1.5 sm:px-2 text-center flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-[#3B0764] tabular-nums">
                  {data.pipeline?.allocated_sets ?? data.committed_sets}
                </span>
                <span className="text-[11px] sm:text-xs text-[#6B21A8] font-medium mt-1 whitespace-nowrap">
                  Allocated
                </span>
              </div>

              <span className="text-slate-300 font-semibold text-xs select-none">&gt;</span>

              {/* Step 5: Available */}
              <div className="flex-1 bg-[#ECFDF5] border border-[#D1FAE5] rounded-xl py-4 sm:py-5 px-1.5 sm:px-2 text-center flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-[#064E3B] tabular-nums">
                  {data.pipeline?.available_sets ?? data.available_sets}
                </span>
                <span className="text-[11px] sm:text-xs text-[#047857] font-medium mt-1 whitespace-nowrap">
                  Available
                </span>
              </div>
            </div>
          </div>

          {/* Under-step pipeline summary annotations */}
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-text-muted mt-5 pt-1 px-1">
            <span>Incoming: {data.incoming_stock_sets} sets</span>
            <span>Physical stock: {data.physical_stock_sets} sets</span>
            <span>Available after commitments: {data.available_sets} sets</span>
          </div>
        </div>

        {/* Card 2: Stock by Location */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold tracking-tight text-text-primary">
                Stock by Location
              </h2>
              <button
                type="button"
                onClick={() => onOpenStock?.("")}
                className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1 group"
              >
                <span>Locations</span>
                <ChevronRightIcon className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
            <p className="text-xs text-text-muted mt-0.5">Physical stock distribution</p>

            {/* Total physical stock header row */}
            <div className="flex items-center justify-between text-xs py-3 border-b border-border/50 mt-1">
              <span className="text-text-muted">Total physical stock</span>
              <span className="font-bold text-text-primary tabular-nums">
                {totalPhysicalSets} sets
              </span>
            </div>

            {/* Location rows with progress bars */}
            <div className="flex flex-col gap-3.5 mt-4">
              {data.locations.map((loc) => {
                const pct =
                  totalPhysicalSets > 0
                    ? Math.min(100, Math.round((loc.sets / totalPhysicalSets) * 100))
                    : 0;
                return (
                  <div key={loc.name} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs font-medium text-text-secondary truncate">
                      {loc.name}
                    </span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: loc.color ?? "#5252E8",
                        }}
                      />
                    </div>
                    <span className="w-8 shrink-0 text-right text-xs font-bold text-text-primary tabular-nums">
                      {loc.sets}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Card 3: Customer Order Fulfillment */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold tracking-tight text-text-primary">
                Customer Order Fulfillment
              </h2>
              <button
                type="button"
                onClick={() => onOpenOrder?.("")}
                className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1 group"
              >
                <span>Open orders</span>
                <ChevronRightIcon className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              How customer demand is being served
            </p>

            {/* Fulfillment Rows */}
            <div className="flex flex-col gap-4 mt-6">
              {/* Row 1: All customer demand (Stacked 100%) */}
              <div className="flex items-center gap-3">
                <span className="w-36 shrink-0 text-xs font-medium text-text-secondary">
                  All customer demand
                </span>
                <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-[#10B981] transition-all duration-500"
                    style={{ width: `${data.fulfillment.delivered_pct}%` }}
                    title={`Delivered: ${data.fulfillment.delivered_pct}%`}
                  />
                  <div
                    className="h-full bg-[#8B5CF6] transition-all duration-500"
                    style={{ width: `${data.fulfillment.allocated_pct}%` }}
                    title={`Allocated: ${data.fulfillment.allocated_pct}%`}
                  />
                  <div
                    className="h-full bg-[#E88B1A] transition-all duration-500"
                    style={{ width: `${data.fulfillment.waiting_pct}%` }}
                    title={`Waiting for stock: ${data.fulfillment.waiting_pct}%`}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs font-bold text-text-primary tabular-nums">
                  100%
                </span>
              </div>

              {/* Row 2: Delivered */}
              <div className="flex items-center gap-3">
                <span className="w-36 shrink-0 text-xs font-medium text-text-secondary">
                  Delivered
                </span>
                <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-[#10B981] rounded-full transition-all duration-500"
                    style={{ width: `${data.fulfillment.delivered_pct}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs font-bold text-text-primary tabular-nums">
                  {data.fulfillment.delivered_pct}%
                </span>
              </div>

              {/* Row 3: Still open */}
              <div className="flex items-center gap-3">
                <span className="w-36 shrink-0 text-xs font-medium text-text-secondary">
                  Still open
                </span>
                <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-[#8B5CF6] rounded-l-full transition-all duration-500"
                    style={{ width: `${data.fulfillment.allocated_pct}%` }}
                  />
                  <div
                    className="h-full bg-[#E88B1A] rounded-r-full transition-all duration-500"
                    style={{ width: `${data.fulfillment.waiting_pct}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-xs font-bold text-text-primary tabular-nums">
                  {data.fulfillment.open_pct}%
                </span>
              </div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted mt-6 pt-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#10B981]" />
              <span>Delivered</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#8B5CF6]" />
              <span>Allocated</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#E88B1A]" />
              <span>Waiting for stock</span>
            </div>
          </div>
        </div>

        {/* Card 4: Revenue by Factory */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold tracking-tight text-text-primary">
                Revenue by Factory
              </h2>
              <button
                type="button"
                onClick={() => onOpenVoucher?.("")}
                className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1 group"
              >
                <span>Revenue details</span>
                <ChevronRightIcon className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Net sales attributed to each factory
            </p>

            {/* Wholesale revenue this period header row */}
            <div className="flex items-center justify-between text-xs py-3 border-b border-border/50 mt-1">
              <span className="text-text-muted">Wholesale revenue this period</span>
              <span className="font-bold text-text-primary tabular-nums">
                {formatMmkShort(totalWholesaleRevenue)}
              </span>
            </div>

            {/* Factory rows with bars */}
            <div className="flex flex-col gap-3.5 mt-4">
              {data.factories.map((factory) => {
                const pct =
                  totalWholesaleRevenue > 0
                    ? Math.min(
                        100,
                        Math.round((factory.revenue / totalWholesaleRevenue) * 100),
                      )
                    : 0;
                return (
                  <div key={factory.name} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-xs font-medium text-text-secondary truncate">
                      {factory.name}
                    </span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: factory.color ?? "#5252E8",
                        }}
                      />
                    </div>
                    <span className="w-24 shrink-0 text-right text-xs font-bold text-text-primary tabular-nums">
                      {formatMmkShort(factory.revenue)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="flex items-center justify-between pt-2 pb-4 text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-emerald-500" />
          <span>Last updated just now</span>
        </div>
        <div>
          <span>Figures shown in sets · 1 set = 6 pairs</span>
        </div>
      </footer>
    </div>
  );
}

export default WholesaleSummaryDashboard;
