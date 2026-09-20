import { useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { readLastKnown, writeLastKnown } from "@renderer/lib/lastKnown";

export interface BranchOption {
  id: string;
  name: string;
}

/**
 * Branch lists change about once a year, and everything above them depends on them: an
 * admin's Dashboard builds one card per branch, so an empty list offline means an empty
 * page even when every card's data is sitting in the page cache. So each of the three
 * hooks below starts from the last list the server gave us and only replaces it when a
 * request actually succeeds — a failed one leaves the previous list alone rather than
 * blanking the screen.
 */
function useRememberedBranches<T>(
  storageKey: string,
  url: string | null,
  session: Session | null,
  select: (branches: BranchOption[]) => T,
  empty: T,
): T {
  const [value, setValue] = useState<T>(
    () => readLastKnown<T>(storageKey) ?? empty,
  );

  useEffect(() => {
    if (!session || !url) {
      setValue(empty);
      return;
    }
    let cancelled = false;
    fetch(url, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((r) => (r.ok ? (r.json() as Promise<BranchOption[]>) : null))
      .then((branches) => {
        if (cancelled || branches === null) return;
        const next = select(branches);
        setValue(next);
        writeLastKnown(storageKey, next);
      })
      .catch(() => {
        // Offline: the remembered list is the best answer there is.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, session?.access_token]);

  return value;
}

// The full canonical list of branch names, for admin-only filter dropdowns that should
// offer every branch (even one with zero rows right now) rather than only the branches
// that happen to appear in whatever's currently loaded. Pass `null` to skip fetching
// (e.g. for branch-scoped accounts, where every row already belongs to their one branch).
export function useBranches(session: Session | null): string[] {
  return useRememberedBranches<string[]>(
    "branch-names",
    `${apiBaseUrl}/api/branches?kind=all`,
    session,
    (branches) => branches.map((b) => b.name).sort(),
    [],
  );
}

// id+name pairs (not just display names) for a branch picker whose selection is actually
// submitted somewhere, e.g. an admin account choosing which retail branch's
// Purchasing to view. Pass `null` to skip fetching.
export function useRetailBranchOptions(
  session: Session | null,
): BranchOption[] {
  return useRememberedBranches<BranchOption[]>(
    "branches-retail",
    `${apiBaseUrl}/api/branches`,
    session,
    (branches) => branches,
    [],
  );
}

// Full list of branches (both retail and wholesale) with id and name, for pickers
// like the Dashboard that support viewing any branch. Pass `null` to skip fetching.
export function useAllBranchOptions(
  session: Session | null,
): BranchOption[] {
  return useRememberedBranches<BranchOption[]>(
    "branches-all",
    `${apiBaseUrl}/api/branches?kind=all`,
    session,
    (branches) => branches,
    [],
  );
}
