import { useCallback, useMemo, useState } from "react";
import { useSearchShortcut } from "@renderer/lib/useSearchShortcut";
import { Button } from "@renderer/components/ui/Button";
import { ColumnHeaderFilter } from "@renderer/components/ui/ColumnHeaderFilter";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import {
  TableContainer, Tbody, Td, Th, Thead, Tr,
} from "@renderer/components/ui/Table";
import { CheckIcon, CloseIcon, InventoryIcon, SearchIcon } from "@renderer/components/ui/icons";
import { CopyButton, PAGE_SIZE, Panel, Reference } from "@renderer/components/features/wholesale/shared/ui";
import { formatDate } from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { GROUP_LABELS } from "@renderer/components/features/wholesale/shared/products";
import { cn } from "@renderer/lib/utils";
import {
  type StockMovement,
  type StockRecord,
  type MovementKind,
} from "@renderer/components/features/wholesale/inventory/stock";
import { stockPlaces } from "./inventoryUtils";
import { MovementTypeBadge, InventoryRefreshButton, StockRowMenu } from "./InventoryBadges";

export function InventoryMovementTable({
  movements,
  records,
  onOpen,
  onRefresh,
  refreshing,
}: {
  movements: StockMovement[];
  /** Only so an allocated row can say where the reserved goods physically are — the
   *  reservation itself belongs to no place, so the server sends none. */
  records: StockRecord[];
  onOpen: (stockCode: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<MovementKind | "all">("all");
  const [location, setLocation] = useState("all");
  const [page, setPage] = useState(1);
  const searchInputRef = useSearchShortcut();
  const placesByStockCode = useMemo(() => {
    const places = new Map<string, string>();
    for (const record of records) {
      const label = stockPlaces(record)
        .map((place) => place.label)
        .join(", ");
      if (label) places.set(record.stock_code, label);
    }
    return places;
  }, [records]);
  /** An allocated row shows where its goods are rather than the word the server sends,
   *  so a reader can tell which shelf the reservation is sitting on. */
  const locationOf = useCallback(
    (movement: StockMovement): string =>
      movement.movement_type === "allocated"
        ? (placesByStockCode.get(movement.stock_code) ?? "")
        : movement.location,
    [placesByStockCode],
  );
  const locations = [
    ...new Set(movements.map((movement) => locationOf(movement)).filter(Boolean)),
  ].sort();
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...movements]
      .filter((movement) => {
        const matchesQuery =
          query === "" ||
          movement.stock_code.toLowerCase().includes(query) ||
          movement.description.toLowerCase().includes(query) ||
          locationOf(movement).toLowerCase().includes(query) ||
          movement.reference.toLowerCase().includes(query) ||
          movement.counterparty_name.toLowerCase().includes(query);
        return (
          matchesQuery &&
          (kind === "all" || movement.movement_type === kind) &&
          (location === "all" || locationOf(movement) === location)
        );
      })
      .sort((a, b) => (a.moved_on < b.moved_on ? 1 : -1));
  }, [movements, search, kind, location, locationOf]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function reset(): void {
    setSearch("");
    setKind("all");
    setLocation("all");
    setPage(1);
  }

  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-bg-base">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
            Inventory Movement
          </h2>
          {(search !== "" || kind !== "all" || location !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              onClick={reset}
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
              aria-label="Search inventory movement"
              placeholder="Search product, stock code or ref… (/)"
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

      {visible.length === 0 ? (
        <EmptyState
          icon={<InventoryIcon />}
          title="No movements found"
          description="Try a different search or movement type."
          action={(search !== "" || kind !== "all" || location !== "all") ? <Button variant="secondary" onClick={reset}>Clear filters</Button> : undefined}
        />
      ) : (
        <>
          <TableContainer className="border-0 rounded-none">
            <Thead>
              <Tr>
                <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">#</Th>
                <Th>Date</Th>
                <Th>Product</Th>
                <Th>Color</Th>
                <Th className="whitespace-nowrap">
                  <ColumnHeaderFilter
                    label="Movement"
                    isActive={kind !== "all"}
                  >
                    {(close) => (
                      <div className="flex flex-col gap-1.5">
                        <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                          Filter Movement
                        </div>
                        <div className="space-y-0.5 max-h-48 overflow-y-auto">
                          <button
                            type="button"
                            onClick={() => {
                              setKind("all");
                              setPage(1);
                              close();
                            }}
                            className={cn(
                              "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                              kind === "all"
                                ? "bg-brand/10 font-bold text-brand"
                                : "hover:bg-bg-subtle text-text-secondary",
                            )}
                          >
                            <span>All movements</span>
                            {kind === "all" && <CheckIcon className="w-3.5 h-3.5" />}
                          </button>
                          {([
                            { id: "in", label: "Received" },
                            { id: "out", label: "Delivered" },
                            { id: "allocated", label: "Allocated" },
                          ] as const).map((option) => (
                            <button
                              key={option.id}
                              type="button"
                              onClick={() => {
                                setKind(option.id);
                                setPage(1);
                                close();
                              }}
                              className={cn(
                                "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                kind === option.id
                                  ? "bg-brand/10 font-bold text-brand"
                                  : "hover:bg-bg-subtle text-text-secondary",
                              )}
                            >
                              <span>{option.label}</span>
                              {kind === option.id && <CheckIcon className="w-3.5 h-3.5" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </ColumnHeaderFilter>
                </Th>
                <Th className="text-right">Qty</Th>
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
                              <span>Any location</span>
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
                <Th>Reference</Th>
                <Th>Supplier / Customer</Th>
                <Th className="w-12" aria-label="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {visible.map((movement, index) => {
                const rowNum = (safePage - 1) * PAGE_SIZE + index + 1;
                return (
                  <Tr key={movement.movement_id}>
                    <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                      {rowNum}
                    </Td>
                    <Td className="text-text-muted whitespace-nowrap">{formatDate(movement.moved_on)}</Td>
                  <Td>
                    <div className="min-w-0 max-w-[16rem]">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => onOpen(movement.stock_code)}
                          className={cn(
                            "whitespace-nowrap font-bold text-brand hover:underline underline-offset-2",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                          )}
                        >
                          {movement.stock_code || "No stock code"}
                        </button>
                        {movement.stock_code && (
                          <CopyButton value={movement.stock_code} what="stock code" />
                        )}
                        <span className="text-xs text-text-muted">
                          · {GROUP_LABELS[movement.product_group]}
                        </span>
                      </div>
                      <div className="truncate text-sm text-text-primary mt-0.5" title={movement.description}>
                        {movement.description || "—"}
                      </div>
                    </div>
                  </Td>
                  <Td className="font-mono text-xs text-text-secondary whitespace-nowrap">
                    {movement.color_breakdown || "—"}
                  </Td>
                  <Td>
                    <MovementTypeBadge type={movement.movement_type} />
                  </Td>
                  <Td className="text-right font-semibold tabular-nums whitespace-nowrap">
                    <span
                      className={
                        movement.movement_type === "in"
                          ? "text-success"
                          : movement.movement_type === "out"
                            ? "text-error"
                            : "text-warning"
                      }
                    >
                      {movement.movement_type === "in"
                        ? "+"
                        : movement.movement_type === "out"
                          ? "−"
                          : "• "}
                      {formatSets(movement.quantity_pairs)}
                    </span>
                  </Td>
                  <Td className="text-text-secondary whitespace-nowrap">
                    {locationOf(movement) || "—"}
                  </Td>
                  <Td className="whitespace-nowrap">
                    {movement.reference ? (
                      <Reference value={movement.reference} what="reference" singleLine />
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </Td>
                  <Td className="text-text-secondary">{movement.counterparty_name || "—"}</Td>
                  <Td><StockRowMenu onView={() => onOpen(movement.stock_code)} /></Td>
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
    </Panel>
  );
}
