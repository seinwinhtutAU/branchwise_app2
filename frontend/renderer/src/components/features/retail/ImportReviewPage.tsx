import { useEffect, useRef, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useConnectionStatus } from "@renderer/lib/connection";
import { RequestTimeoutError } from "@renderer/lib/network";
import { invalidateEverything } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { maybeCompressFile } from "@renderer/lib/uploadCompression";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { ProgressBar } from "@renderer/components/ui/ProgressBar";
import { ImportDataView } from "./ImportDataView";
import type { ImportPreviewResult, PendingImport, Profile } from "../types";

interface Props {
  session: Session;
  profile: Profile | null;
  pending: PendingImport;
  selectedBranchId?: string;
  // Set only when this file is one of several picked at once (see FileImportCard) — an
  // ad-hoc single-file reimport (Import History, Warning page) has no queue to show.
  queuePosition?: { index: number; total: number };
  onBack: () => void;
  onConfirmed: (summary: Record<string, unknown>) => void;
}

function ImportReviewPage({
  session,
  profile,
  pending,
  selectedBranchId: selectedBranchIdProp,
  queuePosition,
  onBack,
  onConfirmed,
}: Props): React.JSX.Element {
  const {
    importLabel,
    endpoint,
    file,
    result,
    revertBatchId,
    replacingFilename,
  } = pending;
  const showToast = useToast();

  const effectiveBranchId = profile?.branch_id ?? selectedBranchIdProp ?? "";
  const isBranchMissing = profile !== null && profile.branch_id === null && !effectiveBranchId;

  // Sale and Inventory dates are cleaned using the branch's own date-format setting
  // (see backend app.routers.imports) — for an admin account, that branch is resolved
  // from the sidebar picker. Once a branch is known, re-run preview with it so what's
  // shown here always matches what actually gets saved on Confirm, rather than only
  // fixing itself silently after the fact. Purchase has no per-line date in the source
  // file at all, so it has nothing to re-preview.
  // so it has nothing to re-preview.
  const needsDateFormatRepreview =
    endpoint === "/api/imports/sales" || endpoint === "/api/imports/inventory";
  const [displayResult, setDisplayResult] =
    useState<ImportPreviewResult>(result);
  const [repreviewing, setRepreviewing] = useState(false);

  // Purchase batches have no per-line date in the source file, so the backend defaults
  // to today's date — this lets the importer override that, e.g. when uploading a file
  // for a purchase that actually happened on an earlier day.
  const isPurchaseImport = endpoint === "/api/imports/purchase";
  const [purchaseDate, setPurchaseDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );

  const [confirming, setConfirming] = useState(false);

  // A confirm that never reached the server, held so the connection coming back finishes
  // it instead of the importer having to notice and press the button again. The file is
  // already in memory here, so "queued" costs nothing — but it lives only as long as this
  // screen: closing the app means picking the file again.
  const [waitingForConnection, setWaitingForConnection] = useState(false);
  const connection = useConnectionStatus();
  // A reimport reverts the old batch first. If that part succeeded and only the upload
  // failed, the retry must not revert a second time — the batch is already gone.
  const alreadyReverted = useRef(false);

  useEffect(() => {
    if (!effectiveBranchId || !needsDateFormatRepreview)
      return;
    let cancelled = false;
    setRepreviewing(true);

    // Reuse the staged copy of this file from the initial preview instead of
    // re-uploading it — only falls back to sending the file itself if that preview
    // never staged one (e.g. an older backend).
    (result.staged_upload_id
      ? Promise.resolve(result.staged_upload_id).then((stagedUploadId) => {
          const formData = new FormData();
          formData.append("staged_upload_id", stagedUploadId);
          formData.append("branch_id", effectiveBranchId);
          return formData;
        })
      : maybeCompressFile(file).then((uploadFile) => {
          const formData = new FormData();
          formData.append("file", uploadFile);
          formData.append("branch_id", effectiveBranchId);
          return formData;
        })
    )
      .then((formData) =>
        fetch(`${apiBaseUrl}${endpoint}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData,
        }),
      )
      .then(async (r) =>
        r.ok ? ((await r.json()) as ImportPreviewResult) : null,
      )
      .then((body) => {
        if (cancelled || !body) return;
        setDisplayResult(body);
      })
      .catch(() => {
        // Leaves the prior preview showing — Confirm still re-parses server-side with
        // the now-known branch regardless, so this only affects what's displayed here.
      })
      .finally(() => {
        if (!cancelled) setRepreviewing(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBranchId, needsDateFormatRepreview]);

  async function handleConfirm(): Promise<void> {
    if (isBranchMissing) {
      showToast(
        "error",
        "Please select a branch in the sidebar before confirming.",
      );
      return;
    }

    setConfirming(true);
    setWaitingForConnection(false);
    let removedPrevious = alreadyReverted.current;

    try {
      if (revertBatchId && !alreadyReverted.current) {
        // replaced=true marks the old batch REIMPORTED rather than REVERTED/"Removed" —
        // see ImportBatchStatus. The inline note below (not a blocking confirm() popup)
        // is the warning here; the user already chose to pick a replacement file.
        const revertResponse = await fetch(
          `${apiBaseUrl}/api/imports/history/${revertBatchId}/revert?replaced=true`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
          },
        );
        if (!revertResponse.ok) {
          const revertBody = await revertResponse.json().catch(() => null);
          showToast(
            "error",
            revertBody?.detail ??
              `Couldn't remove the previous import: ${revertResponse.status}`,
          );
          return;
        }
        removedPrevious = true;
        alreadyReverted.current = true;
      }

      function buildFormData(): FormData {
        const formData = new FormData();
        if (effectiveBranchId) formData.append("branch_id", effectiveBranchId);
        if (isPurchaseImport && purchaseDate)
          formData.append("purchase_date", purchaseDate);
        return formData;
      }

      async function confirmWithFile(): Promise<Response> {
        const formData = buildFormData();
        formData.append("file", await maybeCompressFile(file));
        return fetch(`${apiBaseUrl}${endpoint}/confirm`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData,
        });
      }

      // The preview screen already staged this file's bytes server-side (the initial
      // preview, or its branch-aware repreview) — send that id instead of the file
      // itself. Only falls back to uploading the file when that id has since expired.
      let response: Response;
      if (displayResult.staged_upload_id) {
        const formData = buildFormData();
        formData.append("staged_upload_id", displayResult.staged_upload_id);
        response = await fetch(`${apiBaseUrl}${endpoint}/confirm`, {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}` },
          body: formData,
        });
        if (response.status === 404) {
          response = await confirmWithFile();
        }
      } else {
        response = await confirmWithFile();
      }

      const body = await response.json().catch(() => null);
      if (!response.ok) {
        showToast(
          "error",
          removedPrevious
            ? `Removed the previous import, but saving the new file failed (${body?.detail ?? response.status}). Import it again from here.`
            : (body?.detail ?? `Import failed: ${response.status}`),
        );
        return;
      }

      // Sales/inventory/purchase data just changed, so every cached dashboard and
      // Warning page is out of date. This is the honest invalidation signal in this app
      // — a confirmed or reverted import is the only thing that moves that data.
      invalidateEverything();
      onConfirmed(body);
    } catch (error) {
      // A request that timed out may have been saved anyway — the answer just never came
      // back. Purchase imports in particular are not idempotent (see the import docs), so
      // sending this file again on the app's own initiative could double-count a whole
      // batch. That one is for a person to decide, after looking at Import History.
      if (error instanceof RequestTimeoutError) {
        showToast(
          "error",
          removedPrevious
            ? "The server stopped responding while saving. Check Import History before importing this file again — it may already be in."
            : "The server stopped responding. Check Import History before importing this file again — it may already have been saved.",
        );
        return;
      }
      // Nothing left the machine at all, so this is the connection rather than the file.
      // Hold on to it and send it again once the link is usable — an import is the one
      // thing in this app that can't just be re-read later from cache.
      setWaitingForConnection(true);
      showToast(
        "info",
        "No connection — this file will be sent automatically when the connection is back. Keep this window open.",
      );
    } finally {
      setConfirming(false);
    }
  }

  // The retry itself. Fires when the connection store stops reporting an outage, which
  // the network layer discovers on its own by probing the database every few seconds.
  useEffect(() => {
    if (!waitingForConnection || confirming || connection === "offline") return;
    void handleConfirm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForConnection, confirming, connection]);

  return (
    <div className="flex flex-col gap-4 animate-fade-in motion-reduce:animate-none">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Back to Import"
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
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight">
            Review {importLabel} import
            {queuePosition && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                File {queuePosition.index} of {queuePosition.total}
              </span>
            )}
          </h2>
          <p className="text-sm text-text-muted truncate">{result.filename}</p>
        </div>
      </div>

      {queuePosition && (
        <ProgressBar
          value={((queuePosition.index - 1) / queuePosition.total) * 100}
          className="max-w-sm"
        />
      )}

      {waitingForConnection && (
        <p className="text-sm text-warning bg-warning-subtle rounded-md px-3 py-2">
          Waiting for the connection — this file will be imported automatically
          as soon as it is back. Leaving this screen or closing the app cancels
          it.
        </p>
      )}

      {revertBatchId && (
        <p className="text-sm text-warning bg-warning-subtle rounded-md px-3 py-2">
          Confirming will remove{" "}
          <strong>{replacingFilename ?? "the previous import"}</strong> and save
          this file in its place.
        </p>
      )}

      <ImportDataView
        clean={displayResult.clean}
        origin={displayResult.origin}
        controls={
          <div className="flex items-end gap-3 flex-wrap">
            {isPurchaseImport && (
              <div className="w-48">
                <Input
                  type="date"
                  label="Purchase date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>
            )}
            {isBranchMissing && (
              <p className="text-sm text-warning self-center">
                Please select a branch in the sidebar to proceed.
              </p>
            )}
            <Button
              onClick={handleConfirm}
              loading={confirming}
              disabled={repreviewing || isBranchMissing}
            >
              {revertBatchId ? "Confirm & Replace" : "Confirm Import"}
            </Button>
            <Button variant="ghost" onClick={onBack}>
              {queuePosition ? "Skip this file" : "Cancel"}
            </Button>
          </div>
        }
      />
    </div>
  );
}

export default ImportReviewPage;
