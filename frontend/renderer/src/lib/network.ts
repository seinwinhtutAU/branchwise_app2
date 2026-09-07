import { apiBaseUrl } from '@renderer/lib/auth'
import {
  getConnectionStatus,
  reportRequestFailure,
  reportRequestSuccess,
  watchBrowserOfflineEvent
} from '@renderer/lib/connection'

/**
 * Makes every call to this app's API survive a weak connection: a request that hangs is
 * cut off rather than left spinning forever, a read that failed on the way out is tried
 * again, and either way the connection banner learns what happened.
 *
 * Why patch `fetch` instead of fixing call sites: there are around fifty of them across
 * the pages, and they all want the same three things. This is the same trick
 * `installAuthRetry` already uses for expired tokens, and it is scoped just as tightly —
 * only URLs under `apiBaseUrl`, and only behaviour the caller would have wanted anyway.
 *
 * Install it *after* installAuthRetry, so the order of the wrappers is
 * network → auth → real fetch: a retried request goes back through the auth layer and
 * still gets a refreshed token if it needs one.
 */

// A dashboard query against Neon can legitimately take several seconds on a good link
// and much longer on a bad one, so this is a "something is wrong" limit, not a
// performance target. Uploads get their own, far longer, budget below.
const READ_TIMEOUT_MS = 45_000
// Import files are a few hundred KB and are parsed and written server-side before the
// response comes back; on a slow link that is minutes, and cutting it off would waste
// work that may already be half-done.
const WRITE_TIMEOUT_MS = 5 * 60_000

// Two extra attempts, backing off, is enough to ride out the few-second dropouts that a
// mobile-tethered branch connection produces; beyond that the honest answer is "you're
// offline" rather than a longer wait.
const RETRY_DELAYS_MS = [500, 2000]

// How often to check whether the connection is back while we believe it is down. Cheap
// (one SELECT 1) and unauthenticated, so this keeps working even if the token expired
// while offline.
const PROBE_INTERVAL_MS = 5000

/**
 * Thrown when a request was cut off for taking too long, as opposed to failing to leave
 * the machine at all. The difference matters for anything that writes: a request that
 * timed out may well have been applied on the server, so it must never be sent again on
 * the app's own initiative — only by a person who has checked.
 */
export class RequestTimeoutError extends Error {
  constructor(url: string) {
    super(`The server did not answer in time: ${url}`)
    this.name = 'RequestTimeoutError'
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * One signal that fires when the caller's own signal fires *or* the timeout runs out,
 * plus a `done()` to stop the timer once the request settles.
 *
 * `AbortSignal.any` would do this in one line, and Electron's Chromium has it, but the
 * fallback keeps this file honest under the jsdom used in tests.
 */
function withTimeout(
  external: AbortSignal | null | undefined,
  timeoutMs: number
): { signal: AbortSignal; timedOut: () => boolean; done: () => void } {
  const controller = new AbortController()
  let expired = false

  const timer = setTimeout(() => {
    expired = true
    controller.abort()
  }, timeoutMs)

  const onExternalAbort = (): void => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onExternalAbort)
  }

  return {
    signal: controller.signal,
    timedOut: () => expired,
    done: () => {
      clearTimeout(timer)
      external?.removeEventListener('abort', onExternalAbort)
    }
  }
}

function methodOf(input: RequestInfo | URL, init: RequestInit | undefined): string {
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET')
  return method.toUpperCase()
}

export function installNetworkResilience(): () => void {
  const original = window.fetch
  const stopOfflineWatch = watchBrowserOfflineEvent()
  let probeTimer: ReturnType<typeof setInterval> | null = null
  // A probe waits up to the engine's 10s connect timeout, which is longer than the tick
  // below — without this the ticks would pile up on a dead link.
  let probeInFlight = false

  // While we think we're offline, keep asking the backend whether the database is
  // reachable again. Without this the app would only find out on the reader's next
  // click, and the "you're offline" banner would outlive the outage.
  function startProbing(): void {
    if (probeTimer) return
    probeTimer = setInterval(() => {
      if (getConnectionStatus() !== 'offline') {
        stopProbing()
        return
      }
      if (probeInFlight) return
      probeInFlight = true
      const startedAt = Date.now()
      original(`${apiBaseUrl}/api/health/db`)
        .then(async (response) => {
          const body = (await response.json().catch(() => null)) as { database?: string } | null
          // A backend that answers but can't reach Neon is still offline as far as
          // every page in this app is concerned.
          if (response.ok && body?.database === 'ok') {
            reportRequestSuccess(Date.now() - startedAt)
            stopProbing()
          }
        })
        .catch(() => {
          // Still down. The next tick tries again; no toast, the banner already says so.
        })
        .finally(() => {
          probeInFlight = false
        })
    }, PROBE_INTERVAL_MS)
  }

  function stopProbing(): void {
    if (!probeTimer) return
    clearInterval(probeTimer)
    probeTimer = null
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!url.startsWith(apiBaseUrl)) return original(input, init)

    const method = methodOf(input, init)
    // Only reads are retried. A confirm, a revert, or a wholesale order is not safe to
    // send twice — a request that may already have been applied server-side has to come
    // back to the user, who can decide to press the button again.
    const canRetry = method === 'GET' || method === 'HEAD'
    const timeoutMs = canRetry ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : null)

    const attempts = canRetry ? RETRY_DELAYS_MS.length + 1 : 1
    let lastError: unknown = null

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const startedAt = Date.now()
      const timeout = withTimeout(callerSignal, timeoutMs)
      try {
        const response = await original(input, { ...init, signal: timeout.signal })
        // An HTTP error still travelled the wire, so the connection is fine — whether
        // the *answer* was good is the caller's business, not this layer's.
        reportRequestSuccess(Date.now() - startedAt)
        return response
      } catch (error) {
        // The caller gave up (navigated away, typed a new filter). Not a failure, and
        // certainly not something to retry.
        if (callerSignal?.aborted) throw error
        lastError = timeout.timedOut() ? new RequestTimeoutError(url) : error
        const isLastAttempt = attempt === attempts - 1
        if (isLastAttempt) break
        await delay(RETRY_DELAYS_MS[attempt])
      } finally {
        timeout.done()
      }
    }

    reportRequestFailure()
    startProbing()
    throw lastError
  }

  return () => {
    window.fetch = original
    stopOfflineWatch()
    stopProbing()
  }
}
