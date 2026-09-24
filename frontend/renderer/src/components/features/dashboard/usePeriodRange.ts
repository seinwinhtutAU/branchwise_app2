import { useEffect, useMemo, useState } from "react";
import { addDays, mondayOf, toLocalIso, type PeriodKey } from "./helpers";

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
  /** Which calendar month `period === "monthly"` means (YYYY-MM) — only the Dashboard's
   *  own period picker uses this; Business Alerts never sets period to "monthly", so it
   *  stays at its default and is simply never read. Unlike the date inputs above, a
   *  month is picked from a closed list rather than typed, so it applies immediately —
   *  no settle delay needed. */
  month: string;
  setMonth: (month: string) => void;
  /** The day `period === "daily"` means (YYYY-MM-DD) — yesterday until changed. */
  day: string;
  setDay: (day: string) => void;
  /** The Monday of the week `period === "weekly"` means — last week until changed. */
  week: string;
  setWeek: (mondayIso: string) => void;
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
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
  const [month, setMonth] = useState(currentMonth);
  // Yesterday and last week: a finished day or week reads better than one still filling.
  const [day, setDay] = useState(() => addDays(toLocalIso(new Date()), -1));
  const [week, setWeek] = useState(() => addDays(mondayOf(toLocalIso(new Date())), -7));

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

  // A chosen day or week becomes an ordinary from/to range, worked out on the spot (not in
  // an effect) so a tab never fetches with "daily" and no dates. A typed custom range
  // still wins over either. A week that is still running ends today.
  const effective = useMemo(() => {
    if (applied.from && applied.to) return applied;
    if (period === "daily") return { from: day, to: day };
    if (period === "weekly") {
      const sunday = addDays(week, 6);
      const today = toLocalIso(new Date());
      return { from: week, to: sunday < today ? sunday : today };
    }
    return applied;
  }, [applied, period, day, week]);

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
    applied: effective,
    month,
    setMonth,
    day,
    setDay,
    week,
    setWeek,
  };
}
