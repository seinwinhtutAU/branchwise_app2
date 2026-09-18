import { useMemo, useState } from "react";
import { useSearchShortcut } from "@renderer/lib/useSearchShortcut";
import { cn } from "@renderer/lib/utils";
import {
  FigureCard,
  PAGE_SIZE,
  Panel,
  Reference,
  RowProgress,
} from "@renderer/components/features/wholesale/shared/ui";
import { Button } from "@renderer/components/ui/Button";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { CollapsibleKpiSummary } from "@renderer/components/ui/CollapsibleKpiSummary";
import { ColumnHeaderFilter } from "@renderer/components/ui/ColumnHeaderFilter";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
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
  const searchInputRef = useSearchShortcut();

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
    <div className="flex flex-col gap-4">
      <CollapsibleKpiSummary storageKey="wholesale_shipments" title="Shipments Summary">
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
      </CollapsibleKpiSummary>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-bg-base">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
              Shipments
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
                aria-label="Search shipments"
                placeholder="Search shipment, voucher, supplier, cargo… (/)"
                startIcon={<SearchIcon className="w-3.5 h-3.5" />}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                className="h-8 text-xs"
              />
            </div>
            <RefreshButton
              onClick={onRefresh}
              refreshing={refreshing}
            />
            <Button onClick={onNew} size="sm" className="h-8 text-xs">
              <PlusIcon className="w-3.5 h-3.5" />
              New shipment
            </Button>
          </div>
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
                  <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">#</Th>
                  <Th className="whitespace-nowrap">Shipment no.</Th>
                  <Th className="whitespace-nowrap">Voucher no.</Th>
                  <Th className="whitespace-nowrap">Shipment date</Th>
                  <Th className="whitespace-nowrap">Supplier / Factory</Th>
                  <Th className="whitespace-nowrap">Packages</Th>
                  <Th className="whitespace-nowrap">
                    <ColumnHeaderFilter
                      label="Status"
                      isActive={status !== "all"}
                    >
                      {(close) => (
                        <div className="flex flex-col gap-1.5">
                          <div className="font-semibold text-text-primary text-[11px] uppercase tracking-wider pb-1 border-b border-border">
                            Filter Status
                          </div>
                          <div className="space-y-0.5 max-h-48 overflow-y-auto">
                            <button
                              type="button"
                              onClick={() => {
                                setStatus("all");
                                setPage(1);
                                close();
                              }}
                              className={cn(
                                "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                status === "all"
                                  ? "bg-brand/10 font-bold text-brand"
                                  : "hover:bg-bg-subtle text-text-secondary",
                              )}
                            >
                              <span>Any status</span>
                              {status === "all" && (
                                <CheckIcon className="w-3.5 h-3.5" />
                              )}
                            </button>
                            {SHIPMENT_STATUSES.map((option) => (
                              <button
                                key={option}
                                type="button"
                                onClick={() => {
                                  setStatus(option);
                                  setPage(1);
                                  close();
                                }}
                                className={cn(
                                  "w-full text-left px-2 py-1 rounded text-xs transition-colors flex items-center justify-between",
                                  status === option
                                  ? "bg-brand/10 font-bold text-brand"
                                  : "hover:bg-bg-subtle text-text-secondary",
                                )}
                              >
                                <span>{STATUS_LABELS[option]}</span>
                                {status === option && (
                                  <CheckIcon className="w-3.5 h-3.5" />
                                )}
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
                {visible.map((shipment, index) => {
                  const voucherRowSpan = voucherRowSpans[index];
                  const splitParent = shipment.split_from_shipment_id
                    ? shipmentById.get(shipment.split_from_shipment_id)
                    : undefined;
                  const rowNum = (safePage - 1) * PAGE_SIZE + index + 1;
                  return (
                    <Tr key={shipment.shipment_id}>
                      <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                        {rowNum}
                      </Td>
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
    </div>
  );
}
