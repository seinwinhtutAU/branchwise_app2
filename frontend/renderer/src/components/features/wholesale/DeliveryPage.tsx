import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { type Session } from "@renderer/lib/auth";
import { useCachedFetch } from "@renderer/lib/useCachedFetch";
import { useToast } from "@renderer/lib/useToast";
import {
  CountField,
  EDITABLE,
  FigureCard,
  MenuItem,
  PAGE_SIZE,
  Panel,
  QuantityField,
  QuantityInput,
  JourneyArrow,
  JourneyFace,
  JourneySoft,
  ReadOnlyField,
  Required,
  Reference,
  ReviewFact,
  RowProgress,
  SOFT_BLUE,
  SOFT_RED,
  SectionLabel,
  StepBar,
  SuggestInput,
  type JourneyStage,
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
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EyeIcon,
  MoreVerticalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  TruckIcon,
} from "@renderer/components/ui/icons";
import {
  arrivedPct,
  cargoRemaining,
  CARRIER_NAMES,
  RECEIVING_GATES,
  normaliseFlow,
  finalRemaining,
  intoFinal,
  legRemaining,
  maxForLeg,
  shipmentPairs,
  shipmentStatus,
  SHIPMENT_STATUSES,
  DESTINATION_NAMES,
  type Shipment,
  type ShipmentLeg,
  type ShipmentStatus,
} from "@renderer/components/features/wholesale/shipments";
import { DeliveryJourney } from "@renderer/components/features/wholesale/journey";
import { CARGO_NAMES } from "@renderer/components/features/wholesale/supplierVouchers";
import {
  formatDate,
  formatQty,
  onlyDigits,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import {
  hydrateShipments,
  useWholesale,
} from "@renderer/components/features/wholesale/store";
import {
  SHIPMENTS_URL,
  WholesaleApiError,
  createShipment as apiCreateShipment,
  deleteShipment as apiDeleteShipment,
  shipmentsFromWire,
  updateShipment as apiUpdateShipment,
  type NewShipmentInput,
  type ShipmentWire,
} from "@renderer/components/features/wholesale/api";
import {
  PAIRS_PER,
  formatIn,
  toPairs,
  type Unit,
} from "@renderer/components/features/wholesale/units";

// The wholesale Delivery screen — where a supplier voucher's packages are while they are
// on the road. Same shape as the other two wholesale screens (figure cards, one panel
// holding header, filters, table and pagination; a detail sheet; a three-step wizard),
// with one difference: this detail sheet is the one you type into. Packages move a stop
// at a time, and this is where that gets written down.
//
// Backed by /api/wholesale/shipments (see wholesale/api.ts). An edit is applied to the
// screen at once and sent to the server after a short pause, rather than on every
// keystroke; the flow figures (packages_sent_by_cargo, each leg, final_received_packages)
// are re-settled both here (for instant feedback) and on the server (which is
// authoritative — see app/services/wholesale/shipments.py::normalise_flow).

type View = "list" | "detail" | "new";
type StatusFilter = ShipmentStatus | "all";

const STATUS_LABELS: Record<ShipmentStatus, string> = {
  waiting_at_cargo: "Waiting at cargo",
  in_transit: "On the way",
  partly_delivered: "Partly delivered",
  completed: "All delivered",
};

// Filled, not tinted — the same treatment the order and voucher badges use.
const STATUS_STYLES: Record<ShipmentStatus, string> = {
  waiting_at_cargo: "bg-text-secondary text-bg-base",
  in_transit: "bg-brand text-white",
  partly_delivered: "bg-warning text-white",
  completed: "bg-success text-white",
};

function StatusBadge({
  status,
}: {
  status: ShipmentStatus;
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

export default function DeliveryPage({
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
  } = useCachedFetch<ShipmentWire[]>(SHIPMENTS_URL, session, "shipments");
  const shipments = useMemo(
    () => (wire ? shipmentsFromWire(wire) : []),
    [wire],
  );

  // Every screen that has not moved off the shared store yet (Supplier Vouchers,
  // Receiving) keeps reading real shipments the moment this page has fetched them,
  // rather than each fetching the same list a second time.
  useEffect(() => {
    if (wire) hydrateShipments(shipmentsFromWire(wire));
  }, [wire]);

  const [view, setView] = useState<View>("list");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function reportSaveFailure(error: unknown, fallback: string): void {
    showToast(
      "error",
      error instanceof WholesaleApiError ? error.message : fallback,
    );
  }

  async function persistShipment(shipment: Shipment): Promise<void> {
    try {
      await apiUpdateShipment(session, shipment.shipment_id, shipment);
      reload();
      showToast("success", "Shipment saved.");
    } catch (error) {
      reportSaveFailure(error, "Could not save the shipment.");
    }
  }

  function deleteShipment(shipmentId: string): void {
    apiDeleteShipment(session, shipmentId)
      .then(() => {
        setSelectedId((current) => (current === shipmentId ? null : current));
        setView("list");
      })
      .catch((error) => reportSaveFailure(error, "Could not delete the shipment."));
  }

  function addShipment(input: NewShipmentInput): void {
    apiCreateShipment(session, input)
      .then((created) => {
        setSelectedId(created.shipment_id);
        setView("detail");
      })
      .catch((error) => reportSaveFailure(error, "Could not create the shipment."));
  }

  const selected =
    shipments.find((shipment) => shipment.shipment_id === selectedId) ?? null;

  if (failed && shipments.length === 0) {
    return (
      <EmptyState
        icon={<TruckIcon />}
        title="Could not load shipments"
        description="Check the connection and try again."
        action={
          <Button onClick={reload} loading={isRefreshing}>
            Try again
          </Button>
        }
      />
    );
  }

  if (view === "new") {
    return <NewShipmentForm onCancel={() => setView("list")} onCreate={addShipment} />;
  }

  if (view === "detail" && selected) {
    return (
      <ShipmentDetail
        shipment={selected}
        onBack={() => setView("list")}
        onSave={persistShipment}
        onDelete={() => deleteShipment(selected.shipment_id)}
      />
    );
  }

  return (
    <ShipmentList
      shipments={shipments}
      onOpen={(shipmentId) => {
        setSelectedId(shipmentId);
        setView("detail");
      }}
      onDelete={deleteShipment}
      onNew={() => setView("new")}
      onRefresh={reload}
      refreshing={isRefreshing}
    />
  );
}

// ── List ─────────────────────────────────────────────────────────────────────

function ShipmentList({
  shipments,
  onOpen,
  onDelete,
  onNew,
  onRefresh,
  refreshing,
}: {
  shipments: Shipment[];
  onOpen: (shipmentId: string) => void;
  onDelete: (shipmentId: string) => void;
  onNew: () => void;
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const countBy = (status: ShipmentStatus): number =>
    shipments.filter((shipment) => shipmentStatus(shipment) === status).length;

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return shipments.filter((shipment) => {
      const matchesQuery =
        query === "" ||
        shipment.shipment_no.toLowerCase().includes(query) ||
        shipment.voucher_no.toLowerCase().includes(query) ||
        shipment.supplier_name.toLowerCase().includes(query) ||
        shipment.cargo_name.toLowerCase().includes(query) ||
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
          label="Total shipments"
          value={formatQty(shipments.length)}
          sub="shipments"
        />
        <FigureCard
          label="All delivered"
          value={formatQty(countBy("completed"))}
          sub="shipments"
          tone="success"
        />
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
              Delivery
            </h2>
            <p className="text-sm text-text-muted mt-0.5">
              Manage all shipments.
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
          <div className="w-full sm:w-80">
            <Input
              aria-label="Search shipments"
              placeholder="Search shipment no., voucher, supplier, cargo or destination"
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
                  <Th className="whitespace-nowrap">Supplier / Factory</Th>
                  <Th>Cargo</Th>
                  <Th className="whitespace-nowrap">Sent on</Th>
                  <Th className="text-right whitespace-nowrap">
                    Total packages
                  </Th>
                  <Th className="text-right whitespace-nowrap">
                    Final received
                  </Th>
                  <Th className="w-44 whitespace-nowrap">Delivery progress</Th>
                  <Th>Status</Th>
                  <Th className="w-12" aria-label="Actions" />
                </Tr>
              </Thead>
              <Tbody>
                {visible.map((shipment) => (
                  <Tr key={shipment.shipment_id}>
                    <Td className="whitespace-nowrap">
                      <Reference
                        value={shipment.shipment_no}
                        what="shipment no."
                        onClick={() => onOpen(shipment.shipment_id)}
                      />
                    </Td>
                    <Td className="text-text-secondary">
                      <Reference
                        value={shipment.voucher_no}
                        what="voucher no."
                      />
                    </Td>
                    <Td className="font-medium whitespace-nowrap">
                      {shipment.supplier_name}
                    </Td>
                    <Td className="text-text-secondary whitespace-nowrap">
                      {shipment.cargo_name}
                    </Td>
                    <Td className="text-text-muted whitespace-nowrap">
                      {formatDate(shipment.sent_date)}
                    </Td>
                    <Td className="text-right tabular-nums font-medium">
                      {formatQty(shipment.total_packages)}
                    </Td>
                    <Td className="text-right tabular-nums font-medium text-success">
                      {formatQty(shipment.final_received_packages)}
                    </Td>
                    <Td>
                      <RowProgress pct={arrivedPct(shipment)} />
                    </Td>
                    <Td>
                      <StatusBadge status={shipmentStatus(shipment)} />
                    </Td>
                    <Td className="text-center">
                      <RowMenu
                        onOpen={() => onOpen(shipment.shipment_id)}
                        onDelete={() => onDelete(shipment.shipment_id)}
                      />
                    </Td>
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
    </div>
  );
}

/** A row's own actions. Deleting asks a second time inside the menu, since there is no
 *  undo behind it. */
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
        aria-label="Shipment actions"
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
                Delete this shipment?
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
                label="View & edit"
                onClick={() => {
                  setOpen(false);
                  onOpen();
                }}
              />
              <MenuItem
                icon={<TrashIcon className="w-4 h-4" />}
                label="Delete shipment"
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

function ShipmentDetail({
  shipment: serverShipment,
  onBack,
  onSave,
  onDelete,
}: {
  shipment: Shipment;
  onBack: () => void;
  onSave: (shipment: Shipment) => Promise<void>;
  onDelete: () => void;
}): React.JSX.Element {
  // Edits stay in this local draft until the user explicitly presses Save changes.
  const [draft, setDraft] = useState(serverShipment);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft(serverShipment);
  }, [serverShipment]);
  const shipment = draft;

  const pct = arrivedPct(shipment);
  const heading = intoFinal(shipment);
  // Which gap in the tracking table a new destination is going into. Null while nothing
  // is being added, so the strip below the table only appears once a place is chosen.
  const [insertAt, setInsertAt] = useState<number | null>(null);
  // Which destination is being renamed, and whether the delete button has been armed.
  const [editingLeg, setEditingLeg] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function saveChanges(): Promise<void> {
    setSaving(true);
    try {
      await onSave(shipment);
    } finally {
      setSaving(false);
    }
  }

  /** The one way anything on this shipment changes: settle the route and stage it locally. */
  function apply(patch: Partial<Shipment>): void {
    const settled = normaliseFlow({ ...shipment, ...patch });
    const merged = {
      ...patch,
      legs: settled.legs,
      packages_sent_by_cargo: settled.packages_sent_by_cargo,
      final_received_packages: settled.final_received_packages,
    };
    setDraft((current) => ({ ...current, ...merged }));
  }

  function setLeg(index: number, patch: Partial<ShipmentLeg>): void {
    apply({
      legs: shipment.legs.map((leg, position) =>
        position === index ? { ...leg, ...patch } : leg,
      ),
    });
  }

  function applyLegs(legs: ShipmentLeg[]): void {
    apply({ legs });
  }

  function addLeg(stopName: string, carrierName: string, at: number): void {
    const next = [...shipment.legs];
    next.splice(at, 0, {
      leg_id: `sl-${Date.now()}`,
      leg_order: at + 1,
      stop_name: stopName,
      carrier_name: carrierName || "—",
      packages_received: 0,
      packages_sent: 0,
    });
    applyLegs(next);
  }

  function removeLeg(index: number): void {
    applyLegs(shipment.legs.filter((_, position) => position !== index));
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeftIcon className="w-4 h-4" />
          Back to delivery
        </Button>
      </div>

      <Panel>
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight">
            Shipment details
          </h2>
          <div className="flex items-center gap-2">
            <StatusBadge status={shipmentStatus(shipment)} />
            <Button
              size="sm"
              onClick={() => void saveChanges()}
              loading={saving}
            >
              <CheckIcon className="w-4 h-4" />
              Save changes
            </Button>
            {/* Two presses rather than one, since there is no undo behind it. */}
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
                Delete shipment
              </Button>
            )}
          </div>
        </div>

        <div className="px-6 py-6 flex flex-col gap-8">
          <section>
            <SectionLabel>Shipment information</SectionLabel>
            {/* The three facts that came from the voucher stay as they are; everything a
                shipment can genuinely change about itself is typed straight in. */}
            <dl className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <ReadOnlyField
                label="Shipment no."
                value={shipment.shipment_no}
                copyable
              />
              <ReadOnlyField
                label="Voucher no."
                value={shipment.voucher_no}
                copyable
              />
              <ReadOnlyField
                label="Supplier / Factory"
                value={shipment.supplier_name}
              />
            </dl>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 mt-4">
              <SuggestInput
                label="Cargo"
                placeholder="Shwe Moe Cargo"
                suggestions={CARGO_NAMES}
                value={shipment.cargo_name}
                onChange={(next) => apply({ cargo_name: next })}
              />
              <SuggestInput
                label="Receiving gate"
                placeholder="Bogyoke Rd, Mawlamyine"
                suggestions={RECEIVING_GATES}
                value={shipment.final_location}
                onChange={(next) => apply({ final_location: next })}
              />
              <Input
                label="Sent on"
                type="date"
                className={EDITABLE}
                value={shipment.sent_date}
                onChange={(event) => apply({ sent_date: event.target.value })}
              />
              {/* Packages is a plain count; Quantity carries its unit picker too, so it
                  takes the larger share of the pair. */}
              <div className="grid grid-cols-5 gap-3">
                <div className="col-span-2">
                  <CountField
                    label="Packages"
                    value={shipment.total_packages}
                    onChange={(next) => apply({ total_packages: next })}
                  />
                </div>
                <div className="col-span-3">
                  <QuantityField
                    label="Quantity"
                    unitLabel="Unit the goods are counted in"
                    value={shipment.total_qty}
                    unit={shipment.total_unit}
                    hint={formatIn(shipmentPairs(shipment), "pair")}
                    onChange={(next) => apply({ total_qty: next })}
                    onUnitChange={(total_unit) => apply({ total_unit })}
                  />
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionLabel>Delivery journey</SectionLabel>
            <DeliveryJourney shipment={shipment} />
          </section>

          <section>
            <SectionLabel>Package tracking</SectionLabel>
            <TableContainer>
              <thead>
                <Tr>
                  <Th
                    style={{ backgroundColor: JourneyFace("supplier") }}
                    className="text-white text-center"
                    colSpan={3}
                  >
                    Supplier
                  </Th>
                  <ArrowHead />
                  <Th
                    style={{ backgroundColor: JourneyFace("cargo") }}
                    className="text-white text-center"
                    colSpan={2}
                  >
                    {shipment.cargo_name}
                  </Th>
                  {shipment.legs.map((leg, index) => (
                    <Fragment key={leg.leg_id}>
                      <ArrowHead
                        insertLabel={`Add a destination before ${leg.stop_name}`}
                        onInsert={() => setInsertAt(index)}
                      />
                      <Th
                        style={{ backgroundColor: JourneyFace("stop") }}
                        className="text-white text-center"
                        colSpan={3}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {leg.stop_name}
                          <button
                            type="button"
                            aria-label={`Rename ${leg.stop_name}`}
                            title={`Edit ${leg.stop_name}`}
                            onClick={() => {
                              setEditingLeg(index);
                              setInsertAt(null);
                            }}
                            className={cn(
                              "flex items-center justify-center w-5 h-5 rounded-full shrink-0",
                              "bg-white/25 text-white",
                              "transition-colors duration-150",
                              "hover:bg-white/40",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                            )}
                          >
                            <PencilIcon className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={`Remove ${leg.stop_name}`}
                            title={`Remove ${leg.stop_name}`}
                            onClick={() => removeLeg(index)}
                            className={cn(
                              // Always a visible disc, not a faint glyph on a coloured
                              // band — it was easy to miss. Turning red on hover says
                              // what pressing it does before it is pressed.
                              "flex items-center justify-center w-5 h-5 rounded-full shrink-0",
                              "bg-white/25 text-white",
                              "transition-colors duration-150",
                              "hover:bg-error hover:text-white",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                            )}
                          >
                            <CloseIcon className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      </Th>
                    </Fragment>
                  ))}
                  <ArrowHead
                    insertLabel="Add a destination before Final received"
                    onInsert={() => setInsertAt(shipment.legs.length)}
                  />
                  <Th
                    style={{ backgroundColor: JourneyFace("final") }}
                    className="text-white text-center"
                    colSpan={2}
                  >
                    <span className="block">Final received</span>
                    <span className="block text-[10px] font-normal normal-case text-white/70">
                      {shipment.final_location}
                    </span>
                  </Th>
                </Tr>
                <Tr>
                  <Th className="text-center">Name</Th>
                  <Th className="text-center">Packages</Th>
                  <Th className="text-center">Quantity</Th>
                  <ArrowCell />
                  <Th className="text-center">Sent</Th>
                  <Th className="text-center">Remaining</Th>
                  {shipment.legs.map((leg) => (
                    <Fragment key={`${leg.leg_id}-sub`}>
                      <ArrowCell />
                      <Th className="text-center">Received</Th>
                      <Th className="text-center">Sent</Th>
                      <Th className="text-center">Remaining</Th>
                    </Fragment>
                  ))}
                  <ArrowCell />
                  <Th className="text-center">Received</Th>
                  <Th className="text-center">Remaining</Th>
                </Tr>
              </thead>
              <Tbody>
                <Tr className="hover:bg-transparent">
                  <Td className="bg-bg-subtle font-medium whitespace-nowrap">
                    {shipment.supplier_name}
                  </Td>
                  <Td className="bg-bg-subtle text-center">
                    <BigCount value={shipment.total_packages} />
                  </Td>
                  <Td className="bg-bg-subtle text-center">
                    <BigCount value={shipmentPairs(shipment)} />
                  </Td>
                  <ArrowCell body />
                  <Td className="text-center">
                    <PackageInput
                      label={`Packages sent by ${shipment.cargo_name}`}
                      value={shipment.packages_sent_by_cargo}
                      max={shipment.total_packages}
                      onChange={(next) =>
                        apply({ packages_sent_by_cargo: next })
                      }
                    />
                  </Td>
                  <Td className="text-center">
                    <LeftOver
                      value={cargoRemaining(shipment)}
                      started={shipment.packages_sent_by_cargo > 0}
                    />
                  </Td>
                  {shipment.legs.map((leg, index) => (
                    <Fragment key={`${leg.leg_id}-cells`}>
                      <ArrowCell body />
                      <Td className="text-center">
                        <PackageInput
                          label={`Packages received at ${leg.stop_name}`}
                          value={leg.packages_received}
                          max={maxForLeg(shipment, index)}
                          onChange={(next) =>
                            setLeg(index, {
                              packages_received: next,
                              packages_sent: Math.min(leg.packages_sent, next),
                            })
                          }
                        />
                      </Td>
                      <Td className="text-center">
                        <PackageInput
                          label={`Packages sent on from ${leg.stop_name}`}
                          value={leg.packages_sent}
                          max={leg.packages_received}
                          onChange={(next) =>
                            setLeg(index, { packages_sent: next })
                          }
                        />
                      </Td>
                      <Td className="text-center">
                        <LeftOver
                          value={legRemaining(shipment, index)}
                          started={maxForLeg(shipment, index) > 0}
                        />
                      </Td>
                    </Fragment>
                  ))}
                  <ArrowCell body />
                  <Td className="text-center">
                    <PackageInput
                      label="Packages finally received"
                      value={shipment.final_received_packages}
                      max={heading}
                      onChange={(next) =>
                        apply({ final_received_packages: next })
                      }
                    />
                  </Td>
                  <Td className="text-center">
                    <LeftOver
                      value={finalRemaining(shipment)}
                      started={shipment.final_received_packages > 0}
                    />
                  </Td>
                </Tr>
              </Tbody>
            </TableContainer>
            {editingLeg !== null && shipment.legs[editingLeg] ? (
              <DestinationForm
                title={`Edit ${shipment.legs[editingLeg].stop_name}`}
                initialName={shipment.legs[editingLeg].stop_name}
                initialCarrier={shipment.legs[editingLeg].carrier_name}
                submitLabel="Save"
                onSubmit={(stopName, carrierName) => {
                  setLeg(editingLeg, {
                    stop_name: stopName,
                    carrier_name: carrierName || "—",
                  });
                  setEditingLeg(null);
                }}
                onCancel={() => setEditingLeg(null)}
              />
            ) : insertAt === null ? (
              <div className="mt-3">
                <Button
                  variant="secondary"
                  className={SOFT_BLUE}
                  onClick={() => {
                    setInsertAt(shipment.legs.length);
                    setEditingLeg(null);
                  }}
                >
                  <PlusIcon className="w-4 h-4" />
                  Add destination
                </Button>
              </div>
            ) : (
              <DestinationForm
                title={`New destination, straight after ${
                  insertAt === 0
                    ? shipment.cargo_name
                    : (shipment.legs[insertAt - 1]?.stop_name ??
                      shipment.cargo_name)
                }`}
                submitLabel="Add destination"
                onSubmit={(stopName, carrierName) => {
                  addLeg(stopName, carrierName, insertAt);
                  setInsertAt(null);
                }}
                onCancel={() => setInsertAt(null)}
              />
            )}
          </section>

          <section>
            <SectionLabel>Delivery progress</SectionLabel>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="font-medium text-text-secondary">
                Delivery progress
              </span>
              <span className="tabular-nums font-semibold text-text-primary">
                {formatQty(shipment.final_received_packages)} /{" "}
                {formatQty(shipment.total_packages)} packages ({pct}%)
              </span>
            </div>
            <div
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Delivery progress"
              className="h-2 rounded-full bg-bg-raised overflow-hidden"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
                  pct === 100 ? "bg-success" : "bg-brand",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </section>
        </div>
      </Panel>
    </div>
  );
}

/** The strip under the tracking table, used both for adding a destination and for
 *  renaming one. Both names can be picked from what has been used before or simply
 *  typed, since a route can go somewhere new. */
function DestinationForm({
  title,
  initialName = "",
  initialCarrier = "",
  submitLabel,
  onSubmit,
  onCancel,
}: {
  title: string;
  initialName?: string;
  initialCarrier?: string;
  submitLabel: string;
  onSubmit: (stopName: string, carrierName: string) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [stopName, setStopName] = useState(initialName);
  const [carrierName, setCarrierName] = useState(
    initialCarrier === "—" ? "" : initialCarrier,
  );

  return (
    <div className="mt-3 border border-brand/40 bg-brand-subtle rounded-lg p-4">
      <p className="text-sm font-medium text-text-primary mb-3">{title}</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-48">
          <SuggestInput
            label={<Required>Destination</Required>}
            placeholder="Yangon"
            suggestions={DESTINATION_NAMES}
            value={stopName}
            onChange={setStopName}
          />
        </div>
        <div className="w-full sm:w-48">
          <SuggestInput
            label="Carrier"
            placeholder="U Hla Myint"
            suggestions={CARRIER_NAMES}
            value={carrierName}
            onChange={setCarrierName}
          />
        </div>
        <Button
          disabled={stopName.trim() === ""}
          onClick={() => onSubmit(stopName.trim(), carrierName.trim())}
        >
          <CheckIcon className="w-4 h-4" />
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A gap between two stages, carrying the direction of travel. Borderless so it reads as
 *  space rather than as another column of the table. */
function ArrowHead({
  insertLabel,
  onInsert,
}: {
  /** Given when a destination can be dropped into this gap. */
  insertLabel?: string;
  onInsert?: () => void;
} = {}): React.JSX.Element {
  if (!onInsert)
    return <th className="w-12 p-0 bg-bg-base border-0" aria-hidden />;
  return (
    <th className="w-12 p-0 bg-bg-base border-0 align-middle">
      <button
        type="button"
        aria-label={insertLabel}
        title={insertLabel}
        onClick={onInsert}
        className={cn(
          // A permanent pale blue disc with a blue border: quiet enough not to shout from
          // a header row, but never invisible — a bare icon in a narrow gap was easy to
          // lose among the numbers.
          "mx-auto flex items-center justify-center w-7 h-7 rounded-full",
          "bg-brand-subtle border border-brand/40 text-brand",
          "transition-colors duration-150",
          "hover:bg-brand hover:border-brand hover:text-white",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        )}
      >
        <PlusIcon className="w-4 h-4" />
      </button>
    </th>
  );
}

function ArrowCell({ body = false }: { body?: boolean }): React.JSX.Element {
  const inner = (
    <div className="flex items-center justify-center text-text-muted">
      <ArrowRightIcon className="w-4 h-4" />
    </div>
  );
  return body ? (
    <td className="w-12 p-0 bg-bg-base border-0">{inner}</td>
  ) : (
    <th className="w-12 p-0 bg-bg-base border-0" aria-hidden>
      {inner}
    </th>
  );
}

/** A figure that cannot be typed into — what the supplier says is in the shipment. */
function BigCount({ value }: { value: number }): React.JSX.Element {
  return (
    <span className="text-lg font-bold tabular-nums text-text-primary">
      {formatQty(value)}
    </span>
  );
}

/** What a stage is still holding. Nothing left reads green — but only once something has
 *  actually been through it. A destination that has received nothing is also holding
 *  nothing, and showing that as a green tick said "finished" about a place the packages
 *  have not even reached yet. Untouched stages stay grey. */
function LeftOver({
  value,
  started,
}: {
  value: number;
  started: boolean;
}): React.JSX.Element {
  const settled = started && value === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center justify-center gap-1 min-w-[3rem] rounded-md px-2 py-1.5 text-sm font-bold tabular-nums",
        !started
          ? "bg-bg-raised text-text-muted"
          : settled
            ? "bg-success-subtle text-success"
            : "bg-error-subtle text-error",
      )}
    >
      {formatQty(value)}
      {settled && <CheckIcon className="w-3.5 h-3.5" />}
    </span>
  );
}

/** A package count typed straight into the table, capped at whatever can physically be
 *  there — a stop cannot receive more than the stop before it sent. */
function PackageInput({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={draft}
      onChange={(event) => {
        const digits = onlyDigits(event.target.value);
        setDraft(digits);
        // An empty box is a figure half-typed, not a zero — leave the stored value alone
        // until something is actually entered.
        if (digits === "") return;
        onChange(Math.min(Number(digits), max));
      }}
      onBlur={() => setDraft(String(value))}
      className={cn(
        "w-20 h-10 rounded-md border border-border text-center px-2 text-base font-bold tabular-nums",
        "text-text-primary",
        EDITABLE,
        "transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent",
        "hover:border-border-strong",
      )}
    />
  );
}

// ── New shipment ─────────────────────────────────────────────────────────────

interface DraftStop {
  stop_name: string;
  carrier_name: string;
}

const EMPTY_STOP: DraftStop = { stop_name: "", carrier_name: "" };

const STEPS = ["Shipment", "Destinations", "Review"] as const;

function NewShipmentForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (input: NewShipmentInput) => void;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [voucherNo, setVoucherNumber] = useState("");
  const [cargoName, setCargoName] = useState("");
  const [finalLocation, setFinalLocation] = useState("");
  const [sentDate, setShippedDate] = useState(todayIso());
  const [totalPackages, setTotalPackages] = useState("");
  const [totalSets, setTotalSets] = useState("");
  const [totalUnit, setTotalUnit] = useState<Unit>("set");
  const [stops, setStops] = useState<DraftStop[]>([{ ...EMPTY_STOP }]);

  const { vouchers } = useWholesale();
  const voucher = vouchers.find((entry) => entry.voucher_no === voucherNo);
  const filledStops = stops.filter((stop) => stop.stop_name.trim() !== "");
  const canLeaveShipment =
    voucher !== undefined &&
    cargoName.trim() !== "" &&
    finalLocation.trim() !== "";

  function updateStop(index: number, patch: Partial<DraftStop>): void {
    setStops((current) =>
      current.map((stop, position) =>
        position === index ? { ...stop, ...patch } : stop,
      ),
    );
  }

  function removeStop(index: number): void {
    setStops((current) =>
      current.length === 1
        ? [{ ...EMPTY_STOP }]
        : current.filter((_, position) => position !== index),
    );
  }

  function submit(): void {
    if (!voucher) return;
    onCreate({
      voucher_no: voucher.voucher_no,
      supplier_name: voucher.supplier_name,
      cargo_name: cargoName.trim(),
      final_location: finalLocation.trim(),
      sent_date: sentDate,
      total_packages: Number(totalPackages) || voucher.total_packages,
      total_qty: Number(totalSets) || 0,
      total_unit: totalUnit,
      // Nothing has moved at the moment a shipment is written down.
      packages_sent_by_cargo: 0,
      final_received_packages: 0,
      legs: filledStops.map((stop, index) => ({
        // Placeholders only — the server assigns the real ids and never reads these.
        leg_id: `sl-draft-${index}`,
        leg_order: index + 1,
        stop_name: stop.stop_name.trim(),
        carrier_name: stop.carrier_name.trim() || "—",
        packages_received: 0,
        packages_sent: 0,
      })),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <ChevronLeftIcon className="w-4 h-4" />
          Back to delivery
        </Button>
      </div>

      <Panel>
        <div className="px-6 py-5 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight mb-5">
            New shipment
          </h2>
          <StepBar steps={STEPS} step={step} />
        </div>

        {step === 0 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <SectionLabel>Step 1 — which voucher is travelling</SectionLabel>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
              <Select
                label={<Required>Supplier voucher</Required>}
                className={EDITABLE}
                value={voucherNo}
                onChange={(event) => {
                  setVoucherNumber(event.target.value);
                  const picked = vouchers.find(
                    (entry) => entry.voucher_no === event.target.value,
                  );
                  setTotalPackages(picked ? String(picked.total_packages) : "");
                  // The voucher already says how many packages and how much is inside
                  // them, so neither is typed again here. Its figure is kept in pairs:
                  // shown in sets when it divides evenly, which is how the goods are
                  // counted, and left in pairs when it does not, so nothing is rounded
                  // into a figure nobody counted.
                  if (!picked) {
                    setTotalSets("");
                    setTotalUnit("set");
                    return;
                  }
                  const wholeSets = picked.total_qty % PAIRS_PER.set === 0;
                  setTotalUnit(wholeSets ? "set" : "pair");
                  setTotalSets(
                    String(
                      wholeSets
                        ? picked.total_qty / PAIRS_PER.set
                        : picked.total_qty,
                    ),
                  );
                }}
              >
                <option value="">Choose…</option>
                {vouchers.map((entry) => (
                  <option key={entry.voucher_id} value={entry.voucher_no}>
                    {entry.voucher_no} — {entry.supplier_name}
                  </option>
                ))}
              </Select>
              <SuggestInput
                label={<Required>Cargo</Required>}
                placeholder="Shwe Moe Cargo"
                suggestions={CARGO_NAMES}
                value={cargoName}
                onChange={setCargoName}
              />
              <SuggestInput
                label={<Required>Receiving gate</Required>}
                placeholder="Bogyoke Rd, Mawlamyine"
                suggestions={RECEIVING_GATES}
                value={finalLocation}
                onChange={setFinalLocation}
              />
              <Input
                label="Sent on"
                type="date"
                className={EDITABLE}
                value={sentDate}
                onChange={(event) => setShippedDate(event.target.value)}
              />
              <Input
                label="Packages"
                type="text"
                inputMode="numeric"
                placeholder="0"
                className={cn(EDITABLE, "text-right")}
                value={totalPackages}
                onChange={(event) =>
                  setTotalPackages(onlyDigits(event.target.value))
                }
                hint={
                  voucher
                    ? `${formatQty(voucher.total_packages)} on the voucher.`
                    : "Pick a voucher and this fills itself in."
                }
              />
              <QuantityInput
                label="Quantity"
                unitLabel="Unit the goods are counted in"
                value={totalSets}
                unit={totalUnit}
                onChange={setTotalSets}
                onUnitChange={setTotalUnit}
                hint={
                  voucher
                    ? `${formatIn(voucher.total_qty, "set")} on the voucher.`
                    : "Pick a voucher and this fills itself in."
                }
              />
            </div>
            <div className="flex justify-end">
              <Button disabled={!canLeaveShipment} onClick={() => setStep(1)}>
                Next: destinations
                <ChevronRightIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <SectionLabel>Step 2 — destinations on the way</SectionLabel>

            <div className="border border-border rounded-lg divide-y divide-border">
              {stops.map((stop, index) => (
                <div
                  key={index}
                  className="grid gap-3 grid-cols-1 md:grid-cols-12 items-start p-3"
                >
                  <span className="md:col-span-1 text-sm font-semibold text-text-muted md:pt-9">
                    {index + 1}
                  </span>
                  <div className="md:col-span-4">
                    <Select
                      label="Destination"
                      className={EDITABLE}
                      value={stop.stop_name}
                      onChange={(event) =>
                        updateStop(index, { stop_name: event.target.value })
                      }
                    >
                      <option value="">Choose…</option>
                      {DESTINATION_NAMES.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="md:col-span-5">
                    <Select
                      label="Carrier"
                      className={EDITABLE}
                      value={stop.carrier_name}
                      onChange={(event) =>
                        updateStop(index, { carrier_name: event.target.value })
                      }
                    >
                      <option value="">Choose…</option>
                      {CARRIER_NAMES.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="md:col-span-2 flex md:justify-end md:pt-7">
                    <Button
                      variant="ghost"
                      size="sm"
                      className={SOFT_RED}
                      aria-label={`Remove destination ${index + 1}`}
                      onClick={() => removeStop(index)}
                    >
                      <TrashIcon className="w-4 h-4" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div>
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() =>
                  setStops((current) => [...current, { ...EMPTY_STOP }])
                }
              >
                <PlusIcon className="w-4 h-4" />
                Add another destination
              </Button>
            </div>

            <div className="flex justify-between">
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() => setStep(0)}
              >
                <ChevronLeftIcon className="w-4 h-4" />
                Back
              </Button>
              <Button onClick={() => setStep(2)}>
                Next: review
                <ChevronRightIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="px-6 py-6 flex flex-col gap-5">
            <SectionLabel>Step 3 — review &amp; confirm</SectionLabel>
            <dl className="grid gap-4 grid-cols-1 sm:grid-cols-4 bg-bg-subtle border border-border rounded-lg p-4">
              <ReviewFact label="Shipment no." value="Assigned when you save" />
              <ReviewFact label="Voucher no." value={voucherNo || "—"} />
              <ReviewFact
                label="Supplier / Factory"
                value={voucher?.supplier_name ?? "—"}
              />
              <ReviewFact label="Cargo" value={cargoName || "—"} />
              <ReviewFact label="Receiving gate" value={finalLocation || "—"} />
              <ReviewFact label="Sent on" value={formatDate(sentDate)} />
              <ReviewFact
                label="Total packages"
                value={formatQty(
                  Number(totalPackages) || voucher?.total_packages || 0,
                )}
              />
              <ReviewFact
                label="Quantity"
                value={formatIn(
                  toPairs(Number(totalSets) || 0, totalUnit),
                  "set",
                )}
              />
            </dl>
            <div>
              <SectionLabel>Delivery journey</SectionLabel>
              <JourneyPreview
                supplierName={voucher?.supplier_name ?? "—"}
                cargoName={cargoName}
                stops={filledStops.map((stop) => ({
                  name: stop.stop_name,
                  carrier: stop.carrier_name,
                }))}
                gate={finalLocation}
              />
            </div>
            <div className="flex justify-between">
              <Button
                variant="secondary"
                className={SOFT_BLUE}
                onClick={() => setStep(1)}
              >
                <ChevronLeftIcon className="w-4 h-4" />
                Back
              </Button>
              <Button onClick={submit}>
                <CheckIcon className="w-4 h-4" />
                Confirm shipment
              </Button>
            </div>
          </div>
        )}
      </Panel>
    </div>
  );
}

/** The route as it will be, drawn the way the shipment's own page draws it: one chip per
 *  stage, in order, so what is being confirmed is the journey rather than a sentence
 *  describing it. */
function JourneyPreview({
  supplierName,
  cargoName,
  stops,
  gate,
}: {
  supplierName: string;
  cargoName: string;
  stops: { name: string; carrier: string }[];
  gate: string;
}): React.JSX.Element {
  const stages: { stage: JourneyStage; name: string; sub: string }[] = [
    { stage: "supplier", name: supplierName, sub: "Supplier" },
    { stage: "cargo", name: cargoName || "—", sub: "Cargo" },
    ...stops.map((stop) => ({
      stage: "stop" as JourneyStage,
      name: stop.name,
      sub: stop.carrier || "Carrier not set",
    })),
    { stage: "final", name: gate || "—", sub: "Receiving gate" },
  ];

  return (
    <ol className="flex items-stretch flex-wrap gap-y-2 overflow-x-auto pb-1">
      {stages.map((entry, index) => (
        <li key={`${entry.name}-${index}`} className="flex items-stretch">
          {/* A column whose body grows: the cards stretch to the tallest one, and without
              this the tint stops where its own text ends and leaves white underneath. */}
          <div className="flex flex-col h-full w-40 shrink-0 rounded-lg border border-border overflow-hidden">
            <div
              style={{ backgroundColor: JourneyFace(entry.stage) }}
              className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white break-words"
            >
              {entry.sub}
            </div>
            <div
              style={{ backgroundColor: JourneySoft(entry.stage) }}
              className="flex-1 px-2.5 py-2 text-sm font-medium text-text-primary break-words leading-snug"
            >
              {entry.name}
            </div>
          </div>
          {index < stages.length - 1 && <JourneyArrow />}
        </li>
      ))}
    </ol>
  );
}
