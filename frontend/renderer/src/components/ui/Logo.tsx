// The BranchWise logo, as components.
//
// The mark is a branch network: one connected centre with four distinct destinations.
// It stays clear at the tiny sizes used by the sidebar and desktop title bar.
//
// Two variants:
//   'mono'  — one colour (inherits `currentColor`), for a white mark inside the brand
//             chip, which is how it appears in the sidebar and on the sign-in screen.
//   'color' — standalone brand blue (#2563eb).

interface LogoMarkProps {
  className?: string;
  variant?: "mono" | "color";
}

export function LogoMark({
  className = "w-6 h-6",
  variant = "mono",
}: LogoMarkProps): React.JSX.Element {
  const isMono = variant === "mono";
  const strokeColor = isMono ? "currentColor" : "#2563eb";

  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      {/* The shared path between branches. */}
      <path
        d="M32 50V31M32 31L18 17M32 31L46 17M32 31L46 45"
        stroke={strokeColor}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Branch endpoints and the point that connects them. */}
      <circle cx="18" cy="17" r="5.5" fill={strokeColor} />
      <circle cx="46" cy="17" r="5.5" fill={strokeColor} />
      <circle cx="46" cy="45" r="5.5" fill={strokeColor} />
      <circle cx="32" cy="50" r="5.5" fill={strokeColor} />
      <circle cx="32" cy="31" r="4.5" fill={strokeColor} />
    </svg>
  );
}

// "Branch" in the text colour, "Wise" in the brand colour — the same two-tone wordmark
// as the printed logo, so the app and the slide deck match.
export function LogoWordmark({
  className = "",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <span className={`font-semibold tracking-tight ${className}`}>
      <span className="text-text-primary">Branch</span>
      <span className="font-normal text-brand">Wise</span>
    </span>
  );
}

// The mark inside the brand-coloured chip — the app-icon lockup, used wherever the logo
// introduces the app (sidebar header, sign-in screen).
export function LogoChip({
  className = "w-8 h-8 rounded-lg",
  markClassName = "w-5 h-5",
}: {
  className?: string;
  markClassName?: string;
}): React.JSX.Element {
  return (
    <div
      className={`bg-brand text-white flex items-center justify-center shrink-0 shadow-sm ${className}`}
    >
      <LogoMark className={markClassName} />
    </div>
  );
}
