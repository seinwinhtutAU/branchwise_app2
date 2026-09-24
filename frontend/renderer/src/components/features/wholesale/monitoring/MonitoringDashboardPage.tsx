import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { type Session } from "@renderer/lib/auth";
import type { Profile } from "@renderer/components/features/types";
import { fetchJson, refreshEverything } from "@renderer/lib/queryClient";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { TabBar } from "@renderer/components/ui/Tabs";
import { Select } from "@renderer/components/ui/Select";
import { ExportDataButtons } from "@renderer/components/features/wholesale/monitoring/ExportDataButtons";
import { WholesaleSummaryDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleSummaryDashboard";
import { PeriodControls } from "@renderer/components/features/dashboard/shared";
import { usePeriodRange } from "@renderer/components/features/dashboard/usePeriodRange";
import {
  DASHBOARD_PERIOD_OPTIONS,
  periodQueryParams,
} from "@renderer/components/features/dashboard/helpers";
import { DashboardError, DashboardLoading } from "./dashboardParts";
import { WholesaleRevenueDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleRevenueDashboard";
import { WholesaleCostDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleCostDashboard";
import { WholesaleCustomerDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleCustomerDashboard";
import { WholesaleInventoryDashboard } from "@renderer/components/features/wholesale/monitoring/WholesaleInventoryDashboard";
import {
  WHOLESALE_SUMMARY_URL,
  type WholesaleSummaryData,
} from "./monitoringApi";

const DASHBOARD_TABS = [
  { id: "summary", label: "Summary" },
  { id: "revenue", label: "Revenue" },
  { id: "cost", label: "Cost" },
  { id: "inventory", label: "Inventory" },
  { id: "customer", label: "Customer" },
] as const;

type DashboardView = (typeof DASHBOARD_TABS)[number]["id"];

const LOCATION_OPTIONS = [
  { id: "all", label: "All locations" },
  { id: "zay_gyi", label: "Zay Gyi St." },
  { id: "mawlamyine", label: "Mawlamyine" },
  { id: "mandalay", label: "Mandalay" },
];

export default function MonitoringDashboardPage({
  session,
  profile,
  onOpenShipment,
  onOpenOrder,
  onOpenVoucher,
  onOpenReceiving,
  onOpenStock,
}: {
  session: Session;
  profile?: Profile | null;
  onOpenShipment: (id: string) => void;
  onOpenOrder: (id: string) => void;
  onOpenVoucher: (id: string) => void;
  onOpenReceiving: (receivingNo: string) => void;
  onOpenStock: (stockCode: string) => void;
}): React.JSX.Element {
  const [view, setView] = useState<DashboardView>("summary");
  const [selectedLocation, setSelectedLocation] = useState("all");
  // One period control for the Summary, Revenue and Customer views — the same one the
  // retail Dashboard uses (Daily, Weekly, Monthly, or a custom range). Inventory is where
  // the stock is now, so it has no period.
  const range = usePeriodRange("monthly");
  const window = {
    period: range.period,
    dateFrom: range.applied.from,
    dateTo: range.applied.to,
    month: range.month,
  };

  const locationParam =
    selectedLocation === "all"
      ? ""
      : (LOCATION_OPTIONS.find((l) => l.id === selectedLocation)?.label ?? "");

  const summaryQuery = useQuery({
    queryKey: ["wholesale", "summary", selectedLocation, window] as const,
    queryFn: async () => {
      const params = periodQueryParams(
        window.period,
        window.dateFrom,
        window.dateTo,
        window.month,
      );
      if (locationParam) params.set("location", locationParam);
      const url = `${WHOLESALE_SUMMARY_URL}${params.toString() ? `?${params.toString()}` : ""}`;
      return await fetchJson<WholesaleSummaryData>(url, session);
    },
  });

  const isRefreshing = summaryQuery.isFetching;

  const handleRefresh = (): void => {
    void summaryQuery.refetch();
    // The Revenue, Cost, Customer and Inventory tabs each own their request.
    if (
      view === "revenue" ||
      view === "cost" ||
      view === "customer" ||
      view === "inventory"
    ) {
      refreshEverything();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Streamlined Dashboard Navigation & Filters Toolbar (Matching Retail Summary Dashboard) */}
      <div className="flex flex-col gap-2 pb-2 border-b border-border">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold tracking-tight text-text-primary shrink-0 hidden sm:block">
              Dashboard
            </h1>
            <TabBar<DashboardView>
              tabs={DASHBOARD_TABS}
              activeTab={view}
              onSelect={setView}
              className="border-b-0 w-auto"
            />
          </div>

          <div className="flex items-center gap-2">
            <ExportDataButtons session={session} />
            <RefreshButton onClick={handleRefresh} refreshing={isRefreshing} />
          </div>
        </div>

        {/* Filters Toolbar Row */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Location filters the Summary view; the Revenue, Cost and Customer tabs have
                no per-location figures, and Inventory shows every location. */}
            {view === "summary" && (
              <div className="w-36">
                <Select
                  size="sm"
                  value={selectedLocation}
                  onChange={(e) => setSelectedLocation(e.target.value)}
                  aria-label="Location"
                >
                  {LOCATION_OPTIONS.map((loc) => (
                    <option key={loc.id} value={loc.id}>
                      {loc.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {(view === "summary" ||
              view === "revenue" ||
              view === "cost" ||
              view === "customer") && (
              <PeriodControls
                range={range}
                options={DASHBOARD_PERIOD_OPTIONS}
              />
            )}
          </div>
        </div>
      </div>

      {view === "revenue" && (
        <WholesaleRevenueDashboard session={session} window={window} />
      )}
      {view === "cost" && (
        <WholesaleCostDashboard
          session={session}
          window={window}
          onOpenVoucher={onOpenVoucher}
        />
      )}
      {view === "customer" && (
        <WholesaleCustomerDashboard
          session={session}
          window={window}
          onOpenOrder={onOpenOrder}
        />
      )}
      {view === "inventory" && (
        <WholesaleInventoryDashboard session={session} />
      )}

      {view === "summary" &&
        summaryQuery.data === undefined &&
        (summaryQuery.isError ? (
          <DashboardError
            title="Summary"
            reload={async () => {
              await summaryQuery.refetch();
            }}
          />
        ) : (
          <DashboardLoading tiles={5} />
        ))}
      {view === "summary" && summaryQuery.data !== undefined && (
        <WholesaleSummaryDashboard
          session={session}
          profile={profile}
          summaryData={summaryQuery.data}
          onSelectTab={setView}
          onOpenShipment={onOpenShipment}
          onOpenOrder={onOpenOrder}
          onOpenVoucher={onOpenVoucher}
          onOpenReceiving={onOpenReceiving}
          onOpenStock={onOpenStock}
        />
      )}
    </div>
  );
}
