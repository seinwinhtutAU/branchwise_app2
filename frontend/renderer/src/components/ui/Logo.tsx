// The BranchWise logo, as components.
//
// The mark is one head office (the dot at the bottom) feeding branches that step
// upward — the shape of the business itself. `brand/branchwise-mark.svg` holds the same
// geometry for print and slides; if one changes, change the other.
//
// Two variants, because the mark is used two ways:
//   'mono'  — one colour (inherits `currentColor`), for a white mark inside the brand
//             chip, which is how it appears in the sidebar and on the sign-in screen.
//             The three branch tips are drawn at different opacities so the stepped
//             shape still reads when everything is the same colour.
//   'color' — the full indigo palette, for standalone use on a plain background.

interface LogoMarkProps {
  className?: string
  variant?: 'mono' | 'color'
}

export function LogoMark({
  className = 'w-6 h-6',
  variant = 'mono'
}: LogoMarkProps): React.JSX.Element {
  const mono = variant === 'mono'
  const stroke = mono ? 'currentColor' : '#6366f1'
  const tips = mono
    ? [
        { fill: 'currentColor', opacity: 0.6 },
        { fill: 'currentColor', opacity: 0.8 },
        { fill: 'currentColor', opacity: 1 }
      ]
    : [
        { fill: '#a5b4fc', opacity: 1 },
        { fill: '#818cf8', opacity: 1 },
        { fill: '#4f46e5', opacity: 1 }
      ]

  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <path d="M32 35 V 47" stroke={stroke} strokeWidth="4.5" strokeLinecap="round" />
      <path d="M13 35 H 51" stroke={stroke} strokeWidth="4.5" strokeLinecap="round" />
      <path
        d="M13 35 V 27 M32 35 V 23 M51 35 V 19"
        stroke={stroke}
        strokeWidth="4.5"
        strokeLinecap="round"
      />
      <circle cx="32" cy="51" r="6" fill={mono ? 'currentColor' : '#4338ca'} />
      <rect x="7" y="15" width="12" height="12" rx="3.5" {...tips[0]} />
      <rect x="26" y="11" width="12" height="12" rx="3.5" {...tips[1]} />
      <rect x="45" y="7" width="12" height="12" rx="3.5" {...tips[2]} />
    </svg>
  )
}

// "Branch" in the text colour, "Wise" in the brand colour — the same two-tone wordmark
// as the printed logo, so the app and the slide deck match.
export function LogoWordmark({ className = '' }: { className?: string }): React.JSX.Element {
  return (
    <span className={`font-semibold tracking-tight ${className}`}>
      <span className="text-text-primary">Branch</span>
      <span className="font-normal text-brand">Wise</span>
    </span>
  )
}

// The mark inside the brand-coloured chip — the app-icon lockup, used wherever the logo
// introduces the app (sidebar header, sign-in screen).
export function LogoChip({
  className = 'w-8 h-8 rounded-lg',
  markClassName = 'w-5 h-5'
}: {
  className?: string
  markClassName?: string
}): React.JSX.Element {
  return (
    <div
      className={`bg-brand text-white flex items-center justify-center shrink-0 shadow-sm ${className}`}
    >
      <LogoMark className={markClassName} />
    </div>
  )
}
