import { Card, CardHeader } from '@renderer/components/ui/Card'
import { Select } from '@renderer/components/ui/Select'
import { ThemeSwitcher } from '@renderer/components/ui/ThemeSwitcher'
import type { Profile } from '@renderer/components/features/types'

interface Props {
  profile: Profile | null
  warningWindowDays: number
  onWarningWindowDaysChange: (days: number) => void
}

const WINDOW_OPTIONS = [1, 3, 7, 14, 30]

export function SettingsPage({ profile, warningWindowDays, onWarningWindowDaysChange }: Props): React.JSX.Element {
  // Wholesale accounts never see the Warning tab (no sale/inventory/purchase data), so the
  // check-window setting has nothing to apply to for them.
  const isWholesale = profile?.role === 'wholesale'

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
    </div>
  )
}

export default SettingsPage
