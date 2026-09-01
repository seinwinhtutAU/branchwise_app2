import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { Button } from '@renderer/components/ui/Button'
import { Pagination } from '@renderer/components/ui/Pagination'
import { ChevronUpIcon, ChevronDownIcon } from '@renderer/components/ui/icons'
import { cn } from '@renderer/lib/utils'
import { useStickyAbove } from '@renderer/lib/useStickyAbove'
import { usePagination } from '@renderer/lib/usePagination'
import type { CleanResult, RowIssue } from './types'

interface Props {
  clean: CleanResult
  origin: { rows: string[][]; row_issues: RowIssue[][] }
  // Rendered between the validation banner and the table — e.g. branch picker + Confirm/Cancel on the review page.
  controls?: ReactNode
}

const ROW_NUM_CLASS = 'sticky left-0 z-10 w-12 text-center text-text-muted tabular-nums'
const NOTE_MIN_WIDTH = 'min-w-[22rem]'

function NoteCell({ issues }: { issues: RowIssue[] }): React.JSX.Element {
  return (
    <Td className={cn(NOTE_MIN_WIDTH, 'align-top text-warning text-xs')}>
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
  )
}

export function ImportDataView({ clean, origin, controls }: Props): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<'clean' | 'original'>('clean')
  const invalidRowCount = clean.row_issues.filter((issues) => issues.length > 0).length

  const rowIssues = activeTab === 'clean' ? clean.row_issues : origin.row_issues
  const warningRowIndices = useMemo(
    () => rowIssues.reduce<number[]>((acc, issues, i) => (issues.length > 0 ? [...acc, i] : acc), []),
    [rowIssues]
  )

  const [warningPos, setWarningPos] = useState(0)
  const [highlightedRow, setHighlightedRow] = useState<number | null>(null)
  // Set by scrollToRow when the target row isn't on the current page — the page change
  // has to commit and re-render before the row's ref exists to scroll to.
  const [pendingScrollRow, setPendingScrollRow] = useState<number | null>(null)
  const rowRefs = useRef(new Map<number, HTMLTableRowElement>())
  // Stable per-row-index ref callbacks so switching tabs/pages doesn't hand React a brand
  // new callback for every visible row on every render (which would detach/reattach every
  // row ref each time, even for rows whose content hasn't changed).
  const rowRefCallbacks = useRef(new Map<number, (el: HTMLTableRowElement | null) => void>())

  function rowRefCallback(index: number): (el: HTMLTableRowElement | null) => void {
    let callback = rowRefCallbacks.current.get(index)
    if (!callback) {
      callback = (el) => {
        if (el) rowRefs.current.set(index, el)
        else rowRefs.current.delete(index)
      }
      rowRefCallbacks.current.set(index, callback)
    }
    return callback
  }

  useEffect(() => {
    setWarningPos(0)
  }, [activeTab, warningRowIndices])

  const { aboveRef, containerStyle } = useStickyAbove()

  // Each tab's row set is paginated independently — this bounds the number of table rows
  // in the DOM at once (files can run to ~1000 rows) the same way the rest of the app's
  // large tables already do (SimpleDataTable, DataOverviewTable), rather than rendering
  // every row unconditionally. Two separate hook calls (rather than one keyed off
  // activeRows) so TypeScript keeps clean.rows' and origin.rows' distinct element types.
  const cleanPagination = usePagination(clean.rows)
  const originPagination = usePagination(origin.rows)
  const { page, setPage, totalPages, pageSize } =
    activeTab === 'clean' ? cleanPagination : originPagination
  const pageStart = (page - 1) * pageSize

  function highlightRow(rowIndex: number): void {
    setHighlightedRow(rowIndex)
    window.setTimeout(() => setHighlightedRow((current) => (current === rowIndex ? null : current)), 1500)
  }

  function scrollToRow(rowIndex: number): void {
    const targetPage = Math.floor(rowIndex / pageSize) + 1
    if (targetPage !== page) {
      setPendingScrollRow(rowIndex)
      setPage(targetPage)
      return
    }
    const el = rowRefs.current.get(rowIndex)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    highlightRow(rowIndex)
  }

  useEffect(() => {
    if (pendingScrollRow === null) return
    const el = rowRefs.current.get(pendingScrollRow)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      highlightRow(pendingScrollRow)
    }
    setPendingScrollRow(null)
  }, [page, pendingScrollRow])

  function goToWarning(direction: 1 | -1): void {
    if (warningRowIndices.length === 0) return
    const next = (warningPos + direction + warningRowIndices.length) % warningRowIndices.length
    setWarningPos(next)
    scrollToRow(warningRowIndices[next])
  }

  return (
    <div className="flex flex-col gap-4" style={containerStyle}>
      <div ref={aboveRef} className="sticky top-14 lg:top-0 z-30 bg-bg-subtle flex flex-col gap-4">
        <div role="tablist" className="flex gap-1 p-1 rounded-lg bg-bg-raised w-fit">
          {(['clean', 'original'] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`h-7 px-3 rounded-md text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
                activeTab === tab
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              {tab === 'clean' ? 'Cleaned data' : 'Original data'}
            </button>
          ))}
        </div>

        {invalidRowCount > 0 && (
          <div className="rounded-md bg-warning-subtle text-warning text-sm px-3 py-2 flex items-start gap-2">
            <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true">
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
                : `${invalidRowCount} rows below have numbers that don't look right`}{' '}
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
            <Button variant="secondary" size="sm" onClick={() => goToWarning(1)} aria-label="Jump to next warning">
              <ChevronDownIcon className="w-4 h-4" />
            </Button>
          </div>
        )}

        {controls}
      </div>

      {activeTab === 'clean' ? (
        <>
          <TableContainer
            className="overflow-y-auto"
            style={{ maxHeight: 'calc(100vh - var(--sticky-offset, 0px) - 10rem)' }}
          >
            <Thead className="top-0">
              <Tr>
                <Th className={cn(ROW_NUM_CLASS, 'bg-info-subtle')}>#</Th>
                {clean.columns.map((col) => (
                  <Th key={col}>{col}</Th>
                ))}
                {invalidRowCount > 0 && <Th className={NOTE_MIN_WIDTH}>Note</Th>}
              </Tr>
            </Thead>
            <Tbody>
              {(cleanPagination.pageItems ?? []).map((row, localIndex) => {
                const i = pageStart + localIndex
                const issues = clean.row_issues[i] ?? []
                const hasIssue = issues.length > 0
                return (
                  <Tr
                    key={i}
                    ref={rowRefCallback(i)}
                    className={cn(
                      hasIssue && 'bg-warning-subtle hover:bg-warning-subtle',
                      highlightedRow === i && 'ring-2 ring-inset ring-warning'
                    )}
                  >
                    <Td className={cn(ROW_NUM_CLASS, hasIssue ? 'bg-warning-subtle' : 'bg-bg-base')}>
                      {i + 1}
                    </Td>
                    {clean.columns.map((col) => (
                      <Td
                        key={col}
                        className={cn(issues.some((issue) => issue.column === col) && 'font-medium')}
                      >
                        {String(row[col] ?? '')}
                      </Td>
                    ))}
                    {invalidRowCount > 0 && <NoteCell issues={issues} />}
                  </Tr>
                )
              })}
            </Tbody>
          </TableContainer>
          <Pagination page={page} totalPages={totalPages} totalItems={clean.rows.length} pageSize={pageSize} onPageChange={setPage} />
        </>
      ) : (
        <>
          <TableContainer
            className="overflow-y-auto"
            style={{ maxHeight: 'calc(100vh - var(--sticky-offset, 0px) - 10rem)' }}
          >
            <Tbody>
              {(originPagination.pageItems ?? []).map((row, localIndex) => {
                const i = pageStart + localIndex
                const issues = origin.row_issues[i] ?? []
                const hasIssue = issues.length > 0
                return (
                  <Tr
                    key={i}
                    ref={rowRefCallback(i)}
                    className={cn(
                      hasIssue && 'bg-warning-subtle hover:bg-warning-subtle',
                      highlightedRow === i && 'ring-2 ring-inset ring-warning'
                    )}
                  >
                    <Td className={cn(ROW_NUM_CLASS, hasIssue ? 'bg-warning-subtle' : 'bg-bg-base')}>
                      {i + 1}
                    </Td>
                    {row.map((cell, j) => (
                      <Td key={j} className="text-text-muted">
                        {cell}
                      </Td>
                    ))}
                    {invalidRowCount > 0 && <NoteCell issues={issues} />}
                  </Tr>
                )
              })}
            </Tbody>
          </TableContainer>
          <Pagination page={page} totalPages={totalPages} totalItems={origin.rows.length} pageSize={pageSize} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}

export default ImportDataView
