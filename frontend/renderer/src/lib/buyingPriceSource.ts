import { useState } from 'react'

const STORAGE_KEY = 'branchwise-show-buying-price-source'
const DEFAULT_SHOW = true

export function getStoredShowBuyingPriceSource(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === null ? DEFAULT_SHOW : stored === 'true'
  } catch {
    return DEFAULT_SHOW
  }
}

// A per-device preference for whether the Sale/Data Overview tables show the Buying
// Price Source column — kept in localStorage (like the theme) rather than the database,
// since it's a personal viewing preference, not a business rule. Unlike buying price
// grace days (which changes the computed value everyone sees), this only controls
// whether an already-computed field is displayed.
export function useShowBuyingPriceSource(): [boolean, (show: boolean) => void] {
  const [show, setShowState] = useState<boolean>(getStoredShowBuyingPriceSource)

  function setShow(next: boolean): void {
    setShowState(next)
    try {
      localStorage.setItem(STORAGE_KEY, String(next))
    } catch {
      // Best-effort — the setting still applies for this session even if storage is unavailable.
    }
  }

  return [show, setShow]
}

// Raw values are point_in_time_buying_price's internal vocabulary (see
// app/services/pricing.py) — translated here rather than in the backend response, so the
// API stays a stable machine-readable enum while the label can be reworded freely.
const SOURCE_LABELS: Record<string, string> = {
  purchase: 'Purchase',
  stock: 'Stock count',
  stock_forward_fill: 'Later recount (est.)'
}

export function formatBuyingPriceSource(source: string | null | undefined): string {
  if (!source) return '—'
  return SOURCE_LABELS[source] ?? source
}
