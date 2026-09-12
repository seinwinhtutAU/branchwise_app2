// Pieces both wholesale screens need: the money and quantity formatting, the colour
// shorthand staff write by hand, and the payment vocabulary. One copy, so a customer
// order and a factory voucher can never drift into showing the same thing two ways.

/** The ERD's payment_account.payment_status. Worked out from what has actually been
 *  paid rather than stored, so a badge can never disagree with the figures beside it. */
import { toPairs, type Unit } from "./units";

export type PaymentStatus = "unpaid" | "partial" | "paid";

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

export interface ColorQty {
  color: string;
  qty: number;
  /** The unit letter the colour carried — "black2p" is two pairs whatever the rest of
   *  the row is counted in. Only missing while the line is still being typed; a saved
   *  line always has one. */
  unit?: Unit;
}

/** The letter a colour can carry to say what it is counted in. */
const UNIT_LETTERS: Record<string, Unit> = {
  p: "pair",
  s: "set",
  d: "dozen",
};

export function parseColorQty(text: string): ColorQty[] {
  return text
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

/** What a colour line comes to in pairs. Every saved colour carries its own letter; a
 *  colour halfway through being typed falls back to the row's unit so the running total
 *  still shows something. */
export function colorQtyPairs(text: string, rowUnit: Unit): number {
  return parseColorQty(text).reduce(
    (sum, entry) => sum + toPairs(entry.qty, entry.unit ?? rowUnit),
    0,
  );
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

export const SUPPLIER_NAMES = [
  "Goody Factory",
  "Lek",
  "Nilin",
  "Maldini",
  "Panda Shoes",
];
