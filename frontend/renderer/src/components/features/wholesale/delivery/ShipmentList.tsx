import { useMemo, useRef, useState, useEffect } from "react";
import {
  FigureCard,
  PAGE_SIZE,
  Panel,
  Reference,
  RowProgress,
} from "@renderer/components/features/wholesale/shared/ui";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import { Select } from "@renderer/components/ui/Select";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  CloseIcon,
  PlusIcon,
  SearchIcon,
  TruckIcon,
} from "@renderer/components/ui/icons";
import {
  formatDate,
  formatQty,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  arrivedPct,
  shipmentStatus,
  SHIPMENT_STATUSES,
  type Shipment,
  type ShipmentStatus,
} from "@renderer/components/features/wholesale/delivery/shipments";
import { StatusBadge, RowMenu } from "./ShipmentBadges";
import {
  STATUS_LABELS,
  type StatusFilter,
} from "./types";

export function ShipmentList({
  shipments,
  onOpen,
  onDelete,
  onNew,
  onRefresh,
  refreshing,
}: {
  shipments: Shipment[];
  onOpen: (shipmentId: string, focus?: "tracking") => void;
  onDelete: (shipmentId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: '/' or '⌘F' to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (
        (e.key === "/" &&
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA") ||
        ((e.metaKey || e.ctrlKey) && e.key === "f")
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const countBy = (status: ShipmentStatus): number =>
    shipments.filter((shipment) => shipmentStatus(shipment) === status).length;

  const shipmentById = useMemo(() => {
    const map = new Map<string, Shipment>();
    for (const shipment of shipments) map.set(shipment.shipment_id, shipment);
    return map;
  }, [shipments]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return shipments.filter((shipment) => {
      const matchesQuery =
        query === "" ||
        shipment.shipment_no.toLowerCase().includes(query) ||
        shipment.voucher_no.toLowerCase().includes(query) ||
        shipment.supplier_name.toLowerCase().includes(query) ||
        shipment.carrier_name.toLowerCase().includes(query) ||
        shipment.legs.some((leg) =>
          leg.stop_name.toLowerCase().includes(query),
        );
      const matchesStatus =
        status === "all" || shipmentStatus(shipment) === status;
      return matchesQuery && matchesStatus;
    });
  }, [shipments, search, status]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const voucherRowSpans = useMemo(() => {
    const spans = new Array<number>(visible.length).fill(1);
    let groupStart = 0;
    for (let index = 1; index <= visible.length; index += 1) {
      const sameAsGroup =
        index < visible.length &&
        visible[index].voucher_no === visible[groupStart].voucher_no;
      if (sameAsGroup) continue;
      spans[groupStart] = index - groupStart;
      for (let covered = groupStart + 1; covered < index; covered += 1) {
        spans[covered] = 0;
      }
      groupStart = index;
    }
    return spans;
  }, [visible]);

  const isFiltered = search.trim() !== "" || status !== "all";

  function resetFilters(): void {
    setSearch("");
    setStatus("all");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
        <FigureCard
          label="On the way"
          value={formatQty(countBy("in_transit") + countBy("partly_delivered"))}
          sub="shipments"
          tone="brand"
        />
        <FigureCard
          label="Waiting at cargo"
          value={formatQty(countBy("waiting_at_cargo"))}
          sub="shipments"
          tone="warning"
        />
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Shipments
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Manage all freight shipments.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onRefresh}
              loading={refreshing}
            >
              Refresh
            </Button>
            <Button onClick={onNew}>
              <PlusIcon className="w-4 h-4" />
              New shipment
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
          <div className="w-full sm:w-[28rem] lg:w-[32rem]">
            <Input
              ref={searchInputRef}
              aria-label="Search shipments"
              placeholder="Search shipment no., voucher, supplier, cargo or destination (/)"
              startIcon={<SearchIcon className="w-4 h-4" />}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <div className="w-full sm:w-52">
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as StatusFilter);
                setPage(1);
              }}
            >
              <option value="all">Any status</option>
              {SHIPMENT_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {STATUS_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              <CloseIcon className="w-4 h-4" />
              Clear filters
            </Button>
          )}
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<TruckIcon />}
            title={isFiltered ? "No shipments match" : "No shipments yet"}
            description={
              isFiltered
                ? "Nothing here matches what you searched for. Try a different supplier or status."
                : "When a cargo company takes a voucher on the road, add the shipment here so its packages can be followed."
            }
            action={
              isFiltered ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={onNew}>
                  <PlusIcon className="w-4 h-4" />
                  New shipment
                </Button>
              )
            }
          />
        ) : (
          <>
            <TableContainer className="border-0 rounded-none">
              <Thead>
                <Tr>
                  <Th className="whitespace-nowrap">Shipment no.</Th>
                  <Th className="whitespace-nowrap">Voucher no.</Th>
                  <Th className="whitespace-nowrap">Shipment date</Th>
                  <Th className="whitespace-nowrap">Supplier / Factory</Th>
                  <Th className="whitespace-nowrap">Packages</Th>
                  <Th>Status</Th>
                  <Th className="w-12" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((shipment, index) => {
                  const voucherRowSpan = voucherRowSpans[index];
                  const splitParent = shipment.split_from_shipment_id
                    ? shipmentById.get(shipment.split_from_shipment_id)
                    : undefined;
                  return (
                    <Tr key={shipment.shipment_id}>
                      <Td className="whitespace-nowrap">
                        <Reference
                          value={shipment.shipment_no}
                          what="shipment no."
                          onClick={() => onOpen(shipment.shipment_id)}
                        />
                        {splitParent && (
                          <button
                            type="button"
                            onClick={() => onOpen(splitParent.shipment_id)}
                            className="mt-0.5 block text-[11px] text-text-muted hover:text-brand hover:underline"
                          >
                            Split from {splitParent.shipment_no}
                          </button>
                        )}
                      </Td>
                      {voucherRowSpan > 0 && (
                        <Td
                          className="text-text-secondary align-middle"
                          rowSpan={voucherRowSpan > 1 ? voucherRowSpan : undefined}
                        >
                          <Reference
                            value={shipment.voucher_no}
                            what="voucher no."
                          />
                        </Td>
                      )}
                      <Td className="text-text-muted whitespace-nowrap">
                        {formatDate(shipment.sent_on)}
                      </Td>
                      <Td className="font-medium whitespace-nowrap">
                        {shipment.supplier_name}
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-1.5 min-w-[10rem] max-w-[14rem]">
                          <div className="flex items-center justify-between gap-4 text-xs">
                            <span className="tabular-nums font-medium text-text-primary whitespace-nowrap shrink-0">
                              {formatQty(shipment.final_received_packages)}
                              <span className="text-text-muted/60 font-normal"> / </span>
                              <span className="text-text-secondary font-normal">{formatQty(shipment.total_packages)}</span>
                            </span>
                            {shipment.total_packages - shipment.final_received_packages > 0 ? (
                              <span className="text-error text-[11px] font-medium whitespace-nowrap shrink-0">
                                {formatQty(shipment.total_packages - shipment.final_received_packages)} package{shipment.total_packages - shipment.final_received_packages === 1 ? "" : "s"} left
                              </span>
                            ) : (
                              <span className="text-success text-[11px] font-medium whitespace-nowrap shrink-0">
                                Done
                              </span>
                            )}
                          </div>
                          <RowProgress
                            pct={arrivedPct(shipment)}
                            label={`Arrival progress for ${shipment.shipment_no}`}
                          />
                        </div>
                      </Td>
                      <Td>
                        <StatusBadge status={shipmentStatus(shipment)} />
                      </Td>
                      <Td className="text-center">
                        <RowMenu
                          shipment={shipment}
                          onOpen={() => onOpen(shipment.shipment_id)}
                          onDelete={() => onDelete(shipment.shipment_id)}
                        />
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
      </Panel>
    </div>
  );
}
