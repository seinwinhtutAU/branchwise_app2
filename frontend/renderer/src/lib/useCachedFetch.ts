import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Session } from '@renderer/lib/auth'
import { apiBaseUrl } from '@renderer/lib/auth'
import { useToast } from '@renderer/lib/useToast'
import { useLatestRequest } from '@renderer/lib/useLatestRequest'

/**
 * A small shared cache for read-only GET endpoints, so returning to a page shows what
 * it showed last time instead of a loading skeleton.
 *
 * The problem this solves: `App.tsx` renders each section as `{section === 'x' && ...}`
 * and `DashboardPage` does the same per tab, so navigating away *unmounts* the
 * component and destroys its state. Coming back was always a fresh mount — skeleton,
 * refetch, wait — even when nothing had changed. The dashboard's heaviest request takes
 * a couple of seconds against the remote database, and paying that on every tab switch
 * is what made the app feel slow.
 *
 * **When it refetches.** The cache key is the full URL, so any change the user makes to
 * period, date range or branch is a different key and fetches properly. Beyond that, a
 * cached entry is reused until one of three things happens:
 *
 *  1. `invalidateImportedData()` is called — which is the honest signal in this app,
 *     because confirming or reverting an import is the *only* thing that changes the
 *     sales, inventory, purchase and warning data these pages read.
 *  2. `useImportedDataWatch` notices someone *else* changed the data — it polls a cheap
 *     token from GET /api/imports/data-version, which is what closes the multi-account
 *     case that rule 1 can't see.
 *  3. The caller asks, via `reload()`.
 *
 * **Stale data beats a skeleton.** When a cached entry is reused but needs
 * revalidating, the hook returns the old data immediately and refetches in the
 * background with `isRefreshing` set. A skeleton says "you have nothing"; last minute's
 * numbers say "here's what we knew" — for a dashboard the second is nearly always
 * better.
 */

// Backstop only, now that useImportedDataWatch catches other people's imports: real
// staleness is already handled by invalidation (a local confirm/revert bumps the shared
// version immediately; the 60s poll below catches a colleague's import). This just
// guards against that signal being missed somehow — with retail importing once a day
// per category, a page can safely stay instant for a full day before it's worth a
// background refetch on its own.
const STALE_MS = 24 * 60 * 60 * 1000

// How often to ask the server whether anyone else changed the data. Three aggregates
// over one indexed table, so a minute is comfortably cheap — and an import is something
// a colleague does a few times a day, not a few times a second.
const DATA_VERSION_POLL_MS = 60 * 1000

interface CacheEntry {
  data: unknown
  fetchedAt: number
  version: number
}

const cache = new Map<string, CacheEntry>()

// Bumped whenever the underlying data changes. Entries carry the version they were
// fetched at, so one bump invalidates every cached page at once without having to know
// which URLs any of them used.
let dataVersion = 0
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getDataVersion(): number {
  return dataVersion
}

/**
 * Call after anything that changes imported retail data — confirming an import, or
 * reverting one. Every cached page becomes stale, and any that is currently on screen
 * refetches immediately while still showing what it has.
 */
export function invalidateImportedData(): void {
  dataVersion += 1
  listeners.forEach((listener) => listener())
}

/** Call on sign-out: the next account may not even be allowed to see this branch's data. */
export function clearFetchCache(): void {
  cache.clear()
  invalidateImportedData()
}

export interface CachedFetch<T> {
  data: T | null
  /** True while revalidating *behind* data that is already on screen. */
  isRefreshing: boolean
  /** True only when there is nothing to show and the fetch failed. */
  failed: boolean
  reload: () => void
}

export function useCachedFetch<T>(
  // null means "not ready to fetch yet" — e.g. an admin account before a branch is
  // chosen. The hook holds no data and does nothing rather than firing a doomed request.
  url: string | null,
  session: Session,
  // Names the thing in the error toast: "Failed to load the Revenue dashboard".
  label: string
): CachedFetch<T> {
  const showToast = useToast()
  const nextRequest = useLatestRequest()
  const version = useSyncExternalStore(subscribe, getDataVersion)

  const [data, setData] = useState<T | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)

  async function run(url: string, isBackground: boolean): Promise<void> {
    const signal = nextRequest()
    if (isBackground) setIsRefreshing(true)
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal
      })
      if (!response.ok) {
        // A failed *background* refresh leaves the good data on screen — the page stays
        // usable and the toast says what happened, rather than throwing away numbers
        // that were fine a minute ago.
        if (!isBackground) setFailed(true)
        showToast('error', `Failed to load the ${label}: ${response.status}`)
        return
      }
      const body = (await response.json()) as T
      cache.set(url, { data: body, fetchedAt: Date.now(), version })
      setData(body)
      setFailed(false)
    } catch {
      if (signal.aborted) return
      if (!isBackground) setFailed(true)
      showToast('error', `Failed to load the ${label} — is the backend running?`)
    } finally {
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    if (!url) {
      setData(null)
      return
    }
    const entry = cache.get(url)
    const usable = entry !== undefined && entry.version === version
    // Show what we already have for this exact query before anything else — this is the
    // whole point of the hook.
    setData(usable ? (entry.data as T) : null)
    setFailed(false)
    if (usable && Date.now() - entry.fetchedAt < STALE_MS) return
    void run(url, usable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, session.access_token, version])

  return {
    data,
    isRefreshing,
    failed,
    // A retry with nothing on screen is a foreground load (show the skeleton); a manual
    // refresh with data up is a background one (keep the numbers, show the hint).
    reload: () => {
      if (url) void run(url, data !== null)
    }
  }
}


export interface CachedFetchMany<T> {
  /** Keyed by URL, so the caller keeps whatever it already knows about each one. */
  data: Record<string, T>
  /** True only while there is nothing at all to show yet. */
  isLoading: boolean
  isRefreshing: boolean
  failedCount: number
  reload: () => void
}

/**
 * The same cache, for several URLs at once — the Alerts tab needs every retail branch's
 * overview in one view.
 *
 * A loop of `useCachedFetch` calls is not an option (a component cannot call a hook a
 * variable number of times), and one request per branch is what we want anyway: they go
 * out in parallel, so the wall-clock cost is roughly one branch rather than the sum, and
 * every entry is shared with the single-URL hook. That last part is why opening Alerts
 * after Overview costs nothing — the branch cards already filled these exact entries.
 */
export function useCachedFetchMany<T>(
  urls: string[],
  // Nullable so App can call this for the sidebar badge before anyone has signed in.
  session: Session | null,
  label: string
): CachedFetchMany<T> {
  const showToast = useToast()
  const version = useSyncExternalStore(subscribe, getDataVersion)
  const [data, setData] = useState<Record<string, T>>({})
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [failedCount, setFailedCount] = useState(0)
  // A stable dependency for the effect: the identity of the array changes every render,
  // its contents rarely do.
  const key = urls.join('|')

  async function run(): Promise<void> {
    if (!session) return
    const fresh: Record<string, T> = {}
    const stale: string[] = []
    for (const url of urls) {
      const entry = cache.get(url)
      if (entry !== undefined && entry.version === version) {
        fresh[url] = entry.data as T
        if (Date.now() - entry.fetchedAt >= STALE_MS) stale.push(url)
      } else {
        stale.push(url)
      }
    }
    setData(fresh)
    setFailedCount(0)
    if (stale.length === 0) return

    // Only a "refresh" if something is already on screen; otherwise the caller shows a
    // loading state instead.
    if (Object.keys(fresh).length > 0) setIsRefreshing(true)
    let failures = 0
    const results = await Promise.all(
      stale.map(async (url) => {
        try {
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${session.access_token}` }
          })
          if (!response.ok) {
            failures += 1
            return null
          }
          const body = (await response.json()) as T
          cache.set(url, { data: body, fetchedAt: Date.now(), version })
          return [url, body] as const
        } catch {
          failures += 1
          return null
        }
      })
    )
    setIsRefreshing(false)
    setFailedCount(failures)
    if (failures > 0) showToast('error', `Couldn't load ${failures} of ${urls.length} for the ${label}`)
    const loaded = Object.fromEntries(results.filter((row): row is readonly [string, T] => row !== null))
    setData((previous) => ({ ...previous, ...loaded }))
  }

  useEffect(() => {
    if (urls.length === 0 || !session) {
      setData({})
      return
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, session?.access_token, version])

  return {
    data,
    isLoading: urls.length > 0 && Object.keys(data).length === 0 && failedCount === 0,
    isRefreshing,
    failedCount,
    reload: () => void run()
  }
}

/**
 * Watches for imports done by *other* accounts, on other machines.
 *
 * `invalidateImportedData` covers this client's own confirms and reverts, but a
 * business with three retail branches has several people importing, and nothing about
 * their work reaches this browser. So this polls a cheap version token and invalidates
 * when it moves. Call it once, high up, for the whole app.
 *
 * It also re-checks on window focus, which is when it matters most: someone comes back
 * to the app after a while and should not be reading yesterday's dashboard.
 */
export function useImportedDataWatch(session: Session | null): void {
  const seen = useRef<string | null>(null)

  useEffect(() => {
    if (!session) {
      seen.current = null
      return
    }
    let cancelled = false

    // resyncOnly records the server's token without invalidating — used right after a
    // local confirm or revert, which already invalidated everything. Without it the
    // next poll would see the token move and make every open page refetch a second
    // time for a change it had already handled.
    async function check(resyncOnly = false): Promise<void> {
      try {
        const response = await fetch(`${apiBaseUrl}/api/imports/data-version`, {
          headers: { Authorization: `Bearer ${session!.access_token}` }
        })
        if (!response.ok || cancelled) return
        const { version } = (await response.json()) as { version: string }
        if (cancelled) return
        // The very first reading is the baseline, not a change.
        if (!resyncOnly && seen.current !== null && seen.current !== version) {
          invalidateImportedData()
        }
        seen.current = version
      } catch {
        // Offline or the backend is down — the next tick tries again. A failed check is
        // not worth a toast; whatever is on screen is still the best we have.
      }
    }

    void check()
    const timer = setInterval(() => void check(), DATA_VERSION_POLL_MS)
    const onFocus = (): void => void check()
    window.addEventListener('focus', onFocus)
    const unsubscribe = subscribe(() => void check(true))

    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token])
}
