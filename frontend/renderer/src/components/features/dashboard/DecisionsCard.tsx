import type { Session } from "@renderer/lib/auth";
import { useUrlQuery } from "@renderer/lib/queryClient";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import { cn } from "@renderer/lib/utils";
import { dashboardUrl, type HealthAlert, type OverviewData } from "./helpers";

// How many decisions the Summary shows. The full list lives on Business Alerts; this is
// the few worth seeing before anything else.
const MAX_DECISIONS = 3;

/**
 * "Recommended decisions" on the Summary: the branch's most important Business Alerts, so
 * every line is a real finding about this branch's own data rather than advice that reads
 * the same whatever happened.
 *
 * Only alerts that ask for a decision (critical or warning) appear — the "normal" ones
 * are heads-up notes — and data-quality alerts are left out, since fixing a file is
 * housekeeping rather than a business decision. Each card is just the alert's title and
 * what to do about it — the longer explanation is one click away on Business Alerts, and
 * no colour bar: the list is already only the ones that matter. It reads the same 30-day Overview request
 * the Business Alerts page makes, so opening one after the other costs no extra fetch.
 */
export function DecisionsCard({
  session,
  branchId,
  onViewAlerts,
}: {
  session: Session;
  branchId: string;
  onViewAlerts?: () => void;
}): React.JSX.Element {
  const { data, failed } = useUrlQuery<OverviewData>(
    dashboardUrl("overview", branchId, { period: "30d", dateFrom: "", dateTo: "" }),
    session,
    "Business alerts",
  );

  const decisions: HealthAlert[] = (data?.alerts ?? [])
    .filter((alert) => alert.severity !== "normal" && alert.dimension !== "data_quality")
    .slice(0, MAX_DECISIONS);

  return (
    <div className="bg-bg-subtle p-3.5 sm:p-4 rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <h2 className="text-sm font-semibold text-text-primary">Recommended decisions</h2>
        {onViewAlerts && (
          <button
            type="button"
            onClick={onViewAlerts}
            className="text-xs text-brand hover:underline"
          >
            All alerts →
          </button>
        )}
      </div>

      {data === undefined && !failed ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {Array.from({ length: MAX_DECISIONS }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : data === undefined ? (
        <p className="text-xs text-text-muted py-6 text-center">
          Couldn't load the alerts right now.
        </p>
      ) : decisions.length === 0 ? (
        <p className="text-xs text-text-muted py-6 text-center">
          Nothing needs a decision right now.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          {decisions.map((alert) => (
            <button
              key={alert.id}
              type="button"
              onClick={onViewAlerts}
              disabled={!onViewAlerts}
              className={cn(
                "bg-bg-base p-3 rounded-lg border border-border text-left flex flex-col gap-1.5",
                onViewAlerts && "hover:border-brand/30 transition-colors",
              )}
            >
              <h3 className="text-xs font-bold text-text-primary">{alert.title}</h3>
              <p className="text-[11px] leading-relaxed text-text-secondary">
                {alert.recommended_action}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
