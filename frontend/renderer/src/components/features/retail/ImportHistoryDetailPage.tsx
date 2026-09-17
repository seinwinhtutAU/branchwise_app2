import { useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { Badge } from "@renderer/components/ui/Badge";
import { Spinner } from "@renderer/components/ui/Spinner";
import { ImportDataView } from "./ImportDataView";
import type { ImportHistoryDetail } from "../types";

interface Props {
  session: Session;
  batchId: string;
  onBack: () => void;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatSummaryLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Display only — the backend/DB status values are still 'completed'/'reverted'/
// 'reimported' (see ImportBatchStatus).
const STATUS_LABELS: Record<string, string> = {
  completed: "Completed",
  reverted: "Removed",
  reimported: "Reimported",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const STATUS_BADGE_VARIANT: Record<string, "success" | "info" | "default"> = {
  completed: "success",
  reimported: "info",
};

function statusBadgeVariant(status: string): "success" | "info" | "default" {
  return STATUS_BADGE_VARIANT[status] ?? "default";
}

function ImportHistoryDetailPage({
  session,
  batchId,
  onBack,
}: Props): React.JSX.Element {
  const showToast = useToast();
  const [detail, setDetail] = useState<ImportHistoryDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`${apiBaseUrl}/api/imports/history/${batchId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((body) => {
        if (!cancelled) setDetail(body);
      })
      .catch(() => {
        if (!cancelled) {
          showToast(
            "error",
            "Couldn't load this import — is the backend running?",
          );
          onBack();
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  return (
    <div className="flex flex-col gap-4 animate-fade-in motion-reduce:animate-none">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Back to Import History"
          className="w-8 h-8 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-raised transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="w-4.5 h-4.5"
            aria-hidden="true"
          >
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight capitalize">
            {detail ? `${detail.import_type} import` : "Import details"}
          </h2>
          {detail && (
            <p className="text-sm text-text-muted truncate">
              {detail.filename}
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-text-muted">
          <Spinner className="w-6 h-6" />
        </div>
      )}

      {!loading && detail && (
        <>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-text-muted">
            <span>
              Branch:{" "}
              <span className="text-text-primary">
                {detail.branch_name ?? "—"}
              </span>
            </span>
            <span>
              Uploaded by:{" "}
              <span className="text-text-primary">
                {detail.uploaded_by_name ?? "—"}
              </span>
            </span>
            <span>
              Date:{" "}
              <span className="text-text-primary">
                {formatDate(detail.created_at)}
              </span>
            </span>
            <Badge variant={statusBadgeVariant(detail.status)}>
              {statusLabel(detail.status)}
            </Badge>
          </div>

          {Array.isArray(detail.summary.messages)
            ? (detail.summary.messages as unknown[]).length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {(detail.summary.messages as unknown[]).map((message, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-sm text-text-primary"
                    >
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                        aria-hidden="true"
                      />
                      {String(message)}
                    </li>
                  ))}
                </ul>
              )
            : Object.entries(detail.summary).filter(
                ([key]) => key !== "batch_id",
              ).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {Object.entries(detail.summary)
                    .filter(([key]) => key !== "batch_id")
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="rounded-md border border-border bg-bg-subtle px-3 py-1.5 text-xs"
                      >
                        <span className="text-text-muted">
                          {formatSummaryLabel(key)}:{" "}
                        </span>
                        <span className="text-text-primary font-medium">
                          {String(value)}
                        </span>
                      </div>
                    ))}
                </div>
              )}

          <ImportDataView clean={detail.clean} origin={detail.origin} />
        </>
      )}
    </div>
  );
}

export default ImportHistoryDetailPage;
