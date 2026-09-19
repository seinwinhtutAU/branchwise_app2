import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { Card, CardHeader } from "@renderer/components/ui/Card";
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

// Purchases only happen when a branch actually restocks, so never grade it as late.
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
    <div className="flex flex-col items-start justify-center gap-1 min-h-[44px]">
      <Badge variant={variant} dot>
        {label}
      </Badge>
      {iso ? (
        <span className="text-[11px] text-text-muted whitespace-nowrap tabular-nums">
          {formatDateTime(iso)}
        </span>
      ) : (
        <span className="text-[11px] text-text-muted/40 whitespace-nowrap select-none">
          —
        </span>
      )}
    </div>
  );
}

export function ImportOverviewPage({ session }: Props): React.JSX.Element {
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
    <div className="flex flex-col gap-4">
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
        <Card>
          <CardHeader
            title="Branch Upload Freshness"
            description="Live tracking of the latest sales, inventory, and purchase uploads across branches."
            action={
              <RefreshButton
                onClick={loadFreshness}
                refreshing={freshnessRefreshing}
              />
            }
          />
          <TableContainer>
            <Thead>
              <Tr>
                <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
                  #
                </Th>
                <Th className="min-w-[140px]">Branch</Th>
                <Th className="min-w-[170px]">Sales</Th>
                <Th className="min-w-[170px]">Inventory</Th>
                <Th className="min-w-[170px]">
                  <div className="flex items-center gap-1.5">
                    <span>Purchase</span>
                    <span className="font-normal normal-case text-xs text-text-muted">
                      (not daily)
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
        </Card>
      )}
    </div>
  );
}

export default ImportOverviewPage;
