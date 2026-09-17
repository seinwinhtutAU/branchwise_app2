import {
  autoUpdate,
  flip,
  FloatingPortal,
  offset,
  shift,
  size,
  useFloating,
} from "@floating-ui/react";
import { useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { cn } from "@renderer/lib/utils";
import { Input } from "@renderer/components/ui/Input";
import { Textarea } from "@renderer/components/ui/Textarea";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
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
import { CURRENCY_CODES, type CurrencyCode } from "@renderer/components/features/wholesale/currency";
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
  type Unit,
} from "@renderer/components/features/wholesale/units";

// The pieces every wholesale screen is built from. They lived in four copies, one per
// page, which is exactly how the four screens kept drifting apart: a fix to one never
// reached the others. One copy now, so a change to a panel, a figure card or a step bar
// lands on Customer Orders, Supplier Vouchers, Delivery and Receiving at once.

/** How many rows a wholesale list shows before paging. */
export const PAGE_SIZE = 10;

/** The tint on every box a person is meant to fill in. */
export const EDITABLE =
  "bg-warning-subtle border-warning/50 hover:border-warning focus-visible:ring-brand";

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
  singleLine = false,
}: {
  value: string;
  /** What this reference is, for the copy button's screen-reader label. */
  what?: string;
  onClick?: () => void;
  singleLine?: boolean;
}): React.JSX.Element {
  const cut = value.lastIndexOf("-");
  const head = cut > 0 ? value.slice(0, cut) : value;
  const tail = cut > 0 ? value.slice(cut) : "";
  // Each half stays on its own line — never broken again by a narrow column, which is
  // how "SHP-260827" became three lines once the copy button took part of the width.
  const body = singleLine ? (
    <span className="whitespace-nowrap">{value}</span>
  ) : (
    <>
      <span className="block whitespace-nowrap">{head}</span>
      {tail && <span className="block whitespace-nowrap">{tail}</span>}
    </>
  );

  return (
    <span className={cn("inline-flex gap-1", singleLine ? "items-center" : "items-start")}>
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
        "bg-bg-base border border-border rounded-md overflow-hidden",
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

function toneBorder(tone: Tone): string {
  return tone === "warning"
    ? "border-t-warning"
    : tone === "success"
      ? "border-t-success"
      : tone === "error"
        ? "border-t-error"
        : tone === "neutral"
          ? "border-t-border-strong"
          : "border-t-brand";
}

/** A figure to read, not a control: no hover response and nothing to click, so it never
 *  suggests an action it does not have. */
export function FigureCard({
  label,
  value,
  sub,
  tone = "brand",
  compact = false,
  className,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  compact?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "bg-bg-base border border-border border-t-2 rounded-md shadow-sm transition-shadow duration-150",
        toneBorder(tone),
        compact ? "px-2.5 py-1.5" : "px-3.5 py-2.5 sm:px-4 sm:py-3",
        className,
      )}
    >
      <span
        className={cn(
          "block text-[11px] font-semibold uppercase tracking-wider text-text-muted select-none truncate",
          compact ? "mb-0.5" : "mb-1",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "block font-bold tabular-nums tracking-tight font-mono leading-tight",
          compact ? "text-base sm:text-lg mb-0.5" : "text-lg sm:text-xl mb-0.5",
          toneText(tone),
        )}
      >
        {value}
      </span>
      {sub && (
        <span className="block text-[11px] text-text-muted/80 leading-normal truncate select-none">
          {sub}
        </span>
      )}
    </div>
  );
}

/** A compact, row-end entry point for explaining a discovered mismatch. */
export function MismatchIconButton({
  explained = false,
  disabled = false,
  className,
  onClick,
}: {
  explained?: boolean;
  disabled?: boolean;
  className?: string;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label="Explain mismatch"
      title={
        explained ? "View or add mismatch explanation" : "Explain mismatch"
      }
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded-full border text-xs font-bold leading-none transition-colors shadow-sm",
        explained
          ? "border-warning bg-warning text-white"
          : "border-warning/70 bg-bg-base text-warning hover:bg-warning hover:text-white",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      !
    </button>
  );
}

/** A bar with its percentage beside it, at row height. */
export function RowProgress({
  pct,
  label = "Progress",
  className,
}: {
  pct: number;
  label?: string;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={cn("flex items-center gap-2 min-w-[7rem] w-full", className)}>
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
          "text-xs font-semibold tabular-nums w-9 text-right shrink-0",
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

/** The same pill as StatusPill, with a leading colour dot — the shape every order/
 *  voucher status and payment badge across the wholesale screens actually uses. The
 *  words, background and dot colour still belong to each screen. */
export function DotPill({
  label,
  className,
  dotClassName,
}: {
  label: string;
  className: string;
  dotClassName: string;
}): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap select-none",
        className,
      )}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotClassName)} />
      {label}
    </span>
  );
}

/** The product's range — man, lady or child — as a quiet tag beside its description. Kept
 *  grey rather than colour-coded: it is a label, not a status, and colour on this screen
 *  already means "good" or "still owed". */
export function GroupTag({
  product_group,
}: {
  product_group: ProductGroup;
}): React.JSX.Element {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-bg-subtle border border-border text-text-secondary whitespace-nowrap">
      {GROUP_LABELS[product_group]}
    </span>
  );
}

/** A product value on one table line: description first, product_group underneath.
 *
 *  The stock code is rendered by the surrounding table because it may also need a copy
 *  action. Keeping the remaining values as plain stacked text makes the Product column
 *  read like one compact three-line value instead of a nested badge. */
export function ProductCell({
  description,
  product_group,
}: {
  description: string;
  product_group: ProductGroup;
}): React.JSX.Element {
  return (
    <div className="flex min-w-[9rem] flex-col items-start gap-0.5">
      <span className="break-words text-text-primary leading-snug">
        {description || "—"}
      </span>
      <span className="text-xs text-text-muted">
        {GROUP_LABELS[product_group]}
      </span>
    </div>
  );
}

/** Picks a product's product_group inside a table cell. */
export function GroupSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ProductGroup;
  onChange: (product_group: ProductGroup) => void;
}): React.JSX.Element {
  return (
    <div className="relative">
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as ProductGroup)}
        className={cn(
          "w-full h-9 rounded-md border border-border px-2 text-sm text-text-primary",
          EDITABLE,
          "pr-2 transition-all duration-150",
          "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent",
        )}
      >
        {PRODUCT_GROUPS.map((product_group) => (
          <option key={product_group} value={product_group}>
            {GROUP_LABELS[product_group]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Which currency an order line, voucher line, or receiving cost was priced in. MMK is
 *  the default and needs no other field; picking another currency is what makes a
 *  form show its original-amount and exchange-rate inputs (see each page's line
 *  form) — this select only ever carries the code itself. */
export function CurrencySelect({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: CurrencyCode;
  onChange: (currency_code: CurrencyCode) => void;
  className?: string;
}): React.JSX.Element {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as CurrencyCode)}
      className={cn(
        "h-9 rounded-md border border-border px-2 text-sm text-text-primary",
        EDITABLE,
        "transition-all duration-150",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent",
        className,
      )}
    >
      {CURRENCY_CODES.map((code) => (
        <option key={code} value={code}>
          {code}
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
  wrap = false,
  className,
}: {
  label: string;
  value: string;
  /** Shows a copy button — for the references people pass on to someone else. */
  copyable?: boolean;
  /** Lets long values remain fully visible instead of being truncated. */
  wrap?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={className}>
      <dt className="text-sm font-medium text-text-secondary mb-1.5">
        {label}
      </dt>
      <dd
        className={cn(
          "bg-bg-subtle border border-border rounded-md px-3 text-sm text-text-primary flex justify-between gap-2",
          wrap
            ? "min-h-10 h-auto items-start py-2 whitespace-normal break-words"
            : "h-10 items-center",
        )}
      >
        <span className={wrap ? "whitespace-normal break-words" : "truncate"}>
          {value || "—"}
        </span>
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
                  "w-12 sm:w-24 md:w-32 h-0.5 mx-3 sm:mx-4",
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

/**
 * Render a floating layer outside panels and table scrollports. Dropdowns and row
 * action menus must be able to extend past rounded cards; an absolutely positioned
 * child cannot do that when one of its ancestors has overflow clipping.
 */
export function FloatingLayer({
  anchorRef,
  children,
  className,
  align = "left",
  matchAnchorWidth = false,
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
  className: string;
  align?: "left" | "right";
  matchAnchorWidth?: boolean;
}): React.JSX.Element {
  const { refs, floatingStyles } = useFloating({
    placement: align === "right" ? "bottom-end" : "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
      size({
        padding: 8,
        apply({ availableHeight, elements, rects }) {
          if (matchAnchorWidth) {
            elements.floating.style.width = `${rects.reference.width}px`;
          }
          elements.floating.style.maxHeight = `${Math.max(0, availableHeight)}px`;
        },
      }),
    ],
  });

  useEffect(() => {
    refs.setReference(anchorRef.current);
  }, [anchorRef, refs]);

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={{
          ...floatingStyles,
          visibility: refs.reference.current ? "visible" : "hidden",
          zIndex: 100,
        }}
        onMouseDown={(event) => event.stopPropagation()}
        className={className}
      >
        {children}
      </div>
    </FloatingPortal>
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
  value,
  unit,
  placeholder = "0",
  hint,
  error,
  compact = false,
  readOnly = false,
  onChange,
}: {
  label: string;
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
        {/* The unit is shown, not chosen. Offering pair/set/dozen beside the number is
            how "10" meaning pairs becomes sixty pairs, and nothing downstream catches
            it. New figures are counted in sets; a record saved in another unit keeps
            reading in the unit it was written in. */}
        <span className="flex shrink-0 items-center border-l border-border pl-2 pr-3 text-sm text-text-secondary">
          {UNIT_LABELS[unit]}
        </span>
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
  value,
  unit,
  hint,
  error,
  onChange,
}: {
  label: string;
  value: number;
  unit: Unit;
  hint?: string;
  error?: string;
  onChange: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <QuantityInput
      label={label}
      value={draft}
      unit={unit}
      hint={hint}
      error={error}
      onChange={(digits) => {
        setDraft(digits);
        if (digits === "") return;
        onChange(Number(digits));
      }}
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
  multiline = false,
  error,
  className,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  numeric?: boolean;
  type?: "text" | "date";
  multiline?: boolean;
  /** Said plainly under the box when what was typed cannot be read. */
  error?: string;
  className?: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        {multiline ? (
          <>
            <Textarea
              aria-label={label}
              placeholder={placeholder}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className={cn(
                "min-h-9 px-2",
                EDITABLE,
                "placeholder:text-text-muted",
                error && "border-error focus-visible:ring-error",
                className,
              )}
              aria-invalid={error ? true : undefined}
            />
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
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
  error,
  onBlur,
}: {
  label: React.ReactNode;
  placeholder: string;
  suggestions: readonly string[];
  value: string;
  onChange: (value: string) => void;
  bare?: boolean;
  error?: string;
  onBlur?: () => void;
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
        error={error}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
      />
      {open && matches.length > 0 && (
        <FloatingLayer
          anchorRef={ref}
          matchAnchorWidth
          className="bg-bg-base border border-border rounded-md shadow-lg animate-fade-in"
        >
          <ul role="listbox" className="max-h-44 overflow-y-auto py-1">
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
        </FloatingLayer>
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

export function JourneyArrow({
  direction = "right",
}: {
  direction?: "left" | "right";
} = {}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center px-2 shrink-0 text-text-muted",
        direction === "left" && "rotate-180",
      )}
      aria-hidden
    >
      <ArrowRightIcon className="w-6 h-6" />
    </div>
  );
}

/** Editing an existing payment's amount. Keeps its own draft text so clearing the box to
 *  retype a number does not immediately snap back to the old amount — a plain input bound
 *  straight to `payment.amount` rejects (and un-shows) every keystroke that briefly leaves
 *  it empty or invalid, which made an existing payment feel impossible to edit in place. The
 *  committed amount (and so "Paid so far") only updates once the typed value is valid. */
function PaymentAmountCell({
  paid_on,
  value,
  balance,
  onChange,
  error,
}: {
  paid_on: string;
  value: number;
  balance: number;
  onChange: (amount: number) => void;
  error?: string;
}): React.JSX.Element {
  const [text, setText] = useState(String(value));
  const room = balance + value;

  // The committed amount can change from outside this box — another edit reverted, the
  // voucher/order reloaded after Save — so the draft still has to follow it.
  useEffect(() => {
    setText(String(value));
  }, [value]);

  const typed = Number(text) || 0;
  const tooMuch = text.trim() !== "" && typed > room;

  function handleChange(next: string): void {
    setText(next);
    const amount = Number(next) || 0;
    if (amount > 0 && amount <= room) {
      onChange(amount);
    }
  }

  return (
    <CellInput
      label={`Amount for payment on ${formatDate(paid_on)}`}
      placeholder="0"
      numeric
      className="text-right"
      value={text}
      onChange={handleChange}
      error={tooMuch ? `Only ${formatKyat(room)} is available.` : error}
    />
  );
}

const paymentFormSchema = z.object({
  payments: z.array(
    z.object({
      payment_id: z.string(),
      paid_on: z.string().trim().min(1, "Choose a payment date."),
      amount: z
        .number()
        .finite("Enter a valid amount.")
        .min(0, "Amount cannot be negative."),
      note: z.string(),
    }),
  ),
});

interface PaymentsFormValues {
  payments: Payment[];
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
  onUpdate,
  onRemove,
  readOnly = false,
}: {
  payments: Payment[];
  balance: number;
  who: string;
  onAdd: (payment: Payment) => void;
  onUpdate?: (payment: Payment) => void;
  onRemove: (paymentId: string) => void;
  readOnly?: boolean;
}): React.JSX.Element {
  const {
    control,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isDirty },
  } = useForm<PaymentsFormValues>({
    resolver: zodResolver(paymentFormSchema),
    defaultValues: { payments },
    mode: "onBlur",
    reValidateMode: "onChange",
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "payments",
  });
  const formPayments = useWatch({ control, name: "payments" }) as Payment[];
  // A new row joins the table the moment "Add payment" is pressed — the same way a new
  // product line does — rather than living in a separate draft form the amount has to
  // clear a "save" gate to leave. addingId just remembers which row that was, so a
  // "Cancel" can take back an add nobody meant to make.
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (readOnly) setAddingId(null);
  }, [readOnly]);

  // Detail pages own the staged order/voucher draft. Reflect their updates here, while
  // RHF owns the inputs between edits and supplies field-level validation.
  useEffect(() => {
    reset({ payments });
  }, [payments, reset]);

  function addPayment(): void {
    const id = `pay-${Date.now()}`;
    setAddingId(id);
    const payment = {
      payment_id: id,
      paid_on: todayIso(),
      amount: 0,
      note: "",
    };
    append(payment);
    onAdd(payment);
  }

  function cancelAdd(): void {
    if (!addingId) return;
    const index = formPayments.findIndex(
      (payment) => payment.payment_id === addingId,
    );
    if (index >= 0) remove(index);
    onRemove(addingId);
    setAddingId(null);
  }

  function removePayment(index: number, paymentId: string): void {
    remove(index);
    onRemove(paymentId);
    if (paymentId === addingId) setAddingId(null);
  }

  function commitPayment(index: number, payment: Payment): void {
    setValue(`payments.${index}`, payment, {
      shouldDirty: true,
      shouldValidate: true,
    });
    void handleSubmit(() => onUpdate?.(payment))();
  }

  return (
    <div className="flex flex-col gap-3">
      <TableContainer>
        <Thead className="top-0">
          <Tr>
            <Th className="w-40">Date</Th>
            <Th className="text-right w-44">Amount</Th>
            <Th>Note</Th>
            {!readOnly && <Th className="w-10" aria-label="Remove payment" />}
          </Tr>
        </Thead>
        <Tbody>
          {formPayments.length === 0 && (
            <Tr>
              <Td
                colSpan={readOnly ? 3 : 4}
                className="text-text-muted text-sm"
              >
                Nothing paid yet.
              </Td>
            </Tr>
          )}
          {fields.map((field, index) => {
            const payment = formPayments[index];
            if (!payment) return null;
            return (
              <Tr key={field.id}>
                {onUpdate && !readOnly ? (
                  <Td>
                    <Controller
                      control={control}
                      name={`payments.${index}.paid_on`}
                      render={({ field: dateField }) => (
                        <CellInput
                          label={`Payment date for ${formatKyat(payment.amount)}`}
                          placeholder=""
                          type="date"
                          value={dateField.value}
                          onChange={(date) => {
                            dateField.onChange(date);
                            commitPayment(index, { ...payment, paid_on: date });
                          }}
                          error={errors.payments?.[index]?.paid_on?.message}
                        />
                      )}
                    />
                  </Td>
                ) : (
                  <Td className="whitespace-nowrap">
                    {formatDate(payment.paid_on)}
                  </Td>
                )}
                {onUpdate && !readOnly ? (
                  <Td>
                    <Controller
                      control={control}
                      name={`payments.${index}.amount`}
                      render={({ field: amountField }) => (
                        <PaymentAmountCell
                          paid_on={payment.paid_on}
                          value={amountField.value}
                          balance={balance}
                          onChange={(amount) => {
                            amountField.onChange(amount);
                            commitPayment(index, { ...payment, amount });
                          }}
                          error={errors.payments?.[index]?.amount?.message}
                        />
                      )}
                    />
                  </Td>
                ) : (
                  <Td className="text-right tabular-nums font-medium">
                    {formatKyat(payment.amount)}
                  </Td>
                )}
                {onUpdate && !readOnly ? (
                  <Td>
                    <Controller
                      control={control}
                      name={`payments.${index}.note`}
                      render={({ field: noteField }) => (
                        <CellInput
                          label={`Note for payment on ${formatDate(payment.paid_on)}`}
                          placeholder="Deposit, transfer, cash…"
                          value={noteField.value}
                          onChange={(note) => {
                            noteField.onChange(note);
                            commitPayment(index, { ...payment, note });
                          }}
                        />
                      )}
                    />
                  </Td>
                ) : (
                  <Td className="text-text-muted">{payment.note || "—"}</Td>
                )}
                {!readOnly && (
                  <Td className="text-center">
                    <button
                      type="button"
                      onClick={() => removePayment(index, payment.payment_id)}
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
                )}
              </Tr>
            );
          })}
          <Tr className="bg-bg-subtle hover:bg-bg-subtle">
            <Td className="font-semibold">Paid so far</Td>
            <Td className="text-right tabular-nums font-semibold text-success">
              {formatKyat(
                formPayments.reduce((sum, payment) => sum + payment.amount, 0),
              )}
            </Td>
            <Td colSpan={readOnly ? 1 : 2} className="text-text-muted">
              {balance > 0
                ? `${formatKyat(balance)} still unpaid`
                : balance < 0
                  ? `${formatKyat(-balance)} overpaid — reconcile this payment`
                  : "Nothing left to pay"}
            </Td>
          </Tr>
        </Tbody>
      </TableContainer>

      <div className="flex flex-wrap items-center gap-2">
        {!readOnly ? (
          <>
            <Button
              size="sm"
              title={
                isDirty
                  ? "Payment changes are pending Save changes."
                  : undefined
              }
              onClick={addPayment}
            >
              <PlusIcon className="w-4 h-4" />
              Add payment
            </Button>
            {addingId && (
              <Button
                variant="ghost"
                size="sm"
                className={SOFT_RED}
                onClick={cancelAdd}
              >
                Cancel
              </Button>
            )}
          </>
        ) : null}
        {balance <= 0 && formPayments.length > 0 && (
          <span className="text-xs text-text-muted">
            {balance < 0
              ? `This ${who} is overpaid by ${formatKyat(-balance)}.`
              : `This ${who} has paid in full.`}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Desktop Floating Batch Action Bar
 * Appears whenever one or more items are selected in the table.
 */
export function BatchActionBar({
  selectedCount,
  onClear,
  children,
}: {
  selectedCount: number;
  onClear: () => void;
  children: React.ReactNode;
}): React.JSX.Element | null {
  useEffect(() => {
    if (selectedCount <= 0) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClear();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCount, onClear]);

  if (selectedCount <= 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-bg-base border border-border-strong shadow-xl rounded-lg px-4 py-2.5 flex items-center gap-3 animate-slide-up select-none">
      <div className="flex items-center gap-2 pr-3 border-r border-border">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand text-white text-xs font-bold tabular-nums">
          {selectedCount}
        </span>
        <span className="text-xs font-semibold text-text-primary">
          selected
        </span>
      </div>

      <div className="flex items-center gap-2">{children}</div>

      <button
        type="button"
        onClick={onClear}
        className="ml-1 text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded hover:bg-bg-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        title="Deselect all (Esc)"
      >
        Clear <span className="text-[10px] opacity-70">(Esc)</span>
      </button>
    </div>
  );
}

/**
 * Slide-over Master-Detail Quick Inspector Drawer
 * Opens without full-page navigation. Allows fast sequential review with Up/Down or Prev/Next.
 */
export function QuickInspectorDrawer({
  isOpen,
  onClose,
  title,
  subtitle,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  fullPageAction,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  fullPageAction?: { label: string; onClick: () => void };
  children: React.ReactNode;
}): React.JSX.Element | null {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowUp" && onPrev && hasPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowDown" && onNext && hasNext) {
        e.preventDefault();
        onNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onPrev, onNext, hasPrev, hasNext, onClose]);

  if (!isOpen) return null;

  return (
    <FloatingPortal>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/25 z-40 animate-fade-in backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <aside
        aria-label="Quick inspector"
        className="fixed top-0 right-0 h-full w-full sm:w-[500px] bg-bg-base border-l border-border shadow-2xl z-50 flex flex-col animate-slide-left select-text"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-bg-subtle select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-sm font-bold text-text-primary truncate">
              {title}
            </h2>
            {subtitle}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Prev/Next arrows */}
            {(onPrev || onNext) && (
              <div className="flex items-center border border-border rounded-md mr-2 bg-bg-base">
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={!hasPrev}
                  aria-label="Previous (↑)"
                  title="Previous (Arrow Up)"
                  className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary transition-colors"
                >
                  <ChevronLeftIcon className="w-4 h-4" />
                </button>
                <div className="w-[1px] h-3.5 bg-border" />
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!hasNext}
                  aria-label="Next (↓)"
                  title="Next (Arrow Down)"
                  className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary transition-colors"
                >
                  <ChevronRightIcon className="w-4 h-4" />
                </button>
              </div>
            )}

            {fullPageAction && (
              <Button
                variant="secondary"
                size="sm"
                onClick={fullPageAction.onClick}
                className="text-xs mr-1"
              >
                {fullPageAction.label}
              </Button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close inspector (Esc)"
              title="Close inspector (Esc)"
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-raised hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {children}
        </div>
      </aside>
    </FloatingPortal>
  );
}

