import { useState } from "react";
import { Button } from "@renderer/components/ui/Button";
import { CheckIcon } from "@renderer/components/ui/icons";
import {
  Required,
  SuggestInput,
} from "@renderer/components/features/wholesale/shared/ui";
import {
  CARRIER_NAMES,
  DESTINATION_NAMES,
} from "@renderer/components/features/wholesale/masterData/masterData";

/** The strip under the tracking table, used both for adding a destination and for
 *  renaming one. Both names can be picked from what has been used before or simply
 *  typed, since a route can go somewhere new. */
export function DestinationForm({
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
