import { useEffect, useRef } from "react";

/**
 * Hands each fetch its own AbortSignal, cancelling whichever request was still in
 * flight — so a slow earlier response can never land after (and overwrite) a newer
 * one — and cancels any outstanding request when the component unmounts.
 *
 * Usage: `const nextRequest = useLatestRequest()`, then at the top of each load
 * `const signal = nextRequest()`, pass it to fetch, and bail out of the catch when
 * `signal.aborted` — an aborted request is not a failure worth a toast.
 */
export function useLatestRequest(): () => AbortSignal {
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  return () => {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current.signal;
  };
}
