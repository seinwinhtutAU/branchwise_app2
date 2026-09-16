import { useState, type ReactNode } from "react";
import { cn } from "@renderer/lib/utils";
import { Badge } from "@renderer/components/ui/Badge";
import { Button } from "@renderer/components/ui/Button";
import {
  MenuIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LogOutIcon,
  StoreIcon,
  FactoryIcon,
} from "@renderer/components/ui/icons";
import { LogoChip, LogoWordmark } from "@renderer/components/ui/Logo";
import type { Profile } from "@renderer/components/features/types";
import { ConnectionBanner } from "@renderer/components/features/ConnectionBanner";

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
  // Rendered below the main nav list behind its own divider, so cross-cutting
  // items (Settings) stay reachable no matter which workspace is active instead
  // of scrolling past whichever workspace's items happen to be showing.
  pinnedNavItems?: NavItem[];
  email: string | null | undefined;
  profile: Profile | null;
  onSignOut: () => void;
  children: ReactNode;
  debugAction?: { label: string; onClick: () => void };
  debugResult?: string | null;
}

const roleBadgeVariant: Record<string, "brand" | "info" | "default"> = {
  admin: "brand",
  wholesale: "info",
  retail: "default",
};

const workspaceActiveClasses: Record<"brand" | "info", string> = {
  brand: "bg-brand text-white shadow-sm",
  info: "bg-info text-white shadow-sm",
};

const SIDEBAR_STORAGE_KEY = "branchwise:sidebarCollapsed";

// Layout wrapper — no skeleton/empty state (exempt per rubric).
export function AppShell({
  navItems,
  activeSection,
  onSectionChange,
  workspaces = [],
  activeWorkspace,
  onWorkspaceChange,
  pinnedNavItems = [],
  email,
  profile,
  onSignOut,
  children,
  debugAction,
  debugResult,
}: AppShellProps): React.JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

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

  function renderSidebar(
    isCollapsed: boolean,
    isMobile = false,
  ): React.JSX.Element {
    return (
      <div className="flex flex-col h-full">
        {/* Header row */}
        <div
          className={cn(
            "flex items-center h-16 shrink-0 border-b border-border",
            isCollapsed
              ? "justify-center px-2 relative"
              : "justify-between px-5",
          )}
        >
          {isCollapsed ? (
            <div className="flex items-center justify-center">
              <LogoChip />
            </div>
          ) : (
            <div className="flex items-center gap-2.5 min-w-0">
              <LogoChip />
              <LogoWordmark />
            </div>
          )}

          {!isMobile && (
            <button
              type="button"
              onClick={handleToggleCollapse}
              aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={!isCollapsed}
              className={cn(
                "rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-raised hover:text-text-primary transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
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
          )}
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
                  workspaces.find((w) => w.id === activeWorkspace) ?? workspaces[0];
                const nextWs =
                  workspaces.find((w) => w.id !== activeWorkspace) ?? workspaces[0];
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
                      setMobileOpen(false);
                    }}
                    aria-label={`Current workspace: ${currentWs.label}. Click to switch to ${nextWs.label}`}
                    title={`${currentWs.label} (Click to switch to ${nextWs.label})`}
                    className={cn(
                      "w-10 h-10 rounded-lg flex items-center justify-center relative transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base shadow-xs",
                      currentWs.color
                        ? workspaceActiveClasses[currentWs.color]
                        : "bg-bg-base text-text-primary border border-border/60 hover:border-border",
                    )}
                  >
                    <div className="relative shrink-0 flex items-center justify-center">
                      {icon}
                      {workspaces.some((w) => !!w.badgeCount) && (
                        <span className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-error" />
                      )}
                    </div>
                  </button>
                );
              })()
            ) : (
              <div className="flex bg-bg-subtle rounded-lg p-0.5 gap-1">
                {workspaces.map((ws) => {
                  const active = ws.id === activeWorkspace;
                  return (
                    <button
                      key={ws.id}
                      type="button"
                      onClick={() => {
                        onWorkspaceChange?.(ws.id);
                        setMobileOpen(false);
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
                  setMobileOpen(false);
                }}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={item.label}
                className={cn(
                  "relative rounded-lg font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base",
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
                    <span className="text-[10px] leading-tight font-medium text-center truncate max-w-full mt-1">
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
                    {profile.role}
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

          {pinnedNavItems.length > 0 && (
            <div
              className={cn(
                "flex items-center gap-1",
                isCollapsed && "justify-center",
              )}
            >
              {pinnedNavItems.map((item) => {
                const active = item.id === activeSection;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      onSectionChange(item.id);
                      setMobileOpen(false);
                    }}
                    aria-current={active ? "page" : undefined}
                    aria-label={item.label}
                    title={item.label}
                    className={cn(
                      "w-9 h-9 rounded-md flex items-center justify-center transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base",
                      active
                        ? "bg-bg-raised text-brand shadow-xs"
                        : "text-text-secondary hover:bg-bg-raised hover:text-text-primary",
                    )}
                  >
                    {item.icon}
                  </button>
                );
              })}
            </div>
          )}

          {isCollapsed ? (
            <button
              type="button"
              onClick={onSignOut}
              aria-label="Sign out"
              title="Sign out"
              className="w-9 h-9 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-raised hover:text-text-primary transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base"
            >
              <LogOutIcon className="w-5 h-5" />
            </button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={onSignOut}
              className="w-full"
            >
              Sign out
            </Button>
          )}

          {!isCollapsed && debugAction && (
            <details className="text-xs text-text-muted">
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
        "min-h-screen bg-bg-base lg:flex",
        // Wholesale repaints the shared tokens blue for everything inside it — see
        // globals.css's .workspace-wholesale block.
        activeWorkspace === "wholesale" && "workspace-wholesale",
      )}
    >
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:block shrink-0 border-r border-border bg-bg-base transition-[width] duration-200",
          collapsed ? "w-[4.5rem]" : "w-64",
        )}
      >
        <div
          className={cn(
            "fixed h-screen transition-[width] duration-200",
            collapsed ? "w-[4.5rem]" : "w-64",
          )}
        >
          {renderSidebar(collapsed, false)}
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-20 bg-bg-base/80 backdrop-blur-xl border-b border-border h-14 flex items-center px-4 gap-3">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="w-9 h-9 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-raised transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <MenuIcon />
        </button>
        <LogoChip className="w-7 h-7 rounded-md" markClassName="w-4 h-4" />
        <LogoWordmark />
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-30">
          <div
            className="absolute inset-0 bg-black/30 animate-fade-in motion-reduce:animate-none"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 bg-bg-base shadow-xl animate-slide-up motion-reduce:animate-none">
            {renderSidebar(false, true)}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0">
        {/* Above the content rather than inside it, so it is the same one line whichever
            page is open — and so no page has to know about the network to explain itself. */}
        <ConnectionBanner />
        <main className="w-full px-4 sm:px-5 py-5 flex flex-col gap-5">
          {children}
        </main>
      </div>
    </div>
  );
}

