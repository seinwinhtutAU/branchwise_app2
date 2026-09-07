import { useConnectionStatus } from '@renderer/lib/connection'

/**
 * A single line across the top of the app when the connection is not carrying requests
 * properly.
 *
 * The branch machines this runs on are often on a slow or intermittent link, and the
 * data lives in Neon rather than on the machine. Without this, a bad connection looked
 * like a broken app: pages sitting on skeletons, a pile of red "Failed to load" toasts,
 * and no way to tell "the internet is down" from "the numbers are wrong". Saying it once,
 * plainly, at the top, lets every page below fall back to its saved data quietly.
 *
 * It renders nothing when things are fine, which is the normal case.
 */
export function ConnectionBanner(): React.JSX.Element | null {
  const status = useConnectionStatus()
  if (status === 'online') return null

  const offline = status === 'offline'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center gap-2 px-4 sm:px-6 py-2 text-sm border-b ${
        offline
          ? 'bg-error-subtle text-error border-error/20'
          : 'bg-warning-subtle text-warning border-warning/20'
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${offline ? 'bg-error' : 'bg-warning animate-pulse motion-reduce:animate-none'}`}
        aria-hidden="true"
      />
      <span>
        {offline
          ? 'No connection — showing the last saved data. Reconnecting automatically; new imports will need to wait.'
          : 'Loading is slow right now — pages may take longer than usual.'}
      </span>
    </div>
  )
}
