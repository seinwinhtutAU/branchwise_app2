import { useEffect, useState } from "react";

const PAGE_SIZE = 50;

export function usePagination<T>(
  items: T[] | null,
  pageSize = PAGE_SIZE,
): {
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  pageItems: T[] | null;
  pageSize: number;
} {
  const [page, setPage] = useState(1);

  // Jump back to page 1 whenever the filtered/loaded set changes underneath us —
  // otherwise a filter change can strand the user on a now-empty page.
  useEffect(() => {
    setPage(1);
  }, [items]);

  const totalPages = items
    ? Math.max(1, Math.ceil(items.length / pageSize))
    : 1;
  const clampedPage = Math.min(page, totalPages);
  const start = (clampedPage - 1) * pageSize;
  const pageItems = items ? items.slice(start, start + pageSize) : null;

  return { page: clampedPage, setPage, totalPages, pageItems, pageSize };
}
