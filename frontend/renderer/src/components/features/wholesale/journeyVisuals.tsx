import { cn } from "@renderer/lib/utils";
import { ArrowRightIcon, CheckIcon } from "@renderer/components/ui/icons";

// ── The journey ──────────────────────────────────────────────────────────────
// Every wholesale screen shows the same journey — goods leaving a supplier, travelling,
// and reaching a gate — so every screen draws it the same way: a coloured band naming the
// stage over a tinted body carrying what that stage knows, joined by arrows. Delivery
// fills the bodies with package counts because it has them; Customer Orders and Supplier
// Vouchers fill them with where the goods have got to.

export type JourneyStage = "supplier" | "cargo" | "stop" | "final";

const JOURNEY_FACE: Record<JourneyStage, string> = {
  supplier: "var(--color-journey-supplier)",
  cargo: "var(--color-journey-cargo)",
  stop: "var(--color-journey-stop)",
  final: "var(--color-journey-final)",
};

const JOURNEY_SOFT: Record<JourneyStage, string> = {
  supplier: "var(--color-journey-supplier-soft)",
  cargo: "var(--color-journey-cargo-soft)",
  stop: "var(--color-journey-stop-soft)",
  final: "var(--color-journey-final-soft)",
};

export function JourneyFace(stage: JourneyStage): string {
  return JOURNEY_FACE[stage];
}

export function JourneySoft(stage: JourneyStage): string {
  return JOURNEY_SOFT[stage];
}

/** One stage of the journey. `faded` greys a stage the goods have not reached yet. */
export function JourneyCard({
  stage,
  title,
  subtitle,
  done = false,
  doneLabel,
  faded = false,
  children,
}: {
  stage: JourneyStage;
  title: string;
  subtitle?: string;
  done?: boolean;
  doneLabel?: string;
  faded?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex flex-col w-44 shrink-0 rounded-xl border border-border overflow-hidden",
        faded && "opacity-45",
      )}
    >
      <div
        style={{ backgroundColor: JOURNEY_FACE[stage] }}
        className="px-3 py-2 text-white flex items-start justify-between gap-2"
      >
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wide break-words">
            {title}
          </div>
          {subtitle && (
            <div className="text-xs text-white/70 break-words leading-snug">
              {subtitle}
            </div>
          )}
        </div>
        {done && (
          <span
            title={doneLabel}
            aria-label={doneLabel}
            className="flex items-center justify-center w-5 h-5 rounded-full bg-success text-white shrink-0"
          >
            <CheckIcon className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <dl
        style={{ backgroundColor: JOURNEY_SOFT[stage] }}
        className="flex-1 divide-y divide-border"
      >
        {children}
      </dl>
    </div>
  );
}

/** A line inside a journey card: a label and its figure. */
export function JourneyRow({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  /** Given on a figure that should come to nothing — true reads settled, false outstanding. */
  good?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-2 px-3 py-2">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd
        className={cn(
          "text-sm font-bold tabular-nums",
          good === undefined
            ? "text-text-primary"
            : good
              ? "text-success"
              : "text-error",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

export function JourneyArrow({
  direction = "right",
}: {
  direction?: "left" | "right";
} = {}): React.JSX.Element {
  return (
    <div
      className={cn(
        "flex items-center px-2 shrink-0 text-text-muted",
        direction === "left" && "rotate-180",
      )}
      aria-hidden
    >
      <ArrowRightIcon className="w-6 h-6" />
    </div>
  );
}
