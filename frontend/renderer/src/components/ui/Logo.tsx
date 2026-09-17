// The BranchWise logo, as components.
//
// The mark is a modern interlocking "BW" (Branch + Wise) monogram mark.
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
      {/* B spine */}
      <path
        d="M14 13V51"
        stroke={strokeColor}
        strokeWidth="5"
        strokeLinecap="round"
      />
      {/* B upper loop */}
      <path
        d="M14 13H30C35.5 13 39 16.5 39 22C39 27.5 35.5 31 30 31H14"
        stroke={strokeColor}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* W monogram interlock */}
      <path
        d="M18 31L28 51L38 16L47 51L55 20"
        stroke={strokeColor}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
