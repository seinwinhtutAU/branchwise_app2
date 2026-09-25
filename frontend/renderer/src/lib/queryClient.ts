import { useEffect, useRef } from "react";
import { QueryClient, useQueries, useQuery } from "@tanstack/react-query";
import { apiBaseUrl } from "@renderer/lib/auth";
import type { Session } from "@renderer/lib/auth";
import { getConnectionStatus } from "@renderer/lib/connection";
import { useToast } from "@renderer/lib/useToast";

/**
 * The single QueryClient the whole app shares, created here (not inline in main.tsx) so
 * code outside the component tree — a write helper, a settings save — can reach it too,
 * the same way the old page cache's invalidateCachedPages()/refreshCachedPages() were
 * plain functions any file could call. See main.tsx for where this is actually mounted
 * (with disk persistence) and PROJECT_README/CLAUDE.md's "Working on a weak connection"
 * for why a page showing what it already knows, rather than a blank screen, matters here.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A backstop, not a performance target — see the fuller reasoning in main.tsx.
      // Freshness in practice comes from invalidateEverything() below, called right
      // after whatever changed the data.
      staleTime: 24 * 60 * 60 * 1000,
      gcTime: 7 * 24 * 60 * 60 * 1000,
      // window.fetch is already retried by installNetworkResilience() in lib/network.ts
      // for every request to this app's own backend — a second retry layer here would
      // just restart that whole sequence on top of itself.
      retry: false,
    },
  },
});

// Notified every time invalidateEverything() runs, so useImportedDataWatch below can
// resync its own version token without invalidating a second time for a change it just
// caused itself — mirrors the old page cache's `listeners` set that
// useImportedDataWatch subscribed to for the same reason.
const invalidateListeners = new Set<() => void>();

function subscribeToLocalInvalidate(listener: () => void): () => void {
  invalidateListeners.add(listener);
  return () => {
    invalidateListeners.delete(listener);
  };
}

/**
 * Call after anything that changes what the server would now return: confirming or
 * reverting an import, saving a business setting that feeds a computed page, or a
 * wholesale write. Every page still on screen refetches immediately while still showing
 * what it has, the same "stale data beats a skeleton" bargain the query cache always
 * makes. Direct equivalent of the old page cache's invalidateCachedPages().
 */
export function invalidateEverything(): void {
  void queryClient.invalidateQueries();
  invalidateListeners.forEach((listener) => listener());
}

/** A person pressing "Refresh": get today's numbers, without blanking the figures they
 *  were just looking at to do it. Direct equivalent of the old page cache's
 *  refreshCachedPages(). */
export function refreshEverything(): void {
  void queryClient.refetchQueries();
}

/** Sign-out: the next account may not even be allowed to see this branch's data.
 *  Direct equivalent of the old page cache's clearFetchCache(). */
export function clearQueryCache(): void {
  queryClient.clear();
}

/**
 * The GET side of the React Query migration: the same Bearer header useCachedFetch
 * already sent, so moving a page's fetch from useCachedFetch to useQuery is a
 * like-for-like swap of the caching mechanism, not a second implementation of the
 * request itself. Retries, timeouts and offline detection still happen for free —
 * window.fetch is already wrapped by installNetworkResilience() for every request to
 * this app's own backend, whoever calls it.
 */
export async function fetchJson<T>(url: string, session: Session): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * The same friendly, offline-aware failure toast useCachedFetch always showed —
 * "Failed to load the Revenue dashboard" or, while genuinely offline, a message that
 * says so instead of blaming the backend — kept as one shared hook so every page
 * migrating off useCachedFetch says this the same way rather than each inventing its
 * own wording (or silently dropping it, which is exactly what the first few wholesale
 * pages did before this was pulled out).
 */
export function useLoadErrorToast(isError: boolean, label: string): void {
  const showToast = useToast();
  useEffect(() => {
    if (!isError) return;
    // Connection health is continuously visible in AppShell. A toast for every query
    // that fails during the same outage would hide the actual work the reader was doing.
    if (getConnectionStatus() === "offline") return;
    showToast("error", `Failed to load the ${label} — is the backend running?`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError, label]);
}

/** The canonical query key for a plain GET of one URL — every page fetching a raw URL
 *  through fetchJson should key it this way, so two pages asking for the exact same URL
 *  (a branch's overview, fetched from both a dashboard card and the Alerts page) share
 *  one cache entry instead of fetching it twice. Pages with several distinct queries of
 *  their own shape (the wholesale ones) use their own semantic keys instead; this is
 *  for the many single-URL pages migrating straight off useCachedFetch. */
function urlQueryKey(url: string | null): readonly [string, string | null] {
  return ["fetchJson", url] as const;
}

interface UrlQueryResult<T> {
  data: T | undefined;
  isRefreshing: boolean;
  failed: boolean;
  reload: () => Promise<void>;
}

/** The single-URL replacement for useCachedFetch: same shape (data/isRefreshing/failed/
 *  reload), same friendly error toast, cached by the URL itself so it is automatically
 *  shared with anything else asking for that same URL. `url: null` means "not ready to
 *  fetch yet" (an admin account before a branch is chosen), matching the old hook. */
export function useUrlQuery<T>(
  url: string | null,
  session: Session,
  label: string,
): UrlQueryResult<T> {
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: urlQueryKey(url),
    queryFn: () => fetchJson<T>(url as string, session),
    enabled: url !== null,
  });
  useLoadErrorToast(isError, label);
  async function reload(): Promise<void> {
    await refetch();
  }
  return { data, isRefreshing: isFetching, failed: isError, reload };
}

interface UrlQueriesResult<T> {
  /** Keyed by URL, so the caller keeps whatever it already knows about each one. */
  data: Record<string, T>;
  /** URLs with no cached data yet, still fetching for the first time. */
  pendingUrls: string[];
  /** URLs with no cached data, whose request has failed. */
  failedUrls: string[];
  /** True only while there is nothing at all to show yet. */
  isLoading: boolean;
  isRefreshing: boolean;
  failedCount: number;
  reload: () => Promise<void>;
  /** Retries a single URL — for a per-item retry action rather than reloading everything. */
  refetchUrl: (url: string) => Promise<void>;
}

/** The several-URL replacement for useCachedFetchMany — the Alerts page needs every
 *  retail branch's overview in one view. Each URL is its own query, keyed the same way
 *  useUrlQuery keys a single one, so this shares cache entries with (and gets shared by)
 *  every single-URL page asking for the same URLs — opening Alerts after the dashboard's
 *  branch cards costs nothing. `session: null` means "nobody signed in yet" (App calls
 *  this for the sidebar badge before that), matching the old hook. */
export function useUrlQueries<T>(
  urls: string[],
  session: Session | null,
  label: string,
  /** For figures that change with the clock rather than with an import — see App's
   *  Business Alerts badge. Omitted, a query keeps the long default staleTime. */
  refresh?: { everyMs: number },
): UrlQueriesResult<T> {
  const showToast = useToast();
  const results = useQueries({
    queries: urls.map((url) => ({
      queryKey: urlQueryKey(url),
      queryFn: () => fetchJson<T>(url, session as Session),
      enabled: session !== null,
      ...(refresh ? { staleTime: refresh.everyMs, refetchInterval: refresh.everyMs } : {}),
    })),
  });

  const data: Record<string, T> = {};
  const pendingUrls: string[] = [];
  const failedUrls: string[] = [];
  let failedCount = 0;
  let isRefreshing = false;
  for (const [index, result] of results.entries()) {
    const url = urls[index];
    if (result.data !== undefined) {
      data[url] = result.data;
      if (result.isFetching) isRefreshing = true;
    } else if (result.isFetching) {
      pendingUrls.push(url);
    } else if (result.isError) {
      failedUrls.push(url);
    }
    if (result.isError) failedCount += 1;
  }

  useEffect(() => {
    if (failedCount === 0 || getConnectionStatus() === "offline") return;
    showToast(
      "error",
      `Couldn't load ${failedCount} of ${urls.length} for the ${label}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedCount]);

  async function reload(): Promise<void> {
    await Promise.all(
      urls.map((url) =>
        queryClient.invalidateQueries({ queryKey: urlQueryKey(url) }),
      ),
    );
  }

  async function refetchUrl(url: string): Promise<void> {
    await queryClient.refetchQueries({ queryKey: urlQueryKey(url) });
  }

  return {
    data,
    pendingUrls,
    failedUrls,
    isLoading: urls.length > 0 && Object.keys(data).length === 0 && failedCount === 0,
    isRefreshing,
    failedCount,
    reload,
    refetchUrl,
  };
}

// How often to ask the server whether anyone else changed the data — see
// useImportedDataWatch below. Three aggregates over one indexed table, so a minute is
// comfortably cheap, and an import is something a colleague does a few times a day, not
// a few times a second.
const DATA_VERSION_POLL_MS = 60 * 1000;
const VERSION_TOKEN_KEY = "branchwise:data-version";

/** The server data-version token this machine last saw, from a previous run. */
function loadDataVersionToken(): string | null {
  try {
    return localStorage.getItem(VERSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeDataVersionToken(token: string): void {
  try {
    localStorage.setItem(VERSION_TOKEN_KEY, token);
  } catch {
    // Not fatal: without it, the next launch simply treats its restored cache as stale
    // on the first poll and refetches.
  }
}

/**
 * Watches for imports done by *other* accounts, on other machines.
 *
 * invalidateEverything() covers this client's own confirms and reverts, but a business
 * with three retail branches has several people importing, and nothing about their work
 * reaches this browser on its own. So this polls a cheap version token and invalidates
 * everything when it moves. Call it once, high up, for the whole app.
 *
 * It also re-checks on window focus, which is when it matters most: someone comes back
 * to the app after a while and should not be reading yesterday's dashboard. Direct
 * equivalent of the old page cache's useImportedDataWatch.
 */
export function useImportedDataWatch(session: Session | null): void {
  // Seeded from disk, not from null, so the cache restored at launch is checked against
  // what this machine last saw rather than being trusted blindly: if a colleague
  // imported while the app was closed, the very first poll notices and refetches.
  const seen = useRef<string | null>(loadDataVersionToken());

  useEffect(() => {
    if (!session) {
      seen.current = null;
      return;
    }
    let cancelled = false;

    // resyncOnly records the server's token without invalidating — used right after a
    // local confirm or revert, which already invalidated everything. Without it the
    // next poll would see the token move and make every open page refetch a second
    // time for a change it had already handled.
    async function check(resyncOnly = false): Promise<void> {
      try {
        const response = await fetch(`${apiBaseUrl}/api/imports/data-version`, {
          headers: { Authorization: `Bearer ${session!.access_token}` },
        });
        if (!response.ok || cancelled) return;
        const { version } = (await response.json()) as { version: string };
        if (cancelled) return;
        // The very first reading is the baseline, not a change.
        if (!resyncOnly && seen.current !== null && seen.current !== version) {
          invalidateEverything();
        }
        seen.current = version;
        storeDataVersionToken(version);
      } catch {
        // Offline or the backend is down — the next tick tries again. A failed check is
        // not worth a toast; whatever is on screen is still the best we have.
      }
    }

    void check();
    // Skip the tick while the window is minimized/backgrounded — nobody is looking at
    // stale data they can't see, so there's nothing to invalidate for yet. Checking
    // again the moment it's visible (same as the focus listener below) means a colleague
    // coming back to the app never reads yesterday's numbers for longer than it takes to
    // switch back.
    const timer = setInterval(() => {
      if (document.hidden) return;
      void check();
    }, DATA_VERSION_POLL_MS);
    const onFocus = (): void => void check();
    window.addEventListener("focus", onFocus);
    const onVisibilityChange = (): void => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const unsubscribe = subscribeToLocalInvalidate(() => void check(true));

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);
}
