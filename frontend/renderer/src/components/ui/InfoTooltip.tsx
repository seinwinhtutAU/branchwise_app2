import { useState, type ReactNode } from "react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  FloatingPortal,
  useClick,
  useDismiss,
  useFloating,
  useFocus,
  useHover,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { cn } from "@renderer/lib/utils";

/**
 * A short, plain-language explanation beside a KPI or table label. Hover works on
 * desktop; click and keyboard focus make the same explanation available on touch
 * devices and without relying on a mouse.
 */
export function InfoTooltip({
  description,
  label = "More information",
  className,
}: {
  description: string;
  label?: string;
  className?: string;
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open: isOpen,
    onOpenChange: setIsOpen,
    placement: "top",
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [offset(7), flip({ padding: 8 }), shift({ padding: 8 })],
  });

  const hover = useHover(context, {
    move: false,
    delay: { open: 120, close: 120 },
  });
  const click = useClick(context);
  const focus = useFocus(context);
  const dismiss = useDismiss(context, { outsidePressEvent: "mousedown" });
  const role = useRole(context, { role: "tooltip" });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    hover,
    click,
    focus,
    dismiss,
    role,
  ]);

  return (
    <>
      <button
        type="button"
        ref={refs.setReference}
        {...getReferenceProps({ onClick: (event) => event.stopPropagation() })}
        aria-label={label}
        className={cn(
          "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[13px] leading-none text-text-muted transition-colors hover:bg-brand-subtle hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand cursor-help",
          isOpen && "bg-brand-subtle text-brand",
          className,
        )}
      >
        <span aria-hidden="true">ⓘ</span>
      </button>

      {isOpen && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 max-w-64 rounded-md border border-border bg-bg-base px-2.5 py-2 text-left text-xs leading-relaxed text-text-secondary shadow-lg"
          >
            {description}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

export function InfoLabel({
  children,
  description,
  className,
}: {
  children: ReactNode;
  description: string;
  className?: string;
}): React.JSX.Element {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children}
      <InfoTooltip
        description={description}
        label={`About ${typeof children === "string" ? children : "this value"}`}
      />
    </span>
  );
}
