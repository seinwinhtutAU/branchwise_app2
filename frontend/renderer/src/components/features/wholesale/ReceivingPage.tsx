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
  CurrencySelect,
  EDITABLE,
  FigureCard,
  FloatingLayer,
  MenuItem,
  PAGE_SIZE,
  Panel,
  QuantityInput,
  ReadOnlyField,
  Required,
  Reference,
  ReviewFact,
  RowProgress,
  SOFT_BLUE,
  SectionLabel,
  StepBar,
  SuggestInput,
} from "@renderer/components/features/wholesale/ui";
import {
  DEFAULT_CURRENCY,
  isForeignCurrency,
  previewKyatAmount,
  type CurrencyCode,
} from "@renderer/components/features/wholesale/currency";
import type { AppSettings } from "@renderer/lib/appSettings";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pagination } from "@renderer/components/ui/Pagination";
import { Select } from "@renderer/components/ui/Select";
import { Switch } from "@renderer/components/ui/Switch";
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
  CopyIcon,
  EyeIcon,
  MoreVerticalIcon,
  ReceivingIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  TruckIcon,
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
import {
  colorQtyProblem,
  formatDate,
  formatKyat,
  formatQty,
  nextReference,
  onlyDigits,
  sharePct,
  quantityFromColors,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  formatSets,
  PAIRS_PER,
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
  WHOLESALE_STOCK_URL,
  WholesaleApiError,
  createReceiving as apiCreateReceiving,
  deleteReceiving as apiDeleteReceiving,
  receivingsFromWire,
  replaceReceivingCosts,
  shipmentsFromWire,
  updateReceiving as apiUpdateReceiving,
  updateReceivingPackage,
  type NewReceivingInput,
  stockRecordsFromWire,
  type ReceivingWire,
  type ShipmentWire,
  type StockRecordWire,
} from "@renderer/components/features/wholesale/api";
import {
  RECEIVING_GATES,
  STOCK_CODES,
  productOf,
  useHydrateMasterData,
} from "@renderer/components/features/wholesale/masterData";
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
const STOCK_QUERY_KEY = ["wholesale", "stock"] as const;

type View = "list" | "detail" | "new";
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
 *  the same product often arrives split across several packages and a colour's full count
 *  only exists once every package holding it is added up. */
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
 *  colour can still be sitting in a package nobody has opened yet. */
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
  return `${formatIn(pairs, receiving.total_unit)} of ${color} recorded, but the voucher only says ${formatIn(wanted.get(color) ?? 0, receiving.total_unit)}.`;
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
  settings,
  initialReceivingNo,
  onInitialReceivingOpened,
  onOpenOrders,
}: {
  session: Session;
  settings: AppSettings | null;
  initialReceivingNo?: string | null;
  onInitialReceivingOpened?: () => void;
  /** Sends the user on to Customer Orders — receiving goods is only half the job; the
   *  stock still has to be shared out, and nothing else on this screen says so. */
  onOpenOrders?: () => void;
}): React.JSX.Element {
  const showToast = useToast();
  useHydrateMasterData(session);
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
  // What the gate has already put on the shelf. Read here only to answer the question
  // this screen leaves hanging: the packages are counted, so what happens next?
  const { data: stockWire } = useQuery({
    queryKey: STOCK_QUERY_KEY,
    queryFn: () => fetchJson<StockRecordWire[]>(WHOLESALE_STOCK_URL, session),
  });
  const stockRecords = useMemo(
    () => (stockWire ? stockRecordsFromWire(stockWire) : []),
    [stockWire],
  );
  const readyToAllocatePairs = stockRecords.reduce(
    (sum, record) => sum + Math.max(0, record.available_pairs),
    0,
  );
  const owedToCustomersPairs = stockRecords.reduce(
    (sum, record) => sum + Math.max(0, record.owed_to_customers_pairs),
    0,
  );
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
  const [focusSection, setFocusSection] = useState<"packages" | undefined>(
    undefined,
  );

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
    setFocusSection(undefined);
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
        setFocusSection(undefined);
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
        focus={focusSection}
        settings={settings}
        onBack={() => {
          setFocusSection(undefined);
          setView("list");
        }}
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
      onOpen={(receivingId, focus) => {
        setSelectedId(receivingId);
        setFocusSection(focus);
        setView("detail");
      }}
      onDelete={deleteReceiving}
      onNew={() => setView("new")}
      onRefresh={refreshPage}
      refreshing={isRefreshing || shipmentsRefreshing}
      readyToAllocatePairs={readyToAllocatePairs}
      owedToCustomersPairs={owedToCustomersPairs}
      onOpenOrders={onOpenOrders}
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
  onDelete,
  onNew,
  onRefresh,
  refreshing,
  readyToAllocatePairs,
  owedToCustomersPairs,
  onOpenOrders,
}: {
  receivings: Receiving[];
  onOpen: (receivingId: string, focus?: "packages") => void;
  onDelete: (receivingId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  readyToAllocatePairs: number;
  owedToCustomersPairs: number;
  onOpenOrders?: () => void;
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
    <div className="flex flex-col gap-6">
      {readyToAllocatePairs > 0 && onOpenOrders && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success/40 bg-success-subtle px-5 py-4">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">
              {formatSets(readyToAllocatePairs)} on the shelf with no customer
              allocated yet.
            </p>
            <p className="mt-0.5 text-sm text-text-secondary">
              {owedToCustomersPairs > 0
                ? `Customers are still waiting for ${formatSets(owedToCustomersPairs)}.`
                : "Counting the packages is only half the job — the stock still has to be shared out."}
            </p>
          </div>
          <Button size="sm" onClick={onOpenOrders}>
            Allocate to customers
          </Button>
        </div>
      )}
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

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-text-primary tracking-tight">
              Receiving
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Manage all deliveries received at the gate.
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
                  <Th className="whitespace-nowrap">Date</Th>
                  <Th className="whitespace-nowrap">Supplier / Factory</Th>
                  <Th className="whitespace-nowrap">Packages</Th>
                  <Th className="text-right whitespace-nowrap">Received</Th>
                  <Th>Status</Th>
                  <Th className="w-12" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((receiving) => {
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
                  return (
                    <Tr key={receiving.receiving_id}>
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
                      <Td className="min-w-[13rem]">
                        <div className="flex flex-col gap-1 items-end">
                          <span
                            className={cn(
                              "tabular-nums whitespace-nowrap",
                              allOpened && difference !== 0
                                ? "text-error font-semibold"
                                : "text-text-secondary",
                            )}
                          >
                            {formatSets(counted)}{" "}
                            <span className="text-text-muted">
                              / {formatSets(expectedQuantity)}
                            </span>
                          </span>
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
                        <RowMenu
                          onOpen={() => onOpen(receiving.receiving_id)}
                          onCheckCount={
                            allOpened && difference !== 0
                              ? () => onOpen(receiving.receiving_id, "packages")
                              : undefined
                          }
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

function RowMenu({
  onOpen,
  onCheckCount,
  onDelete,
}: {
  onOpen: () => void;
  onCheckCount?: () => void;
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
              {onCheckCount && (
                <MenuItem
                  icon={<CheckIcon className="w-4 h-4" />}
                  label="Check count"
                  onClick={() => {
                    setOpen(false);
                    onCheckCount();
                  }}
                />
              )}
              <MenuItem
                icon={<EyeIcon className="w-4 h-4" />}
                label="Open"
                onClick={() => {
                  setOpen(false);
                  onOpen();
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
  cost_date: z.string().trim().min(1, "Choose a cost date."),
  stage: z.string(),
  carrier: z.string(),
  kind: z.string(),
  amount: z.number().finite().min(0),
  currency_code: z.string().optional(),
  original_amount: z.number().finite().min(0).nullable().optional(),
  exchange_rate: z.number().finite().min(0).nullable().optional(),
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
  focus,
  settings,
  onBack,
  onSave,
  onDelete,
}: {
  receiving: Receiving;
  focus?: "packages";
  settings: AppSettings | null;
  onBack: () => void;
  onSave: (receiving: Receiving) => Promise<void>;
  onDelete: () => void;
}): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"packages" | "costs">(
    focus === "packages" ? "packages" : "packages",
  );
  const [selectedPackageIndex, setSelectedPackageIndex] = useState(0);
  const [packageSearch, setPackageSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [addingCostId, setAddingCostId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Set while the last package holds counted products and undoing it needs a second
   *  click — taking it back would throw that counting away. */
  const [confirmUndoArrival, setConfirmUndoArrival] = useState(false);

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { isDirty },
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
    setConfirmUndoArrival(false);
  }, [initialReceiving, reset]);

  // An armed "discard this package" must not survive being left behind: walking to
  // another package and back should not find the destructive button still waiting.
  useEffect(() => {
    setConfirmUndoArrival(false);
  }, [selectedPackageIndex]);

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
  const expected = useMemo(() => voucherExpectations(voucher), [voucher]);
  const stages = useMemo(
    () =>
      [
        ...(shipment ? [shipment.carrier_name] : []),
        ...(shipment ? shipment.legs.map((leg) => leg.stop_name) : []),
        receiving.gate,
      ].filter((stage) => stage.trim() !== ""),
    [shipment, receiving.gate],
  );
  const carriers = useMemo(
    () =>
      [
        ...(shipment ? [shipment.carrier_name] : []),
        ...(shipment ? shipment.legs.map((leg) => leg.carrier_name) : []),
      ].filter((name) => name.trim() !== "" && name !== "—"),
    [shipment],
  );

  const opened = openedCount(receiving);
  const counted = countedPairs(receiving);
  const expectedTotalPairs = expectedPairs(receiving);
  const totalCostAmount = totalCost(receiving);
  const costPerPackage =
    receiving.total_packages > 0
      ? Math.round(totalCostAmount / receiving.total_packages)
      : 0;
  const costPerPair = counted > 0 ? Math.round(totalCostAmount / counted) : 0;

  const safePackageIndex = Math.min(
    Math.max(0, selectedPackageIndex),
    Math.max(0, receiving.packages.length - 1),
  );
  const activePackage = receiving.packages[safePackageIndex] as
    ReceivingPackage | undefined;
  const isLastPackage = safePackageIndex === receiving.packages.length - 1;
  /** Whether anything has actually been counted into the open package — an untouched
   *  package still carries one blank item row, which is not a count. */
  const activePackageHasCount = Boolean(
    activePackage?.items.some(
      (item) => item.stock_code.trim() !== "" || item.quantity > 0,
    ),
  );

  function setPackage(index: number, patch: Partial<ReceivingPackage>): void {
    apply({
      packages: receiving.packages.map((entry, position) =>
        position === index ? { ...entry, ...patch } : entry,
      ),
    });
  }

  function toggleOpened(index: number): void {
    const entry = receiving.packages[index];
    if (!entry) return;
    const nextOpened = !entry.opened;
    setPackage(index, {
      opened: nextOpened,
      received_on:
        nextOpened && entry.received_on === ""
          ? receiving.received_on
          : entry.received_on,
      items:
        nextOpened && entry.items.length === 0
          ? [emptyItem(entry.package_id)]
          : entry.items,
    });
  }

  function markAllOpened(): void {
    apply({
      packages: receiving.packages.map((entry) => ({
        ...entry,
        opened: true,
        received_on:
          entry.received_on === "" ? receiving.received_on : entry.received_on,
        items:
          entry.items.length === 0
            ? [emptyItem(entry.package_id)]
            : entry.items,
      })),
    });
  }

  function duplicatePreviousPackage(targetIndex: number): void {
    if (targetIndex <= 0) return;
    const prev = receiving.packages[targetIndex - 1];
    if (!prev || prev.items.length === 0) return;
    const current = receiving.packages[targetIndex];
    if (!current) return;

    const clonedItems: ReceivingItem[] = prev.items.map((item, i) => ({
      ...item,
      item_id: `cloned-${current.package_id}-${i}-${Date.now()}`,
      package_id: current.package_id,
    }));

    setPackage(targetIndex, {
      opened: true,
      received_on: current.received_on || receiving.received_on,
      items: clonedItems,
    });
  }

  function setCost(index: number, patch: Partial<ReceivingCost>): void {
    apply({
      costs: receiving.costs.map((cost, position) =>
        position === index ? { ...cost, ...patch } : cost,
      ),
    });
  }

  function setCostCurrency(index: number, code: CurrencyCode): void {
    const cost = receiving.costs[index];
    if (code === DEFAULT_CURRENCY) {
      setCost(index, {
        currency_code: DEFAULT_CURRENCY,
        original_amount: null,
        exchange_rate: null,
        amount: 0,
      });
      return;
    }
    const original = cost.original_amount ?? 0;
    const rate =
      cost.exchange_rate ?? (Number(settings?.today_exchange_rates[code]) || 0);
    setCost(index, {
      currency_code: code,
      original_amount: original,
      exchange_rate: rate,
      amount: previewKyatAmount(original, rate),
    });
  }

  function setCostOriginalAmount(index: number, value: number): void {
    const cost = receiving.costs[index];
    setCost(index, {
      original_amount: value,
      amount: previewKyatAmount(value, cost.exchange_rate ?? 0),
    });
  }

  function setCostExchangeRate(index: number, value: number): void {
    const cost = receiving.costs[index];
    setCost(index, {
      exchange_rate: value,
      amount: previewKyatAmount(cost.original_amount ?? 0, value),
    });
  }

  function addCost(): void {
    const cost = emptyCost(
      receiving.receiving_id,
      receiving.gate,
      receiving.received_on,
    );
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

  function setItem(
    packageIndex: number,
    itemIndex: number,
    patch: Partial<ReceivingItem>,
  ): void {
    const entry = receiving.packages[packageIndex];
    if (!entry) return;
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
    const item = receiving.packages[packageIndex]?.items[itemIndex];
    if (!item) return;
    const quantity = quantityFromColors(colorQty, item.unit);
    setItem(packageIndex, itemIndex, {
      color_breakdown: colorQty,
      quantity: quantity.qty,
      unit: quantity.unit,
    });
  }

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
            unit: "set",
            unit_conversions: known.default_unit_conversions ?? PAIRS_PER,
          }
        : { stock_code: code },
    );
  }

  function addItem(packageIndex: number): void {
    const entry = receiving.packages[packageIndex];
    if (!entry) return;
    setPackage(packageIndex, {
      opened: true,
      items: [...entry.items, emptyItem(entry.package_id)],
    });
  }

  function removeItem(packageIndex: number, itemIndex: number): void {
    const entry = receiving.packages[packageIndex];
    if (!entry) return;
    const items = entry.items.filter((_, position) => position !== itemIndex);
    setPackage(packageIndex, {
      items: items.length > 0 ? items : [emptyItem(entry.package_id)],
    });
  }

  function setPackageCount(count: number): void {
    const safeCount = Math.max(1, count);
    apply({
      total_packages: safeCount,
      packages: resizePackages(
        receiving.packages,
        safeCount,
        receiving.receiving_id,
      ),
    });
  }

  /** A package that was still to come has turned up at the gate. Clicking slot #n
   *  brings in everything up to and including it, so two arriving together is one
   *  click on the later one rather than two clicks in order. */
  function markPackageArrived(packageNo: number): void {
    if (packageNo <= receiving.packages.length) return;
    setPackageCount(packageNo);
    setSelectedPackageIndex(packageNo - 1);
  }

  /** Undo for a mis-click. Only the newest package can be taken back — packages are a
   *  sequential run and dropping one from the middle would renumber the rest — which
   *  is also the only one a stray click could have created. */
  function undoLastArrival(): void {
    const last = receiving.packages.length;
    if (last <= 1) return;
    setPackageCount(last - 1);
    setSelectedPackageIndex(Math.min(safePackageIndex, last - 2));
    setConfirmUndoArrival(false);
  }

  // Save is the one keyboard shortcut this page keeps. Everything else — switching
  // packages, opening a package, adding a line — is a button you can see, so there is no
  // hidden key combination to remember while counting.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        if (hasChanges && !saving) {
          void handleSubmit(saveChanges)();
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChanges, saving, handleSubmit]);

  // Filter packages for explorer
  const filteredPackagesWithIndex = useMemo(() => {
    const q = packageSearch.trim().toLowerCase();
    return receiving.packages
      .map((pkg, originalIndex) => ({ pkg, originalIndex }))
      .filter(({ pkg }) => {
        if (!q) return true;
        return (
          String(pkg.package_no).toLowerCase().includes(q) ||
          pkg.items.some((it) => it.stock_code.toLowerCase().includes(q))
        );
      });
  }, [receiving.packages, packageSearch]);

  /** Package numbers the shipment says went out that this receiving has no row for.
   *  They are listed as greyed-out slots alongside the real packages so a package
   *  that never turned up is a visible gap in the list, rather than something the
   *  reader has to notice by comparing two numbers. */
  const missingPackageNos = useMemo(() => {
    if (!shipment) return [];
    const short = shipment.total_packages - receiving.packages.length;
    if (short <= 0) return [];
    const highest = receiving.packages.reduce(
      (max, pkg) => Math.max(max, pkg.package_no),
      0,
    );
    return Array.from({ length: short }, (_, i) => highest + i + 1);
  }, [shipment, receiving.packages]);

  const filteredMissingNos = useMemo(() => {
    const q = packageSearch.trim();
    if (!q) return missingPackageNos;
    return missingPackageNos.filter((no) => String(no).includes(q));
  }, [missingPackageNos, packageSearch]);

  // Problem summary across entire batch
  const allProblems = useMemo(() => {
    const problems: string[] = [];
    for (const pkg of receiving.packages) {
      for (const it of pkg.items) {
        const codeProb = receivedStockCodeProblem(it.stock_code, expected);
        if (codeProb && !problems.includes(codeProb)) {
          problems.push(`[#${pkg.package_no}] ${it.stock_code}: ${codeProb}`);
        }
        const colorProb = receivedColorProblem(
          it.stock_code,
          it.color_breakdown,
          expected,
        );
        if (colorProb && !problems.includes(colorProb)) {
          problems.push(`[#${pkg.package_no}] ${it.stock_code}: ${colorProb}`);
        }
      }
    }
    return problems;
  }, [receiving.packages, expected]);

  return (
    <div className="flex flex-col gap-3 min-h-[calc(100vh-5.5rem)]">
      {/* One panel, not three stacked cards. The identity row, the details being
          edited and the arrival notice are all "what this receiving is", so they sit
          in a single bordered block divided by hairlines rather than floating apart
          with gaps between them. */}
      <div className="rounded-xl border border-border bg-bg-surface overflow-hidden divide-y divide-border">
        {/* ── Identity row ──────────────────────────────────────────────── */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={onBack}
              className="text-text-muted hover:text-text-primary gap-1.5"
              title="Back to receiving list (Esc)"
            >
              <ChevronLeftIcon className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </Button>

            <div className="h-5 w-px bg-border" />

            <div className="min-w-0 flex items-center gap-2.5">
              <h2 className="text-base font-bold text-text-primary tracking-tight truncate">
                {receiving.receiving_no}
              </h2>
              <StatusBadge
                status={receivingStatus(receiving, shipment?.total_packages)}
              />
              <span className="hidden md:inline text-xs text-text-muted truncate">
                {receiving.supplier_name}
              </span>
            </div>
          </div>

          {/* Workspace Tabs. The selected side is filled, not merely tinted: this
            project's shadows cast nothing (--shadow-xs is none) and bg-subtle sits a
            hair away from bg-surface, so a raised-pill treatment left both halves
            looking like plain text nobody could tell was clickable. */}
          <div
            role="tablist"
            aria-label="Receiving sections"
            className="flex items-center gap-1 bg-bg-raised p-1 rounded-lg border border-border"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "packages"}
              onClick={() => setActiveTab("packages")}
              className={cn(
                "px-3.5 py-1 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5",
                activeTab === "packages"
                  ? "bg-brand text-white"
                  : "text-text-secondary hover:bg-bg-surface hover:text-text-primary",
              )}
              title="Switch to package counting"
            >
              <span>Packages</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[11px] font-mono",
                  activeTab === "packages"
                    ? "bg-white/25 text-white"
                    : "bg-brand/10 text-brand",
                )}
              >
                {opened}/{receiving.packages.length}
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "costs"}
              onClick={() => setActiveTab("costs")}
              className={cn(
                "px-3.5 py-1 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5",
                activeTab === "costs"
                  ? "bg-brand text-white"
                  : "text-text-secondary hover:bg-bg-surface hover:text-text-primary",
              )}
              title="Switch to costs"
            >
              <span>Costs</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.2 text-[11px] font-mono",
                  activeTab === "costs"
                    ? "bg-white/25 text-white"
                    : "bg-success/10 text-success",
                )}
              >
                {formatKyat(totalCostAmount)}
              </span>
            </button>
          </div>

          {/* Action Controls */}
          <div className="flex items-center gap-2">
            {/* One quiet dot is all the "you have unsaved work" signal this page needs —
              the old bottom status bar said the same thing a second time. */}
            {hasChanges && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-warning"
                title="Unsaved changes"
              />
            )}

            <Button
              size="sm"
              onClick={() => void handleSubmit(saveChanges)()}
              loading={saving}
              disabled={!hasChanges}
              className="font-medium gap-1.5 shadow-xs"
              title="Save changes (Ctrl+S)"
            >
              <CheckIcon className="w-4 h-4" />
              <span>Save</span>
            </Button>

            {confirmDelete ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={onDelete}
                  className="gap-1 text-xs"
                >
                  <TrashIcon className="w-3.5 h-3.5" />
                  Confirm
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                className="gap-1.5 text-xs"
                title="Delete this receiving"
              >
                <TrashIcon className="w-3.5 h-3.5" />
                Delete receiving
              </Button>
            )}
          </div>
        </header>

        {/* ── Details row: the fields actually being edited ──────────────── */}
        {activeTab === "packages" && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-text-muted font-medium">Gate:</span>
                <SuggestInput
                  label="Gate location"
                  suggestions={RECEIVING_GATES}
                  value={receiving.gate}
                  onChange={(next) => apply({ gate: next })}
                  bare
                  placeholder="Select Gate"
                />
              </div>

              <div className="h-4 w-px bg-border" />

              <div className="flex items-center gap-2">
                <span className="text-text-muted font-medium">Date:</span>
                <CellInput
                  label="Received Date"
                  placeholder="YYYY-MM-DD"
                  type="date"
                  value={receiving.received_on}
                  onChange={(received_on) => apply({ received_on })}
                  className="w-32 text-xs font-mono"
                />
              </div>

              <div className="h-4 w-px bg-border" />

              {/* A figure now, not a field. Typing this number was the one place on
                  the screen where a slip destroyed work: lowering it ran
                  resizePackages, which slices packages off the end and takes whatever
                  was already counted inside them with it. The count is now whatever
                  the package list holds, and packages join that list by being marked
                  arrived — the same act the person at the gate is performing anyway. */}
              <div className="flex items-center gap-2">
                <span className="text-text-secondary font-semibold">
                  Total received packages:
                </span>
                <span className="whitespace-nowrap">
                  <strong className="font-mono font-bold text-base text-text-primary">
                    {receiving.packages.length}
                  </strong>
                  {shipment && (
                    <span className="text-xs text-text-muted">
                      {" of "}
                      <strong className="font-mono font-bold text-sm text-text-secondary">
                        {shipment.total_packages}
                      </strong>{" "}
                      sent
                    </span>
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* "Add Package" used to live here. It now sits quietly at the foot of
                  the package list, because adding a package by hand is the exception:
                  the ordinary way a package joins this receiving is by being marked
                  arrived in that list. */}
              <Button
                variant="ghost"
                size="sm"
                onClick={markAllOpened}
                className="text-xs h-7 text-text-secondary hover:text-brand"
                title="Mark all packages as opened"
              >
                ✓ Mark all opened
              </Button>
            </div>
          </div>
        )}

        {/* ── Arrival notice: the panel's bottom strip ────────────────────
            Renders nothing at all when there is nothing to say, so the panel
            simply ends one row earlier rather than leaving an empty band. */}
        {activeTab === "packages" && (
          <CountCheck
            counted={counted}
            expected={expectedTotalPairs}
            opened={opened}
            total={receiving.packages.length}
            expectedPackages={shipment?.total_packages}
            unit="set"
          />
        )}
      </div>

      {/* ── TAB 1: Package Inspection Split-Pane Workbench ──────────────── */}
      {activeTab === "packages" && (
        <div className="flex flex-col gap-2.5 flex-1 min-h-0">
          {allProblems.length > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning-subtle/60 px-4 py-2.5">
              <span className="text-xs font-bold text-warning flex items-center gap-1.5">
                <WarningIcon className="w-3.5 h-3.5" />
                Does not match the voucher ({allProblems.length})
              </span>
              <ul className="mt-1.5 text-[11px] text-text-secondary grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3 max-h-24 overflow-y-auto">
                {allProblems.map((prob, i) => (
                  <li key={i} className="leading-tight">
                    • {prob}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Main 2-Column Cockpit */}
          <div className="flex-1 min-h-[540px] flex border border-border rounded-xl bg-bg-surface overflow-hidden shadow-xs">
            {/* ── Left Column: Packages list ─────────────────────────────── */}
            <aside className="w-64 sm:w-72 shrink-0 border-r border-border flex flex-col bg-bg-subtle/40">
              <div className="p-3 border-b border-border/80 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                    Packages
                  </span>
                  <span className="rounded-full bg-border px-1.5 py-0.2 text-[10px] font-mono text-text-muted">
                    {receiving.packages.length}
                  </span>
                </div>
              </div>

              <div className="p-2 border-b border-border/60">
                <Input
                  placeholder="Filter package #..."
                  value={packageSearch}
                  onChange={(e) => setPackageSearch(e.target.value)}
                  className="h-7 text-xs bg-bg-surface"
                />
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-border/40 p-1.5 space-y-1">
                {filteredPackagesWithIndex.map(({ pkg, originalIndex }) => {
                  const isSelected = originalIndex === safePackageIndex;
                  const pairs = packagePairs(pkg);
                  return (
                    <div
                      key={pkg.package_id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedPackageIndex(originalIndex)}
                      className={cn(
                        "w-full text-left px-3 py-2 rounded-lg cursor-pointer transition-all flex items-center justify-between gap-2 select-none",
                        isSelected
                          ? "bg-brand text-white shadow-xs font-semibold"
                          : "hover:bg-bg-surface text-text-primary bg-transparent",
                      )}
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span
                          className={cn(
                            "w-2 h-2 rounded-full shrink-0",
                            pkg.opened
                              ? isSelected
                                ? "bg-white"
                                : "bg-success"
                              : isSelected
                                ? "bg-white/50"
                                : "bg-text-muted/40",
                          )}
                        />
                        <span className="font-mono text-sm tracking-tight truncate">
                          #{pkg.package_no}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 text-xs">
                        <span
                          className={cn(
                            "font-mono text-[11px]",
                            isSelected ? "text-white/90" : "text-text-muted",
                          )}
                        >
                          {pkg.opened
                            ? `${pkg.items.length} ${pkg.items.length === 1 ? "product" : "products"} · ${formatSets(pairs)}`
                            : "Unopened"}
                        </span>
                      </div>
                    </div>
                  );
                })}

                {/* Slots for packages the shipment sent that are not here, and the way
                    they are brought in: click the slot when the package turns up and it
                    becomes a real package ready to open. Kept grey rather than amber —
                    one shipment's packages often arrive in more than one trip, so this
                    is a normal in-progress state, not a fault. */}
                {filteredMissingNos.map((no) => (
                  // The dashed box lives on an inner element on purpose. This list's
                  // container uses `divide-y`, which sets border-bottom-width:0 and
                  // its own border-color on every child after the first — that was
                  // rubbing out the bottom edge of the dashed outline and washing out
                  // the other three sides. A plain wrapper takes the divide rules so
                  // the box inside keeps all four of its own borders.
                  <div key={`missing-${no}`}>
                    <button
                      type="button"
                      onClick={() => markPackageArrived(no)}
                      className="group w-full text-left px-3 py-2 rounded-lg flex items-center justify-between gap-2 select-none border border-dashed border-border-strong bg-transparent transition-colors hover:border-solid hover:border-brand hover:bg-brand-subtle"
                      title={
                        no === receiving.packages.length + 1
                          ? `Package #${no} has arrived — click to receive it`
                          : `Packages #${receiving.packages.length + 1}–#${no} have arrived — click to receive them`
                      }
                    >
                      <div className="min-w-0 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full shrink-0 border border-text-muted/50 group-hover:border-brand" />
                        <span className="font-mono text-sm tracking-tight truncate text-text-muted group-hover:text-brand">
                          #{no}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-text-muted group-hover:hidden">
                        Still to come
                      </span>
                      <span className="hidden font-mono text-[11px] font-semibold text-brand group-hover:inline">
                        It's here →
                      </span>
                    </button>
                  </div>
                ))}

                {filteredPackagesWithIndex.length === 0 &&
                  filteredMissingNos.length === 0 && (
                    <p className="p-4 text-center text-xs text-text-muted">
                      No packages match filter.
                    </p>
                  )}

                {/* The exception, kept quiet. Every package the shipment announced has
                    a slot of its own above; this is for the ones it did not — an extra
                    package that turned up, or a receiving with no shipment behind it to
                    say how many to expect. */}
                {packageSearch.trim() === "" && (
                  <button
                    type="button"
                    onClick={() =>
                      markPackageArrived(receiving.packages.length + 1)
                    }
                    className="w-full px-3 py-2 rounded-lg flex items-center gap-1.5 text-xs text-text-muted hover:text-brand hover:bg-bg-surface transition-colors"
                    title="Record a package the shipment did not list"
                  >
                    <PlusIcon className="w-3.5 h-3.5" />
                    Extra package arrived
                  </button>
                )}
              </div>

              <div className="p-2.5 border-t border-border/80 bg-bg-surface flex items-center justify-between text-xs text-text-muted">
                <span>
                  Opened: {opened}/{receiving.packages.length}
                </span>
                <span className="font-semibold text-text-primary font-mono">
                  {formatSets(counted)}
                </span>
              </div>
            </aside>

            {/* ── Middle Column: Active Package Workbench ───────────────────── */}
            <main className="flex-1 min-w-0 flex flex-col bg-bg-surface">
              {activePackage ? (
                <>
                  {/* Active Package Top Bar */}
                  <div className="px-5 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3 bg-bg-subtle/20">
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-text-primary tracking-tight font-mono">
                          Package #{activePackage.package_no}
                        </h3>
                        <OpenedToggle
                          opened={activePackage.opened}
                          onToggle={() => toggleOpened(safePackageIndex)}
                        />
                      </div>

                      <div className="h-4 w-px bg-border" />

                      <div className="flex items-center gap-1.5 text-xs text-text-muted">
                        <span>Date:</span>
                        <CellInput
                          label="Package received date"
                          placeholder="YYYY-MM-DD"
                          type="date"
                          value={activePackage.received_on}
                          onChange={(received_on) =>
                            setPackage(safePackageIndex, { received_on })
                          }
                          className="w-28 text-xs font-mono"
                        />
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-text-muted">
                        <span>Note:</span>
                        <CellInput
                          label="Package note"
                          placeholder="Optional note"
                          value={activePackage.note}
                          onChange={(note) =>
                            setPackage(safePackageIndex, { note })
                          }
                          className="w-36 text-xs"
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {safePackageIndex > 0 && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            duplicatePreviousPackage(safePackageIndex)
                          }
                          className="h-7 text-xs gap-1"
                          title="Copy products & colors from previous package"
                        >
                          <CopyIcon className="w-3.5 h-3.5" />
                          <span>Copy Prev</span>
                        </Button>
                      )}

                      <Button
                        size="sm"
                        onClick={() => addItem(safePackageIndex)}
                        className="h-7 text-xs gap-1"
                        title="Add product to this package"
                      >
                        <PlusIcon className="w-3.5 h-3.5" />
                        <span>Add Product</span>
                      </Button>
                    </div>
                  </div>

                  {/* Active Package Products Table */}
                  <div className="flex-1 overflow-y-auto p-4">
                    {!activePackage.opened ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-border/80 rounded-xl bg-bg-subtle/20">
                        <p className="text-sm font-semibold text-text-primary">
                          Package #{activePackage.package_no} is currently
                          unopened.
                        </p>
                        <p className="mt-1 text-xs text-text-muted max-w-sm">
                          Open the package to physically count and record shoes
                          inside.
                        </p>
                        <Button
                          size="sm"
                          onClick={() => toggleOpened(safePackageIndex)}
                          className="mt-4 gap-1.5"
                        >
                          <span>Open Package</span>
                        </Button>

                        {/* The way back from a mis-click on a "still to come" slot,
                            beside the action it was meant to be. Offered only on the
                            newest package, which is the only one such a click can have
                            created, and asks twice once something has been counted into
                            it so the counting is never thrown away silently. */}
                        {isLastPackage &&
                          receiving.packages.length > 1 &&
                          (confirmUndoArrival ? (
                            <div className="mt-4 flex items-center gap-2">
                              <span className="text-xs text-text-muted">
                                This package already has products counted in it.
                              </span>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={undoLastArrival}
                                className="h-7 text-xs"
                              >
                                Discard count
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirmUndoArrival(false)}
                                className="h-7 text-xs"
                              >
                                Keep
                              </Button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() =>
                                activePackageHasCount
                                  ? setConfirmUndoArrival(true)
                                  : undoLastArrival()
                              }
                              className="mt-3 text-xs text-text-muted underline underline-offset-2 hover:text-error"
                              title="This package has not arrived — take it back off this receiving"
                            >
                              Undo arrival
                            </button>
                          ))}
                      </div>
                    ) : activePackage.items.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center text-center p-8">
                        <p className="text-sm text-text-muted">
                          No shoes recorded in Package #
                          {activePackage.package_no} yet.
                        </p>
                        <Button
                          size="sm"
                          onClick={() => addItem(safePackageIndex)}
                          className="mt-3 gap-1.5"
                        >
                          <PlusIcon className="w-3.5 h-3.5" />
                          Add First Product
                        </Button>
                      </div>
                    ) : (
                      <TableContainer className="rounded-lg border border-border">
                        <Thead>
                          <Tr>
                            <Th className="w-12 text-center">#</Th>
                            <Th className="min-w-[14rem]">Stock Code</Th>
                            <Th className="min-w-[16rem]">Color & Qty</Th>
                            <Th className="w-36 text-right">Received</Th>
                            <Th className="w-12" aria-label="Actions" />
                          </Tr>
                        </Thead>
                        <Tbody>
                          {activePackage.items.map((item, itemIndex) => {
                            const codeProblem = receivedStockCodeProblem(
                              item.stock_code,
                              expected,
                            );
                            const colorProblem =
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
                              );

                            return (
                              <Tr key={item.item_id}>
                                <Td className="text-center text-xs font-mono text-text-muted">
                                  {itemIndex + 1}
                                </Td>
                                <Td className="align-top">
                                  <SuggestInput
                                    label={`Stock code ${itemIndex + 1}`}
                                    placeholder="e.g. A1001"
                                    suggestions={STOCK_CODES}
                                    bare
                                    value={item.stock_code}
                                    onChange={(code) =>
                                      setStockCode(
                                        safePackageIndex,
                                        itemIndex,
                                        code,
                                      )
                                    }
                                    error={codeProblem ?? undefined}
                                  />
                                </Td>
                                <Td className="align-top">
                                  <CellInput
                                    label={`Colors for ${item.stock_code || "product"}`}
                                    placeholder="e.g. black10s, pink2p"
                                    multiline
                                    value={item.color_breakdown}
                                    onChange={(breakdown) =>
                                      setColorQty(
                                        safePackageIndex,
                                        itemIndex,
                                        breakdown,
                                      )
                                    }
                                    error={colorProblem ?? undefined}
                                  />
                                </Td>
                                <Td className="align-top text-right">
                                  <div className="min-h-9 px-3 flex items-center justify-end rounded-md bg-bg-subtle/80 text-sm font-bold font-mono text-text-primary">
                                    {formatStoredQuantity(
                                      item.quantity,
                                      item.unit,
                                    )}
                                  </div>
                                </Td>
                                <Td className="align-top text-center">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      removeItem(safePackageIndex, itemIndex)
                                    }
                                    className="p-1.5 rounded text-text-muted hover:text-error hover:bg-error-subtle transition-colors"
                                    title="Remove this product line"
                                  >
                                    <TrashIcon className="w-4 h-4" />
                                  </button>
                                </Td>
                              </Tr>
                            );
                          })}
                        </Tbody>
                      </TableContainer>
                    )}
                  </div>

                  {/* Active Package Footer */}
                  <div className="px-5 py-2.5 border-t border-border bg-bg-subtle/40 flex items-center justify-between text-xs">
                    <span className="text-text-muted">
                      Package #{activePackage.package_no} Subtotal:{" "}
                      <strong className="text-text-primary">
                        {activePackage.items.length}{" "}
                        {activePackage.items.length === 1
                          ? "product"
                          : "products"}
                      </strong>
                    </span>
                    <span className="font-bold font-mono text-success text-sm">
                      {formatSets(packagePairs(activePackage))}
                    </span>
                  </div>
                </>
              ) : (
                <div className="h-full flex items-center justify-center text-text-muted text-sm">
                  Select a package from the list on the left.
                </div>
              )}
            </main>
          </div>
        </div>
      )}

      {/* ── TAB 2: Costs ─────────────────────────────────────────────── */}
      {activeTab === "costs" && (
        <div className="flex flex-col gap-3 flex-1 min-h-0">
          {/* Only the two figures you cannot read off the table itself. The total is
              already on the tab and again under the table, and the "Add cost" button
              already sits in the table header, so neither needs a card of its own. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border bg-bg-surface p-4 shadow-xs">
              <span className="text-xs font-medium text-text-muted">
                Cost Per Package
              </span>
              <p className="text-xl font-bold font-mono text-text-primary mt-1">
                {formatKyat(costPerPackage)}
              </p>
              <p className="text-[11px] text-text-muted mt-0.5">
                Across {receiving.total_packages} total packages
              </p>
            </div>

            <div className="rounded-xl border border-border bg-bg-surface p-4 shadow-xs">
              <span className="text-xs font-medium text-text-muted">
                Cost / Pair
              </span>
              <p className="text-xl font-bold font-mono text-success mt-1">
                +{formatKyat(costPerPair)}
              </p>
              <p className="text-[11px] text-text-muted mt-0.5">
                Based on {formatSets(counted)} counted
              </p>
            </div>
          </div>

          {/* Costs table */}
          <div className="flex-1 min-h-[440px] border border-border rounded-xl bg-bg-surface overflow-hidden flex flex-col shadow-xs">
            <div className="px-5 py-3 border-b border-border flex items-center justify-between bg-bg-subtle/30">
              <div>
                <h3 className="text-sm font-bold text-text-primary">Costs</h3>
                <p className="text-xs text-text-muted">
                  Record what was spent stage by stage to see the true cost per
                  shoe.
                </p>
              </div>
              <Button
                size="sm"
                variant="primary"
                onClick={addCost}
                className="h-7 text-xs gap-1 shadow-xs"
              >
                <PlusIcon className="w-3.5 h-3.5" />
                Add Cost
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <TableContainer className="rounded-lg border border-border">
                <Thead>
                  <Tr>
                    <Th className="min-w-[11rem]">Stage / Location</Th>
                    <Th className="w-32">Date</Th>
                    <Th className="min-w-[11rem]">Paid To</Th>
                    <Th className="min-w-[10rem]">Fee Type</Th>
                    <Th className="w-48 text-right">Amount</Th>
                    <Th className="min-w-[12rem]">Note</Th>
                    <Th className="w-10" aria-label="Remove" />
                  </Tr>
                </Thead>
                <Tbody>
                  {receiving.costs.map((cost, index) => (
                    <Tr key={cost.cost_id}>
                      <Td>
                        <SuggestInput
                          label={`Where cost ${index + 1} was spent`}
                          placeholder="e.g. Mawlamyine Cargo"
                          suggestions={stages}
                          value={cost.stage}
                          onChange={(next) => setCost(index, { stage: next })}
                          bare
                        />
                      </Td>
                      <Td>
                        <CellInput
                          label={`Date of cost ${index + 1}`}
                          placeholder="YYYY-MM-DD"
                          type="date"
                          value={cost.cost_date}
                          onChange={(cost_date) =>
                            setCost(index, { cost_date })
                          }
                          className="font-mono text-xs"
                        />
                      </Td>
                      <Td>
                        <SuggestInput
                          label={`Who was paid for cost ${index + 1}`}
                          placeholder="Carrier/Driver/Porter"
                          suggestions={carriers}
                          value={cost.carrier}
                          onChange={(next) => setCost(index, { carrier: next })}
                          bare
                        />
                      </Td>
                      <Td>
                        <SuggestInput
                          label={`What cost ${index + 1} was for`}
                          placeholder="Fee type"
                          suggestions={COST_KINDS}
                          value={cost.kind}
                          onChange={(next) => setCost(index, { kind: next })}
                          bare
                        />
                      </Td>
                      {/* Currency sits inside the amount cell rather than in a column
                          of its own — it is part of writing the amount, and almost
                          every line is in Kyat anyway. */}
                      <Td className="text-right">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            <CurrencySelect
                              label={`Currency ${index + 1}`}
                              value={
                                (cost.currency_code as CurrencyCode) ||
                                DEFAULT_CURRENCY
                              }
                              onChange={(code) => setCostCurrency(index, code)}
                              className="shrink-0 text-xs px-1"
                            />
                            {cost.currency_code &&
                            isForeignCurrency(cost.currency_code) ? (
                              <CellInput
                                label={`Original amount ${index + 1}`}
                                placeholder="Original"
                                className="flex-1 text-right font-mono"
                                value={String(cost.original_amount ?? "")}
                                onChange={(next) =>
                                  setCostOriginalAmount(
                                    index,
                                    Number(next) || 0,
                                  )
                                }
                              />
                            ) : (
                              <CellInput
                                label={`Amount ${index + 1}`}
                                placeholder="0"
                                numeric
                                className="flex-1 text-right font-mono font-semibold"
                                value={String(cost.amount || "")}
                                onChange={(next) =>
                                  setCost(index, { amount: Number(next) || 0 })
                                }
                              />
                            )}
                          </div>

                          {cost.currency_code &&
                            isForeignCurrency(cost.currency_code) && (
                              <>
                                <CellInput
                                  label={`Exchange rate ${index + 1}`}
                                  placeholder="Rate"
                                  className="text-right font-mono text-xs"
                                  value={String(cost.exchange_rate ?? "")}
                                  onChange={(next) =>
                                    setCostExchangeRate(
                                      index,
                                      Number(next) || 0,
                                    )
                                  }
                                />
                                <span className="text-xs font-bold font-mono text-brand tabular-nums">
                                  = {formatKyat(cost.amount)}
                                </span>
                              </>
                            )}
                        </div>
                      </Td>
                      <Td>
                        <CellInput
                          label={`Note on cost ${index + 1}`}
                          placeholder="Take a note..."
                          value={cost.note}
                          onChange={(next) => setCost(index, { note: next })}
                        />
                      </Td>
                      <Td className="text-center">
                        <button
                          type="button"
                          onClick={() => removeCost(index)}
                          className="p-1.5 rounded text-text-muted hover:text-error hover:bg-error-subtle transition-colors"
                          title="Remove cost line"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </Td>
                    </Tr>
                  ))}

                  {receiving.costs.length === 0 && (
                    <Tr>
                      <Td
                        colSpan={7}
                        className="text-center py-8 text-text-muted text-xs"
                      >
                        No expenses logged for this arrival yet. Click "Add
                        Cost" above.
                      </Td>
                    </Tr>
                  )}
                </Tbody>
              </TableContainer>
            </div>

            <div className="px-5 py-3 border-t border-border bg-bg-subtle/50 flex items-center justify-between text-sm">
              <span className="font-semibold text-text-secondary">
                Total Cost ({receiving.costs.length} lines)
              </span>
              <span className="font-bold font-mono text-brand text-base">
                {formatKyat(totalCostAmount)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The check the whole page exists for: what was counted against what the supplier's
 *  voucher says is coming, and whether every package the shipment sent is actually
 *  here. Quiet about the *quantity* while the counting is still going on — a shortfall
 *  halfway through only means the rest of the packages are still shut — but never
 *  quiet about a whole package being absent, which is true regardless of how far the
 *  counting has got. */
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
  /** Packages added so far. */
  total: number;
  /** Packages on the shipment, when known. */
  expectedPackages: number | undefined;
  unit: Unit;
}): React.JSX.Element {
  const difference = counted - expected;
  // Packages the shipment says went out that this receiving has no record of at all.
  // Every package added so far being open still doesn't make the count final while
  // some of them have not turned up yet.
  const packagesMissing =
    expectedPackages === undefined ? 0 : Math.max(0, expectedPackages - total);
  const allOpened = opened === total && total > 0 && packagesMissing === 0;

  if (allOpened) {
    if (difference === 0) {
      return (
        <div className="flex items-center gap-2 bg-success-subtle px-5 py-2.5 text-sm text-success">
          <CheckIcon className="w-4 h-4 shrink-0" />
          <span>
            All {formatQty(total)} packages received, and the{" "}
            {formatIn(counted, unit)} match the voucher.
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-start gap-2 bg-error-subtle px-5 py-2.5 text-sm text-error">
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

  // Packages still to come is said in every state, but how loudly depends on what it
  // means. One shipment's packages do not always travel together, so most of the time
  // this is simply a delivery still in progress and gets a plain, quiet note.
  if (packagesMissing > 0) {
    const one = packagesMissing === 1;
    const headline = `${formatQty(packagesMissing)} of the ${formatQty(
      expectedPackages ?? 0,
    )} packages sent ${one ? "is" : "are"} still to come.`;

    // The exception worth an amber warning: the voucher's entire quantity has already
    // been counted out of fewer packages than were sent. Goods cannot all be here
    // while a package is still on the road, so something was almost certainly
    // recorded twice.
    if (difference >= 0) {
      return (
        <div className="flex items-start gap-2 bg-warning-subtle px-5 py-2.5 text-sm text-warning">
          <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            <strong className="font-semibold">{headline}</strong> Even so,
            everything the voucher lists has already been counted out of the{" "}
            {formatQty(total)} that did arrive. Check whether the same products
            were counted twice before completing receiving.
          </span>
        </div>
      );
    }

    return (
      <div className="flex items-start gap-2 bg-bg-subtle px-5 py-2.5 text-sm text-text-secondary">
        <TruckIcon className="w-4 h-4 shrink-0 mt-0.5 text-text-muted" />
        <span>
          <strong className="font-semibold text-text-primary">
            {headline}
          </strong>{" "}
          Packages from one shipment do not always arrive together. Add{" "}
          {one ? "it" : "them"} when {one ? "it turns up" : "they turn up"}.
        </span>
      </div>
    );
  }

  // Every package sent is here, but some are still shut. Falling short on quantity now
  // is just the normal in-progress state — more could still be inside one nobody has
  // opened, so it says nothing. Already matching or exceeding the voucher's total this
  // early is not normal: it means everything the voucher named has been counted out of
  // too few packages, usually because the same products got logged twice.
  if (opened > 0 && difference >= 0) {
    const unopenedAdded = total - opened;
    const headline =
      difference > 0
        ? `Received ${formatIn(difference, unit)} more than the voucher.`
        : "Received quantity matches the voucher.";
    return (
      <div className="flex items-start gap-2 bg-warning-subtle px-5 py-2.5 text-sm text-warning">
        <WarningIcon className="w-4 h-4 shrink-0 mt-0.5" />
        <span>
          <strong className="font-semibold">{headline}</strong>{" "}
          {formatQty(unopenedAdded)} of the packages{" "}
          {unopenedAdded === 1 ? "is" : "are"} still unopened. Check{" "}
          {unopenedAdded === 1 ? "it" : "them"} before completing receiving.
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
    <Switch
      checked={opened}
      onChange={onToggle}
      disabled={disabled}
      label={opened ? "Opened" : "Not opened"}
      size="sm"
    />
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
    setValue("sets", String(picked.total_quantity_pairs), {
      shouldDirty: true,
    });
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
                cost_date: values.received_on,
                stage: shipment.carrier_name,
                carrier: shipment.carrier_name,
                kind: "Cargo fee",
                amount: Number(values.cost),
                note: "",
              },
            ]
          : [],
      // An empty field means "whatever the shipment says", and that figure carries the
      // shipment's unit, not the one left sitting in the form.
      total_quantity_pairs:
        Number(values.sets) || shipment.total_quantity_pairs,
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
                    value={field.value}
                    unit={setsUnit}
                    onChange={field.onChange}
                    error={errors.sets?.message}
                    hint={
                      shipment
                        ? `${formatIn(toPairs(shipment.total_quantity_pairs, shipment.total_unit), shipment.total_unit)} on the voucher.`
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
                label="Total quantity"
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
