import React, { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@renderer/components/ui/icons";
import {
  EDITABLE,
  Panel,
  QuantityInput,
  ReadOnlyField,
  Required,
  ReviewFact,
  SOFT_BLUE,
  SectionLabel,
  StepBar,
  SuggestInput,
} from "@renderer/components/features/wholesale/ui";
import {
  formatDate,
  formatKyat,
  formatQty,
  onlyDigits,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import {
  formatIn,
  toPairs,
} from "@renderer/components/features/wholesale/units";
import { useWholesale } from "@renderer/components/features/wholesale/store";
import { RECEIVING_GATES } from "@renderer/components/features/wholesale/masterData";
import { type NewReceivingInput } from "@renderer/components/features/wholesale/api";
import {
  STEPS,
  receivingFormSchema,
  type ReceivingFormValues,
} from "./types";

export function NewReceivingForm({
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
