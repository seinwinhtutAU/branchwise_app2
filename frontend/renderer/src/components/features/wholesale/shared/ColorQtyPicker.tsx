import React, { useCallback } from "react";
import { cn } from "@renderer/lib/utils";
import { formatSets, PAIRS_PER } from "./units";
import { onlyDigits } from "./shared";
import { PencilIcon } from "@renderer/components/ui/icons";
import { type ColorPairs } from "../inventory/stock";

export interface ColorQtyPickerProps {
  available: ColorPairs;
  setSize: number;
  value: ColorPairs;
  onChange: (next: ColorPairs) => void;
  disabled?: boolean;
}

// Memoized because this is rendered once per order/allocation line in a table — an
// unrelated row's keystroke should not re-render every other row's picker.
export const ColorQtyPicker = React.memo(function ColorQtyPicker({
  available,
  setSize,
  value,
  onChange,
  disabled = false,
}: ColorQtyPickerProps): React.JSX.Element {
  const safeSetSize = setSize > 0 ? setSize : PAIRS_PER.set;
  const colorEntries = Object.entries(available);
  const totalChosen = Object.values(value).reduce(
    (sum, pairs) => sum + pairs,
    0,
  );

  const handleSetsChange = useCallback(
    (color: string, rawInput: string): void => {
      const digits = onlyDigits(rawInput);
      const numSets = digits === "" ? 0 : parseInt(digits, 10);
      const avail = available[color] ?? 0;
      const currentTotal = value[color] ?? 0;
      const currentRest = currentTotal % safeSetSize;

      const newTotal = numSets * safeSetSize + currentRest;
      const capped = Math.min(avail, Math.max(0, newTotal));

      const next: ColorPairs = { ...value };
      if (capped > 0) {
        next[color] = capped;
      } else {
        delete next[color];
      }
      onChange(next);
    },
    [available, value, safeSetSize, onChange],
  );

  const handlePairsChange = useCallback(
    (color: string, rawInput: string): void => {
      const digits = onlyDigits(rawInput);
      const numPairs = digits === "" ? 0 : parseInt(digits, 10);
      const avail = available[color] ?? 0;
      const currentTotal = value[color] ?? 0;
      const currentSets = Math.floor(currentTotal / safeSetSize);

      // Typing setSize or more rolls into the Sets box
      const newTotal = currentSets * safeSetSize + numPairs;
      const capped = Math.min(avail, Math.max(0, newTotal));

      const next: ColorPairs = { ...value };
      if (capped > 0) {
        next[color] = capped;
      } else {
        delete next[color];
      }
      onChange(next);
    },
    [available, value, safeSetSize, onChange],
  );

  const handleTakeAll = useCallback(
    (color: string, avail: number): void => {
      if (avail <= 0) return;
      const next: ColorPairs = { ...value, [color]: avail };
      onChange(next);
    },
    [value, onChange],
  );

  const handleClear = useCallback((): void => {
    onChange({});
  }, [onChange]);

  if (colorEntries.length === 0) {
    return (
      <div className="py-1 text-xs text-text-muted">No colors available.</div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-border/60 bg-bg-base/80 p-2 text-xs">
      <div className="flex items-center justify-between border-b border-border/40 pb-1 text-text-muted">
        <span className="font-medium text-text-secondary">Colors</span>
        {totalChosen > 0 && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="text-xs text-text-muted underline decoration-dotted transition-colors hover:text-error"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        {colorEntries.map(([color, avail]) => {
          const currentTotal = value[color] ?? 0;
          const currentSets = Math.floor(currentTotal / safeSetSize);
          const currentRest = currentTotal % safeSetSize;

          return (
            <div
              key={color}
              className="flex flex-col gap-1 rounded bg-bg-subtle/40 p-1.5"
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold capitalize text-text-primary">
                  {color}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={disabled || avail <= 0 || currentTotal === avail}
                    onClick={() => handleTakeAll(color, avail)}
                    className="text-xs font-semibold text-brand transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-30 disabled:no-underline"
                  >
                    Take all
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-0.5">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={disabled || avail <= 0}
                    value={currentSets > 0 ? currentSets : ""}
                    placeholder="0"
                    onChange={(e) => handleSetsChange(color, e.target.value)}
                    aria-label={`${color} sets`}
                    className={cn(
                      "h-6 w-12 rounded border border-border px-1.5 text-right text-xs tabular-nums text-text-primary bg-bg-base",
                      "focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand",
                      (disabled || avail <= 0) &&
                        "cursor-not-allowed bg-bg-subtle opacity-50",
                    )}
                  />
                  <span className="text-[11px] text-text-muted">Sets</span>
                </div>

                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    inputMode="numeric"
                    disabled={disabled || avail <= 0}
                    value={currentRest > 0 ? currentRest : ""}
                    placeholder="0"
                    onChange={(e) => handlePairsChange(color, e.target.value)}
                    aria-label={`${color} pairs`}
                    className={cn(
                      "h-6 w-12 rounded border border-border px-1.5 text-right text-xs tabular-nums text-text-primary bg-bg-base",
                      "focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand",
                      (disabled || avail <= 0) &&
                        "cursor-not-allowed bg-bg-subtle opacity-50",
                    )}
                  />
                  <span className="text-[11px] text-text-muted">Pairs</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/** The picker's resting state: what has been chosen, as words, with a way in.
 *
 *  A table of open pickers is a wall of input boxes, most of them for rows nobody is
 *  touching today. This shows the figure instead and opens the picker when asked. A row
 *  with nothing to pick has nothing to open, so it gets the reason rather than a button
 *  that leads to an empty box. Memoized for the same reason as ColorQtyPicker above —
 *  rendered once per row in a table. */
export const ColorQtySummary = React.memo(function ColorQtySummary({
  value,
  available,
  setSize,
  emptyLabel,
  onEdit,
  disabled = false,
}: {
  value: ColorPairs;
  available: ColorPairs;
  setSize: number;
  /** Why there is nothing to pick, when there is nothing to pick. */
  emptyLabel: string;
  onEdit: () => void;
  disabled?: boolean;
}): React.JSX.Element {
  const conversions = { ...PAIRS_PER, set: setSize > 0 ? setSize : PAIRS_PER.set };
  const chosen = Object.entries(value).filter(([, pairs]) => pairs > 0);
  const hasAnythingToPick = Object.values(available).some((pairs) => pairs > 0);

  if (!hasAnythingToPick && chosen.length === 0) {
    return <span className="text-xs text-text-muted">{emptyLabel}</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm">
        {chosen.length === 0 ? (
          <span className="text-text-muted">Nothing selected</span>
        ) : (
          <span className="font-semibold text-brand">
            {chosen
              .map(([color, pairs]) => `${color} ${formatSets(pairs, conversions)}`)
              .join(", ")}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onEdit}
        disabled={disabled}
        aria-label="Change quantities"
        title="Change quantities"
        className={cn(
          "shrink-0 rounded-md border border-border p-1 text-text-muted transition-colors",
          "hover:border-brand hover:text-brand",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          disabled && "cursor-not-allowed opacity-40 hover:border-border hover:text-text-muted",
        )}
      >
        <PencilIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
});
