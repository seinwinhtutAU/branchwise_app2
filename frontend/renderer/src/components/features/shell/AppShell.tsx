import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Badge } from "@renderer/components/ui/Badge";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LogOutIcon,
  StoreIcon,
  FactoryIcon,
  SettingsIcon,
  SwapIcon,
} from "@renderer/components/ui/icons";
import { LogoChip, LogoWordmark } from "@renderer/components/ui/Logo";
import type { Profile } from "@renderer/components/features/types";
import {
  NetworkStatusDetails,
  NetworkStatusDot,
} from "@renderer/components/features/shell/NetworkIndicator";

export interface NavItem {
  id: string;
  label: string;
  /** Shown instead of `label` when the sidebar is collapsed — a 72px rail has no room
   *  for "Supplier Vouchers". Falls back to `label`. */
  shortLabel?: string;
  icon: ReactNode;
  dotColor?: string;
  badgeCount?: number;
}

export interface WorkspaceTab {
  id: string;
  label: string;
  badgeCount?: number;
  // Which accent the tab gets when active — omit for the neutral default. Reuses the same
  // brand/info vocabulary as roleBadgeVariant below so a workspace's color matches its
  // role badge elsewhere in the UI (e.g. wholesale is 'info' in both places).
  color?: "brand" | "info";
  icon?: ReactNode;
}

interface AppShellProps {
  navItems: NavItem[];
  activeSection: string;
  onSectionChange: (id: string) => void;
  // Only rendered when there's more than one workspace to switch between — a
  // role scoped to a single workspace (retail-only, wholesale-only) never needs
  // the control, since there's nothing to switch to.
  workspaces?: WorkspaceTab[];
  activeWorkspace?: string;
  onWorkspaceChange?: (id: string) => void;
  email: string | null | undefined;
  profile: Profile | null;
  onSignOut: () => void;
  children: ReactNode;
  debugAction?: { label: string; onClick: () => void };
  debugResult?: string | null;
}

const roleBadgeVariant: Record<string, "brand" | "info" | "default"> = {
  development: "brand",
  admin: "brand",
  retail_management: "brand",
  wholesale: "brand",
  retail: "default",
};

const roleLabels: Record<string, string> = {
  development: "Development",
  admin: "Admin",
  retail_management: "Retail management",
  wholesale: "Wholesale user",
  retail: "Retail user",
};

const workspaceActiveClasses: Record<"brand" | "info", string> = {
  brand: "bg-brand text-white shadow-sm",
  info: "bg-info text-white shadow-sm",
};

const SIDEBAR_STORAGE_KEY = "branchwise:sidebarCollapsed";

function accountInitials(
  profile: Profile | null,
  email: string | null | undefined,
): string {
  const name = profile?.name?.trim() || email?.split("@")[0]?.trim() || "User";
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  const compact = name.replace(/[^a-zA-Z0-9]/g, "");
  if (compact.length <= 1) return compact.toUpperCase() || "U";
  return (compact[0] + compact[compact.length - 1]).toUpperCase();
}

// Layout wrapper — no skeleton/empty state (exempt per rubric).
export function AppShell({
  navItems,
  activeSection,
  onSectionChange,
  workspaces = [],
  activeWorkspace,
  onWorkspaceChange,
  email,
  profile,
  onSignOut,
  children,
  debugAction,
  debugResult,
}: AppShellProps): React.JSX.Element {
  const isMac = typeof window !== "undefined" && Boolean(window.api?.isMac);
  const isWindows =
    typeof window !== "undefined" && Boolean(window.api?.isWindows);
  // Windows needs a renderer-owned title bar because its native controls are
  // hidden into the overlay. macOS keeps the native title bar so traffic lights
  // never sit on top of the app content.
  const hasCustomTitleBar = isWindows;

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const currentSectionLabel = useMemo(() => {
    if (activeSection === "settings") return "Settings";
    const item = navItems.find((n) => n.id === activeSection);
    if (item) return item.label;
    return activeSection.charAt(0).toUpperCase() + activeSection.slice(1);
  }, [activeSection, navItems]);

  useEffect(() => {
    if (!accountMenuOpen) return;

    function handlePointer(event: PointerEvent): void {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    }

    function handleFocus(event: FocusEvent): void {
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(event.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    }

    function handleKey(event: KeyboardEvent): void {
      if (event.key === "Escape") setAccountMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointer, true);
    document.addEventListener("focusin", handleFocus);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("pointerdown", handlePointer, true);
      document.removeEventListener("focusin", handleFocus);
      document.removeEventListener("keydown", handleKey);
    };
  }, [accountMenuOpen]);

  function handleToggleCollapse(): void {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
      } catch {
        // Storage might fail in restricted sandbox, ignore
      }
      return next;
    });
  }

  // Listen to menu actions and custom shortcut triggers
  useEffect(() => {
    const handleToggle = (): void => {
      handleToggleCollapse();
    };

    window.addEventListener("branchwise:toggle-sidebar", handleToggle);

    const cleanupMenu = window.api?.onMenuAction((action) => {
      if (action === "toggle-sidebar") {
        handleToggle();
      }
    });

    return () => {
      window.removeEventListener("branchwise:toggle-sidebar", handleToggle);
      cleanupMenu?.();
    };
  }, []);

  function renderSidebar(isCollapsed: boolean): React.JSX.Element {
    return (
      <div className="flex flex-col h-full select-none">
        {/* Header row */}
        <div
          className={cn(
            "flex items-center h-14 shrink-0 border-b border-border",
            isCollapsed
              ? "justify-center px-2 relative"
              : "justify-between px-4",
          )}
        >
          {isCollapsed ? (
            <div className="flex items-center justify-center app-no-drag">
              <LogoChip />
            </div>
          ) : (
            <div className="flex items-center gap-2.5 min-w-0 app-no-drag">
              <LogoChip />
              <LogoWordmark />
            </div>
          )}

          <button
            type="button"
            onClick={handleToggleCollapse}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isCollapsed}
            className={cn(
              "rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-raised hover:text-text-primary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand app-no-drag",
              isCollapsed
                ? "absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-bg-base border border-border shadow-xs z-10"
                : "w-7 h-7",
            )}
          >
            {isCollapsed ? (
              <ChevronRightIcon className="w-3.5 h-3.5" />
            ) : (
              <ChevronLeftIcon className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Workspace switcher */}
        {workspaces.length > 1 && (
          <div
            className={cn(
              "pt-3 shrink-0",
              isCollapsed ? "px-2 flex justify-center" : "px-3",
            )}
          >
            {isCollapsed ? (
              (() => {
                const currentWs =
                  workspaces.find((w) => w.id === activeWorkspace) ??
                  workspaces[0];
                const nextWs =
                  workspaces.find((w) => w.id !== activeWorkspace) ??
                  workspaces[0];
                const icon =
                  currentWs.icon ??
                  (currentWs.id === "retail" ? (
                    <StoreIcon className="w-5 h-5" />
                  ) : (
                    <FactoryIcon className="w-5 h-5" />
                  ));
                return (
                  <button
                    type="button"
                    onClick={() => {
                      onWorkspaceChange?.(nextWs.id);
                    }}
                    aria-label={`Current workspace: ${currentWs.label}. Click to switch to ${nextWs.label}`}
                    title={`${currentWs.label} (Click to switch to ${nextWs.label})`}
                    className="w-10 h-10 rounded-lg flex items-center justify-center relative transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base border border-brand/40 bg-bg-base text-brand hover:border-brand hover:bg-brand-subtle/30 active:bg-brand-subtle/50 shadow-xs group app-no-drag"
                  >
                    <div className="relative shrink-0 flex items-center justify-center">
                      {icon}
                    </div>
                    {/* Floating Swap Badge at bottom-right */}
                    <span className="absolute -bottom-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full bg-bg-base border border-brand/50 text-brand shadow-xs transition-colors group-hover:bg-brand-subtle group-hover:border-brand">
                      <SwapIcon className="w-2.5 h-2.5" />
                    </span>
                  </button>
                );
              })()
            ) : (
              <div className="flex bg-bg-subtle rounded-lg p-0.5 gap-1 app-no-drag">
                {workspaces.map((ws) => {
                  const active = ws.id === activeWorkspace;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => {
                        onWorkspaceChange?.(ws.id);
                      }}
                      aria-current={active ? "page" : undefined}
                      aria-label={ws.label}
                      title={ws.label}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1.5 h-8 rounded-[5px] text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base",
                        active
                          ? ws.color
                            ? workspaceActiveClasses[ws.color]
                            : "bg-bg-base text-text-primary shadow-sm"
                          : "text-text-secondary hover:text-text-primary",
                      )}
                    >
                      {ws.label}
                      {!!ws.badgeCount && (
                        <Badge
                          variant="error"
                          className={
                            active && ws.color
                              ? "bg-white/25 text-white px-1.5 py-0 text-[10px]"
                              : "px-1.5 py-0 text-[10px]"
                          }
                        >
                          {ws.badgeCount}
                        </Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Nav list */}
        <nav
          className={cn(
            "flex-1 overflow-y-auto py-3 flex flex-col gap-1",
            isCollapsed ? "px-1.5 items-center" : "px-3",
          )}
        >
          {navItems.map((item) => {
            const active = item.id === activeSection;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSectionChange(item.id);
                }}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                className={cn(
                  "relative rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base app-no-drag",
                  isCollapsed
                    ? "flex flex-col items-center justify-center h-14 w-full px-1 text-center"
                    : "flex items-center gap-3 h-10 px-3 text-sm",
                  active
                    ? "bg-brand-subtle text-brand shadow-xs font-semibold"
                    : "text-text-secondary hover:bg-bg-raised hover:text-text-primary",
                )}
              >
                {/* Active indicator bar / Category indicator */}
                {(active || item.dotColor) && (
                  <span
                    className={cn(
                      "absolute left-0 w-1 rounded-r transition-all duration-150",
                      isCollapsed ? "top-2.5 bottom-2.5" : "top-1.5 bottom-1.5",
                      active ? "bg-brand" : item.dotColor,
                    )}
                    aria-hidden="true"
                  />
                )}

                {isCollapsed ? (
                  <>
                    <div className="relative shrink-0 flex items-center justify-center">
                      {item.icon}
                      {!!item.badgeCount && (
                        <span className="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 flex items-center justify-center rounded-full bg-error text-white text-[10px] font-bold leading-none pointer-events-none">
                          {item.badgeCount}
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] leading-tight font-medium text-center max-w-full mt-1">
                      {item.shortLabel ?? item.label}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="shrink-0">{item.icon}</span>
                    <span className="flex-1 text-left">{item.label}</span>
                    {!!item.badgeCount && (
                      <Badge variant="error" className="shrink-0">
                        {item.badgeCount}
                      </Badge>
                    )}
                  </>
                )}
              </button>
            );
          })}
        </nav>

        {/* Footer */}
        <div
          className={cn(
            "border-t border-border flex flex-col shrink-0",
            isCollapsed ? "p-2 items-center gap-2" : "p-4 gap-3",
          )}
        >
          {!isCollapsed && (
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-text-primary truncate">
                {profile?.name ?? email}
              </span>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                {profile?.role && (
                  <Badge variant={roleBadgeVariant[profile.role] ?? "default"}>
                    {roleLabels[profile.role] ?? profile.role}
                  </Badge>
                )}
                {profile?.branch_name && (
                  <span className="text-xs text-text-muted">
                    {profile.branch_name}
                  </span>
                )}
              </div>
            </div>
          )}

          {!isCollapsed && debugAction && (
            <details className="text-xs text-text-muted app-no-drag">
              <summary className="cursor-pointer select-none hover:text-text-secondary">
                Debug
              </summary>
              <div className="mt-2 flex flex-col gap-2 items-start">
                <button
                  type="button"
                  onClick={debugAction.onClick}
                  className="underline underline-offset-2 hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand rounded"
                >
                  {debugAction.label}
                </button>
                {debugResult && (
                  <pre className="bg-bg-raised rounded-md p-3 overflow-x-auto max-w-full font-mono max-h-40">
                    {debugResult}
                  </pre>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "min-h-screen bg-bg-base flex flex-col",
        // Wholesale repaints the shared tokens blue for everything inside it — see
        // globals.css's .workspace-wholesale block.
        activeWorkspace === "wholesale" && "workspace-wholesale",
      )}
    >
      {/* Windows custom title bar; macOS uses its native title bar. */}
      {hasCustomTitleBar && (
        <div
          className={cn(
            "h-10 shrink-0 w-full flex items-center justify-between px-4 app-drag-region select-none bg-bg-subtle border-b border-border/70 text-xs text-text-muted z-40",
            isWindows && "pr-[140px]",
          )}
        >
          <div className="flex items-center gap-2 font-medium">
            <span className="text-text-secondary font-semibold">
              Branch<span className="text-brand">Wise</span>
            </span>
            <span className="text-border">/</span>
            <span className="capitalize">{activeWorkspace ?? "workspace"}</span>
            {currentSectionLabel && (
              <>
                <span className="text-border">/</span>
                <span className="text-text-primary">{currentSectionLabel}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-3 app-no-drag">
            <span className="text-[11px] text-text-muted/70 hidden sm:inline-block">
              {isMac
                ? "⌘B Sidebar · ⌘, Settings"
                : "Ctrl+B Sidebar · Ctrl+, Settings"}
            </span>
          </div>
        </div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "shrink-0 border-r border-border bg-bg-subtle transition-[width] duration-200 select-none",
            collapsed ? "w-[5.25rem]" : "w-64",
          )}
        >
          <div
            className={cn(
            "fixed transition-[width] duration-200 z-50",
              hasCustomTitleBar
                ? "top-10 h-[calc(100vh-2.5rem)]"
                : "top-0 h-screen",
              collapsed ? "w-[5.25rem]" : "w-64",
            )}
          >
            {renderSidebar(collapsed)}
          </div>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          {/* Sticky so the section title and network indicator stay visible while scrolling. */}
          <div className="sticky top-0 z-40 flex flex-col shrink-0">
            {/* Header Bar */}
            <div className="h-14 shrink-0 flex items-center justify-between px-6 border-b border-border/60 text-sm text-text-muted select-none bg-bg-subtle">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="text-base font-semibold text-text-secondary truncate">
                  Branch<span className="text-brand">Wise</span>
                </span>
                <span className="text-base text-border font-light">/</span>
                <span className="capitalize text-base text-text-muted shrink-0">
                  {activeWorkspace ?? "workspace"}
                </span>
                {currentSectionLabel && (
                  <>
                    <span className="text-base text-border font-light">/</span>
                    <span className="text-base font-medium text-text-primary truncate">
                      {currentSectionLabel}
                    </span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-3 app-no-drag">
                {(isMac || isWindows) && (
                  <span className="text-xs text-text-muted/70 hidden sm:inline-block">
                    {isMac
                      ? "⌘B Sidebar · ⌘, Settings"
                      : "Ctrl+B Sidebar · Ctrl+, Settings"}
                  </span>
                )}
                <div className="relative" ref={accountMenuRef}>
                  <button
                    type="button"
                    aria-label="Open account menu"
                    aria-haspopup="menu"
                    aria-expanded={accountMenuOpen}
                    onClick={() => setAccountMenuOpen((open) => !open)}
                    className="relative flex h-9 w-9 items-center justify-center rounded-full bg-brand text-xs font-bold text-white shadow-xs transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base"
                  >
                    {accountInitials(profile, email)}
                    <NetworkStatusDot />
                  </button>
                  {accountMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Account menu"
                      className="absolute right-0 top-full z-50 mt-2 w-52 rounded-lg border border-border bg-bg-base p-1.5 text-sm shadow-lg"
                    >
                      <div className="border-b border-border px-2.5 pb-2 pt-1">
                        <p className="truncate font-medium text-text-primary">
                          {profile?.name || email || "User"}
                        </p>
                        {profile?.role && (
                          <p className="mt-0.5 text-xs capitalize text-text-muted">
                            {roleLabels[profile.role] ?? profile.role}
                          </p>
                        )}
                      </div>
                      <NetworkStatusDetails />
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          onSectionChange("settings");
                        }}
                        className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-text-secondary transition-colors hover:bg-bg-raised hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                      >
                        <SettingsIcon className="h-4 w-4" />
                        Settings
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAccountMenuOpen(false);
                          onSignOut();
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-error transition-colors hover:bg-error-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error"
                      >
                        <LogOutIcon className="h-4 w-4" />
                        Sign out
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          <main className="w-full px-3.5 sm:px-4.5 py-3 sm:py-3.5 flex flex-col gap-3 sm:gap-3.5 flex-1">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
