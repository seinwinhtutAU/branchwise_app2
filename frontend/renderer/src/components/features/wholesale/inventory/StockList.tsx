import { useMemo, useState } from "react";
import { useSearchShortcut } from "@renderer/lib/useSearchShortcut";
import { Button } from "@renderer/components/ui/Button";
import { CollapsibleKpiSummary } from "@renderer/components/ui/CollapsibleKpiSummary";
import { ColumnHeaderFilter } from "@renderer/components/ui/ColumnHeaderFilter";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import {
  TableContainer, Tbody, Td, Th, Thead, Tr,
} from "@renderer/components/ui/Table";
import { CheckIcon, CloseIcon, InventoryIcon, SearchIcon } from "@renderer/components/ui/icons";
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
}: {
  records: StockRecord[];
  movements: StockMovement[];
  onOpen: (stockCode: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("all");
  const [health, setHealth] = useState<InventoryHealth | "all">("all");
  const [page, setPage] = useState(1);
  const searchInputRef = useSearchShortcut();
  const [section, setSection] = useState<"overview" | "locations" | "movement">("overview");

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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-text-primary tracking-tight">Inventory Overview</h2>
            </div>
            <InventoryRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
          </div>
          <CollapsibleKpiSummary storageKey="wholesale_stock_overview" title="Stock Overview">
            <InventorySummaryCards records={records} />
            <InventoryInsights records={records} />
          </CollapsibleKpiSummary>
        </>
      )}

      {section === "locations" && <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-bg-base">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
              Stock Records
            </h2>
            {isFiltered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="text-xs h-6 px-1.5 text-text-muted hover:text-error"
              >
                <CloseIcon className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="w-48 sm:w-64">
              <Input
                ref={searchInputRef}
                aria-label="Search stock"
                placeholder="Search product, place or color… (/)"
                startIcon={<SearchIcon className="w-3.5 h-3.5" />}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="h-8 text-xs"
              />
            </div>
            <InventoryRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
          </div>
        </div>

        <>
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
                    <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">#</Th>
                    <Th className="min-w-[12rem]">Product</Th>
                    <Th>Available</Th>
                    <Th className="whitespace-nowrap">
                      {locations.length > 1 ? (
                        <ColumnHeaderFilter
                          label="Location"
                          isActive={location !== "all"}
                        >
                          {(close) => (
                            <div className="flex flex-col gap-1.5">
                              <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                                Filter Location
                              </div>
                              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setLocation("all");
                                    setPage(1);
                                    close();
                                  }}
                                  className={cn(
                                    "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                    location === "all"
                                      ? "bg-brand/10 font-bold text-brand"
                                      : "hover:bg-bg-subtle text-text-secondary",
                                  )}
                                >
                                  <span>All locations</span>
                                  {location === "all" && <CheckIcon className="w-3.5 h-3.5" />}
                                </button>
                                {locations.map((name) => (
                                  <button
                                    key={name}
                                    type="button"
                                    onClick={() => {
                                      setLocation(name);
                                      setPage(1);
                                      close();
                                    }}
                                    className={cn(
                                      "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                      location === name
                                        ? "bg-brand/10 font-bold text-brand"
                                        : "hover:bg-bg-subtle text-text-secondary",
                                    )}
                                  >
                                    <span>{name}</span>
                                    {location === name && <CheckIcon className="w-3.5 h-3.5" />}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </ColumnHeaderFilter>
                      ) : (
                        "Location"
                      )}
                    </Th>
                    <Th>Color</Th>
                    <Th className="whitespace-nowrap">
                      <ColumnHeaderFilter
                        label="Stock Health"
                        isActive={health !== "all"}
                      >
                        {(close) => (
                          <div className="flex flex-col gap-1.5">
                            <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                              Filter Stock Health
                            </div>
                            <div className="space-y-0.5 max-h-48 overflow-y-auto">
                              <button
                                type="button"
                                onClick={() => {
                                  setHealth("all");
                                  setPage(1);
                                  close();
                                }}
                                className={cn(
                                  "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                  health === "all"
                                    ? "bg-brand/10 font-bold text-brand"
                                    : "hover:bg-bg-subtle text-text-secondary",
                                )}
                              >
                                <span>All stock health</span>
                                {health === "all" && <CheckIcon className="w-3.5 h-3.5" />}
                              </button>
                              {(["Healthy", "Low Stock", "Out of Stock", "Overstock", "Not arrived yet"] as const).map((option) => (
                                <button
                                  key={option}
                                  type="button"
                                  onClick={() => {
                                    setHealth(option);
                                    setPage(1);
                                    close();
                                  }}
                                  className={cn(
                                    "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                    health === option
                                      ? "bg-brand/10 font-bold text-brand"
                                      : "hover:bg-bg-subtle text-text-secondary",
                                  )}
                                >
                                  <span>{option}</span>
                                  {health === option && <CheckIcon className="w-3.5 h-3.5" />}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </ColumnHeaderFilter>
                    </Th>
                    <Th className="w-12" aria-label="Actions" />
                  </Tr>
                </Thead>
                <Tbody>
                  {visible.map((record, index) => {
                    const rowNum = (safePage - 1) * PAGE_SIZE + index + 1;
                    return (
                      <Tr key={record.stock_code}>
                        <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                          {rowNum}
                        </Td>
                        <Td>
                          <div className="min-w-0 max-w-[16rem]">
                            <div className="flex items-center gap-1.5 flex-wrap">
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
                              <span className="text-xs text-text-muted">
                                · {GROUP_LABELS[record.product_group]}
                              </span>
                            </div>
                            <span className="block truncate text-sm text-text-primary mt-0.5" title={record.description}>
                              {record.description || "—"}
                            </span>
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
              <div className="px-4 py-1.5 border-t border-border">
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
