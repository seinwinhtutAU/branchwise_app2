import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import { DashboardIcon, InventoryIcon } from "@renderer/components/ui/icons";
import { CopyButton } from "@renderer/components/ui/CopyButton";
import { RefreshingHint, StatTile, WarningsTile } from "./shared";
import {
  dashboardUrl,
  formatCount,
  formatMoney,
  formatShortDate,
  type SaleWarningRow,
} from "./helpers";

interface CategoryQty {
  category: string;
  qty: number;
}

interface LowStockItem {
  stock_code: string;
  description: string;
  on_hand_qty: number;
  days_left: number;
  status: "Critical" | "Low" | "Watch";
}

interface DeadStockItem {
  stock_code: string;
  description: string;
  on_hand_qty: number;
  category: string;
  // null means never sold at all, not just "not in the last 90 days".
  days_since_last_sale: number | null;
}

interface InventoryDashboardData {
  branch_name: string;
  as_of: string | null;
  sku_count: number;
  critical_count: number;
  low_count: number;
  watch_count: number;
  estimated_stock_value: number;
  dead_stock_count: number;
  stock_qty_by_category: CategoryQty[];
  low_stock_items: LowStockItem[];
  dead_stock_items: DeadStockItem[];
  warnings: SaleWarningRow[];
}

const STATUS_BADGE_VARIANT: Record<
  LowStockItem["status"],
  "error" | "warning" | "info"
> = {
  Critical: "error",
  Low: "warning",
  Watch: "info",
};

function CategoryQtyList({
  categories,
}: {
  categories: CategoryQty[];
}): React.JSX.Element {
  if (categories.length === 0) {
    return <p className="text-xs text-text-muted py-4 text-center">No categorized stock yet.</p>;
  }
  const maxQty = Math.max(...categories.map((c) => c.qty), 0);
  return (
    <div className="flex flex-col gap-2 py-0.5">
      {categories.map((row) => (
        <div key={row.category} className="flex items-center gap-2.5">
          <span
            className="w-24 shrink-0 truncate text-xs text-text-secondary font-medium"
            title={row.category}
          >
            {row.category}
          </span>
          <div className="flex-1 h-2 rounded-full bg-bg-raised overflow-hidden">
            <div
              className="h-full rounded-full bg-brand transition-all duration-500"
              style={{
                width: maxQty > 0 ? `${Math.max((row.qty / maxQty) * 100, 1.5)}%` : "0%",
              }}
            />
          </div>
          <span className="w-20 shrink-0 text-right text-xs tabular-nums text-text-primary font-medium">
            {formatCount(row.qty)}
          </span>
        </div>
      ))}
    </div>
  );
}

// The dashboard is a glance, not a browse — a hundred-plus-row table here would defeat
// that. 6 rows is enough to see whether it's worth acting on; "View all" hands off to
// the full, paginated, filterable list on the Inventory nav page for the rest.
const PREVIEW_ROWS = 6;

function ViewAllLink({
  totalCount,
  shown,
  onClick,
  label,
}: {
  totalCount: number;
  shown: number;
  onClick: () => void;
  label: string;
}): React.JSX.Element | null {
  if (totalCount <= shown) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 text-sm text-brand hover:text-brand-hover font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
    >
      View all {totalCount.toLocaleString()} {label} →
    </button>
  );
}

function LowStockTable({
  items,
  totalCount,
  onViewAll,
}: {
  items: LowStockItem[];
  totalCount: number;
  onViewAll: () => void;
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<InventoryIcon />}
        title="Nothing running low"
        description="No product is estimated to run out soon based on recent sales velocity."
      />
    );
  }
  const preview = items.slice(0, PREVIEW_ROWS);
  return (
    <>
      <TableContainer>
        <Thead>
          <Tr>
            <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">#</Th>
            <Th>Status</Th>
            <Th>Stock Code</Th>
            <Th>Description</Th>
            <Th className="text-right">On Hand Qty</Th>
            <Th className="text-right">Est. Days Left</Th>
          </Tr>
        </Thead>
        <Tbody>
          {preview.map((item, index) => (
            <Tr key={item.stock_code}>
              <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                {index + 1}
              </Td>
              <Td>
                <Badge variant={STATUS_BADGE_VARIANT[item.status]}>
                  {item.status}
                </Badge>
              </Td>
              <Td>
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <span className="font-mono text-xs font-semibold text-brand">{item.stock_code}</span>
                  <CopyButton value={item.stock_code} what="stock code" />
                </div>
              </Td>
              <Td>{item.description}</Td>
              <Td className="text-right tabular-nums">
                {item.on_hand_qty.toLocaleString()}
              </Td>
              <Td className="text-right tabular-nums">{item.days_left}</Td>
            </Tr>
          ))}
        </Tbody>
      </TableContainer>
      <ViewAllLink
        totalCount={totalCount}
        shown={preview.length}
        onClick={onViewAll}
        label="low-stock items"
      />
    </>
  );
}

function DeadStockTable({
  items,
  totalCount,
  onViewAll,
}: {
  items: DeadStockItem[];
  totalCount: number;
  onViewAll: () => void;
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<InventoryIcon />}
        title="No dead stock"
        description="Nothing on hand has gone 90 days without a sale."
      />
    );
  }
  const preview = items.slice(0, PREVIEW_ROWS);
  return (
    <>
      <TableContainer>
        <Thead>
          <Tr>
            <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">#</Th>
            <Th>Stock Code</Th>
            <Th>Description</Th>
            <Th>Category</Th>
            <Th className="text-right">On Hand Qty</Th>
            <Th className="text-right">Days Unsold</Th>
          </Tr>
        </Thead>
        <Tbody>
          {preview.map((item, index) => (
            <Tr key={item.stock_code}>
              <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                {index + 1}
              </Td>
              <Td>
                <div className="flex items-center gap-1 whitespace-nowrap">
                  <span className="font-mono text-xs font-semibold text-brand">{item.stock_code}</span>
                  <CopyButton value={item.stock_code} what="stock code" />
                </div>
              </Td>
              <Td>{item.description}</Td>
              <Td className="text-text-muted">{item.category}</Td>
              <Td className="text-right tabular-nums">
                {item.on_hand_qty.toLocaleString()}
              </Td>
              <Td className="text-right tabular-nums text-text-muted">
                {item.days_since_last_sale === null
                  ? "Never sold"
                  : `${item.days_since_last_sale} days`}
              </Td>
            </Tr>
          ))}
        </Tbody>
      </TableContainer>
      <ViewAllLink
        totalCount={totalCount}
        shown={preview.length}
        onClick={onViewAll}
        label="dead-stock items"
      />
    </>
  );
}

interface Props {
  session: Session;
  branchId: string;
  canLoad: boolean;
  onViewWarnings: () => void;
  onViewInventoryList: (tab: "lowStock" | "deadStock") => void;
}

export function InventoryTab({
  session,
  branchId,
  canLoad,
  onViewWarnings,
  onViewInventoryList,
}: Props): React.JSX.Element {
  // One cached request per (tab, branch, period) — returning to this tab with the same
  // selection shows the numbers it showed last time instead of a skeleton. See
  // lib/queryClient.ts.
  const url = canLoad ? dashboardUrl("inventory", branchId) : null;
  const { data: fetched, isRefreshing, failed, reload } =
    useUrlQuery<InventoryDashboardData>(url, session, "Inventory dashboard");
  const data = fetched ?? null;

  if (!canLoad) return <></>;

  if (data === null) {
    if (failed) {
      return (
        <EmptyState
          icon={<DashboardIcon />}
          title="Couldn't load the Inventory dashboard"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Try again
            </Button>
          }
        />
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Skeleton className="h-18" />
          <Skeleton className="h-18" />
          <Skeleton className="h-18" />
          <Skeleton className="h-18" />
        </div>
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  const lowStockCount = data.critical_count + data.low_count + data.watch_count;

  return (
    <div className="flex flex-col gap-3">
      <RefreshingHint show={isRefreshing} />
      <p className="text-xs text-text-muted">
        {data.as_of
          ? `Current stock as of snapshot — ${formatShortDate(data.as_of.slice(0, 10), true)}.`
          : "No inventory snapshot on record for this branch yet."}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
        <StatTile
          label="SKUs Tracked"
          value={data.sku_count.toLocaleString()}
        />
        <StatTile
          label="Low / Critical Stock"
          value={lowStockCount.toLocaleString()}
          sub={`${data.critical_count} critical, ${data.low_count} low, ${data.watch_count} watch`}
        />
        <StatTile
          label="Estimated Stock Value"
          value={formatMoney(data.estimated_stock_value)}
        />
        <StatTile
          label="Dead Stock"
          value={data.dead_stock_count.toLocaleString()}
          sub="No sales in 90 days"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <Card className="p-3.5 sm:p-4">
          <CardHeader
            title="Stock on hand by category"
            description="On-hand quantity, grouped by product category."
          />
          <CategoryQtyList categories={data.stock_qty_by_category} />
        </Card>
        <Card className="p-3.5 sm:p-4">
          <CardHeader
            title="Inventory data quality"
            description="Bad values, missing records, and reconciliation mismatches."
          />
          <WarningsTile
            warnings={data.warnings}
            label="Inventory"
            onViewWarnings={onViewWarnings}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
        <Card className="p-3.5 sm:p-4">
          <CardHeader
            title="Low stock"
            description="Estimated to run out soonest, based on 30-day sales velocity."
          />
          <LowStockTable
            items={data.low_stock_items}
            totalCount={lowStockCount}
            onViewAll={() => onViewInventoryList("lowStock")}
          />
        </Card>

        <Card className="p-3.5 sm:p-4">
          <CardHeader
            title="Dead stock"
            description="Still on hand, but no sales in the last 90 days."
          />
          <DeadStockTable
            items={data.dead_stock_items}
            totalCount={data.dead_stock_count}
            onViewAll={() => onViewInventoryList("deadStock")}
          />
        </Card>
      </div>
    </div>
  );
}

export default InventoryTab;
