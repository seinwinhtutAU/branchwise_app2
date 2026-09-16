import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  label?: ReactNode;
  size?: "sm" | "md";
}

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked,
      onChange,
      disabled = false,
      label,
      size = "sm",
      className,
      ...props
    },
    ref,
  ) => {
    const isSm = size === "sm";

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={cn(
          "group inline-flex items-center gap-2 select-none cursor-pointer focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      >
        <span
          className={cn(
            "relative inline-flex shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
            isSm ? "h-5 w-9" : "h-6 w-11",
            checked
              ? "bg-brand"
              : "bg-border-strong group-hover:bg-text-muted/40",
          )}
        >
          <span
            className={cn(
              "pointer-events-none inline-block rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
              isSm ? "h-4 w-4" : "h-5 w-5",
              isSm
                ? checked
                  ? "translate-x-4"
                  : "translate-x-0"
                : checked
                  ? "translate-x-5"
                  : "translate-x-0",
            )}
          />
        </span>
        {label && (
          <span
            className={cn(
              "font-medium transition-colors",
              isSm ? "text-xs" : "text-sm",
              checked ? "text-brand font-semibold" : "text-text-muted",
            )}
          >
            {label}
          </span>
        )}
      </button>
    );
  },
);
Switch.displayName = "Switch";
