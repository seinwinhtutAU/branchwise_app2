// Pieces both wholesale screens need: the money and quantity formatting, the colour
// shorthand staff write by hand, and the payment vocabulary. One copy, so a customer
// order and a factory voucher can never drift into showing the same thing two ways.

/** The ERD's payment_account.payment_status. Worked out from what has actually been
 *  paid rather than stored, so a badge can never disagree with the figures beside it. */
import { fromPairs, PAIRS_PER, toPairs, type Unit, type UnitConversions } from "./units";

export type PaymentStatus = "unpaid" | "partial" | "paid";

const WRITE_OFF_REASON_LABELS: Record<string, string> = {
  lost_in_transit: "lost in transit",
  damaged: "damaged",
  short_shipped: "short-shipped",
  other: "other",
  repackaged: "repackaged",
};

export function mismatchDescription(entry: {
  reason: string;
  quantity: number;
  note: string;
}): string {
  if (entry.reason === "repackaged") {
    return entry.note || `Recounted to ${formatQty(entry.quantity)} packages`;
  }
  return `${formatQty(entry.quantity)} written off — ${WRITE_OFF_REASON_LABELS[entry.reason] ?? entry.reason}`;
}

export function paymentStatusOf(total: number, paid: number): PaymentStatus {
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}

// ── Colour shorthand ─────────────────────────────────────────────────────────
// "black10s,pink2p" is what staff write on paper, so it is what they type here: a colour,
// a count, and the unit it was counted in. The total is worked out from the text rather
// than asked for separately — two fields that must agree are two fields that can disagree,
// and the unit letter is what stops ten sets being read as ten pairs.

interface ColorQty {
  color: string;
  qty: number;
  /** The unit letter the colour carried — "black2p" is two pairs whatever the rest of
   *  the row is counted in. Only missing while the line is still being typed; a saved
   *  line always has one. */
  unit?: Unit;
}

/** The letter a colour — or, below, a plain quantity — can carry to say what it is
 *  counted in. */
const UNIT_LETTERS: Record<string, Unit> = {
  p: "pair",
  s: "set",
  d: "dozen",
};

export function parseColorQty(text: string | null | undefined): ColorQty[] {
  return (text ?? "")
    .split(/[+,]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      // Every colour carries its own unit letter — black1s,black2p,pink1s — so one line
      // can mix them. A colour still being typed has no letter yet; it falls back to the
      // row's unit so the running total keeps up, and the format check below stops it
      // being saved that way.
      const match = /^(.*?)(\d+)\s*([psd])?$/i.exec(part.replace(/\s+/g, " "));
      if (!match) return { color: part, qty: 0 };
      const letter = match[3]?.toLowerCase();
      return {
        color: match[1].trim(),
        qty: Number(match[2]),
        unit: letter ? UNIT_LETTERS[letter] : undefined,
      };
    })
    .filter((entry) => entry.color !== "" || entry.qty > 0);
}

/** Checks a colour line reads the way the business writes them, and says plainly what is
 *  wrong when it does not. Typing is where the mistakes happen — a missing count, a stray
 *  letter, a number with no colour — and a wrong figure here quietly becomes a wrong
 *  quantity everywhere downstream. Returns null when the line is fine. */
export function colorQtyProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  for (const raw of trimmed.split(/[+,]/)) {
    const part = raw.trim();
    if (part === "") return "There is an empty piece — check the commas.";

    const match = /^([A-Za-z ]+?)\s*(\d+)\s*([A-Za-z])?$/.exec(part);
    if (!match) {
      if (/^\d+$/.test(part)) return `"${part}" has no color in front of it.`;
      if (/^[A-Za-z ]+$/.test(part)) return `"${part}" has no count after it.`;
      return `"${part}" is not a color, a count and a unit, like black10s.`;
    }

    if (Number(match[2]) <= 0) return `"${part}" counts nothing.`;

    // Every colour says its own unit. Without one a figure is a guess, and a guess here
    // becomes a wrong quantity on every screen downstream.
    const letter = match[3]?.toLowerCase();
    if (!letter) {
      return `"${part}" needs a unit — s for sets, p for pairs, d for dozens.`;
    }
    if (!UNIT_LETTERS[letter]) {
      return `"${part}" ends in "${match[3]}" — use s for sets, p for pairs, d for dozens.`;
    }
  }
  return null;
}

// ── Plain quantity shorthand ─────────────────────────────────────────────────
// The same idea as the colour shorthand above, minus the colour name: a quantity box
// (a shipment's total packages, a receiving's counted quantity, ...) reads "1s3p" as
// 1 set plus 3 pairs, "13p" as 13 pairs, or a bare "13" as 13 of whatever unit the field
// is already in — so someone can type in whichever unit they're actually counting in,
// or several at once, without a unit picker changing what the field means. Unlike the
// colour shorthand, pieces don't need a comma between them ("1s3p" and "1s+3p" read the
// same) since there's no colour name for a run-together number to be confused with.

interface QuantityShorthandPiece {
  qty: number;
  /** Missing only when the whole box is a single bare number — it then reads in the
   *  field's own unit, same as before this shorthand existed. */
  unit?: Unit;
}

export function parseQuantityShorthand(text: string): QuantityShorthandPiece[] {
  const cleaned = text.trim().replace(/[\s,+]/g, "");
  if (cleaned === "") return [];
  return [...cleaned.matchAll(/(\d+)([psd])?/gi)].map((match) => ({
    qty: Number(match[1]),
    unit: match[2] ? UNIT_LETTERS[match[2].toLowerCase()] : undefined,
  }));
}

/** What a quantity shorthand comes to in pairs, in `fallbackUnit` for any piece typed
 *  without a letter of its own (which can only be the box's one and only piece — see
 *  quantityShorthandProblem). */
export function quantityShorthandPairs(
  text: string,
  fallbackUnit: Unit,
  conversions: UnitConversions = PAIRS_PER,
): number {
  return parseQuantityShorthand(text).reduce(
    (sum, piece) => sum + toPairs(piece.qty, piece.unit ?? fallbackUnit, conversions),
    0,
  );
}

/** Checks a quantity box reads the way the business writes them, and says plainly what
 *  is wrong when it does not — same spirit as colorQtyProblem, but pieces run together
 *  are told apart by their unit letters rather than by a colour name, so every piece
 *  needs one as soon as there is more than one. Returns null when the box is fine. */
export function quantityShorthandProblem(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;

  const cleaned = trimmed.replace(/[\s,+]/g, "");
  const matches = [...cleaned.matchAll(/(\d+)([psd])?/gi)];
  const consumed = matches.reduce((sum, match) => sum + match[0].length, 0);

  if (matches.length === 0 || consumed !== cleaned.length) {
    return `"${trimmed}" isn't a count — try 5, 5p, 5s, or 1s3p.`;
  }
  if (matches.some((match) => Number(match[1]) <= 0)) {
    return `"${trimmed}" counts nothing.`;
  }
  if (matches.length > 1 && matches.some((match) => !match[2])) {
    return `Each piece needs its own unit once there's more than one — s for sets, p for pairs, d for dozens.`;
  }
  return null;
}

/** The reverse of quantityShorthandPairs: a figure already known in pairs, written the
 *  way this shorthand reads it — "2s3p" for two sets and three leftover pairs, "2s" for
 *  an exact number of sets, "3p" for anything smaller than one. For pre-filling a box
 *  with a figure that may not land on a whole set, rather than forcing the whole box to
 *  switch to a different unit just so one number reads exactly. */
export function pairsToQuantityShorthand(
  pairs: number,
  conversions: UnitConversions = PAIRS_PER,
): string {
  if (pairs <= 0) return "";
  const setSize = conversions.set;
  const wholeSets = Math.floor(pairs / setSize);
  const leftoverPairs = pairs % setSize;
  if (wholeSets > 0 && leftoverPairs > 0) return `${wholeSets}s${leftoverPairs}p`;
  if (wholeSets > 0) return `${wholeSets}s`;
  return `${leftoverPairs}p`;
}

/** What a colour line comes to in pairs. Every saved colour carries its own letter; a
 *  colour halfway through being typed falls back to the row's unit so the running total
 *  still shows something. */
export function colorQtyPairs(
  text: string,
  rowUnit: Unit,
  conversions: UnitConversions = PAIRS_PER,
): number {
  return parseColorQty(text).reduce(
    (sum, entry) => sum + toPairs(entry.qty, entry.unit ?? rowUnit, conversions),
    0,
  );
}

/** Derives the displayed quantity from the colour shorthand, rather than asking for it
 *  again in a field of its own — the same rule colorQtyPairs already follows, in the unit
 *  the row actually reads in. Rows that use one unit stay in that unit; mixed units are
 *  represented as pairs so the total stays exact. */
export function quantityFromColors(
  text: string,
  fallbackUnit: Unit,
): { qty: number; unit: Unit } {
  if (text.trim() === "") return { qty: 0, unit: fallbackUnit };

  const entries = parseColorQty(text);
  const units = entries.map((entry) => entry.unit ?? fallbackUnit);
  const unit =
    units.length > 0 && units.every((entry) => entry === units[0])
      ? units[0]
      : "pair";

  return {
    qty: fromPairs(colorQtyPairs(text, fallbackUnit), unit),
    unit,
  };
}

/** A receiving or a delivery only ever records a stock code and a quantity, never which
 *  voucher/order line it satisfies — so two lines for the same stock code would leave
 *  the server unable to say which line the goods actually belong to. Flags the second
 *  (and every later) line carrying a code already used above it; the first occurrence is
 *  left alone so the message points at the one to fix. Returns null when the line is fine. */
export function duplicateStockCodeProblem(
  lines: readonly { stock_code: string }[],
  index: number,
): string | null {
  const code = lines[index]?.stock_code.trim().toLowerCase();
  if (!code) return null;
  const firstIndex = lines.findIndex(
    (line) => line.stock_code.trim().toLowerCase() === code,
  );
  return firstIndex !== -1 && firstIndex !== index
    ? `Already used on line ${firstIndex + 1} — add the quantity there instead.`
    : null;
}

/** Keeps the digits out of whatever was typed into a number field. Those fields are
 *  plain text inputs: `type="number"` fights the person typing — its arrows nudge the
 *  value, a scroll over the field changes it, and a half-typed figure can read back as
 *  empty — so the filtering happens here instead. */
export function onlyDigits(text: string): string {
  return text.replace(/[^\d]/g, "");
}

// ── Formatting ───────────────────────────────────────────────────────────────

const NUMBER = new Intl.NumberFormat("en-US");

// Both formatters guard against a figure that is not a number. Without it a field that
// has not been filled in yet — or a row kept in memory from before that field existed —
// prints "NaN" on screen, which tells the reader nothing and looks broken.
function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

/** The business trades in Myanmar Kyat — never dollars. */
export function formatKyat(amount: number): string {
  return `${NUMBER.format(Math.round(safeNumber(amount)))} Ks`;
}

export function formatQty(qty: number): string {
  return NUMBER.format(safeNumber(qty));
}

export function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A part of a whole as a percentage, safe when the whole is nothing. */
export function sharePct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.min(100, Math.round((part / whole) * 100));
}

/** A reference in the shape the business writes them: PREFIX-YYMMDD-NNNN, as in
 *  RCV-260912-0001. The date is part of the reference so anyone reading one knows when it
 *  was raised without looking it up, and the four digits start again each day. */
export function nextReference(
  prefix: string,
  existing: string[],
  iso = todayIso(),
): string {
  const day = iso.slice(2).replace(/-/g, "");
  const head = `${prefix}-${day}-`;
  const highest = existing.reduce((max, reference) => {
    if (!reference.startsWith(head)) return max;
    const sequence = Number(reference.slice(head.length));
    return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
  }, 0);
  return `${head}${String(highest + 1).padStart(4, "0")}`;
}

// ── Reference data ───────────────────────────────────────────────────────────
// The suppliers (factories) the business buys from. The screens say "Supplier / Factory"
// because staff use both words for the same company.
