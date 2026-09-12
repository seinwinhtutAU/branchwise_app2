import { useRef, useState, type ChangeEvent } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import type { PendingImport } from "@renderer/components/features/types";

interface PickContext {
  endpoint: string;
  importLabel: string;
  // When set, confirming the resulting PendingImport should remove this batch first —
  // used by the Warning page's "Import to fix" and Import History's "Reimport" actions,
  // both of which pick a corrected file for one specific bad import rather than adding
  // a new one via the plain Import section.
  revertBatchId?: string;
  replacingFilename?: string | null;
}

// Shared "pick a file → parse/preview it → hand off as a PendingImport" flow for
// anywhere an import is triggered without going through the FileImportCard grid.
export function useImportFilePicker(
  session: Session,
  onFileReady?: (pending: PendingImport) => void,
): {
  trigger: (context: PickContext) => void;
  input: React.JSX.Element;
  picking: boolean;
} {
  const showToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contextRef = useRef<PickContext | null>(null);
  const [picking, setPicking] = useState(false);

  function trigger(context: PickContext): void {
    contextRef.current = context;
    fileInputRef.current?.click();
  }

  async function handleChange(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    const context = contextRef.current;
    if (!file || !context) return;

    setPicking(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`${apiBaseUrl}${context.endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        showToast("error", body?.detail ?? `Upload failed: ${response.status}`);
        return;
      }
      const result = await response.json();
      onFileReady?.({
        id: crypto.randomUUID(),
        importLabel: context.importLabel,
        endpoint: context.endpoint,
        file,
        result,
        revertBatchId: context.revertBatchId,
        replacingFilename: context.replacingFilename,
      });
    } catch {
      showToast("error", "Upload failed — is the backend running?");
    } finally {
      setPicking(false);
    }
  }

  const input = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".csv,.xls,.xlsx"
      className="hidden"
      onChange={handleChange}
    />
  );

  return { trigger, input, picking };
}
