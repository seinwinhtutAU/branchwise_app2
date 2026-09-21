import { useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { applyTheme, cacheTheme, type ThemeMode } from "@renderer/lib/theme";
import { invalidateEverything } from "@renderer/lib/queryClient";

// The Branch Health Score's dimension weights are stored and updated as a whole set,
// since a weight only has meaning relative to the other four.
export interface BranchHealthWeights {
  sales: number;
  profit: number;
  inventory: number;
  customer: number;
  data_quality: number;
}

export interface PurchasingBufferMonths {
  a: number;
  b: number;
  c: number;
}

export interface AppSettings {
  stock_forward_fallback_window_days: number;
  purchase_lookback_window_days: number;
  stock_lookback_window_days: number;
  theme: ThemeMode;
  sale_warning_window_days: number;
  purchase_warning_window_days: number;
  sale_list_window_days: number;
  purchase_list_window_days: number;
  show_buying_price_source: boolean;
  daily_check_cutoff_time: string;
  branch_health_weights: BranchHealthWeights;
  purchasing_buffer_months: PurchasingBufferMonths;
  // Today's MMK rate for each non-MMK currency the wholesale screens deal in — MMK per
  // 1 unit of that currency, e.g. { THB: "120.000000000000" }. Only prefills a new
  // foreign-currency order/voucher line or receiving cost; a saved line keeps its own
  // rate forever (see app/services/wholesale/currency.py). Values are decimal strings,
  // not numbers, so a precise rate survives the round trip exactly.
  today_exchange_rates: Record<string, string>;
}

// Business-wide preferences (theme, check/list windows, column visibility, pricing
// windows) — one shared value in the `app_settings` table for every account and every
// device, rather than each device keeping its own in localStorage. GET is open to any
// signed-in account so everyone's UI reflects the shared choice; only an admin account
// can PUT a change (enforced server-side too — see app/routers/settings.py).
export function useAppSettings(session: Session | null): {
  settings: AppSettings | null;
  updateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
} {
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    if (!session) {
      setSettings(null);
      // Nobody is signed in, so the sign-in screen is what's on screen — and it should
      // be painted in the business's theme rather than in whatever this device last
      // cached (nothing, on a fresh install) or the operating system's. GET
      // /api/settings/theme is the one unauthenticated settings route, returning that
      // single key. Failing silently is correct here: without a backend the cached or
      // system theme is still the best guess available, and a sign-in screen must never
      // depend on the backend being up.
      let publicCancelled = false;
      fetch(`${apiBaseUrl}/api/settings/theme`)
        .then((r) => (r.ok ? r.json() : null))
        .then((body: { theme: ThemeMode } | null) => {
          if (publicCancelled || !body) return;
          applyTheme(body.theme);
          cacheTheme(body.theme);
        })
        .catch(() => {});
      return () => {
        publicCancelled = true;
      };
    }
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/settings`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: AppSettings | null) => {
        if (cancelled || !body) return;
        setSettings(body);
        applyTheme(body.theme);
        cacheTheme(body.theme);
      })
      .catch(() => {
        // Leaves `settings` at null — callers fall back to sane defaults rather than
        // guessing a business-wide value if the fetch failed.
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function updateSettings(
    patch: Partial<AppSettings>,
  ): Promise<AppSettings> {
    if (!session) throw new Error("Not signed in");
    const response = await fetch(`${apiBaseUrl}/api/settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(patch),
    });
    if (!response.ok) throw new Error("Request failed");
    const body: AppSettings = await response.json();
    setSettings(body);
    applyTheme(body.theme);
    cacheTheme(body.theme);
    // Every setting except the theme changes what the server computes for pages this app
    // has already cached — the health weights change every score, a threshold changes
    // which alerts exist at all, a window changes what the Warning page and the
    // sale/purchase lists count. Without this, an admin could save a new weight and go
    // back to a dashboard still showing yesterday's scores, for up to a day. The theme is
    // excluded because it changes only how the page is painted.
    if (Object.keys(patch).some((key) => key !== "theme"))
      invalidateEverything();
    return body;
  }

  return { settings, updateSettings };
}
