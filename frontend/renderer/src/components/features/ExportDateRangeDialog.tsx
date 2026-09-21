import { useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { Button } from "@renderer/components/ui/Button";
import { DateInput } from "@renderer/components/ui/DateInput";

export interface ExportDateRange {
  from: string;
  to: string;
}

interface DateBoundsResponse {
  earliest_date: string | null;
}

interface Props {
  session: Session;
  boundsEndpoint: string;
  format: "csv" | "excel";
  title: string;
  onClose: () => void;
  onConfirm: (range: ExportDateRange) => void;
}

function todayIso(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function ExportDateRangeDialog({
  session,
  boundsEndpoint,
  format,
  title,
  onClose,
  onConfirm,
}: Props): React.JSX.Element {
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasNoRecords, setHasNoRecords] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    fetch(`${apiBaseUrl}${boundsEndpoint}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as DateBoundsResponse;
      })
      .then((data) => {
        if (isCancelled) return;
        setHasNoRecords(data.earliest_date === null);
        setFrom(data.earliest_date ?? today);
        setTo(today);
      })
      .catch(() => {
        if (!isCancelled) {
          setError("Couldn't find the earliest available date.");
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [boundsEndpoint, session.access_token, today]);

  const isRangeInvalid = Boolean(from && to && from > to);
  const formatLabel = format === "csv" ? "CSV" : "Excel";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-date-range-title"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-bg-base shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 id="export-date-range-title" className="text-sm font-semibold text-text-primary">
              Export {title}
            </h3>
            <p className="mt-0.5 text-xs text-text-muted">
              Choose the date range for this {formatLabel} file.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary"
            aria-label="Close export date range"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {error ? (
            <p className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
              {error}
            </p>
          ) : hasNoRecords ? (
            <p className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs text-text-muted">
              There are no records available to export yet.
            </p>
          ) : (
            <p className="text-xs text-text-muted">
              From defaults to the earliest available date; To defaults to today. Table filters are not used.
            </p>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DateInput label="From" value={from} onChange={setFrom} disabled={isLoading} />
            <DateInput label="To" value={to} onChange={setTo} disabled={isLoading} />
          </div>
          {isRangeInvalid && (
            <p className="text-xs text-error">From date must be on or before To date.</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={isLoading || hasNoRecords || Boolean(error) || !from || !to || isRangeInvalid}
            onClick={() => onConfirm({ from, to })}
          >
            Download {formatLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
