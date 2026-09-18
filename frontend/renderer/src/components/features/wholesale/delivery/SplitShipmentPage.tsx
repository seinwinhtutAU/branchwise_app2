import { Fragment, useMemo, useState } from "react";

import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { ArrowRightIcon } from "@renderer/components/ui/icons";
import { cn } from "@renderer/lib/utils";
import { WholesaleApiError } from "../shared/api";
import {
  formatQty,
  onlyDigits,
  quantityShorthandPairs,
  quantityShorthandProblem,
} from "../shared/shared";
import {
  cargoRemaining,
  legRemaining,
  maxForLeg,
  shipmentPairs,
  type Shipment,
} from "./shipments";
import { EDITABLE, JourneyArrow, JourneyCard, JourneyRow, QuantityInput, Required, SectionLabel, SuggestInput } from "../shared/ui";
import { formatIn, type Unit } from "../shared/units";

/**
 * The Split shipment tab — the shipment's real journey (the same row the Shipment tab
 * draws), with the stage a split can come from clickable right on the diagram, and a
 * branch card growing out of whichever one is picked. One picture instead of a separate
 * abstract list and a disconnected before/after summary: which stage is holding the
 * packages, and where they're going instead, are the same fork in the same route.
 *
 * Packages are capped at what the chosen stage actually still shows as not yet sent on
 * (cargoRemaining / legRemaining) — never looser than that, because letting a bigger
 * request through would force an already-sent figure to shrink to make the arithmetic
 * balance, silently contradicting a count a Receiving may already refer to (see
 * backend/app/services/wholesale_shipments.py::split_shipment). Quantity is optional and
 * only checked against the shipment's own total, since what's actually inside a package
 * isn't known for certain until it's opened and counted at the receiving gate — it's
 * typed in the shipment's own unit (set/dozen/pair) and converted to real pairs before
 * it's compared or sent, the same way every other quantity field in this app does.
 */

type SelectedPoint = { kind: "cargo" } | { kind: "leg"; legOrder: number };

interface Stage {
  key: string;
  title: string;
  subtitle: string;
  journeyStage: "supplier" | "cargo" | "stop" | "final";
  rows: { label: string; value: string; good?: boolean }[];
  done?: boolean;
  /** undefined for Supplier/Final, which goods only ever pass through — nothing can be
   *  split off a place that either hasn't sent anything yet or is the end of the road. */
  point?: { selected: SelectedPoint; available: number };
}

function buildStages(shipment: Shipment): Stage[] {
  const unit: Unit = shipment.total_unit;
  const stages: Stage[] = [
    {
      key: "supplier",
      title: "Supplier",
      subtitle: shipment.supplier_name,
      journeyStage: "supplier",
      rows: [
        { label: "Packages", value: formatQty(shipment.total_packages) },
        { label: "Quantity", value: formatIn(shipmentPairs(shipment), unit) },
      ],
    },
    {
      key: "cargo",
      title: "Cargo",
      subtitle: shipment.carrier_name || "Not yet sent",
      journeyStage: "cargo",
      rows: [
        { label: "Sent", value: formatQty(shipment.packages_sent_by_cargo) },
        { label: "Remaining", value: formatQty(cargoRemaining(shipment)) },
      ],
      done: shipment.packages_sent_by_cargo > 0 && cargoRemaining(shipment) === 0,
      point: { selected: { kind: "cargo" }, available: cargoRemaining(shipment) },
    },
  ];
  shipment.legs.forEach((leg, index) => {
    const due = maxForLeg(shipment, index);
    const remaining = legRemaining(shipment, index);
    const physicalAvailable = Math.max(
      0,
      leg.packages_received - leg.packages_sent - (leg.lost_packages ?? 0),
    );
    stages.push({
      key: leg.leg_id,
      title: leg.stop_name,
      subtitle: leg.carrier_name || "En route",
      journeyStage: "stop",
      rows: [
        { label: "Received", value: formatQty(leg.packages_received) },
        { label: "Sent", value: formatQty(leg.packages_sent) },
        { label: "Remaining", value: formatQty(remaining) },
      ],
      done: due > 0 && remaining === 0,
      point: { selected: { kind: "leg", legOrder: leg.leg_order }, available: physicalAvailable },
    });
  });
  stages.push({
    key: "final",
    title: "Final received",
    subtitle: shipment.final_destination,
    journeyStage: "final",
    rows: [{ label: "Received", value: formatQty(shipment.final_received_packages) }],
  });
  return stages;
}

function samePoint(a: SelectedPoint, b: SelectedPoint): boolean {
  return a.kind === "cargo" ? b.kind === "cargo" : b.kind === "leg" && b.legOrder === a.legOrder;
}

export function SplitShipmentPage({
  shipment,
  destinationSuggestions,
  carrierSuggestions,
  onCancel,
  onSubmit,
}: {
  shipment: Shipment;
  destinationSuggestions: string[];
  carrierSuggestions: string[];
  onCancel: () => void;
  onSubmit: (
    packages: number,
    quantity: number | undefined,
    finalDestination: string,
    carrierName: string,
    splitLegOrder: number | undefined,
  ) => Promise<void>;
}): React.JSX.Element {
  const stages = useMemo(() => buildStages(shipment), [shipment]);
  const firstSplittable = stages.find((stage) => (stage.point?.available ?? 0) > 0)?.point;
  const [selected, setSelected] = useState<SelectedPoint | null>(firstSplittable?.selected ?? null);
  // Kept as typed text, not clamped on every keystroke — a plain number input fights
  // typing a figure that briefly exceeds the limit (try typing "15" one digit at a time
  // when the max is 10). The limit still applies at submit time via packagesWrong.
  const [packagesText, setPackagesText] = useState(() => (firstSplittable?.available ? "1" : "0"));
  // Blank means "not known yet" — left out of the request entirely rather than sent as
  // a guess.
  const [quantityText, setQuantityText] = useState("");
  const [destination, setDestination] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [touchedDestination, setTouchedDestination] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const totalQuantity = shipmentPairs(shipment);
  const unit: Unit = shipment.total_unit;
  const packages = Number(packagesText) || 0;

  const selectedStage = stages.find((stage) => stage.point && selected && samePoint(stage.point.selected, selected));
  const availablePackages = selectedStage?.point?.available ?? 0;

  const quantityEntered = quantityText.trim() !== "";
  // Typed in the shipment's own unit by default, or in whatever a piece names its own
  // ("83p", "1s3p") — the same shorthand the colour boxes use — converted to real pairs
  // before it means anything next to `totalQuantity` or gets sent to the server, which
  // only ever deals in real pairs.
  const quantityFormatProblem = quantityEntered
    ? quantityShorthandProblem(quantityText)
    : null;
  const quantity =
    quantityEntered && !quantityFormatProblem
      ? quantityShorthandPairs(quantityText, unit)
      : undefined;

  const destinationWrong =
    destination.trim() === "" ? "Say where this part is going." : undefined;
  const destinationError =
    destinationWrong && (touchedDestination || submitAttempted)
      ? destinationWrong
      : undefined;
  const packagesWrong =
    packages <= 0
      ? "The package count has to be more than nothing."
      : packages > availablePackages
        ? `Only ${availablePackages} packages are still at ${selectedStage?.title}.`
        : undefined;
  const quantityWrong =
    quantityFormatProblem ??
    (quantity !== undefined && quantity > totalQuantity
      ? `That is more than the shipment's own ${formatIn(totalQuantity, unit)}.`
      : undefined);

  const canSubmit = !!selected && !packagesWrong && !quantityWrong && !destinationWrong && !saving;

  async function submit(): Promise<void> {
    setSubmitAttempted(true);
    if (!canSubmit || !selected) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSubmit(
        packages,
        quantity,
        destination.trim(),
        carrierName.trim(),
        selected.kind === "leg" ? selected.legOrder : undefined,
      );
      // Back to the Shipment tab on success — this tab unmounts (see the "split" branch
      // in DeliveryPage.tsx), so its fields don't linger stale for next time.
      onCancel();
    } catch (submitError) {
      setError(
        submitError instanceof WholesaleApiError
          ? submitError.message
          : "Could not split the shipment.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <SectionLabel>Shipment journey — click a stage to split from it</SectionLabel>
        <div className="flex items-start gap-0 overflow-x-auto pt-1.5 pb-2 px-1">
          {stages.map((stage, index) => {
            const isSelectable = (stage.point?.available ?? 0) > 0;
            const isSelected = !!(stage.point && selected && samePoint(stage.point.selected, selected));
            const card = (
              <JourneyCard
                stage={stage.journeyStage}
                title={stage.title}
                subtitle={stage.subtitle}
                done={stage.done}
                doneLabel="Everything sent on"
                faded={!!stage.point && !isSelectable}
              >
                {stage.rows.map((row) => (
                  <JourneyRow key={row.label} label={row.label} value={row.value} good={row.good} />
                ))}
              </JourneyCard>
            );
            return (
              <Fragment key={stage.key}>
                {index > 0 && <JourneyArrow />}
                <div className="flex shrink-0 flex-col items-center gap-1">
                  {isSelectable ? (
                    <button
                      type="button"
                      onClick={() => {
                        const point = stage.point!.selected;
                        setSelected(point);
                        setPackagesText(stage.point!.available > 0 ? "1" : "0");
                      }}
                      aria-pressed={isSelected}
                      className={cn(
                        "shrink-0 rounded-xl text-left ring-offset-2 ring-offset-bg-base transition-shadow",
                        isSelected ? "ring-2 ring-brand" : "hover:ring-1 hover:ring-border-strong",
                      )}
                    >
                      {card}
                    </button>
                  ) : (
                    card
                  )}
                  {isSelected && (
                    <>
                      <ArrowRightIcon className="h-5 w-5 rotate-90 text-text-muted" aria-hidden />
                      <JourneyCard
                        stage="stop"
                        title="New shipment"
                        subtitle={destination.trim() || "Pick a destination"}
                      >
                        <JourneyRow label="Packages" value={formatQty(packages)} />
                        <JourneyRow
                          label="Quantity"
                          value={quantity === undefined ? "Not yet known" : formatIn(quantity, unit)}
                        />
                      </JourneyCard>
                    </>
                  )}
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {selected ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              label={<Required>Packages to split</Required>}
              className={EDITABLE}
              type="text"
              inputMode="numeric"
              value={packagesText}
              onChange={(event) => setPackagesText(onlyDigits(event.target.value))}
              aria-label="Packages going to the new place"
              error={packagesWrong}
              hint={packagesWrong ? undefined : `${availablePackages} at ${selectedStage?.title}`}
            />
            <QuantityInput
              label="Quantity to split"
              unit={unit}
              placeholder="Not known yet"
              value={quantityText}
              onChange={setQuantityText}
              error={quantityWrong}
              hint={quantityWrong ? undefined : "Optional, until counted"}
            />
            <SuggestInput
              label={<Required>New destination</Required>}
              placeholder="Where is this part going?"
              value={destination}
              onChange={(next) => {
                setDestination(next);
                setTouchedDestination(true);
              }}
              suggestions={destinationSuggestions}
              error={destinationError}
            />
            <SuggestInput
              label="Carrier"
              placeholder="Same carrier if left blank"
              value={carrierName}
              onChange={setCarrierName}
              suggestions={carrierSuggestions}
            />
          </div>

          {error && <p className="text-sm text-error">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={saving} disabled={!canSubmit}>
              Split shipment
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-text-muted">
          Everything on this shipment has already been sent on from every stage — there
          is nothing left to split off.
        </p>
      )}
    </div>
  );
}
