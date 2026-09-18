// StockList — filterable list of stock records with overview, locations, movement tabs.

import { useMemo, useState } from "react";
import { useSearchShortcut } from "@renderer/lib/useSearchShortcut";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import { Select } from "@renderer/components/ui/Select";
import {
  TableContainer, Tbody, Td, Th, Thead, Tr,
} from "@renderer/components/ui/Table";
import { InventoryIcon, SearchIcon } from "@renderer/components/ui/icons";
import {
  CopyButton, PAGE_SIZE, Panel,
} from "@renderer/components/features/wholesale/shared/ui";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/shared/products";
import { cn } from "@renderer/lib/utils";
import {
  type StockRecord,
  type StockMovement,
} from "@renderer/components/features/wholesale/inventory/stock";
import { inventoryHealth, stockPlaces } from "./inventoryUtils";
import {
  InventorySectionTabs,
  InventoryRefreshButton,
  StockRowMenu,
  StockPlaces,
  HealthBadge,
} from "./InventoryBadges";
import { InventorySummaryCards, InventoryInsights } from "./InventorySummaryCards";
import { InventoryMovementTable } from "./InventoryMovementTable";
import { type InventoryHealth } from "./types";

export function StockList({
  records,
  movements,
  onOpen,
  onRefresh,
  refreshing,
  onOpenOrders,
}: {
  records: StockRecord[];
  movements: StockMovement[];
  onOpen: (stockCode: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onOpenOrders?: () => void;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [health, setHealth] = useState<InventoryHealth | "all">("all");
  const [page, setPage] = useState(1);
  const searchInputRef = useSearchShortcut();
  const [section, setSection] = useState<"overview" | "locations" | "movement">("overview");

  const onShelfPairs = records.reduce(
    (sum, record) => sum + Math.max(0, record.available_pairs),
    0,
  );
  const owedToCustomersPairs = records.reduce(
    (sum, record) => sum + Math.max(0, record.owed_to_customers_pairs),
    0,
  );

  const locations = [
    ...new Set(records.flatMap((record) => stockPlaces(record).map((place) => place.label))),
  ].sort();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((record) => {
      const matchesQuery =
        query === "" ||
        record.stock_code.toLowerCase().includes(query) ||
        record.description.toLowerCase().includes(query) ||
        record.colors.toLowerCase().includes(query) ||
        record.locations.some((entry) => entry.location.toLowerCase().includes(query)) ||
        [
          ...record.voucher_nos,
          ...record.shipment_nos,
          ...record.order_nos,
          ...record.receiving_nos,
        ].some((reference) => reference.toLowerCase().includes(query));
      const matchesLocation =
        location === "all" ||
        stockPlaces(record).some((place) => place.label === location);
      const matchesHealth = health === "all" || inventoryHealth(record) === health;
      return matchesQuery && matchesLocation && matchesHealth;
    });
  }, [records, search, location, health]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isFiltered =
    search.trim() !== "" ||
    (locations.length > 1 && location !== "all") ||
    health !== "all";

  function resetFilters(): void {
    setSearch("");
    setLocation("all");
    setHealth("all");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <InventorySectionTabs section={section} onChange={setSection} />

      {section === "overview" && (
        <>
          {owedToCustomersPairs > 0 && onOpenOrders && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/40 bg-success-subtle px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-primary">
                  {formatSets(onShelfPairs)} on the shelf, ready to go out.
                </p>
                <p className="mt-0.5 text-sm text-text-secondary">
                  {`Customers are still waiting for ${formatSets(owedToCustomersPairs)}.`}
                </p>
              </div>
              <Button size="sm" onClick={onOpenOrders}>
                Deliver to customer
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-text-primary tracking-tight">Inventory Overview</h2>
              <p className="text-sm text-text-muted mt-0.5">A quick view of stock, availability, and movement.</p>
            </div>
            <InventoryRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
          </div>
          <InventorySummaryCards records={records} />
          <InventoryInsights records={records} />
        </>
      )}

      {section === "locations" && <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Stock Records
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              All inventory items across all locations.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <InventoryRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
          </div>
        </div>

        <>
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
            <div className="w-full sm:w-[24rem] lg:w-[28rem]">
              <Input
                ref={searchInputRef}
                aria-label="Search stock"
                placeholder="Search product, place or color"
                startIcon={<SearchIcon className="w-4 h-4" />}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div className="w-full sm:w-60">
              <Select
                aria-label="Filter by stock health"
                value={health}
                onChange={(event) => {
                  setHealth(event.target.value as InventoryHealth | "all");
                  setPage(1);
                }}
              >
                <option value="all">All stock health</option>
                <option value="Healthy">Healthy</option>
                <option value="Low Stock">Low Stock</option>
                <option value="Out of Stock">Out of Stock</option>
                <option value="Overstock">Overstock</option>
                <option value="Not arrived yet">Not arrived yet</option>
              </Select>
            </div>
            {locations.length > 1 && (
              <div className="w-full sm:w-52">
                <Select
                  aria-label="Filter by place"
                  value={location}
                  onChange={(event) => {
                    setLocation(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="all">All locations</option>
                  {locations.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {isFiltered && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Clear filters
              </Button>
            )}
          </div>

          {visible.length === 0 ? (
            <EmptyState
              icon={<InventoryIcon />}
              title={isFiltered ? "No stock matches" : "Nothing in stock yet"}
              description={
                isFiltered
                  ? "Nothing here matches what you searched for. Try a different code or place."
                  : "Products appear here as soon as they are on a supplier voucher, a shipment or a customer order — not only once they arrive."
              }
              action={
                isFiltered ? (
                  <Button variant="secondary" onClick={resetFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <TableContainer className="border-0 rounded-none">
                <Thead>
                  <Tr>
                    <Th className="min-w-[12rem]">Product</Th>
                    <Th>Available</Th>
                    <Th>Location</Th>
                    <Th>Color</Th>
                    <Th>Stock Health</Th>
                    <Th className="w-12" aria-label="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {visible.map((record) => {
                    return (
                      <Tr key={record.stock_code}>
                        <Td>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => onOpen(record.stock_code)}
                                className={cn(
                                  "whitespace-nowrap font-bold text-brand hover:underline underline-offset-2",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                                )}
                              >
                                {record.stock_code || "No stock code"}
                              </button>
                              {record.stock_code && <CopyButton value={record.stock_code} what="stock code" />}
                            </div>
                            <div className="mt-1 max-w-[14rem]">
                              <span className="block truncate text-sm text-text-primary" title={record.description}>
                                {record.description || "—"}
                              </span>
                              <div className="text-xs text-text-muted">
                                {GROUP_LABELS[record.product_group]}
                              </div>
                            </div>
                          </div>
                        </Td>
                        <Td>
                          <div className="font-semibold tabular-nums text-success">
                            {formatSets(record.available_pairs)}
                          </div>
                        </Td>
                        <Td className="text-text-secondary whitespace-nowrap">
                          <StockPlaces record={record} />
                        </Td>
                        <Td className="font-mono text-xs text-text-secondary whitespace-nowrap">
                          {record.colors || "—"}
                        </Td>
                        <Td>
                          <HealthBadge record={record} />
                        </Td>
                        <Td>
                          <StockRowMenu onView={() => onOpen(record.stock_code)} />
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </TableContainer>
              <div className="px-6 py-3 border-t border-border">
                <Pagination
                  page={safePage}
                  totalPages={totalPages}
                  totalItems={filtered.length}
                  pageSize={PAGE_SIZE}
                  onPageChange={setPage}
                />
              </div>
            </>
          )}
        </>
      </Panel>}
      {section === "movement" && (
        <InventoryMovementTable
          movements={movements}
          records={records}
          onOpen={onOpen}
          onRefresh={onRefresh}
          refreshing={refreshing}
        />
      )}
    </div>
  );
}
