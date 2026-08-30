import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'

export interface BranchOption {
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

// id+name pairs (not just display names) for a branch picker whose selection is actually
// submitted somewhere — e.g. an admin account choosing which wholesale branch a new
// customer order/factory voucher belongs to. Pass `null` to skip fetching.
export function useWholesaleBranchOptions(session: Session | null): BranchOption[] {
  const [options, setOptions] = useState<BranchOption[]>([])

  useEffect(() => {
    if (!session) {
      setOptions([])
      return
    }
    let cancelled = false
    fetch(`${apiBaseUrl}/api/branches?kind=wholesale`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((branches: BranchOption[]) => {
        if (!cancelled) setOptions(branches)
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token])

  return options
}

// The retail mirror of useWholesaleBranchOptions — id+name pairs for a picker whose
// selection is submitted somewhere, e.g. an admin account choosing which retail branch's
// Dashboard to view (the dashboard is always one branch at a time, never a cross-branch
// rollup — see docs/retail_dashboard.md). Pass `null` to skip fetching.
export function useRetailBranchOptions(session: Session | null): BranchOption[] {
  const [options, setOptions] = useState<BranchOption[]>([])

  useEffect(() => {
    if (!session) {
      setOptions([])
      return
    }
    let cancelled = false
    fetch(`${apiBaseUrl}/api/branches`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((branches: BranchOption[]) => {
        if (!cancelled) setOptions(branches)
      })
      .catch(() => {
        if (!cancelled) setOptions([])
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token])

  return options
}
