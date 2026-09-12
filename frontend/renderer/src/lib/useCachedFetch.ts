import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { getConnectionStatus } from "@renderer/lib/connection";
import { useToast } from "@renderer/lib/useToast";
import { useLatestRequest } from "@renderer/lib/useLatestRequest";

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
 *  1. `invalidateCachedPages()` is called — by confirming or reverting an import, which
 *     is the only thing that changes the sales, inventory, purchase and warning *data*
 *     these pages read, and by saving a business setting, which changes what the server
 *     computes *from* that data: a health weight moves every score, a threshold decides
 *     which alerts exist, a check window decides what the Warning page counts.
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
const STALE_MS = 24 * 60 * 60 * 1000;

// How often to ask the server whether anyone else changed the data. Three aggregates
// over one indexed table, so a minute is comfortably cheap — and an import is something
// a colleague does a few times a day, not a few times a second.
const DATA_VERSION_POLL_MS = 60 * 1000;

interface CacheEntry {
  data: unknown;
  fetchedAt: number;
  version: number;
}

const cache = new Map<string, CacheEntry>();

/**
 * The cache above also survives closing the app.
 *
 * In memory alone it only helped within one run: on a branch machine with a weak
 * connection, *opening* the app was the worst moment — every page a skeleton, every
 * request queued behind the same slow link. Writing the cache to disk means a launch
 * shows yesterday's numbers immediately and revalidates behind them, which is the same
 * bargain the in-memory cache already makes ("stale data beats a skeleton"), extended
 * across restarts.
 *
 * Freshness is not guessed at: the server's own data-version token is stored next to the
 * cache, so the first poll after launch compares against what this machine last saw and
 * invalidates everything if anyone imported in the meantime (see useImportedDataWatch).
 */
// The suffix is a shape version, not a cache-busting decoration: **bump it whenever an
// API payload these pages read changes shape**. Cached entries outlive an app update, so
// without a bump the new UI renders yesterday's payload and falls over on a field that
// did not exist then — which is exactly how v1 ended (the alert detail panel reading
// `facts` on an alert saved before alerts had any).
const STORAGE_KEY = "branchwise:page-cache:v2";
const VERSION_TOKEN_KEY = "branchwise:data-version";

// Restored entries older than this are dropped on load. A week-old dashboard is not
// worth showing even for the second before it refreshes.
const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// localStorage is a handful of MB in total and shared with the session and settings, so
// the cache stays well inside it: anything huge is skipped rather than evicting
// everything else, and the whole set is trimmed to the newest entries that fit.
const PERSIST_MAX_ENTRY_BYTES = 512 * 1024;
const PERSIST_MAX_TOTAL_BYTES = 3 * 1024 * 1024;
// Confirming an import can fill several entries in a second; writing once after things
// settle keeps that off the UI thread.
const PERSIST_DEBOUNCE_MS = 1000;

interface PersistedEntry {
  url: string;
  data: unknown;
  fetchedAt: number;
}

function loadPersistedCache(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const entries = JSON.parse(raw) as PersistedEntry[];
    if (!Array.isArray(entries)) return;
    const cutoff = Date.now() - PERSIST_MAX_AGE_MS;
    for (const entry of entries) {
      if (!entry?.url || entry.fetchedAt < cutoff) continue;
      // Restored at the *current* in-memory version, so a later invalidation (a colleague's
      // import, this account's own confirm) discards them exactly like live entries.
      cache.set(entry.url, {
        data: entry.data,
        fetchedAt: entry.fetchedAt,
        version: dataVersion,
      });
    }
  } catch {
    // Unreadable or unparseable: start empty rather than fail to boot.
  }
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;

function persistCacheNow(): void {
  persistTimer = null;
  try {
    // Newest first, so the trim below keeps what the reader is most likely to open next.
    const candidates = [...cache.entries()]
      .map(([url, entry]) => ({
        url,
        data: entry.data,
        fetchedAt: entry.fetchedAt,
      }))
      .sort((a, b) => b.fetchedAt - a.fetchedAt);

    const kept: PersistedEntry[] = [];
    let total = 0;
    for (const candidate of candidates) {
      const size = JSON.stringify(candidate).length;
      if (size > PERSIST_MAX_ENTRY_BYTES) continue;
      if (total + size > PERSIST_MAX_TOTAL_BYTES) break;
      kept.push(candidate);
      total += size;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(kept));
  } catch {
    // Out of quota or storage disabled. The in-memory cache is unaffected; this run just
    // won't hand anything to the next one.
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  persistTimer = setTimeout(persistCacheNow, PERSIST_DEBOUNCE_MS);
}

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

// How many fetches this module has in the air right now, as a store the UI can read.
// A page-level Refresh button needs to show that something is happening, but the
// requests it triggers belong to whichever tabs are mounted — the button itself never
// sees them. Counting them here is what lets it say "loading" without every tab having
// to hand its state back up the tree.
let inFlight = 0;
const inFlightListeners = new Set<() => void>();

function subscribeInFlight(listener: () => void): () => void {
  inFlightListeners.add(listener);
  return () => {
    inFlightListeners.delete(listener);
  };
}

function getInFlight(): number {
  return inFlight;
}

function beginFetch(): void {
  inFlight += 1;
  inFlightListeners.forEach((listener) => listener());
}

function endFetch(): void {
  inFlight = Math.max(0, inFlight - 1);
  inFlightListeners.forEach((listener) => listener());
}

/** True while any cached-fetch request is in the air, anywhere in the app. */
export function useFetchInFlight(): boolean {
  return useSyncExternalStore(subscribeInFlight, getInFlight) > 0;
}

// Bumped whenever the underlying data changes. Entries carry the version they were
// fetched at, so one bump invalidates every cached page at once without having to know
// which URLs any of them used.
let dataVersion = 0;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getDataVersion(): number {
  return dataVersion;
}

// Bumped by the Refresh button. Deliberately *not* the same counter as `dataVersion`:
// invalidating says "what you have is wrong", which empties the page down to a skeleton
// while it refetches. A manual refresh says "get me today's numbers", and blanking the
// figures the reader was just looking at to do that would be worse than not refreshing
// at all. So this asks every mounted page to refetch behind the data it already shows.
let refreshTick = 0;
const refreshListeners = new Set<() => void>();

function subscribeRefresh(listener: () => void): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}

function getRefreshTick(): number {
  return refreshTick;
}

/** Refetch every mounted page now, keeping what is on screen while it happens. */
export function refreshCachedPages(): void {
  refreshTick += 1;
  refreshListeners.forEach((listener) => listener());
}

// Runs once, at import time — after `dataVersion` above exists, since restored entries
// are stamped with it.
loadPersistedCache();

/**
 * Call after anything that changes what the server would now return: confirming or
 * reverting an import, or saving a business setting that feeds a computed page (the
 * branch health weights, the alert thresholds, the check and list windows). Every cached
 * page becomes stale, and any that is currently on screen refetches immediately while
 * still showing what it has.
 *
 * The theme is the one setting that calls nothing here, since it changes only how the
 * page is painted — a light/dark toggle refetching every dashboard would be absurd.
 */
export function invalidateCachedPages(): void {
  dataVersion += 1;
  listeners.forEach((listener) => listener());
}

/** Call on sign-out: the next account may not even be allowed to see this branch's data. */
export function clearFetchCache(): void {
  cache.clear();
  // Including the copy on disk — otherwise the next launch would restore the previous
  // account's branch data straight back onto the screen.
  try {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = null;
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(VERSION_TOKEN_KEY);
  } catch {
    // Nothing to do: an unwritable store had nothing of the old account in it either.
  }
  invalidateCachedPages();
}

export interface CachedFetch<T> {
  data: T | null;
  /** True while revalidating *behind* data that is already on screen. */
  isRefreshing: boolean;
  /** True only when there is nothing to show and the fetch failed. */
  failed: boolean;
  reload: () => void;
}

export function useCachedFetch<T>(
  // null means "not ready to fetch yet" — e.g. an admin account before a branch is
  // chosen. The hook holds no data and does nothing rather than firing a doomed request.
  url: string | null,
  session: Session,
  // Names the thing in the error toast: "Failed to load the Revenue dashboard".
  label: string,
): CachedFetch<T> {
  const showToast = useToast();
  const nextRequest = useLatestRequest();
  const version = useSyncExternalStore(subscribe, getDataVersion);
  const tick = useSyncExternalStore(subscribeRefresh, getRefreshTick);
  // What this hook has already acted on, so a re-render for any other reason doesn't
  // read as a fresh Refresh press.
  const handledTick = useRef(tick);

  const [data, setData] = useState<T | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  async function run(url: string, isBackground: boolean): Promise<void> {
    const signal = nextRequest();
    if (isBackground) setIsRefreshing(true);
    beginFetch();
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal,
      });
      if (!response.ok) {
        // A failed *background* refresh leaves the good data on screen — the page stays
        // usable and the toast says what happened, rather than throwing away numbers
        // that were fine a minute ago.
        if (!isBackground) setFailed(true);
        showToast("error", `Failed to load the ${label}: ${response.status}`);
        return;
      }
      const body = (await response.json()) as T;
      cache.set(url, { data: body, fetchedAt: Date.now(), version });
      schedulePersist();
      setData(body);
      setFailed(false);
    } catch {
      if (signal.aborted) return;
      if (!isBackground) setFailed(true);
      // On a weak connection this fires on every page the reader opens, and the
      // connection banner is already saying why — stacking six identical toasts on top
      // of numbers that are still perfectly readable only adds noise. A page with
      // nothing to show still explains itself.
      if (getConnectionStatus() === "offline") {
        if (!isBackground) {
          showToast("error", `No connection — the ${label} couldn't be loaded`);
        }
      } else {
        showToast(
          "error",
          `Failed to load the ${label} — is the backend running?`,
        );
      }
    } finally {
      endFetch();
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    if (!url) {
      setData(null);
      return;
    }
    const entry = cache.get(url);
    const usable = entry !== undefined && entry.version === version;
    // Show what we already have for this exact query before anything else — this is the
    // whole point of the hook.
    setData(usable ? (entry.data as T) : null);
    setFailed(false);
    // A Refresh press skips the freshness check — otherwise the button would sit there
    // doing nothing on a page fetched a minute ago, which is exactly when someone
    // presses it.
    const forced = tick !== handledTick.current;
    handledTick.current = tick;
    if (!forced && usable && Date.now() - entry.fetchedAt < STALE_MS) return;
    void run(url, usable);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, session.access_token, version, tick]);

  return {
    data,
    isRefreshing,
    failed,
    // A retry with nothing on screen is a foreground load (show the skeleton); a manual
    // refresh with data up is a background one (keep the numbers, show the hint).
    reload: () => {
      if (url) void run(url, data !== null);
    },
  };
}

export interface CachedFetchMany<T> {
  /** Keyed by URL, so the caller keeps whatever it already knows about each one. */
  data: Record<string, T>;
  /** True only while there is nothing at all to show yet. */
  isLoading: boolean;
  isRefreshing: boolean;
  failedCount: number;
  reload: () => void;
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
  label: string,
): CachedFetchMany<T> {
  const showToast = useToast();
  const version = useSyncExternalStore(subscribe, getDataVersion);
  const tick = useSyncExternalStore(subscribeRefresh, getRefreshTick);
  const handledTick = useRef(tick);
  const [data, setData] = useState<Record<string, T>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  // A stable dependency for the effect: the identity of the array changes every render,
  // its contents rarely do.
  const key = urls.join("|");

  // `force` is what the Refresh button passes: a manual refresh has to refetch even when
  // every entry is cached and inside STALE_MS, or the button silently does nothing —
  // which is exactly what it did until this argument existed. The single-URL hook's
  // `reload` already bypassed the freshness check by calling `run` directly; this is the
  // same rule, spelled out for the several-URL version.
  async function run(force = false): Promise<void> {
    if (!session) return;
    const fresh: Record<string, T> = {};
    const stale: string[] = [];
    for (const url of urls) {
      const entry = cache.get(url);
      if (entry !== undefined && entry.version === version) {
        // Kept on screen while it refetches, forced or not — stale data still beats a
        // skeleton, and a refresh that blanked the page would be worse than no refresh.
        fresh[url] = entry.data as T;
        if (force || Date.now() - entry.fetchedAt >= STALE_MS) stale.push(url);
      } else {
        stale.push(url);
      }
    }
    setData(fresh);
    setFailedCount(0);
    if (stale.length === 0) return;

    // Only a "refresh" if something is already on screen; otherwise the caller shows a
    // loading state instead.
    if (Object.keys(fresh).length > 0) setIsRefreshing(true);
    beginFetch();
    let failures = 0;
    const results = await Promise.all(
      stale.map(async (url) => {
        try {
          const response = await fetch(url, {
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          if (!response.ok) {
            failures += 1;
            return null;
          }
          const body = (await response.json()) as T;
          cache.set(url, { data: body, fetchedAt: Date.now(), version });
          schedulePersist();
          return [url, body] as const;
        } catch {
          failures += 1;
          return null;
        }
      }),
    );
    endFetch();
    setIsRefreshing(false);
    setFailedCount(failures);
    if (failures > 0 && getConnectionStatus() !== "offline") {
      showToast(
        "error",
        `Couldn't load ${failures} of ${urls.length} for the ${label}`,
      );
    }
    const loaded = Object.fromEntries(
      results.filter((row): row is readonly [string, T] => row !== null),
    );
    setData((previous) => ({ ...previous, ...loaded }));
  }

  useEffect(() => {
    if (urls.length === 0 || !session) {
      setData({});
      return;
    }
    const forced = tick !== handledTick.current;
    handledTick.current = tick;
    void run(forced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, session?.access_token, version, tick]);

  return {
    data,
    isLoading:
      urls.length > 0 && Object.keys(data).length === 0 && failedCount === 0,
    isRefreshing,
    failedCount,
    reload: () => void run(true),
  };
}

/**
 * Watches for imports done by *other* accounts, on other machines.
 *
 * `invalidateCachedPages` covers this client's own confirms and reverts, but a
 * business with three retail branches has several people importing, and nothing about
 * their work reaches this browser. So this polls a cheap version token and invalidates
 * when it moves. Call it once, high up, for the whole app.
 *
 * It also re-checks on window focus, which is when it matters most: someone comes back
 * to the app after a while and should not be reading yesterday's dashboard.
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
          invalidateCachedPages();
        }
        seen.current = version;
        storeDataVersionToken(version);
      } catch {
        // Offline or the backend is down — the next tick tries again. A failed check is
        // not worth a toast; whatever is on screen is still the best we have.
      }
    }

    void check();
    const timer = setInterval(() => void check(), DATA_VERSION_POLL_MS);
    const onFocus = (): void => void check();
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribe(() => void check(true));

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);
}
