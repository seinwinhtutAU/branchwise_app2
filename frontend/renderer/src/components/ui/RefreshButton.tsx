import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";
import { RefreshIcon } from "./icons";

type Variant = "primary" | "secondary" | "ghost";
type Size = "sm" | "md" | "lg";

interface RefreshButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** True while a network fetch or refetch is in flight. Spins the refresh icon and disables clicks. */
  refreshing?: boolean;
  /** Synonym for refreshing to match standard Button's `loading` prop if passed. */
  loading?: boolean;
  /** Button style variant (default "secondary"). */
  variant?: Variant;
  /** Button size (default "sm"). */
  size?: Size;
  /** Optional custom icon class name (default matches size). */
  iconClassName?: string;
  /** Optional label text if a caller wants icon + text; defaults to icon-only. */
  label?: string;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-hover active:bg-brand-active shadow-sm",
  secondary:
    "bg-bg-base text-text-primary border border-border hover:bg-bg-raised active:bg-bg-subtle",
  ghost:
    "text-text-secondary hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
};

const iconSizes: Record<Size, string> = {
  sm: "w-4 h-4",
  md: "w-4 h-4",
  lg: "w-5 h-5",
};

const sizesWithLabel: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs gap-1.5",
  md: "h-10 px-3.5 text-sm gap-2",
  lg: "h-11 px-4 text-base gap-2",
};

const sizesIconOnly: Record<Size, string> = {
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-11 w-11",
};

// Reusable refresh button featuring a crisp RefreshIcon that smoothly animates (spins) while refreshing.
export const RefreshButton = forwardRef<HTMLButtonElement, RefreshButtonProps>(
  (
    {
      refreshing,
      loading,
      variant = "secondary",
      size = "sm",
      iconClassName,
      label,
      className,
      disabled,
      title = "Refresh",
      "aria-label": ariaLabel = "Refresh",
      type = "button",
      ...props
    },
    ref,
  ) => {
    const isBusy = Boolean(refreshing || loading);
    const resolvedTitle = isBusy ? "Refreshing…" : title;
    const resolvedAriaLabel = isBusy ? "Refreshing…" : ariaLabel;

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isBusy}
        aria-label={resolvedAriaLabel}
        aria-busy={isBusy}
        title={resolvedTitle}
        className={cn(
          "inline-flex items-center justify-center font-medium rounded-md whitespace-nowrap",
          "transition-all duration-150 shrink-0 select-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
          "active:scale-[0.98] motion-reduce:active:scale-100",
          variants[variant],
          label ? sizesWithLabel[size] : sizesIconOnly[size],
          className,
        )}
        {...props}
      >
        <RefreshIcon
          className={cn(
            iconSizes[size],
            "shrink-0 transition-transform duration-300",
            isBusy && "animate-spin motion-reduce:animate-none",
            iconClassName,
          )}
        />
        {label && <span>{label}</span>}
      </button>
    );
  },
);

RefreshButton.displayName = "RefreshButton";
