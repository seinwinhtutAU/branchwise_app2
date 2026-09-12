import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@renderer/lib/utils";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "destructive";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    "bg-brand text-white hover:bg-brand-hover active:bg-brand-active shadow-sm",
  secondary:
    "bg-bg-base text-text-primary border border-border hover:bg-bg-raised active:bg-bg-subtle",
  ghost:
    "text-text-secondary hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
  destructive:
    "bg-error text-white hover:bg-red-700 active:bg-red-800 shadow-sm",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-sm gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-base gap-2",
};

// Pure primitive — no skeleton/empty state (exempt per rubric).
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading,
      className,
      children,
      disabled,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center font-medium rounded-md whitespace-nowrap",
        "transition-all duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
        "active:scale-[0.98] motion-reduce:active:scale-100",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner className="w-4 h-4" />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";
