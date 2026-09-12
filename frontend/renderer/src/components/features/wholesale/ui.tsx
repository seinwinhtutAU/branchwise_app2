import { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { Input } from "@renderer/components/ui/Input";
import {
  ArrowRightIcon,
  CheckIcon,
  CopyIcon,
  PlusIcon,
  TrashIcon,
} from "@renderer/components/ui/icons";
import {
  formatDate,
  formatKyat,
  onlyDigits,
  todayIso,
} from "@renderer/components/features/wholesale/shared";
import { type Payment } from "@renderer/components/features/wholesale/customerOrders";
import { Button } from "@renderer/components/ui/Button";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  GROUP_LABELS,
  PRODUCT_GROUPS,
  type ProductGroup,
} from "@renderer/components/features/wholesale/products";
import {
  UNIT_LABELS,
  UNITS,
  type Unit,
} from "@renderer/components/features/wholesale/units";

// The pieces every wholesale screen is built from. They lived in four copies, one per
// page, which is exactly how the four screens kept drifting apart: a fix to one never
// reached the others. One copy now, so a change to a panel, a figure card or a step bar
// lands on Customer Orders, Supplier Vouchers, Delivery and Receiving at once.

/** How many rows a wholesale list shows before paging. */
export const PAGE_SIZE = 10;

/** The tint on every box a person is meant to fill in. */
export const EDITABLE = "bg-brand-subtle";

/** Blue, but pale: actions in the same family as the filled primary button without
 *  competing with it. */
export const SOFT_BLUE =
  "bg-brand-subtle text-brand border-brand/40 hover:bg-brand-subtle hover:border-brand";

/** Red in the text only, so a form full of rows does not become a wall of red blocks. */
export const SOFT_RED = "text-error hover:bg-error-subtle hover:text-error";

export type Tone = "brand" | "neutral" | "warning" | "success" | "error";

/** A field name with the red star that marks it as one that has to be filled in. */
export function Required({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      {children} <span className="text-error">*</span>
    </>
  );
}

/** Puts a reference on the clipboard. The renderer is not always a secure context — a
 *  packaged app is served from file:// — where `navigator.clipboard` is missing, so the
 *  old hidden-textarea trick is kept as the fallback rather than the copy silently doing
 *  nothing. */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    document.body.removeChild(box);
  }
}

/** The small copy button beside a reference number or a stock code. These are the strings
 *  people carry to a phone call, a chat message or the supplier's own paperwork, and
 *  retyping "RCV-260912-0001" by eye is where a wrong digit gets in. It stays visible
 *  rather than appearing on hover: an icon that only shows up when the pointer is already
 *  on it is an icon nobody finds. */
export function CopyButton({
  value,
  what,
}: {
  value: string;
  /** What is being copied, for the screen reader — "shipment no.", "stock code". */
  what: string;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    <button
      type="button"
      title={copied ? "Copied" : `Copy ${what}`}
      aria-label={`Copy ${what} ${value}`}
      onClick={(event) => {
        event.stopPropagation();
        void copyText(value).then(() => {
          setCopied(true);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setCopied(false), 1200);
        });
      }}
      className={cn(
        "shrink-0 rounded-sm p-0.5 transition-colors duration-150",
        copied
          ? "text-success"
          : "text-text-muted hover:text-brand hover:bg-brand-subtle",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
      )}
    >
      {copied ? (
        <CheckIcon className="w-3.5 h-3.5" />
      ) : (
        <CopyIcon className="w-3.5 h-3.5" />
      )}
    </button>
  );
}

/** A reference on two lines — SHP-260827 over -0001 — so a column of them stays narrow
 *  while the whole reference is still readable, with a copy button beside it. */
export function Reference({
  value,
  what = "reference",
  onClick,
}: {
  value: string;
  /** What this reference is, for the copy button's screen-reader label. */
  what?: string;
  onClick?: () => void;
}): React.JSX.Element {
  const cut = value.lastIndexOf("-");
  const head = cut > 0 ? value.slice(0, cut) : value;
  const tail = cut > 0 ? value.slice(cut) : "";
  // Each half stays on its own line — never broken again by a narrow column, which is
  // how "SHP-260827" became three lines once the copy button took part of the width.
  const body = (
    <>
      <span className="block whitespace-nowrap">{head}</span>
      {tail && <span className="block whitespace-nowrap">{tail}</span>}
    </>
  );

  return (
    <span className="inline-flex items-start gap-1">
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className={cn(
            "text-left font-semibold text-brand tabular-nums rounded-sm",
            "hover:underline underline-offset-2",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
          )}
        >
          {body}
        </button>
      ) : (
        <span className="font-semibold tabular-nums">{body}</span>
      )}
      <CopyButton value={value} what={what} />
    </span>
  );
}

function toneText(tone: Tone): string {
  return tone === "warning"
    ? "text-warning"
    : tone === "success"
      ? "text-success"
      : tone === "error"
        ? "text-error"
        : tone === "neutral"
          ? "text-text-secondary"
          : "text-brand";
}

/** The white panel every wholesale screen is built out of. */
export function Panel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "bg-bg-base border border-border rounded-xl overflow-hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A section heading inside a panel — small, upper case, quiet. */
export function SectionLabel({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-3">
      {children}
    </h3>
  );
}

/** A figure to read, not a control: no hover response and nothing to click, so it never
 *  suggests an action it does not have. */
export function FigureCard({
  label,
  value,
  sub,
  tone = "brand",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: Tone;
}): React.JSX.Element {
  return (
    <div className="bg-bg-base border border-border rounded-xl p-5">
      <span className="block text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
        {label}
      </span>
      <span
        className={cn(
          "block text-2xl font-bold tabular-nums leading-none mb-1.5",
          toneText(tone),
        )}
      >
        {value}
      </span>
      <span className="block text-xs text-text-muted">{sub}</span>
    </div>
  );
}

/** A bar with its percentage beside it, at row height. */
export function RowProgress({
  pct,
  label = "Progress",
}: {
  pct: number;
  label?: string;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 min-w-[7rem]">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="flex-1 h-2 rounded-full bg-bg-raised overflow-hidden"
      >
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none",
            pct === 100 ? "bg-success" : "bg-brand",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={cn(
          "text-xs font-semibold tabular-nums w-9 text-right",
          pct === 100
            ? "text-success"
            : pct === 0
              ? "text-text-muted"
              : "text-brand",
        )}
      >
        {pct}%
      </span>
    </div>
  );
}

/** A filled status pill. The words and colors belong to each screen; the shape does not. */
export function StatusPill({
  label,
  className,
}: {
  label: string;
  className: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap",
        className,
      )}
    >
      {label}
    </span>
  );
}

/** The product's range — man, lady or child — as a quiet tag beside its description. Kept
 *  grey rather than colour-coded: it is a label, not a status, and colour on this screen
 *  already means "good" or "still owed". */
export function GroupTag({
  group,
}: {
  group: ProductGroup;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-bg-subtle border border-border text-text-secondary whitespace-nowrap">
      {GROUP_LABELS[group]}
    </span>
  );
}

/** A product on one table line: what it is, and which range it belongs to.
 *
 *  Stacked, not side by side. A description and a tag competing for one narrow column
 *  left "Ladies' rubber slipper" broken across three or four lines with the tag pushed
 *  around between them. On its own line the description has the whole column to itself
 *  and reads as one phrase, with the group sitting quietly underneath. */
export function ProductCell({
  description,
  group,
}: {
  description: string;
  group: ProductGroup;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-start gap-1 min-w-[9rem]">
      <span className="text-text-primary leading-snug">
        {description || "—"}
      </span>
      <GroupTag group={group} />
    </div>
  );
}

/** Picks a product's group inside a table cell. */
export function GroupSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ProductGroup;
  onChange: (group: ProductGroup) => void;
}): React.JSX.Element {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as ProductGroup)}
      className={cn(
        "w-full h-9 rounded-md border border-border px-2 text-sm text-text-primary",
        EDITABLE,
        "transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent",
      )}
    >
      {PRODUCT_GROUPS.map((group) => (
        <option key={group} value={group}>
          {GROUP_LABELS[group]}
        </option>
      ))}
    </select>
  );
}

/** A value the reader can see but not change. */
export function ReadOnlyField({
  label,
  value,
  copyable = false,
  className,
}: {
  label: string;
  value: string;
  /** Shows a copy button — for the references people pass on to someone else. */
  copyable?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={className}>
      <dt className="text-xs text-text-muted mb-1">{label}</dt>
      <dd className="bg-bg-subtle border border-border rounded-md px-3 py-2 text-sm text-text-primary flex items-center justify-between gap-2">
        <span className="truncate">{value || "—"}</span>
        {copyable && value && (
          <CopyButton value={value} what={label.toLowerCase()} />
        )}
      </dd>
    </div>
  );
}

/** A fact on a review step. */
export function ReviewFact({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={className}>
      <dt className="text-xs text-text-muted mb-1">{label}</dt>
      <dd className="text-sm font-medium text-text-primary">{value}</dd>
    </div>
  );
}

/** Numbered circles joined by rules, ticked green as each step is passed. */
export function StepBar({
  steps,
  step,
}: {
  steps: readonly string[];
  step: number;
}): React.JSX.Element {
  return (
    <ol className="flex items-center flex-wrap gap-y-2">
      {steps.map((label, index) => {
        const done = index < step;
        const active = index === step;
        return (
          <li key={label} className="flex items-center">
            <span
              className={cn(
                "w-9 h-9 rounded-full border-2 flex items-center justify-center text-sm font-semibold",
                "transition-colors duration-150 motion-reduce:transition-none",
                done && "bg-success border-success text-white",
                active && "bg-brand border-brand text-white",
                !done && !active && "bg-bg-base border-border text-text-muted",
              )}
            >
              {done ? <CheckIcon className="w-4 h-4" /> : index + 1}
            </span>
            <span
              className={cn(
                "ml-3 text-sm font-semibold",
                active && "text-brand",
                done && "text-success",
                !done && !active && "text-text-muted",
              )}
            >
              {label}
            </span>
            {index < steps.length - 1 && (
              <span
                className={cn(
                  "w-10 sm:w-16 h-0.5 mx-4",
                  done ? "bg-success" : "bg-border",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** One row of a dropdown menu. */
export function MenuItem({
  icon,
  label,
  danger,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  danger?: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-2.5 px-3.5 py-2 text-sm text-left",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:bg-bg-subtle",
        danger
          ? "text-error hover:bg-error-subtle"
          : "text-text-secondary hover:bg-bg-subtle hover:text-text-primary",
      )}
    >
      {icon ?? <span className="w-4" />}
      {label}
    </button>
  );
}

/** A whole number typed into a form, as a plain text box. `type="number"` fights the
 *  person typing: its arrows nudge the value, a scroll over it changes it, and a
 *  half-typed figure can read back as empty. */
export function CountField({
  label,
  value,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  hint?: string;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <Input
      label={label}
      type="text"
      inputMode="numeric"
      className={cn(EDITABLE, "text-right")}
      hint={hint}
      value={draft}
      onChange={(event) => {
        const digits = onlyDigits(event.target.value);
        setDraft(digits);
        // An empty box is a figure half-typed, not a zero.
        if (digits === "") return;
        onChange(Number(digits));
      }}
      onBlur={() => setDraft(String(value))}
    />
  );
}

/** A quantity and the unit it is counted in, as one box rather than two controls side by
 *  side. The unit is part of the figure — "50" means nothing until you know whether it is
 *  sets or pairs — so it sits inside the same frame, to the right of the number, the way
 *  a currency sits beside an amount. Two separate fields also never lined up: the number
 *  carried a hint underneath and the unit did not, which pushed one below the other. */
export function QuantityInput({
  label,
  unitLabel,
  value,
  unit,
  placeholder = "0",
  hint,
  error,
  compact = false,
  readOnly = false,
  onChange,
  onUnitChange,
}: {
  label: string;
  /** What the unit picker is called to a screen reader. */
  unitLabel: string;
  value: string;
  unit: Unit;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** Table-cell height, for a quantity typed inside a row. */
  compact?: boolean;
  /** When true, the quantity is derived from another field and cannot be typed directly. */
  readOnly?: boolean;
  onChange: (digits: string) => void;
  onUnitChange: (unit: Unit) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      {!compact && (
        <span className="text-sm font-medium text-text-secondary">{label}</span>
      )}
      <div
        className={cn(
          "flex items-stretch rounded-md border overflow-hidden",
          EDITABLE,
          compact ? "h-9" : "h-10",
          "transition-all duration-150",
          "focus-within:ring-2 focus-within:ring-brand focus-within:ring-offset-1 focus-within:ring-offset-bg-base focus-within:border-transparent",
          error
            ? "border-error focus-within:ring-error"
            : "border-border hover:border-border-strong",
        )}
      >
        <input
          aria-label={label}
          type="text"
          inputMode="numeric"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(onlyDigits(event.target.value))}
          aria-invalid={!!error}
          className={cn(
            "w-full min-w-0 bg-transparent px-3 text-sm text-right text-text-primary",
            "placeholder:text-text-muted focus:outline-none",
            readOnly && "cursor-default",
          )}
          readOnly={readOnly}
        />
        <select
          aria-label={unitLabel}
          value={unit}
          onChange={(event) => onUnitChange(event.target.value as Unit)}
          disabled={readOnly}
          className={cn(
            "shrink-0 border-l border-border bg-transparent pl-2 pr-1 text-sm text-text-secondary",
            "cursor-pointer focus:outline-none disabled:cursor-default disabled:opacity-100",
          )}
        >
          {UNITS.map((entry) => (
            <option key={entry} value={entry}>
              {UNIT_LABELS[entry]}
            </option>
          ))}
        </select>
      </div>
      {error && <p className="text-xs text-error">{error}</p>}
      {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

/** The same box, for a figure already stored as a number. Keeps its own draft so an empty
 *  box reads as a figure half-typed rather than as a zero. */
export function QuantityField({
  label,
  unitLabel,
  value,
  unit,
  hint,
  onChange,
  onUnitChange,
}: {
  label: string;
  unitLabel: string;
  value: number;
  unit: Unit;
  hint?: string;
  onChange: (value: number) => void;
  onUnitChange: (unit: Unit) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <QuantityInput
      label={label}
      unitLabel={unitLabel}
      value={draft}
      unit={unit}
      hint={hint}
      onChange={(digits) => {
        setDraft(digits);
        if (digits === "") return;
        onChange(Number(digits));
      }}
      onUnitChange={onUnitChange}
    />
  );
}

/** A box typed straight into a table cell. */
export function CellInput({
  label,
  placeholder,
  value,
  numeric = false,
  type = "text",
  error,
  className,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  numeric?: boolean;
  type?: "text" | "date";
  /** Said plainly under the box when what was typed cannot be read. */
  error?: string;
  className?: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <input
        type={type}
        inputMode={numeric ? "numeric" : undefined}
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) =>
          onChange(
            numeric ? onlyDigits(event.target.value) : event.target.value,
          )
        }
        className={cn(
          "w-full h-9 rounded-md border border-border px-2 text-sm text-text-primary",
          EDITABLE,
          "placeholder:text-text-muted",
          "transition-all duration-150",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent",
          error && "border-error focus-visible:ring-error",
          className,
        )}
        aria-invalid={error ? true : undefined}
      />
      {error && <span className="text-xs text-error">{error}</span>}
    </div>
  );
}

/** Type a name, or pick one already used. Our own list rather than a native `<datalist>`,
 *  which the operating system draws and which therefore ignores the app's theme. */
export function SuggestInput({
  label,
  placeholder,
  suggestions,
  value,
  onChange,
  /** Inside a table cell there is no room for a label above the box. */
  bare = false,
}: {
  label: React.ReactNode;
  placeholder: string;
  suggestions: readonly string[];
  value: string;
  onChange: (value: string) => void;
  bare?: boolean;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const query = value.trim().toLowerCase();
  const matches = suggestions.filter((name) =>
    query === "" ? true : name.toLowerCase().includes(query),
  );

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Input
        label={bare ? undefined : label}
        aria-label={bare && typeof label === "string" ? label : undefined}
        className={EDITABLE}
        placeholder={placeholder}
        value={value}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {open && matches.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-30 left-0 right-0 top-full mt-1 max-h-44 overflow-y-auto bg-bg-base border border-border rounded-md shadow-lg py-1 animate-fade-in"
        >
          {matches.map((name) => (
            <li key={name}>
              <button
                type="button"
                role="option"
                aria-selected={name === value}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 text-sm text-text-secondary transition-colors duration-150 hover:bg-bg-subtle hover:text-text-primary"
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── The journey ──────────────────────────────────────────────────────────────
// Every wholesale screen shows the same journey — goods leaving a supplier, travelling,
// and reaching a gate — so every screen draws it the same way: a coloured band naming the
// stage over a tinted body carrying what that stage knows, joined by arrows. Delivery
// fills the bodies with package counts because it has them; Customer Orders and Supplier
// Vouchers fill them with where the goods have got to.

export type JourneyStage = "supplier" | "cargo" | "stop" | "final";

const JOURNEY_FACE: Record<JourneyStage, string> = {
  supplier: "var(--color-journey-supplier)",
  cargo: "var(--color-journey-cargo)",
  stop: "var(--color-journey-stop)",
  final: "var(--color-journey-final)",
};

const JOURNEY_SOFT: Record<JourneyStage, string> = {
  supplier: "var(--color-journey-supplier-soft)",
  cargo: "var(--color-journey-cargo-soft)",
  stop: "var(--color-journey-stop-soft)",
  final: "var(--color-journey-final-soft)",
};

export function JourneyFace(stage: JourneyStage): string {
  return JOURNEY_FACE[stage];
}

export function JourneySoft(stage: JourneyStage): string {
  return JOURNEY_SOFT[stage];
}

/** One stage of the journey. `faded` greys a stage the goods have not reached yet. */
export function JourneyCard({
  stage,
  title,
  subtitle,
  done = false,
  doneLabel,
  faded = false,
  children,
}: {
  stage: JourneyStage;
  title: string;
  subtitle?: string;
  done?: boolean;
  doneLabel?: string;
  faded?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col w-44 shrink-0 rounded-xl border border-border overflow-hidden",
        faded && "opacity-45",
      )}
    >
      <div
        style={{ backgroundColor: JOURNEY_FACE[stage] }}
        className="px-3 py-2 text-white flex items-start justify-between gap-2"
      >
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide break-words">
            {title}
          </div>
          {subtitle && (
            <div className="text-xs text-white/70 break-words leading-snug">
              {subtitle}
            </div>
          )}
        </div>
        {done && (
          <span
            title={doneLabel}
            aria-label={doneLabel}
            className="flex items-center justify-center w-5 h-5 rounded-full bg-success text-white shrink-0"
          >
            <CheckIcon className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <dl
        style={{ backgroundColor: JOURNEY_SOFT[stage] }}
        className="flex-1 divide-y divide-border"
      >
        {children}
      </dl>
    </div>
  );
}

/** A line inside a journey card: a label and its figure. */
export function JourneyRow({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  /** Given on a figure that should come to nothing — true reads settled, false outstanding. */
  good?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 py-2">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd
        className={cn(
          "text-sm font-bold tabular-nums",
          good === undefined
            ? "text-text-primary"
            : good
              ? "text-success"
              : "text-error",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function JourneyArrow(): React.JSX.Element {
  return (
    <div
      className="flex items-center px-2 shrink-0 text-text-muted"
      aria-hidden
    >
      <ArrowRightIcon className="w-6 h-6" />
    </div>
  );
}

/** The money taken against one order or one voucher, and the box for writing down the
 *  next payment.
 *
 *  Payments are kept one by one rather than as a single "paid" figure, because that is how
 *  they happen: a deposit, then something on delivery, then the rest. A single figure
 *  somebody edits cannot answer "when did that money come in?", and two people adjusting
 *  it cannot both be right. Everything above it — paid so far, unpaid amount, the status
 *  pill — is the sum of this table.
 *
 *  Both screens use it, so a payment to a supplier is recorded exactly the way a payment
 *  from a customer is. */
export function PaymentsTable({
  payments,
  balance,
  /** "customer" or "supplier" — only used to say who the money is to or from. */
  who,
  onAdd,
  onRemove,
}: {
  payments: Payment[];
  balance: number;
  who: string;
  onAdd: (payment: Payment) => void;
  onRemove: (paymentId: string) => void;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [date, setDate] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const value = Number(amount) || 0;
  const tooMuch = value > balance;
  const canSave = value > 0 && !tooMuch;

  function save(): void {
    onAdd({
      payment_id: `pay-${Date.now()}`,
      date,
      amount: value,
      note: note.trim(),
    });
    setAdding(false);
    setDate(todayIso());
    setAmount("");
    setNote("");
  }

  return (
    <div className="flex flex-col gap-3">
      <TableContainer>
        <Thead className="top-0">
          <Tr>
            <Th className="w-40">Date</Th>
            <Th className="text-right w-44">Amount</Th>
            <Th>Note</Th>
            <Th className="w-10" aria-label="Remove payment" />
          </Tr>
        </Thead>
        <Tbody>
          {payments.length === 0 && !adding && (
            <Tr>
              <Td colSpan={4} className="text-text-muted text-sm">
                Nothing paid yet.
              </Td>
            </Tr>
          )}
          {payments.map((payment) => (
            <Tr key={payment.payment_id}>
              <Td className="whitespace-nowrap">{formatDate(payment.date)}</Td>
              <Td className="text-right tabular-nums font-medium">
                {formatKyat(payment.amount)}
              </Td>
              <Td className="text-text-muted">{payment.note || "—"}</Td>
              <Td className="text-center">
                <button
                  type="button"
                  onClick={() => onRemove(payment.payment_id)}
                  title="Remove this payment"
                  aria-label={`Remove the payment of ${formatKyat(payment.amount)}`}
                  className={cn(
                    "p-1.5 rounded-md transition-colors duration-150",
                    SOFT_RED,
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error",
                  )}
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </Td>
            </Tr>
          ))}
          {adding && (
            <Tr className="bg-brand-subtle hover:bg-brand-subtle">
              <Td>
                <CellInput
                  label="Date the money came in"
                  placeholder=""
                  type="date"
                  value={date}
                  onChange={setDate}
                />
              </Td>
              <Td>
                <CellInput
                  label="Amount paid"
                  placeholder="0"
                  numeric
                  className="text-right"
                  value={amount}
                  onChange={setAmount}
                  error={
                    tooMuch
                      ? `Only ${formatKyat(balance)} is still unpaid.`
                      : undefined
                  }
                />
              </Td>
              <Td>
                <CellInput
                  label="Note on this payment"
                  placeholder="Deposit, transfer, cash…"
                  value={note}
                  onChange={setNote}
                />
              </Td>
              <Td />
            </Tr>
          )}
          <Tr className="bg-bg-subtle hover:bg-bg-subtle">
            <Td className="font-semibold">Paid so far</Td>
            <Td className="text-right tabular-nums font-semibold text-success">
              {formatKyat(
                payments.reduce((sum, payment) => sum + payment.amount, 0),
              )}
            </Td>
            <Td colSpan={2} className="text-text-muted">
              {balance > 0
                ? `${formatKyat(balance)} still unpaid`
                : "Nothing left to pay"}
            </Td>
          </Tr>
        </Tbody>
      </TableContainer>

      <div className="flex flex-wrap items-center gap-2">
        {adding ? (
          <>
            <Button size="sm" disabled={!canSave} onClick={save}>
              <CheckIcon className="w-4 h-4" />
              Save payment
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setAdding(false);
                setAmount("");
                setNote("");
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className={SOFT_BLUE}
            disabled={balance <= 0}
            onClick={() => setAdding(true)}
          >
            <PlusIcon className="w-4 h-4" />
            Record payment
          </Button>
        )}
        {balance <= 0 && payments.length > 0 && (
          <span className="text-xs text-text-muted">
            This {who} has paid in full.
          </span>
        )}
      </div>
    </div>
  );
}
