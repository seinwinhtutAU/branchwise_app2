import { cn } from '@renderer/lib/utils'

interface ProgressBarProps {
  /** 0–100. Values outside that range are clamped. */
  value: number
  label?: string
  className?: string
}

// Pure primitive — no skeleton/empty state of its own (a bar at 0% already reads as
// "nothing done yet", which is the empty state).
export function ProgressBar({ value, label, className }: ProgressBarProps): React.JSX.Element {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && <span className="text-sm text-text-secondary">{label}</span>}
      <div
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-1.5 w-full rounded-full bg-bg-raised overflow-hidden"
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300 motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
