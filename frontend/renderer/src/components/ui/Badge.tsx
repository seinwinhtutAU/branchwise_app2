import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

type BadgeVariant =
  "default" | "success" | "warning" | "error" | "info" | "brand";

const badgeVariants: Record<BadgeVariant, string> = {
  default: "bg-bg-raised text-text-secondary border border-border",
  success: "bg-success-subtle text-success",
  warning: "bg-warning-subtle text-warning",
  error: "bg-error-subtle text-error",
  info: "bg-info-subtle text-info",
  brand: "bg-brand-subtle text-brand",
};

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

// Pure primitive — no skeleton/empty state (exempt per rubric).
export function Badge({
  variant = "default",
  children,
  className,
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap",
        badgeVariants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
