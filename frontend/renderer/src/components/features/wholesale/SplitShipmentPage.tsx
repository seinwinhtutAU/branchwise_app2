import { useMemo, useState } from "react";

import { Button } from "@renderer/components/ui/Button";
import { ChevronLeftIcon } from "@renderer/components/ui/icons";
import { cn } from "@renderer/lib/utils";
import { WholesaleApiError } from "./api";
import {
  cargoRemaining,
  legRemaining,
  shipmentPairs,
  type Shipment,
} from "./shipments";
import { JourneyCard, JourneyRow, Panel, SectionLabel, SuggestInput } from "./ui";
import { formatIn, type Unit } from "./units";

/**
 * A full page for sending part of a shipment somewhere else — split out of the shipment
 * detail sheet because a split isn't one small decision, it's two: which pocket of
 * still-undelivered packages is moving, and where it's going.
 *
 * The real event is small — the cargo company, or a stop further down the road, is
 * holding some of these boxes back for a different place — so most of the work is
 * picking the right pocket. A split is often also a repackaging (one box opened into
 * two for two different places, or several combined into one), so neither figure below
 * is pinned to a stop's own recorded numbers: packages only get a basic sanity check
 * against the shipment's own total, and quantity is left optional entirely, since
 * what's actually inside a box isn't known for certain until it's opened and counted at
 * the receiving gate. See backend/app/services/wholesale_shipments.py::split_shipment.
 */

/** One place along the route packages could still be split off from. */
interface SplitPoint {
  /** undefined = the cargo company's own still-undispatched packages. */
  legOrder: number | undefined;
  label: string;
  subtitle: string;
  available: number;
}

function splitPoints(shipment: Shipment): SplitPoint[] {
  const points: SplitPoint[] = [
    {
      legOrder: undefined,
      label: "Cargo",
      subtitle: shipment.carrier_name || "Not yet sent",
      available: cargoRemaining(shipment),
    },
  ];
  shipment.legs.forEach((leg, index) => {
    points.push({
      legOrder: leg.leg_order,
      label: leg.stop_name,
      subtitle: leg.carrier_name || "En route",
      available: legRemaining(shipment, index),
    });
  });
  return points.filter((point) => point.available > 0);
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
  const points = useMemo(() => splitPoints(shipment), [shipment]);
  const [selected, setSelected] = useState<SplitPoint | null>(points[0] ?? null);
  const [packages, setPackages] = useState(() => Math.min(1, points[0]?.available ?? 0));
  // Blank means "not known yet" — left out of the request entirely rather than sent as
  // a guess. Text, not a number, so an empty box stays empty instead of becoming 0.
  const [quantityText, setQuantityText] = useState("");
  const [destination, setDestination] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [touchedDestination, setTouchedDestination] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const totalPackages = shipment.total_packages;
  const totalQuantity = shipmentPairs(shipment);
  const unit: Unit = shipment.total_unit;

  function selectPoint(point: SplitPoint): void {
    setSelected(point);
    setPackages(Math.min(1, point.available));
  }

  if (!selected) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <ChevronLeftIcon className="w-4 h-4" />
            Back to {shipment.shipment_no}
          </Button>
        </div>
        <Panel className="p-6 text-sm text-text-muted">
          Everything on this shipment has already been sent on from every stop — there is
          nothing left to split off.
        </Panel>
      </div>
    );
  }

  const availablePackages = selected.available;
  // Only a hint for the quantity box, never a value that gets sent on its own — quantity
  // isn't tracked per stop the way packages are, so this can't promise an even share is
  // actually what's in these particular boxes.
  const proportional =
    totalPackages > 0 ? Math.floor((totalQuantity * packages) / totalPackages) : 0;
  const quantityEntered = quantityText.trim() !== "";
  const quantity = quantityEntered ? Math.max(0, Math.floor(Number(quantityText)) || 0) : undefined;

  const destinationWrong =
    destination.trim() === "" ? "Say where this part is going." : undefined;
  const destinationError =
    destinationWrong && (touchedDestination || submitAttempted)
      ? destinationWrong
      : undefined;
  const packagesWrong =
    packages <= 0
      ? "The box count has to be more than nothing."
      : packages > totalPackages
        ? `That is more than the shipment's own ${totalPackages} boxes.`
        : undefined;
  const quantityWrong =
    quantity !== undefined && quantity > totalQuantity
      ? `That is more than the shipment's own ${formatIn(totalQuantity, unit)}.`
      : undefined;

  const canSubmit = !packagesWrong && !quantityWrong && !destinationWrong && !saving;

  const originalAfterPackages = totalPackages - packages;
  const originalAfterQuantity = quantity === undefined ? totalQuantity : totalQuantity - quantity;

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
        selected.legOrder,
      );
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
        <Button variant="ghost" size="sm" onClick={onCancel}>
          <ChevronLeftIcon className="w-4 h-4" />
          Back to {shipment.shipment_no}
        </Button>
      </div>

      <Panel className="p-6">
        <SectionLabel>Where is this being split from</SectionLabel>
        <div className="flex items-stretch gap-3 overflow-x-auto pb-2">
          {points.map((point) => {
            const isSelected = point.legOrder === selected.legOrder;
            return (
              <button
                key={point.legOrder ?? "cargo"}
                type="button"
                onClick={() => selectPoint(point)}
                className={cn(
                  "rounded-xl transition-shadow text-left",
                  isSelected
                    ? "ring-2 ring-brand"
                    : "opacity-70 hover:opacity-100",
                )}
              >
                <JourneyCard
                  stage={point.legOrder === undefined ? "cargo" : "stop"}
                  title={point.label}
                  subtitle={point.subtitle}
                >
                  <JourneyRow label="Still there" value={`${point.available} boxes`} />
                </JourneyCard>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel className="p-6">
        <SectionLabel>How much is moving</SectionLabel>
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
              <span>Boxes going to the new place</span>
              <input
                type="number"
                min={1}
                max={totalPackages}
                value={packages}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setPackages(Math.max(1, Math.floor(next) || 1));
                }}
                aria-label="Boxes going to the new place"
                className="h-9 w-20 rounded-md border border-border bg-bg-base px-2 text-right text-sm tabular-nums focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <span className="text-text-muted">
                {availablePackages} recorded as still at {selected.label} — repackaging
                on the way means this doesn't have to match exactly
              </span>
            </div>
            {packagesWrong && <p className="mt-1 text-xs text-error">{packagesWrong}</p>}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-text-primary">
              <span>Quantity riding with them</span>
              <input
                type="number"
                min={0}
                value={quantityText}
                placeholder="Not known yet"
                onChange={(event) => setQuantityText(event.target.value)}
                aria-label="Quantity riding with them"
                className="h-9 w-28 rounded-md border border-border bg-bg-base px-2 text-right text-sm tabular-nums focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
              />
              <span className="text-text-muted">
                Optional — leave blank until it's counted at the gate
                {proportional > 0 && ` (an even share would be ${proportional})`}
              </span>
            </div>
            {quantityWrong && <p className="mt-1 text-xs text-error">{quantityWrong}</p>}
          </div>

          <SuggestInput
            label="New destination"
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
      </Panel>

      <Panel className="p-6">
        <SectionLabel>After this</SectionLabel>
        <div className="rounded-md border border-border bg-bg-subtle px-4 py-3 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono text-text-secondary">{shipment.shipment_no}</span>
            <span className="tabular-nums text-text-primary">
              {originalAfterPackages} boxes · {formatIn(originalAfterQuantity, unit)}
              {shipment.final_destination && (
                <span className="text-text-muted"> → {shipment.final_destination}</span>
              )}
            </span>
          </div>
          <div className="mt-1 flex items-baseline justify-between gap-3">
            <span className="text-text-secondary">New shipment</span>
            <span className="tabular-nums font-semibold text-brand">
              {packages} boxes · {quantity === undefined ? "not yet known" : formatIn(quantity, unit)}
              <span className="text-text-muted"> → {destination.trim() || "…"}</span>
            </span>
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-error">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={saving} disabled={!canSubmit}>
            Split shipment
          </Button>
        </div>
      </Panel>
    </div>
  );
}
