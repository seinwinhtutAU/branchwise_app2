import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  clearFetchCache,
  useCachedFetchMany,
  useImportedDataWatch,
} from "@renderer/lib/useCachedFetch";
import {
  ACTIONABLE_SEVERITIES,
  dashboardUrl,
  type OverviewData,
} from "@renderer/components/features/dashboard/helpers";
import { ChatLauncher } from "@renderer/components/features/ChatLauncher";
import { apiBaseUrl, supabase } from "@renderer/lib/supabaseClient";
import { useToast } from "@renderer/lib/useToast";
import { AuthScreen } from "@renderer/components/features/AuthScreen";
import {
  AppShell,
  type NavItem,
  type WorkspaceTab,
} from "@renderer/components/features/AppShell";
import FileImportCard from "@renderer/components/features/FileImportCard";
import {
  SimpleDataTable,
  type DataTableColumn,
  type DataTableFilter,
} from "@renderer/components/features/SimpleDataTable";
import type {
  PendingImport,
  Profile,
} from "@renderer/components/features/types";
import type { InventorySubTab } from "@renderer/components/features/InventoryPage";
import { useBranches, useRetailBranchOptions } from "@renderer/lib/useBranches";
import { formatBuyingPriceSource } from "@renderer/lib/buyingPriceSource";
import { useAppSettings } from "@renderer/lib/appSettings";
import { Spinner } from "@renderer/components/ui/Spinner";
import { ErrorBoundary } from "@renderer/components/ui/ErrorBoundary";
import {
  UploadIcon,
  HistoryIcon,
  HeartPulseIcon,
  OverviewIcon,
  BellIcon,
  DashboardIcon,
  SalesIcon,
  InventoryIcon,
  PurchaseIcon,
  ClipboardIcon,
  FactoryIcon,
  WarehouseIcon,
  ReceivingIcon,
  WarningIcon,
  SettingsIcon,
} from "@renderer/components/ui/icons";

// Lazy-loaded so a given account's bundle only pays for the sections it can actually
// reach — e.g. a wholesale-only account never downloads the retail import/history/
// overview/warnings code, and vice versa (see the Wholesale doc section in CLAUDE.md).
// Rendered inside the <Suspense> boundary below.
const ImportReviewPage = lazy(
  () => import("@renderer/components/features/ImportReviewPage"),
);
const ImportHistoryTable = lazy(
  () => import("@renderer/components/features/ImportHistoryTable"),
);
const ImportHistoryDetailPage = lazy(
  () => import("@renderer/components/features/ImportHistoryDetailPage"),
);
const ImportOverviewPage = lazy(
  () => import("@renderer/components/features/ImportOverviewPage"),
);
const DataOverviewTable = lazy(
  () => import("@renderer/components/features/DataOverviewTable"),
);
const InventoryPage = lazy(
  () => import("@renderer/components/features/InventoryPage"),
);
const CustomerOrdersPage = lazy(
  () => import("@renderer/components/features/CustomerOrdersPage"),
);
const FactoryVouchersPage = lazy(
  () => import("@renderer/components/features/FactoryVouchersPage"),
);
const WarehouseArrivalPage = lazy(
  () => import("@renderer/components/features/WarehouseArrivalPage"),
);
const FactoryReceivingPage = lazy(
  () => import("@renderer/components/features/FactoryReceivingPage"),
);
const WarningsPage = lazy(
  () => import("@renderer/components/features/WarningsPage"),
);
const DashboardPage = lazy(
  () => import("@renderer/components/features/DashboardPage"),
);
const BusinessAlertsPage = lazy(
  () => import("@renderer/components/features/BusinessAlertsPage"),
);
const SettingsPage = lazy(
  () => import("@renderer/components/features/SettingsPage"),
);

type Section =
  | "dashboard"
  | "businessAlerts"
  | "import"
  | "history"
  | "importOverview"
  | "overview"
  | "sales"
  | "inventory"
  | "purchase"
  | "warnings"
  | "orders"
  | "vouchers"
  | "warehouseArrival"
  | "factoryReceiving"
  | "settings";

// Retail and Wholesale are two functionally separate products glued together for admin's
// convenience (see the "Wholesale" doc section in CLAUDE.md) — an admin switches between
// them via the workspace tabs in AppShell rather than seeing one merged nav list, so each
// workspace's item count can keep growing without bloating the other's.
type Workspace = "retail" | "wholesale";

const RETAIL_NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: <DashboardIcon /> },
  // Sits next to Dashboard rather than next to Warning, even though both are "things
  // that are wrong": this one is about the business, Warning is about the imported data
  // being wrong, and they are read by different people for different reasons.
  { id: "businessAlerts", label: "Business Alerts", icon: <BellIcon /> },
  { id: "import", label: "Import", icon: <UploadIcon /> },
  { id: "history", label: "Import History", icon: <HistoryIcon /> },
  {
    id: "importOverview",
    label: "Import Overview",
    icon: <HeartPulseIcon />,
  },
  { id: "overview", label: "Data Overview", icon: <OverviewIcon /> },
  {
    id: "sales",
    label: "Sale",
    icon: <SalesIcon />,
    dotColor: "bg-emerald-400",
  },
  {
    id: "inventory",
    label: "Inventory",
    icon: <InventoryIcon />,
    dotColor: "bg-sky-400",
  },
  {
    id: "purchase",
    label: "Purchase",
    icon: <PurchaseIcon />,
    dotColor: "bg-pink-400",
  },
  { id: "warnings", label: "Warning", icon: <WarningIcon /> },
];

const WHOLESALE_NAV_ITEMS: NavItem[] = [
  { id: "orders", label: "Customer Orders", icon: <ClipboardIcon /> },
  { id: "vouchers", label: "Factory Vouchers", icon: <FactoryIcon /> },
  {
    id: "warehouseArrival",
    label: "Warehouse Arrival",
    icon: <WarehouseIcon />,
  },
  {
    id: "factoryReceiving",
    label: "Factory Receiving",
    icon: <ReceivingIcon />,
  },
];

const WORKSPACE_NAV_ITEMS: Record<Workspace, NavItem[]> = {
  retail: RETAIL_NAV_ITEMS,
  wholesale: WHOLESALE_NAV_ITEMS,
};

const WORKSPACE_LABELS: Record<Workspace, string> = {
  retail: "Retail",
  wholesale: "Wholesale",
};

// Matches roleBadgeVariant in AppShell (wholesale accounts already show an 'info' role
// badge) so a workspace's active-tab color is consistent with its color elsewhere.
const WORKSPACE_COLORS: Record<Workspace, "brand" | "info"> = {
  retail: "brand",
  wholesale: "info",
};

const WORKSPACE_SECTION_IDS: Record<Workspace, Set<string>> = {
  retail: new Set(RETAIL_NAV_ITEMS.map((item) => item.id)),
  wholesale: new Set(WHOLESALE_NAV_ITEMS.map((item) => item.id)),
};

// Remembers which workspace an admin was last in, so they don't land back on Retail every
// sign-in if they actually live in Wholesale.
const WORKSPACE_STORAGE_KEY = "branchwise:lastWorkspace";

// Every role sees Settings — the theme switcher living there applies universally, even
// though the daily-check-window section on that page only applies to non-wholesale. It's
// pinned below the workspace-specific nav list rather than inside either workspace, since
// it isn't scoped to one.
const SETTINGS_NAV_ITEM: NavItem = {
  id: "settings",
  label: "Settings",
  icon: <SettingsIcon />,
};
const SECTION_TITLES: Record<Section, string> = {
  dashboard: "Dashboard",
  businessAlerts: "Business alerts",
  import: "Import data",
  history: "Import history",
  importOverview: "Import overview",
  overview: "Data overview",
  sales: "Sale",
  inventory: "Inventory",
  purchase: "Purchase",
  warnings: "Warning",
  orders: "Customer orders",
  vouchers: "Factory vouchers",
  warehouseArrival: "Warehouse arrival",
  factoryReceiving: "Factory voucher receiving",
  settings: "Settings",
};

interface SaleRow {
  Branch: string | null;
  Date: string;
  Time: string | null;
  SlipID: string;
  SlipNumber: string;
  LineNo: number;
  LineID: string;
  StockCode: string;
  Description: string;
  Selling_Price: number | null;
  Qty: number | null;
  UOM: string | null;
  Discount_Amount: number | null;
  Amount: number | null;
  Net_Amount: number | null;
  Location: string | null;
  Buying_Price: number | null;
  Buying_Price_Source: string | null;
  Profit: number | null;
  Profit_Margin_Pct: number | null;
}

const SALE_COLUMNS: DataTableColumn<SaleRow>[] = [
  { key: "Branch", label: "Branch" },
  { key: "Date", label: "Date" },
  { key: "Time", label: "Time" },
  { key: "SlipID", label: "Slip ID" },
  { key: "SlipNumber", label: "Slip Number" },
  { key: "LineNo", label: "Line No", align: "right" },
  { key: "LineID", label: "Line ID" },
  { key: "StockCode", label: "Stock Code" },
  { key: "Description", label: "Description" },
  { key: "Selling_Price", label: "Selling Price", align: "right" },
  { key: "Qty", label: "Qty", align: "right" },
  { key: "UOM", label: "UOM" },
  { key: "Discount_Amount", label: "Discount Amount", align: "right" },
  { key: "Amount", label: "Amount", align: "right" },
  { key: "Net_Amount", label: "Net Amount", align: "right" },
  { key: "Location", label: "Location" },
  { key: "Buying_Price", label: "Buying Price", align: "right" },
  {
    key: "Buying_Price_Source",
    label: "Buying Price Source",
    format: (value) => formatBuyingPriceSource(value as string | null),
  },
  { key: "Profit", label: "Profit", align: "right" },
  {
    key: "Profit_Margin_Pct",
    label: "Profit Margin %",
    align: "right",
    format: (value) =>
      value === null || value === undefined
        ? "—"
        : `${(value as number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
  },
];

interface PurchaseRow {
  Branch: string | null;
  Date: string;
  StockCode: string;
  Description: string;
  Quantity: number | null;
  UOM: string | null;
  Buying_Price: number | null;
  Location: string | null;
}

const PURCHASE_COLUMNS: DataTableColumn<PurchaseRow>[] = [
  { key: "Branch", label: "Branch" },
  { key: "Date", label: "Date" },
  { key: "StockCode", label: "Stock Code" },
  { key: "Description", label: "Description" },
  { key: "Quantity", label: "Quantity", align: "right" },
  { key: "UOM", label: "UOM" },
  { key: "Buying_Price", label: "Buying Price", align: "right" },
  { key: "Location", label: "Location" },
];

function App(): React.JSX.Element {
  const showToast = useToast();
  const [session, setSession] = useState<Session | null>(null);
  // Notices imports and reverts done by other accounts on other machines, so their
  // work invalidates this browser's cached pages too (see useImportedDataWatch).
  useImportedDataWatch(session);
  // Which Dashboard tab and branch to open when another section sends the user there.
  const [dashboardTarget, setDashboardTarget] = useState<{
    tab: "revenue" | "cost" | "inventory" | "customer";
    branchId: string;
  } | null>(null);
  // Which Inventory sub-tab to open when the dashboard's "view all" links send the user
  // there — read once on mount by InventoryPage, same pattern as dashboardTarget above.
  const [inventoryTarget, setInventoryTarget] =
    useState<InventorySubTab | null>(null);
  // Which branch the Dashboard's Overview tab has open (null = the all-branches page).
  // Held here rather than inside the tab because switching to Revenue unmounts that tab,
  // and coming back should return to the branch you were reading, not to the branch list.
  // Only "← All branches" clears it.
  const [overviewBranchId, setOverviewBranchId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [rawSection, setSection] = useState<Section>("import");
  const [workspace, setWorkspace] = useState<Workspace>(() => {
    const stored = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    return stored === "wholesale" ? "wholesale" : "retail";
  });
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  // A queue rather than a single value so picking several files at once (see
  // FileImportCard) reviews them one after another instead of only ever the first.
  // `pendingImportQueueTotal` is the size the queue started at, kept separately since the
  // queue itself shrinks as each file is confirmed or skipped — it's what lets
  // ImportReviewPage show "File 2 of 5" instead of just "File 2".
  const [pendingImportQueue, setPendingImportQueue] = useState<PendingImport[]>(
    [],
  );
  const [pendingImportQueueTotal, setPendingImportQueueTotal] = useState(0);
  const pendingImport = pendingImportQueue[0] ?? null;
  const [viewingBatchId, setViewingBatchId] = useState<string | null>(null);
  const [highlightBatchId, setHighlightBatchId] = useState<string | null>(null);
  const [warningCount, setWarningCount] = useState(0);
  // Business-wide (app_settings table) — same values for every account and device.
  // `settings` is null until the fetch resolves, so every read below falls back to the
  // backend's own DEFAULT_SETTINGS value for that key.
  const { settings, updateSettings } = useAppSettings(session);
  const saleWindowDays = settings?.sale_warning_window_days ?? 1;
  const purchaseWindowDays = settings?.purchase_warning_window_days ?? 1;
  const saleListWindowDays = settings?.sale_list_window_days ?? 90;
  const purchaseListWindowDays = settings?.purchase_list_window_days ?? 90;
  const showBuyingPriceSource = settings?.show_buying_price_source ?? true;

  const saleColumns = useMemo(
    () =>
      showBuyingPriceSource
        ? SALE_COLUMNS
        : SALE_COLUMNS.filter((col) => col.key !== "Buying_Price_Source"),
    [showBuyingPriceSource],
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
      },
    );

    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }
    // Only block the app on the *first* profile load. Supabase refreshes the access
    // token whenever the window regains focus, which fires onAuthStateChange, which
    // re-runs this effect — and showing the full-screen spinner then unmounts every page
    // below, throwing away which tab you were on, which branch you had open, and every
    // filter you had set. Switching to another app and back should not reset the app.
    if (profile === null) setProfileLoading(true);
    fetch(`${apiBaseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false));
    // `profile` is read to decide whether this is the first load; adding it to the deps
    // would re-fetch every time the fetch itself sets it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Admin accounts (no fixed branch_id) see every branch's data merged, so their filter
  // dropdowns should offer every real branch — not just ones with rows currently loaded.
  // Branch-scoped accounts never see other branches' data at all, so we skip the fetch
  // for them; SimpleDataTable/ImportHistoryTable/DataOverviewTable fall back to deriving
  // options from loaded rows, which naturally hides a pointless single-branch filter.
  const isAdmin = profile !== null && profile.branch_id === null;
  // Wholesale runs on a completely separate workflow than retail (its own product codes,
  // customer orders, factory vouchers) — none of the import/sale/inventory/purchase/
  // history/overview screens apply to it, so a wholesale account only sees the wholesale
  // nav. Admin sees both, since admin already sees every branch's data elsewhere.
  const isWholesale = profile !== null && profile.role === "wholesale";
  // A role scoped to a single workspace is always in that workspace — only admin (who sees
  // both) actually uses the switcher state below.
  const effectiveWorkspace: Workspace = isWholesale
    ? "wholesale"
    : !isAdmin
      ? "retail"
      : workspace;
  // If the current section doesn't belong to the active workspace (first render before the
  // workspace is known, or right after switching workspaces), fall back to that workspace's
  // first item. Derived at render time (not corrected after the fact via an effect) so
  // there's no frame where the wrong workspace's UI briefly renders before a correction
  // catches up.
  const section: Section =
    rawSection === "settings" ||
    WORKSPACE_SECTION_IDS[effectiveWorkspace].has(rawSection)
      ? rawSection
      : (WORKSPACE_NAV_ITEMS[effectiveWorkspace][0].id as Section);
  const branchOptions = useBranches(isAdmin ? session : null);
  const retailBranchOptions = useRetailBranchOptions(isAdmin ? session : null);

  const pinnedNavItems = useMemo(() => [SETTINGS_NAV_ITEM], []);

  async function refreshWarningCount(): Promise<void> {
    if (!session) return;
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/warnings?sale_days=${saleWindowDays}&purchase_days=${purchaseWindowDays}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!response.ok) return;
      const body = await response.json();
      const total = (body.sections as { rows: unknown[] }[]).reduce(
        (sum, s) => sum + s.rows.length,
        0,
      );
      setWarningCount(total);
    } catch {
      // Sidebar badge is a convenience, not a source of truth — the Warning page itself
      // shows a proper error state if the backend is unreachable, so a failed refresh
      // here just leaves the last-known count in place.
    }
  }

  // Wholesale accounts never see the Warning nav item, so there's nothing to count for
  // them. Re-runs whenever either check window changes (e.g. from Settings) so the badge
  // doesn't sit stale until the next sign-in.
  useEffect(() => {
    if (!session || isWholesale) return;
    refreshWarningCount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, isWholesale, saleWindowDays, purchaseWindowDays]);

  // The Business Alerts badge, counted from the same per-branch overview payloads the
  // Dashboard and the Business Alerts page read — so this costs one set of requests that
  // then makes both of those pages open instantly, rather than a separate count endpoint
  // whose work would be thrown away. Data-quality alerts are excluded here for the same
  // reason they are excluded from that page: the Warning badge already counts them.
  const businessAlertUrls = useMemo(() => {
    if (isWholesale) return [];
    const branchIds = isAdmin
      ? retailBranchOptions.map((branch) => branch.id)
      : profile?.branch_id
        ? [profile.branch_id]
        : [];
    // The default window both pages open on, so the badge and the page agree.
    return branchIds.map((id) =>
      dashboardUrl("overview", id, { period: "30d", dateFrom: "", dateTo: "" }),
    );
  }, [isAdmin, isWholesale, profile?.branch_id, retailBranchOptions]);

  const { data: branchHealth } = useCachedFetchMany<OverviewData>(
    businessAlertUrls,
    session,
    "business alerts",
  );
  // `normal` alerts are excluded as well as data-quality ones: they ask for nothing
  // today, and a badge that counts them stops meaning "things to act on".
  const businessAlertCount = useMemo(
    () =>
      Object.values(branchHealth).reduce(
        (total, branch) =>
          total +
          branch.alerts.filter(
            (alert) =>
              alert.dimension !== "data_quality" &&
              ACTIONABLE_SEVERITIES.includes(alert.severity),
          ).length,
        0,
      ),
    [branchHealth],
  );

  const navItems = useMemo(
    () =>
      WORKSPACE_NAV_ITEMS[effectiveWorkspace].map((item) => {
        if (item.id === "warnings")
          return { ...item, badgeCount: warningCount };
        if (item.id === "businessAlerts")
          return { ...item, badgeCount: businessAlertCount };
        return item;
      }),
    [effectiveWorkspace, warningCount, businessAlertCount],
  );

  // Only admin actually switches workspaces — a retail-only or wholesale-only account is
  // permanently in its one workspace, so showing a switcher with a single option would be
  // pointless (AppShell already hides it below two tabs).
  const workspaceTabs: WorkspaceTab[] = useMemo(
    () =>
      isAdmin
        ? (Object.keys(WORKSPACE_NAV_ITEMS) as Workspace[]).map((id) => ({
            id,
            label: WORKSPACE_LABELS[id],
            color: WORKSPACE_COLORS[id],
            badgeCount: id === "retail" ? warningCount : undefined,
          }))
        : [],
    [isAdmin, warningCount],
  );

  function handleWorkspaceChange(id: string): void {
    const next = id as Workspace;
    setPendingImportQueue([]);
    setPendingImportQueueTotal(0);
    setViewingBatchId(null);
    setHighlightBatchId(null);
    setWorkspace(next);
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, next);
    setSection(WORKSPACE_NAV_ITEMS[next][0].id as Section);
  }

  const saleFilters: DataTableFilter<SaleRow>[] = useMemo(
    () => [
      {
        type: "search",
        keys: ["StockCode", "Description"],
        placeholder: "Stock code or description",
        serverParam: "search",
      },
      {
        type: "select",
        key: "Branch",
        label: "Branch",
        options: branchOptions,
        serverParam: "branch",
      },
      {
        type: "dateRange",
        key: "Date",
        label: "Date",
        serverParam: { from: "date_from", to: "date_to" },
      },
    ],
    [branchOptions],
  );

  const purchaseFilters: DataTableFilter<PurchaseRow>[] = useMemo(
    () => [
      {
        type: "search",
        keys: ["StockCode", "Description"],
        placeholder: "Stock code or description",
        serverParam: "search",
      },
      {
        type: "select",
        key: "Branch",
        label: "Branch",
        options: branchOptions,
        serverParam: "branch",
      },
      {
        type: "dateRange",
        key: "Date",
        label: "Date",
        serverParam: { from: "date_from", to: "date_to" },
      },
    ],
    [branchOptions],
  );

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "sign-in") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) showToast("error", error.message);
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) {
          showToast("error", error.message);
          return;
        }
        if (!data.session) {
          showToast(
            "info",
            "Account created — check your email to confirm before signing in.",
          );
          setMode("sign-in");
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDemoLogin(demoEmail: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({
      email: demoEmail,
      password: "123456",
    });
    if (error) showToast("error", error.message);
  }

  async function handleSignOut(): Promise<void> {
    await supabase.auth.signOut();
    // Drop every cached page: the next account may be scoped to a different branch, and
    // serving it this one's numbers would be both wrong and a disclosure.
    clearFetchCache();
    setOverviewBranchId(null);
    setMe(null);
  }

  async function callMe(): Promise<void> {
    if (!session) return;
    const response = await fetch(`${apiBaseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setMe(
      response.ok
        ? JSON.stringify(await response.json(), null, 2)
        : `Error: ${response.status}`,
    );
  }

  function handleSectionChange(id: string): void {
    setPendingImportQueue([]);
    setPendingImportQueueTotal(0);
    setViewingBatchId(null);
    setHighlightBatchId(null);
    setSection(id as Section);
  }

  // The single-file flows (Import History's "Reimport", Warning page's "Import to fix")
  // — always exactly one file replacing one specific batch, so no queue indicator.
  function handleFileReady(pending: PendingImport): void {
    setPendingImportQueue([pending]);
    setPendingImportQueueTotal(0);
  }

  // The main Import grid's FileImportCard, which can hand back several files from one
  // pick — each still gets its own review/confirm step, one after another.
  function handleFilesReady(pendings: PendingImport[]): void {
    setPendingImportQueue(pendings);
    setPendingImportQueueTotal(pendings.length);
  }

  // Jumps from a Warning row's "Source Import" link to that exact batch's row in Import
  // History — the list, not the read-only detail view, since Revert lives on the row
  // itself. Highlighting it saves hunting through the list for the right one to revert.
  function handleViewImportBatch(batchId: string): void {
    setPendingImportQueue([]);
    setPendingImportQueueTotal(0);
    setViewingBatchId(null);
    setHighlightBatchId(batchId);
    setSection("history");
  }

  function handleImportConfirmed(): void {
    const justConfirmed = pendingImportQueue[0];
    showToast(
      "success",
      justConfirmed?.revertBatchId
        ? `${justConfirmed.importLabel} reimported successfully`
        : `${justConfirmed?.importLabel} imported successfully`,
    );
    // Advances to the next queued file rather than clearing outright — an empty queue
    // naturally falls back to the Import grid since `pendingImport` derives from it.
    setPendingImportQueue((queue) => queue.slice(1));
    refreshWarningCount();
  }

  if (!session) {
    return (
      <AuthScreen
        mode={mode}
        onModeChange={setMode}
        email={email}
        onEmailChange={setEmail}
        password={password}
        onPasswordChange={setPassword}
        onSubmit={handleSubmit}
        submitting={submitting}
        onDemoLogin={handleDemoLogin}
        showDemoLogins={import.meta.env.DEV}
      />
    );
  }

  // Which nav/section a signed-in account sees depends on its role (retail vs. wholesale vs.
  // admin), known only once /api/me resolves. Rendering the shell before that would default
  // to the retail nav/section for every role — including wholesale — producing a visible
  // flash of retail UI right after sign-in. Waiting here instead means the shell only ever
  // renders once with the correct role-specific nav.
  if (profileLoading) {
    return (
      <div className="min-h-screen bg-bg-subtle flex items-center justify-center">
        <Spinner className="w-6 h-6 text-text-muted" />
      </div>
    );
  }

  return (
    <AppShell
      navItems={navItems}
      activeSection={section}
      onSectionChange={handleSectionChange}
      workspaces={workspaceTabs}
      activeWorkspace={effectiveWorkspace}
      onWorkspaceChange={handleWorkspaceChange}
      pinnedNavItems={pinnedNavItems}
      email={session.user.email}
      profile={profile}
      onSignOut={handleSignOut}
      debugAction={
        import.meta.env.DEV
          ? { label: "Call /api/me", onClick: callMe }
          : undefined
      }
      debugResult={me}
    >
      {/* One section throwing must not take the window down with it: without this a
          render error unmounts everything and leaves a blank white screen, which is
          neither readable nor debuggable. Keyed on the section so navigating away
          clears it. */}
      <ErrorBoundary resetKey={section} label={SECTION_TITLES[section]}>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-24">
              <Spinner className="w-6 h-6 text-text-muted" />
            </div>
          }
        >
          {pendingImport ? (
            <ImportReviewPage
              // Forces a full remount on every distinct file (see PendingImport.id) — the
              // previewed rows, branch pick, and purchase date are all local state that
              // must not carry over from whichever file was just confirmed or skipped.
              key={pendingImport.id}
              session={session}
              profile={profile}
              pending={pendingImport}
              queuePosition={
                pendingImportQueueTotal > 1
                  ? {
                      index:
                        pendingImportQueueTotal - pendingImportQueue.length + 1,
                      total: pendingImportQueueTotal,
                    }
                  : undefined
              }
              onBack={() => setPendingImportQueue((queue) => queue.slice(1))}
              onConfirmed={handleImportConfirmed}
            />
          ) : viewingBatchId ? (
            <ImportHistoryDetailPage
              session={session}
              batchId={viewingBatchId}
              onBack={() => setViewingBatchId(null)}
            />
          ) : (
            <>
              {section === "dashboard" && (
                <DashboardPage
                  session={session}
                  profile={profile}
                  branchOptions={retailBranchOptions}
                  onViewWarnings={() => handleSectionChange("warnings")}
                  onViewBusinessAlerts={() =>
                    handleSectionChange("businessAlerts")
                  }
                  onViewInventoryList={(tab) => {
                    // InventoryPage reads this once, on mount — same pattern as
                    // dashboardTarget just above.
                    setInventoryTarget(tab);
                    handleSectionChange("inventory");
                  }}
                  overviewBranchId={overviewBranchId}
                  onOverviewBranchChange={setOverviewBranchId}
                  initialTab={dashboardTarget?.tab}
                  initialBranchId={dashboardTarget?.branchId}
                />
              )}
              {section === "businessAlerts" && (
                <BusinessAlertsPage
                  session={session}
                  profile={profile}
                  branchOptions={retailBranchOptions}
                  onOpenEvidence={(target, branchId) => {
                    if (target === "warnings") {
                      handleSectionChange("warnings");
                      return;
                    }
                    // DashboardPage reads these once, on mount — which is exactly what a
                    // section switch does, so the tab and branch survive the jump.
                    setDashboardTarget({ tab: target, branchId });
                    handleSectionChange("dashboard");
                  }}
                />
              )}

              {section === "import" && (
                <div>
                  <h2 className="text-lg font-semibold text-text-primary tracking-tight mb-1">
                    {SECTION_TITLES[section]}
                  </h2>
                  <p className="text-sm text-text-muted mb-4">
                    Upload a POS export to preview the cleaned data before
                    saving it.
                  </p>
                </div>
              )}

              {section === "import" && (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FileImportCard
                      session={session}
                      label="Sales"
                      description="Daily sales slip exports"
                      endpoint="/api/imports/sales"
                      icon={<SalesIcon />}
                      onFilesReady={handleFilesReady}
                    />
                    <FileImportCard
                      session={session}
                      label="Purchase"
                      description="Stock purchase records"
                      endpoint="/api/imports/purchase"
                      icon={<PurchaseIcon />}
                      onFilesReady={handleFilesReady}
                    />
                  </div>
                  <FileImportCard
                    session={session}
                    label="Inventory"
                    description="Monthly stock snapshots"
                    endpoint="/api/imports/inventory"
                    icon={<InventoryIcon />}
                    onFilesReady={handleFilesReady}
                  />
                </div>
              )}

              {section === "history" && (
                <ImportHistoryTable
                  session={session}
                  onViewBatch={setViewingBatchId}
                  branchOptions={branchOptions}
                  profile={profile}
                  highlightBatchId={highlightBatchId}
                  onFileReady={handleFileReady}
                />
              )}
              {section === "importOverview" && (
                <ImportOverviewPage
                  session={session}
                  onViewImportBatch={handleViewImportBatch}
                />
              )}
              {section === "overview" && (
                <DataOverviewTable
                  session={session}
                  branchOptions={branchOptions}
                  showBuyingPriceSource={showBuyingPriceSource}
                />
              )}
              {section === "sales" && (
                <SimpleDataTable<SaleRow>
                  session={session}
                  endpoint="/api/sales"
                  title="Sale"
                  description="Sale lines from the last 90 days, with profit and margin from the buying price on record as of each sale's own date. Set a date to look further back."
                  icon={<SalesIcon />}
                  columns={saleColumns}
                  filters={saleFilters}
                  rowKey={(row, i) => `${row.SlipNumber}-${i}`}
                  emptyTitle="No sales yet"
                  emptyDescription="Import a sales file to see it here."
                  defaultWindowDays={saleListWindowDays}
                  serverPaged
                />
              )}
              {section === "inventory" && (
                <InventoryPage
                  session={session}
                  branchOptions={branchOptions}
                  initialTab={inventoryTarget ?? undefined}
                />
              )}
              {section === "purchase" && (
                <SimpleDataTable<PurchaseRow>
                  session={session}
                  endpoint="/api/purchases"
                  title="Purchase"
                  description="Purchase lines from the last 90 days. Set a date to look further back."
                  icon={<PurchaseIcon />}
                  columns={PURCHASE_COLUMNS}
                  filters={purchaseFilters}
                  rowKey={(row, i) => `${row.StockCode}-${row.Date}-${i}`}
                  emptyTitle="No purchases yet"
                  emptyDescription="Import a purchase file to see it here."
                  defaultWindowDays={purchaseListWindowDays}
                  serverPaged
                />
              )}
              {section === "warnings" && (
                <WarningsPage
                  session={session}
                  profile={profile}
                  onCountChange={setWarningCount}
                  saleWindowDays={saleWindowDays}
                  purchaseWindowDays={purchaseWindowDays}
                  branchOptions={branchOptions}
                  onViewImportBatch={handleViewImportBatch}
                  onFileReady={handleFileReady}
                />
              )}
              {section === "orders" && (
                <CustomerOrdersPage session={session} profile={profile} />
              )}
              {section === "vouchers" && (
                <FactoryVouchersPage session={session} profile={profile} />
              )}
              {section === "warehouseArrival" && (
                <WarehouseArrivalPage session={session} profile={profile} />
              )}
              {section === "factoryReceiving" && (
                <FactoryReceivingPage session={session} profile={profile} />
              )}
              {section === "settings" && (
                <SettingsPage
                  session={session}
                  profile={profile}
                  isAdmin={isAdmin}
                  settings={settings}
                  onUpdateSettings={updateSettings}
                />
              )}
            </>
          )}
        </Suspense>
      </ErrorBoundary>

      {/* The chat is a floating button rather than a nav section: it answers questions
          about whatever page you are already on, so making it a place you had to leave
          that page for was the wrong shape. Retail only, as before — the wholesale
          workflow has none of the imported data it reads. */}
      {effectiveWorkspace === "retail" && (
        <ChatLauncher session={session} profile={profile} />
      )}
    </AppShell>
  );
}

export default App;
