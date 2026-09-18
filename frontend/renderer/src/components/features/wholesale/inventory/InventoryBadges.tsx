// Small UI components shared within the Inventory feature.

import { useEffect, useRef, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { RefreshButton } from "@renderer/components/ui/RefreshButton";
import { EyeIcon, MoreIcon } from "@renderer/components/ui/icons";
import {
  DotPill,
  FloatingLayer,
  MenuItem,
} from "@renderer/components/features/wholesale/shared/ui";
import { formatSets } from "@renderer/components/features/wholesale/shared/units";
import { type StockRecord } from "@renderer/components/features/wholesale/inventory/stock";
import {
  HEALTH_STYLES,
  MOVEMENT_LABELS,
  MOVEMENT_STYLES,
  type InventoryHealth,
} from "./types";
import { inventoryHealth, stockPlaces } from "./inventoryUtils";

// ── Section Tabs ─────────────────────────────────────────────────────────────

export function InventorySectionTabs({
  section,
  onChange,
}: {
  section: "overview" | "locations" | "movement";
  onChange: (section: "overview" | "locations" | "movement") => void;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      aria-label="Inventory information"
      className="flex items-center gap-1 border-b border-border"
    >
      {(
        [
          ["overview", "Overview"],
          ["locations", "Stock Record"],
          ["movement", "Movement"],
        ] as const
      ).map(([value, label]) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={section === value}
          onClick={() => onChange(value)}
          className={cn(
            "-mb-px border-b-2 px-4 py-3 text-sm font-semibold transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            section === value
              ? "border-brand text-brand"
              : "border-transparent text-text-muted hover:text-text-primary",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Refresh Button ────────────────────────────────────────────────────────────

export function InventoryRefreshButton({
  onRefresh,
  refreshing,
}: {
  onRefresh: () => void;
  refreshing: boolean;
}): React.JSX.Element {
  return (
    <RefreshButton
      onClick={onRefresh}
      refreshing={refreshing}
    />
  );
}

// ── Row Menu ──────────────────────────────────────────────────────────────────

export function StockRowMenu({
  onView,
}: {
  onView: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointer(event: MouseEvent): void {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        aria-label="Stock actions"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "p-1.5 rounded-md text-text-muted",
          "transition-colors duration-150",
          "hover:bg-bg-raised hover:text-text-primary active:bg-bg-subtle",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        )}
      >
        <MoreIcon className="w-4 h-4" />
      </button>
      {open && (
        <FloatingLayer
          anchorRef={ref}
          align="right"
          className="min-w-44 bg-bg-base border border-border rounded-lg shadow-lg py-1 animate-fade-in"
        >
          <MenuItem
            icon={<EyeIcon className="w-4 h-4" />}
            label="View details"
            onClick={() => {
              setOpen(false);
              onView();
            }}
          />
        </FloatingLayer>
      )}
    </div>
  );
}

// ── Health Badge ──────────────────────────────────────────────────────────────

export function HealthBadge({
  record,
}: {
  record: StockRecord;
}): React.JSX.Element {
  const health = inventoryHealth(record);
  const style = HEALTH_STYLES[health as InventoryHealth];
  return (
    <DotPill label={health} className={style.bg} dotClassName={style.dot} />
  );
}

// ── Movement Badge ────────────────────────────────────────────────────────────

export function MovementTypeBadge({
  type,
}: {
  type: string;
}): React.JSX.Element {
  const style = MOVEMENT_STYLES[type] ?? {
    bg: "bg-bg-raised text-text-secondary border border-border-strong",
    dot: "bg-text-muted",
  };
  return (
    <DotPill
      label={MOVEMENT_LABELS[type] ?? type}
      className={style.bg}
      dotClassName={style.dot}
    />
  );
}

// ── Stock Places (inline) ─────────────────────────────────────────────────────

export function StockPlaces({
  record,
}: {
  record: StockRecord;
}): React.JSX.Element {
  const places = stockPlaces(record);
  if (places.length === 0)
    return <span className="text-text-muted">Nowhere yet</span>;

  const shown = places.slice(0, 2);
  const hidden = places.length - shown.length;
  return (
    <span
      title={places
        .map((place) => `${place.label} ${formatSets(place.pairs)}`)
        .join(" · ")}
    >
      {shown.map((place, index) => (
        <span key={place.label}>
          {index > 0 && <span className="text-text-muted"> · </span>}
          {place.label}{" "}
          <span className="tabular-nums text-text-muted">
            {formatSets(place.pairs)}
          </span>
        </span>
      ))}
      {hidden > 0 && <span className="text-text-muted"> · +{hidden} more</span>}
    </span>
  );
}

// ── Detail Tabs ───────────────────────────────────────────────────────────────

export function StockDetailTabs({
  tab,
  onChange,
  orderCount,
  movementCount,
}: {
  tab: "overview" | "orders" | "movement" | "pipeline";
  onChange: (tab: "overview" | "orders" | "movement" | "pipeline") => void;
  orderCount: number;
  movementCount: number;
}): React.JSX.Element {
  const tabs: {
    value: "overview" | "orders" | "movement" | "pipeline";
    label: string;
    count: number | null;
  }[] = [
    { value: "overview", label: "Overview", count: null },
    { value: "orders", label: "Customer Orders", count: orderCount },
    { value: "movement", label: "Movement", count: movementCount },
    { value: "pipeline", label: "Pipeline", count: null },
  ];
  return (
    <div
      role="tablist"
      aria-label="Stock sections"
      className="flex flex-wrap items-center gap-1 border-b border-border px-4"
    >
      {tabs.map(({ value, label, count }) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={tab === value}
          onClick={() => onChange(value)}
          className={cn(
            "-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            tab === value
              ? "border-brand text-brand"
              : "border-transparent text-text-muted hover:text-text-primary",
          )}
        >
          <span>{label}</span>
          {count !== null && count > 0 && (
            <span
              className={cn(
                "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold leading-none tabular-nums",
                tab === value
                  ? "bg-brand text-white"
                  : "border border-brand-pill bg-brand-subtle text-brand",
              )}
            >
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
