import { useEffect, useMemo, useRef, useState } from "react";
import { type Session } from "@renderer/lib/auth";
import { useCachedFetch } from "@renderer/lib/useCachedFetch";
import { useToast } from "@renderer/lib/useToast";
import {
  CellInput,
  GroupSelect,
  CountField,
  EDITABLE,
  FigureCard,
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
  CloseIcon,
  ChevronRightIcon,
  EyeIcon,
  MoreVerticalIcon,
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
  colorQtyPairs,
  colorQtyProblem,
  formatDate,
  formatKyat,
  formatQty,
  nextReference,
  onlyDigits,
  parseColorQty,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import {
  fromPairs,
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
// Backed by /api/wholesale/receivings. Detail edits are staged locally until saved.

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

/** Derives the displayed quantity from the colour shorthand. Rows that use one unit
 * stay in that unit; mixed units are represented as pairs so the total stays exact. */
function quantityFromColors(
  text: string,
  fallbackUnit: Unit,
): { qty: number; unit: Unit } {
  if (text.trim() === "") return { qty: 0, unit: fallbackUnit };

  const entries = parseColorQty(text);
  const units = entries.map((entry) => entry.unit ?? fallbackUnit);
  const unit =
    units.length > 0 && units.every((entry) => entry === units[0])
      ? units[0]
      : "pair";

  return {
    qty: fromPairs(colorQtyPairs(text, fallbackUnit), unit),
    unit,
  };
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
}: {
  session: Session;
}): React.JSX.Element {
  const showToast = useToast();
  const {
    data: wire,
    isRefreshing,
    failed,
    reload,
  } = useCachedFetch<ReceivingWire[]>(RECEIVINGS_URL, session, "receivings");
  const {
    data: shipmentWire,
    isRefreshing: shipmentsRefreshing,
    reload: reloadShipments,
  } = useCachedFetch<ShipmentWire[]>(
    SHIPMENTS_URL,
    session,
    "shipments for receivings",
  );
  useEffect(() => {
    if (wire) hydrateReceivings(receivingsFromWire(wire));
  }, [wire]);
  useEffect(() => {
    if (shipmentWire) hydrateShipments(shipmentsFromWire(shipmentWire));
  }, [shipmentWire]);

  function refreshPage(): void {
    reload();
    reloadShipments();
  }

  const { receivings } = useWholesale();
  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected =
    receivings.find((receiving) => receiving.receiving_id === selectedId) ??
    null;

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
        received_date: receiving.received_date,
        total_packages: receiving.total_packages,
        total_qty: receiving.total_qty,
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
  onDelete,
  onNew,
  onRefresh,
  refreshing,
}: {
  receivings: Receiving[];
  onOpen: (receivingId: string) => void;
  onDelete: (receivingId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const packages = receivings.reduce(
    (sum, receiving) => sum + receiving.total_packages,
    0,
  );
  const waiting = receivings.filter(
    (receiving) => receivingStatus(receiving) !== "checked",
  ).length;
  const mismatched = receivings.filter(
    (receiving) => receivingStatus(receiving) === "issue",
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
      const matchesStatus =
        status === "all" || receivingStatus(receiving) === status;
      return matchesQuery && matchesStatus;
    });
  }, [receivings, search, status]);

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
          <div className="w-full sm:w-80">
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
                  <Th className="text-right whitespace-nowrap">Received qty</Th>
                  <Th className="text-right whitespace-nowrap">Total qty</Th>
                  <Th className="text-right">Difference</Th>
                  <Th>Status</Th>
                  <Th className="w-12" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((receiving) => {
                  const difference = pairsDifference(receiving);
                  const allOpened =
                    openedCount(receiving) === receiving.packages.length;
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
                        {formatDate(receiving.received_date)}
                      </Td>
                      <Td className="text-right tabular-nums font-medium text-success">
                        {formatIn(countedPairs(receiving), "set")}
                      </Td>
                      <Td className="text-right tabular-nums text-text-secondary">
                        {formatIn(expectedPairs(receiving), "set")}
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
                        <StatusBadge status={receivingStatus(receiving)} />
                      </Td>
                      <Td className="text-center">
                        <RowMenu
                          onOpen={() => onOpen(receiving.receiving_id)}
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
  onDelete,
}: {
  onOpen: () => void;
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
        <div className="absolute right-0 top-9 z-30 min-w-48 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in">
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
                label="View & receive"
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
        </div>
      )}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function ReceivingDetail({
  receiving: initialReceiving,
  onBack,
  onSave,
  onDelete,
}: {
  receiving: Receiving;
  onBack: () => void;
  onSave: (receiving: Receiving) => Promise<void>;
  onDelete: () => void;
}): React.JSX.Element {
  const [receiving, setReceiving] = useState(initialReceiving);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    setReceiving(initialReceiving);
  }, [initialReceiving]);

  function apply(patch: Partial<Receiving>): void {
    setReceiving((current) => ({ ...current, ...patch }));
  }

  async function saveChanges(): Promise<void> {
    setSaving(true);
    try {
      await onSave(receiving);
    } finally {
      setSaving(false);
    }
  }

  const { shipments } = useWholesale();
  const shipment = shipments.find(
    (entry) => entry.shipment_no === receiving.shipment_no,
  );
  const stages = [
    ...(shipment ? [shipment.cargo_name] : []),
    ...(shipment ? shipment.legs.map((leg) => leg.stop_name) : []),
    receiving.gate,
  ].filter((stage) => stage.trim() !== "");
  const carriers = [
    ...(shipment ? [shipment.cargo_name] : []),
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
      received_date:
        opened && entry.received_date === ""
          ? receiving.received_date
          : entry.received_date,
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
    apply({
      costs: [
        ...receiving.costs,
        emptyCost(receiving.receiving_id, receiving.gate),
      ],
    });
  }

  function removeCost(index: number): void {
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
      color_qty: colorQty,
      qty: quantity.qty,
      unit: quantity.unit,
    });
  }

  // A code we have seen before brings its own description and group with it, so counting
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
            group: known.group,
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
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight">
            Receiving details
          </h2>
          <div className="flex items-center gap-2">
            <StatusBadge status={receivingStatus(receiving)} />
            <Button
              size="sm"
              onClick={() => void saveChanges()}
              loading={saving}
            >
              <CheckIcon className="w-4 h-4" />
              Save changes
            </Button>
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
                variant="ghost"
                size="sm"
                className={SOFT_RED}
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
            <dl className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
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
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-4">
              <SuggestInput
                label="Gate"
                placeholder="Bogyoke Rd, Mawlamyine"
                suggestions={RECEIVING_GATES}
                value={receiving.gate}
                onChange={(next) => apply({ gate: next })}
              />
              <Input
                label="Date"
                type="date"
                className={EDITABLE}
                value={receiving.received_date}
                onChange={(event) =>
                  apply({ received_date: event.target.value })
                }
              />
              <CountField
                label="Total packages"
                value={receiving.total_packages}
                onChange={setPackageCount}
              />
              <QuantityField
                label="Quantity"
                unitLabel="Unit the voucher is written in"
                value={receiving.total_qty}
                unit={receiving.total_unit}
                hint={formatIn(expectedPairs(receiving), "set")}
                onChange={(next) => apply({ total_qty: next })}
                onUnitChange={(total_unit) => apply({ total_unit })}
              />
            </div>
          </section>

          <section>
            <SectionLabel>Costs</SectionLabel>
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
                        onChange={(next) => setCost(index, { carrier: next })}
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
                        <CloseIcon className="w-4 h-4" />
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
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={addCost}
              >
                <PlusIcon className="w-4 h-4" />
                Add a cost
              </Button>
            </div>
          </section>

          <section>
            <SectionLabel>Step 2 — what we received</SectionLabel>
            <CountCheck
              counted={counted}
              expected={expectedPairs(receiving)}
              opened={opened}
              total={receiving.packages.length}
              unit="set"
            />
            {receiving.packages.length === 0 ? (
              <p className="text-sm text-text-muted">
                No packages recorded yet. Put the number of packages above and a
                row appears for each one.
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {receiving.packages.map((entry, index) => (
                  <article
                    key={entry.package_id}
                    className="overflow-hidden rounded-xl border border-border bg-bg-base"
                  >
                    <div className="flex flex-col gap-3 bg-bg-subtle/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-sm font-bold text-brand">
                          {entry.package_no}
                        </span>
                        <div>
                          <h3 className="text-sm font-semibold text-text-primary">
                            Package {entry.package_no}
                          </h3>
                          <p className="text-xs text-text-muted">
                            {entry.opened
                              ? `${formatQty(entry.items.length)} ${entry.items.length === 1 ? "product" : "products"} recorded`
                              : "Open package to record its contents"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 sm:justify-end">
                        <OpenedToggle
                          opened={entry.opened}
                          onToggle={() => toggleOpened(index)}
                        />
                        <div className="min-w-[5rem] text-right">
                          <span className="block text-[0.65rem] font-semibold uppercase tracking-wide text-text-muted">
                            Counted
                          </span>
                          <span className="block text-sm font-bold tabular-nums text-text-primary">
                            {formatIn(packagePairs(entry), "set")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-3 border-t border-border px-4 py-4 sm:grid-cols-2">
                      <Input
                        label={`Date package ${entry.package_no} was received`}
                        type="date"
                        className={EDITABLE}
                        value={entry.received_date}
                        onChange={(event) =>
                          setPackage(index, {
                            received_date: event.target.value,
                          })
                        }
                      />
                      <Input
                        label={`Note on package ${entry.package_no}`}
                        placeholder="Optional note"
                        className={EDITABLE}
                        value={entry.note}
                        onChange={(event) =>
                          setPackage(index, { note: event.target.value })
                        }
                      />
                    </div>

                    {entry.opened && (
                      <div className="border-t border-border px-4 py-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="text-sm font-semibold text-text-primary">
                              Products in package
                            </h4>
                            <p className="text-xs text-text-muted">
                              Enter one stock code per product. The larger
                              fields make counting easier at the gate.
                            </p>
                          </div>
                          <Button
                            variant="secondary"
                            size="sm"
                            className={SOFT_BLUE}
                            onClick={() => addItem(index)}
                          >
                            <PlusIcon className="h-4 w-4" />
                            Add product
                          </Button>
                        </div>

                        <div className="grid gap-3 xl:grid-cols-2">
                          {entry.items.map((item, itemIndex) => (
                            <div
                              key={item.item_id}
                              className="rounded-lg border border-border bg-bg-subtle/50 p-3"
                            >
                              <div className="mb-3 flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                                  Product {itemIndex + 1}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => removeItem(index, itemIndex)}
                                  title="Remove this product"
                                  aria-label={`Remove product ${itemIndex + 1} from package ${entry.package_no}`}
                                  className={cn(
                                    "rounded-md p-1 text-text-muted",
                                    "transition-colors duration-150",
                                    "hover:bg-error-subtle hover:text-error",
                                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error",
                                  )}
                                >
                                  <CloseIcon className="h-4 w-4" />
                                </button>
                              </div>

                              <div className="grid gap-3 sm:grid-cols-2">
                                <SuggestInput
                                  label={`Stock code for product ${itemIndex + 1} in package ${entry.package_no}`}
                                  placeholder="A1001"
                                  suggestions={STOCK_CODES}
                                  value={item.stock_code}
                                  onChange={(next) =>
                                    setStockCode(index, itemIndex, next)
                                  }
                                />
                                <Input
                                  label="Product description"
                                  placeholder="Men's leather sandal"
                                  className={EDITABLE}
                                  value={item.description}
                                  onChange={(event) =>
                                    setItem(index, itemIndex, {
                                      description: event.target.value,
                                    })
                                  }
                                />
                                <div className="flex flex-col gap-1.5">
                                  <label className="text-sm font-medium text-text-secondary">
                                    Group
                                  </label>
                                  <GroupSelect
                                    label={`Group for ${item.stock_code || "this product"} in package ${entry.package_no}`}
                                    value={item.group}
                                    onChange={(group) =>
                                      setItem(index, itemIndex, { group })
                                    }
                                  />
                                </div>
                                <Input
                                  label="Colors and quantities"
                                  placeholder="black10s,pink2p"
                                  className={EDITABLE}
                                  error={
                                    colorQtyProblem(item.color_qty) ?? undefined
                                  }
                                  value={item.color_qty}
                                  onChange={(event) =>
                                    setColorQty(
                                      index,
                                      itemIndex,
                                      event.target.value,
                                    )
                                  }
                                />
                                <QuantityInput
                                  label="Quantity"
                                  unitLabel={`Unit for ${item.stock_code || "this product"} in package ${entry.package_no}`}
                                  hint="Calculated from colors"
                                  readOnly
                                  value={String(item.qty)}
                                  unit={item.unit}
                                  onChange={() => undefined}
                                  onUnitChange={() => undefined}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </article>
                ))}

                <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="font-semibold text-text-primary">
                    Packages opened {formatQty(opened)} /{" "}
                    {formatQty(receiving.packages.length)}
                  </span>
                  <span className="text-sm font-semibold tabular-nums text-success">
                    {formatIn(counted, "set")} /{" "}
                    {formatIn(expectedPairs(receiving), "set")} received
                  </span>
                </div>
              </div>
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
  unit,
}: {
  counted: number;
  expected: number;
  opened: number;
  total: number;
  unit: Unit;
}): React.JSX.Element {
  const difference = counted - expected;
  const allOpened = opened === total && total > 0;

  if (!allOpened) return <></>;

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
        {formatIn(counted, unit)} were received. Open the packages again before
        this goes into stock.
      </span>
    </div>
  );
}

function OpenedToggle({
  opened,
  onToggle,
}: {
  opened: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={opened}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        opened
          ? "bg-success-subtle text-success hover:bg-success-subtle"
          : "bg-bg-raised text-text-muted hover:bg-bg-subtle",
      )}
    >
      {opened && <CheckIcon className="w-3.5 h-3.5" />}
      {opened ? "Opened" : "Not opened"}
    </button>
  );
}

// ── New receiving ──────────────────────────────────────────────────────────────

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
  const [shipmentNo, setShipmentNo] = useState("");
  const [gate, setGate] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayIso());
  const [packages, setPackages] = useState("");
  const [sets, setSets] = useState("");
  const [setsUnit, setSetsUnit] = useState<Unit>("set");
  const [cost, setCost] = useState("");

  const { shipments } = useWholesale();
  const shipment = shipments.find((entry) => entry.shipment_no === shipmentNo);
  const canReview =
    shipment !== undefined && gate.trim() !== "" && Number(packages) > 0;

  function submit(): void {
    if (!shipment) return;
    onCreate({
      shipment_id: shipment.shipment_id,
      gate: gate.trim(),
      received_date: receivedDate,
      total_packages: Number(packages) || 0,
      // Whatever the carrier asked for on the day is simply the first charge; more can
      // be added as the delivery is handled.
      costs:
        Number(cost) > 0
          ? [
              {
                cost_id: "",
                stage: shipment.cargo_name,
                carrier: shipment.cargo_name,
                kind: "Cargo fee",
                amount: Number(cost),
                note: "",
              },
            ]
          : [],
      // An empty box means "whatever the shipment says", and that figure carries the
      // shipment's unit, not the one left sitting in the form.
      total_qty: Number(sets) || shipment.total_qty,
      total_unit: Number(sets) ? setsUnit : shipment.total_unit,
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
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
              <Select
                label={<Required>Shipment</Required>}
                className={EDITABLE}
                value={shipmentNo}
                onChange={(event) => {
                  setShipmentNo(event.target.value);
                  const picked = shipments.find(
                    (entry) => entry.shipment_no === event.target.value,
                  );
                  if (picked) {
                    setGate(picked.final_location);
                    setPackages(
                      String(
                        picked.final_received_packages || picked.total_packages,
                      ),
                    );
                    // The figure and the unit it is written in travel together. Taking
                    // the number alone turned a shipment counted in pairs into the same
                    // number of sets — six times what was really coming.
                    setSets(String(picked.total_qty));
                    setSetsUnit(picked.total_unit);
                  }
                }}
              >
                <option value="">Choose…</option>
                {shipments.map((entry) => (
                  <option key={entry.shipment_id} value={entry.shipment_no}>
                    {entry.shipment_no} — {entry.supplier_name}
                  </option>
                ))}
              </Select>
              <SuggestInput
                label={<Required>Gate</Required>}
                placeholder="Bogyoke Rd, Mawlamyine"
                suggestions={RECEIVING_GATES}
                value={gate}
                onChange={setGate}
              />
              <Input
                label="Date"
                type="date"
                className={EDITABLE}
                value={receivedDate}
                onChange={(event) => setReceivedDate(event.target.value)}
              />
              <Input
                label={<Required>Total packages</Required>}
                type="text"
                inputMode="numeric"
                placeholder="0"
                className={cn(EDITABLE, "text-right")}
                value={packages}
                onChange={(event) =>
                  setPackages(onlyDigits(event.target.value))
                }
                hint={
                  shipment
                    ? `${formatQty(shipment.total_packages)} on the shipment.`
                    : "Pick a shipment and this fills itself in."
                }
              />
              <QuantityInput
                label="Quantity"
                unitLabel="Unit the voucher is written in"
                value={sets}
                unit={setsUnit}
                onChange={setSets}
                onUnitChange={setSetsUnit}
                hint={
                  shipment
                    ? `${formatIn(toPairs(shipment.total_qty, shipment.total_unit), "set")} on the voucher.`
                    : "From the supplier's voucher."
                }
              />
              <Input
                label="Cost"
                type="text"
                inputMode="numeric"
                placeholder="0"
                className={cn(EDITABLE, "text-right")}
                value={cost}
                onChange={(event) => setCost(onlyDigits(event.target.value))}
                hint="More charges can be added later."
              />
            </div>
            <div className="flex justify-end">
              <Button disabled={!canReview} onClick={() => setStep(1)}>
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
                label="Total packages"
                value={formatQty(Number(packages) || 0)}
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
              <Button onClick={submit}>
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
