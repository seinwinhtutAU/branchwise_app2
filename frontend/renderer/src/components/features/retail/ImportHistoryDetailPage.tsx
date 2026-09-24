import { useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { formatRetailDateTime } from "@renderer/lib/retailDateTime";
import { useToast } from "@renderer/lib/useToast";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import { Spinner } from "@renderer/components/ui/Spinner";
import { DownloadIcon } from "@renderer/components/ui/icons";
import { cn } from "@renderer/lib/utils";
import { ImportDataView } from "./ImportDataView";
import type { ImportHistoryDetail, Profile } from "../types";

interface Props {
  session: Session;
  batchId: string;
  onBack: () => void;
  profile?: Profile | null;
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
  profile,
}: Props): React.JSX.Element {
  const showToast = useToast();
  const [detail, setDetail] = useState<ImportHistoryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingPage, setLoadingPage] = useState(false);
  const [warningIndices, setWarningIndices] = useState<{
    clean?: number[];
    original?: number[];
  }>({});
  const [downloading, setDownloading] = useState(false);
  const [downloadingClean, setDownloadingClean] = useState(false);
  const isGeneralFile = detail?.import_type === "general";

  async function handlePageChange(
    newPage: number,
    tab: "clean" | "original",
  ): Promise<void> {
    if (!detail) return;
    setLoadingPage(true);
    try {
      const res = await fetch(
        `${apiBaseUrl}/api/imports/history/${batchId}?page=${newPage}&page_size=50&tab=${tab}`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!res.ok) throw new Error(String(res.status));
      const data: ImportHistoryDetail = await res.json();
      setDetail((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          clean: data.clean,
          origin: data.origin,
        };
      });
    } catch {
      showToast("error", "Failed to load page.");
    } finally {
      setLoadingPage(false);
    }
  }

  async function loadWarningIndices(tab: "clean" | "original"): Promise<void> {
    if (warningIndices[tab] !== undefined) return;
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/imports/history/${batchId}/warnings?tab=${tab}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { indices: number[] };
      setWarningIndices((current) => ({ ...current, [tab]: body.indices }));
    } catch {
      setWarningIndices((current) => ({ ...current, [tab]: [] }));
      showToast("error", "Failed to load warning locations.");
    }
  }

  async function handleDownload(): Promise<void> {
    if (!detail) return;
    setDownloading(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/imports/history/${batchId}/download`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        showToast(
          "error",
          body?.detail ?? `Download failed (${response.status})`,
        );
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = detail.filename || `import_${batchId}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showToast("success", "File downloaded successfully.");
    } catch {
      showToast("error", "Network error while downloading file.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleDownloadClean(): Promise<void> {
    if (!detail) return;
    setDownloadingClean(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/imports/history/${batchId}/download-clean`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        showToast(
          "error",
          body?.detail ?? `Download failed (${response.status})`,
        );
        return;
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const baseStem = detail.filename
        ? detail.filename.replace(/\.[^/.]+$/, "")
        : `import_${batchId}`;
      a.download = `${baseStem}_clean.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      showToast("success", "Clean CSV downloaded successfully.");
    } catch {
      showToast("error", "Network error while downloading clean CSV.");
    } finally {
      setDownloadingClean(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setWarningIndices({});
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
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
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
              {detail
                ? isGeneralFile
                  ? "General File"
                  : `${detail.import_type} import`
                : "Import details"}
            </h2>
            {detail && (
              <p className="text-sm text-text-muted truncate">
                {detail.filename}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {detail && !isGeneralFile && (
            <Button
              variant="secondary"
              size="sm"
              loading={downloadingClean}
              onClick={handleDownloadClean}
              className="flex items-center gap-1.5"
              title="Download cleaned CSV data"
            >
              <DownloadIcon className="w-3.5 h-3.5" />
              <span>Download Clean CSV</span>
            </Button>
          )}

          {detail &&
            (profile?.role === "admin" ||
              profile?.role === "development" ||
              isGeneralFile) && (
              <Button
                variant="secondary"
                size="sm"
                loading={downloading}
                onClick={handleDownload}
                className="flex items-center gap-1.5"
                title="Download original uploaded file"
              >
                <DownloadIcon className="w-3.5 h-3.5" />
                <span>Download Original File</span>
              </Button>
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
                {formatRetailDateTime(detail.created_at)}
              </span>
            </span>
            <Badge variant={statusBadgeVariant(detail.status)}>
              {statusLabel(detail.status)}
            </Badge>
          </div>

          {Array.isArray(detail.summary.messages)
            ? (detail.summary.messages as unknown[]).length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {(detail.summary.messages as unknown[]).map((msg, i) => {
                    const message = String(msg);
                    const isAlert =
                      message.includes("⚠️") ||
                      message.toLowerCase().startsWith("alert");
                    const isRecorded =
                      !isAlert &&
                      (message.toLowerCase().includes("recorded") ||
                        message.toLowerCase().includes("imported"));
                    const isMuted =
                      message.toLowerCase().includes("0 stock") ||
                      message.toLowerCase().includes("skipped") ||
                      message.toLowerCase().includes("omitted");

                    return (
                      <li
                        key={i}
                        className={cn(
                          "flex items-start gap-2 text-sm",
                          isRecorded && "text-brand font-semibold",
                          isAlert && "text-warning font-medium",
                          isMuted && "text-text-muted",
                          !isRecorded && !isAlert && !isMuted && "text-text-primary",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 shrink-0 rounded-full",
                            isRecorded
                              ? "bg-brand w-2 h-2 mt-1.5 ring-2 ring-brand/30"
                              : isAlert
                              ? "bg-warning w-1.5 h-1.5"
                              : isMuted
                              ? "bg-text-muted/50 w-1.5 h-1.5"
                              : "bg-text-muted w-1.5 h-1.5",
                          )}
                          aria-hidden="true"
                        />
                        <span>{message}</span>
                      </li>
                    );
                  })}
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

          {isGeneralFile ? (
            <div className="rounded-lg border border-border bg-bg-subtle px-4 py-3 text-sm text-text-secondary">
              This general file is stored exactly as uploaded.
              Download it to view or use it; no retail records were created.
            </div>
          ) : (
            <ImportDataView
              clean={detail.clean}
              origin={detail.origin}
              isServerPaginated={true}
              onPageChange={handlePageChange}
              loadingPage={loadingPage}
              warningIndices={warningIndices}
              onWarningIndicesNeeded={loadWarningIndices}
            />
          )}
        </>
      )}
    </div>
  );
}

export default ImportHistoryDetailPage;
