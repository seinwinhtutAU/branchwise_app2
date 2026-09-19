// The plain data-entry widgets every wholesale form is built from: labelled text/number
// fields, a suggest-as-you-type box, and the group/currency pickers. Pulled out of ui.tsx
// because they are a distinct concern from that file's page-chrome and layout primitives.

import { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { Input } from "@renderer/components/ui/Input";
import { Textarea } from "@renderer/components/ui/Textarea";
import {
  onlyDigits,
  parseQuantityShorthand,
  quantityShorthandPairs,
} from "@renderer/components/features/wholesale/shared/shared";
import { CURRENCY_CODES, type CurrencyCode } from "@renderer/components/features/wholesale/shared/currency";
import {
  GROUP_LABELS,
  PRODUCT_GROUPS,
  type ProductGroup,
} from "@renderer/components/features/wholesale/shared/products";
import {
  formatSets,
  type Unit,
  type UnitConversions,
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

/** A quantity input that accepts standard numbers or shorthand pieces like "1s 1p", "13p".
 *  Renders as a clean input box without any fixed unit badge attached. */
export function QuantityInput({
  label,
  value,
  unit,
  conversions,
  placeholder = "0",
  hint,
  error,
  compact = false,
  readOnly = false,
  className,
  onChange,
}: {
  label?: React.ReactNode;
  value: string;
  unit?: Unit;
  conversions?: UnitConversions;
  placeholder?: string;
  hint?: string;
  error?: string;
  /** Table-cell height, for a quantity typed inside a row. */
  compact?: boolean;
  /** When true, the quantity is derived from another field and cannot be typed directly. */
  readOnly?: boolean;
  className?: string;
  onChange: (text: string) => void;
}): React.JSX.Element {
  const pieces = value.trim() === "" ? [] : parseQuantityShorthand(value);
  const showsItsOwnUnit =
    pieces.length > 1 || (pieces.length === 1 && pieces[0].unit !== undefined);

  const calculatedHint =
    !error && showsItsOwnUnit && unit
      ? `= ${formatSets(quantityShorthandPairs(value, unit, conversions), conversions)}`
      : hint;

  return (
    <Input
      label={label}
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={error}
      hint={calculatedHint}
      className={cn(EDITABLE, className)}
      readOnly={readOnly}
      size={compact ? "sm" : "md"}
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
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const query = value.trim().toLowerCase();
  const matches = suggestions.filter((name) =>
    query === "" ? true : name.toLowerCase().includes(query),
  );

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(event.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    return () => document.removeEventListener("mousedown", handlePointer);
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <Input
        ref={inputRef}
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
          anchorRef={inputRef}
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

