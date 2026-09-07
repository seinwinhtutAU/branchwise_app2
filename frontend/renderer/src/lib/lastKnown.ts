/**
 * The small, slow-changing answers the whole app is built on — who you are, and what the
 * branches are called — remembered from the last time the server told us.
 *
 * These are not page data, which is why they don't live in `useCachedFetch`: they are
 * what decides *which* pages exist. The profile carries the role and branch, so without
 * it an admin account looks like a branch-scoped retail one — offline, that turned the
 * Dashboard into "couldn't load" even though every branch card was sitting in the page
 * cache. Branch lists have the same problem one level down: no list, no cards to show.
 *
 * Both are a few hundred bytes, change roughly never, and are already visible to the
 * account they belong to. Keeping the last known copy costs nothing and is the difference
 * between an app that opens on a bad connection and one that doesn't.
 *
 * Cleared on sign-out, since the next account is not this one.
 */

const PREFIX = 'branchwise:last-known:'

export function readLastKnown<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeLastKnown<T>(key: string, value: T): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage full or disabled — this run is unaffected, the next one just starts blank.
  }
}

export function forgetLastKnown(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // Nothing stored means nothing to forget.
  }
}

/** Sign-out: drop every remembered answer, they belonged to the account that just left. */
export function clearLastKnown(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(PREFIX)) localStorage.removeItem(key)
    }
  } catch {
    // As above.
  }
}
