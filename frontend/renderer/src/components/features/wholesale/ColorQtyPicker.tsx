import React from "react";
import { cn } from "@renderer/lib/utils";
import { PAIRS_PER } from "./units";
import { onlyDigits } from "./shared";
import { type ColorPairs } from "./stock";

export interface ColorQtyPickerProps {
  available: ColorPairs;
  setSize: number;
  value: ColorPairs;
  onChange: (next: ColorPairs) => void;
  disabled?: boolean;
}

export function ColorQtyPicker({
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

  function handleSetsChange(color: string, rawInput: string): void {
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
  }

  function handlePairsChange(color: string, rawInput: string): void {
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
  }

  function handleTakeAll(color: string, avail: number): void {
    if (avail <= 0) return;
    const next: ColorPairs = { ...value, [color]: avail };
    onChange(next);
  }

  function handleClear(): void {
    onChange({});
  }

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
}
