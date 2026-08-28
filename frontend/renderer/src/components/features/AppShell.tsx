import { useState, type ReactNode } from 'react'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { LogoIcon, MenuIcon } from '@renderer/components/ui/icons'
import type { Profile } from '@renderer/components/features/types'

export interface NavItem {
  id: string
  label: string
  icon: ReactNode
  dotColor?: string
  badgeCount?: number
}

export interface WorkspaceTab {
  id: string
  label: string
  badgeCount?: number
  // Which accent the tab gets when active — omit for the neutral default. Reuses the same
  // brand/info vocabulary as roleBadgeVariant below so a workspace's color matches its
  // role badge elsewhere in the UI (e.g. wholesale is 'info' in both places).
  color?: 'brand' | 'info'
}

interface AppShellProps {
  navItems: NavItem[]
  activeSection: string
  onSectionChange: (id: string) => void
  // Only rendered when there's more than one workspace to switch between — a
  // role scoped to a single workspace (retail-only, wholesale-only) never needs
  // the control, since there's nothing to switch to.
  workspaces?: WorkspaceTab[]
  activeWorkspace?: string
  onWorkspaceChange?: (id: string) => void
  // Rendered below the main nav list behind its own divider, so cross-cutting
  // items (Settings) stay reachable no matter which workspace is active instead
  // of scrolling past whichever workspace's items happen to be showing.
  pinnedNavItems?: NavItem[]
  email: string | null | undefined
  profile: Profile | null
  onSignOut: () => void
  children: ReactNode
  debugAction?: { label: string; onClick: () => void }
  debugResult?: string | null
}

const roleBadgeVariant: Record<string, 'brand' | 'info' | 'default'> = {
  admin: 'brand',
  wholesale: 'info',
  retail: 'default'
}

const workspaceActiveClasses: Record<'brand' | 'info', string> = {
  brand: 'bg-brand text-white shadow-sm',
  info: 'bg-info text-white shadow-sm'
}

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
  debugResult
}: AppShellProps): React.JSX.Element {
  const [mobileOpen, setMobileOpen] = useState(false)

  const sidebarContent = (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2.5 px-5 h-16 shrink-0 border-b border-border">
        <div className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center shrink-0">
          <LogoIcon className="w-4.5 h-4.5" />
        </div>
        <span className="font-semibold text-text-primary tracking-tight">Branchwise</span>
      </div>

      {workspaces.length > 1 && (
        <div className="px-3 pt-3 shrink-0">
          <div className="flex rounded-md bg-bg-subtle p-0.5 gap-0.5">
            {workspaces.map((ws) => {
              const active = ws.id === activeWorkspace
              return (
                <button
                  key={ws.id}
                  onClick={() => {
                    onWorkspaceChange?.(ws.id)
                    setMobileOpen(false)
                  }}
                  aria-current={active ? 'page' : undefined}
                  className={`flex-1 flex items-center justify-center gap-1.5 h-8 rounded-[5px] text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base ${
                    active
                      ? ws.color
                        ? workspaceActiveClasses[ws.color]
                        : 'bg-bg-base text-text-primary shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {ws.label}
                  {!!ws.badgeCount && (
                    <Badge
                      variant="error"
                      className={active && ws.color ? 'bg-white/25 text-white px-1.5 py-0 text-[10px]' : 'px-1.5 py-0 text-[10px]'}
                    >
                      {ws.badgeCount}
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-1">
        {navItems.map((item) => {
          const active = item.id === activeSection
          return (
            <button
              key={item.id}
              onClick={() => {
                onSectionChange(item.id)
                setMobileOpen(false)
              }}
              aria-current={active ? 'page' : undefined}
              className={`relative flex items-center gap-3 h-10 px-3 rounded-md text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base ${
                active
                  ? 'bg-brand-subtle text-brand'
                  : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary'
              }`}
            >
              {item.dotColor && (
                <span
                  className={`absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full ${item.dotColor}`}
                  aria-hidden="true"
                />
              )}
              <span className="shrink-0">{item.icon}</span>
              <span className="flex-1 text-left">{item.label}</span>
              {!!item.badgeCount && (
                <Badge variant="error" className="shrink-0">
                  {item.badgeCount}
                </Badge>
              )}
            </button>
          )
        })}
      </nav>

      {pinnedNavItems.length > 0 && (
        <div className="border-t border-border px-3 py-2 flex flex-col gap-1 shrink-0">
          {pinnedNavItems.map((item) => {
            const active = item.id === activeSection
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSectionChange(item.id)
                  setMobileOpen(false)
                }}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 h-10 px-3 rounded-md text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base ${
                  active
                    ? 'bg-brand-subtle text-brand'
                    : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary'
                }`}
              >
                <span className="shrink-0">{item.icon}</span>
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="border-t border-border p-4 flex flex-col gap-3 shrink-0">
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-text-primary truncate">
            {profile?.name ?? email}
          </span>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {profile?.role && (
              <Badge variant={roleBadgeVariant[profile.role] ?? 'default'}>{profile.role}</Badge>
            )}
            {profile?.branch_name && (
              <span className="text-xs text-text-muted">{profile.branch_name}</span>
            )}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={onSignOut} className="w-full">
          Sign out
        </Button>

        {debugAction && (
          <details className="text-xs text-text-muted">
            <summary className="cursor-pointer select-none hover:text-text-secondary">
              Debug
            </summary>
            <div className="mt-2 flex flex-col gap-2 items-start">
              <button
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
  )

  return (
    <div className="min-h-screen bg-bg-subtle lg:flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block w-64 shrink-0 border-r border-border bg-bg-base">
        <div className="fixed w-64 h-screen">{sidebarContent}</div>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden sticky top-0 z-20 bg-bg-base/80 backdrop-blur-xl border-b border-border h-14 flex items-center px-4 gap-3">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="w-9 h-9 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-raised transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <MenuIcon />
        </button>
        <span className="font-semibold text-text-primary tracking-tight">Branchwise</span>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-30">
          <div
            className="absolute inset-0 bg-black/30 animate-fade-in motion-reduce:animate-none"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute left-0 top-0 h-full w-64 bg-bg-base shadow-xl animate-slide-up motion-reduce:animate-none">
            {sidebarContent}
          </aside>
        </div>
      )}

      <div className="flex-1 min-w-0">
        <main className="w-full px-4 sm:px-6 py-8 flex flex-col gap-8">{children}</main>
      </div>
    </div>
  )
}
