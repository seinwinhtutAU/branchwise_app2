// The small pieces the wholesale Revenue, Customer and Inventory dashboard tabs share:
// money and set formatting, ranked bars, a donut, a card with a header link, and the
// footer line. They are drawn with plain SVG/CSS like the retail dashboard's charts.
import type { ReactNode } from "react";
import { Button } from "@renderer/components/ui/Button";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import { DashboardIcon } from "@renderer/components/ui/icons";
import { cn } from "@renderer/lib/utils";
import { SERIES_COLORS } from "./dashboardFormat";

export function DashboardCard({
  title,
  description,
  action,
  onAction,
  className,
  children,
}: {
  title: string;
  description: string;
  /** The link in the header's corner ("View inventory →"), shown only when there is
   *  somewhere to go. */
  action?: string;
  onAction?: () => void;
  className?: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Card className={cn("p-3.5 sm:p-4", className)}>
      <CardHeader
        title={title}
        description={description}
        action={
          action && onAction ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onAction}
              className="h-7 shrink-0 px-2 text-xs text-brand"
            >
              {action} →
            </Button>
          ) : undefined
        }
      />
      {children}
    </Card>
  );
}

export function DashboardFooter({ note }: { note: string }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1 text-xs text-text-muted">
      <span className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Last updated just now
      </span>
      <span>{note}</span>
    </div>
  );
}

export function DashboardLoading({ tiles }: { tiles: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {tiles > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: tiles }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

export function DashboardError({
  title,
  reload,
}: {
  title: string;
  reload: () => Promise<void>;
}): React.JSX.Element {
  return (
    <EmptyState
      icon={<DashboardIcon />}
      title={`Couldn't load the ${title} dashboard`}
      description="Something went wrong reaching the backend."
      action={
        <Button variant="secondary" size="sm" onClick={reload}>
          Try again
        </Button>
      }
    />
  );
}

/** Rows drawn as horizontal bars, longest first, each a shade lighter than the one above
 *  — the "who is biggest" picture used for factories, customers and locations. */
export function RankedBars({
  rows,
  formatValue,
  empty,
  colors,
}: {
  rows: { label: string; value: number }[];
  formatValue: (value: number) => string;
  empty: string;
  /** One colour per row, when the rows are categories rather than a ranking. */
  colors?: string[];
}): React.JSX.Element {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-text-muted">{empty}</p>;
  }
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) => (
        <div key={row.label} className="flex items-center gap-3 text-sm">
          <span className="w-28 shrink-0 truncate text-text-secondary sm:w-32" title={row.label}>
            {row.label}
          </span>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-bg-raised">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((row.value / max) * 100, row.value > 0 ? 3 : 0)}%`,
                background: colors?.[index] ?? SERIES_COLORS.primary,
                opacity: colors ? 1 : Math.max(0.35, 1 - index * 0.2),
              }}
            />
          </div>
          <span className="w-24 shrink-0 text-right font-semibold tabular-nums text-text-primary">
            {formatValue(row.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** A ring split into slices with a figure in the middle. */
export function DonutChart({
  slices,
  centerValue,
  centerLabel,
}: {
  slices: { label: string; value: number; color: string }[];
  centerValue: string;
  centerLabel: string;
}): React.JSX.Element {
  const size = 170;
  const stroke = 30;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${centerValue} ${centerLabel}: ${slices
          .map((slice) => `${slice.label} ${slice.value}`)
          .join(", ")}`}
        className="-rotate-90"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-bg-raised)"
          strokeWidth={stroke}
        />
        {total > 0 &&
          slices.map((slice) => {
            const length = (slice.value / total) * circumference;
            const dash = `${length} ${circumference - length}`;
            const node = (
              <circle
                key={slice.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={stroke}
                strokeDasharray={dash}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return node;
          })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold tabular-nums text-text-primary">{centerValue}</span>
        <span className="text-xs text-text-muted">{centerLabel}</span>
      </div>
    </div>
  );
}
