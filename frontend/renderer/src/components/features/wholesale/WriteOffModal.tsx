import { useEffect, useState } from "react";

import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import { WholesaleApiError, type WriteOffReason } from "./api";
import { formatIn, type Unit } from "./units";

const LOSS_REASONS: Array<{ value: WriteOffReason; label: string }> = [
  { value: "lost_in_transit", label: "Lost in transit" },
  { value: "damaged", label: "Damaged" },
  { value: "short_shipped", label: "Short-shipped" },
  { value: "other", label: "Other" },
];

const REPACKAGED_REASON = {
  value: "repackaged" as const,
  label: "Repackaged / recounted",
};

export function WriteOffModal({
  open,
  subject,
  remaining,
  unit,
  allowRepackaged = false,
  currentCount = remaining,
  onClose,
  onSubmit,
}: {
  open: boolean;
  subject: string;
  remaining: number;
  unit: Unit | "package";
  allowRepackaged?: boolean;
  currentCount?: number;
  onClose: () => void;
  onSubmit: (
    quantity: number,
    reason: WriteOffReason,
    note: string,
  ) => Promise<void>;
}): React.JSX.Element | null {
  const [quantity, setQuantity] = useState(String(currentCount));
  const [reason, setReason] = useState<WriteOffReason>("lost_in_transit");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuantity(String(allowRepackaged ? currentCount : remaining));
    setReason("lost_in_transit");
    setNote("");
    setError(undefined);
  }, [allowRepackaged, currentCount, open, remaining]);

  if (!open) return null;

  const parsedQuantity = Number(quantity);
  const isRepackaged = reason === "repackaged";
  const quantityError =
    quantity.trim() === "" ||
    !Number.isInteger(parsedQuantity) ||
    parsedQuantity < 0
      ? "Enter a whole quantity of zero or more."
      : !isRepackaged && parsedQuantity === 0
        ? "Enter a whole quantity greater than zero."
        : !isRepackaged && parsedQuantity > remaining
          ? `You can write off at most ${unit === "package" ? `${remaining} packages` : formatIn(remaining, unit)}.`
          : undefined;

  async function submit(): Promise<void> {
    if (quantityError || saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await onSubmit(parsedQuantity, reason, note.trim());
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof WholesaleApiError
          ? submitError.message
          : "Could not save the explanation.",
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
      aria-labelledby="write-off-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-base p-5 shadow-xl">
        <div className="mb-5">
          <h2
            id="write-off-title"
            className="text-lg font-semibold text-text-primary"
          >
            Explain mismatch
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Explain why the quantity for {subject} does not match. This stays
            visible in the audit trail.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <Select
            label="What happened?"
            value={reason}
            onChange={(event) =>
              setReason(event.target.value as WriteOffReason)
            }
          >
            {LOSS_REASONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {allowRepackaged && (
              <option value={REPACKAGED_REASON.value}>
                {REPACKAGED_REASON.label}
              </option>
            )}
          </Select>
          <Input
            label={
              isRepackaged
                ? `Current count (${unit === "package" ? "packages" : formatIn(1, unit)})`
                : `Quantity (${unit === "package" ? "packages" : formatIn(1, unit)})`
            }
            type="number"
            min={isRepackaged ? 0 : 1}
            max={isRepackaged ? undefined : remaining}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            error={quantityError}
          />
          <label className="flex flex-col gap-1.5 text-sm font-medium text-text-secondary">
            Note <span className="font-normal text-text-muted">(optional)</span>
            <textarea
              className="min-h-20 rounded-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-transparent focus:outline-none focus:ring-2 focus:ring-brand"
              maxLength={1000}
              placeholder="Add any useful detail"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          {error && <p className="text-sm text-error">{error}</p>}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            loading={saving}
            disabled={Boolean(quantityError)}
          >
            Save explanation
          </Button>
        </div>
      </div>
    </div>
  );
}
