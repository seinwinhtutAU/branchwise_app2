import { useEffect, useState } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'branchwise-theme'

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function getStoredTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isThemeMode(stored) ? stored : 'system'
  } catch {
    return 'system'
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

export function useTheme(): [ThemeMode, (theme: ThemeMode) => void] {
  const [theme, setThemeState] = useState<ThemeMode>(getStoredTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  function setTheme(next: ThemeMode): void {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Best-effort — the theme still applies for this session even if storage is unavailable.
    }
  }

  return [theme, setTheme]
}
