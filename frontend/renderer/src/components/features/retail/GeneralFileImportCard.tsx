import { useRef, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { invalidateEverything } from "@renderer/lib/queryClient";
import { useToast } from "@renderer/lib/useToast";
import { maybeCompressFile } from "@renderer/lib/uploadCompression";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { UploadIcon } from "@renderer/components/ui/icons";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

interface Props {
  session: Session;
  branchId: string;
}

function GeneralFileImportCard({ session, branchId }: Props): React.JSX.Element {
  const showToast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const oversizedFile = files.find((file) => file.size > MAX_FILE_SIZE_BYTES);
    if (oversizedFile) {
      showToast("error", `${oversizedFile.name} exceeds the 50 MB limit.`);
      return;
    }

    setIsUploading(true);
    try {
      const results = await Promise.all(
        files.map(async (file) => {
          const formData = new FormData();
          formData.append("file", await maybeCompressFile(file));
          if (branchId) formData.append("branch_id", branchId);

          const response = await fetch(`${apiBaseUrl}/api/imports/general`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: formData,
          });
          if (response.ok) return null;
          const body = await response.json().catch(() => null);
          return body?.detail ?? `${file.name}: upload failed (${response.status})`;
        }),
      );
      const errors = results.filter((result): result is string => result !== null);
      if (errors.length > 0) {
        showToast("error", errors.join(" "));
        return;
      }

      invalidateEverything();
      showToast(
        "success",
        `${files.length} daily operation cost ${files.length === 1 ? "file" : "files"} stored unchanged.`,
      );
    } catch {
      showToast("error", "Upload failed — is the backend running?");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-brand-subtle text-brand flex items-center justify-center shrink-0">
              <UploadIcon />
            </span>
            Daily Operation Cost
          </span>
        }
        description="Store daily cost records unchanged without adding them to retail data"
      />

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={(event) => void handleFileSelected(event)}
        className="hidden"
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={isUploading}
        className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-text-muted py-10 px-4 transition-all duration-150 hover:border-brand hover:text-brand hover:bg-brand-subtle/40 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 cursor-pointer"
      >
        <UploadIcon />
        <span className="text-sm font-medium">
          {isUploading ? "Storing files…" : "Click to choose files"}
        </span>
        <span className="text-xs">Any file type — up to 50 MB per file</span>
      </button>
    </Card>
  );
}

export default GeneralFileImportCard;
