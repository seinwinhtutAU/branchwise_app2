import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { Select } from '@renderer/components/ui/Select'
import { Skeleton } from '@renderer/components/ui/Skeleton'
import { ThemeSwitcher } from '@renderer/components/ui/ThemeSwitcher'
import type { Profile } from '@renderer/components/features/types'

interface Props {
  session: Session
  profile: Profile | null
  // Only an admin account can change buying price grace days (enforced server-side
  // too), so it's the only role this card renders for at all.
  isAdmin: boolean
  warningWindowDays: number
  onWarningWindowDaysChange: (days: number) => void
  showBuyingPriceSource: boolean
  onShowBuyingPriceSourceChange: (show: boolean) => void
}

const WINDOW_OPTIONS = [1, 3, 7, 14, 30]
const GRACE_DAYS_OPTIONS = [0, 7, 14, 30, 45, 60, 90]

export function SettingsPage({
  session,
  profile,
  isAdmin,
  warningWindowDays,
  onWarningWindowDaysChange,
  showBuyingPriceSource,
  onShowBuyingPriceSourceChange
}: Props): React.JSX.Element {
  const showToast = useToast()
  // Wholesale accounts never see the Warning tab (no sale/inventory/purchase data), so the
  // check-window setting has nothing to apply to for them.
  const isWholesale = profile?.role === 'wholesale'

  const [graceDays, setGraceDays] = useState<number | null>(null)
  const [savingGraceDays, setSavingGraceDays] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    let cancelled = false
    fetch(`${apiBaseUrl}/api/settings`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { stock_forward_fallback_window_days: number } | null) => {
        if (!cancelled && body) setGraceDays(body.stock_forward_fallback_window_days)
      })
      .catch(() => {
        // Leaves the control on its loading skeleton rather than guessing a value —
        // this is a shared business setting, not safe to fake if the fetch failed.
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin, session])

  async function handleGraceDaysChange(days: number): Promise<void> {
    const previous = graceDays
    setGraceDays(days)
    setSavingGraceDays(true)
    try {
      const response = await fetch(`${apiBaseUrl}/api/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ stock_forward_fallback_window_days: days })
      })
      if (!response.ok) throw new Error('Request failed')
      showToast('success', 'Buying price grace days updated')
    } catch {
      setGraceDays(previous)
      showToast('error', "Couldn't update buying price grace days")
    } finally {
      setSavingGraceDays(false)
    }
  }

  // The server value might not be one of the curated options (set via a direct API call,
  // or a future default change) — show it anyway rather than silently falling back to a
  // different option than what's actually saved.
  const graceDaysOptions =
    graceDays !== null && !GRACE_DAYS_OPTIONS.includes(graceDays)
      ? [...GRACE_DAYS_OPTIONS, graceDays].sort((a, b) => a - b)
      : GRACE_DAYS_OPTIONS

  return (
    <div className="flex flex-col gap-6">
      <CardHeader title="Settings" description="Personal preferences for this device." />

      <Card>
        <CardHeader title="Appearance" description="Choose how Branchwise looks on this device." />
        <ThemeSwitcher />
      </Card>

      {!isWholesale && (
        <Card>
          <CardHeader
            title="Daily check window"
            description="How far back the Sale and Purchase warning checks look. Inventory always checks only the latest stock snapshot, so there's nothing to configure there."
          />
          <div className="max-w-xs">
            <Select
              label="Check the last"
              value={warningWindowDays}
              onChange={(e) => onWarningWindowDaysChange(Number(e.target.value))}
            >
              {WINDOW_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  {days === 1 ? '1 day' : `${days} days`}
                </option>
              ))}
            </Select>
          </div>
        </Card>
      )}

      {!isWholesale && (
        <Card>
          <CardHeader
            title="Buying Price Source column"
            description="Show or hide the column that says where each Buying Price came from (a purchase record, a stock count, or a later recount) on the Sale and Data Overview tables. Just for this device — it doesn't change anyone else's view."
          />
          <div className="max-w-xs">
            <Select
              label="Visibility"
              value={showBuyingPriceSource ? 'shown' : 'hidden'}
              onChange={(e) => onShowBuyingPriceSourceChange(e.target.value === 'shown')}
            >
              <option value="shown">Shown</option>
              <option value="hidden">Hidden</option>
            </Select>
          </div>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader
            title="Buying price grace days"
            description="Business-wide — everyone sees the same Buying Price and Profit figures, not just this device. When a sale has no purchase or inventory buying price on record as of its own date, these are the grace days allowed before a later recount can still be used as that sale's buying price."
          />
          <div className="max-w-xs">
            {graceDays === null ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select
                label="Grace days"
                value={graceDays}
                disabled={savingGraceDays}
                onChange={(e) => handleGraceDaysChange(Number(e.target.value))}
              >
                {graceDaysOptions.map((days) => (
                  <option key={days} value={days}>
                    {days === 0 ? 'None (exact date only)' : `${days} days`}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}

export default SettingsPage
