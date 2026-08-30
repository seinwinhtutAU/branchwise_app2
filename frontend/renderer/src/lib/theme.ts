export type ThemeMode = 'light' | 'dark' | 'system'

const CACHE_KEY = 'branchwise-theme-cache'

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

// Theme is a business-wide setting now (see lib/appSettings.ts) — this cache is NOT the
// source of truth, just the last value fetched from GET /api/settings, kept in
// localStorage so main.tsx can apply it synchronously before that fetch resolves,
// avoiding a flash of the wrong theme while the app boots.
export function getCachedTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(CACHE_KEY)
    return isThemeMode(stored) ? stored : 'system'
  } catch {
    return 'system'
  }
}

export function cacheTheme(theme: ThemeMode): void {
  try {
    localStorage.setItem(CACHE_KEY, theme)
  } catch {
    // Best-effort — only affects how quickly the correct theme appears on next boot.
  }
}

// 'system' means no explicit override — globals.css already falls back to
// prefers-color-scheme when `data-theme` isn't set, so removing the attribute here is
// enough to hand control back to the OS setting.
export function applyTheme(theme: ThemeMode): void {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}
