import { cn } from "@renderer/lib/utils";
import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { LogoMark } from "@renderer/components/ui/Logo";

type Mode = "sign-in" | "sign-up";

interface AuthScreenProps {
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  email: string;
  onEmailChange: (value: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  submitting?: boolean;
  onDemoLogin?: (email: string) => void;
  showDemoLogins?: boolean;
}

const DEMO_ACCOUNTS = [
  { email: "admin@branchwise.app", label: "Admin" },
  { email: "wholesale@branchwise.app", label: "Wholesale" },
  { email: "aungthitsar@branchwise.app", label: "AungThitSar" },
  { email: "ashley@branchwise.app", label: "Ashley" },
  { email: "retail3@branchwise.app", label: "Retail 3" },
];

// No skeleton/empty state — this IS the entry/loading screen, not a data view.
//
// Laid out as a native two-pane sign-in window (brand pane + form pane, edge to
// edge, no floating web-style card) rather than a centered card on a page — the
// window's own custom title bar carries the drag region, same as AppShell's.
export function AuthScreen({
  mode,
  onModeChange,
  email,
  onEmailChange,
  password,
  onPasswordChange,
  onSubmit,
  submitting,
  onDemoLogin,
  showDemoLogins,
}: AuthScreenProps): React.JSX.Element {
  const isMac = typeof window !== "undefined" && Boolean(window.api?.isMac);
  const isWindows =
    typeof window !== "undefined" && Boolean(window.api?.isWindows);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-bg-base">
      {/* Native title bar drag strip — matches AppShell's, so the window can be
          moved from this screen too instead of only after signing in. */}
      {(isMac || isWindows) && (
        <div className="h-11 shrink-0 app-drag-region" />
      )}

      <div className="flex-1 min-h-0 flex">
        {/* Brand pane */}
        <div className="hidden md:flex md:w-[400px] md:shrink-0 flex-col justify-between relative overflow-hidden bg-gradient-to-br from-brand to-brand-active text-white">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-24 -right-24 w-72 h-72 rounded-full bg-white/10 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-32 -left-16 w-80 h-80 rounded-full bg-black/10 blur-3xl"
          />
          <LogoMark className="pointer-events-none absolute -right-10 -bottom-10 w-72 h-72 opacity-[0.07]" />

          <div className="relative flex-1 flex flex-col justify-center px-12">
            <div className="w-14 h-14 rounded-2xl bg-white/15 flex items-center justify-center mb-6">
              <LogoMark className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Branch<span className="font-normal text-white/80">Wise</span>
            </h1>
            <p className="mt-3 text-sm text-white/70 max-w-[15rem] leading-relaxed">
              Manage sales, inventory and purchases across every branch.
            </p>
          </div>

          <p className="relative px-12 pb-8 text-xs text-white/50">
            © {new Date().getFullYear()} BranchWise
          </p>
        </div>

        {/* Form pane */}
        <div className="flex-1 min-w-0 overflow-y-auto flex items-center justify-center px-6 py-10">
          <div className="w-full max-w-sm animate-slide-up motion-reduce:animate-none">
            <div className="mb-8">
              <h2 className="text-xl font-semibold tracking-tight text-text-primary">
                {mode === "sign-in" ? "Sign in" : "Create account"}
              </h2>
              <p className="mt-1 text-sm text-text-muted">
                {mode === "sign-in"
                  ? "Sign in to manage your branch's data"
                  : "Create an account to get started"}
              </p>
            </div>

            <div
              role="tablist"
              className="grid grid-cols-2 gap-1 p-1 mb-6 rounded-lg bg-bg-subtle"
            >
              {(["sign-in", "sign-up"] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => onModeChange(m)}
                  className={`h-8 rounded-md text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 ${
                    mode === m
                      ? "bg-brand text-white shadow-sm"
                      : "text-text-muted hover:text-text-secondary hover:bg-bg-raised"
                  }`}
                >
                  {m === "sign-in" ? "Sign in" : "Sign up"}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              <Input
                type="email"
                label="Email"
                placeholder="you@branchwise.app"
                value={email}
                onChange={(e) => onEmailChange(e.target.value)}
                autoComplete="email"
                required
              />
              <Input
                type="password"
                label="Password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                autoComplete={
                  mode === "sign-in" ? "current-password" : "new-password"
                }
                required
              />

              <Button type="submit" className="w-full mt-1" loading={submitting}>
                {mode === "sign-in" ? "Sign in" : "Create account"}
              </Button>
            </form>

            {showDemoLogins && onDemoLogin && (
              <div className="mt-8 pt-6 border-t border-border">
                <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2">
                  Demo accounts · password 12345678
                </p>
                <div className="flex flex-wrap gap-2">
                  {DEMO_ACCOUNTS.map((account) => (
                    <button
                      key={account.email}
                      onClick={() => onDemoLogin(account.email)}
                      className={cn(
                        "h-8 px-3 rounded-full text-xs font-medium bg-bg-base border border-border text-text-secondary transition-all duration-150",
                        "hover:border-brand hover:text-brand active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1",
                        "motion-reduce:active:scale-100",
                      )}
                    >
                      {account.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
