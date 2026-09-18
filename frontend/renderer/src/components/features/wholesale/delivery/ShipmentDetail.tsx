import { Fragment, useEffect, useRef, useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Tr,
} from "@renderer/components/ui/Table";
import {
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  EDITABLE,
  JourneyFace,
  MismatchIconButton,
  Reference,
  SectionLabel,
  SuggestInput,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  formatQty,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  formatSets,
} from "@renderer/components/features/wholesale/shared/units";
import {
  arrivedPct,
  cargoRemaining,
  finalRemaining,
  intoFinal,
  legRemaining,
  maxForLeg,
  normaliseFlow,
  shipmentPairs,
  shipmentStatus,
  type Shipment,
  type ShipmentLeg,
} from "@renderer/components/features/wholesale/delivery/shipments";
import { DeliveryJourney } from "@renderer/components/features/wholesale/shared/journey";
import {
  CARGO_NAMES,
  CARRIER_NAMES,
  DESTINATION_NAMES,
  RECEIVING_GATES,
} from "@renderer/components/features/wholesale/masterData/masterData";
import { useWholesale } from "@renderer/components/features/wholesale/shared/store";
import {
  type WriteOffReason,
  type WriteOffWire,
} from "@renderer/components/features/wholesale/shared/api";
import { WriteOffModal } from "@renderer/components/features/wholesale/shared/WriteOffModal";
import { SplitShipmentPage } from "@renderer/components/features/wholesale/delivery/SplitShipmentPage";
import {
  ArrowCell,
  ArrowHead,
  BigCount,
  LeftOver,
  PackageInput,
  StatusBadge,
} from "./ShipmentBadges";
import { DestinationForm } from "./DestinationForm";
import {
  isLegFinished,
  shipmentDetailSchema,
  type ShipmentDetailFormValues,
  type ShipmentMismatchTarget,
} from "./types";

export function ShipmentDetail({
  shipment: serverShipment,
  allShipments,
  onOpenShipment,
  writeOffs,
  focus,
  onBack,
  onSave,
  onDelete,
  onWriteOff,
  onSplit,
}: {
  shipment: Shipment;
  allShipments?: Shipment[];
  onOpenShipment?: (shipmentId: string) => void;
  writeOffs: WriteOffWire[];
  focus?: "tracking";
  onBack: () => void;
  onSave: (shipment: Shipment) => Promise<void>;
  onDelete: () => void;
  onWriteOff: (
    shipmentId: string,
    legId: string | undefined,
    quantity: number,
    reason: WriteOffReason,
    note: string,
  ) => Promise<void>;
  onSplit?: (
    packages: number,
    quantity: number | undefined,
    finalDestination: string,
    carrierName: string,
    splitLegOrder: number | undefined,
  ) => Promise<void>;
}): React.JSX.Element {
  const [saving, setSaving] = useState(false);
  const trackingSectionRef = useRef<HTMLElement>(null);
  const [expandedStops, setExpandedStops] = useState<Record<string, boolean>>({});

  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<ShipmentDetailFormValues>({
    resolver: zodResolver(shipmentDetailSchema),
    defaultValues: { shipment: serverShipment },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { replace: replaceLegs } = useFieldArray({
    control,
    name: "shipment.legs",
  });
  const shipment = useWatch({ control, name: "shipment" }) as Shipment;

  useEffect(() => {
    reset({ shipment: serverShipment });
  }, [reset, serverShipment]);

  // Keyboard shortcut: Ctrl+S or Cmd+S to save changes
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (isDirty && !saving) {
          void handleSubmit(saveChanges)();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isDirty, saving, handleSubmit]);

  const [activeTab, setActiveTab] = useState<"shipment" | "split">("shipment");

  useEffect(() => {
    if (focus === "tracking") {
      setActiveTab("shipment");
      trackingSectionRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [focus]);

  const { receivings, vouchers } = useWholesale();
  const voucher = vouchers.find(
    (entry) => entry.voucher_no === shipment.voucher_no,
  );
  const hasReceiving = receivings.some(
    (entry) => entry.shipment_no === shipment.shipment_no,
  );

  const quantityMismatch =
    voucher && shipmentPairs(shipment) !== voucher.total_quantity_pairs
      ? `The voucher says ${formatSets(voucher.total_quantity_pairs)}.`
      : undefined;
  const hasChanges = isDirty;

  const pct = arrivedPct(shipment);
  const heading = intoFinal(shipment);

  const canDelete = serverShipment.allowed_actions
    ? serverShipment.allowed_actions.includes("delete")
    : !hasReceiving;

  const canSplit =
    (serverShipment.allowed_actions
      ? serverShipment.allowed_actions.includes("split")
      : true) &&
    !hasReceiving &&
    (cargoRemaining(shipment) > 0 ||
      shipment.legs.some(
        (leg) =>
          Math.max(
            0,
            leg.packages_received -
              leg.packages_sent -
              (leg.lost_packages ?? 0),
          ) > 0,
      ));

  const parentShipment = shipment.split_from_shipment_id
    ? allShipments?.find((s) => s.shipment_id === shipment.split_from_shipment_id)
    : undefined;
  const childShipments = (allShipments ?? []).filter(
    (s) => s.split_from_shipment_id === shipment.shipment_id,
  );

  function handleTabChange(tab: "shipment" | "split"): void {
    if (tab === activeTab) return;
    if (tab === "split" && !canSplit) return;
    if (hasChanges) {
      const confirmed = window.confirm(
        "You have unsaved changes on this shipment. Switching tabs will discard them. Continue?",
      );
      if (!confirmed) return;
      reset({ shipment: serverShipment });
    }
    setActiveTab(tab);
  }

  function handleOpenShipment(shipmentId: string): void {
    if (hasChanges) {
      const confirmed = window.confirm(
        "You have unsaved changes. Discard them?",
      );
      if (!confirmed) return;
    }
    onOpenShipment?.(shipmentId);
  }

  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [editingLeg, setEditingLeg] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [writeOffTarget, setWriteOffTarget] =
    useState<ShipmentMismatchTarget | null>(null);

  function latestMismatch(subjectId: string): WriteOffWire | undefined {
    return writeOffs.find((entry) => entry.subject_id === subjectId);
  }

  async function saveChanges(values: ShipmentDetailFormValues): Promise<void> {
    setSaving(true);
    try {
      await onSave(values.shipment);
    } finally {
      setSaving(false);
    }
  }

  function apply(patch: Partial<Shipment>): void {
    const settled = normaliseFlow({ ...shipment, ...patch });
    const repackagedByLeg = new Map<string, number>();
    for (const entry of writeOffs) {
      if (
        entry.subject_type === "shipment_leg" &&
        entry.reason === "repackaged" &&
        !repackagedByLeg.has(entry.subject_id)
      ) {
        repackagedByLeg.set(entry.subject_id, entry.quantity);
      }
    }
    const correctedLegs = settled.legs.map((leg) => {
      const corrected = repackagedByLeg.get(leg.leg_id);
      return corrected === undefined
        ? leg
        : { ...leg, packages_received: corrected, packages_sent: corrected };
    });
    const merged = {
      ...patch,
      legs: correctedLegs,
      packages_sent_by_cargo: settled.packages_sent_by_cargo,
      final_received_packages: settled.final_received_packages,
    };
    if (merged.legs) replaceLegs(merged.legs);
    for (const [key, value] of Object.entries(merged)) {
      if (key === "legs") continue;
      setValue(`shipment.${key}` as "shipment.carrier_name", value as never, {
        shouldDirty: true,
        shouldValidate: true,
      });
    }
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

  function handleBack(): void {
    if (hasChanges) {
      const confirmed = window.confirm(
        "You have unsaved changes. Discard them?",
      );
      if (!confirmed) return;
    }
    onBack();
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-border bg-bg-base overflow-hidden divide-y divide-border">
          <header className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
            <div className="flex items-center gap-3 min-w-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBack}
                className="text-text-muted hover:text-text-primary gap-1.5"
                title="Back to shipments"
              >
                <ChevronLeftIcon className="w-4 h-4" />
                <span className="hidden sm:inline">Back</span>
              </Button>

              <div className="h-5 w-px bg-border" />

              <div className="min-w-0 flex items-center gap-2.5">
                <h2 className="text-base font-bold text-text-primary tracking-tight truncate font-mono">
                  {shipment.shipment_no}
                </h2>
                <StatusBadge status={shipmentStatus(shipment)} />
              </div>
            </div>

            <div className="flex items-center gap-2">
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
              {canDelete && (
                confirmDelete ? (
                  <>
                    <Button variant="destructive" size="sm" onClick={onDelete}>
                      <TrashIcon className="w-4 h-4" />
                      <span>Delete for good</span>
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
                    <span className="hidden sm:inline">Delete shipment</span>
                  </Button>
                )
              )}
            </div>
          </header>

          {/* Split history lineage */}
          {(parentShipment || childShipments.length > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2 text-xs bg-bg-subtle/70 border-t border-border text-text-muted">
              {parentShipment && (
                <div className="flex items-center gap-1.5">
                  <span>Split from:</span>
                  <button
                    type="button"
                    onClick={() => handleOpenShipment(parentShipment.shipment_id)}
                    className="font-mono font-medium text-brand hover:underline"
                  >
                    {parentShipment.shipment_no}
                  </button>
                </div>
              )}
              {parentShipment && childShipments.length > 0 && (
                <span className="text-border-muted">•</span>
              )}
              {childShipments.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <span>Split into:</span>
                  {childShipments.map((child, idx) => (
                    <Fragment key={child.shipment_id}>
                      {idx > 0 && <span>,</span>}
                      <button
                        type="button"
                        onClick={() => handleOpenShipment(child.shipment_id)}
                        className="font-mono font-medium text-brand hover:underline"
                      >
                        {child.shipment_no}
                      </button>
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Underline tabs */}
          <div
            role="tablist"
            aria-label="Shipment sections"
            className="flex items-center gap-1 px-5 pt-2.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "shipment"}
              onClick={() => handleTabChange("shipment")}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-semibold transition-colors duration-150",
                activeTab === "shipment"
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:text-text-primary",
              )}
            >
              <span>Shipment</span>
              <span
                className={cn(
                  "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
                  activeTab === "shipment"
                    ? "bg-brand text-white"
                    : "bg-brand-subtle text-brand border border-brand-pill",
                )}
              >
                {pct}%
              </span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "split"}
              onClick={() => handleTabChange("split")}
              disabled={!canSplit}
              className={cn(
                "inline-flex items-center gap-2 border-b-2 px-3 pb-2.5 text-sm font-semibold transition-colors duration-150",
                activeTab === "split"
                  ? "border-brand text-brand"
                  : "border-transparent text-text-muted hover:text-text-primary",
                !canSplit && "opacity-60 cursor-not-allowed",
              )}
              title={
                !canSplit
                  ? "Splitting is disabled for this shipment (already received or no packages left en route)."
                  : undefined
              }
            >
              <span>Split shipment</span>
            </button>
          </div>

          <div className="px-6 py-6 flex flex-col gap-8">
            {activeTab === "shipment" && (
              <>
                <section>
                  <SectionLabel>Shipment information</SectionLabel>
                  <div className="rounded-lg border border-border bg-bg-subtle/50 p-4">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-start">
                      <div>
                        <span className="block text-xs font-medium text-text-muted mb-1">
                          Voucher
                        </span>
                        <Reference
                          value={shipment.voucher_no}
                          what="voucher no."
                          singleLine
                        />
                        <p className="mt-0.5 text-xs text-text-muted">
                          {shipment.supplier_name}
                        </p>
                      </div>
                      <Controller
                        control={control}
                        name="shipment.carrier_name"
                        render={({ field }) => (
                          <SuggestInput
                            label="Cargo"
                            placeholder="Shwe Moe Cargo"
                            suggestions={CARGO_NAMES}
                            value={field.value}
                            onChange={(next) => {
                              field.onChange(next);
                              apply({ carrier_name: next });
                            }}
                            error={errors.shipment?.carrier_name?.message}
                          />
                        )}
                      />
                      <Controller
                        control={control}
                        name="shipment.final_destination"
                        render={({ field }) => (
                          <SuggestInput
                            label="Receiving gate"
                            placeholder="Bogyoke Rd, Mawlamyine"
                            suggestions={RECEIVING_GATES}
                            value={field.value}
                            onChange={(next) => {
                              field.onChange(next);
                              apply({ final_destination: next });
                            }}
                            error={errors.shipment?.final_destination?.message}
                          />
                        )}
                      />
                      <Controller
                        control={control}
                        name="shipment.sent_on"
                        render={({ field }) => (
                          <Input
                            label="Shipment date"
                            type="date"
                            className={EDITABLE}
                            value={field.value}
                            onChange={field.onChange}
                            onBlur={field.onBlur}
                            error={errors.shipment?.sent_on?.message}
                          />
                        )}
                      />
                    </div>
                  </div>
                </section>

                <section>
                  <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                    <SectionLabel>Shipment journey</SectionLabel>
                    <div className="w-full sm:w-80 md:w-96">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="font-medium text-text-secondary">
                          Packages received
                        </span>
                        <span className="tabular-nums font-semibold text-text-primary">
                          {formatQty(shipment.final_received_packages)} /{" "}
                          {formatQty(shipment.total_packages)} ({pct}%)
                        </span>
                      </div>
                      <div
                        role="progressbar"
                        aria-valuenow={pct}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label="Packages received progress"
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
                    </div>
                  </div>
                  <DeliveryJourney
                    shipment={shipment}
                    receivings={receivings}
                    includeGateCount={false}
                  />
                </section>

                <section ref={trackingSectionRef}>
                  <SectionLabel>Package tracking</SectionLabel>
                  <p className="text-xs text-text-muted -mt-2 mb-3">
                    Click a stop&apos;s name to rename it, or the arrow between stops to add one.
                  </p>
                  {quantityMismatch && (
                    <p className="text-xs text-warning mb-3">
                      {quantityMismatch}
                    </p>
                  )}
                  <TableContainer className="[&>table]:min-w-max">
                    <thead>
                      <Tr>
                        <Th
                          style={{ backgroundColor: JourneyFace("supplier") }}
                          className="text-white text-center"
                          colSpan={2}
                        >
                          <span className="block">Supplier</span>
                          <span className="block text-[10px] font-normal normal-case text-white/70">
                            {shipment.supplier_name}
                          </span>
                        </Th>
                        <ArrowHead />
                        <Th
                          style={{ backgroundColor: JourneyFace("cargo") }}
                          className="text-white text-center"
                          colSpan={2}
                        >
                          {shipment.carrier_name}
                        </Th>
                        {shipment.legs.map((leg, index) => {
                          const finished = isLegFinished(shipment, index);
                          const isExpanded = !!expandedStops[leg.leg_id];
                          const collapsed = finished && !isExpanded;

                          return (
                            <Fragment key={leg.leg_id}>
                              <ArrowHead
                                insertLabel={`Add a destination before ${leg.stop_name}`}
                                onInsert={() => setInsertAt(index)}
                              />
                              {collapsed ? (
                                <Th
                                  style={{ backgroundColor: JourneyFace("stop") }}
                                  className="text-white text-center px-3"
                                  colSpan={1}
                                >
                                  <div className="flex items-center justify-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setExpandedStops((prev) => ({
                                          ...prev,
                                          [leg.leg_id]: true,
                                        }))
                                      }
                                      className="inline-flex items-center gap-1 font-medium hover:underline focus-visible:outline-none"
                                      title="Click to expand stop details"
                                    >
                                      <span>{leg.stop_name}</span>
                                      <CheckIcon className="w-3.5 h-3.5 text-white" />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Rename ${leg.stop_name}`}
                                      title={`Edit ${leg.stop_name}`}
                                      onClick={() => {
                                        setEditingLeg(index);
                                        setInsertAt(null);
                                      }}
                                      className="flex items-center justify-center w-4 h-4 rounded-full bg-white/25 text-white hover:bg-white/40"
                                    >
                                      <PencilIcon className="w-2.5 h-2.5" />
                                    </button>
                                    <button
                                      type="button"
                                      aria-label={`Remove ${leg.stop_name}`}
                                      title={`Remove ${leg.stop_name}`}
                                      onClick={() => removeLeg(index)}
                                      className="flex items-center justify-center w-4 h-4 rounded-full bg-white/25 text-white hover:bg-error"
                                    >
                                      <CloseIcon className="w-3 h-3" />
                                    </button>
                                  </div>
                                </Th>
                              ) : (
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
                                        "flex items-center justify-center w-5 h-5 rounded-full shrink-0",
                                        "bg-white/25 text-white",
                                        "transition-colors duration-150",
                                        "hover:bg-error hover:text-white",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
                                      )}
                                    >
                                      <CloseIcon className="w-3.5 h-3.5" />
                                    </button>
                                    {finished && (
                                      <button
                                        type="button"
                                        aria-label={`Collapse ${leg.stop_name}`}
                                        title="Collapse stop"
                                        onClick={() =>
                                          setExpandedStops((prev) => ({
                                            ...prev,
                                            [leg.leg_id]: false,
                                          }))
                                        }
                                        className="flex items-center justify-center w-5 h-5 rounded-full shrink-0 bg-white/25 text-white hover:bg-white/40 text-[10px]"
                                      >
                                        <ChevronLeftIcon className="w-3 h-3" />
                                      </button>
                                    )}
                                  </span>
                                </Th>
                              )}
                            </Fragment>
                          );
                        })}
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
                            {shipment.final_destination}
                          </span>
                        </Th>
                      </Tr>
                      <Tr>
                        <Th className="text-center">Packages</Th>
                        <Th className="text-center">Quantity</Th>
                        <ArrowCell />
                        <Th className="text-center">Sent</Th>
                        <Th className="text-center">Remaining</Th>
                        {shipment.legs.map((leg, index) => {
                          const finished = isLegFinished(shipment, index);
                          const isExpanded = !!expandedStops[leg.leg_id];
                          const collapsed = finished && !isExpanded;

                          return (
                            <Fragment key={`${leg.leg_id}-sub`}>
                              <ArrowCell />
                              {collapsed ? (
                                <Th className="text-center px-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedStops((prev) => ({
                                        ...prev,
                                        [leg.leg_id]: true,
                                      }))
                                    }
                                    className="text-[11px] text-text-muted hover:text-text-primary"
                                  >
                                    Finished
                                  </button>
                                </Th>
                              ) : (
                                <>
                                  <Th className="text-center">Received</Th>
                                  <Th className="text-center">Sent</Th>
                                  <Th className="text-center">Remaining</Th>
                                </>
                              )}
                            </Fragment>
                          );
                        })}
                        <ArrowCell />
                        <Th className="text-center">Received</Th>
                        <Th className="text-center">Remaining</Th>
                      </Tr>
                    </thead>
                    <Tbody>
                      <Tr className="hover:bg-transparent">
                        <Td className="text-center">
                          <BigCount value={shipment.total_packages} />
                        </Td>
                        <Td className="text-center">
                          <span className="tabular-nums font-semibold text-text-primary text-sm">
                            {formatSets(shipmentPairs(shipment))}
                          </span>
                        </Td>
                        <ArrowCell body />
                        <Td className="text-center">
                          <PackageInput
                            label={`Packages sent by ${shipment.carrier_name}`}
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
                        {shipment.legs.map((leg, index) => {
                          const finished = isLegFinished(shipment, index);
                          const isExpanded = !!expandedStops[leg.leg_id];
                          const collapsed = finished && !isExpanded;

                          return (
                            <Fragment key={`${leg.leg_id}-cells`}>
                              <ArrowCell body />
                              {collapsed ? (
                                <Td className="text-center px-3">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setExpandedStops((prev) => ({
                                        ...prev,
                                        [leg.leg_id]: true,
                                      }))
                                    }
                                    title="Click to view details"
                                    className="inline-flex items-center gap-1 rounded px-2.5 py-1 bg-success-subtle text-success text-xs font-bold tabular-nums hover:opacity-80 transition-opacity"
                                  >
                                    <span>{formatQty(leg.packages_sent)}</span>
                                    <CheckIcon className="w-3.5 h-3.5" />
                                  </button>
                                </Td>
                              ) : (
                                <>
                                  <Td className="text-center">
                                    <PackageInput
                                      label={`Packages received at ${leg.stop_name}`}
                                      value={leg.packages_received}
                                      max={maxForLeg(shipment, index)}
                                      onChange={(next) =>
                                        setLeg(index, {
                                          packages_received: next,
                                          packages_sent: Math.min(
                                            leg.packages_sent,
                                            next,
                                          ),
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
                                    <div className="relative inline-flex items-center justify-center">
                                      <LeftOver
                                        value={legRemaining(shipment, index)}
                                        started={maxForLeg(shipment, index) > 0}
                                        writtenOff={leg.lost_packages ?? 0}
                                        explanation={latestMismatch(leg.leg_id)}
                                      />
                                      {(legRemaining(shipment, index) > 0 ||
                                        (leg.lost_packages ?? 0) > 0 ||
                                        latestMismatch(leg.leg_id)) && (
                                        <div className="absolute -top-1.5 -right-2 z-10">
                                          <MismatchIconButton
                                            explained={Boolean(
                                              latestMismatch(leg.leg_id),
                                            )}
                                            onClick={() => {
                                              setWriteOffTarget({
                                                subjectId: leg.leg_id,
                                                legId: leg.leg_id,
                                                subject: `${shipment.shipment_no} at ${leg.stop_name}`,
                                                remaining: legRemaining(
                                                  shipment,
                                                  index,
                                                ),
                                                currentCount: leg.packages_sent,
                                              });
                                            }}
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </Td>
                                </>
                              )}
                            </Fragment>
                          );
                        })}
                        <ArrowCell body />
                        <Td className="text-center">
                          {hasReceiving ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <BigCount value={shipment.final_received_packages} />
                              <span className="text-[10px] text-text-muted">
                                From Receiving
                              </span>
                            </div>
                          ) : (
                            <PackageInput
                              label="Packages finally received"
                              value={shipment.final_received_packages}
                              max={heading}
                              onChange={(next) =>
                                apply({ final_received_packages: next })
                              }
                            />
                          )}
                        </Td>
                        <Td className="text-center">
                          <div className="relative inline-flex items-center justify-center">
                            <LeftOver
                              value={finalRemaining(shipment)}
                              started={
                                shipment.final_received_packages > 0 ||
                                (shipment.lost_packages ?? 0) > 0
                              }
                              writtenOff={shipment.lost_packages ?? 0}
                              explanation={latestMismatch(shipment.shipment_id)}
                            />
                            {(finalRemaining(shipment) > 0 ||
                              (shipment.lost_packages ?? 0) > 0 ||
                              latestMismatch(shipment.shipment_id)) && (
                              <div className="absolute -top-1.5 -right-2 z-10">
                                <MismatchIconButton
                                  explained={Boolean(
                                    latestMismatch(shipment.shipment_id),
                                  )}
                                  onClick={() => {
                                    setWriteOffTarget({
                                      subjectId: shipment.shipment_id,
                                      subject: `${shipment.shipment_no} at ${shipment.final_destination}`,
                                      remaining: finalRemaining(shipment),
                                      currentCount: shipment.total_packages,
                                    });
                                  }}
                                />
                              </div>
                            )}
                          </div>
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
                        size="sm"
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
                          ? shipment.carrier_name
                          : (shipment.legs[insertAt - 1]?.stop_name ??
                            shipment.carrier_name)
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
              </>
            )}

            {activeTab === "split" && (
              <SplitShipmentPage
                shipment={shipment}
                destinationSuggestions={[...RECEIVING_GATES, ...DESTINATION_NAMES]}
                carrierSuggestions={CARRIER_NAMES}
                onCancel={() => setActiveTab("shipment")}
                onSubmit={async (packages, quantity, finalDestination, carrierName, splitLegOrder) => {
                  if (onSplit) {
                    await onSplit(packages, quantity, finalDestination, carrierName, splitLegOrder);
                    setActiveTab("shipment");
                  }
                }}
              />
            )}
          </div>
        </div>
      </div>
      <WriteOffModal
        open={writeOffTarget !== null}
        subject={writeOffTarget?.subject ?? "this shipment"}
        remaining={writeOffTarget?.remaining ?? 0}
        unit="package"
        allowRepackaged
        currentCount={writeOffTarget?.currentCount ?? 0}
        onClose={() => setWriteOffTarget(null)}
        onSubmit={(quantity, reason, note) =>
          onWriteOff(
            serverShipment.shipment_id,
            writeOffTarget?.legId,
            quantity,
            reason,
            note,
          )
        }
      />
    </>
  );
}
