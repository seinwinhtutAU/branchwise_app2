import type { ReactNode } from 'react'
import { cn } from '@renderer/lib/utils'

interface CardProps {
  children: ReactNode
  className?: string
  interactive?: boolean
}

// Layout wrapper — no skeleton/empty state (exempt per rubric).
export function Card({ children, className, interactive }: CardProps): React.JSX.Element {
  return (
    <div
      className={cn(
        'bg-bg-base rounded-xl border border-border shadow-sm p-6',
        interactive && [
          'cursor-pointer transition-all duration-200',
          'hover:-translate-y-0.5 hover:shadow-md hover:border-border-strong',
          'active:translate-y-0 active:shadow-sm',
          'motion-reduce:hover:translate-y-0'
        ],
        className
      )}
    >
      {children}
    </div>
  )
}

export function CardHeader({
  title,
  description,
  action
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h3 className="text-base font-semibold text-text-primary tracking-tight">{title}</h3>
        {description && <p className="text-sm text-text-muted mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  )
}
