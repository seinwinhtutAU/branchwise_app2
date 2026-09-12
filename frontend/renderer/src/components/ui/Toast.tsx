import { cn } from "@renderer/lib/utils";

export type ToastVariant = "success" | "error" | "info";

export interface ToastData {
  id: string;
  variant: ToastVariant;
  message: string;
}

interface ToastProps extends ToastData {
  onDismiss: (id: string) => void;
}

const variantStyles: Record<ToastVariant, string> = {
  success: "bg-success-subtle text-success",
  error: "bg-error-subtle text-error",
  info: "bg-info-subtle text-info",
};

const variantIcons: Record<ToastVariant, React.JSX.Element> = {
  success: (
    <path
      d="M5 13l4 4L19 7"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  error: (
    <path
      d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L14.71 3.86a2 2 0 00-3.42 0z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  info: (
    <path
      d="M12 16v-4m0-4h.01M12 22a10 10 0 100-20 10 10 0 000 20z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
};

// Pure primitive — no skeleton/empty state (exempt per rubric).
export function Toast({
  id,
  variant,
  message,
  onDismiss,
}: ToastProps): React.JSX.Element {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-3 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-bg-base shadow-lg p-3 pl-3",
        "animate-slide-up motion-reduce:animate-none",
      )}
    >
      <span
        className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
          variantStyles[variant],
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="w-3.5 h-3.5"
          aria-hidden="true"
        >
          {variantIcons[variant]}
        </svg>
      </span>
      <p className="text-sm text-text-primary flex-1 pt-0.5">{message}</p>
      <button
        onClick={() => onDismiss(id)}
        aria-label="Dismiss"
        className="text-text-muted hover:text-text-secondary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded shrink-0 mt-0.5"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="w-4 h-4"
          aria-hidden="true"
        >
          <path
            d="M6 6l12 12M18 6L6 18"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
