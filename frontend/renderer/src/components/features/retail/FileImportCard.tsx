import { useRef, useState, type ReactNode } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { ProgressBar } from "@renderer/components/ui/ProgressBar";
import { UploadIcon } from "@renderer/components/ui/icons";
import type { ImportPreviewResult, PendingImport } from "../types";

interface Props {
  session: Session;
  label: string;
  description: string;
  endpoint: string;
  icon: ReactNode;
  // Called once with every file that parsed successfully — one at a time even for a
  // multi-file pick, since each still needs its own branch/date review before Confirm.
  // A file that fails to parse gets its own error toast and is left out of the batch;
  // the rest still go through.
  onFilesReady: (pendings: PendingImport[]) => void;
}

// Upload trigger only — the origin/clean preview + confirm step lives on
// ImportReviewPage, reached after a file is picked and parsed here.
function FileImportCard({
  session,
  label,
  description,
  endpoint,
  icon,
  onFilesReady,
}: Props): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  // Set together right before each file starts, so the bar always reflects "how many are
  // already done" rather than "how many have started" — this only ever moves forward.
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    fileName: string;
  } | null>(null);
  const showToast = useToast();

  async function previewOne(file: File): Promise<PendingImport | null> {
    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        showToast(
          "error",
          `${file.name}: ${body?.detail ?? `Upload failed (${response.status})`}`,
        );
        return null;
      }

      const result: ImportPreviewResult = await response.json();
      return {
        id: crypto.randomUUID(),
        importLabel: label,
        endpoint,
        file,
        result,
      };
    } catch {
      showToast(
        "error",
        `${file.name}: Upload failed — is the backend running?`,
      );
      return null;
    }
  }

  async function handleFileSelected(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    setUploading(true);
    try {
      // One at a time, not Promise.all — each call resolves which branch a row belongs
      // to from server state, so parsing several of the same endpoint concurrently would
      // race rather than actually go faster.
      const pendings: PendingImport[] = [];
      for (const [i, file] of files.entries()) {
        setProgress({ done: i, total: files.length, fileName: file.name });
        const pending = await previewOne(file);
        if (pending) pendings.push(pending);
      }
      if (pendings.length > 0) onFilesReady(pendings);
    } finally {
      setUploading(false);
      setProgress(null);
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-brand-subtle text-brand flex items-center justify-center shrink-0">
              {icon}
            </span>
            {label}
          </span>
        }
        description={description}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xls,.xlsx"
        multiple
        onChange={handleFileSelected}
        className="hidden"
      />

      {!uploading && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-text-muted py-10 px-4 transition-all duration-150 hover:border-brand hover:text-brand hover:bg-brand-subtle/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <UploadIcon />
          <span className="text-sm font-medium">Click to choose files</span>
          <span className="text-xs">
            .csv, .xls, or .xlsx — pick several to review one after another
          </span>
        </button>
      )}

      {uploading && progress && progress.total > 1 && (
        <div
          className="flex flex-col gap-2 py-8 px-2"
          role="status"
          aria-label="Uploading"
        >
          <ProgressBar
            value={(progress.done / progress.total) * 100}
            label={`Reading file ${progress.done + 1} of ${progress.total}: ${progress.fileName}`}
          />
        </div>
      )}

      {uploading && (!progress || progress.total <= 1) && (
        <div
          className="flex flex-col gap-2 py-6"
          role="status"
          aria-label="Uploading"
        >
          {[...Array(3)].map((_, i) => (
            <div
              key={i}
              className="h-8 rounded-md bg-bg-raised animate-pulse motion-reduce:animate-none"
            />
          ))}
        </div>
      )}
    </Card>
  );
}

export default FileImportCard;
