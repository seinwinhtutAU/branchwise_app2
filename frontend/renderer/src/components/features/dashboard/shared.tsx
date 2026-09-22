import { Fragment, useState } from "react";
import { cn } from "@renderer/lib/utils";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { Card } from "@renderer/components/ui/Card";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import {
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
} from "@renderer/components/ui/Table";
import {
  PERIOD_OPTIONS,
  WEEKDAY_LABELS,
  formatShortDate,
  type AlertFact,
  type AlertTable,
  type HealthAlert,
  type PeriodKey,
  type SaleWarningRow,
  type SubMetric,
} from "./helpers";
import type { PeriodRange } from "./usePeriodRange";

// Components only — plain helpers/constants/types live in ./helpers so Vite Fast
// Refresh can hot-swap this file in dev.

// Shown while a tab revalidates behind numbers that are already on screen. Deliberately
// quiet: the data below it is real and usable, it is just a minute old, so this must not
// read like an error or pull the eye away from the figures.
export function RefreshingHint({
  show,
}: {
  show: boolean;
}): React.JSX.Element | null {
  if (!show) return null;
  return (
    <p
      className="text-xs text-text-muted flex items-center gap-1.5"
      role="status"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse motion-reduce:animate-none" />
      Refreshing…
    </p>
  );
}

// Percentages, money and counts inside an alert sentence. Bolding them lets a reader
// take the number off the row at a glance and read the sentence only if they want the
// rest — which is how these actually get read.
const NUMBER_PATTERN =
  /(Ks\s[\d,]+(?:\.\d+)?|[\d,]+(?:\.\d+)?\s?(?:%|percentage points|points|days)|\b[\d,]*\d\b)/g;

function withNumbersEmphasised(text: string): React.ReactNode[] {
  return text.split(NUMBER_PATTERN).map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold text-text-primary">
        {part}
      </strong>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    ),
  );
}

function AlertSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
        {label}
      </span>
      {/* Capped for the same reason as the tables above: a line of prose running the full
          width of the alerts table is hard to track back to the start of the next one. */}
      <p className="text-sm text-text-secondary max-w-4xl">{children}</p>
    </div>
  );
}

/**
 * One measure's raw value — a measure row on the Overview tab, or a figure in an alert's
 * chip row.
 *
 * A movement gets a green/red direction arrow and a signed number — the same ▲/▼ and the
 * same colours the stat tiles use elsewhere on the dashboard, so a reader meets one
 * visual language for "this went up" across the whole app.
 *
 * The colour follows the *direction*, not whether the movement was good: on single-item
 * basket share a rise is a problem, so green means "went up" rather than "went well". The
 * score beside it, or the alert around it, is what judges.
 *
 * A movement in a percentage is shown as a plain "%", not as "percentage points" or "pp":
 * both are correct, but only one of them reads the same as every other percentage on the
 * screen, and consistency is what the business asked for here.
 */
export function MeasureValue({
  value,
  unit,
}: {
  value: number;
  unit: SubMetric["unit"];
}): React.JSX.Element {
  switch (unit) {
    case "pct_change":
    case "pct_points":
      return (
        <span
          className={cn(
            "inline-flex items-baseline gap-1",
            value >= 0 ? "text-success" : "text-error",
          )}
        >
          <span aria-hidden="true" className="text-xs">
            {value >= 0 ? "▲" : "▼"}
          </span>
          <span className="sr-only">{value >= 0 ? "up" : "down"} </span>
          {value >= 0 ? "+" : "−"}
          {Math.abs(value).toFixed(1)}%
        </span>
      );
    case "pct":
      return <>{value.toFixed(1)}%</>;
    case "days":
      return <>{Math.round(value).toLocaleString()} days</>;
    case "rate":
      return <>{value.toFixed(1)} per 100</>;
    case "count":
      return <>{Math.round(value).toLocaleString()}</>;
  }
}

/**
 * The alert's figures, laid out as labelled rows.
 *
 * This is the part the business asked for by name: not a sentence claiming the margin
 * fell, but the sales, the cost of goods, what was kept, and the margin — each with what
 * it was before and by how much it moved — so the claim can be checked rather than taken.
 * A row with no `before` is simply a fact ("Products affected · 3 of 908").
 *
 * Every value arrives preformatted from the server, next to the sentences built from the
 * same figures, so a row can never round differently from the prose beside it.
 */
// Every table in an alert panel is one of the app's own tables — the bordered container,
// the tinted header, the gridlines between cells — so a figure block here looks like the
// Sale, Inventory and Import tables the same person reads all day, and like the
// spreadsheet those numbers came out of. Capped in width on purpose: the Business Alerts
// row this panel expands inside is as wide as that page's table, and a four-column figure
// table stretched across all of it puts a label at one edge and its number at the other.
function AlertTableShell({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return <TableContainer className="max-w-3xl">{children}</TableContainer>;
}

/**
 * A movement's change cell: an arrow for the way it went, coloured by whether that was
 * good news.
 *
 * The two are deliberately different things. Cost of goods rising 14% is an *up* arrow —
 * that is simply what the number did — painted red, because for that figure up is the
 * wrong way. Colouring by the sign instead would tell the reader the opposite.
 */
function ChangeCell({ fact }: { fact: AlertFact }): React.JSX.Element {
  if (!fact.change) {
    // Nothing to compare against. A dash, never a zero: "0%" claims it did not move.
    return <span className="text-text-muted">—</span>;
  }
  const colour =
    fact.tone === "bad"
      ? "text-error"
      : fact.tone === "good"
        ? "text-success"
        : "text-text-muted";
  return (
    <span
      className={cn(
        "inline-flex items-baseline gap-1 font-medium tabular-nums",
        colour,
      )}
    >
      {fact.direction && (
        <>
          <span aria-hidden="true" className="text-xs">
            {fact.direction === "up" ? "▲" : "▼"}
          </span>
          <span className="sr-only">
            {fact.direction === "up" ? "up" : "down"}{" "}
          </span>
        </>
      )}
      {fact.change}
    </span>
  );
}

/**
 * The movements an alert is claiming, as a table: what each figure was last period, what
 * it is now, and how far it moved.
 *
 * Named columns rather than "was → is now" on one line. The arrow said the same thing in
 * less space, but a reader had to work out which figure was which, and the values did not
 * line up under each other — which is the whole reason to put four numbers next to each
 * other in the first place. The headers stay "Last period"/"This period" whatever period
 * is selected: the exact days are already named above the table, and a header that
 * changed with the period ("Last 7 days") would restate them in a worse place.
 */
function AlertMovements({ facts }: { facts: AlertFact[] }): React.JSX.Element {
  return (
    <AlertTableShell>
      <Thead className="top-0">
        <Tr>
          <Th />
          <Th className="text-right">Last period</Th>
          <Th className="text-right">This period</Th>
          <Th className="text-right">Change</Th>
        </Tr>
      </Thead>
      <Tbody>
        {facts.map((fact) => (
          <Tr key={fact.label}>
            <Td className="text-text-muted whitespace-nowrap">{fact.label}</Td>
            <Td className="text-right tabular-nums text-text-secondary whitespace-nowrap">
              {fact.before ?? "—"}
            </Td>
            <Td className="text-right tabular-nums font-medium whitespace-nowrap">
              {fact.after}
            </Td>
            <Td className="text-right whitespace-nowrap">
              <ChangeCell fact={fact} />
            </Td>
          </Tr>
        ))}
      </Tbody>
    </AlertTableShell>
  );
}

/**
 * The facts that are not movements — "Products affected · 3 of 908" — as a two-column
 * table. No header row: the left column *is* the label, and a header over it would only
 * say "label" twice. It is tinted like a header instead, since that is the job it does —
 * the app's tables put their labels on that colour everywhere else.
 */
function AlertValues({ facts }: { facts: AlertFact[] }): React.JSX.Element {
  return (
    <AlertTableShell>
      <Tbody>
        {facts.map((fact) => (
          <Tr key={fact.label}>
            <Td className="bg-info-subtle text-text-muted whitespace-nowrap w-48">
              {fact.label}
            </Td>
            <Td className="font-medium">{fact.value}</Td>
          </Tr>
        ))}
      </Tbody>
    </AlertTableShell>
  );
}

/**
 * An alert's figures. Two tables rather than one, because the two kinds of row do not
 * share columns: a movement has a previous value and a change, a plain fact has neither,
 * and forcing them together leaves a table with two empty columns down one half.
 *
 * Most alerts produce only one of the two. Single-item baskets is the one that produces
 * both, and there the movements lead — they are what the alert is claiming.
 */
function AlertFacts({ facts }: { facts: AlertFact[] }): React.JSX.Element {
  const movements = facts.filter((fact) => fact.value === undefined);
  const values = facts.filter((fact) => fact.value !== undefined);
  return (
    <div className="flex flex-col gap-3">
      {movements.length > 0 && <AlertMovements facts={movements} />}
      {values.length > 0 && <AlertValues facts={values} />}
    </div>
  );
}

/**
 * The products behind an alert that is about a list rather than a number.
 *
 * A count of eighty low products is unactionable on its own — nobody reorders eighty lines
 * off one sentence. These are the few with the least cover left, each with the two figures
 * the shop can verify by walking to the shelf (how many are there, how many sold) and the
 * one it cannot (how long that lasts). The note says how many were left out, so five rows
 * under a count of eighty never read as the whole list.
 */
function AlertTableBlock({ table }: { table: AlertTable }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <AlertTableShell>
        <Thead className="top-0">
          <Tr>
            {table.columns.map((column) => (
              <Th
                key={column.label}
                className={column.align === "right" ? "text-right" : undefined}
              >
                {column.label}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {table.rows.map((row) => (
            <Tr key={row[0]}>
              {row.map((cell, index) => (
                <Td
                  key={table.columns[index]?.label ?? index}
                  className={cn(
                    "whitespace-nowrap",
                    table.columns[index]?.align === "right" &&
                      "text-right tabular-nums",
                  )}
                >
                  {cell}
                </Td>
              ))}
            </Tr>
          ))}
        </Tbody>
      </AlertTableShell>
      {table.note && (
        <span className="text-xs text-text-muted">{table.note}</span>
      )}
    </div>
  );
}

/**
 * The body of an alert: which days it covers, the figures, the products behind them, why,
 * and the one thing to do about it.
 *
 * The order is the order the question is actually asked in. The figures lead, laid out as
 * labelled rows rather than buried in prose, because the business asked to *see the data*
 * — a sentence saying the margin fell is a claim, and four rows showing sales, cost of
 * goods, what was kept and the margin is that claim with its working attached. The dates
 * sit above them, since every one of those movements is "against" something, and the stock
 * rules in particular ignore the period control entirely (they read the latest count and a
 * fixed sales window) — this line is where a reader can see that rather than assume
 * otherwise.
 *
 * `driver` and `interpretation` are merged into one "Why". They are different kinds of
 * claim — one measured, one a reading of it — but a reader asks them as a single question,
 * and two headings for one thought is how this panel used to read like a report. The
 * measured half still leads the paragraph, so the reading never borrows its authority
 * silently.
 *
 * The revenue split ("Where the Ks 1,312,950 went", drawn as bars) is gone: the same
 * movement is already in the figures above and named in "Why", so the bars restated a
 * third time what the panel had said twice.
 *
 * `what_happened` is deliberately *not* shown any more: it was a sentence stating the same
 * figures now sitting in the rows above, and the two together read as the panel saying
 * everything twice. It stays on the payload for the collapsed row and the branch cards.
 *
 * The action itself (what to do, and the button to go do it) lives beside the row this
 * panel expands from, not in here — it needs to be visible without a click, since it is
 * the thing the whole alert exists to produce. This panel is the supporting evidence for it.
 */
export function AlertExplanation({
  alert,
}: {
  alert: HealthAlert;
}): React.JSX.Element {
  const why = [alert.driver, alert.interpretation].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-4 py-1">
      {alert.context && (
        <span className="text-xs text-text-muted">{alert.context}</span>
      )}

      <AlertSection label="What happened">
        {withNumbersEmphasised(alert.what_happened)}
      </AlertSection>

      {(alert.facts ?? []).length > 0 && (
        <AlertFacts facts={alert.facts} />
      )}

      {alert.table && <AlertTableBlock table={alert.table} />}

      {why && (
        <AlertSection label="Why">{withNumbersEmphasised(why)}</AlertSection>
      )}
    </div>
  );
}

// The period preset + custom range controls, shared by the Dashboard and the Business
// Alerts page. Driven by usePeriodRange, which owns the state and the settle timing.
export function PeriodControls({
  range,
}: {
  range: PeriodRange;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <div className="w-36">
        <Select
          size="sm"
          value={range.period}
          disabled={range.hasCustomRange}
          onChange={(e) => range.setPeriod(e.target.value as PeriodKey)}
          aria-label="Period"
        >
          {PERIOD_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <span className="text-text-muted text-xs font-medium select-none">From</span>
      <div className="w-32">
        <Input
          type="date"
          size="sm"
          value={range.dateFrom}
          max={range.dateTo || undefined}
          onChange={(e) => range.setDateFrom(e.target.value)}
          aria-label="Date from"
          title="Date from"
        />
      </div>
      <span className="text-text-muted text-xs select-none">to</span>
      <div className="w-32">
        <Input
          type="date"
          size="sm"
          value={range.dateTo}
          min={range.dateFrom || undefined}
          onChange={(e) => range.setDateTo(e.target.value)}
          aria-label="Date to"
          title="Date to"
        />
      </div>
      {(range.dateFrom || range.dateTo) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={range.clearCustomRange}
          className="h-8 text-xs px-2"
        >
          Clear
        </Button>
      )}
    </div>
  );
}

export function DeltaBadge({
  deltaPct,
}: {
  deltaPct: number | null;
}): React.JSX.Element {
  if (deltaPct === null) {
    return <Badge>No prior data</Badge>;
  }
  const isUp = deltaPct >= 0;
  return (
    <Badge variant={isUp ? "success" : "error"}>
      {isUp ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(1)}%
    </Badge>
  );
}

export function StatTile({
  label,
  value,
  deltaPct,
  previousLabel,
  sub,
}: {
  label: string;
  value: string;
  // Omit deltaPct entirely for a fact that has no "previous period" to compare against.
  deltaPct?: number | null;
  previousLabel?: string;
  sub?: string;
}): React.JSX.Element {
  return (
    <Card className="flex flex-col justify-between p-3 sm:p-3.5 bg-bg-subtle border-border">
      <span className="text-[10px] sm:text-[11px] font-semibold text-text-muted uppercase tracking-wider">
        {label}
      </span>
      <div className="my-0.5">
        <span className="text-xl sm:text-2xl font-bold text-text-primary tracking-tight tabular-nums">
          {value}
        </span>
      </div>
      {deltaPct !== undefined ? (
        <div className="flex items-center gap-1.5 flex-wrap">
          <DeltaBadge deltaPct={deltaPct} />
          {previousLabel && (
            <span className="text-[10px] sm:text-[11px] text-text-muted">{previousLabel}</span>
          )}
        </div>
      ) : (
        sub && <span className="text-[10px] sm:text-[11px] text-text-muted truncate">{sub}</span>
      )}
    </Card>
  );
}

// A 4px-rounded top, square baseline bar — see the dataviz mark spec (marks-and-
// anatomy.md) for why the rounding is top-only rather than a plain rounded rect.
function roundedTopBarPath(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): string {
  if (h <= 0) return "";
  const radius = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`;
}

const TREND_CHART_WIDTH = 720;
const TREND_CHART_HEIGHT = 130;
const TREND_BAR_MAX_WIDTH = 24;
const TREND_BAR_GAP = 3;

function trendLabelIndices(count: number): Set<number> {
  if (count <= 8) return new Set(Array.from({ length: count }, (_, i) => i));
  const last = count - 1;
  return new Set([
    0,
    Math.round(last * 0.25),
    Math.round(last * 0.5),
    Math.round(last * 0.75),
    last,
  ]);
}

export type ChartView = "bar" | "line";

// A small segmented control for switching a trend chart between its bar and line
// views — the parent tab owns the `view` state (it's a per-card preference, not
// derived from the fetched data), this just renders the control, meant to sit in a
// CardHeader's `action` slot next to the chart it controls.
export function ChartViewToggle({
  view,
  onChange,
}: {
  view: ChartView;
  onChange: (view: ChartView) => void;
}): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-0.5 p-0.5 rounded-md bg-bg-raised w-fit"
      role="group"
      aria-label="Chart view"
    >
      {(["bar", "line"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          onClick={() => onChange(option)}
          className={cn(
            "h-6 px-2.5 rounded text-xs font-medium capitalize transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
            view === option
              ? "bg-bg-base text-brand shadow-xs"
              : "text-text-muted hover:text-text-secondary",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

// A single-hue (brand) daily trend chart, bar or line — sequential-by-magnitude, one
// series, so no legend box (the card title already names what's plotted). Works for
// any daily series (revenue, average sale value, ...) via `getValue`/`formatValue`.
// Both views share one hover layer (a transparent hit-rect per day, per
// dataviz/interaction.md's "the mark is the hit target"), so switching views never
// changes how you read an exact value.
export function TrendChart<T extends { date: string }>({
  points,
  getValue,
  formatValue,
  ariaLabel,
  view,
}: {
  points: T[];
  getValue: (point: T) => number;
  formatValue: (value: number) => string;
  ariaLabel: string;
  view: ChartView;
}): React.JSX.Element {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  if (points.length === 0) {
    return <p className="text-sm text-text-muted">No data for this period.</p>;
  }

  const slotWidth = TREND_CHART_WIDTH / points.length;
  const barWidth = Math.max(
    2,
    Math.min(TREND_BAR_MAX_WIDTH, slotWidth - TREND_BAR_GAP),
  );
  const maxValue = Math.max(...points.map(getValue), 0);
  const labelIndices = trendLabelIndices(points.length);
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function yFor(value: number): number {
    return maxValue > 0
      ? TREND_CHART_HEIGHT - (value / maxValue) * (TREND_CHART_HEIGHT - 8)
      : TREND_CHART_HEIGHT;
  }
  const centerX = (i: number): number => i * slotWidth + slotWidth / 2;
  const linePath =
    view === "line"
      ? points
          .map(
            (point, i) =>
              `${i === 0 ? "M" : "L"}${centerX(i)},${yFor(getValue(point))}`,
          )
          .join(" ")
      : "";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${TREND_CHART_WIDTH} ${TREND_CHART_HEIGHT + 22}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <line
          x1={0}
          y1={TREND_CHART_HEIGHT}
          x2={TREND_CHART_WIDTH}
          y2={TREND_CHART_HEIGHT}
          stroke="var(--color-border)"
          strokeWidth={1}
        />
        {view === "line" && (
          <path
            d={linePath}
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
        {points.map((point, i) => {
          const value = getValue(point);
          const y = yFor(value);
          return (
            <g key={point.date}>
              {view === "bar" ? (
                <path
                  d={roundedTopBarPath(
                    i * slotWidth + (slotWidth - barWidth) / 2,
                    y,
                    barWidth,
                    TREND_CHART_HEIGHT - y,
                    4,
                  )}
                  className={cn(
                    "fill-brand",
                    hoverIndex === i ? "opacity-100" : "opacity-75",
                  )}
                />
              ) : (
                (hoverIndex === i || i === points.length - 1) && (
                  <circle
                    cx={centerX(i)}
                    cy={y}
                    r={hoverIndex === i ? 4 : 3}
                    className="fill-brand"
                    stroke="var(--color-bg-base)"
                    strokeWidth={2}
                  />
                )
              )}
              <rect
                x={i * slotWidth}
                y={0}
                width={slotWidth}
                height={TREND_CHART_HEIGHT}
                fill="transparent"
                className={cn(
                  "outline-none rounded-sm",
                  hoverIndex === i && "ring-2 ring-brand",
                )}
                tabIndex={0}
                role="button"
                aria-label={`${formatShortDate(point.date, true)}: ${formatValue(value)}`}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() =>
                  setHoverIndex((current) => (current === i ? null : current))
                }
                onFocus={() => setHoverIndex(i)}
                onBlur={() =>
                  setHoverIndex((current) => (current === i ? null : current))
                }
              />
              {labelIndices.has(i) && (
                <text
                  x={centerX(i)}
                  y={TREND_CHART_HEIGHT + 16}
                  textAnchor="middle"
                  className="fill-text-muted text-[10px]"
                >
                  {formatShortDate(point.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-bg-base px-2.5 py-1.5 text-xs shadow-md whitespace-nowrap"
          style={{ left: `${((hoverIndex! + 0.5) / points.length) * 100}%` }}
        >
          <div className="font-medium text-text-primary">
            {formatValue(getValue(hovered))}
          </div>
          <div className="text-text-muted">
            {formatShortDate(hovered.date, true)}
          </div>
        </div>
      )}
    </div>
  );
}

// Two overlaid daily lines sharing one axis (both series are the same unit, so this
// never becomes a dual-axis chart) — the gap between them is the thing to read, e.g.
// net revenue vs. estimated cost, where the vertical distance between the two lines
// at any point is the margin. Categorical, not magnitude, so each line gets a fixed
// color rather than the sequential single-hue ramp WeekdayHourHeatmap uses; the
// secondary line is also dashed so the two are distinguishable without relying on
// color alone, and a legend names them since there are 2 series (dataviz
// color-formula.md).
export function TwoLineTrendChart<T extends { date: string }>({
  points,
  getPrimaryValue,
  getSecondaryValue,
  primaryLabel,
  secondaryLabel,
  formatValue,
  ariaLabel,
}: {
  points: T[];
  getPrimaryValue: (point: T) => number;
  getSecondaryValue: (point: T) => number;
  primaryLabel: string;
  secondaryLabel: string;
  formatValue: (value: number) => string;
  ariaLabel: string;
}): React.JSX.Element {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  if (points.length === 0) {
    return <p className="text-sm text-text-muted">No data for this period.</p>;
  }

  const slotWidth = TREND_CHART_WIDTH / points.length;
  const maxValue = Math.max(
    ...points.map(getPrimaryValue),
    ...points.map(getSecondaryValue),
    0,
  );
  const labelIndices = trendLabelIndices(points.length);
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function yFor(value: number): number {
    return maxValue > 0
      ? TREND_CHART_HEIGHT -
          (Math.max(0, value) / maxValue) * (TREND_CHART_HEIGHT - 8)
      : TREND_CHART_HEIGHT;
  }
  const centerX = (i: number): number => i * slotWidth + slotWidth / 2;
  const primaryPath = points
    .map(
      (point, i) =>
        `${i === 0 ? "M" : "L"}${centerX(i)},${yFor(getPrimaryValue(point))}`,
    )
    .join(" ");
  const secondaryPath = points
    .map(
      (point, i) =>
        `${i === 0 ? "M" : "L"}${centerX(i)},${yFor(getSecondaryValue(point))}`,
    )
    .join(" ");

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${TREND_CHART_WIDTH} ${TREND_CHART_HEIGHT + 22}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
      >
        <line
          x1={0}
          y1={TREND_CHART_HEIGHT}
          x2={TREND_CHART_WIDTH}
          y2={TREND_CHART_HEIGHT}
          stroke="var(--color-border)"
          strokeWidth={1}
        />
        <path
          d={secondaryPath}
          fill="none"
          className="stroke-text-disabled"
          strokeWidth={2}
          strokeDasharray="4 3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={primaryPath}
          fill="none"
          className="stroke-brand"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((point, i) => {
          const primaryY = yFor(getPrimaryValue(point));
          const secondaryY = yFor(getSecondaryValue(point));
          const showDots = hoverIndex === i || i === points.length - 1;
          return (
            <g key={point.date}>
              {showDots && (
                <>
                  <circle
                    cx={centerX(i)}
                    cy={secondaryY}
                    r={hoverIndex === i ? 4 : 3}
                    className="fill-text-disabled"
                    stroke="var(--color-bg-base)"
                    strokeWidth={2}
                  />
                  <circle
                    cx={centerX(i)}
                    cy={primaryY}
                    r={hoverIndex === i ? 4 : 3}
                    className="fill-brand"
                    stroke="var(--color-bg-base)"
                    strokeWidth={2}
                  />
                </>
              )}
              <rect
                x={i * slotWidth}
                y={0}
                width={slotWidth}
                height={TREND_CHART_HEIGHT}
                fill="transparent"
                className={cn(
                  "outline-none rounded-sm",
                  hoverIndex === i && "ring-2 ring-brand",
                )}
                tabIndex={0}
                role="button"
                aria-label={`${formatShortDate(point.date, true)}: ${primaryLabel} ${formatValue(getPrimaryValue(point))}, ${secondaryLabel} ${formatValue(getSecondaryValue(point))}`}
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() =>
                  setHoverIndex((current) => (current === i ? null : current))
                }
                onFocus={() => setHoverIndex(i)}
                onBlur={() =>
                  setHoverIndex((current) => (current === i ? null : current))
                }
              />
              {labelIndices.has(i) && (
                <text
                  x={centerX(i)}
                  y={TREND_CHART_HEIGHT + 16}
                  textAnchor="middle"
                  className="fill-text-muted text-[10px]"
                >
                  {formatShortDate(point.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute top-0 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-bg-base px-2.5 py-1.5 text-xs shadow-md whitespace-nowrap"
          style={{ left: `${((hoverIndex! + 0.5) / points.length) * 100}%` }}
        >
          <div className="text-text-secondary">
            {primaryLabel}:{" "}
            <span className="font-medium text-text-primary">
              {formatValue(getPrimaryValue(hovered))}
            </span>
          </div>
          <div className="text-text-secondary">
            {secondaryLabel}:{" "}
            <span className="font-medium text-text-primary">
              {formatValue(getSecondaryValue(hovered))}
            </span>
          </div>
          <div className="text-text-muted">
            {formatShortDate(hovered.date, true)}
          </div>
        </div>
      )}
      <div className="flex items-center gap-4 text-xs text-text-muted mt-1">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 rounded-full bg-brand" />
          {primaryLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="w-2.5 h-0.5 rounded-full bg-text-disabled"
            style={{
              backgroundImage:
                "repeating-linear-gradient(to right, var(--color-text-disabled) 0 3px, transparent 3px 5px)",
            }}
          />
          {secondaryLabel}
        </span>
      </div>
    </div>
  );
}

// One column per hour, business hours only (7am-10pm) — matches the backend's
// HEATMAP_START_HOUR/HEATMAP_END_HOUR (app/services/dashboard.py). A retail shop's
// overnight hours are always empty, so a full 24-hour grid just wastes columns on dead
// space; a sale outside this window simply has no cell to land on at all.
const HEATMAP_START_HOUR = 7;
const HEATMAP_END_HOUR = 22; // exclusive — the last column covers 21:00-22:00
const HOUR_BANDS = Array.from(
  { length: HEATMAP_END_HOUR - HEATMAP_START_HOUR },
  (_, i) => {
    const hour = HEATMAP_START_HOUR + i;
    return `${String(hour).padStart(2, "0")}-${String(hour + 1).padStart(2, "0")}`;
  },
);

// One hue, light -> dark, continuous — a sequential ramp for magnitude (see dataviz
// color-formula.md), blending the two already-approved tokens (empty-cell gray and
// brand) via color-mix() rather than a handful of flat opacity steps. Plain opacity
// steps (bg-brand/20, /40, ...) look almost identical to each other and to the empty
// gray near the low end, since they're all blending toward the same white/near-white
// surface — color-mix interpolates in OKLab, which stays perceptually even across the
// whole range, and it re-reads correctly in dark mode too since it mixes whatever the
// current theme's tokens resolve to, not a fixed hex pair.
const MIN_INTENSITY = 0.12;
function heatmapCellStyle(
  value: number,
  maxValue: number,
): React.CSSProperties {
  if (maxValue <= 0 || value <= 0) return {};
  // Every nonzero cell gets at least MIN_INTENSITY, so "some sales" is always visibly
  // distinct from "no sales" even when it's tiny next to this grid's busiest cell.
  const ratio = MIN_INTENSITY + (value / maxValue) * (1 - MIN_INTENSITY);
  return {
    backgroundColor: `color-mix(in oklab, var(--color-bg-raised), var(--color-brand) ${Math.round(ratio * 100)}%)`,
  };
}

// A weekday x hour-band grid, colored by magnitude — used for both Revenue's revenue
// concentration and Shopping Patterns' busy-hours view (transaction count), via `getValue`.
export function WeekdayHourHeatmap<
  T extends { weekday: number; hour_band: string },
>({
  cells,
  getValue,
  formatValue,
}: {
  cells: T[];
  getValue: (cell: T) => number;
  formatValue: (value: number) => string;
}): React.JSX.Element {
  const [hovered, setHovered] = useState<{
    weekday: number;
    hourBand: string;
    value: number;
  } | null>(null);
  const byKey = new Map(
    cells.map((cell) => [`${cell.weekday}:${cell.hour_band}`, getValue(cell)]),
  );
  const maxValue = Math.max(0, ...cells.map(getValue));

  return (
    <div className="flex flex-col gap-3">
      {/* A visible readout, not just the slow native `title` tooltip on each cell (which
          still stays as a keyboard/accessibility fallback below) — the value on hover
          needs to be immediately obvious, the same way the bar charts' tooltips are. */}
      <div className="h-5 text-sm text-text-secondary">
        {hovered ? (
          <>
            <span className="font-medium text-text-primary">
              {WEEKDAY_LABELS[hovered.weekday]} {hovered.hourBand}
            </span>{" "}
            — {formatValue(hovered.value)}
          </>
        ) : (
          <span className="text-text-muted">
            Hover or focus a cell to see its exact value.
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <div
          className="inline-grid gap-1 min-w-[64rem]"
          style={{
            gridTemplateColumns: `3rem repeat(${HOUR_BANDS.length}, minmax(0, 1fr))`,
          }}
        >
          <div />
          {HOUR_BANDS.map((band) => (
            <div
              key={band}
              className="text-center text-[10px] text-text-muted pb-1"
            >
              {band}
            </div>
          ))}
          {WEEKDAY_LABELS.map((label, weekday) => (
            <Fragment key={label}>
              <div className="flex items-center text-xs text-text-secondary">
                {label}
              </div>
              {HOUR_BANDS.map((band) => {
                const value = byKey.get(`${weekday}:${band}`) ?? 0;
                const isHovered =
                  hovered?.weekday === weekday && hovered.hourBand === band;
                return (
                  <div
                    key={band}
                    tabIndex={0}
                    role="gridcell"
                    aria-label={`${label} ${band}: ${formatValue(value)}`}
                    title={`${label} ${band}: ${formatValue(value)}`}
                    className={cn(
                      "h-7 rounded-sm cursor-default transition-colors bg-bg-raised",
                      isHovered && "ring-2 ring-brand",
                    )}
                    style={heatmapCellStyle(value, maxValue)}
                    onMouseEnter={() =>
                      setHovered({ weekday, hourBand: band, value })
                    }
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() =>
                      setHovered({ weekday, hourBand: band, value })
                    }
                    onBlur={() => setHovered(null)}
                  />
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <span>Less</span>
        <div
          className="h-3 w-24 rounded-sm"
          style={{
            backgroundImage:
              "linear-gradient(to right, color-mix(in oklab, var(--color-bg-raised), var(--color-brand) 12%), var(--color-brand))",
          }}
        />
        <span>More</span>
      </div>
    </div>
  );
}

// A compact list for a data-quality check tile — same row shape every Warning-page
// check returns, reused across every dashboard tab's tile (Sale on Revenue/Customer,
// Purchase on Cost, the Inventory/Daily-check group on Inventory) with just a label.
export function WarningsTile({
  warnings,
  label,
  onViewWarnings,
}: {
  warnings: SaleWarningRow[];
  label: string;
  // Optional so this still renders fine standalone (e.g. in a future non-dashboard
  // context) without a navigation target — every dashboard tab always passes one.
  onViewWarnings?: () => void;
}): React.JSX.Element {
  const viewLink = onViewWarnings && (
    <button
      type="button"
      onClick={onViewWarnings}
      className="self-start text-xs text-brand hover:text-brand-hover underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
    >
      View in Warning page →
    </button>
  );

  if (warnings.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-success">No {label} warnings right now.</p>
        {viewLink}
      </div>
    );
  }
  const shown = warnings.slice(0, 5);
  return (
    <div className="flex flex-col gap-2.5">
      <Badge variant="warning">
        {warnings.length} {label}{" "}
        {warnings.length === 1 ? "warning" : "warnings"}
      </Badge>
      <ul className="flex flex-col gap-1.5">
        {shown.map((warning, i) => (
          <li key={i} className="text-sm text-text-secondary">
            • {warning.note}
          </li>
        ))}
      </ul>
      {warnings.length > shown.length && (
        <p className="text-xs text-text-muted">
          and {warnings.length - shown.length} more.
        </p>
      )}
      {viewLink}
    </div>
  );
}
