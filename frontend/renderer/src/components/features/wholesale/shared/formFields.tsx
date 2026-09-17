// The plain data-entry widgets every wholesale form is built from: labelled text/number
// fields, a suggest-as-you-type box, and the group/currency pickers. Pulled out of ui.tsx
// because they are a distinct concern from that file's page-chrome and layout primitives.

import { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { Input } from "@renderer/components/ui/Input";
import { Textarea } from "@renderer/components/ui/Textarea";
import { onlyDigits } from "@renderer/components/features/wholesale/shared/shared";
import { CURRENCY_CODES, type CurrencyCode } from "@renderer/components/features/wholesale/shared/currency";
import {
  GROUP_LABELS,
  PRODUCT_GROUPS,
  type ProductGroup,
} from "@renderer/components/features/wholesale/shared/products";
import {
  UNIT_LABELS,
  type Unit,
} from "@renderer/components/features/wholesale/shared/units";
import { CopyButton, EDITABLE, FloatingLayer } from "./ui";

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

