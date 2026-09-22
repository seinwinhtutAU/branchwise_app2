import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { formatRetailDateTime } from "@renderer/lib/retailDateTime";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { useStickyAbove } from "@renderer/lib/useStickyAbove";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { TableSkeleton } from "@renderer/components/ui/Skeleton";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import { HeartPulseIcon } from "@renderer/components/ui/icons";

interface FreshnessRow {
  branch_id: string;
  branch_name: string;
  sales_last_imported_at: string | null;
  inventory_last_imported_at: string | null;
  purchase_last_imported_at: string | null;
  sales_data_date: string | null;
  inventory_data_date: string | null;
  // Optional while a desktop client is connected to an older backend that has not
  // deployed the sequence check yet. A missing field must not take down the page.
  purchase_number_integrity?: PurchaseNumberIntegrity;
}

interface PurchaseNumberGap {
  start_number: string;
  end_number: string;
  missing_count: number;
}

interface PurchaseNumberIntegrity {
  numbered_purchase_count: number;
  gap_count: number;
  missing_number_count: number;
  gaps: PurchaseNumberGap[];
}

const EMPTY_PURCHASE_NUMBER_INTEGRITY: PurchaseNumberIntegrity = {
  numbered_purchase_count: 0,
  gap_count: 0,
  missing_number_count: 0,
  gaps: [],
};

interface Props {
  session: Session;
  onViewImportBatch?: (batchId: string) => void;
}

function daysSince(iso: string): number {
  return Math.floor(
    (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24),
  );
}

function agoLabel(iso: string): string {
  const days = daysSince(iso);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

// Sales and inventory files are exported daily, so "fresh" has a narrow window:
// today is fine, yesterday is a soft warning, older or never imported is an error.
function daysSinceDataDate(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  const dataDate = new Date(year, month - 1, day);
  const today = new Date();
  const currentDate = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  return Math.floor(
    (currentDate.getTime() - dataDate.getTime()) / (1000 * 60 * 60 * 24),
  );
}

function dataDateBadge(iso: string | null): {
  variant: "success" | "warning" | "error";
  label: string;
} {
  if (!iso) return { variant: "error", label: "No update today" };
  const days = daysSinceDataDate(iso);
  if (days <= 0) return { variant: "success", label: "Today" };
  if (days === 1) return { variant: "warning", label: "Yesterday" };
  return { variant: "error", label: `${days} days ago` };
}

// Purchases only happen when a branch actually restocks, so never grade it as late.
function occasionalBadge(iso: string | null): {
  variant: "default";
  label: string;
} {
  return { variant: "default", label: iso ? agoLabel(iso) : "None yet" };
}

function FreshnessCell({
  uploadedAt,
  dataDate,
}: {
  uploadedAt: string | null;
  dataDate: string | null;
}): React.JSX.Element {
  const { variant, label } = dataDateBadge(dataDate);
  return (
    <div className="flex flex-col items-start justify-center gap-1 min-h-[44px]">
      <Badge variant={variant} dot>
        {label}
      </Badge>
      <span className="text-[11px] text-text-muted whitespace-nowrap tabular-nums">
        For: {dataDate ?? "—"}
      </span>
      <span className="text-[11px] text-text-muted whitespace-nowrap tabular-nums">
        Uploaded: {uploadedAt ? formatRetailDateTime(uploadedAt) : "—"}
      </span>
    </div>
  );
}

function PurchaseFreshnessCell({
  uploadedAt,
  integrity,
}: {
  uploadedAt: string | null;
  integrity?: PurchaseNumberIntegrity;
}): React.JSX.Element {
  const checkedIntegrity = {
    ...EMPTY_PURCHASE_NUMBER_INTEGRITY,
    ...integrity,
    gaps: integrity?.gaps ?? EMPTY_PURCHASE_NUMBER_INTEGRITY.gaps,
  };
  const firstGap = checkedIntegrity.gaps[0];
  const hasGaps = checkedIntegrity.missing_number_count > 0;
  const upload = occasionalBadge(uploadedAt);
  return (
    <div className="flex flex-col items-start justify-center gap-1 min-h-[44px]">
      <Badge variant={upload.variant} dot>
        {upload.label}
      </Badge>
      <span className="text-[11px] text-text-muted whitespace-nowrap tabular-nums">
        Uploaded: {uploadedAt ? formatRetailDateTime(uploadedAt) : "—"}
      </span>
      {checkedIntegrity.numbered_purchase_count === 0 ? (
        <span className="text-[11px] text-text-muted">
          No numbered purchases
        </span>
      ) : hasGaps && firstGap ? (
        <span className="text-[11px] font-medium text-error">
          Gap: {firstGap.start_number}–{firstGap.end_number} (
          {checkedIntegrity.missing_number_count} missing)
        </span>
      ) : (
        <span className="text-[11px] font-medium text-success">
          {checkedIntegrity.numbered_purchase_count} numbered purchase
          {checkedIntegrity.numbered_purchase_count === 1 ? "" : "s"} · sequence
          complete
        </span>
      )}
    </div>
  );
}

export function ImportOverviewPage({ session }: Props): React.JSX.Element {
  const { aboveRef, containerStyle } = useStickyAbove();
  const {
    data: fetchedFreshness,
    isRefreshing: freshnessRefreshing,
    failed: freshnessFailed,
    reload: loadFreshness,
  } = useUrlQuery<FreshnessRow[]>(
    `${apiBaseUrl}/api/imports/freshness`,
    session,
    "upload freshness",
  );
  const freshness = fetchedFreshness ?? null;

  return (
    <div className="flex flex-col" style={containerStyle}>
      <div className="bg-bg-base border border-border rounded-md overflow-hidden shadow-xs">
        <div
          ref={aboveRef}
          className="sticky top-14 lg:top-0 z-30 bg-bg-base px-4 py-2.5 border-b border-border"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
                Import Freshness
              </h2>
              <span className="text-xs text-text-muted hidden sm:inline">
                Confirms upload time, the day covered by Sale/Inventory, and
                Purchase-number continuity across branches.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <RefreshButton
                onClick={loadFreshness}
                refreshing={freshnessRefreshing}
              />
            </div>
          </div>
        </div>

        {freshness === null && !freshnessFailed && (
          <div className="p-4">
            <TableSkeleton rows={3} cols={4} />
          </div>
        )}

        {freshness === null && freshnessFailed && (
          <EmptyState
            icon={<HeartPulseIcon />}
            title="Couldn't load upload freshness"
            description="Something went wrong reaching the backend."
            action={
              <Button variant="secondary" size="sm" onClick={loadFreshness}>
                Try again
              </Button>
            }
          />
        )}

        {freshness !== null && freshness.length === 0 && (
          <EmptyState
            icon={<HeartPulseIcon />}
            title="No branches yet"
            description="Once a branch has an account and imports data, it'll show up here."
          />
        )}

        {freshness !== null && freshness.length > 0 && (
          <TableContainer
            className="overflow-y-auto border-0 rounded-none"
            style={{
              maxHeight: "calc(100vh - var(--sticky-offset, 0px) - 8rem)",
            }}
          >
            <Thead className="top-0">
              <Tr>
                <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
                  #
                </Th>
                <Th className="min-w-[140px]">Branch</Th>
                <Th className="min-w-[220px]">Sales</Th>
                <Th className="min-w-[220px]">Inventory</Th>
                <Th className="min-w-[170px]">
                  <div className="flex items-center gap-1.5">
                    <span>Purchase</span>
                    <span className="font-normal normal-case text-xs text-text-muted">
                      (not daily · sequence checked)
                    </span>
                  </div>
                </Th>
              </Tr>
            </Thead>
            <Tbody>
              {freshness.map((row, index) => (
                <Tr key={row.branch_id}>
                  <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                    {index + 1}
                  </Td>
                  <Td className="font-medium text-text-primary">
                    {row.branch_name}
                  </Td>
                  <Td>
                    <FreshnessCell
                      uploadedAt={row.sales_last_imported_at}
                      dataDate={row.sales_data_date}
                    />
                  </Td>
                  <Td>
                    <FreshnessCell
                      uploadedAt={row.inventory_last_imported_at}
                      dataDate={row.inventory_data_date}
                    />
                  </Td>
                  <Td>
                    <PurchaseFreshnessCell
                      uploadedAt={row.purchase_last_imported_at}
                      integrity={row.purchase_number_integrity}
                    />
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

export default ImportOverviewPage;
