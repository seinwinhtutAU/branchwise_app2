import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from 'react'
import { cn } from '@renderer/lib/utils'

// Layout wrapper — no skeleton/empty state (exempt per rubric); use TableSkeleton/EmptyState inside.
// `overflow-x-auto` here implicitly forces `overflow-y` to `auto` too (CSS rule: an
// axis left `visible` next to a non-visible one computes to `auto`), which makes THIS
// div — not the page — the nearest scrolling ancestor for any `position: sticky`
// descendant like Thead. Since this div has no bounded height by default, that
// scrolling never actually engages, so Thead's sticky silently no-ops past the first
// screenful. Callers that need a truly frozen header (e.g. ImportDataView) must pass a
// `style` with an explicit `maxHeight` so this container becomes a real scrollport —
// then Thead's `sticky top-0` sticks correctly within it, Excel-frozen-pane style.
export function TableContainer({
  children,
  className,
  style
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}): React.JSX.Element {
  return (
    <div style={style} className={cn('w-full overflow-x-auto rounded-lg border border-border', className)}>
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  )
}

// Sticky at the top of the page scroll (offset below the mobile top bar, flush on desktop)
// by default. When TableContainer is given a bounded `maxHeight` (a real scrollport),
// pass className="top-0" here instead — see the TableContainer comment above.
export function Thead({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <thead className={cn('sticky top-14 lg:top-0 z-20 bg-info-subtle', className)}>{children}</thead>
}

export function Tbody({ children }: { children: ReactNode }): React.JSX.Element {
  return <tbody>{children}</tbody>
}

export const Tr = forwardRef<HTMLTableRowElement, HTMLAttributes<HTMLTableRowElement>>(
  ({ children, className, ...props }, ref) => (
    <tr ref={ref} className={cn('transition-colors duration-150 hover:bg-bg-subtle', className)} {...props}>
      {children}
    </tr>
  )
)
Tr.displayName = 'Tr'

// Light gridlines between every cell (header and body) for a spreadsheet-like look.
export function Th({
  children,
  className,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <th
      className={cn(
        'text-left font-medium text-text-muted text-xs uppercase tracking-wide px-4 py-3 whitespace-nowrap',
        'border-b border-r border-border',
        className
      )}
      {...props}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  className,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement>): React.JSX.Element {
  return (
    <td
      className={cn('px-4 py-3 text-text-primary align-middle border-b border-r border-border', className)}
      {...props}
    >
      {children}
    </td>
  )
}
