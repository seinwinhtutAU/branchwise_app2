import { useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { cn } from "@renderer/lib/utils";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Select } from "@renderer/components/ui/Select";
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
import { StatTile } from "@renderer/components/features/dashboard/shared";

interface FreshnessRow {
  branch_id: string;
  branch_name: string;
  sales_last_imported_at: string | null;
  inventory_last_imported_at: string | null;
  purchase_last_imported_at: string | null;
}

type BatchImportType = "sales" | "purchase" | "inventory";
type ReviewStatus = "review" | "possible_duplicate";

interface BatchReviewRow {
  batch_id: string;
  import_type: BatchImportType;
  branch_name: string;
  filename: string | null;
  confirmed_at: string;
  note: string;
  status: ReviewStatus;
}

interface SlipMismatchRow {
  batch_id: string;
  branch_name: string;
  slip_id: string;
  date: string;
  line_total: number;
  subtotal_on_slip: number;
  difference: number;
}

interface ImportHealthResponse {
  batches_checked: number;
  batches_to_review: BatchReviewRow[];
  slip_total_mismatches: SlipMismatchRow[];
}

interface Props {
  session: Session;
  onViewImportBatch?: (batchId: string) => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" });
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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

// Sales and inventory files are exported every day, so "fresh" has a narrow window:
// today is fine, yesterday is a soft warning (maybe just not uploaded yet today),
// anything older — or never imported — is a real gap worth someone's attention.
function freshnessBadge(iso: string | null): {
  variant: "success" | "warning" | "error";
  label: string;
} {
  if (!iso) return { variant: "error", label: "Never imported" };
  const days = daysSince(iso);
  if (days <= 0) return { variant: "success", label: "Today" };
  if (days === 1) return { variant: "warning", label: "Yesterday" };
  return { variant: "error", label: `${days} days ago` };
}

// Purchases only happen when a branch actually restocks, which isn't every day, so an
// old purchase import means "nothing was bought", not "someone forgot to upload".
// Show when it last happened, but never grade it as late.
function occasionalBadge(iso: string | null): {
  variant: "default";
  label: string;
} {
  return { variant: "default", label: iso ? agoLabel(iso) : "None yet" };
}

function FreshnessCell({
  iso,
  expectedDaily = true,
}: {
  iso: string | null;
  expectedDaily?: boolean;
}): React.JSX.Element {
  const { variant, label } = expectedDaily
    ? freshnessBadge(iso)
    : occasionalBadge(iso);
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={variant}>{label}</Badge>
      {iso && (
        <span className="text-xs text-text-muted whitespace-nowrap">
          {formatDateTime(iso)}
        </span>
      )}
    </div>
  );
}

const TYPE_BADGE: Record<
  BatchImportType,
  { variant: "info" | "brand" | "default"; label: string }
> = {
  sales: { variant: "info", label: "Sales" },
  purchase: { variant: "brand", label: "Purchase" },
  inventory: { variant: "default", label: "Inventory" },
};

const STATUS_BADGE: Record<
  ReviewStatus,
  { variant: "error" | "warning"; label: string }
> = {
  review: { variant: "error", label: "Review" },
  possible_duplicate: { variant: "warning", label: "Possible duplicate" },
};

const DAYS_OPTIONS = [7, 30, 90] as const;

type Tab = "freshness" | "health";

const TABS: { id: Tab; label: string }[] = [
  { id: "freshness", label: "Import freshness" },
  { id: "health", label: "Import Health" },
];

function OverviewTabBar({
  activeTab,
  onSelect,
}: {
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 p-1 rounded-lg bg-bg-subtle w-fit"
    >
      {TABS.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            "flex items-center gap-1.5 h-8 px-4 rounded-md text-sm font-medium transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
            activeTab === tab.id
              ? "bg-brand-subtle text-brand shadow-sm"
              : "text-text-muted hover:text-text-secondary",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function ImportOverviewPage({
  session,
  onViewImportBatch,
}: Props): React.JSX.Element {
  const showToast = useToast();
  const [activeTab, setActiveTab] = useState<Tab>("freshness");

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

  const [days, setDays] = useState<number>(30);
  // `days` is in the URL, so changing it is a different cache key and fetches properly.
  const {
    data: fetchedHealth,
    isRefreshing: healthRefreshing,
    failed: healthFailed,
    reload: loadHealth,
  } = useUrlQuery<ImportHealthResponse>(
    `${apiBaseUrl}/api/imports/health?days=${days}`,
    session,
    "import health",
  );
  const health = fetchedHealth ?? null;

  async function dismissBatch(batchId: string): Promise<void> {
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/imports/health/${batchId}/dismiss`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!response.ok) {
        showToast("error", `Failed to dismiss: ${response.status}`);
        return;
      }
      // Refetch rather than dropping the row locally: the cached copy is shared, and a
      // hand-edited one would disagree with the server the next time it is read.
      loadHealth();
      showToast(
        "success",
        "Dismissed — already handled batches won't clutter this list",
      );
    } catch {
      showToast("error", "Failed to dismiss — is the backend running?");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <CardHeader
        title="Import Overview"
        description="Is this import pipeline actually working: are branches uploading on schedule, and when they do, did cleaning and confirm handle the file correctly — separate from Warning, which checks data already saved."
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              loadFreshness();
              loadHealth();
            }}
            loading={freshnessRefreshing || healthRefreshing}
          >
            Refresh
          </Button>
        }
      />

      <div className="flex items-center justify-between gap-4 flex-wrap">
        <OverviewTabBar activeTab={activeTab} onSelect={setActiveTab} />
        {activeTab === "health" && (
          <div className="w-40">
            <Select
              label="Period"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
            >
              {DAYS_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Last {option} days
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>

      {activeTab === "freshness" && (
        <>
          {freshness === null && !freshnessFailed && (
            <TableSkeleton rows={3} cols={4} />
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
            <TableContainer>
              <Thead>
                <Tr>
                  <Th>Branch</Th>
                  <Th>Sales</Th>
                  <Th>Inventory</Th>
                  <Th>
                    Purchase
                    <span className="ml-1 font-normal normal-case text-xs text-text-muted">
                      (not daily)
                    </span>
                  </Th>
                </Tr>
              </Thead>
              <Tbody>
                {freshness.map((row) => (
                  <Tr key={row.branch_id}>
                    <Td>{row.branch_name}</Td>
                    <Td>
                      <FreshnessCell iso={row.sales_last_imported_at} />
                    </Td>
                    <Td>
                      <FreshnessCell iso={row.inventory_last_imported_at} />
                    </Td>
                    <Td>
                      <FreshnessCell
                        iso={row.purchase_last_imported_at}
                        expectedDaily={false}
                      />
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </TableContainer>
          )}
        </>
      )}

      {activeTab === "health" && (
        <>
          {health === null && !healthFailed && (
            <TableSkeleton rows={4} cols={4} />
          )}

          {health === null && healthFailed && (
            <EmptyState
              icon={<HeartPulseIcon />}
              title="Couldn't load import health"
              description="Something went wrong reaching the backend."
              action={
                <Button variant="secondary" size="sm" onClick={loadHealth}>
                  Try again
                </Button>
              }
            />
          )}

          {health !== null && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <StatTile
                  label="Batches checked"
                  value={String(health.batches_checked)}
                  sub={`last ${days} days · Sales, Purchase, Inventory`}
                />
                <StatTile
                  label="Batches flagged"
                  value={String(health.batches_to_review.length)}
                  sub={
                    health.batches_to_review.length > 0
                      ? "worth a second look"
                      : "nothing flagged"
                  }
                />
                <StatTile
                  label="Slip-total mismatches"
                  value={String(health.slip_total_mismatches.length)}
                  sub="Sales only"
                />
              </div>

              <Card>
                <CardHeader
                  title="Batches to review"
                  description="Covers all three import types — each fails differently at confirm time, so each gets its own kind of check."
                />
                {health.batches_to_review.length === 0 ? (
                  <EmptyState
                    icon={<HeartPulseIcon />}
                    title="Nothing flagged"
                    description={`No Sales, Purchase, or Inventory batch in the last ${days} days looked anomalous.`}
                  />
                ) : (
                  <TableContainer>
                    <Thead>
                      <Tr>
                        <Th>Confirmed</Th>
                        <Th>Type</Th>
                        <Th>Branch</Th>
                        <Th>File</Th>
                        <Th>What we found</Th>
                        <Th>Status</Th>
                        <Th></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {health.batches_to_review.map((row) => (
                        <Tr key={row.batch_id}>
                          <Td className="whitespace-nowrap">
                            {formatDate(row.confirmed_at)}
                          </Td>
                          <Td>
                            <Badge
                              variant={TYPE_BADGE[row.import_type].variant}
                            >
                              {TYPE_BADGE[row.import_type].label}
                            </Badge>
                          </Td>
                          <Td className="font-medium">{row.branch_name}</Td>
                          <Td
                            className="max-w-[16rem] truncate"
                            title={row.filename ?? undefined}
                          >
                            {row.filename}
                          </Td>
                          <Td className="max-w-[28rem]">{row.note}</Td>
                          <Td>
                            <Badge variant={STATUS_BADGE[row.status].variant}>
                              {STATUS_BADGE[row.status].label}
                            </Badge>
                          </Td>
                          <Td>
                            <div className="flex items-center gap-3">
                              {onViewImportBatch && (
                                <button
                                  className="text-brand text-sm font-medium hover:underline whitespace-nowrap"
                                  onClick={() =>
                                    onViewImportBatch(row.batch_id)
                                  }
                                >
                                  View in History →
                                </button>
                              )}
                              <button
                                className="text-text-muted text-sm font-medium hover:underline hover:text-text-secondary whitespace-nowrap"
                                title="Already handled — hide this from Batches to review"
                                onClick={() => dismissBatch(row.batch_id)}
                              >
                                Dismiss
                              </button>
                            </div>
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </TableContainer>
                )}
              </Card>

              <Card>
                <CardHeader
                  title="Slip-total mismatches"
                  description="A slip's line items don't add up to its own subtotal row — usually a misread row during cleaning. Sales only, since only Sales' source format has a slip subtotal to check against."
                />
                {health.slip_total_mismatches.length === 0 ? (
                  <EmptyState
                    icon={<HeartPulseIcon />}
                    title="No mismatches"
                    description={`Every slip confirmed in the last ${days} days added up to its own subtotal.`}
                  />
                ) : (
                  <TableContainer>
                    <Thead>
                      <Tr>
                        <Th>Slip ID</Th>
                        <Th>Branch</Th>
                        <Th>Date</Th>
                        <Th className="text-right">Line items total</Th>
                        <Th className="text-right">Subtotal on slip</Th>
                        <Th className="text-right">Difference</Th>
                        <Th></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {health.slip_total_mismatches.map((row) => (
                        <Tr key={`${row.batch_id}-${row.slip_id}`}>
                          <Td className="font-mono text-xs">{row.slip_id}</Td>
                          <Td className="font-medium">{row.branch_name}</Td>
                          <Td className="whitespace-nowrap">
                            {formatDate(row.date)}
                          </Td>
                          <Td className="text-right tabular-nums">
                            {formatMoney(row.line_total)}
                          </Td>
                          <Td className="text-right tabular-nums">
                            {formatMoney(row.subtotal_on_slip)}
                          </Td>
                          <Td className="text-right tabular-nums text-warning font-medium">
                            {formatMoney(row.difference)}
                          </Td>
                          <Td>
                            {onViewImportBatch && (
                              <button
                                className="text-brand text-sm font-medium hover:underline"
                                onClick={() => onViewImportBatch(row.batch_id)}
                              >
                                View in History →
                              </button>
                            )}
                          </Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </TableContainer>
                )}
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default ImportOverviewPage;
