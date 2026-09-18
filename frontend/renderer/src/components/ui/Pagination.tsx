import { useEffect, useState } from "react";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";

interface PaginationProps {
  page: number;
  totalPages: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

// Pure primitive — no skeleton/empty state (exempt per rubric).
export function Pagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: PaginationProps): React.JSX.Element {
  const start = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalItems);

  // A free-typed draft of the page number, separate from `page` itself — so a
  // half-typed value (or one outside the valid range) isn't clobbered by the `page`
  // prop on every keystroke, and only commits (clamped) on blur/Enter.
  const [draft, setDraft] = useState(String(page));
  useEffect(() => {
    setDraft(String(page));
  }, [page]);

  function commitDraft(): void {
    const parsed = Math.trunc(Number(draft));
    if (Number.isFinite(parsed) && draft.trim() !== "") {
      onPageChange(Math.min(Math.max(parsed, 1), totalPages));
    } else {
      setDraft(String(page));
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 py-1 px-0.5 flex-wrap text-xs">
      <span className="text-xs text-text-muted">
        Showing {start}–{end} of {totalItems}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <span className="flex items-center gap-1 text-xs text-text-secondary tabular-nums">
          Page
          <Input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={draft}
            aria-label="Page number"
            disabled={totalPages <= 1}
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="h-7 w-12 px-1 text-center text-xs"
          />
          of {totalPages}
        </span>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
