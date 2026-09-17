import { FloatingPortal } from "@floating-ui/react";
import { useEffect } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
} from "@renderer/components/ui/icons";
import { Button } from "@renderer/components/ui/Button";

/**
 * Desktop Floating Batch Action Bar
 * Appears whenever one or more items are selected in the table.
 */
export function BatchActionBar({
  selectedCount,
  onClear,
  children,
}: {
  selectedCount: number;
  onClear: () => void;
  children: React.ReactNode;
}): React.JSX.Element | null {
  useEffect(() => {
    if (selectedCount <= 0) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClear();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedCount, onClear]);

  if (selectedCount <= 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-bg-base border border-border-strong shadow-xl rounded-lg px-4 py-2.5 flex items-center gap-3 animate-slide-up select-none">
      <div className="flex items-center gap-2 pr-3 border-r border-border">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand text-white text-xs font-bold tabular-nums">
          {selectedCount}
        </span>
        <span className="text-xs font-semibold text-text-primary">
          selected
        </span>
      </div>

      <div className="flex items-center gap-2">{children}</div>

      <button
        type="button"
        onClick={onClear}
        className="ml-1 text-xs text-text-muted hover:text-text-primary px-2 py-1 rounded hover:bg-bg-raised transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        title="Deselect all (Esc)"
      >
        Clear <span className="text-[10px] opacity-70">(Esc)</span>
      </button>
    </div>
  );
}

/**
 * Slide-over Master-Detail Quick Inspector Drawer
 * Opens without full-page navigation. Allows fast sequential review with Up/Down or Prev/Next.
 */
export function QuickInspectorDrawer({
  isOpen,
  onClose,
  title,
  subtitle,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  fullPageAction,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  fullPageAction?: { label: string; onClick: () => void };
  children: React.ReactNode;
}): React.JSX.Element | null {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowUp" && onPrev && hasPrev) {
        e.preventDefault();
        onPrev();
      } else if (e.key === "ArrowDown" && onNext && hasNext) {
        e.preventDefault();
        onNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onPrev, onNext, hasPrev, hasNext, onClose]);

  if (!isOpen) return null;

  return (
    <FloatingPortal>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/25 z-40 animate-fade-in backdrop-blur-[1px]"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <aside
        aria-label="Quick inspector"
        className="fixed top-0 right-0 h-full w-full sm:w-[500px] bg-bg-base border-l border-border shadow-2xl z-50 flex flex-col animate-slide-left select-text"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-bg-subtle select-none">
          <div className="flex items-center gap-2.5 min-w-0">
            <h2 className="text-sm font-bold text-text-primary truncate">
              {title}
            </h2>
            {subtitle}
          </div>

          <div className="flex items-center gap-1.5">
            {/* Prev/Next arrows */}
            {(onPrev || onNext) && (
              <div className="flex items-center border border-border rounded-md mr-2 bg-bg-base">
                <button
                  type="button"
                  onClick={onPrev}
                  disabled={!hasPrev}
                  aria-label="Previous (↑)"
                  title="Previous (Arrow Up)"
                  className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary transition-colors"
                >
                  <ChevronLeftIcon className="w-4 h-4" />
                </button>
                <div className="w-[1px] h-3.5 bg-border" />
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!hasNext}
                  aria-label="Next (↓)"
                  title="Next (Arrow Down)"
                  className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30 disabled:hover:text-text-secondary transition-colors"
                >
                  <ChevronRightIcon className="w-4 h-4" />
                </button>
              </div>
            )}

            {fullPageAction && (
              <Button
                variant="secondary"
                size="sm"
                onClick={fullPageAction.onClick}
                className="text-xs mr-1"
              >
                {fullPageAction.label}
              </Button>
            )}

            <button
              type="button"
              onClick={onClose}
              aria-label="Close inspector (Esc)"
              title="Close inspector (Esc)"
              className="w-7 h-7 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-raised hover:text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <CloseIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {children}
        </div>
      </aside>
    </FloatingPortal>
  );
}

