// The three units the business counts in, and the one rule that relates them.
//
// A pair is the thing itself. A set is 6 pairs, a dozen is 12. Every quantity in the
// wholesale screens is *stored* in pairs, whatever unit it was typed in, so nothing has to
// be converted twice and no two screens can disagree about what a number means. Only the
// display changes: a gate counts boxes in sets, a customer orders in pairs, and both are
// the same pairs underneath.

export type Unit = "pair" | "set" | "dozen";
export type UnitConversions = Record<Unit, number>;

/** Legacy/default rate used only where a record has no explicit snapshot. */
export const PAIRS_PER: UnitConversions = {
  pair: 1,
  set: 6,
  dozen: 12,
};

/** One of something, for a sentence: "1 set", "3 sets". */
export function unitName(unit: Unit, qty: number): string {
  const one = unit === "dozen" ? "dozen" : unit;
  return qty === 1 ? one : `${one}s`;
}

/** Turns a figure typed in some unit into pairs. */
export function toPairs(qty: number, unit: Unit, conversions: UnitConversions = PAIRS_PER): number {
  return qty * conversions[unit];
}

/** Turns pairs back into a unit. Can come out fractional — 9 pairs is one and a half
 *  sets — so the caller decides how to show it. */
export function fromPairs(pairs: number, unit: Unit, conversions: UnitConversions = PAIRS_PER): number {
  return pairs / conversions[unit];
}

/** The amount for pairs stored at a price staff quoted in the line's unit. */
export function pricedAmount(
  quantityPairs: number,
  unit: Unit,
  price: number,
  conversions: UnitConversions = PAIRS_PER,
): number {
  return (quantityPairs / conversions[unit]) * price;
}

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A quantity written in the requested unit, keeping any incomplete unit as pairs. */
export function formatIn(pairs: number, unit: Unit, conversions: UnitConversions = PAIRS_PER): string {
  const safePairs = Number.isFinite(pairs) ? pairs : 0;
  if (unit === "pair" || safePairs === 0) {
    return `${NUMBER.format(safePairs)} ${unitName("pair", safePairs)}`;
  }

  const whole = Math.floor(safePairs / conversions[unit]);
  const leftover = safePairs % conversions[unit];
  if (whole === 0)
    return `${NUMBER.format(leftover)} ${unitName("pair", leftover)}`;
  if (leftover === 0) return `${NUMBER.format(whole)} ${unitName(unit, whole)}`;
  return `${NUMBER.format(whole)} ${unitName(unit, whole)} ${NUMBER.format(leftover)} ${unitName("pair", leftover)}`;
}

/** The way this business reads a quantity: whole sets with any leftover pairs, e.g.
 *  "1 Set 3 Pairs". Use this for every figure that isn't tied to one document's own
 *  unit — stock on hand, availability, report totals — instead of writing raw pairs. */
export function formatSets(pairs: number, conversions: UnitConversions = PAIRS_PER): string {
  const safePairs = Number.isFinite(pairs) ? pairs : 0;
  // Nothing in stock still belongs in the column's own unit, so it reads "0 Sets" beside
  // "3 Sets" rather than switching to pairs the way formatIn does for an empty figure.
  if (safePairs === 0) return `0 ${unitName("set", 0)}`;
  return formatIn(safePairs, "set", conversions);
}

