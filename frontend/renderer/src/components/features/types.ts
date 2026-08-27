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
  // When set, confirming this import first removes the batch it's replacing — see
  // ImportReviewPage's handleConfirm and lib/useImportFilePicker.
  revertBatchId?: string
  replacingFilename?: string | null
}

export interface ColorQty {
  color: string
  qty: number
}

export type OrderStatus = 'not_start' | 'waiting' | 'complete'

export interface CustomerOrderLine {
  id: string
  order_id: string
  product_code: string
  description: string | null
  factory_name: string | null
  first_commit_qty: number | null
  second_commit_qty: number | null
  colors: ColorQty[]
  total_qty: number
  received_qty: number
  unit: string
  buying_price: number | null
  status: OrderStatus
  matched_voucher_id: string | null
  matched_voucher_no: number | null
}

export interface CustomerOrder {
  id: string
  order_no: number
  branch_id: string | null
  branch_name: string | null
  order_date: string
  customer_name: string
  remark: string | null
  created_at: string
  lines: CustomerOrderLine[]
}

export interface FactoryVoucherLine {
  id: string
  voucher_id: string
  product_code: string
  qty: number
  buying_price: number
  colors: ColorQty[]
  discount_per_set: number | null
}

export interface FactoryVoucher {
  id: string
  voucher_no: number
  branch_id: string | null
  branch_name: string | null
  voucher_date: string
  factory_name: string | null
  remark: string | null
  created_at: string
  lines: FactoryVoucherLine[]
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
