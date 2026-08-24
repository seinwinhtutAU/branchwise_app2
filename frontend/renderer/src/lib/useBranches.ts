import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'

interface BranchOption {
  id: string
  name: string
}

// The full canonical list of branch names, for admin-only filter dropdowns that should
// offer every branch (even one with zero rows right now) rather than only the branches
// that happen to appear in whatever's currently loaded. Pass `null` to skip fetching
// (e.g. for branch-scoped accounts, where every row already belongs to their one branch).
export function useBranches(session: Session | null): string[] {
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    if (!session) {
      setNames([])
      return
    }
    let cancelled = false
    fetch(`${apiBaseUrl}/api/branches`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((branches: BranchOption[]) => {
        if (!cancelled) setNames(branches.map((b) => b.name).sort())
      })
      .catch(() => {
        if (!cancelled) setNames([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token])

  return names
}
