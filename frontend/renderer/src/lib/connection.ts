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
 *   online    the last request finished normally and quickly
 *   slow      the last request worked but took longer than SLOW_MS — worth telling the
 *             reader why a page is taking its time, not worth an error
 *   offline   a request failed at the network level or timed out: nothing is getting
 *             through right now
 *
 * An HTTP error (404, 500) is emphatically *not* offline — the connection carried it
 * fine. Only transport failures move this.
 */
export type ConnectionStatus = "online" | "slow" | "offline";

/**
 * Longer than this and a request is treated as a sign of a slow link.
 *
 * Generous on purpose: the dashboard's branch-health request legitimately takes several
 * seconds against Neon on a perfectly good connection, and a yellow banner during normal
 * use is noise that teaches people to ignore the banner when it matters.
 */
const SLOW_MS = 12_000;
// And one slow request is not a slow connection — a single heavy query shouldn't say so.
// Two in a row, with no quick answer in between, is a pattern worth naming.
const SLOW_STREAK_TO_WARN = 2;

let status: ConnectionStatus = "online";
let slowStreak = 0;
const listeners = new Set<() => void>();

function set(next: ConnectionStatus): void {
  if (next === status) return;
  // eslint-disable-next-line no-console -- deliberate diagnostic trail; see network.ts's
  // per-attempt logging for the failure this transition followed from.
  console.log(`[connection] ${status} -> ${next} at ${new Date().toISOString()}`);
  status = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getConnectionStatus(): ConnectionStatus {
  return status;
}

/** A request came back. `durationMs` decides between "fine" and "slow". */
export function reportRequestSuccess(durationMs: number): void {
  if (durationMs > SLOW_MS) {
    slowStreak += 1;
    if (slowStreak >= SLOW_STREAK_TO_WARN) set("slow");
    return;
  }
  // One quick answer is enough to call the connection fine again — whatever was slow
  // before, it isn't now.
  slowStreak = 0;
  set("online");
}

/** A request failed at the transport level, or timed out, after every retry. */
export function reportRequestFailure(): void {
  slowStreak = 0;
  set("offline");
}

/** React's view of the same value. */
export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(subscribe, getConnectionStatus);
}

/**
 * Runs `callback` the next time the connection looks usable again — what the import
 * screen waits on before retrying a file that couldn't be sent. Returns an unsubscribe.
 */
export function onConnectionRestored(callback: () => void): () => void {
  const unsubscribe = subscribe(() => {
    if (status !== "offline") {
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
