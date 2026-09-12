// The three units the business counts in, and the one rule that relates them.
//
// A pair is the thing itself. A set is 6 pairs, a dozen is 12. Every quantity in the
// wholesale screens is *stored* in pairs, whatever unit it was typed in, so nothing has to
// be converted twice and no two screens can disagree about what a number means. Only the
// display changes: a gate counts boxes in sets, a customer orders in pairs, and both are
// the same pairs underneath.

export type Unit = "pair" | "set" | "dozen";

export const UNITS: Unit[] = ["pair", "set", "dozen"];

/** How many pairs each unit is worth. The whole conversion lives here. */
export const PAIRS_PER: Record<Unit, number> = {
  pair: 1,
  set: 6,
  dozen: 12,
};

export const UNIT_LABELS: Record<Unit, string> = {
  pair: "Pairs",
  set: "Sets",
  dozen: "Dozens",
};

/** One of something, for a sentence: "1 set", "3 sets". */
export function unitName(unit: Unit, qty: number): string {
  const one = unit === "dozen" ? "dozen" : unit;
  return qty === 1 ? one : `${one}s`;
}

/** Turns a figure typed in some unit into pairs. */
export function toPairs(qty: number, unit: Unit): number {
  return qty * PAIRS_PER[unit];
}

/** Turns pairs back into a unit. Can come out fractional — 9 pairs is one and a half
 *  sets — so the caller decides how to show it. */
export function fromPairs(pairs: number, unit: Unit): number {
  return pairs / PAIRS_PER[unit];
}

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A quantity written in the unit asked for, with its name: "90 pairs", "15 sets". */
export function formatIn(pairs: number, unit: Unit): string {
  const value = Number.isFinite(pairs) ? fromPairs(pairs, unit) : 0;
  return `${NUMBER.format(value)} ${unitName(unit, value)}`;
}

/** The same quantity twice, when both matter: "15 sets (90 pairs)". */
export function formatWithPairs(pairs: number, unit: Unit): string {
  if (unit === "pair") return formatIn(pairs, "pair");
  return `${formatIn(pairs, unit)} (${formatIn(pairs, "pair")})`;
}
