import type { ReactNode } from "react";
import { SunIcon, MoonIcon, MonitorIcon } from "@renderer/components/ui/icons";
import type { ThemeMode } from "@renderer/lib/theme";

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: ReactNode }[] = [
  { value: "light", label: "Light", icon: <SunIcon className="w-4 h-4" /> },
  { value: "dark", label: "Dark", icon: <MoonIcon className="w-4 h-4" /> },
  {
    value: "system",
    label: "System",
    icon: <MonitorIcon className="w-4 h-4" />,
  },
];

interface Props {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  disabled?: boolean;
}

// Business-wide now (see lib/appSettings.ts) — controlled by the caller instead of
// managing its own storage, since applying the change (and persisting it) is now an
// admin-only PUT /api/settings, not a same-device write.
export function ThemeSwitcher({
  theme,
  onThemeChange,
  disabled,
}: Props): React.JSX.Element {
  return (
    <div
      className="flex items-center gap-1 rounded-md bg-bg-raised p-1 w-fit"
      role="group"
      aria-label="Theme"
    >
      {THEME_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          title={opt.label}
          aria-label={opt.label}
          aria-pressed={theme === opt.value}
          disabled={disabled}
          onClick={() => onThemeChange(opt.value)}
          className={`flex items-center gap-1.5 h-8 px-3 rounded-sm text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50 disabled:cursor-not-allowed ${
            theme === opt.value
              ? "bg-bg-base text-brand shadow-xs"
              : "text-text-muted hover:text-text-secondary"
          }`}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
