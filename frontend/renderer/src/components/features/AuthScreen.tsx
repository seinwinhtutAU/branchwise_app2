import { Button } from "@renderer/components/ui/Button";
import { Input } from "@renderer/components/ui/Input";
import { LogoChip, LogoWordmark } from "@renderer/components/ui/Logo";

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
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-subtle px-4 py-12">
      <div className="w-full max-w-sm animate-slide-up motion-reduce:animate-none">
        <div className="flex flex-col items-center gap-2 mb-8">
          <LogoChip className="w-11 h-11 rounded-xl" markClassName="w-7 h-7" />
          <LogoWordmark className="text-xl" />
          <p className="text-sm text-text-muted">
            Sign in to manage your branch's data
          </p>
        </div>

        <div className="bg-bg-base border border-border rounded-xl shadow-md p-6">
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
                    ? "bg-bg-base text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary"
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
        </div>

        {showDemoLogins && onDemoLogin && (
          <div className="mt-6">
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-2 text-center">
              Demo accounts · password 12345678
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  onClick={() => onDemoLogin(account.email)}
                  className="h-8 px-3 rounded-full text-xs font-medium bg-bg-base border border-border text-text-secondary transition-all duration-150 hover:border-brand hover:text-brand active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 motion-reduce:active:scale-100"
                >
                  {account.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
