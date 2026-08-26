const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  'aria-hidden': true
} as const

export function LogoIcon({ className = 'w-6 h-6' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 21V8l9-5 9 5v13M3 21h18M3 21v-9a2 2 0 012-2h2M21 21v-9a2 2 0 00-2-2h-2M9 21v-6a2 2 0 012-2h2a2 2 0 012 2v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function UploadIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function HistoryIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CalendarCheckIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 10h18M8 3v4M16 3v4M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1zM8.5 15l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function OverviewIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 19V10M10 19V5M16 19v-7M4 19h16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SalesIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 3h2l2.4 12.4a2 2 0 002 1.6h8.2a2 2 0 002-1.6L21 8H6M9 21a1 1 0 100-2 1 1 0 000 2zM18 21a1 1 0 100-2 1 1 0 000 2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function InventoryIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function PurchaseIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 3h2l1.6 3M6.6 6h13.4l-2 8H8.4M6.6 6L8.4 14M8.4 14l-1 4h11M10 21a1 1 0 100-2 1 1 0 000 2zM17 21a1 1 0 100-2 1 1 0 000 2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function DownloadIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M12 4v12m0 0l-5-5m5 5l5-5M5 20h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MenuIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 6h16M4 12h16M4 18h16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ConstructionIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M12 2l9 4.5v11L12 22l-9-4.5v-11L12 2z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 8v5M12 16h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function ChevronUpIcon({ className = 'w-4 h-4' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M6 15l6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ChevronDownIcon({ className = 'w-4 h-4' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ClipboardIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M9 4h6a1 1 0 011 1v1H8V5a1 1 0 011-1zM6 6h12a1 1 0 011 1v13a1 1 0 01-1 1H6a1 1 0 01-1-1V7a1 1 0 011-1zM9 12h6M9 16h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function TrashIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 7h16M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3m3 0l-.8 12.1a2 2 0 01-2 1.9H8.8a2 2 0 01-2-1.9L6 7h12zM10 11v6M14 11v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function WarningIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M12 3l10 18H2L12 3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 9v5M12 17h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

export function SunIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M12 3v2M12 19v2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M3 12h2M19 12h2M5.6 18.4L7 17M17 7l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function MoonIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function MonitorIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 20h8M12 16v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SettingsIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 6h6M14 6h6M4 12h10M18 12h2M4 18h6M14 18h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="12" cy="6" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16" cy="12" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="10" cy="18" r="2" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

export function FactoryIcon({ className = 'w-5 h-5' }: { className?: string }): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 21V11l6 4v-4l6 4v-4l6 4v6H3zM6 21v-4M12 21v-4M18 21v-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
