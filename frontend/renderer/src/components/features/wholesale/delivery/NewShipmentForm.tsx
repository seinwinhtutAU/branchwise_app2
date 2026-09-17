import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  EDITABLE,
  JourneyArrow,
  JourneyFace,
  JourneySoft,
  Panel,
  QuantityInput,
  Required,
  ReviewFact,
  SectionLabel,
  StepBar,
  SuggestInput,
  SOFT_BLUE,
  SOFT_RED,
  type JourneyStage,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  formatDate,
  formatQty,
  onlyDigits,
  todayIso,
} from "@renderer/components/features/wholesale/shared/shared";
import {
  formatIn,
  formatSets,
  toPairs,
  PAIRS_PER,
} from "@renderer/components/features/wholesale/shared/units";
import {
  CARGO_NAMES,
  CARRIER_NAMES,
  DESTINATION_NAMES,
  RECEIVING_GATES,
} from "@renderer/components/features/wholesale/masterData/masterData";
import { useWholesale } from "@renderer/components/features/wholesale/shared/store";
import { type NewShipmentInput } from "@renderer/components/features/wholesale/shared/api";
import {
  EMPTY_STOP,
  shipmentFormSchema,
  STEPS,
  type ShipmentFormValues,
} from "./types";

export function NewShipmentForm({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (input: NewShipmentInput) => void;
}): React.JSX.Element {
  const [step, setStep] = useState(0);
  const {
    control,
    register,
    handleSubmit,
    setValue,
    trigger,
    formState: { errors, isDirty },
  } = useForm<ShipmentFormValues>({
    resolver: zodResolver(shipmentFormSchema),
    defaultValues: {
      voucher_no: "",
      carrier_name: "",
      final_destination: "",
      sent_on: todayIso(),
      total_packages: "",
      total_sets: "",
      total_unit: "set",
      stops: [{ ...EMPTY_STOP }],
    },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { fields, append, remove, replace } = useFieldArray({
    control,
    name: "stops",
  });
  const values = useWatch({ control }) as ShipmentFormValues;
  const {
    voucher_no: voucherNo,
    carrier_name: cargoName,
    final_destination: finalLocation,
    sent_on: sentDate,
    total_packages: totalPackages,
    total_sets: totalSets,
    total_unit: totalUnit,
    stops,
  } = values;

  const { vouchers } = useWholesale();
  const voucher = vouchers.find((entry) => entry.voucher_no === voucherNo);
  const filledStops = stops.filter((stop) => stop.stop_name.trim() !== "");

  const quantityMismatch =
    voucher &&
    totalSets.trim() !== "" &&
    toPairs(Number(totalSets) || 0, totalUnit) !== voucher.total_quantity_pairs
      ? `The voucher says ${formatSets(voucher.total_quantity_pairs)}.`
      : undefined;

  function selectVoucher(nextVoucherNo: string): void {
    setValue("voucher_no", nextVoucherNo, {
      shouldDirty: true,
      shouldValidate: true,
    });
    const picked = vouchers.find((entry) => entry.voucher_no === nextVoucherNo);
    const pickedCargo = picked?.carrier_name.trim();
    setValue(
      "carrier_name",
      pickedCargo && pickedCargo !== "—" ? pickedCargo : "",
      { shouldDirty: true, shouldValidate: true },
    );
    setValue("total_packages", picked ? String(picked.total_packages) : "", {
      shouldDirty: true,
      shouldValidate: true,
    });
    if (!picked) {
      setValue("total_sets", "", { shouldDirty: true });
      setValue("total_unit", "set", { shouldDirty: true });
      return;
    }
    const wholeSets = picked.total_quantity_pairs % PAIRS_PER.set === 0;
    setValue("total_unit", wholeSets ? "set" : "pair", {
      shouldDirty: true,
    });
    setValue(
      "total_sets",
      String(
        wholeSets
          ? picked.total_quantity_pairs / PAIRS_PER.set
          : picked.total_quantity_pairs,
      ),
      { shouldDirty: true },
    );
  }

  function removeStop(index: number): void {
    if (fields.length === 1) {
      replace([{ ...EMPTY_STOP }]);
      return;
    }
    remove(index);
  }

  async function moveToDestinations(): Promise<void> {
    const valid = await trigger([
      "voucher_no",
      "carrier_name",
      "final_destination",
      "sent_on",
      "total_packages",
      "total_sets",
      "total_unit",
    ]);
    if (valid && voucher) setStep(1);
  }

  async function moveToReview(): Promise<void> {
    if (await trigger("stops")) setStep(2);
  }

  function submit(values: ShipmentFormValues): void {
    const voucher = vouchers.find(
      (entry) => entry.voucher_no === values.voucher_no,
    );
    if (!voucher) return;
    onCreate({
      voucher_no: voucher.voucher_no,
      supplier_name: voucher.supplier_name,
      carrier_name: values.carrier_name.trim(),
      final_destination: values.final_destination.trim(),
      sent_on: values.sent_on,
      total_packages: Number(values.total_packages) || voucher.total_packages,
      total_quantity_pairs: Number(values.total_sets) || 0,
      total_unit: values.total_unit,
      packages_sent_by_cargo: 0,
      final_received_packages: 0,
      legs: values.stops
        .filter((stop) => stop.stop_name.trim() !== "")
        .map((stop, index) => ({
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
    <>
      <div className="flex flex-col gap-5">
        <div>
          <Button
            variant="ghost"
            size="sm"
            title={
              isDirty ? "This new shipment has unsaved changes." : undefined
            }
            onClick={onCancel}
          >
            <ChevronLeftIcon className="w-4 h-4" />
            Back to shipments
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
                <Controller
                  control={control}
                  name="voucher_no"
                  render={() => (
                    <Select
                      label={<Required>Supplier voucher</Required>}
                      className={EDITABLE}
                      value={voucherNo}
                      error={errors.voucher_no?.message}
                      onChange={(event) => selectVoucher(event.target.value)}
                    >
                      <option value="">Choose…</option>
                      {vouchers.map((entry) => (
                        <option key={entry.voucher_id} value={entry.voucher_no}>
                          {entry.voucher_no} — {entry.supplier_name}
                        </option>
                      ))}
                    </Select>
                  )}
                />
                <Controller
                  control={control}
                  name="carrier_name"
                  render={({ field }) => (
                    <SuggestInput
                      label={<Required>Cargo</Required>}
                      placeholder="Shwe Moe Cargo"
                      suggestions={CARGO_NAMES}
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.carrier_name?.message}
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="final_destination"
                  render={({ field }) => (
                    <SuggestInput
                      label={<Required>Receiving gate</Required>}
                      placeholder="Bogyoke Rd, Mawlamyine"
                      suggestions={RECEIVING_GATES}
                      value={field.value}
                      onChange={field.onChange}
                      error={errors.final_destination?.message}
                    />
                  )}
                />
                <Input
                  label="Shipment date"
                  type="date"
                  className={EDITABLE}
                  error={errors.sent_on?.message}
                  {...register("sent_on")}
                />
                <Controller
                  control={control}
                  name="total_packages"
                  render={({ field }) => (
                    <Input
                      label="Packages"
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      className={cn(EDITABLE, "text-right")}
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(onlyDigits(event.target.value))
                      }
                      error={errors.total_packages?.message}
                      hint={
                        voucher
                          ? `${formatQty(voucher.total_packages)} on the voucher.`
                          : "Pick a voucher and this fills itself in."
                      }
                    />
                  )}
                />
                <Controller
                  control={control}
                  name="total_sets"
                  render={({ field }) => (
                    <QuantityInput
                      label="Quantity"
                      value={field.value}
                      unit={totalUnit}
                      onChange={field.onChange}
                      error={errors.total_sets?.message ?? quantityMismatch}
                      hint={
                        voucher
                          ? `${formatSets(voucher.total_quantity_pairs)} on the voucher.`
                          : "Pick a voucher and this fills itself in."
                      }
                    />
                  )}
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={() => void moveToDestinations()}>
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
                {fields.map((field, index) => {
                  return (
                    <div
                      key={field.id}
                      className="grid gap-3 grid-cols-1 md:grid-cols-12 items-start p-3"
                    >
                      <span className="md:col-span-1 text-sm font-semibold text-text-muted md:pt-9">
                        {index + 1}
                      </span>
                      <div className="md:col-span-4">
                        <Controller
                          control={control}
                          name={`stops.${index}.stop_name`}
                          render={({ field: destinationField }) => (
                            <Select
                              label="Destination"
                              className={EDITABLE}
                              {...destinationField}
                            >
                              <option value="">Choose…</option>
                              {DESTINATION_NAMES.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </Select>
                          )}
                        />
                      </div>
                      <div className="md:col-span-5">
                        <Controller
                          control={control}
                          name={`stops.${index}.carrier_name`}
                          render={({ field: carrierField }) => (
                            <Select
                              label="Carrier"
                              className={EDITABLE}
                              {...carrierField}
                            >
                              <option value="">Choose…</option>
                              {CARRIER_NAMES.map((name) => (
                                <option key={name} value={name}>
                                  {name}
                                </option>
                              ))}
                            </Select>
                          )}
                        />
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
                  );
                })}
              </div>
              <div>
                <Button
                  variant="secondary"
                  className={SOFT_BLUE}
                  onClick={() => append({ ...EMPTY_STOP })}
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
                <Button onClick={() => void moveToReview()}>
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
                <ReviewFact
                  label="Shipment no."
                  value="Assigned when you save"
                />
                <ReviewFact label="Voucher no." value={voucherNo || "—"} />
                <ReviewFact
                  label="Supplier / Factory"
                  value={voucher?.supplier_name ?? "—"}
                />
                <ReviewFact label="Cargo" value={cargoName || "—"} />
                <ReviewFact
                  label="Receiving gate"
                  value={finalLocation || "—"}
                />
                <ReviewFact
                  label="Shipment date"
                  value={formatDate(sentDate)}
                />
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
                    totalUnit,
                  )}
                />
              </dl>
              <div>
                <SectionLabel>Shipment journey</SectionLabel>
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
                <Button onClick={handleSubmit(submit)}>
                  <CheckIcon className="w-4 h-4" />
                  Confirm shipment
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}

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
