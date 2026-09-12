import { useEffect, useState } from "react";
import type { PeriodKey } from "./helpers";

// How long the custom date inputs must sit unchanged before anything fetches with them.
const CUSTOM_RANGE_SETTLE_MS = 400;

export interface PeriodRange {
  period: PeriodKey;
  setPeriod: (period: PeriodKey) => void;
  dateFrom: string;
  setDateFrom: (value: string) => void;
  dateTo: string;
  setDateTo: (value: string) => void;
  hasCustomRange: boolean;
  clearCustomRange: () => void;
  /** What to actually fetch with — see the settle comment below. */
  applied: { from: string; to: string };
}

/**
 * The period preset plus the optional custom date range, shared by the Dashboard and the
 * Business Alerts page so the two controls behave identically.
 *
 * A native date input fires change on every segment edit — typing a year yields
 * 0002 → 0020 → 0202 → 2026, each a valid date — so fetching straight off the raw values
 * fires a request per keystroke, some for absurd multi-century windows. The raw pair is
 * applied only once it is complete and in order, after a short pause in typing; a range
 * that stays half-finished reverts to the preset after that same pause. Clearing both is
 * applied immediately, since there is nothing to wait for.
 */
export function usePeriodRange(initialPeriod: PeriodKey = "30d"): PeriodRange {
  const [period, setPeriod] = useState<PeriodKey>(initialPeriod);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [applied, setApplied] = useState({ from: "", to: "" });

  useEffect(() => {
    const next =
      dateFrom && dateTo && dateFrom <= dateTo
        ? { from: dateFrom, to: dateTo }
        : { from: "", to: "" };
    if (!dateFrom && !dateTo) {
      setApplied(next);
      return;
    }
    const timer = setTimeout(() => setApplied(next), CUSTOM_RANGE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [dateFrom, dateTo]);

  return {
    period,
    setPeriod,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    hasCustomRange: !!dateFrom && !!dateTo,
    clearCustomRange: () => {
      setDateFrom("");
      setDateTo("");
    },
    applied,
  };
}
