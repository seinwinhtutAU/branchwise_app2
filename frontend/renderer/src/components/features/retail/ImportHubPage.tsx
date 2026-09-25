import { useEffect, useMemo, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import type {
  Profile,
  PendingImport,
  SelectedImportFile,
} from "@renderer/components/features/types";
import type { BranchOption } from "@renderer/lib/useBranches";
import { TabBar, type TabItem } from "@renderer/components/ui/Tabs";
import FileImportCard from "@renderer/components/features/retail/FileImportCard";
import GeneralFileImportCard from "@renderer/components/features/retail/GeneralFileImportCard";
import ImportHistoryTable from "@renderer/components/features/retail/ImportHistoryTable";
import ImportHealthPage from "@renderer/components/features/retail/ImportHealthPage";
import ImportConfirmModal from "@renderer/components/features/retail/ImportConfirmModal";
import {
  UploadIcon,
  HistoryIcon,
  HeartPulseIcon,
  SalesIcon,
  PurchaseIcon,
  InventoryIcon,
} from "@renderer/components/ui/icons";

export type ImportSubTab = "import" | "history" | "health";

interface ImportHubPageProps {
  session: Session;
  profile: Profile | null;
  branchOptions: string[];
  retailBranchOptions?: BranchOption[];
  selectedBranchId?: string;
  onFilesReady?: (files: PendingImport[]) => void;
  onFileReady?: (file: PendingImport) => void;
  onViewBatch: (batchId: string) => void;
  highlightBatchId: string | null;
  initialTab?: ImportSubTab;
  /** Keeps the shell's role-specific Import / History navigation in step with these tabs. */
  onTabChange?: (tab: ImportSubTab) => void;
}

export default function ImportHubPage({
  session,
  profile,
  branchOptions,
  retailBranchOptions = [],
  selectedBranchId = "",
  onFilesReady,
  onFileReady,
  onViewBatch,
  highlightBatchId,
  initialTab = "import",
  onTabChange,
}: ImportHubPageProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<ImportSubTab>(initialTab);
  const [selectedFiles, setSelectedFiles] = useState<SelectedImportFile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const effectiveBranchId = profile?.branch_id ?? selectedBranchId;
  const importBranchName =
    profile?.branch_name ??
    retailBranchOptions.find((branch) => branch.id === effectiveBranchId)?.name ??
    null;

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  const tabs: TabItem<ImportSubTab>[] = useMemo(() => {
    const base: TabItem<ImportSubTab>[] = [
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
    ];
    if (profile?.role !== "retail") {
      base.push({
        id: "health",
        label: "Import Health",
        icon: <HeartPulseIcon className="w-4 h-4" />,
      });
    }
    return base;
  }, [profile?.role]);

  function handleFilesSelected(files: SelectedImportFile[]): void {
    setSelectedFiles(files);
    setIsModalOpen(true);
  }

  function handleSingleFileSelected(file: SelectedImportFile): void {
    setSelectedFiles([file]);
    setIsModalOpen(true);
  }

  function handleRemoveFile(id: string): void {
    setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function handleRemoveFiles(ids: string[]): void {
    const idSet = new Set(ids);
    setSelectedFiles((prev) => prev.filter((f) => !idSet.has(f.id)));
  }

  function handleTabChange(tab: ImportSubTab): void {
    setActiveTab(tab);
    onTabChange?.(tab);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="border-b border-border flex items-center justify-between gap-4">
        <TabBar<ImportSubTab>
          className="border-b-0 w-auto"
          tabs={tabs}
          activeTab={activeTab}
          onSelect={handleTabChange}
        />
      </div>

      {activeTab === "import" && (
        <h1 className="text-lg font-bold tracking-tight text-text-primary">
          {importBranchName ?? "Choose a branch in the sidebar"}
        </h1>
      )}

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
                onFilesSelected={handleFilesSelected}
                onFilesReady={onFilesReady}
              />
              <FileImportCard
                session={session}
                label="Purchase Orders"
                description="Supplier delivery notes & stock arrival records"
                endpoint="/api/imports/purchase"
                icon={<PurchaseIcon />}
                onFilesSelected={handleFilesSelected}
                onFilesReady={onFilesReady}
              />
              <FileImportCard
                session={session}
                label="Inventory Snapshot"
                description="Stock count snapshots for on-hand quantity"
                endpoint="/api/imports/inventory"
                icon={<InventoryIcon />}
                onFilesSelected={handleFilesSelected}
                onFilesReady={onFilesReady}
              />
              <GeneralFileImportCard
                session={session}
                branchId={effectiveBranchId}
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
              branchFilter={importBranchName ?? ""}
              profile={profile}
              highlightBatchId={highlightBatchId}
              onFileReady={onFileReady}
              onFileSelected={handleSingleFileSelected}
            />
          </div>
        )}

        {/* 3. Import Health — freshness and missing-day follow-up in one place. */}
        {activeTab === "health" && profile?.role !== "retail" && (
          <ImportHealthPage session={session} profile={profile} />
        )}
      </div>

      {/* Streamlined Confirmation Modal */}
      <ImportConfirmModal
        session={session}
        profile={profile}
        files={selectedFiles}
        selectedBranchId={effectiveBranchId}
        branchName={importBranchName}
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedFiles([]);
        }}
        onSuccess={() => {
          handleTabChange("history");
        }}
        onRemoveFile={handleRemoveFile}
        onRemoveFiles={handleRemoveFiles}
      />
    </div>
  );
}
