import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { applyTheme, cacheTheme, type ThemeMode } from '@renderer/lib/theme'

// The Branch Health Score's dimension weights and the Early Warning rules' firing
// points (see docs/branch_health.md). Both are stored and updated as a whole set, not
// field by field: a weight only means anything relative to the other four, and a
// half-saved threshold set would fire alerts nobody chose.
export interface BranchHealthWeights {
  sales: number
  profit: number
  inventory: number
  customer: number
  data_quality: number
}

export interface EarlyWarningThresholds {
  revenue_decline_warning_pct: number
  revenue_decline_critical_pct: number
  low_margin_warning_pct: number
  low_margin_critical_pct: number
  margin_slip_warning_pp: number
  dead_stock_warning_share_pct: number
  dead_stock_critical_share_pct: number
  traffic_decline_warning_pct: number
  single_item_basket_warning_share_pct: number
}

export interface AppSettings {
  stock_forward_fallback_window_days: number
  purchase_lookback_window_days: number
  stock_lookback_window_days: number
  theme: ThemeMode
  sale_warning_window_days: number
  purchase_warning_window_days: number
  sale_list_window_days: number
  purchase_list_window_days: number
  show_buying_price_source: boolean
  branch_health_weights: BranchHealthWeights
  early_warning_thresholds: EarlyWarningThresholds
}

// Business-wide preferences (theme, check/list windows, column visibility, pricing
// windows) — one shared value in the `app_settings` table for every account and every
// device, rather than each device keeping its own in localStorage. GET is open to any
// signed-in account so everyone's UI reflects the shared choice; only an admin account
// can PUT a change (enforced server-side too — see app/routers/settings.py).
export function useAppSettings(session: Session | null): {
  settings: AppSettings | null
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>
} {
  const [settings, setSettings] = useState<AppSettings | null>(null)

  useEffect(() => {
    if (!session) {
      setSettings(null)
      return
    }
    let cancelled = false
    fetch(`${apiBaseUrl}/api/settings`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: AppSettings | null) => {
        if (cancelled || !body) return
        setSettings(body)
        applyTheme(body.theme)
        cacheTheme(body.theme)
      })
      .catch(() => {
        // Leaves `settings` at null — callers fall back to sane defaults rather than
        // guessing a business-wide value if the fetch failed.
      })
    return () => {
      cancelled = true
    }
  }, [session])

  async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    if (!session) throw new Error('Not signed in')
    const response = await fetch(`${apiBaseUrl}/api/settings`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(patch)
    })
    if (!response.ok) throw new Error('Request failed')
    const body: AppSettings = await response.json()
    setSettings(body)
    applyTheme(body.theme)
    cacheTheme(body.theme)
    return body
  }

  return { settings, updateSettings }
}
