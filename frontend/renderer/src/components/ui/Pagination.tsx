import { Button } from '@renderer/components/ui/Button'

interface PaginationProps {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
}

// Pure primitive — no skeleton/empty state (exempt per rubric).
export function Pagination({ page, totalPages, totalItems, pageSize, onPageChange }: PaginationProps): React.JSX.Element {
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalItems)

  return (
    <div className="flex items-center justify-between gap-4 pt-3 flex-wrap">
      <span className="text-sm text-text-muted">
        Showing {start}–{end} of {totalItems}
      </span>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          Previous
        </Button>
        <span className="text-sm text-text-secondary tabular-nums">
          Page {page} of {totalPages}
        </span>
        <Button variant="secondary" size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Next
        </Button>
      </div>
    </div>
  )
}
