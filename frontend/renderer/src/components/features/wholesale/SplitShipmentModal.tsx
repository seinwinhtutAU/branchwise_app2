import { useEffect, useState } from "react";

import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { WholesaleApiError } from "./api";
import { SuggestInput } from "./ui";
import { formatIn, type Unit, UNIT_LABELS } from "./units";

/**
 * Carves part of a shipment's still-undispatched remainder into a shipment of its own —
 * the case where the cargo company only sends part of a voucher one way and holds the
 * rest for a different destination. Both fields are capped by what the original
 * shipment actually has left: `availablePackages` (see cargoRemaining) and the
 * shipment's own total quantity, since the server enforces the same two limits and
 * rejects anything past them.
 */
export function SplitShipmentModal({
  open,
  shipmentNo,
  availablePackages,
  availableQuantity,
  unit,
  destinationSuggestions,
  carrierSuggestions,
  onClose,
  onSubmit,
}: {
  open: boolean;
  shipmentNo: string;
  availablePackages: number;
  availableQuantity: number;
  unit: Unit;
  destinationSuggestions: string[];
  carrierSuggestions: string[];
  onClose: () => void;
  onSubmit: (
    packages: number,
    quantity: number,
    finalDestination: string,
    carrierName: string,
  ) => Promise<void>;
}): React.JSX.Element | null {
  const [packages, setPackages] = useState("");
  const [quantity, setQuantity] = useState("");
  const [destination, setDestination] = useState("");
  const [carrierName, setCarrierName] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  // Touch state: errors only show once the user has left a field or pressed Submit.
  const [packagesTouched, setPackagesTouched] = useState(false);
  const [quantityTouched, setQuantityTouched] = useState(false);
  const [destinationTouched, setDestinationTouched] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPackages("");
    setQuantity("");
    setDestination("");
    setCarrierName("");
    setError(undefined);
    setPackagesTouched(false);
    setQuantityTouched(false);
    setDestinationTouched(false);
    setSubmitAttempted(false);
  }, [open]);

  if (!open) return null;

  const parsedPackages = Number(packages);
  const parsedQuantity = Number(quantity);

  // ── Validation: split each field into "is the value wrong" vs "show the error" ──

  const packagesWrong: string | undefined =
    packages.trim() === "" || !Number.isInteger(parsedPackages) || parsedPackages <= 0
      ? "Enter a whole number of packages greater than zero."
      : parsedPackages > availablePackages
        ? `Only ${availablePackages} package${availablePackages === 1 ? "" : "s"} are still in transit.`
        : undefined;
  const packagesError =
    packagesWrong !== undefined && (packagesTouched || submitAttempted)
      ? packagesWrong
      : undefined;

  const quantityWrong: string | undefined =
    quantity.trim() === "" || !Number.isFinite(parsedQuantity) || parsedQuantity <= 0
      ? `Enter a quantity greater than zero.`
      : !Number.isInteger(parsedQuantity)
        ? "Quantity must be a whole number."
        : parsedQuantity > availableQuantity
          ? `Only ${formatIn(availableQuantity, unit)} left on this shipment.`
          : undefined;
  const quantityError =
    quantityWrong !== undefined && (quantityTouched || submitAttempted)
      ? quantityWrong
      : undefined;

  const destinationWrong: string | undefined =
    destination.trim() === "" ? "Say where this part is going." : undefined;
  const destinationError =
    destinationWrong !== undefined && (destinationTouched || submitAttempted)
      ? destinationWrong
      : undefined;

  async function submit(): Promise<void> {
    setSubmitAttempted(true);
    if (packagesWrong || quantityWrong || destinationWrong || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSubmit(parsedPackages, parsedQuantity, destination.trim(), carrierName.trim());
      onClose();
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-shipment-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-base p-5 shadow-xl">
        <div className="mb-5">
          <h2 id="split-shipment-title" className="text-lg font-semibold text-text-primary">
            Split shipment
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Send part of {shipmentNo} to a different destination.{" "}
            It keeps the same voucher and supplier.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <Input
            label="Packages moving"
            hint={`${availablePackages} package${availablePackages === 1 ? "" : "s"} are still in transit.`}
            type="number"
            min={1}
            max={availablePackages}
            step={1}
            value={packages}
            onChange={(event) => setPackages(event.target.value)}
            onBlur={() => setPackagesTouched(true)}
            error={packagesError}
          />
          <Input
            label="Quantity moving"
            hint={`Up to ${formatIn(availableQuantity, unit)}.`}
            type="number"
            min={1}
            max={availableQuantity}
            step={1}
            endIcon={
              <span className="text-sm text-text-secondary">
                {UNIT_LABELS[unit]}
              </span>
            }
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            onBlur={() => setQuantityTouched(true)}
            error={quantityError}
          />
          <SuggestInput
            label="New destination"
            placeholder="Where is this part going?"
            value={destination}
            onChange={setDestination}
            suggestions={destinationSuggestions}
            onBlur={() => setDestinationTouched(true)}
            error={destinationError}
          />
          <SuggestInput
            label="Carrier"
            placeholder="Same carrier if left blank"
            value={carrierName}
            onChange={setCarrierName}
            suggestions={carrierSuggestions}
          />
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={saving}
            disabled={Boolean(packagesWrong || quantityWrong || destinationWrong)}
          >
            Split shipment
          </Button>
        </div>
      </div>
    </div>
  );
}
