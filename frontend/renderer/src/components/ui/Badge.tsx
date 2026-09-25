import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

export type BadgeVariant =
  "default" | "success" | "warning" | "error" | "info" | "brand";

const badgeVariants: Record<BadgeVariant, string> = {
  default: "bg-bg-raised text-text-secondary border border-border-strong",
  success: "bg-success-subtle text-success border border-success-pill",
  warning: "bg-warning-subtle text-warning border border-warning-pill",
  error: "bg-error-subtle text-error border border-error-pill",
  info: "bg-brand-subtle text-brand border border-brand-pill",
  brand: "bg-brand-subtle text-brand border border-brand-pill",
};

const dotColors: Record<BadgeVariant, string> = {
  default: "bg-text-muted",
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  info: "bg-info",
  brand: "bg-brand",
};

interface BadgeProps {
  variant?: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
  className?: string;
  title?: string;
}

// Pure primitive — no skeleton/empty state (exempt per rubric).
export function Badge({
  variant = "default",
  dot = false,
  children,
  className,
  title,
}: BadgeProps): React.JSX.Element {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium whitespace-nowrap",
        badgeVariants[variant],
        className,
      )}
    >
      {dot && (
        <span
          className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColors[variant])}
        />
      )}
      {children}
    </span>
  );
}
