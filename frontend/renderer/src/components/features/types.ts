export interface Profile {
  id: string;
  email: string | null;
  name: string;
  role: string;
  branch_id: string | null;
  branch_name: string | null;
}

export interface RowIssue {
  column: string;
  message: string;
}

export interface CleanResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_issues: RowIssue[][];
}

export interface ImportPreviewResult {
  filename: string;
  origin: { rows: string[][]; row_issues: RowIssue[][] };
  clean: CleanResult;
}

export interface SelectedImportFile {
  id: string;
  file: File;
  endpoint: string;
  importLabel: string;
  revertBatchId?: string;
  replacingFilename?: string | null;
}

export interface PendingImport {
  // Unique per pick, even for two files with the same name — App.tsx keys
  // ImportReviewPage on this so switching to a different pending file (advancing a
  // multi-file queue, or a fresh single-file reimport) always remounts it with a clean
  // slate instead of reusing state (branch pick, previewed rows, etc.) from the last one.
  id: string;
  importLabel: string;
  endpoint: string;
  file: File;
  result: ImportPreviewResult;
  // When set, confirming this import first removes the batch it's replacing — see
  // ImportReviewPage's handleConfirm and lib/useImportFilePicker.
  revertBatchId?: string;
  replacingFilename?: string | null;
}

export interface ImportHistoryDetail {
  id: string;
  import_type: string;
  filename: string | null;
  branch_name: string | null;
  uploaded_by_name: string | null;
  status: string;
  summary: Record<string, unknown>;
  created_at: string;
  reverted_at: string | null;
  storage_key?: string | null;
  has_file?: boolean;
  origin: { rows: string[][]; row_issues: RowIssue[][] };
  clean: CleanResult;
}
