import type { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-12 h-12 rounded-xl bg-bg-raised flex items-center justify-center text-text-muted mb-4">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-text-primary mb-1">
        {title}
      </h3>
      {description && (
        <p className="text-sm text-text-muted max-w-xs mb-6">{description}</p>
      )}
      {action}
    </div>
  );
}
