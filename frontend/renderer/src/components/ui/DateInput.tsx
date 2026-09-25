import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { CalendarIcon } from "./icons";

interface DateInputProps {
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}

function normalizeDateInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  // YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD, YYYY MM DD
  const ymdMatch = trimmed.match(/^(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})$/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // 8 digits: YYYYMMDD
  const digitsMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (digitsMatch) {
    const [, y, m, d] = digitsMatch;
    return `${y}-${m}-${d}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyMatch = trimmed.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return trimmed;
}

export function DateInput({
  label,
  value,
  onChange,
  placeholder = "YYYY-MM-DD",
  className,
  id,
  disabled,
  size = "md",
}: DateInputProps): React.JSX.Element {
  const [text, setText] = useState(value);
  const hiddenPickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  const inputId =
    id ??
    (typeof label === "string"
      ? label.toLowerCase().replace(/\s+/g, "-")
      : undefined);

  function handleTextChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const next = e.target.value;
    setText(next);
    const normalized = normalizeDateInput(next);
    // If it's empty or a valid completed date, send update immediately
    if (!next || /^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      onChange(normalized);
    }
  }

  function handleBlur(): void {
    const normalized = normalizeDateInput(text);
    setText(normalized);
    onChange(normalized);
  }

  function handleCalendarPickerChange(
    e: React.ChangeEvent<HTMLInputElement>,
  ): void {
    const val = e.target.value;
    setText(val);
    onChange(val);
  }

  function openPicker(): void {
    if (disabled) return;
    if (hiddenPickerRef.current) {
      if (typeof hiddenPickerRef.current.showPicker === "function") {
        hiddenPickerRef.current.showPicker();
      } else {
        hiddenPickerRef.current.focus();
        hiddenPickerRef.current.click();
      }
    }
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label
          htmlFor={inputId}
          className="text-sm font-medium text-text-secondary select-none"
        >
          {label}
        </label>
      )}
      <div className="relative flex items-center">
        <input
          id={inputId}
          type="text"
          value={text}
          onChange={handleTextChange}
          onBlur={handleBlur}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "w-full rounded-md border bg-bg-base text-text-primary",
            size === "sm" ? "h-8 pl-2.5 pr-7 text-xs" : "h-10 pl-3 pr-9 text-sm",
            "placeholder:text-text-muted transition-all duration-150 font-mono tracking-tight",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent",
            "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-bg-subtle",
            "border-border hover:border-border-strong",
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={openPicker}
          aria-label="Pick date from calendar"
          title="Pick from calendar"
          className={cn(
            "absolute top-1/2 -translate-y-1/2 text-text-muted hover:text-brand transition-colors p-1 cursor-pointer disabled:pointer-events-none disabled:opacity-50",
            size === "sm" ? "right-1" : "right-2.5",
          )}
        >
          <CalendarIcon className={size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4"} />
        </button>

        {/* Hidden native date input to support the calendar popup */}
        <input
          ref={hiddenPickerRef}
          type="date"
          tabIndex={-1}
          value={/^\d{4}-\d{2}-\d{2}$/.test(text) ? text : ""}
          onChange={handleCalendarPickerChange}
          className="sr-only absolute pointer-events-none opacity-0 w-0 h-0"
        />
      </div>
    </div>
  );
}
