import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  error?: string;
  hint?: string;
  startIcon?: ReactNode;
}

// Pure primitive — no skeleton/empty state (exempt per rubric).
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, startIcon, className, id, ...props }, ref) => {
    const inputId =
      id ??
      (typeof label === "string"
        ? label.toLowerCase().replace(/\s+/g, "-")
        : undefined);
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-text-secondary"
          >
            {label}
          </label>
        )}
        <div className="relative">
          {startIcon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none">
              {startIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "w-full h-10 rounded-md border bg-bg-base px-3 text-sm text-text-primary",
              "placeholder:text-text-muted",
              "transition-all duration-150",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-bg-subtle",
              error
                ? "border-error focus-visible:ring-error"
                : "border-border hover:border-border-strong",
              startIcon && "pl-9",
              className,
            )}
            aria-invalid={!!error}
            {...props}
          />
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = "Input";
