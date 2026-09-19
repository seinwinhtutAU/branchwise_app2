import { useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import type { Profile } from "@renderer/components/features/types";
import type { PendingImport } from "@renderer/components/features/types";
import { TabBar, type TabItem } from "@renderer/components/ui/Tabs";
import FileImportCard from "@renderer/components/features/retail/FileImportCard";
import ImportHistoryTable from "@renderer/components/features/retail/ImportHistoryTable";
import ImportOverviewPage from "@renderer/components/features/retail/ImportOverviewPage";
import {
  UploadIcon,
  HistoryIcon,
  HeartPulseIcon,
  SalesIcon,
  PurchaseIcon,
  InventoryIcon,
} from "@renderer/components/ui/icons";

export type ImportSubTab = "import" | "history" | "freshness";

interface ImportHubPageProps {
  session: Session;
  profile: Profile | null;
  branchOptions: string[];
  onFilesReady: (files: PendingImport[]) => void;
  onFileReady: (file: PendingImport) => void;
  onViewBatch: (batchId: string) => void;
  highlightBatchId: string | null;
  onViewImportBatch: (importId: string) => void;
  initialTab?: ImportSubTab;
}

export default function ImportHubPage({
  session,
  profile,
  branchOptions,
  onFilesReady,
  onFileReady,
  onViewBatch,
  highlightBatchId,
  onViewImportBatch,
  initialTab = "import",
}: ImportHubPageProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<ImportSubTab>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const tabs: TabItem<ImportSubTab>[] = [
    {
      id: "import",
      label: "Import Files",
      icon: <UploadIcon className="w-4 h-4" />,
    },
    {
      id: "history",
      label: "Import History",
      icon: <HistoryIcon className="w-4 h-4" />,
    },
    {
      id: "freshness",
      label: "Import Freshness",
      icon: <HeartPulseIcon className="w-4 h-4" />,
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Tabs */}
      <div className="border-b border-border">
        <TabBar<ImportSubTab>
          tabs={tabs}
          activeTab={activeTab}
          onSelect={setActiveTab}
        />
      </div>

      <div>
        {/* 1. Import Files */}
        {activeTab === "import" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <FileImportCard
                session={session}
                label="Sales Slips"
                description="Daily sales slip exports from POS checkout"
                endpoint="/api/imports/sales"
                icon={<SalesIcon />}
                onFilesReady={onFilesReady}
              />
              <FileImportCard
                session={session}
                label="Purchase Orders"
                description="Supplier delivery notes & stock arrival records"
                endpoint="/api/imports/purchase"
                icon={<PurchaseIcon />}
                onFilesReady={onFilesReady}
              />
              <FileImportCard
                session={session}
                label="Inventory Snapshot"
                description="Stock count snapshots for on-hand quantity"
                endpoint="/api/imports/inventory"
                icon={<InventoryIcon />}
                onFilesReady={onFilesReady}
              />
            </div>
          </div>
        )}

        {/* 2. Import History */}
        {activeTab === "history" && (
          <div className="space-y-3">
            <ImportHistoryTable
              session={session}
              onViewBatch={onViewBatch}
              branchOptions={branchOptions}
              profile={profile}
              highlightBatchId={highlightBatchId}
              onFileReady={onFileReady}
            />
          </div>
        )}

        {/* 3. Import Freshness */}
        {activeTab === "freshness" && (
          <div className="space-y-3">
            <ImportOverviewPage
              session={session}
              onViewImportBatch={onViewImportBatch}
            />
          </div>
        )}
      </div>
    </div>
  );
}
