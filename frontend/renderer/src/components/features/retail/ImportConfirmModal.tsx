import { useState, useEffect, useRef, useMemo } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { invalidateEverything } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { formatRetailDate } from "@renderer/lib/retailDateTime";
import { maybeCompressFile } from "@renderer/lib/uploadCompression";
import { Button } from "@renderer/components/ui/Button";
import { ProgressBar } from "@renderer/components/ui/ProgressBar";
import {
  UploadIcon,
  SalesIcon,
  PurchaseIcon,
  InventoryIcon,
  CheckIcon,
  TrashIcon,
  WarningIcon,
  CalendarIcon,
} from "@renderer/components/ui/icons";
import type { Profile, SelectedImportFile } from "../types";

interface FileInspection {
  status: "checking" | "valid" | "wrong_type" | "unrecognized" | "invalid";
  detected_type?: string;
  expected_type?: string;
  dates: string[];
  purchase_number?: string | null;
  row_count: number;
  zero_count?: number | null;
  nonzero_count?: number | null;
  error_message?: string | null;
  // Set on a "valid" result — the backend's copy of this file, so Confirm can send
  // this id back instead of re-uploading the file a second time.
  staged_upload_id?: string;
}

interface ImportConfirmModalProps {
  session: Session;
  profile: Profile | null;
  files: SelectedImportFile[];
  selectedBranchId?: string;
  branchName?: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (count: number) => void;
  onRemoveFile?: (id: string) => void;
  onRemoveFiles?: (ids: string[]) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExpectedType(endpoint: string): "sale" | "purchase" | "inventory" {
  if (endpoint.includes("sales")) return "sale";
  if (endpoint.includes("purchase")) return "purchase";
  return "inventory";
}

function getExpectedTypeLabel(endpoint: string): string {
  if (endpoint.includes("sales")) return "Sale";
  if (endpoint.includes("purchase")) return "Purchase";
  return "Inventory";
}

function getFileIcon(endpoint: string, isInvalid: boolean): React.JSX.Element {
  if (isInvalid) {
    return (
      <div className="w-6 h-6 rounded-md bg-bg-subtle text-text-muted flex items-center justify-center shrink-0">
        <WarningIcon className="w-3.5 h-3.5" />
      </div>
    );
  }
  if (endpoint.includes("sales")) {
    return (
      <div className="w-6 h-6 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
        <SalesIcon className="w-3.5 h-3.5" />
      </div>
    );
  }
  if (endpoint.includes("purchase")) {
    return (
      <div className="w-6 h-6 rounded-md bg-pink-500/15 text-pink-600 dark:text-pink-400 flex items-center justify-center shrink-0">
        <PurchaseIcon className="w-3.5 h-3.5" />
      </div>
    );
  }
  return (
    <div className="w-6 h-6 rounded-md bg-sky-500/15 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
      <InventoryIcon className="w-3.5 h-3.5" />
    </div>
  );
}

function formatDateLabel(isoDate: string): string {
  return formatRetailDate(isoDate);
}

function formatShortDate(isoDate: string): string {
  try {
    const [, m, d] = isoDate.split("-").map(Number);
    if (!m || !d) return isoDate;
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return `${d} ${months[m - 1]}`;
  } catch {
    return isoDate;
  }
}

export default function ImportConfirmModal({
  session,
  profile,
  files,
  selectedBranchId,
  branchName,
  isOpen,
  onClose,
  onSuccess,
  onRemoveFile,
  onRemoveFiles,
}: ImportConfirmModalProps): React.JSX.Element | null {
  const showToast = useToast();
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    filename: string;
  } | null>(null);
  const [inspections, setInspections] = useState<
    Record<string, FileInspection>
  >({});
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const inspectedFileIdsRef = useRef<Set<string>>(new Set());

  const needsBranchSelection = profile !== null && profile.branch_id === null;
  const isBranchMissing = needsBranchSelection && !selectedBranchId;

  const firstEndpoint = files[0]?.endpoint || "";
  const expectedType = getExpectedType(firstEndpoint);
  const expectedTypeLabel = getExpectedTypeLabel(firstEndpoint);

  // Inspect files
  useEffect(() => {
    if (!isOpen || files.length === 0) {
      setInspections({});
      setSelectedIds([]);
      inspectedFileIdsRef.current.clear();
      return;
    }

    const MAX_BATCH_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

    files.forEach((item) => {
      if (inspectedFileIdsRef.current.has(item.id)) return;
      inspectedFileIdsRef.current.add(item.id);

      if (item.file.size > MAX_BATCH_SIZE_BYTES) {
        setInspections((prev) => ({
          ...prev,
          [item.id]: {
            status: "invalid",
            dates: [],
            purchase_number: null,
            row_count: 0,
            error_message: "Too large: exceeds 50 MB limit",
          },
        }));
        return;
      }

      setInspections((prev) => ({
        ...prev,
        [item.id]: {
          status: "checking",
          dates: [],
          purchase_number: null,
          row_count: 0,
        },
      }));

      const expType = getExpectedType(item.endpoint);

      maybeCompressFile(item.file)
        .then((uploadFile) => {
          const formData = new FormData();
          formData.append("file", uploadFile);
          formData.append("expected_type", expType);

          return fetch(`${apiBaseUrl}/api/imports/inspect`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: formData,
          });
        })
        .then(async (res) => {
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            const msg = body?.detail || "";
            if (res.status === 413 || msg.toLowerCase().includes("too large")) {
              return {
                status: "invalid" as const,
                dates: [],
                purchase_number: null,
                row_count: 0,
                error_message: "Too large: exceeds 50 MB limit",
              };
            }
            return {
              status: "invalid" as const,
              dates: [],
              purchase_number: null,
              row_count: 0,
              error_message: `Not a ${expType} file`,
            };
          }
          return res.json() as Promise<FileInspection>;
        })
        .then((result) => {
          setInspections((prev) => ({
            ...prev,
            [item.id]: result,
          }));
        })
        .catch(() => {
          setInspections((prev) => ({
            ...prev,
            [item.id]: {
              status: "invalid",
              dates: [],
              purchase_number: null,
              row_count: 0,
              error_message: `Not a ${expType} file`,
            },
          }));
        });
    });
  }, [isOpen, files, session.access_token]);

  const totalSizeBytes = useMemo(
    () => files.reduce((acc, f) => acc + f.file.size, 0),
    [files],
  );
  const isTotalSizeExceeded = totalSizeBytes > 50 * 1024 * 1024;

  // Track invalid files
  const invalidFiles = useMemo(() => {
    return files.filter(
      (f) =>
        inspections[f.id] &&
        inspections[f.id].status !== "checking" &&
        inspections[f.id].status !== "valid",
    );
  }, [files, inspections]);

  // Keep selectedIds in sync when files are removed
  useEffect(() => {
    const fileIdSet = new Set(files.map((f) => f.id));
    setSelectedIds((prev) => prev.filter((id) => fileIdSet.has(id)));
  }, [files]);

  // Auto-select invalid files by default so user can immediately delete with 1 click
  useEffect(() => {
    if (invalidFiles.length > 0) {
      setSelectedIds((prev) => {
        const combined = new Set([...prev, ...invalidFiles.map((f) => f.id)]);
        return Array.from(combined);
      });
    }
  }, [invalidFiles.length]);

  if (!isOpen || files.length === 0) return null;

  const hasCheckingFiles = files.some(
    (f) => !inspections[f.id] || inspections[f.id].status === "checking",
  );
  const hasInvalidFiles = invalidFiles.length > 0;
  const canConfirm =
    !hasCheckingFiles &&
    !hasInvalidFiles &&
    !isTotalSizeExceeded &&
    !isBranchMissing &&
    !importing;

  const allInvalidSelected =
    invalidFiles.length > 0 &&
    invalidFiles.every((f) => selectedIds.includes(f.id));

  function toggleSelectAllInvalid(): void {
    if (allInvalidSelected) {
      const invalidSet = new Set(invalidFiles.map((f) => f.id));
      setSelectedIds((prev) => prev.filter((id) => !invalidSet.has(id)));
    } else {
      const combined = new Set([
        ...selectedIds,
        ...invalidFiles.map((f) => f.id),
      ]);
      setSelectedIds(Array.from(combined));
    }
  }

  function toggleSelect(id: string): void {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  }

  function handleDeleteSelected(): void {
    if (selectedIds.length === 0) return;
    if (onRemoveFiles) {
      onRemoveFiles(selectedIds);
    } else if (onRemoveFile) {
      selectedIds.forEach((id) => onRemoveFile(id));
    }
    const count = selectedIds.length;
    setSelectedIds([]);
    showToast("info", `Removed ${count} ${count === 1 ? "file" : "files"}.`);
  }

  async function handleImportAll(): Promise<void> {
    if (isBranchMissing) {
      showToast(
        "error",
        "Please select a branch at the top right before confirming.",
      );
      return;
    }
    if (isTotalSizeExceeded) {
      showToast(
        "error",
        `Total upload size (${formatFileSize(totalSizeBytes)}) exceeds the 50 MB limit.`,
      );
      return;
    }
    if (hasInvalidFiles) {
      showToast(
        "error",
        `Please delete non-${expectedType} files before confirming.`,
      );
      return;
    }

    setImporting(true);
    let successCount = 0;
    const errors: string[] = [];
    const total = files.length;
    let completedCount = 0;

    const concurrency = 3;
    let fileIdx = 0;

    async function uploadWorker(): Promise<void> {
      while (fileIdx < files.length) {
        const item = files[fileIdx++];
        if (!item) break;

        const inspection = inspections[item.id];
        // Keep this key for both the original confirmation and a later status check.
        // A lost response must never make an already-committed import look failed.
        const idempotencyKey = crypto.randomUUID();
        setProgress({
          current: completedCount + 1,
          total,
          filename: item.file.name,
        });

        try {
          if (item.revertBatchId) {
            const revertResponse = await fetch(
              `${apiBaseUrl}/api/imports/history/${item.revertBatchId}/revert?replaced=true`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${session.access_token}` },
              },
            );
            if (!revertResponse.ok) {
              const body = await revertResponse.json().catch(() => null);
              errors.push(
                `${item.file.name}: ${body?.detail ?? `Could not replace earlier import (${revertResponse.status})`}`,
              );
              completedCount++;
              continue;
            }
          }

          const endpoint = item.endpoint.endsWith("/confirm")
            ? item.endpoint
            : `${item.endpoint}/confirm`;

          // Shared fields every confirm needs regardless of how the file itself is sent.
          function buildFormData(): FormData {
            const formData = new FormData();
            if (needsBranchSelection && selectedBranchId) {
              formData.append("branch_id", selectedBranchId);
            }
            if (item.endpoint.includes("purchase")) {
              if (inspection?.dates?.[0]) {
                formData.append("purchase_date", inspection.dates[0]);
              }
              if (inspection?.purchase_number) {
                formData.append("purchase_number", inspection.purchase_number);
              }
            }
            return formData;
          }

          async function confirmWithFile(): Promise<Response> {
            const formData = buildFormData();
            formData.append("file", await maybeCompressFile(item.file));
            return fetch(`${apiBaseUrl}${endpoint}`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                "Idempotency-Key": idempotencyKey,
              },
              body: formData,
            });
          }

          // The Inspect step already staged this file's bytes server-side — send its
          // id instead of the (possibly large) file a second time. Only if that id
          // has since expired (server restart, or the 24h sweep) does this fall back
          // to uploading the file itself, same as before staging existed.
          let response: Response;
          if (inspection?.staged_upload_id) {
            const formData = buildFormData();
            formData.append("staged_upload_id", inspection.staged_upload_id);
            response = await fetch(`${apiBaseUrl}${endpoint}`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${session.access_token}`,
                "Idempotency-Key": idempotencyKey,
              },
              body: formData,
            });
            if (response.status === 404) {
              response = await confirmWithFile();
            }
          } else {
            response = await confirmWithFile();
          }

          if (response.ok) {
            successCount++;
          } else {
            const body = await response.json().catch(() => null);
            errors.push(
              `${item.file.name}: ${body?.detail ?? `Failed (${response.status})`}`,
            );
          }
        } catch {
          // The database can commit just before a connection drops. Ask the server
          // about this exact idempotency key before treating the import as failed.
          try {
            const statusResponse = await fetch(
              `${apiBaseUrl}/api/imports/confirm-status?request_key=${encodeURIComponent(idempotencyKey)}`,
              { headers: { Authorization: `Bearer ${session.access_token}` } },
            );
            const statusBody = await statusResponse.json().catch(() => null);
            if (statusResponse.ok && statusBody?.confirmed === true) {
              successCount++;
              continue;
            }
          } catch {
            // The original message below tells the user exactly where to verify.
          }
          errors.push(
            `${item.file.name}: We could not confirm the result. Check Import History before uploading it again.`,
          );
        } finally {
          completedCount++;
          setProgress({
            current: Math.min(completedCount, total),
            total,
            filename: item.file.name,
          });
        }
      }
    }

    const workers = Array.from(
      { length: Math.min(concurrency, files.length) },
      () => uploadWorker(),
    );
    await Promise.all(workers);

    setImporting(false);
    setProgress(null);

    if (errors.length > 0) {
      errors.forEach((err) => showToast("error", err));
    }

    if (successCount > 0) {
      invalidateEverything();
      showToast(
        "success",
        `Successfully imported ${successCount} ${successCount === 1 ? "file" : "files"}!`,
      );
      onSuccess(successCount);
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-modal-title"
    >
      <div className="bg-bg-base border border-border rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-subtle text-brand flex items-center justify-center">
              <UploadIcon className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  id="import-modal-title"
                  className="text-sm font-semibold text-text-primary"
                >
                  Import {expectedTypeLabel} Files
                </h3>
                {branchName && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-brand-subtle text-brand text-[10px] font-semibold border border-brand/20">
                    Branch: {branchName}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-text-muted flex items-center gap-1.5 flex-wrap">
                <span>
                  {files.length} {files.length === 1 ? "file" : "files"}{" "}
                  selected ({formatFileSize(totalSizeBytes)})
                </span>
                {isTotalSizeExceeded && (
                  <span className="text-amber-600 dark:text-amber-400 font-semibold">
                    — Exceeds 50 MB limit
                  </span>
                )}
              </p>
            </div>
          </div>
          {!importing && (
            <button
              onClick={onClose}
              className="text-text-muted hover:text-text-primary p-1 rounded-md hover:bg-bg-raised transition-colors cursor-pointer text-xs"
              aria-label="Close"
            >
              ✕
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          {/* Warning banner for total size exceeded or invalid files */}
          {(isTotalSizeExceeded || hasInvalidFiles) && (
            <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 animate-fade-in">
              <WarningIcon className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span className="font-medium text-xs">
                {isTotalSizeExceeded && hasInvalidFiles
                  ? `Total upload size (${formatFileSize(totalSizeBytes)}) exceeds 50 MB limit, and invalid files detected. Remove files to confirm.`
                  : isTotalSizeExceeded
                    ? `Total upload size (${formatFileSize(totalSizeBytes)}) exceeds the 50 MB limit. Remove files to confirm.`
                    : `Invalid files detected. Remove non-${expectedType} files to confirm.`}
              </span>
            </div>
          )}

          {/* Branch required warning for admin */}
          {isBranchMissing && (
            <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/25 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
              <WarningIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[11px]">
                Select target branch from the top right of the page before
                confirming.
              </span>
            </div>
          )}

          {/* Files section */}
          <div className="space-y-2">
            {/* Action Bar with Multi-select and Delete Button directly to the right */}
            <div className="flex items-center justify-between gap-2 py-1.5 px-2.5 bg-bg-subtle/60 rounded-lg border border-border/60">
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="text-xs font-bold text-text-primary uppercase tracking-wider">
                  Files ({files.length})
                </span>

                {/* Checkbox to select all non-sale files */}
                {hasInvalidFiles && (
                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-medium text-text-secondary hover:text-text-primary select-none bg-bg-subtle hover:bg-bg-raised px-2 py-0.5 rounded border border-border transition-colors">
                    <input
                      type="checkbox"
                      checked={allInvalidSelected}
                      onChange={toggleSelectAllInvalid}
                      className="rounded border-border text-brand focus:ring-brand/30 cursor-pointer w-3.5 h-3.5"
                    />
                    <span>
                      Select non-{expectedType} ({invalidFiles.length})
                    </span>
                  </label>
                )}

                {/* Delete button positioned directly at the right of Select non-sale */}
                {selectedIds.length > 0 && !importing && (
                  <button
                    type="button"
                    onClick={handleDeleteSelected}
                    className="inline-flex items-center gap-1 px-2.5 py-0.5 text-xs font-bold rounded-md bg-red-600 text-white hover:bg-red-700 active:bg-red-800 transition-colors shadow-xs cursor-pointer"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                    <span>Delete ({selectedIds.length})</span>
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {hasCheckingFiles && (
                  <span className="text-[10px] text-text-muted flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand animate-ping" />
                    Checking…
                  </span>
                )}
              </div>
            </div>

            {/* Compact File Cards */}
            <div className="space-y-1.5">
              {files.map((item) => {
                const inspection = inspections[item.id];
                const isChecking =
                  !inspection || inspection.status === "checking";
                const isInvalid =
                  inspection &&
                  inspection.status !== "checking" &&
                  inspection.status !== "valid";
                const isValid = inspection && inspection.status === "valid";
                const isSelected = selectedIds.includes(item.id);

                return (
                  <div
                    key={item.id}
                    className={`py-2 px-2.5 rounded-lg border transition-all duration-150 flex items-center justify-between gap-2.5 text-xs ${
                      isValid
                        ? "border-emerald-500/35 bg-emerald-500/[0.03] border-l-[3px] border-l-emerald-500 shadow-xs"
                        : isInvalid
                          ? "border-border bg-bg-subtle/30 text-text-muted"
                          : "border-border bg-bg-surface/50"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {/* Selection checkbox */}
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(item.id)}
                        disabled={importing}
                        className="rounded border-border text-brand focus:ring-brand/30 cursor-pointer w-3.5 h-3.5 shrink-0"
                        aria-label={`Select ${item.file.name}`}
                      />

                      {/* Compact Icon */}
                      <div className="shrink-0">
                        {getFileIcon(item.endpoint, isInvalid)}
                      </div>

                      {/* File Name & Size */}
                      <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-text-primary truncate font-mono text-xs max-w-[200px] sm:max-w-[260px]">
                          {item.file.name}
                        </span>
                        <span className="text-[10px] text-text-muted shrink-0">
                          {formatFileSize(item.file.size)}
                        </span>

                        {/* Checking spinner */}
                        {isChecking && (
                          <span className="text-[10px] text-text-muted italic shrink-0">
                            Checking format…
                          </span>
                        )}

                        {/* Valid explicit badge */}
                        {isValid && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/25 shrink-0">
                            <CheckIcon className="w-2.5 h-2.5 stroke-[2.5]" />
                            Valid {expectedTypeLabel}
                          </span>
                        )}

                        {/* Short invalid badge */}
                        {isInvalid && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-subtle text-text-muted border border-border shrink-0">
                            <WarningIcon className="w-2.5 h-2.5" />
                            {inspection.error_message ||
                              `Not a ${expectedType} file`}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Metadata tags (Dates, Purchase Number, Row Count) */}
                    {isValid && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        {/* Purchase Number */}
                        {inspection.purchase_number && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-brand-subtle text-brand text-[10px] font-mono font-semibold border border-brand/20">
                            STR: {inspection.purchase_number}
                          </span>
                        )}

                        {/* Date: 1 date */}
                        {inspection.dates && inspection.dates.length === 1 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-subtle text-text-secondary text-[10px] font-medium border border-border">
                            <CalendarIcon className="w-2.5 h-2.5 text-text-muted" />
                            {formatShortDate(inspection.dates[0])}
                          </span>
                        )}

                        {/* Date: 2 dates */}
                        {inspection.dates && inspection.dates.length === 2 && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-subtle text-text-secondary text-[10px] font-medium border border-border">
                            <CalendarIcon className="w-2.5 h-2.5 text-text-muted" />
                            {formatShortDate(inspection.dates[0])},{" "}
                            {formatShortDate(inspection.dates[1])}
                          </span>
                        )}

                        {/* Date: > 2 dates with hover popover */}
                        {inspection.dates && inspection.dates.length > 2 && (
                          <div className="relative group inline-block">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-bg-subtle hover:bg-bg-raised text-text-secondary text-[10px] font-medium border border-border cursor-pointer transition-colors"
                            >
                              <CalendarIcon className="w-2.5 h-2.5 text-text-muted" />
                              <span>{inspection.dates.length} dates</span>
                            </button>

                            <div className="absolute right-0 bottom-full mb-1.5 hidden group-hover:flex flex-col z-50 p-2 bg-bg-surface border border-border rounded-lg shadow-xl text-xs max-w-xs pointer-events-auto animate-in fade-in-50 duration-150">
                              <span className="text-[10px] font-semibold text-text-muted pb-1 border-b border-border/50">
                                All Dates ({inspection.dates.length})
                              </span>
                              <div className="flex items-center gap-1 overflow-x-auto py-1 max-w-[240px] scrollbar-thin">
                                {inspection.dates.map((d) => (
                                  <span
                                    key={d}
                                    className="whitespace-nowrap px-1.5 py-0.5 rounded bg-bg-subtle text-text-primary text-[10px] font-mono border border-border"
                                  >
                                    {formatDateLabel(d)}
                                  </span>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Row count */}
                        {inspection.row_count > 0 && (
                          <span
                            className="text-[10px] font-medium text-text-muted"
                            title={
                              inspection.zero_count !== undefined &&
                              inspection.zero_count !== null
                                ? `Total: ${inspection.row_count.toLocaleString()} lines (${(inspection.nonzero_count ?? 0).toLocaleString()} active, ${inspection.zero_count.toLocaleString()} zero qty)`
                                : undefined
                            }
                          >
                            {expectedType === "inventory"
                              ? `${inspection.row_count.toLocaleString()} total lines (incl. 0 qty)`
                              : `${inspection.row_count.toLocaleString()} lines`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Progress Bar */}
          {importing && progress && (
            <div className="pt-1.5">
              <ProgressBar
                value={(progress.current / progress.total) * 100}
                label={`Importing ${progress.current} of ${progress.total}: ${progress.filename}`}
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-border bg-bg-base/30 flex items-center justify-end gap-2.5">
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={importing}
            className="h-8 text-xs"
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleImportAll}
            loading={importing}
            disabled={!canConfirm}
            className="flex items-center gap-1.5 min-w-[5.5rem] h-8 text-xs font-semibold"
          >
            <CheckIcon className="w-3.5 h-3.5" />
            <span>Confirm</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
