import { useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import { useToast } from "@renderer/lib/useToast";
import type {
  AppSettings,
  BranchHealthWeights,
} from "@renderer/lib/appSettings";
import type { ThemeMode } from "@renderer/lib/theme";
import { Button } from "@renderer/components/ui/Button";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { Input } from "@renderer/components/ui/Input";
import { Select } from "@renderer/components/ui/Select";
import { Skeleton } from "@renderer/components/ui/Skeleton";
import {
  TableContainer,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
} from "@renderer/components/ui/Table";
import { ThemeSwitcher } from "@renderer/components/ui/ThemeSwitcher";
import type { Profile } from "@renderer/components/features/types";
import { FOREIGN_CURRENCIES } from "@renderer/components/features/wholesale/shared/currency";

interface Props {
  session: Session;
  profile: Profile | null;
  // Admins can change the basic appearance setting. Development owns the advanced
  // operational, branch, and wholesale settings (also enforced server-side).
  canManageAdvancedSettings: boolean;
  settings: AppSettings | null;
  onUpdateSettings: (patch: Partial<AppSettings>) => Promise<AppSettings>;
}

type DateFormat = "MDY" | "DMY";
const DATE_FORMAT_LABELS: Record<DateFormat, string> = {
  MDY: "Month first (MM/DD/YYYY)",
  DMY: "Day first (DD/MM/YYYY)",
};

interface BranchDateFormats {
  id: string;
  name: string;
  sale_date_format: DateFormat;
  inventory_date_format: DateFormat;
}

// A free-typed day count — text rather than type="number" so there's no native up/down
// spinner, with digits-only input and a clamp-on-commit (blur/Enter) instead of relying
// on the browser's own number validation, mirroring Pagination's page-number field.
function DayCountField({
  label,
  value,
  min,
  max,
  disabled,
  zeroMeans,
  onCommit,
}: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  disabled: boolean;
  zeroMeans?: string;
  onCommit: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value !== undefined ? String(value) : "");
  useEffect(() => {
    if (value !== undefined) setDraft(String(value));
  }, [value]);

  function commit(): void {
    if (value === undefined) return;
    const parsed = Math.trunc(Number(draft));
    if (Number.isFinite(parsed) && draft.trim() !== "") {
      const clamped = Math.min(Math.max(parsed, min), max);
      setDraft(String(clamped));
      if (clamped !== value) onCommit(clamped);
    } else {
      setDraft(String(value));
    }
  }

  const hint = zeroMeans && value === 0 ? zeroMeans : `${min}–${max} days`;

  return (
    <Input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      label={label}
      hint={hint}
      value={draft}
      disabled={disabled || value === undefined}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="max-w-xs"
    />
  );
}

// DayCountField's decimal sibling, for the Branch Health weights and Early Warning
// firing points — those are percentages and shares, not whole days, and several are
// entered as a positive number the caller stores as a negative one ("revenue falls by
// more than 10%" is easier to set than "-10").
function NumberField({
  label,
  hint,
  value,
  min,
  max,
  disabled,
  onCommit,
}: {
  label: string;
  hint: string;
  value: number | undefined;
  min: number;
  max: number;
  disabled: boolean;
  onCommit: (value: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value !== undefined ? String(value) : "");
  useEffect(() => {
    if (value !== undefined) setDraft(String(value));
  }, [value]);

  function commit(): void {
    if (value === undefined) return;
    const parsed = Number(draft);
    if (Number.isFinite(parsed) && draft.trim() !== "") {
      const clamped = Math.min(Math.max(parsed, min), max);
      setDraft(String(clamped));
      if (clamped !== value) onCommit(clamped);
    } else {
      setDraft(String(value));
    }
  }

  return (
    <Input
      type="text"
      inputMode="decimal"
      label={label}
      hint={hint}
      value={draft}
      disabled={disabled || value === undefined}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

// An exchange rate is typed and stored as a decimal string, never rounded through
// Number the way NumberField's other settings are — a wholesale order/voucher line
// keeps whatever precision was saved here, and re-parsing it through a float would
// silently lose digits off a rate like "120.123456789012".
function RateField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  disabled: boolean;
  onCommit: (value: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState(value ?? "");
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commit(): void {
    const trimmed = draft.trim();
    const parsed = Number(trimmed);
    if (trimmed !== "" && Number.isFinite(parsed) && parsed > 0) {
      if (trimmed !== value) onCommit(trimmed);
    } else {
      setDraft(value ?? "");
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-text-secondary">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-text-primary whitespace-nowrap">
          1 {label} =
        </span>
        <div className="w-36">
          <Input
            type="text"
            inputMode="decimal"
            value={draft}
            disabled={disabled}
            placeholder="0"
            onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="font-mono text-right"
          />
        </div>
        <span className="text-sm font-semibold text-text-primary whitespace-nowrap">
          MMK
        </span>
      </div>
    </div>
  );
}

const HEALTH_WEIGHT_FIELDS: {
  key: keyof BranchHealthWeights;
  label: string;
}[] = [
  { key: "sales", label: "Sales" },
  { key: "profit", label: "Profit" },
  { key: "inventory", label: "Inventory" },
  { key: "customer", label: "Customer" },
  { key: "data_quality", label: "Data Quality" },
];

type SettingsTab =
  | "general"
  | "reorder"
  | "checks"
  | "pricing"
  | "health"
  | "branches"
  | "wholesale";

// Ten stacked cards was one long scroll with no shape to it, so related settings are
// grouped and the groups are tabs — same pill control the Dashboard and Import Overview
// already use, so this reads as the app's existing pattern rather than a new one.
const SETTINGS_TABS: {
  id: SettingsTab;
  label: string;
  retailOnly?: boolean;
}[] = [
  { id: "general", label: "General" },
  { id: "reorder", label: "Reorder Buffer", retailOnly: true },
  { id: "checks", label: "Data checks", retailOnly: true },
  { id: "pricing", label: "Buying price" },
  { id: "health", label: "Branch health", retailOnly: true },
  { id: "branches", label: "Branches" },
  { id: "wholesale", label: "Wholesale" },
];

function SettingsTabBar({
  tabs,
  activeTab,
  onSelect,
}: {
  tabs: { id: SettingsTab; label: string }[];
  activeTab: SettingsTab;
  onSelect: (tab: SettingsTab) => void;
}): React.JSX.Element {
  return (
    <div
      role="tablist"
      className="flex flex-wrap gap-1 p-1 rounded-lg bg-bg-subtle w-fit"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onSelect(tab.id)}
          className={cn(
            "flex items-center gap-1.5 h-8 px-4 rounded-md text-sm font-medium transition-all duration-150",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
            activeTab === tab.id
              ? "bg-brand-subtle text-brand shadow-sm"
              : "text-text-muted hover:text-text-secondary",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function SettingsPage({
  session,
  profile,
  canManageAdvancedSettings,
  settings,
  onUpdateSettings,
}: Props): React.JSX.Element {
  const showToast = useToast();
  // Wholesale accounts never see the Warning tab (no sale/inventory/purchase data), so the
  // check-window setting has nothing to apply to for them.
  const isWholesale = profile?.role === "wholesale";
  const canManageBasicSettings =
    profile?.role === "admin" || profile?.role === "development";
  const [tab, setTab] = useState<SettingsTab>("general");

  const [branches, setBranches] = useState<BranchDateFormats[] | null>(null);
  // Tracks which specific AppSettings key (or "branch-id:field" pair) is mid-save — as a
  // set rather than one flag per field, so saving one control doesn't disable another's.
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());

  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    if (window.api?.getVersion) {
      window.api
        .getVersion()
        .then((v) => setAppVersion(v))
        .catch(() => {});
    }
  }, []);

  async function handleCheckForUpdates(): Promise<void> {
    if (!window.api?.checkForUpdates) return;
    setCheckingUpdate(true);
    try {
      const res = await window.api.checkForUpdates();
      if (res.status === "dev") {
        showToast(
          "info",
          `Running in development mode (v${res.version ?? "1.0.0"})`,
        );
      } else if (res.status === "ok") {
        if (res.updateVersion && res.updateVersion !== res.currentVersion) {
          showToast(
            "success",
            `New version v${res.updateVersion} is downloading in background...`,
          );
        } else {
          showToast(
            "success",
            `BranchWise is up to date (v${res.currentVersion})`,
          );
        }
      } else {
        showToast("error", res.message || "Failed to check for updates");
      }
    } catch {
      showToast("error", "Error checking for updates");
    } finally {
      setCheckingUpdate(false);
    }
  }

  useEffect(() => {
    if (!canManageAdvancedSettings) return;
    let cancelled = false;
    fetch(`${apiBaseUrl}/api/branches`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: BranchDateFormats[] | null) => {
        if (!cancelled && body) setBranches(body);
      })
      .catch(() => {
        // Leaves the table on its loading skeleton rather than guessing a value.
      });
    return () => {
      cancelled = true;
    };
  }, [canManageAdvancedSettings, session]);

  async function handleSettingChange<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
    successMessage: string,
    errorMessage: string,
  ): Promise<void> {
    setSavingKeys((prev) => new Set(prev).add(key));
    try {
      await onUpdateSettings({ [key]: value } as Partial<AppSettings>);
      showToast("success", successMessage);
    } catch {
      showToast("error", errorMessage);
    } finally {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function handleBranchDateFormatChange(
    branchId: string,
    field: "sale_date_format" | "inventory_date_format",
    format: DateFormat,
  ): Promise<void> {
    const fieldKey = `${branchId}:${field}`;
    const previous = branches;
    setBranches(
      (current) =>
        current?.map((b) =>
          b.id === branchId ? { ...b, [field]: format } : b,
        ) ?? current,
    );
    setSavingKeys((prev) => new Set(prev).add(fieldKey));
    try {
      const response = await fetch(`${apiBaseUrl}/api/branches/${branchId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ [field]: format }),
      });
      if (!response.ok) throw new Error("Request failed");
      showToast("success", "Branch date format updated");
    } catch {
      setBranches(previous);
      showToast("error", "Couldn't update branch date format");
    } finally {
      setSavingKeys((prev) => {
        const next = new Set(prev);
        next.delete(fieldKey);
        return next;
      });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <CardHeader
        title="Settings"
        description="Business-wide system preferences and operational parameters."
      />

      {canManageBasicSettings && (
        <SettingsTabBar
          tabs={(canManageAdvancedSettings ? SETTINGS_TABS : SETTINGS_TABS.filter((option) => option.id === "general")).filter(
            (option) => !option.retailOnly || !isWholesale,
          )}
          activeTab={tab}
          onSelect={setTab}
        />
      )}

      {!canManageBasicSettings && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader
              title="Admin Access Required"
              description="These business-wide settings can only be modified by an administrator."
            />
          </Card>

          <Card>
            <CardHeader
              title="Application & Updates"
              description="Desktop software version and automatic update checks."
            />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-raised text-brand font-bold text-sm">
                  BW
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    BranchWise Desktop
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Version:{" "}
                    <span className="font-mono font-medium text-text-secondary">
                      {appVersion ? `v${appVersion}` : "Web"}
                    </span>
                  </p>
                </div>
              </div>

              {window.api && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCheckForUpdates}
                  disabled={checkingUpdate}
                >
                  {checkingUpdate
                    ? "Checking for updates..."
                    : "Check for Updates"}
                </Button>
              )}
            </div>
          </Card>
        </div>
      )}

      {canManageBasicSettings && tab === "general" && (
        <>
          <Card>
            <CardHeader
              title="Appearance"
              description="Select the interface color theme across all devices."
            />
            <ThemeSwitcher
              theme={settings?.theme ?? "system"}
              disabled={!settings || savingKeys.has("theme")}
              onThemeChange={(theme: ThemeMode) =>
                handleSettingChange(
                  "theme",
                  theme,
                  "Theme updated",
                  "Couldn't update theme",
                )
              }
            />
          </Card>

          <Card>
            <CardHeader
              title="Application & Updates"
              description="Desktop software version and automatic update checks."
            />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-bg-raised text-brand font-bold text-sm">
                  BW
                </div>
                <div>
                  <p className="text-sm font-semibold text-text-primary">
                    BranchWise Desktop
                  </p>
                  <p className="text-xs text-text-muted mt-0.5">
                    Version:{" "}
                    <span className="font-mono font-medium text-text-secondary">
                      {appVersion ? `v${appVersion}` : "Web"}
                    </span>
                  </p>
                </div>
              </div>

              {window.api && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleCheckForUpdates}
                  disabled={checkingUpdate}
                >
                  {checkingUpdate
                    ? "Checking for updates..."
                    : "Check for Updates"}
                </Button>
              )}
            </div>
          </Card>
        </>
      )}

      {canManageAdvancedSettings && !isWholesale && tab === "reorder" && (
        <Card>
          <CardHeader
            title="ABC Inventory Buffer Months"
            description="Target stock buffer coverage in months for replenishment calculations across ABC tiers."
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              {!settings ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <NumberField
                  label="A-Tier (Core fast-movers)"
                  hint="months (default: 3.0)"
                  value={settings.purchasing_buffer_months?.a ?? 3.0}
                  min={0.1}
                  max={24}
                  disabled={savingKeys.has("purchasing_buffer_months")}
                  onCommit={(val) =>
                    handleSettingChange(
                      "purchasing_buffer_months",
                      {
                        ...settings.purchasing_buffer_months,
                        a: val,
                      },
                      "A-tier stock buffer updated",
                      "Couldn't update A-tier stock buffer",
                    )
                  }
                />
              )}
            </div>

            <div>
              {!settings ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <NumberField
                  label="B-Tier (Mid-tier steady sellers)"
                  hint="months (default: 2.5)"
                  value={settings.purchasing_buffer_months?.b ?? 2.5}
                  min={0.1}
                  max={24}
                  disabled={savingKeys.has("purchasing_buffer_months")}
                  onCommit={(val) =>
                    handleSettingChange(
                      "purchasing_buffer_months",
                      {
                        ...settings.purchasing_buffer_months,
                        b: val,
                      },
                      "B-tier stock buffer updated",
                      "Couldn't update B-tier stock buffer",
                    )
                  }
                />
              )}
            </div>

            <div>
              {!settings ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <NumberField
                  label="C-Tier (Long-tail items)"
                  hint="months (default: 1.0)"
                  value={settings.purchasing_buffer_months?.c ?? 1.0}
                  min={0.1}
                  max={24}
                  disabled={savingKeys.has("purchasing_buffer_months")}
                  onCommit={(val) =>
                    handleSettingChange(
                      "purchasing_buffer_months",
                      {
                        ...settings.purchasing_buffer_months,
                        c: val,
                      },
                      "C-tier stock buffer updated",
                      "Couldn't update C-tier stock buffer",
                    )
                  }
                />
              )}
            </div>
          </div>
        </Card>
      )}

      {canManageAdvancedSettings && !isWholesale && tab === "checks" && (
        <>
          <Card>
            <CardHeader
              title="Daily check cutoff time (Shop Close)"
              description="The shop closing time after which daily import checks run and physical stock audit sheets unlock."
            />
            <div className="max-w-xs">
              {!settings ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="custom-cutoff-time"
                    className="text-sm font-medium text-text-secondary"
                  >
                    Cutoff time
                  </label>
                  <input
                    id="custom-cutoff-time"
                    type="time"
                    value={settings.daily_check_cutoff_time ?? "20:00"}
                    disabled={savingKeys.has("daily_check_cutoff_time")}
                    onChange={(e) => {
                      if (e.target.value) {
                        handleSettingChange(
                          "daily_check_cutoff_time",
                          e.target.value,
                          "Daily check cutoff time updated",
                          "Couldn't update daily check cutoff time",
                        );
                      }
                    }}
                    className="h-10 w-full rounded-md border border-border bg-bg-base px-3 text-sm text-text-primary transition-all duration-150 hover:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base disabled:cursor-not-allowed disabled:bg-bg-subtle disabled:opacity-50"
                  />
                  <p className="text-xs text-text-muted">
                    Default is 20:00 (8:00 PM). You can select any time.
                  </p>
                </div>
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Daily check windows"
              description="Number of lookback days for automated sale and purchase anomaly checks."
            />
            <div className="flex flex-col gap-4">
              <div className="max-w-xs">
                {!settings ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <DayCountField
                    label="Sale — check the last"
                    value={settings.sale_warning_window_days}
                    min={1}
                    max={365}
                    disabled={savingKeys.has("sale_warning_window_days")}
                    onCommit={(days) =>
                      handleSettingChange(
                        "sale_warning_window_days",
                        days,
                        "Sale check window updated",
                        "Couldn't update sale check window",
                      )
                    }
                  />
                )}
              </div>
              <div className="max-w-xs">
                {!settings ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <DayCountField
                    label="Purchase — check the last"
                    value={settings.purchase_warning_window_days}
                    min={1}
                    max={365}
                    disabled={savingKeys.has("purchase_warning_window_days")}
                    onCommit={(days) =>
                      handleSettingChange(
                        "purchase_warning_window_days",
                        days,
                        "Purchase check window updated",
                        "Couldn't update purchase check window",
                      )
                    }
                  />
                )}
              </div>
            </div>
          </Card>
        </>
      )}

      {canManageAdvancedSettings && !isWholesale && tab === "general" && (
        <Card>
          <CardHeader
            title="Sale & Purchase list default range"
            description="Default date range loaded upon opening Sale and Purchase list pages."
          />
          <div className="flex flex-col gap-4">
            <div className="max-w-xs">
              {!settings ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <DayCountField
                  label="Sale — show the last"
                  value={settings.sale_list_window_days}
                  min={1}
                  max={365}
                  disabled={savingKeys.has("sale_list_window_days")}
                  onCommit={(days) =>
                    handleSettingChange(
                      "sale_list_window_days",
                      days,
                      "Sale list default range updated",
                      "Couldn't update sale list default range",
                    )
                  }
                />
              )}
            </div>
            <div className="max-w-xs">
              {!settings ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <DayCountField
                  label="Purchase — show the last"
                  value={settings.purchase_list_window_days}
                  min={1}
                  max={365}
                  disabled={savingKeys.has("purchase_list_window_days")}
                  onCommit={(days) =>
                    handleSettingChange(
                      "purchase_list_window_days",
                      days,
                      "Purchase list default range updated",
                      "Couldn't update purchase list default range",
                    )
                  }
                />
              )}
            </div>
          </div>
        </Card>
      )}

      {canManageAdvancedSettings && !isWholesale && tab === "general" && (
        <Card>
          <CardHeader
            title="Buying Price Source column"
            description="Display the buying price source column on sale and data tables."
          />
          <div className="max-w-xs">
            {!settings ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <Select
                label="Visibility"
                value={settings.show_buying_price_source ? "shown" : "hidden"}
                disabled={savingKeys.has("show_buying_price_source")}
                onChange={(e) =>
                  handleSettingChange(
                    "show_buying_price_source",
                    e.target.value === "shown",
                    "Buying Price Source column visibility updated",
                    "Couldn't update column visibility",
                  )
                }
              >
                <option value="shown">Shown</option>
                <option value="hidden">Hidden</option>
              </Select>
            )}
          </div>
        </Card>
      )}

      {canManageAdvancedSettings && tab === "pricing" && (
        <Card>
          <CardHeader
            title="Purchase price lookback days"
            description="Maximum days before a sale to use a purchase record for cost matching."
          />
          <div className="max-w-xs">
            {!settings ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <DayCountField
                label="Lookback days"
                value={settings.purchase_lookback_window_days}
                min={0}
                max={365}
                zeroMeans="None (exact date only)"
                disabled={savingKeys.has("purchase_lookback_window_days")}
                onCommit={(days) =>
                  handleSettingChange(
                    "purchase_lookback_window_days",
                    days,
                    "Purchase price lookback days updated",
                    "Couldn't update purchase price lookback days",
                  )
                }
              />
            )}
          </div>
        </Card>
      )}

      {canManageAdvancedSettings && tab === "pricing" && (
        <Card>
          <CardHeader
            title="Inventory price lookback days"
            description="Maximum days before a sale to use an inventory snapshot for cost matching."
          />
          <div className="max-w-xs">
            {!settings ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <DayCountField
                label="Lookback days"
                value={settings.stock_lookback_window_days}
                min={0}
                max={365}
                zeroMeans="None (exact date only)"
                disabled={savingKeys.has("stock_lookback_window_days")}
                onCommit={(days) =>
                  handleSettingChange(
                    "stock_lookback_window_days",
                    days,
                    "Inventory price lookback days updated",
                    "Couldn't update inventory price lookback days",
                  )
                }
              />
            )}
          </div>
        </Card>
      )}

      {canManageAdvancedSettings && tab === "pricing" && (
        <Card>
          <CardHeader
            title="Inventory price forward days"
            description="Maximum days after a sale to fall back to an inventory snapshot for cost matching."
          />
          <div className="max-w-xs">
            {!settings ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <DayCountField
                label="Forward days"
                value={settings.stock_forward_fallback_window_days}
                min={0}
                max={365}
                zeroMeans="None (exact date only)"
                disabled={savingKeys.has("stock_forward_fallback_window_days")}
                onCommit={(days) =>
                  handleSettingChange(
                    "stock_forward_fallback_window_days",
                    days,
                    "Inventory price forward days updated",
                    "Couldn't update inventory price forward days",
                  )
                }
              />
            )}
          </div>
        </Card>
      )}

      {canManageAdvancedSettings && !isWholesale && tab === "health" && (
        <Card>
          <CardHeader
            title="Branch health weights"
            description="Weight distribution for calculating overall branch health scores."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {HEALTH_WEIGHT_FIELDS.map((field) => (
              <div key={field.key}>
                {!settings ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <NumberField
                    label={field.label}
                    hint="% of the score"
                    // Stored as a fraction, shown as a percentage — nobody reasons
                    // about a weight of 0.25.
                    value={
                      Math.round(
                        settings.branch_health_weights[field.key] * 1000,
                      ) / 10
                    }
                    min={0}
                    max={100}
                    disabled={savingKeys.has("branch_health_weights")}
                    onCommit={(percent) =>
                      handleSettingChange(
                        "branch_health_weights",
                        {
                          ...settings.branch_health_weights,
                          [field.key]: percent / 100,
                        },
                        "Branch health weights updated",
                        "Couldn't update branch health weights",
                      )
                    }
                  />
                )}
              </div>
            ))}
          </div>
          {settings && (
            <p className="text-sm text-text-muted mt-4">
              Currently adding up to{" "}
              <span className="font-medium text-text-secondary tabular-nums">
                {Math.round(
                  Object.values(settings.branch_health_weights).reduce(
                    (sum, weight) => sum + weight,
                    0,
                  ) * 100,
                )}
                %
              </span>
              .
            </p>
          )}
        </Card>
      )}

      {canManageAdvancedSettings && tab === "branches" && (
        <Card>
          <CardHeader
            title="Branch date formats"
            description="Date order format (MDY or DMY) used when parsing branch POS reports."
          />
          {branches === null ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <TableContainer>
              <Thead>
                <Tr>
                  <Th className="w-10 sm:w-12 text-center text-text-muted font-normal select-none">
                    #
                  </Th>
                  <Th>Branch</Th>
                  <Th>Sale date format</Th>
                  <Th>Inventory date format</Th>
                </Tr>
              </Thead>
              <Tbody>
                {branches.map((branch, index) => (
                  <Tr key={branch.id}>
                    <Td className="text-center text-xs font-mono text-text-muted tabular-nums select-none">
                      {index + 1}
                    </Td>
                    <Td>{branch.name}</Td>
                    <Td>
                      <Select
                        aria-label={`${branch.name} sale date format`}
                        value={branch.sale_date_format}
                        disabled={savingKeys.has(
                          `${branch.id}:sale_date_format`,
                        )}
                        onChange={(e) =>
                          handleBranchDateFormatChange(
                            branch.id,
                            "sale_date_format",
                            e.target.value as DateFormat,
                          )
                        }
                      >
                        {(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map(
                          (format) => (
                            <option key={format} value={format}>
                              {DATE_FORMAT_LABELS[format]}
                            </option>
                          ),
                        )}
                      </Select>
                    </Td>
                    <Td>
                      <Select
                        aria-label={`${branch.name} inventory date format`}
                        value={branch.inventory_date_format}
                        disabled={savingKeys.has(
                          `${branch.id}:inventory_date_format`,
                        )}
                        onChange={(e) =>
                          handleBranchDateFormatChange(
                            branch.id,
                            "inventory_date_format",
                            e.target.value as DateFormat,
                          )
                        }
                      >
                        {(Object.keys(DATE_FORMAT_LABELS) as DateFormat[]).map(
                          (format) => (
                            <option key={format} value={format}>
                              {DATE_FORMAT_LABELS[format]}
                            </option>
                          ),
                        )}
                      </Select>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </TableContainer>
          )}
        </Card>
      )}

      {canManageAdvancedSettings && tab === "wholesale" && (
        <Card>
          <CardHeader
            title="Exchange rates"
            description="Current MMK exchange rates used to prefill new foreign currency transactions."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FOREIGN_CURRENCIES.map((code) => (
              <div key={code}>
                {!settings ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <RateField
                    label={code}
                    value={settings.today_exchange_rates[code]}
                    disabled={savingKeys.has("today_exchange_rates")}
                    onCommit={(rate) =>
                      handleSettingChange(
                        "today_exchange_rates",
                        { ...settings.today_exchange_rates, [code]: rate },
                        `${code} rate updated`,
                        `Couldn't update the ${code} rate`,
                      )
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default SettingsPage;
