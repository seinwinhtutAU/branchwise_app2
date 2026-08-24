export interface Profile {
  id: string
  email: string | null
  name: string
  role: string
  branch_id: string | null
  branch_name: string | null
}

export interface RowIssue {
  column: string
  message: string
}

export interface CleanResult {
  columns: string[]
  rows: Record<string, unknown>[]
  row_issues: RowIssue[][]
}

export interface ImportPreviewResult {
  filename: string
  origin: { rows: string[][]; row_issues: RowIssue[][] }
  clean: CleanResult
}

export interface PendingImport {
  importLabel: string
  endpoint: string
  file: File
  result: ImportPreviewResult
}

export interface ImportHistoryDetail {
  id: string
  import_type: string
  filename: string | null
  branch_name: string | null
  uploaded_by_name: string | null
  status: string
  summary: Record<string, unknown>
  created_at: string
  reverted_at: string | null
  origin: { rows: string[][]; row_issues: RowIssue[][] }
  clean: CleanResult
}
