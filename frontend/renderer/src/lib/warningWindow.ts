import { useState } from 'react'

const STORAGE_KEY = 'branchwise-warning-window-days'
const DEFAULT_DAYS = 1

export function getStoredWarningWindowDays(): number {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_DAYS
  } catch {
    return DEFAULT_DAYS
  }
}

// A per-device preference for how far back the Sale/Purchase "fix these numbers" checks
// look — kept in localStorage (like the theme) rather than the database, since it's a
// personal viewing preference, not a business rule. Inventory always checks only the
// latest snapshot regardless of this setting, so there's nothing to configure there.
export function useWarningWindowDays(): [number, (days: number) => void] {
  const [days, setDaysState] = useState<number>(getStoredWarningWindowDays)

  function setDays(next: number): void {
    setDaysState(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // Best-effort — the setting still applies for this session even if storage is unavailable.
    }
  }

  return [days, setDays]
}
