import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: ReactNode;
  error?: string;
  hint?: string;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  size?: "sm" | "md";
}

// Pure primitive — no skeleton/empty state (exempt per rubric).
export const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    { label, error, hint, startIcon, endIcon, size = "md", className, id, ...props },
    ref,
  ) => {
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
            <span
              className={cn(
                "absolute top-1/2 -translate-y-1/2 text-text-muted pointer-events-none",
                size === "sm" ? "left-2.5" : "left-3",
              )}
            >
              {startIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              "w-full rounded-md border bg-bg-base text-text-primary",
              size === "sm" ? "h-8 px-2.5 text-xs" : "h-10 px-3 text-sm",
              "placeholder:text-text-muted",
              "transition-all duration-150",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base focus:border-transparent",
              "disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-bg-subtle",
              error
                ? "border-error focus-visible:ring-error"
                : "border-border hover:border-border-strong",
              startIcon && (size === "sm" ? "pl-7" : "pl-9"),
              endIcon && (size === "sm" ? "pr-7" : "pr-9"),
              className,
            )}
            aria-invalid={!!error}
            {...props}
          />
          {endIcon && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
              {endIcon}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-error">{error}</p>}
        {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
      </div>
    );
  },
);
Input.displayName = "Input";
