import { useEffect, useMemo, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import type {
  Profile,
  PendingImport,
  SelectedImportFile,
} from "@renderer/components/features/types";
import { TabBar, type TabItem } from "@renderer/components/ui/Tabs";
import FileImportCard from "@renderer/components/features/retail/FileImportCard";
import GeneralFileImportCard from "@renderer/components/features/retail/GeneralFileImportCard";
import ImportHistoryTable from "@renderer/components/features/retail/ImportHistoryTable";
import ImportOverviewPage from "@renderer/components/features/retail/ImportOverviewPage";
import ImportConfirmModal from "@renderer/components/features/retail/ImportConfirmModal";
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
  onFilesReady?: (files: PendingImport[]) => void;
  onFileReady?: (file: PendingImport) => void;
  onViewBatch: (batchId: string) => void;
  highlightBatchId: string | null;
  onViewImportBatch: (importId: string) => void;
  initialTab?: ImportSubTab;
  /** Keeps the shell's role-specific Import / History navigation in step with these tabs. */
  onTabChange?: (tab: ImportSubTab) => void;
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
  onTabChange,
}: ImportHubPageProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<ImportSubTab>(initialTab);
  const [selectedFiles, setSelectedFiles] = useState<SelectedImportFile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");

  useEffect(() => {
    if (profile !== null && profile.branch_id !== null) return;
    fetch(`${apiBaseUrl}/api/branches`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setBranches(data);
          if (data.length > 0) {
            setSelectedBranchId((prev) => prev || data[0].id);
          }
        }
      })
      .catch(() => setBranches([]));
  }, [profile, session.access_token]);

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
        id: "freshness",
        label: "Import Freshness",
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
      {/* The branch selector is only needed when preparing a new import. */}
      <div className="border-b border-border flex items-center justify-between gap-4">
        <TabBar<ImportSubTab>
          className="border-b-0 w-auto"
          tabs={tabs}
          activeTab={activeTab}
          onSelect={handleTabChange}
        />
        {activeTab === "import" &&
          profile !== null &&
          profile.branch_id === null && (
            <div className="flex items-center gap-2 pb-1.5 shrink-0">
              <span className="text-xs text-text-muted font-medium">
                Branch:
              </span>
              <select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
                className="text-xs bg-bg-surface border border-border rounded-md px-2.5 py-1 text-text-primary focus:outline-none focus:ring-1 focus:ring-brand font-medium cursor-pointer"
              >
                <option value="">Select a branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
          )}
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
                branchId={profile?.branch_id ?? selectedBranchId}
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
              onFileSelected={handleSingleFileSelected}
            />
          </div>
        )}

        {/* 3. Import Freshness */}
        {activeTab === "freshness" && profile?.role !== "retail" && (
          <div className="space-y-3">
            <ImportOverviewPage
              session={session}
              onViewImportBatch={onViewImportBatch}
            />
          </div>
        )}
      </div>

      {/* Streamlined Confirmation Modal */}
      <ImportConfirmModal
        session={session}
        profile={profile}
        files={selectedFiles}
        selectedBranchId={selectedBranchId}
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
