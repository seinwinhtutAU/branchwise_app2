import { useEffect, useState } from 'react'

/**
 * A debounced string: mirrors `value` once it's sat still for `delay` ms, except an
 * empty value (the user cleared the field) applies immediately — clearing a filter
 * should never feel like it's waiting on a timer.
 *
 * For a text box or a native date input, this is what keeps a filter that's sent to the
 * server from firing a request per keystroke — a date input in particular fires
 * `change` on every segment edit (typing a year yields 0002 → 0020 → 0202 → 2026, each
 * a valid date), so fetching straight off the raw value fires one request per keystroke,
 * some for absurd multi-century windows. See DashboardPage's identical treatment of its
 * own custom date range for the original case this generalizes from.
 */
export function useSettled(value: string, delay: number): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (!value) {
      setSettled('')
      return
    }
    const timer = setTimeout(() => setSettled(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return settled
}
