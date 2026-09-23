import { useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { Button } from "@renderer/components/ui/Button";
import { DateInput } from "@renderer/components/ui/DateInput";
import { Select } from "@renderer/components/ui/Select";

export interface ExportDateRange {
  from: string;
  to: string;
}

export interface ExportOptions {
  from?: string;
  to?: string;
  branch?: string;
}

interface DateBoundsResponse {
  earliest_date: string | null;
  latest_date?: string | null;
}

interface Props {
  session: Session;
  boundsEndpoint?: string;
  format: "csv" | "excel";
  title: string;
  branchOptions?: string[];
  initialBranch?: string;
  lockBranch?: boolean;
  showDateRange?: boolean;
  onClose: () => void;
  onConfirm: (options: ExportOptions) => void;
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
  branchOptions,
  initialBranch,
  lockBranch = false,
  showDateRange = true,
  onClose,
  onConfirm,
}: Props): React.JSX.Element {
  const today = todayIso();
  const [branch, setBranch] = useState(initialBranch ?? "");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [isLoading, setIsLoading] = useState(showDateRange && Boolean(boundsEndpoint));
  const [error, setError] = useState<string | null>(null);
  const [hasNoRecords, setHasNoRecords] = useState(false);

  useEffect(() => {
    if (!showDateRange || !boundsEndpoint) {
      setIsLoading(false);
      return;
    }
    let isCancelled = false;
    setIsLoading(true);
    setError(null);

    const branchParam = branch ? `?branch=${encodeURIComponent(branch)}` : "";
    fetch(`${apiBaseUrl}${boundsEndpoint}${branchParam}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        return (await response.json()) as DateBoundsResponse;
      })
      .then((data) => {
        if (isCancelled) return;
        const noRecords = data.earliest_date === null && !data.latest_date;
        setHasNoRecords(noRecords);
        setFrom(data.earliest_date ?? today);
        setTo(data.latest_date ?? data.earliest_date ?? today);
      })
      .catch(() => {
        if (!isCancelled) {
          setError("Couldn't find the date bounds for the selected branch.");
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });
    return () => {
      isCancelled = true;
    };
  }, [boundsEndpoint, session.access_token, today, branch, showDateRange]);

  const isRangeInvalid = Boolean(showDateRange && from && to && from > to);
  const formatLabel = format === "csv" ? "CSV" : "Excel";
  const hasBranchOptions = Boolean(branchOptions && branchOptions.length > 0);

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
              Choose the export options for this {formatLabel} file.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-text-muted transition-colors hover:bg-bg-raised hover:text-text-primary"
            aria-label="Close export dialog"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          {hasBranchOptions && (
            <div>
              <Select
                label="Branch"
                size="sm"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={lockBranch || isLoading}
              >
                {!lockBranch && <option value="">All Branches</option>}
                {branchOptions!.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {showDateRange && (
            <>
              {error ? (
                <p className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                  {error}
                </p>
              ) : hasNoRecords ? (
                <p className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs text-text-muted">
                  There are no records available for this branch yet.
                </p>
              ) : (
                <p className="text-xs text-text-muted">
                  Dates default to earliest and latest available records for the selected branch.
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DateInput label="From" value={from} onChange={setFrom} disabled={isLoading} />
                <DateInput label="To" value={to} onChange={setTo} disabled={isLoading} />
              </div>
              {isRangeInvalid && (
                <p className="text-xs text-error">From date must be on or before To date.</p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={
              isLoading ||
              (showDateRange &&
                (hasNoRecords || Boolean(error) || !from || !to || isRangeInvalid))
            }
            onClick={() =>
              onConfirm({
                from: showDateRange ? from : undefined,
                to: showDateRange ? to : undefined,
                branch: branch || undefined,
              })
            }
          >
            Download {formatLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
