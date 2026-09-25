import { useState, type ReactNode } from "react";
import {
  useFloating,
  autoUpdate,
  offset,
  flip,
  shift,
  FloatingPortal,
  useDismiss,
  useRole,
  useInteractions,
} from "@floating-ui/react";
import { cn } from "@renderer/lib/utils";
import { FilterIcon } from "@renderer/components/ui/icons";

interface ColumnHeaderFilterProps {
  label: ReactNode;
  isActive?: boolean;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

export function ColumnHeaderFilter({
  label,
  isActive = false,
  children,
  align = "left",
  className,
}: ColumnHeaderFilterProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);

  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: align === "right" ? "bottom-end" : "bottom-start",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(4),
      flip({ padding: 8 }),
      shift({ padding: 8 }),
    ],
  });

  const dismiss = useDismiss(context, {
    outsidePressEvent: "mousedown",
  });
  const role = useRole(context, { role: "dialog" });

  const { getReferenceProps, getFloatingProps } = useInteractions([
    dismiss,
    role,
  ]);

  return (
    <div
      ref={refs.setReference}
      {...getReferenceProps()}
      className={cn(
        "inline-flex items-center gap-1.5 max-w-full font-semibold",
        align === "right" ? "justify-end flex-row-reverse" : "justify-start",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="truncate select-none">{label}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        aria-expanded={isOpen}
        title="Filter column"
        className={cn(
          "flex items-center justify-center h-4.5 w-4.5 rounded transition-all duration-150 shrink-0 cursor-pointer",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand",
          isActive
            ? "bg-brand text-white shadow-xs"
            : isOpen
              ? "bg-bg-raised text-text-primary border border-border"
              : "text-text-muted hover:text-text-primary hover:bg-bg-raised/80",
        )}
      >
        <FilterIcon className="w-2.5 h-2.5" />
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              zIndex: 9999,
            }}
            {...getFloatingProps()}
            className="min-w-[14rem] max-w-xs rounded-lg border border-border bg-bg-base p-2.5 text-xs shadow-2xl text-text-primary normal-case font-normal"
            onClick={(e) => e.stopPropagation()}
          >
            {children(() => setIsOpen(false))}
          </div>
        </FloatingPortal>
      )}
    </div>
  );
}
