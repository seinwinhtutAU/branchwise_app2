import { useSyncExternalStore } from "react";

/**
 * How well this machine is reaching the data, as observed from the app's own requests.
 *
 * Why not `navigator.onLine`: the backend runs on this same machine (127.0.0.1), so it
 * is always reachable — what's actually weak on a branch computer is the hop from that
 * backend to Neon. `navigator.onLine` also only reports whether a network interface is
 * up, which stays true on the kind of slow-but-connected link this is about. The honest
 * signal is how the app's own requests are going, so that's what this tracks.
 *
 *   online    the last request finished quickly
 *   slow      the last request worked but took longer than SLOW_MS
 *   poor      a request needed a retry or took longer than POOR_MS
 *   offline   a request failed at the network level or timed out: nothing is getting
 *             through right now
 *
 * An HTTP error (404, 500) is emphatically *not* offline — the connection carried it
 * fine. Only transport failures move this.
 */
export type ConnectionStatus = "online" | "slow" | "poor" | "offline";

export interface ConnectionSnapshot {
  status: ConnectionStatus;
  /** Most recent successful round-trip through the local API to cloud data. */
  latencyMs: number | null;
  updatedAt: number | null;
}

/**
 * These are intentionally user-facing rather than server-performance targets. The
 * indicator says what the branch user just experienced, much like a game's ping meter.
 */
const SLOW_MS = 1_000;
const POOR_MS = 3_000;

let snapshot: ConnectionSnapshot = {
  status: "online",
  latencyMs: null,
  updatedAt: null,
};
const listeners = new Set<() => void>();

function set(next: ConnectionStatus, latencyMs = snapshot.latencyMs): void {
  const previous = snapshot.status;
  snapshot = { status: next, latencyMs, updatedAt: Date.now() };
  if (next === previous) {
    listeners.forEach((listener) => listener());
    return;
  }
  // eslint-disable-next-line no-console -- deliberate diagnostic trail; see network.ts's
  // per-attempt logging for the failure this transition followed from.
  console.log(`[connection] ${previous} -> ${next} at ${new Date().toISOString()}`);
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConnectionStatus(): ConnectionStatus {
  return snapshot.status;
}

export function getConnectionSnapshot(): ConnectionSnapshot {
  return snapshot;
}

/** A request came back. `durationMs` decides between "fine" and "slow". */
export function reportRequestSuccess(durationMs: number): void {
  if (durationMs >= POOR_MS) return set("poor", durationMs);
  if (durationMs >= SLOW_MS) return set("slow", durationMs);
  set("online", durationMs);
}

/** A retry is visible to users as a poor connection, even if it recovers shortly after. */
export function reportRequestRetry(): void {
  if (snapshot.status !== "offline") set("poor");
}

/** A request failed at the transport level, or timed out, after every retry. */
export function reportRequestFailure(): void {
  set("offline");
}

/** React's view of the same value. */
export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(subscribe, getConnectionStatus);
}

/** React's view of the status plus the last observed end-to-end latency. */
export function useConnectionSnapshot(): ConnectionSnapshot {
  return useSyncExternalStore(subscribe, getConnectionSnapshot);
}

/**
 * Runs `callback` the next time the connection looks usable again — what the import
 * screen waits on before retrying a file that couldn't be sent. Returns an unsubscribe.
 */
export function onConnectionRestored(callback: () => void): () => void {
  const unsubscribe = subscribe(() => {
    if (snapshot.status !== "offline") {
      unsubscribe();
      callback();
    }
  });
  return unsubscribe;
}

/** The browser saying the adapter went down is worth believing immediately. */
export function watchBrowserOfflineEvent(): () => void {
  const onOffline = (): void => set("offline");
  window.addEventListener("offline", onOffline);
  return () => window.removeEventListener("offline", onOffline);
}
