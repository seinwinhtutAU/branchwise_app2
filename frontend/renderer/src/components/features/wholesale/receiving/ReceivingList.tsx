import React, { useMemo, useState } from "react";
import { useSearchShortcut } from "@renderer/lib/useSearchShortcut";
import { cn } from "@renderer/lib/utils";
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
  ReceivingIcon,
  SearchIcon,
} from "@renderer/components/ui/icons";
import {
  FigureCard,
  PAGE_SIZE,
  Panel,
  Reference,
  RowProgress,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  RECEIVING_STATUSES,
  receivingStatus,
  countedPairs,
  expectedPairs,
  openedCount,
  pairsDifference,
  type Receiving,
  type ReceivingStatus,
} from "@renderer/components/features/wholesale/receiving/receivings";
import {
  formatDate,
  formatQty,
  sharePct,
} from "@renderer/components/features/wholesale/shared/shared";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { useWholesale } from "@renderer/components/features/wholesale/shared/store";
import { STATUS_LABELS, type StatusFilter } from "./types";
import { ReceivingRowMenu, StatusBadge } from "./ReceivingBadges";

export function ReceivingList({
  receivings,
  onOpen,
  onDelete,
  onNew,
  onRefresh,
  refreshing,
}: {
  receivings: Receiving[];
  onOpen: (receivingId: string, focus?: "packages" | "costs") => void;
  onDelete: (receivingId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);
  const searchInputRef = useSearchShortcut();

  const { shipments } = useWholesale();
  function expectedPackagesFor(receiving: Receiving): number | undefined {
    return shipments.find(
      (entry) => entry.shipment_no === receiving.shipment_no,
    )?.total_packages;
  }
  function statusOf(receiving: Receiving): ReceivingStatus {
    return receivingStatus(receiving, expectedPackagesFor(receiving));
  }
  // Every package added so far being open still doesn't make the count final while the
  // shipment says more packages are coming and this receiving simply hasn't caught up yet.
  function packagesCompleteFor(receiving: Receiving): boolean {
    const expected = expectedPackagesFor(receiving);
    return expected === undefined || receiving.total_packages >= expected;
  }

  const waiting = receivings.filter(
    (receiving) => statusOf(receiving) !== "checked",
  ).length;
  const mismatched = receivings.filter(
    (receiving) => statusOf(receiving) === "issue",
  ).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return receivings.filter((receiving) => {
      const matchesQuery =
        query === "" ||
        receiving.receiving_no.toLowerCase().includes(query) ||
        receiving.shipment_no.toLowerCase().includes(query) ||
        receiving.voucher_no.toLowerCase().includes(query) ||
        receiving.supplier_name.toLowerCase().includes(query) ||
        receiving.gate.toLowerCase().includes(query);
      const matchesStatus = status === "all" || statusOf(receiving) === status;
      return matchesQuery && matchesStatus;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receivings, search, status, shipments]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const isFiltered = search.trim() !== "" || status !== "all";

  function resetFilters(): void {
    setSearch("");
    setStatus("all");
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4">
      <CollapsibleKpiSummary storageKey="wholesale_receivings" title="Receiving Summary">
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
          <FigureCard
            label="Still to receive"
            value={formatQty(waiting)}
            sub={`of ${formatQty(receivings.length)} receivings`}
            tone={waiting > 0 ? "error" : "success"}
          />
          <FigureCard
            label="Do not match"
            value={formatQty(mismatched)}
            sub="received against the voucher"
            tone={mismatched > 0 ? "error" : "success"}
          />
        </div>
      </CollapsibleKpiSummary>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-bg-base">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <h2 className="text-base font-semibold text-text-primary tracking-tight mr-1">
              Receiving
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
                aria-label="Search receivings"
                placeholder="Search receiving, shipment, voucher, supplier… (/)"
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
              New receiving
            </Button>
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={<ReceivingIcon />}
            title={isFiltered ? "No receivings match" : "No receivings yet"}
            description={
              isFiltered
                ? "Nothing here matches what you searched for. Try a different gate or status."
                : "When a truck reaches the gate, record how many packages came off it and what the carrier charged."
            }
            action={
              isFiltered ? (
                <Button variant="secondary" onClick={resetFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button onClick={onNew}>
                  <PlusIcon className="w-4 h-4" />
                  New receiving
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
                  <Th className="whitespace-nowrap">Receiving no.</Th>
                  <Th className="whitespace-nowrap">Shipment no.</Th>
                  <Th className="whitespace-nowrap">Date</Th>
                  <Th className="whitespace-nowrap">Supplier / Factory</Th>
                  <Th className="whitespace-nowrap">Packages</Th>
                  <Th className="whitespace-nowrap min-w-[16.5rem]">
                    Received / Ordered
                  </Th>
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
                            {RECEIVING_STATUSES.map((option) => (
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
                {visible.map((receiving, index) => {
                  const difference = pairsDifference(receiving);
                  const counted = countedPairs(receiving);
                  const expectedQuantity = expectedPairs(receiving);
                  const expectedPackages = expectedPackagesFor(receiving);
                  const allOpened =
                    openedCount(receiving) === receiving.packages.length &&
                    packagesCompleteFor(receiving);
                  const stillToCome =
                    !packagesCompleteFor(receiving) &&
                    expectedPackages !== undefined &&
                    expectedPackages > receiving.total_packages
                      ? expectedPackages - receiving.total_packages
                      : 0;
                  // Measured against what the shipment sent, not against the packages
                  // logged so far. Using the logged count read as "3 of 3 opened ·
                  // 1 still to come", which contradicts itself: the first half claims
                  // the job is finished while the second says a package is missing.
                  const packagesTarget =
                    expectedPackages !== undefined
                      ? Math.max(expectedPackages, receiving.total_packages)
                      : receiving.total_packages;
                  const remaining = Math.max(0, expectedQuantity - counted);
                  const canDelete = receiving.allowed_actions
                    ? receiving.allowed_actions.includes("delete")
                    : openedCount(receiving) === 0;
                  const rowNum = (safePage - 1) * PAGE_SIZE + index + 1;
                  return (
                    <Tr key={receiving.receiving_id}>
                      <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                        {rowNum}
                      </Td>
                      <Td className="whitespace-nowrap">
                        <Reference
                          value={receiving.receiving_no}
                          what="receiving no."
                          onClick={() => onOpen(receiving.receiving_id)}
                        />
                      </Td>
                      <Td className="text-text-secondary whitespace-nowrap">
                        <Reference
                          value={receiving.shipment_no}
                          what="shipment no."
                        />
                      </Td>
                      <Td className="whitespace-nowrap text-text-muted">
                        {receiving.received_on
                          ? formatDate(receiving.received_on)
                          : "—"}
                      </Td>
                      <Td className="font-medium whitespace-nowrap">
                        {receiving.supplier_name}
                      </Td>
                      {/* Packages only, and only as words. The bar that used to sit
                          here measured sets, not packages, under a heading that said
                          packages — so the column read as two unrelated things
                          stacked. */}
                      <Td className="whitespace-nowrap">
                        <div className="flex flex-col gap-0.5">
                          <span className="tabular-nums">
                            {openedCount(receiving)} of {packagesTarget} opened
                          </span>
                          {stillToCome > 0 && (
                            <span className="text-xs text-text-muted tabular-nums">
                              {stillToCome} still to come
                            </span>
                          )}
                        </div>
                      </Td>
                      {/* What was counted against what the voucher says, rather than
                          the gap between them. A Difference column could only speak
                          once every package was open, so it read "—" on most rows,
                          and when it did speak the Status badge was already saying
                          the same thing in words. By how much is a question the
                          receiving itself answers. The bar belongs here, beside the
                          two quantities it is actually measuring. */}
                      <Td className="min-w-[16.5rem] max-w-[21rem]">
                        <div className="flex flex-col gap-1.5 w-full">
                          <div className="flex items-center justify-between gap-4 text-xs font-mono">
                            <span className="font-semibold text-text-primary whitespace-nowrap shrink-0">
                              {formatSets(counted)}
                              <span className="text-text-muted/60 font-normal"> / </span>
                              <span className="text-text-secondary font-normal">
                                {formatSets(expectedQuantity)}
                              </span>
                            </span>
                            {remaining > 0 ? (
                              <span className="text-error text-[11px] font-sans font-medium whitespace-nowrap shrink-0">
                                {formatSets(remaining)} left
                              </span>
                            ) : (
                              <span className="text-success text-[11px] font-sans font-medium whitespace-nowrap shrink-0">
                                Done
                              </span>
                            )}
                          </div>
                          <RowProgress
                            pct={sharePct(counted, expectedQuantity)}
                            label={`Received quantity for ${receiving.receiving_no}`}
                          />
                        </div>
                      </Td>
                      <Td>
                        <StatusBadge status={statusOf(receiving)} />
                      </Td>
                      <Td className="text-center">
                        <ReceivingRowMenu
                          onOpen={() => onOpen(receiving.receiving_id)}
                          onRecordCost={() =>
                            onOpen(receiving.receiving_id, "costs")
                          }
                          onCheckCount={
                            allOpened && difference !== 0
                              ? () => onOpen(receiving.receiving_id, "packages")
                              : undefined
                          }
                          onDelete={() => onDelete(receiving.receiving_id)}
                          canDelete={canDelete}
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
