// InventoryMovementTable — searchable table of all stock movements.

import { useCallback, useMemo, useState } from "react";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import { Select } from "@renderer/components/ui/Select";
import {
  TableContainer, Tbody, Td, Th, Thead, Tr,
} from "@renderer/components/ui/Table";
import { InventoryIcon, SearchIcon } from "@renderer/components/ui/icons";
import { PAGE_SIZE, Panel } from "@renderer/components/features/wholesale/shared/ui";
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
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
        <div>
          <h2 className="text-base font-semibold text-text-primary tracking-tight">Inventory Movement</h2>
          <p className="text-sm text-text-muted mt-0.5">Stock received, delivered, and set aside for customers.</p>
        </div>
        <InventoryRefreshButton onRefresh={onRefresh} refreshing={refreshing} />
      </div>
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
        <div className="w-full sm:w-[28rem]">
          <Input
            aria-label="Search inventory movement"
            placeholder="Search product, stock code or reference"
            startIcon={<SearchIcon className="w-4 h-4" />}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            aria-label="Filter movement type"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as MovementKind | "all");
              setPage(1);
            }}
          >
            <option value="all">All movements</option>
            <option value="in">Received</option>
            <option value="out">Delivered</option>
            <option value="allocated">Allocated</option>
          </Select>
        </div>
        <div className="w-full sm:w-56">
          <Select
            aria-label="Filter movement location"
            value={location}
            onChange={(event) => {
              setLocation(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">Any location</option>
            {locations.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        {(search !== "" || kind !== "all" || location !== "all") && (
          <Button variant="ghost" size="sm" onClick={reset}>Clear filters</Button>
        )}
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
                <Th>Date</Th>
                <Th>Product</Th>
                <Th>Color</Th>
                <Th>Movement</Th>
                <Th className="text-right">Qty</Th>
                <Th>Location</Th>
                <Th>Reference</Th>
                <Th>Supplier / Customer</Th>
                <Th className="w-12" aria-label="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {visible.map((movement) => (
                <Tr key={movement.movement_id}>
                  <Td className="text-text-muted whitespace-nowrap">{formatDate(movement.moved_on)}</Td>
                  <Td>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => onOpen(movement.stock_code)}
                        className={cn(
                          "font-bold text-brand hover:underline underline-offset-2",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                        )}
                      >
                        {movement.stock_code || "No stock code"}
                      </button>
                      <div className="max-w-[15rem] truncate text-sm text-text-primary" title={movement.description}>
                        {movement.description || "—"}
                      </div>
                      <div className="text-xs text-text-muted">
                        {GROUP_LABELS[movement.product_group]}
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
                  <Td className="text-text-muted whitespace-nowrap">{movement.reference || "—"}</Td>
                  <Td className="text-text-secondary">{movement.counterparty_name || "—"}</Td>
                  <Td><StockRowMenu onView={() => onOpen(movement.stock_code)} /></Td>
                </Tr>
              ))}
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
    </Panel>
  );
}
