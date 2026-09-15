import { useState } from "react";
import { useIsFetching } from "@tanstack/react-query";
import type { Session } from "@renderer/lib/auth";
import { refreshEverything } from "@renderer/lib/queryClient";
import { Button } from "@renderer/components/ui/Button";
import { CardHeader } from "@renderer/components/ui/Card";
import { PeriodControls } from "@renderer/components/features/dashboard/shared";
import { usePeriodRange } from "@renderer/components/features/dashboard/usePeriodRange";
import { RevenueTab } from "./reports/RevenueTab";
import { CostTab } from "./reports/CostTab";
import { InventoryTab } from "./reports/InventoryTab";
import { CustomerTab } from "./reports/CustomerTab";

type ReportTab = "revenue" | "cost" | "inventory" | "customer";

const TABS: { id: ReportTab; label: string; description: string }[] = [
  { id: "revenue", label: "Revenue", description: "What we sold" },
  { id: "cost", label: "Cost & Supplier", description: "What we paid and owe" },
  { id: "inventory", label: "Inventory", description: "Where every pair is" },
  { id: "customer", label: "Customer", description: "Who buys and owes" },
];

function TabBar({
  active,
  onChange,
}: {
  active: ReportTab;
  onChange: (tab: ReportTab) => void;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      className="flex w-fit flex-wrap gap-1 rounded-lg bg-bg-subtle p-1"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`rounded-md px-4 py-2 text-left transition-colors ${active === tab.id ? "bg-brand-subtle text-brand shadow-sm" : "text-text-muted hover:text-text-primary"}`}
        >
          <span className="block text-sm font-medium">{tab.label}</span>
          <span className="block text-xs text-text-muted">
            {tab.description}
          </span>
        </button>
      ))}
    </div>
  );
}

export default function ReportsPage({
  session,
}: {
  session: Session;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<ReportTab>("revenue");
  const range = usePeriodRange("30d");
  const isFetching = useIsFetching() > 0;
  const props = {
    session,
    period: range.period,
    dateFrom: range.applied.from,
    dateTo: range.applied.to,
  };

  return (
    <div className="flex flex-col gap-4">
      <CardHeader
        title="Reports"
        description="Revenue, cost, inventory and customer detail for the wholesale business."
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={refreshEverything}
            loading={isFetching}
          >
            Refresh
          </Button>
        }
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TabBar active={activeTab} onChange={setActiveTab} />
        {activeTab !== "inventory" && (
          <div className="flex flex-wrap items-end gap-3">
            <PeriodControls range={range} />
          </div>
        )}
      </div>
      {activeTab === "revenue" && <RevenueTab {...props} />}
      {activeTab === "cost" && <CostTab {...props} />}
      {activeTab === "inventory" && <InventoryTab {...props} />}
      {activeTab === "customer" && <CustomerTab {...props} />}
    </div>
  );
}
