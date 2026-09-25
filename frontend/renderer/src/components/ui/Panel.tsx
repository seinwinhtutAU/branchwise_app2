import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

/**
 * Clean card container panel matching the wholesale design system.
 * Used to wrap data tables, headers, toolbars, and list content with consistent borders and subtle shadows.
 */
export function Panel({
  children,
  className,
  ...props
}: PanelProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "bg-bg-base border border-border rounded-xl shadow-xs overflow-hidden",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export default Panel;
