import { useState, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { ChevronDownIcon, ChevronUpIcon } from "@renderer/components/ui/icons";

interface CollapsibleKpiSummaryProps {
  children: ReactNode;
  storageKey?: string;
  defaultExpanded?: boolean;
  className?: string;
  title?: string;
}

export function CollapsibleKpiSummary({
  children,
  storageKey,
  defaultExpanded = true,
  className,
  title = "Overview Metrics",
}: CollapsibleKpiSummaryProps): React.JSX.Element {
  const [expanded, setExpanded] = useState<boolean>(() => {
    if (!storageKey || typeof window === "undefined") return defaultExpanded;
    try {
      const stored = window.localStorage.getItem(`branchwise:kpi_expanded:${storageKey}`);
      if (stored !== null) return stored === "true";
    } catch {
      // localStorage may be unavailable
    }
    return defaultExpanded;
  });

  const toggle = (): void => {
    setExpanded((prev) => {
      const next = !prev;
      if (storageKey && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(`branchwise:kpi_expanded:${storageKey}`, String(next));
        } catch {
          // ignore
        }
      }
      return next;
    });
  };

  if (!expanded) {
    return (
      <div
        className={cn(
          "flex items-center justify-between px-3 py-1.5 rounded-lg border border-border/70 bg-bg-subtle/50 text-xs text-text-muted transition-all duration-150",
          className,
        )}
      >
        <span className="font-semibold text-[11px] uppercase tracking-wider text-text-muted select-none">
          {title}
        </span>
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-1 font-medium text-brand hover:underline py-0.5 px-1.5 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand select-none cursor-pointer"
          aria-expanded={false}
          title="Show summary cards"
        >
          <ChevronDownIcon className="w-3.5 h-3.5" />
          <span>Show summary</span>
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center justify-end -mb-0.5">
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-text-muted hover:text-text-primary transition-colors py-0.5 px-1.5 rounded hover:bg-bg-raised focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand select-none cursor-pointer"
          aria-expanded={true}
          title="Hide summary cards"
        >
          <ChevronUpIcon className="w-3.5 h-3.5" />
          <span>Hide summary</span>
        </button>
      </div>
      {children}
    </div>
  );
}
