import type { Session } from "@renderer/lib/auth";
import type { Profile } from "@renderer/components/features/types";
import { ChevronRightIcon } from "@renderer/components/ui/icons";
import { InfoLabel, InfoTooltip } from "@renderer/components/ui/InfoTooltip";
import { type WholesaleSummaryData } from "./monitoringApi";

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
  onSelectTab?: (tab: "revenue" | "cost" | "inventory" | "customer") => void;
}

export function WholesaleSummaryDashboard({
  summaryData,
  onOpenStock,
  onOpenOrder,
  onOpenVoucher,
  onSelectTab,
}: WholesaleSummaryDashboardProps): React.JSX.Element {
  const data = summaryData;

  const totalPhysicalSets = data.physical_stock_sets;
  const totalWholesaleRevenue = data.revenue_this_period;

  return (
    <div className="flex flex-col gap-5 text-text-primary">
      {/* Top 4 Executive Financial & Asset KPI Cards */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* 1. Money Received */}
        <div
          role="button"
          tabIndex={0}
          onClick={() =>
            onSelectTab ? onSelectTab("revenue") : onOpenVoucher?.("")
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectTab ? onSelectTab("revenue") : onOpenVoucher?.("");
            }
          }}
          className="bg-bg-card border border-border/80 hover:border-brand/40 hover:shadow-2xs rounded-xl p-3.5 sm:p-4.5 flex flex-col justify-between cursor-pointer transition-all text-left"
        >
          <InfoLabel
            className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider"
            description="Total actual cash and payments collected from customer sales in the selected period."
          >
            Money Received
          </InfoLabel>
          <div className="my-1 sm:my-1.5">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary tabular-nums">
              {formatMmkShort(data.money_received ?? 0)}
            </span>
          </div>
          <span className="text-[10px] sm:text-[11px] text-text-muted truncate">
            MMK · customer payments in
          </span>
        </div>

        {/* 2. Unpaid by Customers */}
        <div
          role="button"
          tabIndex={0}
          onClick={() =>
            onSelectTab ? onSelectTab("customer") : onOpenOrder?.("")
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectTab ? onSelectTab("customer") : onOpenOrder?.("");
            }
          }}
          className="bg-bg-card border border-border/80 hover:border-brand/40 hover:shadow-2xs rounded-xl p-3.5 sm:p-4.5 flex flex-col justify-between cursor-pointer transition-all text-left"
        >
          <InfoLabel
            className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider"
            description="Total unpaid balance due from customers on delivered orders. Goods have been shipped, awaiting payment."
          >
            Unpaid by Customers
          </InfoLabel>
          <div className="my-1 sm:my-1.5">
            <span
              className={`text-xl sm:text-2xl font-bold tracking-tight tabular-nums ${
                (data.unpaid_by_customers ?? 0) > 0
                  ? "text-[#E88B1A]"
                  : "text-text-primary"
              }`}
            >
              {formatMmkShort(data.unpaid_by_customers ?? 0)}
            </span>
          </div>
          <span
            className={`text-[10px] sm:text-[11px] truncate ${
              (data.unpaid_by_customers ?? 0) > 0
                ? "text-[#E88B1A] font-medium"
                : "text-text-muted"
            }`}
          >
            MMK · customer balance due
          </span>
        </div>

        {/* 3. To Pay Suppliers */}
        <div
          role="button"
          tabIndex={0}
          onClick={() =>
            onSelectTab ? onSelectTab("cost") : onOpenVoucher?.("")
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectTab ? onSelectTab("cost") : onOpenVoucher?.("");
            }
          }}
          className="bg-bg-card border border-border/80 hover:border-brand/40 hover:shadow-2xs rounded-xl p-3.5 sm:p-4.5 flex flex-col justify-between cursor-pointer transition-all text-left"
        >
          <InfoLabel
            className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider"
            description="Total unpaid balance owed to suppliers and factories on stock purchases."
          >
            To Pay Suppliers
          </InfoLabel>
          <div className="my-1 sm:my-1.5">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary tabular-nums">
              {formatMmkShort(data.to_pay_suppliers ?? 0)}
            </span>
          </div>
          <span className="text-[10px] sm:text-[11px] text-text-muted truncate">
            MMK · supplier balance due
          </span>
        </div>

        {/* 4. Inventory Value */}
        <div
          role="button"
          tabIndex={0}
          onClick={() =>
            onSelectTab ? onSelectTab("inventory") : onOpenStock?.("")
          }
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelectTab ? onSelectTab("inventory") : onOpenStock?.("");
            }
          }}
          className="bg-bg-card border border-border/80 hover:border-brand/40 hover:shadow-2xs rounded-xl p-3.5 sm:p-4.5 flex flex-col justify-between cursor-pointer transition-all text-left"
        >
          <InfoLabel
            className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider"
            description="Total buying cost value of physical stock on hand across all warehouse locations."
          >
            Inventory Value
          </InfoLabel>
          <div className="my-1 sm:my-1.5">
            <span className="text-xl sm:text-2xl font-bold tracking-tight text-text-primary tabular-nums">
              {formatMmkShort(data.inventory_value ?? 0)}
            </span>
          </div>
          <span className="text-[10px] sm:text-[11px] text-text-muted truncate">
            MMK · {data.physical_stock_sets.toLocaleString()} sets on hand
          </span>
        </div>
      </section>

      {/* 2x2 Grid Section */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Card 1: Inventory Flow */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-semibold tracking-tight text-text-primary">
                  Inventory Flow
                </h2>
                <InfoTooltip description="End-to-end stock pipeline from supplier production through cargo transit, warehouse storage, customer allocation, to free available stock." />
              </div>
              <button
                type="button"
                onClick={() =>
                  onSelectTab ? onSelectTab("inventory") : onOpenStock?.("")
                }
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

              <span className="text-slate-300 font-semibold text-xs select-none">
                &gt;
              </span>

              {/* Step 2: In transit */}
              <div className="flex-1 bg-slate-50 border border-slate-100 rounded-xl py-4 sm:py-5 px-1.5 sm:px-2 text-center flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-text-primary tabular-nums">
                  {data.pipeline?.transit_sets ?? data.transit_sets}
                </span>
                <span className="text-[11px] sm:text-xs text-text-muted mt-1 whitespace-nowrap">
                  In transit
                </span>
              </div>

              <span className="text-slate-300 font-semibold text-xs select-none">
                &gt;
              </span>

              {/* Step 3: On hand */}
              <div className="flex-1 bg-[#EEF2FF] border border-[#E0E7FF] rounded-xl py-4 sm:py-5 px-1.5 sm:px-2 text-center flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-[#1E1B4B] tabular-nums">
                  {data.pipeline?.on_hand_sets ?? data.physical_stock_sets}
                </span>
                <span className="text-[11px] sm:text-xs text-[#4338CA] font-medium mt-1 whitespace-nowrap">
                  On hand
                </span>
              </div>

              <span className="text-slate-300 font-semibold text-xs select-none">
                &gt;
              </span>

              {/* Step 4: Allocated */}
              <div className="flex-1 bg-[#F5F3FF] border border-[#EDE9FE] rounded-xl py-4 sm:py-5 px-1.5 sm:px-2 text-center flex flex-col items-center justify-center">
                <span className="text-xl font-bold text-[#3B0764] tabular-nums">
                  {data.pipeline?.allocated_sets ?? data.committed_sets}
                </span>
                <span className="text-[11px] sm:text-xs text-[#6B21A8] font-medium mt-1 whitespace-nowrap">
                  Allocated
                </span>
              </div>

              <span className="text-slate-300 font-semibold text-xs select-none">
                &gt;
              </span>

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

          {/* Clean Guidance Note (Replaced redundant repeated numbers with clean pipeline guide) */}
          <div className="flex items-center justify-between text-[11px] sm:text-xs text-text-muted mt-5 pt-1 px-1 border-t border-border/40">
            <span>Incoming: Supplier + Transit</span>
            <span className="font-medium text-text-secondary">
              On Hand = Allocated + Available
            </span>
          </div>
        </div>

        {/* Card 2: Stock by Location */}
        <div className="bg-bg-card border border-border/80 rounded-xl p-5 shadow-2xs flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-semibold tracking-tight text-text-primary">
                  Stock by Location
                </h2>
                <InfoTooltip description="Distribution of physical on-hand stock across your warehouse locations to help balance inventory." />
              </div>
              <button
                type="button"
                onClick={() =>
                  onSelectTab ? onSelectTab("inventory") : onOpenStock?.("")
                }
                className="text-xs font-medium text-brand hover:underline inline-flex items-center gap-1 group"
              >
                <span>Locations</span>
                <ChevronRightIcon className="w-3 h-3 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Physical stock distribution
            </p>

            {/* Total physical stock header row */}
            <div className="flex items-center justify-between text-xs py-3 border-b border-border/50 mt-1">
              <span className="text-text-muted">Total physical stock</span>
              <span className="font-bold text-text-primary tabular-nums">
                {totalPhysicalSets.toLocaleString()} sets
              </span>
            </div>

            {/* Location rows with progress bars */}
            <div className="flex flex-col gap-3.5 mt-4">
              {data.locations.map((loc) => {
                const pct =
                  totalPhysicalSets > 0
                    ? Math.min(
                        100,
                        Math.round((loc.sets / totalPhysicalSets) * 100),
                      )
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
                    <span className="w-16 shrink-0 text-right text-xs font-semibold text-text-primary tabular-nums">
                      {loc.sets}{" "}
                      <span className="text-[11px] font-normal text-text-muted">
                        ({pct}%)
                      </span>
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
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-semibold tracking-tight text-text-primary">
                  Customer Order Fulfillment
                </h2>
                <InfoTooltip description="Progress of customer demand fulfillment: delivered goods, reserved stock in warehouse, and backlog waiting for restock." />
              </div>
              <button
                type="button"
                onClick={() =>
                  onSelectTab ? onSelectTab("customer") : onOpenOrder?.("")
                }
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
          <div className="flex flex-wrap items-center gap-4 text-xs text-text-muted mt-6 pt-1 border-t border-border/40">
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
              <div className="flex items-center gap-1.5">
                <h2 className="text-base font-semibold tracking-tight text-text-primary">
                  Revenue by Factory
                </h2>
                <InfoTooltip description="Net wholesale revenue attributed to each factory or brand during the selected period." />
              </div>
              <button
                type="button"
                onClick={() =>
                  onSelectTab ? onSelectTab("revenue") : onOpenVoucher?.("")
                }
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
              <span className="text-text-muted">
                Wholesale revenue this period
              </span>
              <span className="font-bold text-text-primary tabular-nums">
                {formatMmkShort(totalWholesaleRevenue)} MMK
              </span>
            </div>

            {/* Factory rows with bars */}
            <div className="flex flex-col gap-3.5 mt-4">
              {data.factories.map((factory) => {
                const pct =
                  totalWholesaleRevenue > 0
                    ? Math.min(
                        100,
                        Math.round(
                          (factory.revenue / totalWholesaleRevenue) * 100,
                        ),
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
                    <span className="w-28 shrink-0 text-right text-xs font-semibold text-text-primary tabular-nums">
                      {formatMmkShort(factory.revenue)}{" "}
                      <span className="text-[11px] font-normal text-text-muted">
                        ({pct}%)
                      </span>
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
