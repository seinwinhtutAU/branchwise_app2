import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { CardHeader } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { TableSkeleton } from "@renderer/components/ui/Skeleton";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  CheckIcon,
  DownloadIcon,
  InventoryIcon,
  UploadIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";

interface CheckingItem {
  stock_code: string;
  description: string;
  on_hand_qty?: number | null;
}

interface CheckingStatusResponse {
  is_eligible: boolean;
  reason?: string | null;
  has_today_sales: boolean;
  has_today_inventory: boolean;
  is_after_8pm: boolean;
  items: CheckingItem[];
}

interface Props {
  session: Session;
  onImportInventory: () => void;
}

export default function CheckingPage({
  session,
  onImportInventory,
}: Props): React.JSX.Element {
  const { data: status, failed, isRefreshing, reload } =
    useUrlQuery<CheckingStatusResponse>(
      `${apiBaseUrl}/api/checking`,
      session,
      "checking status",
    );

  const [downloading, setDownloading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  async function handleDownloadCsv(): Promise<void> {
    setDownloading(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/checking/export`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!response.ok) {
        throw new Error("Failed to export checking CSV");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `stock_check_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
    } finally {
      setDownloading(false);
    }
  }

  async function handleVerify(): Promise<void> {
    setVerifying(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/checking/verify`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setVerifyResult({ success: data.success, message: data.message });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setVerifying(false);
    }
  }

  const items = status?.items ?? [];
  const isEligible = status?.is_eligible ?? false;

  return (
    <div className="flex flex-col gap-4">
      {/* Header and Controls */}
      <div className="bg-bg-base border border-border rounded-md overflow-hidden shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-border">
          <CardHeader
            title="Physical Stock Audit"
            description="Check these products in the external inventory system. Then export and re-import the updated inventory snapshot."
            className="mb-0"
          />
          <div className="flex items-center gap-2">
            <RefreshButton onClick={reload} refreshing={isRefreshing} />
            {isEligible && items.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={handleDownloadCsv}
                disabled={downloading}
                className="gap-1.5"
              >
                <DownloadIcon className="w-4 h-4" />
                {downloading ? "Downloading..." : "Download Count Sheet (CSV)"}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={handleVerify}
              disabled={verifying}
              className="gap-1.5"
            >
              <CheckIcon className="w-4 h-4" />
              {verifying ? "Checking..." : "Verify Re-import"}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={onImportInventory}
              className="gap-1.5"
            >
              <UploadIcon className="w-4 h-4" />
              Import Inventory
            </Button>
          </div>
        </div>

        {/* Verification Result Banner */}
        {verifyResult && (
          <div
            className={`px-4 py-3 border-b border-border flex items-center justify-between text-sm ${
              verifyResult.success
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
            }`}
          >
            <span className="font-medium">{verifyResult.message}</span>
            <button
              onClick={() => setVerifyResult(null)}
              className="text-xs underline hover:no-underline ml-4"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Eligibility Status Banner */}
        {status && !isEligible && (
          <div className="p-4 bg-amber-500/10 border-b border-border flex flex-col gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
              <WarningIcon className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              <span>Audit Sheet Generation Locked</span>
            </div>
            <p className="text-xs text-text-secondary">
              {status.reason ||
                "Physical stock checking file generates after 8:00 PM once today's sale and inventory files are confirmed."}
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant={status.is_after_8pm ? "success" : "default"}>
                {status.is_after_8pm ? "✓ After 8:00 PM" : "⏳ Before 8:00 PM"}
              </Badge>
              <Badge variant={status.has_today_sales ? "success" : "default"}>
                {status.has_today_sales
                  ? "✓ Today's Sales Imported"
                  : "⏳ Today's Sales Missing"}
              </Badge>
              <Badge
                variant={status.has_today_inventory ? "success" : "default"}
              >
                {status.has_today_inventory
                  ? "✓ Today's Inventory Imported"
                  : "⏳ Today's Inventory Missing"}
              </Badge>
            </div>
          </div>
        )}

        {status === undefined && !failed && (
          <TableSkeleton rows={6} cols={3} />
        )}

        {status === undefined && failed && (
          <EmptyState
            icon={<InventoryIcon />}
            title="Couldn't load checking status"
            description="Something went wrong reaching the backend."
            action={
              <Button variant="secondary" size="sm" onClick={reload}>
                Try again
              </Button>
            }
          />
        )}

        {status !== undefined && isEligible && items.length === 0 && (
          <EmptyState
            icon={<InventoryIcon />}
            title="All stock records reconciled"
            description="No inventory discrepancies need physical checking at this branch."
          />
        )}

        {status !== undefined && isEligible && items.length > 0 && (
          <TableContainer className="border-0 rounded-none shadow-none">
            <Thead className="top-0">
              <Tr>
                <Th>Stock Code</Th>
                <Th>Description</Th>
                <Th className="text-right">System Qty</Th>
                <Th className="text-right">Physical Count</Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((item) => (
                <Tr key={item.stock_code}>
                  <Td className="font-mono font-medium">{item.stock_code}</Td>
                  <Td>{item.description || "—"}</Td>
                  <Td className="text-right font-mono">
                    {item.on_hand_qty != null
                      ? item.on_hand_qty.toLocaleString()
                      : "—"}
                  </Td>
                  <Td className="text-right text-text-muted text-xs italic">
                    Count on shelf
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </TableContainer>
        )}
      </div>
    </div>
  );
}
