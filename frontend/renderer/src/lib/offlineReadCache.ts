/**
 * Disk-backed fallback for successful API reads.
 *
 * React Query already persists the pages that use it, but not every screen has migrated
 * yet.  Cache Storage covers those remaining JSON GETs too, without changing each call
 * site.  Entries are deliberately separated by app user and are discarded on sign-out.
 */
const CACHE_PREFIX = "branchwise:offline-api-v1";
const MAX_ENTRIES = 120;
const MAX_ENTRY_BYTES = 1_000_000;

let activeScope: string | null = null;

function cacheName(): string | null {
  return activeScope === null
    ? null
    : `${CACHE_PREFIX}:${encodeURIComponent(activeScope)}`;
}

function cacheStorageAvailable(): boolean {
  return typeof window !== "undefined" && "caches" in window;
}

function shouldStore(response: Response): boolean {
  const contentType = response.headers.get("content-type") ?? "";
  return response.ok && contentType.includes("application/json");
}

/** Sets the user namespace before any authenticated reads happen. */
export function setOfflineReadCacheScope(userId: string | null): void {
  activeScope = userId;
}

/** Remove this account's local API responses when it signs out. */
export async function clearOfflineReadCache(): Promise<void> {
  const name = cacheName();
  if (!name || !cacheStorageAvailable()) return;
  try {
    await window.caches.delete(name);
  } catch {
    // Disk caching is a resilience enhancement; an unavailable browser cache should
    // never prevent sign-out or otherwise affect the normal online request.
  }
}

/** Save a bounded JSON response without delaying the screen that requested it. */
export async function saveOfflineRead(url: string, response: Response): Promise<void> {
  const name = cacheName();
  if (!name || !cacheStorageAvailable() || !shouldStore(response)) return;
  try {
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_ENTRY_BYTES) return;

    const headers = new Headers(response.headers);
    headers.set("X-Branchwise-Cached-At", new Date().toISOString());
    const cache = await window.caches.open(name);
    await cache.put(
      url,
      new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
    );

    const keys = await cache.keys();
    const excess = keys.length - MAX_ENTRIES;
    if (excess > 0) await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  } catch {
    // Quota and Cache Storage errors merely mean this request has no offline copy.
  }
}

/** Return a response that is explicitly marked as a local fallback, if one exists. */
export async function readOfflineRead(url: string): Promise<Response | null> {
  const name = cacheName();
  if (!name || !cacheStorageAvailable()) return null;
  try {
    const cached = await window.caches.open(name).then((cache) => cache.match(url));
    if (!cached) return null;
    const headers = new Headers(cached.headers);
    headers.set("X-Branchwise-Offline-Cache", "1");
    return new Response(await cached.arrayBuffer(), {
      status: cached.status,
      statusText: cached.statusText,
      headers,
    });
  } catch {
    return null;
  }
}
