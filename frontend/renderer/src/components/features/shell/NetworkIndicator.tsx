import {
  useConnectionSnapshot,
  type ConnectionStatus,
} from "@renderer/lib/connection";

interface NetworkPresentation {
  label: string;
  dotClassName: string;
  textClassName: string;
}

const presentation: Record<ConnectionStatus, NetworkPresentation> = {
  online: {
    label: "Good",
    dotClassName: "bg-success",
    textClassName: "text-success",
  },
  slow: {
    label: "Slow",
    dotClassName: "bg-warning",
    textClassName: "text-warning",
  },
  poor: {
    label: "Poor",
    dotClassName: "bg-warning",
    textClassName: "text-warning",
  },
  offline: {
    label: "Offline",
    dotClassName: "bg-error",
    textClassName: "text-error",
  },
};

/** A small status light that sits on the profile avatar without taking header space. */
export function NetworkStatusDot(): React.JSX.Element {
  const { status } = useConnectionSnapshot();
  const current = presentation[status];
  return (
    <span
      aria-hidden="true"
      title={`Network: ${current.label}`}
      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg-subtle ${current.dotClassName} ${status === "offline" ? "animate-pulse motion-reduce:animate-none" : ""}`}
    />
  );
}

/** The profile menu keeps the status compact, with only its latest latency. */
export function NetworkStatusDetails(): React.JSX.Element {
  const { status, latencyMs } = useConnectionSnapshot();
  const current = presentation[status];
  const latency = latencyMs === null ? null : `${Math.round(latencyMs)} ms`;
  return (
    <div role="status" className="flex items-center justify-between border-b border-border px-2.5 py-2.5 text-sm">
      <span className="font-medium text-text-primary">Network</span>
      <span className={`flex items-center gap-1.5 text-xs font-semibold ${current.textClassName}`}>
        <span className={`h-2 w-2 rounded-full ${current.dotClassName}`} />
        {current.label}
        {latency && <span className="font-normal text-text-muted">· {latency}</span>}
      </span>
    </div>
  );
}
