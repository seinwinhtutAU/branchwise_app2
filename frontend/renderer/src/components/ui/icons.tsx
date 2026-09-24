const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  "aria-hidden": true,
} as const;

export function FilterIcon({
  className = "w-4 h-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 5h18l-7 8.5V19l-4 2v-7.5L3 5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UploadIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M14 2.5H6a2 2 0 00-2 2v15a2 2 0 002 2h12a2 2 0 002-2V8.5l-6-6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M14 2.5v6h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 17.5v-6.5m-3 3l3-3 3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function HistoryIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 3v5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function CalendarIcon({
  className = "w-4 h-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 10h18M8 3v4M16 3v4M5 6h14a1 1 0 011 1v12a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OverviewIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M3.5 9.5h17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M9.5 20.5V9.5M15.5 20.5V9.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M3.5 15h17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DashboardIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect
        x="3"
        y="3"
        width="18"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M3 8.5h18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <rect
        x="6"
        y="11.5"
        width="5"
        height="6.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="14"
        y="11.5"
        width="5"
        height="2.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <rect
        x="14"
        y="15.5"
        width="5"
        height="2.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function SalesIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M12.586 2.586A2 2 0 0011.172 2H4a2 2 0 00-2 2v7.172a2 2 0 00.586 1.414l8.828 8.828a2 2 0 002.828 0l7.172-7.172a2 2 0 000-2.828L12.586 2.586z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" />
    </svg>
  );
}

export function InventoryIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PurchaseIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 10h18l-2 10H5L3 10z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 10V6a4 4 0 018 0v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 14v3M15 14v3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DownloadIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
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
  );
}

export function ChevronUpIcon({
  className = "w-4 h-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M6 15l6-6 6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronDownIcon({
  className = "w-4 h-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronLeftIcon({
  className = "w-4 h-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M15 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronRightIcon({
  className = "w-4 h-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M9 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ClipboardIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect
        x="5"
        y="4"
        width="14"
        height="17"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M9 4a2 2 0 014 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M8.5 11l1.5 1.5 3-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 16h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CopyIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect
        x="9"
        y="9"
        width="11"
        height="12"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M15 6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v8A2.5 2.5 0 0 0 6.5 17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function TrashIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
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
  );
}

export function WarningIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M10.7 4.2a1.5 1.5 0 012.6 0l8.1 14A1.5 1.5 0 0120.1 20.5H3.9a1.5 1.5 0 01-1.3-2.3l8.1-14z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 9v4.5M12 16.5h.01"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function HeartPulseIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect
        x="2"
        y="3"
        width="20"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8 21h8M12 17v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M5 10h3l2 4 4-8 2 4h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SunIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
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
  );
}

export function MoonIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
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
  );
}

export function MonitorIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect
        x="3"
        y="4"
        width="18"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M8 20h8M12 16v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SettingsIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
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
  );
}

export function StoreIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 9l1.5-5h15L21 9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 9a2.25 2.25 0 0 1 4.5 0 2.25 2.25 0 0 1 4.5 0 2.25 2.25 0 0 1 4.5 0 2.25 2.25 0 0 1 4.5 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M4.5 10.5V19a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-8.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 21v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BranchIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M12 21c-4-4.5-7-8.5-7-12a7 7 0 1114 0c0 3.5-3 7.5-7 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function FactoryIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M2 21h20V12l-6 3V10l-6 3V8L2 12.5V21z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 4h2.5v4H18z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 21v-4a1 1 0 011-1h2a1 1 0 011 1v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15 17h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CloseIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ChatIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 5h16v11H8l-4 4V5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M8 9h8M8 12.5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function WarehouseIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 21V10l9-6 9 6v11H3zM8 21v-6h8v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ReceivingIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 10v9a2 2 0 002 2h12a2 2 0 002-2v-9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 10l9-4 9 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 3v10m-3-3l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SendIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 12l16-8-6 8 6 8-16-8zm0 0h9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SearchIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M21 21l-4.3-4.3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DollarIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ScaleIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M19 5L5 19"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="7.5" cy="7.5" r="3" stroke="currentColor" strokeWidth="1.6" />
      <circle
        cx="16.5"
        cy="16.5"
        r="3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function PlusIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function CheckIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MoreIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <circle cx="5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="19" cy="12" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function EyeIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="2.75"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function TruckIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <rect
        x="2"
        y="6"
        width="12"
        height="9"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M14 9h4l3 3v3h-7V9z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="18" r="2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="18" r="2" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M9 18h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function ArrowRightIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 12h15m0 0l-5.5-5.5M19 12l-5.5 5.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function VoucherIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 6a2 2 0 012-2h12a2 2 0 012 2v3a2 2 0 000 4v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3a2 2 0 000-4V6z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12 4v2M12 9v2M12 14v2M12 19v1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M7 10h2M15 10h2M15 14h2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MasterDataIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <ellipse
        cx="12"
        cy="5"
        rx="9"
        ry="3"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function PencilIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M4 20h4l10-10a2.1 2.1 0 00-3-3L5 17v3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M13.5 6.5l4 4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function MoreVerticalIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="5" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function LogOutIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SwapIcon({
  className = "w-3.5 h-3.5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M7.5 7.5h9m0 0l-3-3m3 3l-3 3M16.5 16.5h-9m0 0l3 3m-3-3l3-3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function RefreshIcon({
  className = "w-4 h-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 3v5h-5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 21v-5h5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TrendingUpIcon({
  className = "w-4 h-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M23 6l-9.5 9.5-5-5L1 18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 6h6v6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UsersIcon({
  className = "w-4 h-4",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="9"
        cy="7"
        r="4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M23 21v-2a4 4 0 00-3-3.87"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16 3.13a4 4 0 010 7.75"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShieldCheckIcon({
  className = "w-5 h-5",
}: {
  className?: string;
}): React.JSX.Element {
  return (
    <svg {...base} className={className}>
      <path
        d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export { ShieldCheckIcon as DataQualityIcon };
