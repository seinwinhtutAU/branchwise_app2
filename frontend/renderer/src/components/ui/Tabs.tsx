import type { ReactNode } from "react";
import { cn } from "@renderer/lib/utils";

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  badge?: ReactNode;
}

interface TabBarProps<T extends string = string> {
  tabs: readonly TabItem<T>[] | TabItem<T>[];
  activeTab: T;
  onSelect: (tabId: T) => void;
  className?: string;
}

export function TabBar<T extends string = string>({
  tabs,
  activeTab,
  onSelect,
  className,
}: TabBarProps<T>): React.JSX.Element {
  return (
    <div
      role="tablist"
      className={cn(
        "flex items-center gap-1 border-b border-border w-full overflow-x-auto no-scrollbar",
        className,
      )}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(tab.id)}
            className={cn(
              "group relative flex items-center gap-2 px-3.5 py-2 text-sm font-medium transition-all duration-150 cursor-pointer whitespace-nowrap select-none",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
              isActive
                ? "text-brand font-semibold"
                : "text-text-muted hover:text-text-primary hover:bg-bg-subtle/60 rounded-t-md",
            )}
          >
            {tab.icon && (
              <span
                className={cn(
                  "w-4 h-4 transition-colors",
                  isActive
                    ? "text-brand"
                    : "text-text-muted group-hover:text-text-secondary",
                )}
              >
                {tab.icon}
              </span>
            )}
            <span>{tab.label}</span>
            {typeof tab.count === "number" && (
              <span
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-medium transition-colors",
                  isActive
                    ? "bg-brand-subtle text-brand font-semibold"
                    : "bg-bg-subtle text-text-muted group-hover:text-text-secondary",
                )}
              >
                {tab.count}
              </span>
            )}
            {tab.badge}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand rounded-full" />
            )}
          </button>
        );
      })}
    </div>
  );
}
