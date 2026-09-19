import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { TabBar, type TabItem } from "@renderer/components/ui/Tabs";
import DataOverviewTable from "@renderer/components/features/retail/DataOverviewTable";
import SimpleDataTable from "@renderer/components/features/SimpleDataTable";
import { OverviewIcon, SalesIcon, PurchaseIcon } from "@renderer/components/ui/icons";

export type DataHubSubTab = "overview" | "cleanedData";

interface DataHubPageProps {
  session: Session;
  branchOptions: string[];
  showBuyingPriceSource: boolean;
  saleColumns: any[];
  saleFilters: any[];
  purchaseColumns: any[];
  purchaseFilters: any[];
  saleListWindowDays: number;
  purchaseListWindowDays: number;
  initialTab?: DataHubSubTab;
}

export default function DataHubPage({
  session,
  branchOptions,
  showBuyingPriceSource,
  saleColumns,
  saleFilters,
  purchaseColumns,
  purchaseFilters,
  saleListWindowDays,
  purchaseListWindowDays,
  initialTab = "overview",
}: DataHubPageProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<DataHubSubTab>(initialTab);
  const [cleanedSubDataset, setCleanedSubDataset] = useState<"sales" | "purchases">("sales");

  const tabs: TabItem<DataHubSubTab>[] = [
    {
      id: "overview",
      label: "Data Overview (Cross-Table)",
      icon: <OverviewIcon className="w-4 h-4" />,
    },
    {
      id: "cleanedData",
      label: "After Cleaning Data",
      icon: <SalesIcon className="w-4 h-4" />,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold text-text-primary tracking-tight">
          Data Storage & Warehouse
        </h1>
        <p className="text-xs text-text-muted mt-0.5">
          Review stored cross-table master data and verified records after ETL normalization.
        </p>
      </div>

      <div className="bg-bg-surface border border-border rounded-xl shadow-xs overflow-hidden">
        <div className="px-4 pt-2 border-b border-border/50">
          <TabBar tabs={tabs} activeTab={activeTab} onSelect={setActiveTab} />
        </div>

        <div className="p-4">
          {/* 1. Stored Data Overview (Cross Table Wide View) */}
          {activeTab === "overview" && (
            <div className="space-y-3">
              <div className="text-xs text-text-muted">
                Consolidated cross-table records combining Sales Slips, Inventory Counts, and Point-in-Time Cost Prices.
              </div>
              <DataOverviewTable
                session={session}
                branchOptions={branchOptions}
                showBuyingPriceSource={showBuyingPriceSource}
              />
            </div>
          )}

          {/* 2. Stored After-Cleaning Standard Data */}
          {activeTab === "cleanedData" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    Cleaned Standard Records
                  </h3>
                  <p className="text-xs text-text-muted mt-0.5">
                    De-duplicated, type-verified standard records stored in the database ready for BI and business decisions.
                  </p>
                </div>

                <div className="flex items-center gap-1.5 bg-bg-subtle p-1 rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() => setCleanedSubDataset("sales")}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      cleanedSubDataset === "sales"
                        ? "bg-bg-surface text-brand shadow-xs"
                        : "text-text-muted hover:text-text-primary"
                    }`}
                  >
                    Cleaned Sales
                  </button>
                  <button
                    type="button"
                    onClick={() => setCleanedSubDataset("purchases")}
                    className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                      cleanedSubDataset === "purchases"
                        ? "bg-bg-surface text-brand shadow-xs"
                        : "text-text-muted hover:text-text-primary"
                    }`}
                  >
                    Cleaned Purchases
                  </button>
                </div>
              </div>

              {cleanedSubDataset === "sales" && (
                <SimpleDataTable
                  session={session}
                  endpoint="/api/sales"
                  title="Cleaned Sales Records"
                  description="Validated daily slip lines and profit calculations."
                  icon={<SalesIcon />}
                  columns={saleColumns}
                  filters={saleFilters}
                  rowKey={(row: any, i: number) => `${row.SlipNumber}-${i}`}
                  emptyTitle="No cleaned sales data"
                  emptyDescription="Upload a sales slip export to populate."
                  defaultWindowDays={saleListWindowDays}
                  serverPaged
                />
              )}

              {cleanedSubDataset === "purchases" && (
                <SimpleDataTable
                  session={session}
                  endpoint="/api/purchases"
                  title="Cleaned Purchase Records"
                  description="Validated supplier deliveries and buying prices."
                  icon={<PurchaseIcon />}
                  columns={purchaseColumns}
                  filters={purchaseFilters}
                  rowKey={(row: any, i: number) => `${row.StockCode}-${row.Date}-${i}`}
                  emptyTitle="No cleaned purchase data"
                  emptyDescription="Upload a purchase file to populate."
                  defaultWindowDays={purchaseListWindowDays}
                  serverPaged
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
