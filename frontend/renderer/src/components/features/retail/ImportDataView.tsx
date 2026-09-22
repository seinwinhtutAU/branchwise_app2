import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import { Button } from "@renderer/components/ui/Button";
import { TabBar } from "@renderer/components/ui/Tabs";
import { Pagination } from "@renderer/components/ui/Pagination";
import { Spinner } from "@renderer/components/ui/Spinner";
import { ChevronUpIcon, ChevronDownIcon } from "@renderer/components/ui/icons";
import { cn } from "@renderer/lib/utils";
import { useStickyAbove } from "@renderer/lib/useStickyAbove";
import { usePagination } from "@renderer/lib/usePagination";
import type { CleanResult, OriginResult, RowIssue } from "../types";

interface Props {
  clean: CleanResult;
  origin: OriginResult;
  // Rendered between the validation banner and the table — e.g. branch picker + Confirm/Cancel on the review page.
  controls?: ReactNode;
  isServerPaginated?: boolean;
  onPageChange?: (page: number, tab: "clean" | "original") => void;
  loadingPage?: boolean;
  warningIndices?: Partial<Record<"clean" | "original", number[]>>;
  onWarningIndicesNeeded?: (tab: "clean" | "original") => void;
}

const ROW_NUM_CLASS =
  "sticky left-0 z-10 w-12 text-center text-text-muted tabular-nums";
const NOTE_MIN_WIDTH = "min-w-[22rem]";

function NoteCell({ issues }: { issues: RowIssue[] }): React.JSX.Element {
  return (
    <Td className={cn(NOTE_MIN_WIDTH, "align-top text-warning text-xs")}>
      {issues.length > 0 && (
        <ul className="flex flex-col gap-1">
          {issues.map((issue, idx) => (
            <li key={idx} className="flex items-start gap-1.5">
              <span className="mt-1 w-1 h-1 rounded-full bg-warning shrink-0" />
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
    </Td>
  );
}

export function ImportDataView({
  clean,
  origin,
  controls,
  isServerPaginated = false,
  onPageChange,
  loadingPage = false,
  warningIndices,
  onWarningIndicesNeeded,
}: Props): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<"clean" | "original">("clean");

  const clientCleanIssues = clean.row_issues;
  const clientOriginIssues = origin.row_issues;

  const warningRowIndices = useMemo(() => {
    if (isServerPaginated) {
      return warningIndices?.[activeTab] ?? [];
    }
    const issues =
      activeTab === "clean" ? clientCleanIssues : clientOriginIssues;
    return issues.reduce<number[]>(
      (acc, iss, i) => (iss.length > 0 ? [...acc, i] : acc),
      [],
    );
  }, [
    isServerPaginated,
    activeTab,
    warningIndices,
    clientCleanIssues,
    clientOriginIssues,
  ]);

  const activePreview = activeTab === "clean" ? clean : origin;
  const invalidRowCount = isServerPaginated
    ? (activePreview.warning_count ?? 0)
    : activePreview.row_issues.filter((issues) => issues.length > 0).length;

  const [warningPos, setWarningPos] = useState(0);
  const [highlightedRow, setHighlightedRow] = useState<number | null>(null);
  const [pendingScrollRow, setPendingScrollRow] = useState<number | null>(null);
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>());
  const rowRefCallbacks = useRef(
    new Map<number, (el: HTMLTableRowElement | null) => void>(),
  );

  function rowRefCallback(
    index: number,
  ): (el: HTMLTableRowElement | null) => void {
    let callback = rowRefCallbacks.current.get(index);
    if (!callback) {
      callback = (el) => {
        if (el) rowRefs.current.set(index, el);
        else rowRefs.current.delete(index);
      };
      rowRefCallbacks.current.set(index, callback);
    }
    return callback;
  }

  useEffect(() => {
    setWarningPos(0);
  }, [activeTab, warningRowIndices]);

  useEffect(() => {
    if (
      isServerPaginated &&
      invalidRowCount > 0 &&
      warningIndices?.[activeTab] === undefined
    ) {
      onWarningIndicesNeeded?.(activeTab);
    }
  }, [
    activeTab,
    invalidRowCount,
    isServerPaginated,
    onWarningIndicesNeeded,
    warningIndices,
  ]);

  const { aboveRef, containerStyle } = useStickyAbove();

  // Client-side pagination hooks (used when isServerPaginated is false)
  const cleanPagination = usePagination(clean.rows);
  const originPagination = usePagination(origin.rows);

  const activePage = isServerPaginated
    ? activeTab === "clean"
      ? (clean.page ?? 1)
      : (origin.page ?? 1)
    : activeTab === "clean"
      ? cleanPagination.page
      : originPagination.page;

  const activePageSize = isServerPaginated
    ? activeTab === "clean"
      ? (clean.page_size ?? 50)
      : (origin.page_size ?? 50)
    : activeTab === "clean"
      ? cleanPagination.pageSize
      : originPagination.pageSize;

  const activeTotalItems = isServerPaginated
    ? activeTab === "clean"
      ? (clean.total_rows ?? clean.rows.length)
      : (origin.total_rows ?? origin.rows.length)
    : activeTab === "clean"
      ? clean.rows.length
      : origin.rows.length;

  const activeTotalPages = isServerPaginated
    ? activeTab === "clean"
      ? (clean.total_pages ??
        Math.max(1, Math.ceil(activeTotalItems / activePageSize)))
      : (origin.total_pages ??
        Math.max(1, Math.ceil(activeTotalItems / activePageSize)))
    : activeTab === "clean"
      ? cleanPagination.totalPages
      : originPagination.totalPages;

  const pageStart = (activePage - 1) * activePageSize;

  function handleSetPage(newPage: number): void {
    if (isServerPaginated) {
      onPageChange?.(newPage, activeTab);
    } else {
      if (activeTab === "clean") {
        cleanPagination.setPage(newPage);
      } else {
        originPagination.setPage(newPage);
      }
    }
  }

  function handleTabSelect(tab: "clean" | "original"): void {
    setActiveTab(tab);
    if (isServerPaginated) {
      onPageChange?.(1, tab);
    }
  }

  function highlightRow(rowIndex: number): void {
    setHighlightedRow(rowIndex);
    window.setTimeout(
      () =>
        setHighlightedRow((current) => (current === rowIndex ? null : current)),
      1500,
    );
  }

  function scrollToRow(rowIndex: number): void {
    const targetPage = Math.floor(rowIndex / activePageSize) + 1;
    if (targetPage !== activePage) {
      setPendingScrollRow(rowIndex);
      handleSetPage(targetPage);
      return;
    }
    const el = rowRefs.current.get(rowIndex);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    highlightRow(rowIndex);
  }

  useEffect(() => {
    if (pendingScrollRow === null) return;
    const el = rowRefs.current.get(pendingScrollRow);
    if (el) {
      el.scrollIntoView({ block: "center" });
      highlightRow(pendingScrollRow);
      setPendingScrollRow(null);
    }
  }, [activePage, clean.rows, origin.rows, pendingScrollRow]);

  function goToWarning(direction: 1 | -1): void {
    if (warningRowIndices.length === 0) return;
    const next =
      (warningPos + direction + warningRowIndices.length) %
      warningRowIndices.length;
    setWarningPos(next);
    scrollToRow(warningRowIndices[next]);
  }

  const activeCleanRows = isServerPaginated
    ? clean.rows
    : (cleanPagination.pageItems ?? []);
  const activeOriginRows = isServerPaginated
    ? origin.rows
    : (originPagination.pageItems ?? []);

  return (
    <div className="flex flex-col gap-4" style={containerStyle}>
      <div
        ref={aboveRef}
        className="sticky top-14 lg:top-0 z-30 bg-bg-base flex flex-col gap-4"
      >
        <TabBar<"clean" | "original">
          tabs={[
            { id: "clean", label: "Cleaned data" },
            { id: "original", label: "Original data" },
          ]}
          activeTab={activeTab}
          onSelect={handleTabSelect}
        />

        {invalidRowCount > 0 && (
          <div className="rounded-md bg-warning-subtle text-warning text-sm px-3 py-2 flex items-start gap-2">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="w-4 h-4 shrink-0 mt-0.5"
              aria-hidden="true"
            >
              <path
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L14.71 3.86a2 2 0 00-3.42 0z"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>
              {invalidRowCount === 1
                ? "One row below has a number that doesn't look right"
                : `${invalidRowCount} rows below have numbers that don't look right`}{" "}
              — see the note on each yellow row.
            </span>
          </div>
        )}

        {warningRowIndices.length > 0 && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <span className="font-medium">
              Warning {warningPos + 1} of {warningRowIndices.length}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => goToWarning(-1)}
              aria-label="Jump to previous warning"
            >
              <ChevronUpIcon className="w-4 h-4" />
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => goToWarning(1)}
              aria-label="Jump to next warning"
            >
              <ChevronDownIcon className="w-4 h-4" />
            </Button>
          </div>
        )}

        {clean.is_sampled && (
          <div className="px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/25 flex items-center justify-between gap-2 text-xs text-sky-600 dark:text-sky-400">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-xs">
                ⚡ Fast Preview Mode:
              </span>
              <span>
                Showing preview of{" "}
                {(clean.total_rows ?? clean.rows.length).toLocaleString()} rows
                (first {clean.sample_count || 500} items + all warning items) of{" "}
                {(
                  clean.source_total_rows ??
                  clean.total_rows ??
                  clean.rows.length
                ).toLocaleString()}{" "}
                total records.
              </span>
            </div>
          </div>
        )}

        {controls}
      </div>

      {activeTab === "clean" ? (
        <>
          <TableContainer
            className="overflow-y-auto relative"
            style={{
              maxHeight: "calc(100vh - var(--sticky-offset, 0px) - 10rem)",
            }}
          >
            {loadingPage && (
              <div className="absolute inset-0 bg-bg-base/60 backdrop-blur-[1px] flex items-center justify-center z-20">
                <Spinner className="w-5 h-5 text-brand" />
              </div>
            )}
            <Thead className="top-0">
              <Tr>
                <Th className={cn(ROW_NUM_CLASS, "bg-info-subtle")}>#</Th>
                {clean.columns.map((col) => (
                  <Th key={col}>{col}</Th>
                ))}
                {invalidRowCount > 0 && (
                  <Th className={NOTE_MIN_WIDTH}>Note</Th>
                )}
              </Tr>
            </Thead>
            <Tbody
              className={cn(loadingPage && "opacity-50 transition-opacity")}
            >
              {activeCleanRows.map((row, localIndex) => {
                const globalIndex = pageStart + localIndex;
                const issues = isServerPaginated
                  ? (clean.row_issues[localIndex] ?? [])
                  : (clean.row_issues[globalIndex] ?? []);
                const hasIssue = issues.length > 0;
                return (
                  <Tr
                    key={globalIndex}
                    ref={rowRefCallback(globalIndex)}
                    className={cn(
                      hasIssue && "bg-warning-subtle hover:bg-warning-subtle",
                      highlightedRow === globalIndex &&
                        "ring-2 ring-inset ring-warning",
                    )}
                  >
                    <Td
                      className={cn(
                        ROW_NUM_CLASS,
                        hasIssue ? "bg-warning-subtle" : "bg-bg-base",
                      )}
                    >
                      {globalIndex + 1}
                    </Td>
                    {clean.columns.map((col) => (
                      <Td
                        key={col}
                        className={cn(
                          issues.some((issue) => issue.column === col) &&
                            "font-medium",
                        )}
                      >
                        {String(row[col] ?? "")}
                      </Td>
                    ))}
                    {invalidRowCount > 0 && <NoteCell issues={issues} />}
                  </Tr>
                );
              })}
            </Tbody>
          </TableContainer>
          <Pagination
            page={activePage}
            totalPages={activeTotalPages}
            totalItems={activeTotalItems}
            pageSize={activePageSize}
            onPageChange={handleSetPage}
          />
        </>
      ) : (
        <>
          <TableContainer
            className="overflow-y-auto relative"
            style={{
              maxHeight: "calc(100vh - var(--sticky-offset, 0px) - 10rem)",
            }}
          >
            {loadingPage && (
              <div className="absolute inset-0 bg-bg-base/60 backdrop-blur-[1px] flex items-center justify-center z-20">
                <Spinner className="w-5 h-5 text-brand" />
              </div>
            )}
            <Tbody
              className={cn(loadingPage && "opacity-50 transition-opacity")}
            >
              {activeOriginRows.map((row, localIndex) => {
                const globalIndex = pageStart + localIndex;
                const issues = isServerPaginated
                  ? (origin.row_issues[localIndex] ?? [])
                  : (origin.row_issues[globalIndex] ?? []);
                const hasIssue = issues.length > 0;
                return (
                  <Tr
                    key={globalIndex}
                    ref={rowRefCallback(globalIndex)}
                    className={cn(
                      hasIssue && "bg-warning-subtle hover:bg-warning-subtle",
                      highlightedRow === globalIndex &&
                        "ring-2 ring-inset ring-warning",
                    )}
                  >
                    <Td
                      className={cn(
                        ROW_NUM_CLASS,
                        hasIssue ? "bg-warning-subtle" : "bg-bg-base",
                      )}
                    >
                      {globalIndex + 1}
                    </Td>
                    {row.map((cell, j) => (
                      <Td key={j} className="text-text-muted">
                        {cell}
                      </Td>
                    ))}
                    {invalidRowCount > 0 && <NoteCell issues={issues} />}
                  </Tr>
                );
              })}
            </Tbody>
          </TableContainer>
          <Pagination
            page={activePage}
            totalPages={activeTotalPages}
            totalItems={activeTotalItems}
            pageSize={activePageSize}
            onPageChange={handleSetPage}
          />
        </>
      )}
    </div>
  );
}

export default ImportDataView;
