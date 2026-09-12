import { useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import { useToast } from "@renderer/lib/useToast";
import type {
  AppSettings,
  BranchHealthWeights,
  EarlyWarningThresholds,
} from "@renderer/lib/appSettings";
import type { ThemeMode } from "@renderer/lib/theme";
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

interface Props {
  session: Session;
  profile: Profile | null;
  // Every AppSettings field below is business-wide (app_settings table) — only an admin
  // account can change any of them (enforced server-side too), so their cards only
  // render for admin. `settings` is null until the fetch resolves.
  isAdmin: boolean;
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

// `negative: true` means the field is shown as a positive number and stored as its
// negative — "revenue falls by more than 10%" rather than asking anyone to type "-10".
const WARNING_THRESHOLD_FIELDS: {
  key: keyof EarlyWarningThresholds;
  label: string;
  hint: string;
  negative?: boolean;
}[] = [
  {
    key: "revenue_decline_normal_pct",
    label: "Revenue normal — falls more than",
    hint: "%",
    negative: true,
  },
  {
    key: "revenue_decline_warning_pct",
    label: "Revenue warning — falls more than",
    hint: "%",
    negative: true,
  },
  {
    key: "revenue_decline_critical_pct",
    label: "Revenue critical — falls more than",
    hint: "%",
    negative: true,
  },
  { key: "low_margin_normal_pct", label: "Margin normal — below", hint: "%" },
  { key: "low_margin_warning_pct", label: "Margin warning — below", hint: "%" },
  {
    key: "low_margin_critical_pct",
    label: "Margin critical — below",
    hint: "%",
  },
  {
    key: "margin_slip_normal_pp",
    label: "Margin slip normal — falls more than",
    hint: "%",
    negative: true,
  },
  {
    key: "margin_slip_warning_pp",
    label: "Margin slip warning — falls more than",
    hint: "%",
    negative: true,
  },
  {
    key: "dead_stock_normal_share_pct",
    label: "Dead stock normal — above",
    hint: "% of products",
  },
  {
    key: "dead_stock_warning_share_pct",
    label: "Dead stock warning — above",
    hint: "% of products",
  },
  {
    key: "dead_stock_critical_share_pct",
    label: "Dead stock critical — above",
    hint: "% of products",
  },
  {
    key: "traffic_decline_warning_pct",
    label: "Footfall warning — visits fall more than",
    hint: "%",
    negative: true,
  },
];

type SettingsTab = "general" | "checks" | "pricing" | "health" | "branches";

// Ten stacked cards was one long scroll with no shape to it, so related settings are
// grouped and the groups are tabs — same pill control the Dashboard and Import Overview
// already use, so this reads as the app's existing pattern rather than a new one.
const SETTINGS_TABS: {
  id: SettingsTab;
  label: string;
  retailOnly?: boolean;
}[] = [
  { id: "general", label: "General" },
  { id: "checks", label: "Data checks", retailOnly: true },
  { id: "pricing", label: "Buying price" },
  { id: "health", label: "Branch health", retailOnly: true },
  { id: "branches", label: "Branches" },
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
  isAdmin,
  settings,
  onUpdateSettings,
}: Props): React.JSX.Element {
  const showToast = useToast();
  // Wholesale accounts never see the Warning tab (no sale/inventory/purchase data), so the
  // check-window setting has nothing to apply to for them.
  const isWholesale = profile?.role === "wholesale";
  const [tab, setTab] = useState<SettingsTab>("general");

  const [branches, setBranches] = useState<BranchDateFormats[] | null>(null);
  // Tracks which specific AppSettings key (or "branch-id:field" pair) is mid-save — as a
  // set rather than one flag per field, so saving one control doesn't disable another's.
  const [savingKeys, setSavingKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isAdmin) return;
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
  }, [isAdmin, session]);

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
        description="Business-wide preferences — the same for every account and every device."
      />

      {isAdmin && (
        <SettingsTabBar
          tabs={SETTINGS_TABS.filter(
            (option) => !option.retailOnly || !isWholesale,
          )}
          activeTab={tab}
          onSelect={setTab}
        />
      )}

      {!isAdmin && (
        <Card>
          <CardHeader
            title="Nothing to configure here"
            description="These settings (theme, check windows, pricing windows) are business-wide — ask an admin account to change them."
          />
        </Card>
      )}

      {isAdmin && tab === "general" && (
        <Card>
          <CardHeader
            title="Appearance"
            description="Business-wide — applies to every signed-in account."
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
      )}

      {isAdmin && !isWholesale && tab === "checks" && (
        <Card>
          <CardHeader
            title="Daily check windows"
            description="How far back the Sale and Purchase warning checks each look — independently of each other. Inventory always checks only the latest stock snapshot, so there's nothing to configure there."
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
      )}

      {isAdmin && !isWholesale && tab === "general" && (
        <Card>
          <CardHeader
            title="Sale & Purchase list default range"
            description="How far back the Sale and Purchase pages (left nav) load by default — independently of each other. Older rows aren't hidden, just not loaded until you widen or clear the date filter on that page."
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

      {isAdmin && !isWholesale && tab === "general" && (
        <Card>
          <CardHeader
            title="Buying Price Source column"
            description="Show or hide the column that says where each Buying Price came from (a purchase record, a stock count, or a later recount) on the Sale and Data Overview tables — for every account."
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

      {isAdmin && tab === "pricing" && (
        <Card>
          <CardHeader
            title="Purchase price lookback days"
            description="When pricing a sale, a purchase record's buying price is only used if it's dated no more than this many days before the sale — an older purchase price is treated as too stale to trust, and the lookup falls through to inventory instead."
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

      {isAdmin && tab === "pricing" && (
        <Card>
          <CardHeader
            title="Inventory price lookback days"
            description="When pricing a sale that has no usable purchase price, an inventory snapshot's buying price is only used if it's dated no more than this many days before the sale — an older snapshot is treated as too stale to trust, and the lookup falls through to the inventory price forward days recount fallback instead."
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

      {isAdmin && tab === "pricing" && (
        <Card>
          <CardHeader
            title="Inventory price forward days"
            description="When a sale has no purchase or inventory buying price on record within their own lookback windows, an inventory snapshot recorded up to this many days after the sale can still be used as that sale's buying price."
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

      {isAdmin && !isWholesale && tab === "health" && (
        <Card>
          <CardHeader
            title="Branch health weights"
            description="How much each part of the Dashboard's Overview score counts. They don't have to add up to 100% — the score always divides by whatever could actually be measured for the branch and period on screen — but keeping them close to it makes the numbers easier to read."
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

      {isAdmin && !isWholesale && tab === "health" && (
        <Card>
          <CardHeader
            title="Early warning thresholds"
            description="When each alert is raised. Normal is a notice that needs no decision, warning needs a decision but you choose when, critical needs one now. Lower the numbers to hear about problems sooner; raise them to only be told about the serious ones."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {WARNING_THRESHOLD_FIELDS.map((field) => (
              <div key={field.key}>
                {!settings ? (
                  <Skeleton className="h-10 w-full" />
                ) : (
                  <NumberField
                    label={field.label}
                    hint={field.hint}
                    value={Math.abs(
                      settings.early_warning_thresholds[field.key],
                    )}
                    min={0}
                    max={100}
                    disabled={savingKeys.has("early_warning_thresholds")}
                    onCommit={(entered) =>
                      handleSettingChange(
                        "early_warning_thresholds",
                        {
                          ...settings.early_warning_thresholds,
                          [field.key]: field.negative ? -entered : entered,
                        },
                        "Early warning thresholds updated",
                        "Couldn't update early warning thresholds",
                      )
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {isAdmin && tab === "branches" && (
        <Card>
          <CardHeader
            title="Branch date formats"
            description={`Per branch, not business-wide — different branches' POS terminals can print dates in a different order. For Sale, each file's own dates settle month-first vs day-first automatically whenever any date in it is decisive (e.g. day 13 or higher can't be a month); a branch's setting here only applies to the rare file where every date is ambiguous throughout. Inventory has just one date per file (the report's own "Printed" timestamp), which is essentially never decisive on its own, so a branch's Inventory setting here is used directly, for every one of its files.`}
          />
          {branches === null ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <TableContainer>
              <Thead>
                <Tr>
                  <Th>Branch</Th>
                  <Th>Sale date format</Th>
                  <Th>Inventory date format</Th>
                </Tr>
              </Thead>
              <Tbody>
                {branches.map((branch) => (
                  <Tr key={branch.id}>
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
    </div>
  );
}

export default SettingsPage;
