import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { type Session } from "@renderer/lib/auth";
import { fetchJson, useLoadErrorToast } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import {
  CellInput,
  CountField,
  EDITABLE,
  FigureCard,
  FloatingLayer,
  MenuItem,
  PAGE_SIZE,
  Panel,
  QuantityField,
  QuantityInput,
  ReadOnlyField,
  Required,
  Reference,
  ReviewFact,
  SOFT_BLUE,
  SOFT_RED,
  SectionLabel,
  StepBar,
  SuggestInput,
} from "@renderer/components/features/wholesale/ui";
import { cn } from "@renderer/lib/utils";
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
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  MoreVerticalIcon,
  PencilIcon,
  ReceivingIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  WarningIcon,
} from "@renderer/components/ui/icons";
import {
  RECEIVING_STATUSES,
  receivingStatus,
  COST_KINDS,
  countedPairs,
  emptyCost,
  emptyItem,
  openedCount,
  packagePairs,
  resizePackages,
  expectedPairs,
  pairsDifference,
  totalCost,
  type Receiving,
  type ReceivingCost,
  type ReceivingItem,
  type ReceivingPackage,
  type ReceivingStatus,
} from "@renderer/components/features/wholesale/receivings";
import { RECEIVING_GATES } from "@renderer/components/features/wholesale/shipments";
import {
  colorQtyProblem,
  formatDate,
  formatKyat,
  formatQty,
  nextReference,
  onlyDigits,
  quantityFromColors,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  toPairs,
  type Unit,
} from "@renderer/components/features/wholesale/units";
import {
  hydrateReceivings,
  hydrateShipments,
  saveReceivings,
  useWholesale,
} from "@renderer/components/features/wholesale/store";
import {
  RECEIVINGS_URL,
  SHIPMENTS_URL,
  WholesaleApiError,
  createReceiving as apiCreateReceiving,
  deleteReceiving as apiDeleteReceiving,
  receivingsFromWire,
  replaceReceivingCosts,
  shipmentsFromWire,
  updateReceiving as apiUpdateReceiving,
  updateReceivingPackage,
  type NewReceivingInput,
  type ReceivingWire,
  type ShipmentWire,
} from "@renderer/components/features/wholesale/api";
import {
  STOCK_CODES,
  productOf,
} from "@renderer/components/features/wholesale/products";
import { colorPairsForText } from "@renderer/components/features/wholesale/stock";
import { type SupplierVoucher } from "@renderer/components/features/wholesale/supplierVouchers";

// The wholesale Receiving Gate screen. The gate does two jobs and this page keeps them
// apart, because they happen at different moments and by different people:
//
//   1. What is due at the gate — how many packages, and how many sets inside them,
//      taken from the shipment and its supplier voucher.
//   2. What actually turned up — as each package reaches the gate and is opened, the
//      products inside it and how many sets of each, added up as it goes.
//
// The counting is checked against the supplier voucher as it goes: the sets found have to
// come to what the voucher says are coming. A difference is shown as soon as the last
// package is opened, rather than discovered weeks later.
//
// Backed by /api/wholesale/receivings, read through React Query (see
// @renderer/lib/queryClient.ts) rather than the hand-rolled useCachedFetch. Detail edits
// are staged locally until saved.

const RECEIVINGS_QUERY_KEY = ["wholesale", "receivings"] as const;
const SHIPMENTS_QUERY_KEY = ["wholesale", "shipments"] as const;

type View = "list" | "detail" | "new";
type ReceivingDetailMode = "view" | "edit";
type StatusFilter = ReceivingStatus | "all";

const STATUS_LABELS: Record<ReceivingStatus, string> = {
  recorded: "Not opened",
  checking: "Partly received",
  checked: "All received",
  issue: "Does not match",
};

const STATUS_STYLES: Record<ReceivingStatus, string> = {
  recorded: "bg-text-secondary text-bg-base",
  checking: "bg-brand text-white",
  checked: "bg-success text-white",
  issue: "bg-error text-white",
};

function formatStoredQuantity(quantity: number, unit: Unit): string {
  return formatIn(toPairs(quantity, unit), unit);
}

// ── Checked against the voucher ─────────────────────────────────────────────
// What the supplier's own voucher said was coming, so a package's contents can be
// checked against it rather than just against its own grammar. A supplier can genuinely
// ship something the voucher didn't say — these are warnings staff can still save past,
// not a hard stop.

interface VoucherExpectations {
  stockCodes: Set<string>;
  // Colour -> pairs the voucher says are coming, keyed by stock code.
  colorsByStockCode: Map<string, Map<string, number>>;
}

function voucherExpectations(
  voucher: SupplierVoucher | undefined,
): VoucherExpectations {
  const stockCodes = new Set<string>();
  const colorsByStockCode = new Map<string, Map<string, number>>();
  for (const line of voucher?.lines ?? []) {
    const code = line.stock_code.trim().toLowerCase();
    if (!code) continue;
    stockCodes.add(code);
    const colors = colorsByStockCode.get(code) ?? new Map<string, number>();
    for (const [color, pairs] of Object.entries(
      colorPairsForText(line.color_breakdown, "set"),
    )) {
      colors.set(color, (colors.get(color) ?? 0) + pairs);
    }
    colorsByStockCode.set(code, colors);
  }
  return { stockCodes, colorsByStockCode };
}

function receivedStockCodeProblem(
  stockCode: string,
  expected: VoucherExpectations,
): string | null {
  const code = stockCode.trim().toLowerCase();
  if (!code || expected.stockCodes.size === 0) return null;
  return expected.stockCodes.has(code)
    ? null
    : "Not on this voucher — check the code.";
}

function receivedColorProblem(
  stockCode: string,
  colorQty: string,
  expected: VoucherExpectations,
): string | null {
  const code = stockCode.trim().toLowerCase();
  const wanted = expected.colorsByStockCode.get(code);
  if (!wanted || wanted.size === 0) return null;
  const actual = Object.keys(colorPairsForText(colorQty, "set"));
  const unexpected = actual.filter((color) => !wanted.has(color));
  if (unexpected.length === 0) return null;
  return `${unexpected.join(", ")} ${unexpected.length === 1 ? "isn't" : "aren't"} on the voucher for this product.`;
}

/** How many pairs of each colour have actually been logged for one stock code, summed
 *  across every package in this receiving — not just the item being typed into, since
 *  the same product often arrives split across several boxes and a colour's full count
 *  only exists once every box holding it is added up. */
function receivedColorPairs(
  receiving: Receiving,
  stockCode: string,
): Map<string, number> {
  const code = stockCode.trim().toLowerCase();
  const totals = new Map<string, number>();
  for (const entry of receiving.packages) {
    for (const item of entry.items) {
      if (item.stock_code.trim().toLowerCase() !== code) continue;
      for (const [color, pairs] of Object.entries(
        colorPairsForText(item.color_breakdown, item.unit),
      )) {
        totals.set(color, (totals.get(color) ?? 0) + pairs);
      }
    }
  }
  return totals;
}

/** A colour's own name can be right while its count still isn't — 20 sets of black
 *  logged against a voucher that only ever asked for 15 is wrong the moment it happens,
 *  whatever else is still unopened. Falling short is not flagged the same way: more of a
 *  colour can still be sitting in a box nobody has opened yet. */
function receivedColorQuantityProblem(
  stockCode: string,
  receiving: Receiving,
  expected: VoucherExpectations,
): string | null {
  const code = stockCode.trim().toLowerCase();
  const wanted = expected.colorsByStockCode.get(code);
  if (!wanted || wanted.size === 0) return null;
  const received = receivedColorPairs(receiving, stockCode);
  const over = [...received.entries()].find(
    ([color, pairs]) => pairs > (wanted.get(color) ?? 0),
  );
  if (!over) return null;
  const [color, pairs] = over;
  return `${formatIn(pairs, "set")} of ${color} recorded, but the voucher only says ${formatIn(wanted.get(color) ?? 0, "set")}.`;
}

function StatusBadge({
  status,
}: {
  status: ReceivingStatus;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap",
        STATUS_STYLES[status],
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export default function ReceivingGatePage({
  session,
  initialReceivingNo,
  onInitialReceivingOpened,
}: {
  session: Session;
  initialReceivingNo?: string | null;
  onInitialReceivingOpened?: () => void;
}): React.JSX.Element {
  const showToast = useToast();
  const queryClient = useQueryClient();
  const {
    data: wire,
    isFetching: isRefreshing,
    isError: failed,
  } = useQuery({
    queryKey: RECEIVINGS_QUERY_KEY,
    queryFn: () => fetchJson<ReceivingWire[]>(RECEIVINGS_URL, session),
  });
  useLoadErrorToast(failed, "receivings");
  const {
    data: shipmentWire,
    isFetching: shipmentsRefreshing,
    isError: shipmentsFailed,
  } = useQuery({
    queryKey: SHIPMENTS_QUERY_KEY,
    queryFn: () => fetchJson<ShipmentWire[]>(SHIPMENTS_URL, session),
  });
  useLoadErrorToast(shipmentsFailed, "shipments for receivings");
  useEffect(() => {
    if (wire) hydrateReceivings(receivingsFromWire(wire));
  }, [wire]);
  useEffect(() => {
    if (shipmentWire) hydrateShipments(shipmentsFromWire(shipmentWire));
  }, [shipmentWire]);

  async function reload(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: RECEIVINGS_QUERY_KEY });
  }

  async function reloadShipments(): Promise<void> {
    await queryClient.invalidateQueries({ queryKey: SHIPMENTS_QUERY_KEY });
  }

  function refreshPage(): void {
    void reload();
    void reloadShipments();
  }

  const { receivings } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openMode, setOpenMode] = useState<ReceivingDetailMode>("view");

  const selected =
    receivings.find((receiving) => receiving.receiving_id === selectedId) ??
    null;

  useEffect(() => {
    if (!initialReceivingNo) return;
    const target = receivings.find(
      (receiving) => receiving.receiving_no === initialReceivingNo,
    );
    if (!target) return;
    setSelectedId(target.receiving_id);
    setOpenMode("view");
    setView("detail");
    onInitialReceivingOpened?.();
  }, [initialReceivingNo, onInitialReceivingOpened, receivings]);

  function reportSaveFailure(error: unknown, fallback: string): void {
    showToast(
      "error",
      error instanceof WholesaleApiError ? error.message : fallback,
    );
  }

  async function persistReceiving(receiving: Receiving): Promise<void> {
    try {
      // Resize first because the server allocates new package IDs. Reattach the
      // locally staged contents by package number before saving each package.
      const header = await apiUpdateReceiving(session, receiving.receiving_id, {
        gate: receiving.gate,
        received_on: receiving.received_on,
        total_packages: receiving.total_packages,
        total_quantity_pairs: receiving.total_quantity_pairs,
        total_unit: receiving.total_unit,
      });
      const stagedByNumber = new Map(
        receiving.packages.map((entry) => [entry.package_no, entry]),
      );
      for (const serverPackage of header.packages) {
        const staged = stagedByNumber.get(serverPackage.package_no);
        if (staged) {
          await updateReceivingPackage(session, receiving.receiving_id, {
            ...staged,
            package_id: serverPackage.package_id,
          });
        }
      }
      await replaceReceivingCosts(
        session,
        receiving.receiving_id,
        receiving.costs,
      );
      await reload();
      showToast("success", "Receiving saved.");
    } catch (error) {
      reportSaveFailure(error, "Could not save the receiving.");
    }
  }

  function deleteReceiving(receivingId: string): void {
    apiDeleteReceiving(session, receivingId)
      .then(async () => {
        setSelectedId((current) => (current === receivingId ? null : current));
        setView("list");
        await reload();
      })
      .catch((error) =>
        reportSaveFailure(error, "Could not delete the receiving."),
      );
  }

  function addReceiving(input: NewReceivingInput): void {
    apiCreateReceiving(session, input)
      .then(async (created) => {
        saveReceivings((current) => [created, ...current]);
        setSelectedId(created.receiving_id);
        setOpenMode("edit");
        setView("detail");
        await reload();
      })
      .catch((error) =>
        reportSaveFailure(error, "Could not create the receiving."),
      );
  }

  if (view === "new") {
    return (
      <NewReceivingForm
        nextReceivingNo={nextReceivingNo(receivings)}
        onCancel={() => setView("list")}
        onCreate={addReceiving}
      />
    );
  }

  if (view === "detail" && selected) {
    return (
      <ReceivingDetail
        receiving={selected}
        initialMode={openMode}
        onBack={() => setView("list")}
        onSave={persistReceiving}
        onDelete={() => deleteReceiving(selected.receiving_id)}
      />
    );
  }

  if (failed && receivings.length === 0) {
    return (
      <EmptyState
        icon={<ReceivingIcon />}
        title="Could not load receivings"
        description="Check the connection and try again."
        action={
          <Button onClick={reload} loading={isRefreshing}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <ReceivingList
      receivings={receivings}
      onOpen={(receivingId) => {
        setSelectedId(receivingId);
        setOpenMode("view");
        setView("detail");
      }}
      onEdit={(receivingId) => {
        setSelectedId(receivingId);
        setOpenMode("edit");
        setView("detail");
      }}
      onDelete={deleteReceiving}
      onNew={() => setView("new")}
      onRefresh={refreshPage}
      refreshing={isRefreshing || shipmentsRefreshing}
    />
  );
}

function nextReceivingNo(receivings: Receiving[]): string {
  return nextReference(
    "RCV",
    receivings.map((receiving) => receiving.receiving_no),
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

function ReceivingList({
  receivings,
  onOpen,
  onEdit,
  onDelete,
  onNew,
  onRefresh,
  refreshing,
}: {
  receivings: Receiving[];
  onOpen: (receivingId: string) => void;
  onEdit: (receivingId: string) => void;
  onDelete: (receivingId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const { shipments } = useWholesale();
  function expectedPackagesFor(receiving: Receiving): number | undefined {
    return shipments.find(
      (entry) => entry.shipment_no === receiving.shipment_no,
    )?.total_packages;
  }
  function statusOf(receiving: Receiving): ReceivingStatus {
    return receivingStatus(receiving, expectedPackagesFor(receiving));
  }
  // Every box added so far being open still doesn't make the count final while the
  // shipment says more boxes are coming and this receiving simply hasn't caught up yet.
  function packagesCompleteFor(receiving: Receiving): boolean {
    const expected = expectedPackagesFor(receiving);
    return expected === undefined || receiving.total_packages >= expected;
  }

  const packages = receivings.reduce(
    (sum, receiving) => sum + receiving.total_packages,
    0,
  );
  const waiting = receivings.filter(
    (receiving) => statusOf(receiving) !== "checked",
  ).length;
  const mismatched = receivings.filter(
    (receiving) => statusOf(receiving) === "issue",
  ).length;
  const cost = receivings.reduce(
    (sum, receiving) => sum + totalCost(receiving),
    0,
  );

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
    <div className="flex flex-col gap-6">
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        <FigureCard
          label="Receivings"
          value={formatQty(receivings.length)}
          sub="deliveries at the gate"
        />
        <FigureCard
          label="Packages received"
          value={formatQty(packages)}
          sub="packages off the trucks"
          tone="neutral"
        />
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

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Receiving
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Manage all deliveries received at the gate. Total cost{" "}
              {formatKyat(cost)}.
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
              New receiving
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-border bg-bg-subtle">
          <div className="w-full sm:w-[28rem] lg:w-[32rem]">
            <Input
              aria-label="Search receivings"
              placeholder="Search receiving, shipment, voucher, supplier or gate"
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
              {RECEIVING_STATUSES.map((option) => (
                <option key={option} value={option}>
                  {STATUS_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
          {isFiltered && (
            <Button variant="ghost" size="sm" onClick={resetFilters}>
              Clear filters
            </Button>
          )}
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
                  <Th className="whitespace-nowrap">Receiving no.</Th>
                  <Th className="whitespace-nowrap">Shipment no.</Th>
                  <Th className="whitespace-nowrap">Supplier / Factory</Th>
                  <Th>Gate</Th>
                  <Th className="whitespace-nowrap">Date</Th>
                  <Th className="text-right whitespace-nowrap">Packages</Th>
                  <Th className="text-right whitespace-nowrap">Qty</Th>
                  <Th className="text-right">Difference</Th>
                  <Th>Status</Th>
                  <Th className="w-12" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((receiving) => {
                  const difference = pairsDifference(receiving);
                  const expectedPackages = expectedPackagesFor(receiving);
                  const allOpened =
                    openedCount(receiving) === receiving.packages.length &&
                    packagesCompleteFor(receiving);
                  return (
                    <Tr key={receiving.receiving_id}>
                      <Td className="whitespace-nowrap">
                        <Reference
                          value={receiving.receiving_no}
                          what="receiving no."
                          onClick={() => onOpen(receiving.receiving_id)}
                        />
                      </Td>
                      <Td className="text-text-secondary">
                        <Reference
                          value={receiving.shipment_no}
                          what="shipment no."
                        />
                      </Td>
                      <Td className="font-medium whitespace-nowrap">
                        {receiving.supplier_name}
                      </Td>
                      <Td className="text-text-secondary">{receiving.gate}</Td>
                      <Td className="text-text-muted whitespace-nowrap">
                        {formatDate(receiving.received_on)}
                      </Td>
                      <Td className="p-0 text-right tabular-nums whitespace-nowrap">
                        <div className="flex w-full flex-col divide-y divide-border/70 leading-tight text-sm">
                          <span className="flex min-h-7 items-center justify-end gap-1 px-4">
                            <span className="text-text-muted">Total:</span>
                            <span>
                              {expectedPackages === undefined
                                ? "—"
                                : formatQty(expectedPackages)}
                            </span>
                          </span>
                          <span className="flex min-h-7 items-center justify-end gap-1 px-4 text-success">
                            <span className="text-text-muted">Received:</span>
                            <span>{formatQty(receiving.total_packages)}</span>
                          </span>
                        </div>
                      </Td>
                      <Td className="p-0 text-right tabular-nums whitespace-nowrap">
                        <div className="flex w-full flex-col divide-y divide-border/70 leading-tight text-sm">
                          <span className="flex min-h-7 items-center justify-end gap-1 px-4">
                            <span className="text-text-muted">Total:</span>
                            <span>
                              {formatIn(expectedPairs(receiving), "set")}
                            </span>
                          </span>
                          <span className="flex min-h-7 items-center justify-end gap-1 px-4 text-success">
                            <span className="text-text-muted">Received:</span>
                            <span>
                              {formatIn(countedPairs(receiving), "set")}
                            </span>
                          </span>
                        </div>
                      </Td>
                      <Td
                        className={cn(
                          "text-right tabular-nums font-semibold",
                          !allOpened
                            ? "text-text-muted"
                            : difference === 0
                              ? "text-success"
                              : "text-error",
                        )}
                      >
                        {allOpened ? formatDifference(difference, "set") : "—"}
                      </Td>
                      <Td>
                        <StatusBadge status={statusOf(receiving)} />
                      </Td>
                      <Td className="text-center">
                        <RowMenu
                          onOpen={() => onOpen(receiving.receiving_id)}
                          onEdit={() => onEdit(receiving.receiving_id)}
                          onDelete={() => onDelete(receiving.receiving_id)}
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

/** A difference reads better with its sign: 2 short, 1 over, or nothing. */
function formatDifference(difference: number, unit: Unit): string {
  if (difference === 0) return "0";
  return difference > 0
    ? `+${formatIn(difference, unit)}`
    : `−${formatIn(-difference, unit)}`;
}

function RowMenu({
  onOpen,
  onEdit,
  onDelete,
}: {
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setConfirming(false);
      }
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        setConfirming(false);
      }
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="Receiving actions"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
          setConfirming(false);
        }}
        className={cn(
          "p-1.5 rounded-md text-text-muted",
          "transition-colors duration-150",
          "hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <MoreVerticalIcon className="w-4 h-4" />
      </button>
      {open && (
        <FloatingLayer
          anchorRef={ref}
          align="right"
          className="min-w-48 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in"
        >
          {confirming ? (
            <>
              <p className="px-3.5 py-2 text-xs text-text-muted">
                Delete this receiving?
              </p>
              <MenuItem
                icon={<TrashIcon className="w-4 h-4" />}
                label="Delete for good"
                danger
                onClick={() => {
                  setOpen(false);
                  setConfirming(false);
                  onDelete();
                }}
              />
              <MenuItem label="Keep it" onClick={() => setConfirming(false)} />
            </>
          ) : (
            <>
              <MenuItem
                icon={<EyeIcon className="w-4 h-4" />}
                label="View details"
                onClick={() => {
                  setOpen(false);
                  onOpen();
                }}
              />
              <MenuItem
                icon={<PencilIcon className="w-4 h-4" />}
                label="Edit receiving"
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
              />
              <MenuItem
                icon={<TrashIcon className="w-4 h-4" />}
                label="Delete receiving"
                danger
                onClick={() => setConfirming(true)}
              />
            </>
          )}
        </FloatingLayer>
      )}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function ReceivingInfoView({
  receiving,
  totalPackagesToReceive,
}: {
  receiving: Receiving;
  totalPackagesToReceive?: number;
}): React.JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          Receiving
        </h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          <ReadOnlyField
            label="Receiving no."
            value={receiving.receiving_no}
            copyable
          />
          <ReadOnlyField
            label="Shipment no."
            value={receiving.shipment_no}
            copyable
          />
          <ReadOnlyField
            label="Voucher no."
            value={receiving.voucher_no}
            copyable
          />
          <ReadOnlyField
            label="Supplier / Factory"
            value={receiving.supplier_name}
          />
        </dl>
      </div>
      <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          Gate details
        </h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          <ReadOnlyField label="Gate" value={receiving.gate} />
          <ReadOnlyField
            label="Received date"
            value={formatDate(receiving.received_on)}
          />
          <ReadOnlyField
            label="Received packages"
            value={formatQty(receiving.total_packages)}
          />
          <ReadOnlyField
            label="Total packages to receive"
            value={
              totalPackagesToReceive === undefined
                ? "—"
                : formatQty(totalPackagesToReceive)
            }
          />
          <ReadOnlyField
            label="Quantity"
            value={formatStoredQuantity(
              receiving.total_quantity_pairs,
              receiving.total_unit,
            )}
          />
        </dl>
      </div>
    </div>
  );
}

function ReceivingCostsView({
  receiving,
}: {
  receiving: Receiving;
}): React.JSX.Element {
  return (
    <TableContainer>
      <Thead>
        <Tr>
          <Th>Location</Th>
          <Th>Carrier</Th>
          <Th>Cost type</Th>
          <Th className="text-right">Amount</Th>
          <Th>Note</Th>
        </Tr>
      </Thead>
      <Tbody>
        {receiving.costs.length === 0 ? (
          <Tr>
            <Td colSpan={5} className="text-sm text-text-muted">
              Nothing charged for this delivery yet.
            </Td>
          </Tr>
        ) : (
          receiving.costs.map((cost) => (
            <Tr key={cost.cost_id}>
              <Td>{cost.stage || "—"}</Td>
              <Td>{cost.carrier || "—"}</Td>
              <Td>{cost.kind || "—"}</Td>
              <Td className="text-right tabular-nums">
                {formatKyat(cost.amount)}
              </Td>
              <Td className="whitespace-normal break-words text-text-muted">
                {cost.note || "—"}
              </Td>
            </Tr>
          ))
        )}
        <Tr className="bg-bg-subtle hover:bg-bg-subtle">
          <Td colSpan={3} className="font-semibold">
            Total
          </Td>
          <Td className="text-right tabular-nums font-semibold text-brand">
            {formatKyat(totalCost(receiving))}
          </Td>
          <Td />
        </Tr>
      </Tbody>
    </TableContainer>
  );
}

/** One package's contents, read-only — the counterpart to the input table in edit mode.
 *  Each product gets one row of its own height across every column (Product, Colors,
 *  Qty), the same rule the edit-mode table uses, so a two-product package lines up
 *  instead of stacking mismatched line-counts into one cramped cell. */
function ReceivingPackagesView({
  receiving,
  totalPackagesToReceive,
}: {
  receiving: Receiving;
  totalPackagesToReceive?: number;
}): React.JSX.Element {
  const packageTarget = totalPackagesToReceive ?? receiving.packages.length;

  return receiving.packages.length === 0 ? (
    <p className="text-sm text-text-muted">No packages recorded yet.</p>
  ) : (
    <TableContainer>
      <Thead>
        <Tr>
          <Th className="w-36">Package</Th>
          <Th className="w-32">Received date</Th>
          <Th className="min-w-[12rem]">Stock code</Th>
          <Th className="min-w-[10rem]">Colors</Th>
          <Th className="text-right w-28">Received quantity</Th>
          <Th className="min-w-[12rem]">Note</Th>
        </Tr>
      </Thead>
      <Tbody>
        {receiving.packages.map((entry) => {
          return (
            <Tr key={entry.package_id}>
              <Td className="align-top">
                <div className="flex flex-col items-start gap-2">
                  <span className="font-semibold text-brand">
                    #{entry.package_no}
                  </span>
                  <OpenedToggle
                    opened={entry.opened}
                    onToggle={() => undefined}
                    disabled
                  />
                </div>
              </Td>
              <Td className="align-top whitespace-nowrap">
                {entry.received_on ? formatDate(entry.received_on) : "—"}
              </Td>
              {entry.items.length === 0 ? (
                <>
                  <Td className="align-top text-text-muted">
                    Nothing recorded yet
                  </Td>
                  <Td className="align-top text-text-muted">—</Td>
                  <Td className="align-top text-right text-text-muted">—</Td>
                  <Td className="align-top text-text-secondary">
                    {entry.note || "—"}
                  </Td>
                </>
              ) : (
                <>
                  <Td className="align-top">
                    <div className="flex flex-col divide-y divide-border">
                      {entry.items.map((item) => (
                        <div
                          key={item.item_id}
                          className="min-h-9 py-1.5 flex items-center gap-2 first:pt-0 last:pb-0"
                        >
                          <span className="text-sm font-semibold text-brand whitespace-nowrap">
                            {item.stock_code || "No stock code"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </Td>
                  <Td className="align-top">
                    <div className="flex flex-col divide-y divide-border">
                      {entry.items.map((item) => (
                        <div
                          key={item.item_id}
                          className="min-h-9 py-1.5 flex items-center font-mono text-xs text-text-secondary first:pt-0 last:pb-0"
                        >
                          {item.color_breakdown || "—"}
                        </div>
                      ))}
                    </div>
                  </Td>
                  <Td className="align-top text-right">
                    <div className="flex flex-col divide-y divide-border">
                      {entry.items.map((item) => (
                        <div
                          key={item.item_id}
                          className="min-h-9 py-1.5 flex items-center justify-end tabular-nums font-semibold text-success first:pt-0 last:pb-0"
                        >
                          {formatStoredQuantity(item.quantity, item.unit)}
                        </div>
                      ))}
                    </div>
                  </Td>
                  <Td className="align-top whitespace-normal break-words text-text-secondary">
                    {entry.note || "—"}
                  </Td>
                </>
              )}
            </Tr>
          );
        })}
        <Tr className="bg-bg-subtle hover:bg-bg-subtle">
          <Td colSpan={4} className="font-semibold">
            Packages opened {formatQty(openedCount(receiving))} /{" "}
            {formatQty(packageTarget)}
          </Td>
          <Td colSpan={2} className="text-right font-semibold text-success">
            {formatIn(countedPairs(receiving), "set")} /{" "}
            {formatIn(expectedPairs(receiving), "set")} received
          </Td>
        </Tr>
      </Tbody>
    </TableContainer>
  );
}

const receivingDetailItemSchema = z.object({
  item_id: z.string(),
  stock_code: z.string(),
  description: z.string(),
  product_group: z.enum(["man", "lady", "child"]),
  color_breakdown: z.string(),
  quantity: z.number().finite().min(0),
  unit: z.enum(["pair", "set", "dozen"]),
});

const receivingDetailPackageSchema = z.object({
  package_id: z.string(),
  package_no: z.number().finite().min(1),
  opened: z.boolean(),
  received_on: z.string(),
  items: z.array(receivingDetailItemSchema),
  note: z.string(),
});

const receivingDetailCostSchema = z.object({
  cost_id: z.string(),
  stage: z.string(),
  carrier: z.string(),
  kind: z.string(),
  amount: z.number().finite().min(0),
  note: z.string(),
});

const receivingDetailSchema = z.object({
  receiving: z.object({
    receiving_id: z.string(),
    receiving_no: z.string(),
    shipment_no: z.string(),
    voucher_no: z.string(),
    supplier_name: z.string(),
    gate: z.string().trim().min(1, "Enter a receiving gate."),
    received_on: z.string().trim().min(1, "Choose a received date."),
    total_packages: z.number().finite().min(0),
    costs: z.array(receivingDetailCostSchema),
    total_quantity_pairs: z.number().finite().min(0),
    total_unit: z.enum(["pair", "set", "dozen"]),
    packages: z.array(receivingDetailPackageSchema),
  }),
});

interface ReceivingDetailFormValues {
  receiving: Receiving;
}

function ReceivingDetail({
  receiving: initialReceiving,
  initialMode,
  onBack,
  onSave,
  onDelete,
}: {
  receiving: Receiving;
  initialMode: ReceivingDetailMode;
  onBack: () => void;
  onSave: (receiving: Receiving) => Promise<void>;
  onDelete: () => void;
}): React.JSX.Element {
  const [detailMode, setDetailMode] =
    useState<ReceivingDetailMode>(initialMode);
  const [saving, setSaving] = useState(false);
  const [addingCostId, setAddingCostId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<ReceivingDetailFormValues>({
    resolver: zodResolver(receivingDetailSchema),
    defaultValues: { receiving: initialReceiving },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { replace: replaceCosts } = useFieldArray({
    control,
    name: "receiving.costs",
  });
  const { replace: replacePackages } = useFieldArray({
    control,
    name: "receiving.packages",
  });
  const receiving = useWatch({ control, name: "receiving" }) as Receiving;

  useEffect(() => {
    reset({ receiving: initialReceiving });
    setAddingCostId(null);
  }, [initialReceiving, reset]);
  const hasChanges = isDirty;

  function apply(patch: Partial<Receiving>): void {
    if (patch.costs) replaceCosts(patch.costs);
    if (patch.packages) replacePackages(patch.packages);
    for (const [key, value] of Object.entries(patch)) {
      if (key === "costs" || key === "packages") continue;
      setValue(`receiving.${key}` as "receiving.gate", value as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
  }

  async function saveChanges(values: ReceivingDetailFormValues): Promise<void> {
    setSaving(true);
    try {
      await onSave(values.receiving);
    } finally {
      setSaving(false);
    }
  }

  const { shipments, vouchers } = useWholesale();
  const shipment = shipments.find(
    (entry) => entry.shipment_no === receiving.shipment_no,
  );
  const voucher = vouchers.find(
    (entry) => entry.voucher_no === receiving.voucher_no,
  );
  const expected = voucherExpectations(voucher);
  const stages = [
    ...(shipment ? [shipment.carrier_name] : []),
    ...(shipment ? shipment.legs.map((leg) => leg.stop_name) : []),
    receiving.gate,
  ].filter((stage) => stage.trim() !== "");
  const carriers = [
    ...(shipment ? [shipment.carrier_name] : []),
    ...(shipment ? shipment.legs.map((leg) => leg.carrier_name) : []),
  ].filter((name) => name.trim() !== "" && name !== "—");

  const opened = openedCount(receiving);
  const counted = countedPairs(receiving);

  function setPackage(index: number, patch: Partial<ReceivingPackage>): void {
    apply({
      packages: receiving.packages.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    });
  }

  /** Opening a box gives it one empty product row, since there is always at least one
   *  thing inside; shutting it again leaves what was counted alone. */
  function toggleOpened(index: number): void {
    const entry = receiving.packages[index];
    const opened = !entry.opened;
    setPackage(index, {
      opened,
      received_on:
        opened && entry.received_on === ""
          ? receiving.received_on
          : entry.received_on,
      items:
        opened && entry.items.length === 0
          ? [emptyItem(entry.package_id)]
          : entry.items,
    });
  }

  function setCost(index: number, patch: Partial<ReceivingCost>): void {
    apply({
      costs: receiving.costs.map((cost, position) =>
        position === index ? { ...cost, ...patch } : cost,
      ),
    });
  }

  function addCost(): void {
    const cost = emptyCost(receiving.receiving_id, receiving.gate);
    setAddingCostId(cost.cost_id);
    apply({
      costs: [...receiving.costs, cost],
    });
  }

  function removeCost(index: number): void {
    if (receiving.costs[index]?.cost_id === addingCostId) {
      setAddingCostId(null);
    }
    apply({
      costs: receiving.costs.filter((_, position) => position !== index),
    });
  }

  function cancelAddCost(): void {
    if (!addingCostId) return;
    apply({
      costs: receiving.costs.filter((cost) => cost.cost_id !== addingCostId),
    });
    setAddingCostId(null);
  }

  function setItem(
    packageIndex: number,
    itemIndex: number,
    patch: Partial<ReceivingItem>,
  ): void {
    const entry = receiving.packages[packageIndex];
    setPackage(packageIndex, {
      items: entry.items.map((item, position) =>
        position === itemIndex ? { ...item, ...patch } : item,
      ),
    });
  }

  function setColorQty(
    packageIndex: number,
    itemIndex: number,
    colorQty: string,
  ): void {
    const item = receiving.packages[packageIndex].items[itemIndex];
    const quantity = quantityFromColors(colorQty, item.unit);
    setItem(packageIndex, itemIndex, {
      color_breakdown: colorQty,
      quantity: quantity.qty,
      unit: quantity.unit,
    });
  }

  // A code we have seen before brings its own description and product_group with it, so counting
  // a package is typing a code and a quantity, not retyping the product every time.
  function setStockCode(
    packageIndex: number,
    itemIndex: number,
    code: string,
  ): void {
    const known = productOf(code);
    setItem(
      packageIndex,
      itemIndex,
      known
        ? {
            stock_code: code,
            description: known.description,
            product_group: known.product_group,
          }
        : { stock_code: code },
    );
  }

  function addItem(packageIndex: number): void {
    const entry = receiving.packages[packageIndex];
    setPackage(packageIndex, {
      items: [...entry.items, emptyItem(entry.package_id)],
    });
  }

  function removeItem(packageIndex: number, itemIndex: number): void {
    const entry = receiving.packages[packageIndex];
    const items = entry.items.filter((_, position) => position !== itemIndex);
    setPackage(packageIndex, {
      items: items.length > 0 ? items : [emptyItem(entry.package_id)],
    });
  }

  // Changing how many packages came off the truck changes how many rows there are to
  // count into — the two must not be allowed to disagree.
  function setPackageCount(count: number): void {
    apply({
      total_packages: count,
      packages: resizePackages(
        receiving.packages,
        count,
        receiving.receiving_id,
      ),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeftIcon className="w-4 h-4" />
          Back to receiving
        </Button>
      </div>

      <Panel>
        <div className="grid items-center gap-3 px-6 py-4 border-b border-border lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-text-primary tracking-tight">
                {receiving.receiving_no}
              </h2>
              <StatusBadge
                status={receivingStatus(receiving, shipment?.total_packages)}
              />
            </div>
            <p className="mt-0.5 truncate text-sm text-text-muted">
              {receiving.supplier_name} · {formatDate(receiving.received_on)}
            </p>
          </div>
          <div
            role="tablist"
            aria-label="Receiving detail mode"
            className="order-2 flex w-full rounded-md bg-bg-subtle p-0.5 lg:order-none lg:w-auto lg:justify-self-center"
          >
            {(["view", "edit"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={detailMode === mode}
                onClick={() => setDetailMode(mode)}
                className={cn(
                  "flex-1 rounded-[5px] px-4 py-1.5 text-sm font-medium capitalize transition-colors duration-150 sm:flex-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
                  detailMode === mode
                    ? "bg-brand text-white shadow-sm"
                    : "text-text-muted hover:text-text-primary",
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          <div className="order-3 flex items-center gap-2 lg:order-none lg:justify-self-end">
            {(detailMode === "edit" || hasChanges) && (
              <Button
                size="sm"
                onClick={() => void handleSubmit(saveChanges)()}
                loading={saving}
                disabled={!hasChanges}
              >
                <CheckIcon className="w-4 h-4" />
                Save changes
              </Button>
            )}
            {confirmDelete ? (
              <>
                <Button variant="destructive" size="sm" onClick={onDelete}>
                  <TrashIcon className="w-4 h-4" />
                  Delete for good
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  Keep
                </Button>
              </>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDelete(true)}
              >
                <TrashIcon className="w-4 h-4" />
                Delete receiving
              </Button>
            )}
          </div>
        </div>

        <div className="px-6 py-6 flex flex-col gap-8">
          <section>
            <SectionLabel>Step 1 — what we should receive</SectionLabel>
            {detailMode === "view" ? (
              <ReceivingInfoView
                receiving={receiving}
                totalPackagesToReceive={shipment?.total_packages}
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-text-primary">
                    Receiving
                  </h3>
                  <dl className="grid gap-3 sm:grid-cols-2">
                    <ReadOnlyField
                      label="Receiving no."
                      value={receiving.receiving_no}
                      copyable
                    />
                    <ReadOnlyField
                      label="Shipment no."
                      value={receiving.shipment_no}
                      copyable
                    />
                    <ReadOnlyField
                      label="Voucher no."
                      value={receiving.voucher_no}
                      copyable
                    />
                    <ReadOnlyField
                      label="Supplier / Factory"
                      value={receiving.supplier_name}
                    />
                  </dl>
                </div>
                <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-text-primary">
                    Gate details
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Controller
                      control={control}
                      name="receiving.gate"
                      render={({ field }) => (
                        <SuggestInput
                          label="Gate"
                          placeholder="Bogyoke Rd, Mawlamyine"
                          suggestions={RECEIVING_GATES}
                          value={field.value}
                          onChange={(next) => {
                            field.onChange(next);
                            apply({ gate: next });
                          }}
                          error={errors.receiving?.gate?.message}
                        />
                      )}
                    />
                    <Controller
                      control={control}
                      name="receiving.received_on"
                      render={({ field }) => (
                        <Input
                          label="Date"
                          type="date"
                          className={EDITABLE}
                          value={field.value}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          error={errors.receiving?.received_on?.message}
                        />
                      )}
                    />
                    <Controller
                      control={control}
                      name="receiving.total_packages"
                      render={({ field }) => (
                        <CountField
                          label="Received packages"
                          value={field.value}
                          onChange={setPackageCount}
                        />
                      )}
                    />
                    <ReadOnlyField
                      label="Total packages to receive"
                      value={
                        shipment ? formatQty(shipment.total_packages) : "—"
                      }
                    />
                    <Controller
                      control={control}
                      name="receiving.total_quantity_pairs"
                      render={({ field }) => (
                        <QuantityField
                          label="Quantity"
                          unitLabel="Unit the voucher is written in"
                          value={field.value}
                          unit={receiving.total_unit}
                          hint={formatIn(expectedPairs(receiving), "set")}
                          onChange={field.onChange}
                          onUnitChange={(total_unit) =>
                            setValue("receiving.total_unit", total_unit, {
                              shouldDirty: true,
                              shouldValidate: true,
                            })
                          }
                        />
                      )}
                    />
                  </div>
                </div>
              </div>
            )}
          </section>

          <section>
            <SectionLabel>Costs</SectionLabel>
            {detailMode === "view" ? (
              <ReceivingCostsView receiving={receiving} />
            ) : (
              <>
                <TableContainer>
                  <Thead className="top-0">
                    <Tr>
                      <Th>Location</Th>
                      <Th>Carrier</Th>
                      <Th>Cost type</Th>
                      <Th className="text-right w-40">Amount</Th>
                      <Th>Note</Th>
                      <Th className="w-10" aria-label="Remove cost" />
                    </Tr>
                  </Thead>
                  <Tbody>
                    {receiving.costs.map((cost, index) => (
                      <Tr key={cost.cost_id}>
                        <Td>
                          <SuggestInput
                            label={`Where cost ${index + 1} was spent`}
                            placeholder="Shwe Moe Cargo"
                            suggestions={stages}
                            value={cost.stage}
                            onChange={(next) => setCost(index, { stage: next })}
                            bare
                          />
                        </Td>
                        <Td>
                          <SuggestInput
                            label={`Who was paid for cost ${index + 1}`}
                            placeholder="Nobody in particular"
                            suggestions={carriers}
                            value={cost.carrier}
                            onChange={(next) =>
                              setCost(index, { carrier: next })
                            }
                            bare
                          />
                        </Td>
                        <Td>
                          <SuggestInput
                            label={`What cost ${index + 1} was for`}
                            placeholder="Carrier fee"
                            suggestions={COST_KINDS}
                            value={cost.kind}
                            onChange={(next) => setCost(index, { kind: next })}
                            bare
                          />
                        </Td>
                        <Td className="text-right">
                          <CellInput
                            label={`Amount of cost ${index + 1}`}
                            placeholder="0"
                            numeric
                            className="text-right"
                            value={String(cost.amount)}
                            onChange={(next) =>
                              setCost(index, { amount: Number(next) || 0 })
                            }
                          />
                        </Td>
                        <Td>
                          <CellInput
                            label={`Note on cost ${index + 1}`}
                            placeholder="Take a note"
                            value={cost.note}
                            onChange={(next) => setCost(index, { note: next })}
                          />
                        </Td>
                        <Td className="text-center">
                          <button
                            type="button"
                            onClick={() => removeCost(index)}
                            title="Remove this cost"
                            aria-label={`Remove cost ${index + 1}`}
                            className={cn(
                              "p-1 rounded-md text-text-muted",
                              "transition-colors duration-150",
                              "hover:bg-error-subtle hover:text-error",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error",
                            )}
                          >
                            <TrashIcon className="w-4 h-4" />
                          </button>
                        </Td>
                      </Tr>
                    ))}
                    {receiving.costs.length === 0 && (
                      <Tr>
                        <Td className="text-text-muted text-sm" colSpan={6}>
                          Nothing charged for this delivery yet.
                        </Td>
                      </Tr>
                    )}
                    <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                      <Td className="font-semibold" colSpan={3}>
                        Total
                      </Td>
                      <Td className="text-right tabular-nums font-semibold text-brand">
                        {formatKyat(totalCost(receiving))}
                      </Td>
                      <Td colSpan={2} />
                    </Tr>
                  </Tbody>
                </TableContainer>
                <div className="mt-3">
                  <Button size="sm" onClick={addCost}>
                    <PlusIcon className="w-4 h-4" />
                    Add a cost
                  </Button>
                  {addingCostId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={cancelAddCost}
                      className={cn(SOFT_RED, "ml-2")}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </>
            )}
          </section>

          <section>
            <SectionLabel>Step 2 — what we received</SectionLabel>
            {detailMode === "view" ? (
              <ReceivingPackagesView
                receiving={receiving}
                totalPackagesToReceive={shipment?.total_packages}
              />
            ) : (
              <>
                <CountCheck
                  counted={counted}
                  expected={expectedPairs(receiving)}
                  opened={opened}
                  total={receiving.packages.length}
                  expectedPackages={shipment?.total_packages}
                  unit="set"
                />
                {receiving.packages.length === 0 ? (
                  <p className="text-sm text-text-muted">
                    No packages recorded yet. Put the number of received
                    packages above and a row appears for each one.
                  </p>
                ) : (
                  <>
                    <TableContainer>
                      <Thead>
                        <Tr>
                          <Th>Package</Th>
                          <Th>Received date</Th>
                          <Th>Stock code</Th>
                          <Th>Colors</Th>
                          <Th className="text-right">Received quantity</Th>
                          <Th>Note</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {receiving.packages.flatMap((entry, index) => {
                          const rowCount = Math.max(entry.items.length, 1);
                          const packageCell = (
                            <Td rowSpan={rowCount} className="align-top">
                              <div className="flex min-w-[9rem] flex-col items-start gap-2">
                                <span className="font-semibold text-brand">
                                  #{entry.package_no}
                                </span>
                                <OpenedToggle
                                  opened={entry.opened}
                                  onToggle={() => toggleOpened(index)}
                                />
                              </div>
                            </Td>
                          );
                          const receivedDateCell = (
                            <Td rowSpan={rowCount} className="align-top">
                              <CellInput
                                label={`Received date for package ${entry.package_no}`}
                                placeholder="YYYY-MM-DD"
                                type="date"
                                value={entry.received_on}
                                onChange={(received_on) =>
                                  setPackage(index, { received_on })
                                }
                              />
                            </Td>
                          );
                          const noteCell = (
                            <Td rowSpan={rowCount} className="align-top">
                              <CellInput
                                label={`Note on package ${entry.package_no}`}
                                placeholder="Optional note"
                                value={entry.note}
                                onChange={(note) => setPackage(index, { note })}
                              />
                            </Td>
                          );
                          const packageTotalRow = (
                            <Tr
                              key={`${entry.package_id}-total`}
                              className="bg-bg-subtle hover:bg-bg-subtle"
                            >
                              <Td colSpan={2} className="font-semibold">
                                Total
                              </Td>
                              <Td className="font-semibold tabular-nums">
                                <span className="mr-2 text-xs font-medium text-text-muted">
                                  Products
                                </span>
                                {formatQty(entry.items.length)}
                              </Td>
                              <Td />
                              <Td className="text-right font-semibold tabular-nums text-success">
                                {formatIn(packagePairs(entry), "set")}
                              </Td>
                              <Td className="text-right">
                                {entry.opened ? (
                                  <Button
                                    size="sm"
                                    onClick={() => addItem(index)}
                                  >
                                    <PlusIcon className="h-4 w-4" />
                                    Add product
                                  </Button>
                                ) : (
                                  <span className="text-xs text-text-muted">
                                    Open package first
                                  </span>
                                )}
                              </Td>
                            </Tr>
                          );

                          if (!entry.opened || entry.items.length === 0) {
                            return [
                              <Tr key={entry.package_id}>
                                {packageCell}
                                {receivedDateCell}
                                <Td
                                  colSpan={3}
                                  className="text-sm text-text-muted"
                                >
                                  {entry.opened
                                    ? "Add a product to record what was received"
                                    : "Open package to record products"}
                                </Td>
                                {noteCell}
                              </Tr>,
                              packageTotalRow,
                            ];
                          }

                          return [
                            ...entry.items.map((item, itemIndex) => (
                              <Tr key={item.item_id}>
                                {itemIndex === 0 && packageCell}
                                {itemIndex === 0 && receivedDateCell}
                                <Td className="align-top">
                                  <div className="min-w-[12rem] flex items-start gap-2">
                                    <div className="min-w-0 flex-1">
                                      <SuggestInput
                                        label={`Stock code for product ${itemIndex + 1} in package ${entry.package_no}`}
                                        placeholder="A1001"
                                        suggestions={STOCK_CODES}
                                        bare
                                        value={item.stock_code}
                                        onChange={(next) =>
                                          setStockCode(index, itemIndex, next)
                                        }
                                        error={
                                          receivedStockCodeProblem(
                                            item.stock_code,
                                            expected,
                                          ) ?? undefined
                                        }
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        removeItem(index, itemIndex)
                                      }
                                      title="Remove this product"
                                      aria-label={`Remove product ${itemIndex + 1} from package ${entry.package_no}`}
                                      className={cn(
                                        "mt-1 rounded-md p-1 text-text-muted",
                                        "transition-colors duration-150",
                                        "hover:bg-error-subtle hover:text-error",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error",
                                      )}
                                    >
                                      <TrashIcon className="h-4 w-4" />
                                    </button>
                                  </div>
                                </Td>
                                <Td className="align-top">
                                  <CellInput
                                    label={`Colors for product ${itemIndex + 1} in package ${entry.package_no}`}
                                    placeholder="black10s, pink2p"
                                    multiline
                                    error={
                                      colorQtyProblem(item.color_breakdown) ??
                                      receivedColorProblem(
                                        item.stock_code,
                                        item.color_breakdown,
                                        expected,
                                      ) ??
                                      receivedColorQuantityProblem(
                                        item.stock_code,
                                        receiving,
                                        expected,
                                      ) ??
                                      undefined
                                    }
                                    value={item.color_breakdown}
                                    onChange={(color_breakdown) =>
                                      setColorQty(index, itemIndex, color_breakdown)
                                    }
                                  />
                                </Td>
                                <Td className="align-top text-right">
                                  <div className="min-h-9 px-2 flex items-center justify-end rounded-md bg-bg-subtle text-sm font-semibold tabular-nums text-text-primary">
                                    {formatStoredQuantity(item.quantity, item.unit)}
                                  </div>
                                </Td>
                                {itemIndex === 0 && noteCell}
                              </Tr>
                            )),
                            packageTotalRow,
                          ];
                        })}
                        <Tr className="bg-bg-subtle hover:bg-bg-subtle">
                          <Td colSpan={4} className="font-semibold">
                            Packages opened {formatQty(opened)} /{" "}
                            {formatQty(receiving.packages.length)}
                          </Td>
                          <Td
                            colSpan={2}
                            className="text-right font-semibold text-success"
                          >
                            {formatIn(counted, "set")} /{" "}
                            {formatIn(expectedPairs(receiving), "set")} received
                          </Td>
                        </Tr>
                      </Tbody>
                    </TableContainer>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      </Panel>
    </div>
  );
}

/** The check the whole page exists for: what was counted against what the supplier's
 *  voucher says is coming. Quiet while the counting is still going on — a shortfall
 *  halfway through only means the rest of the boxes are still shut. */
function CountCheck({
  counted,
  expected,
  opened,
  total,
  expectedPackages,
  unit,
}: {
  counted: number;
  expected: number;
  opened: number;
  /** Packages added to this receiving so far — "Received packages" ("total" as in "the
   *  total added so far", not the shipment's eventual total). */
  total: number;
  /** The shipment's own total_packages, when known — how many boxes this delivery will
   *  eventually have, which can be more than have been added to this receiving yet. */
  expectedPackages: number | undefined;
  unit: Unit;
}): React.JSX.Element {
  const difference = counted - expected;
  // Every box added so far being open still doesn't make the count final while the
  // shipment says more boxes are coming and this receiving simply hasn't added them yet.
  const packagesComplete =
    expectedPackages === undefined || total >= expectedPackages;
  const allOpened = opened === total && total > 0 && packagesComplete;

  if (allOpened) {
    if (difference === 0) {
      return (
        <div className="flex items-center gap-2 mb-3 rounded-lg border border-success/30 bg-success-subtle px-4 py-2.5 text-sm text-success">
          <CheckIcon className="w-4 h-4 shrink-0" />
          <span>
            All {formatQty(total)} packages received, and the{" "}
            {formatIn(counted, unit)} match the voucher.
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-start gap-2 mb-3 rounded-lg border border-error/30 bg-error-subtle px-4 py-2.5 text-sm text-error">
        <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          <strong className="font-semibold">
            {difference < 0
              ? `${formatIn(-difference, unit)} short.`
              : `${formatIn(difference, unit)} too many.`}
          </strong>{" "}
          The voucher says {formatIn(expected, unit)} are coming and{" "}
          {formatIn(counted, unit)} were received. Open the packages again
          before this goes into stock.
        </span>
      </div>
    );
  }

  // Falling short while boxes are still unopened is just the normal in-progress state —
  // more could still be inside one nobody has opened yet, so it says nothing. Already
  // matching or exceeding the voucher's total this early is not normal: it means
  // everything the voucher named has been counted into too few of the boxes, which is
  // usually a sign the same goods got logged twice, or a whole box was skipped.
  if (opened > 0 && difference >= 0) {
    const unopenedAdded = total - opened;
    const headline =
      difference > 0
        ? `Received ${formatIn(difference, unit)} more than the voucher.`
        : "Received quantity matches the voucher.";
    return (
      <div className="flex items-start gap-2 mb-3 rounded-lg border border-warning/30 bg-warning-subtle px-4 py-2.5 text-sm text-warning">
        <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          <strong className="font-semibold">{headline}</strong>{" "}
          {unopenedAdded > 0 ? (
            <>
              {formatQty(unopenedAdded)} of the packages already added{" "}
              {unopenedAdded === 1 ? "is" : "are"} still unopened. Check them
              before completing receiving.
            </>
          ) : (
            // unopenedAdded is 0 here, so allOpened above must have been false because
            // packagesComplete was false: the shipment still has more packages than
            // this receiving has added yet.
            <>
              Only {formatQty(total)} of {formatQty(expectedPackages ?? total)}
              expected packages have been added. Check the remaining{" "}
              {formatQty(Math.max(0, (expectedPackages ?? total) - total))}{" "}
              packages before completing receiving.
            </>
          )}
        </span>
      </div>
    );
  }

  return <></>;
}

function OpenedToggle({
  opened,
  onToggle,
  disabled = false,
}: {
  opened: boolean;
  onToggle: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={opened}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold whitespace-nowrap shadow-sm",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        opened
          ? "border-brand bg-brand-subtle text-brand hover:bg-brand-subtle"
          : "border-border bg-bg-base text-text-secondary hover:border-brand hover:bg-brand-subtle hover:text-brand",
      )}
    >
      {opened && <CheckIcon className="w-3.5 h-3.5" />}
      {opened ? "Opened" : "Not opened"}
    </button>
  );
}

// ── New receiving ──────────────────────────────────────────────────────────────

const receivingFormSchema = z.object({
  shipment_no: z.string().trim().min(1, "Choose a shipment."),
  gate: z.string().trim().min(1, "Enter a receiving gate."),
  received_on: z.string().trim().min(1, "Choose a receiving date."),
  packages: z
    .string()
    .regex(/^\d*$/, "Received packages can only contain numbers.")
    .refine(
      (value) => Number(value) > 0,
      "Enter at least one received package.",
    ),
  sets: z.string().regex(/^\d*$/, "Quantity can only contain numbers."),
  sets_unit: z.enum(["set", "pair", "dozen"]),
  cost: z.string().regex(/^\d*$/, "Cost can only contain numbers."),
});

interface ReceivingFormValues {
  shipment_no: string;
  gate: string;
  received_on: string;
  packages: string;
  sets: string;
  sets_unit: Unit;
  cost: string;
}

const STEPS = ["Receiving", "Review"] as const;

function NewReceivingForm({
  nextReceivingNo: receivingNo,
  onCancel,
  onCreate,
}: {
  nextReceivingNo: string;
  onCancel: () => void;
  onCreate: (input: NewReceivingInput) => void;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const {
    control,
    register,
    handleSubmit,
    setValue,
    trigger,
    formState: { errors, isDirty },
  } = useForm<ReceivingFormValues>({
    resolver: zodResolver(receivingFormSchema),
    defaultValues: {
      shipment_no: "",
      gate: "",
      received_on: todayIso(),
      packages: "",
      sets: "",
      sets_unit: "set",
      cost: "",
    },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const values = useWatch({ control }) as ReceivingFormValues;
  const {
    shipment_no: shipmentNo,
    gate,
    received_on: receivedDate,
    packages,
    sets,
    sets_unit: setsUnit,
    cost,
  } = values;

  const { shipments } = useWholesale();
  const shipment = shipments.find((entry) => entry.shipment_no === shipmentNo);

  function selectShipment(nextShipmentNo: string): void {
    setValue("shipment_no", nextShipmentNo, {
      shouldDirty: true,
      shouldValidate: true,
    });
    const picked = shipments.find(
      (entry) => entry.shipment_no === nextShipmentNo,
    );
    if (!picked) return;

    setValue("gate", picked.final_destination, {
      shouldDirty: true,
      shouldValidate: true,
    });
    setValue(
      "packages",
      picked.final_received_packages > 0
        ? String(picked.final_received_packages)
        : "",
      { shouldDirty: true, shouldValidate: true },
    );
    // The figure and unit travel together. Copying only the number would turn a
    // shipment counted in pairs into the same number of sets.
    setValue("sets", String(picked.total_quantity_pairs), { shouldDirty: true });
    setValue("sets_unit", picked.total_unit, { shouldDirty: true });
  }

  async function moveToReview(): Promise<void> {
    const valid = await trigger();
    if (valid && shipment) setStep(1);
  }

  function submit(values: ReceivingFormValues): void {
    const shipment = shipments.find(
      (entry) => entry.shipment_no === values.shipment_no,
    );
    if (!shipment) return;
    onCreate({
      shipment_id: shipment.shipment_id,
      gate: values.gate.trim(),
      received_on: values.received_on,
      total_packages: Number(values.packages) || 0,
      // Whatever the carrier asked for on the day is simply the first charge; more can
      // be added as the delivery is handled.
      costs:
        Number(values.cost) > 0
          ? [
              {
                cost_id: "",
                stage: shipment.carrier_name,
                carrier: shipment.carrier_name,
                kind: "Cargo fee",
                amount: Number(values.cost),
                note: "",
              },
            ]
          : [],
      // An empty box means "whatever the shipment says", and that figure carries the
      // shipment's unit, not the one left sitting in the form.
      total_quantity_pairs: Number(values.sets) || shipment.total_quantity_pairs,
      total_unit: Number(values.sets) ? values.sets_unit : shipment.total_unit,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button
          variant="ghost"
          size="sm"
          title={
            isDirty ? "This new receiving has unsaved changes." : undefined
          }
          onClick={onCancel}
        >
          <ChevronLeftIcon className="w-4 h-4" />
          Back to receiving gate
        </Button>
      </div>

      <Panel>
        <div className="px-6 py-5 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight mb-5">
            New receiving
          </h2>
          <StepBar steps={STEPS} step={step} />
        </div>

        {step === 0 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <div>
              <SectionLabel>Step 1 — what we should receive</SectionLabel>
            </div>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Controller
                control={control}
                name="shipment_no"
                render={() => (
                  <Select
                    label={<Required>Shipment</Required>}
                    className={EDITABLE}
                    value={shipmentNo}
                    error={errors.shipment_no?.message}
                    onChange={(event) => selectShipment(event.target.value)}
                  >
                    <option value="">Choose…</option>
                    {shipments.map((entry) => (
                      <option key={entry.shipment_id} value={entry.shipment_no}>
                        {entry.shipment_no} — {entry.supplier_name}
                      </option>
                    ))}
                  </Select>
                )}
              />
              <Controller
                control={control}
                name="gate"
                render={({ field }) => (
                  <SuggestInput
                    label={<Required>Gate</Required>}
                    placeholder="Bogyoke Rd, Mawlamyine"
                    suggestions={RECEIVING_GATES}
                    value={field.value}
                    onChange={field.onChange}
                    error={errors.gate?.message}
                  />
                )}
              />
              <Input
                label="Date"
                type="date"
                className={EDITABLE}
                error={errors.received_on?.message}
                {...register("received_on")}
              />
              <Controller
                control={control}
                name="packages"
                render={({ field }) => (
                  <Input
                    label={<Required>Received packages</Required>}
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    className={cn(EDITABLE, "text-right")}
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(onlyDigits(event.target.value))
                    }
                    error={errors.packages?.message}
                    hint={
                      shipment
                        ? `${formatQty(shipment.total_packages)} on the shipment.`
                        : "Pick a shipment and this fills itself in."
                    }
                  />
                )}
              />
              <ReadOnlyField
                label="Total packages to receive"
                value={shipment ? formatQty(shipment.total_packages) : "—"}
              />
              <Controller
                control={control}
                name="sets"
                render={({ field }) => (
                  <QuantityInput
                    label="Quantity"
                    unitLabel="Unit the voucher is written in"
                    value={field.value}
                    unit={setsUnit}
                    onChange={field.onChange}
                    onUnitChange={(unit) =>
                      setValue("sets_unit", unit, {
                        shouldDirty: true,
                        shouldValidate: true,
                      })
                    }
                    error={errors.sets?.message}
                    hint={
                      shipment
                        ? `${formatIn(toPairs(shipment.total_quantity_pairs, shipment.total_unit), "set")} on the voucher.`
                        : "From the supplier's voucher."
                    }
                  />
                )}
              />
              <Controller
                control={control}
                name="cost"
                render={({ field }) => (
                  <Input
                    label="Cost"
                    type="text"
                    inputMode="numeric"
                    placeholder="0"
                    className={cn(EDITABLE, "text-right")}
                    value={field.value}
                    onChange={(event) =>
                      field.onChange(onlyDigits(event.target.value))
                    }
                    error={errors.cost?.message}
                    hint="More charges can be added later."
                  />
                )}
              />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => void moveToReview()}>
                Next: review
                <ChevronRightIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <SectionLabel>Step 2 — review &amp; confirm</SectionLabel>
            <dl className="grid gap-4 grid-cols-1 sm:grid-cols-4 bg-bg-subtle border border-border rounded-lg p-4">
              <ReviewFact label="Receiving no." value={receivingNo} />
              <ReviewFact label="Shipment no." value={shipmentNo || "—"} />
              <ReviewFact
                label="Voucher no."
                value={shipment?.voucher_no ?? "—"}
              />
              <ReviewFact
                label="Supplier / Factory"
                value={shipment?.supplier_name ?? "—"}
              />
              <ReviewFact label="Gate" value={gate || "—"} />
              <ReviewFact label="Date" value={formatDate(receivedDate)} />
              <ReviewFact
                label="Received packages"
                value={formatQty(Number(packages) || 0)}
              />
              <ReviewFact
                label="Total packages to receive"
                value={shipment ? formatQty(shipment.total_packages) : "—"}
              />
              <ReviewFact
                label="Total sets"
                value={formatIn(toPairs(Number(sets) || 0, setsUnit), setsUnit)}
              />
              <ReviewFact label="Cost" value={formatKyat(Number(cost) || 0)} />
            </dl>
            <div className="flex justify-between">
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() => setStep(0)}
              >
                <ChevronLeftIcon className="w-4 h-4" />
                Back
              </Button>
              <Button onClick={handleSubmit(submit)}>
                <CheckIcon className="w-4 h-4" />
                Confirm receiving
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}
