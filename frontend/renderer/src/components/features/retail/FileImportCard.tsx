import { useRef, type ReactNode } from "react";
import type { Session } from "@renderer/lib/auth";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { UploadIcon } from "@renderer/components/ui/icons";
import type { PendingImport, SelectedImportFile } from "../types";

interface Props {
  session: Session;
  label: string;
  description: string;
  endpoint: string;
  icon: ReactNode;
  onFilesSelected?: (files: SelectedImportFile[]) => void;
  onFilesReady?: (pendings: PendingImport[]) => void;
}

// Upload trigger — lets the user pick files and immediately hands them off to the
// streamlined confirm modal or batch queue.
function FileImportCard({
  label,
  description,
  endpoint,
  icon,
  onFilesSelected,
  onFilesReady,
}: Props): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;

    const selected: SelectedImportFile[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      endpoint,
      importLabel: label,
    }));

    if (onFilesSelected) {
      onFilesSelected(selected);
    } else if (onFilesReady) {
      // Fallback if older handler is passed
      const fakePending: PendingImport[] = selected.map((s) => ({
        id: s.id,
        importLabel: s.importLabel,
        endpoint: s.endpoint,
        file: s.file,
        result: {
          filename: s.file.name,
          origin: { rows: [], row_issues: [] },
          clean: { columns: [], rows: [], row_issues: [] },
        },
      }));
      onFilesReady(fakePending);
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

      <button
        onClick={() => fileInputRef.current?.click()}
        className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-text-muted py-10 px-4 transition-all duration-150 hover:border-brand hover:text-brand hover:bg-brand-subtle/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 cursor-pointer"
      >
        <UploadIcon />
        <span className="text-sm font-medium">Click to choose files</span>
        <span className="text-xs">
          .csv, .xls, or .xlsx — pick one or several files
        </span>
      </button>
    </Card>
  );
}

export default FileImportCard;

