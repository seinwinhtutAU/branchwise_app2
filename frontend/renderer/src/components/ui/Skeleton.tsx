import { cn } from "@renderer/lib/utils";

interface SkeletonProps {
  className?: string;
}

// Pure primitive — no skeleton/empty state of its own (it IS the skeleton primitive).
export function Skeleton({ className }: SkeletonProps): React.JSX.Element {
  return (
    <div
      className={cn(
        "bg-bg-raised rounded-md animate-pulse motion-reduce:animate-none",
        className,
      )}
    />
  );
}

export function TableSkeleton({
  rows = 4,
  cols = 5,
}: {
  rows?: number;
  cols?: number;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
