import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl, supabase } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { AuthScreen } from '@renderer/components/features/AuthScreen'
import { AppShell, type NavItem } from '@renderer/components/features/AppShell'
import FileImportCard from '@renderer/components/features/FileImportCard'
import ImportReviewPage from '@renderer/components/features/ImportReviewPage'
import ImportHistoryTable from '@renderer/components/features/ImportHistoryTable'
import ImportHistoryDetailPage from '@renderer/components/features/ImportHistoryDetailPage'
import ImportOverviewPage from '@renderer/components/features/ImportOverviewPage'
import DataOverviewTable from '@renderer/components/features/DataOverviewTable'
import CustomerOrdersPage from '@renderer/components/features/CustomerOrdersPage'
import FactoryVouchersPage from '@renderer/components/features/FactoryVouchersPage'
import {
  SimpleDataTable,
  type DataTableColumn,
  type DataTableFilter
} from '@renderer/components/features/SimpleDataTable'
import type { PendingImport, Profile } from '@renderer/components/features/types'
import { useBranches } from '@renderer/lib/useBranches'
import { Spinner } from '@renderer/components/ui/Spinner'
import {
  UploadIcon,
  HistoryIcon,
  CalendarCheckIcon,
  OverviewIcon,
  SalesIcon,
  InventoryIcon,
  PurchaseIcon,
  ClipboardIcon,
  FactoryIcon
} from '@renderer/components/ui/icons'

type Section =
  | 'import'
  | 'history'
  | 'importOverview'
  | 'overview'
  | 'sales'
  | 'inventory'
  | 'purchase'
  | 'orders'
  | 'vouchers'

const NAV_ITEMS: NavItem[] = [
  { id: 'import', label: 'Import', icon: <UploadIcon /> },
  { id: 'history', label: 'Import History', icon: <HistoryIcon /> },
  { id: 'importOverview', label: 'Import Overview', icon: <CalendarCheckIcon /> },
  { id: 'overview', label: 'Data Overview', icon: <OverviewIcon /> },
  { id: 'sales', label: 'Sale', icon: <SalesIcon /> },
  { id: 'inventory', label: 'Inventory', icon: <InventoryIcon /> },
  { id: 'purchase', label: 'Purchase', icon: <PurchaseIcon /> }
]

const WHOLESALE_NAV_ITEMS: NavItem[] = [
  { id: 'orders', label: 'Customer Orders', icon: <ClipboardIcon /> },
  { id: 'vouchers', label: 'Factory Vouchers', icon: <FactoryIcon /> }
]

const SECTION_TITLES: Record<Section, string> = {
  import: 'Import data',
  history: 'Import history',
  importOverview: 'Import overview',
  overview: 'Data overview',
  sales: 'Sale',
  inventory: 'Inventory',
  purchase: 'Purchase',
  orders: 'Customer orders',
  vouchers: 'Factory vouchers'
}

interface SaleRow {
  Branch: string | null
  Date: string
  Time: string | null
  SlipID: string
  SlipNumber: string
  LineNo: number
  LineID: string
  StockCode: string
  Description: string
  Selling_Price: number | null
  Qty: number | null
  UOM: string | null
  Discount_Amount: number | null
  Amount: number | null
  Net_Amount: number | null
  Location: string | null
  Buying_Price: number | null
  Profit: number | null
  Profit_Margin_Pct: number | null
}

const SALE_COLUMNS: DataTableColumn<SaleRow>[] = [
  { key: 'Branch', label: 'Branch' },
  { key: 'Date', label: 'Date' },
  { key: 'Time', label: 'Time' },
  { key: 'SlipID', label: 'Slip ID' },
  { key: 'SlipNumber', label: 'Slip Number' },
  { key: 'LineNo', label: 'Line No', align: 'right' },
  { key: 'LineID', label: 'Line ID' },
  { key: 'StockCode', label: 'Stock Code' },
  { key: 'Description', label: 'Description' },
  { key: 'Selling_Price', label: 'Selling Price', align: 'right' },
  { key: 'Qty', label: 'Qty', align: 'right' },
  { key: 'UOM', label: 'UOM' },
  { key: 'Discount_Amount', label: 'Discount Amount', align: 'right' },
  { key: 'Amount', label: 'Amount', align: 'right' },
  { key: 'Net_Amount', label: 'Net Amount', align: 'right' },
  { key: 'Location', label: 'Location' },
  { key: 'Buying_Price', label: 'Buying Price', align: 'right' },
  { key: 'Profit', label: 'Profit', align: 'right' },
  {
    key: 'Profit_Margin_Pct',
    label: 'Profit Margin %',
    align: 'right',
    format: (value) =>
      value === null || value === undefined
        ? '—'
        : `${(value as number).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`
  }
]

interface InventoryRow {
  Branch: string | null
  Snapshot_At: string
  StockCode: string
  Description: string
  Group: string | null
  On_Hand_Qty: number | null
  Buying_Price: number | null
  Selling_Price: number | null
  Location: string | null
}

const INVENTORY_COLUMNS: DataTableColumn<InventoryRow>[] = [
  { key: 'Branch', label: 'Branch' },
  { key: 'Snapshot_At', label: 'Last Updated' },
  { key: 'StockCode', label: 'Stock Code' },
  { key: 'Description', label: 'Description' },
  { key: 'Group', label: 'Group' },
  { key: 'On_Hand_Qty', label: 'On Hand Qty', align: 'right' },
  { key: 'Buying_Price', label: 'Buying Price', align: 'right' },
  { key: 'Selling_Price', label: 'Selling Price', align: 'right' },
  { key: 'Location', label: 'Location' }
]

interface PurchaseRow {
  Branch: string | null
  Date: string
  StockCode: string
  Description: string
  Quantity: number | null
  UOM: string | null
  Buying_Price: number | null
  Location: string | null
}

const PURCHASE_COLUMNS: DataTableColumn<PurchaseRow>[] = [
  { key: 'Branch', label: 'Branch' },
  { key: 'Date', label: 'Date' },
  { key: 'StockCode', label: 'Stock Code' },
  { key: 'Description', label: 'Description' },
  { key: 'Quantity', label: 'Quantity', align: 'right' },
  { key: 'UOM', label: 'UOM' },
  { key: 'Buying_Price', label: 'Buying Price', align: 'right' },
  { key: 'Location', label: 'Location' }
]

function App(): React.JSX.Element {
  const showToast = useToast()
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoading, setProfileLoading] = useState(false)
  const [rawSection, setSection] = useState<Section>('import')
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [me, setMe] = useState<string | null>(null)

  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [viewingBatchId, setViewingBatchId] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => subscription.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setProfile(null)
      setProfileLoading(false)
      return
    }
    setProfileLoading(true)
    fetch(`${apiBaseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
      .then((r) => (r.ok ? r.json() : null))
      .then(setProfile)
      .catch(() => setProfile(null))
      .finally(() => setProfileLoading(false))
  }, [session])

  // Admin accounts (no fixed branch_id) see every branch's data merged, so their filter
  // dropdowns should offer every real branch — not just ones with rows currently loaded.
  // Branch-scoped accounts never see other branches' data at all, so we skip the fetch
  // for them; SimpleDataTable/ImportHistoryTable/DataOverviewTable fall back to deriving
  // options from loaded rows, which naturally hides a pointless single-branch filter.
  const isAdmin = profile !== null && profile.branch_id === null
  // Wholesale runs on a completely separate workflow than retail (its own product codes,
  // customer orders, factory vouchers) — none of the import/sale/inventory/purchase/
  // history/overview screens apply to it, so a wholesale account only sees the wholesale
  // nav. Admin sees both, since admin already sees every branch's data elsewhere.
  const isWholesale = profile !== null && profile.role === 'wholesale'
  // A wholesale-only account has no use for the retail-shaped default landing section — its
  // nav never offers 'import' to click into, so 'import' here can only mean "still on the
  // untouched initial value," and we substitute its own nav's first item instead. Derived
  // at render time (not corrected after the fact via an effect) so there's no frame where
  // the wrong section's UI briefly renders before a correction catches up.
  const section: Section = rawSection === 'import' && isWholesale ? 'orders' : rawSection
  const branchOptions = useBranches(isAdmin ? session : null)

  const saleFilters: DataTableFilter<SaleRow>[] = useMemo(
    () => [
      { type: 'search', keys: ['StockCode', 'Description'], placeholder: 'Stock code or description' },
      { type: 'select', key: 'Branch', label: 'Branch', options: branchOptions },
      { type: 'dateRange', key: 'Date', label: 'Date' }
    ],
    [branchOptions]
  )

  const inventoryFilters: DataTableFilter<InventoryRow>[] = useMemo(
    () => [
      { type: 'search', keys: ['StockCode', 'Description'], placeholder: 'Stock code or description' },
      { type: 'select', key: 'Branch', label: 'Branch', options: branchOptions },
      { type: 'select', key: 'Group', label: 'Group' },
      { type: 'dateRange', key: 'Snapshot_At', label: 'Last Updated' }
    ],
    [branchOptions]
  )

  const purchaseFilters: DataTableFilter<PurchaseRow>[] = useMemo(
    () => [
      { type: 'search', keys: ['StockCode', 'Description'], placeholder: 'Stock code or description' },
      { type: 'select', key: 'Branch', label: 'Branch', options: branchOptions },
      { type: 'dateRange', key: 'Date', label: 'Date' }
    ],
    [branchOptions]
  )

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (mode === 'sign-in') {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) showToast('error', error.message)
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) {
          showToast('error', error.message)
          return
        }
        if (!data.session) {
          showToast('info', 'Account created — check your email to confirm before signing in.')
          setMode('sign-in')
        }
      }
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDemoLogin(demoEmail: string): Promise<void> {
    const { error } = await supabase.auth.signInWithPassword({
      email: demoEmail,
      password: '123456'
    })
    if (error) showToast('error', error.message)
  }

  async function handleSignOut(): Promise<void> {
    await supabase.auth.signOut()
    setMe(null)
  }

  async function callMe(): Promise<void> {
    if (!session) return
    const response = await fetch(`${apiBaseUrl}/api/me`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
    setMe(response.ok ? JSON.stringify(await response.json(), null, 2) : `Error: ${response.status}`)
  }

  function handleSectionChange(id: string): void {
    setPendingImport(null)
    setViewingBatchId(null)
    setSection(id as Section)
  }

  function handleFileReady(pending: PendingImport): void {
    setPendingImport(pending)
  }

  function handleImportConfirmed(): void {
    showToast('success', `${pendingImport?.importLabel} imported successfully`)
    setPendingImport(null)
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
    )
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
    )
  }

  return (
    <AppShell
      navItems={isWholesale ? WHOLESALE_NAV_ITEMS : isAdmin ? [...NAV_ITEMS, ...WHOLESALE_NAV_ITEMS] : NAV_ITEMS}
      activeSection={section}
      onSectionChange={handleSectionChange}
      email={session.user.email}
      profile={profile}
      onSignOut={handleSignOut}
      debugAction={import.meta.env.DEV ? { label: 'Call /api/me', onClick: callMe } : undefined}
      debugResult={me}
    >
      {pendingImport ? (
        <ImportReviewPage
          session={session}
          profile={profile}
          pending={pendingImport}
          onBack={() => setPendingImport(null)}
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
          {section === 'import' && (
            <div>
              <h2 className="text-lg font-semibold text-text-primary tracking-tight mb-1">
                {SECTION_TITLES[section]}
              </h2>
              <p className="text-sm text-text-muted mb-4">
                Upload a POS export to preview the cleaned data before saving it.
              </p>
            </div>
          )}

          {section === 'import' && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FileImportCard
                  session={session}
                  label="Sales"
                  description="Daily sales slip exports"
                  endpoint="/api/imports/sales"
                  icon={<SalesIcon />}
                  onFileReady={handleFileReady}
                />
                <FileImportCard
                  session={session}
                  label="Purchase"
                  description="Stock purchase records"
                  endpoint="/api/imports/purchase"
                  icon={<PurchaseIcon />}
                  onFileReady={handleFileReady}
                />
              </div>
              <FileImportCard
                session={session}
                label="Inventory"
                description="Monthly stock snapshots"
                endpoint="/api/imports/inventory"
                icon={<InventoryIcon />}
                onFileReady={handleFileReady}
              />
            </div>
          )}

          {section === 'history' && (
            <ImportHistoryTable session={session} onViewBatch={setViewingBatchId} branchOptions={branchOptions} />
          )}
          {section === 'importOverview' && <ImportOverviewPage session={session} />}
          {section === 'overview' && <DataOverviewTable session={session} branchOptions={branchOptions} />}
          {section === 'sales' && (
            <SimpleDataTable<SaleRow>
              session={session}
              endpoint="/api/sales"
              title="Sale"
              description="Every sale line, with profit and margin calculated from the latest known buying price."
              icon={<SalesIcon />}
              columns={SALE_COLUMNS}
              filters={saleFilters}
              rowKey={(row, i) => `${row.SlipNumber}-${i}`}
              emptyTitle="No sales yet"
              emptyDescription="Import a sales file to see it here."
            />
          )}
          {section === 'inventory' && (
            <SimpleDataTable<InventoryRow>
              session={session}
              endpoint="/api/inventory"
              title="Inventory"
              description="Current stock on hand, from each product's most recent inventory snapshot."
              icon={<InventoryIcon />}
              columns={INVENTORY_COLUMNS}
              filters={inventoryFilters}
              rowKey={(row, i) => `${row.StockCode}-${row.Branch}-${i}`}
              emptyTitle="No inventory yet"
              emptyDescription="Import an inventory file to see it here."
            />
          )}
          {section === 'purchase' && (
            <SimpleDataTable<PurchaseRow>
              session={session}
              endpoint="/api/purchases"
              title="Purchase"
              description="Every purchase line from confirmed purchase imports."
              icon={<PurchaseIcon />}
              columns={PURCHASE_COLUMNS}
              filters={purchaseFilters}
              rowKey={(row, i) => `${row.StockCode}-${row.Date}-${i}`}
              emptyTitle="No purchases yet"
              emptyDescription="Import a purchase file to see it here."
            />
          )}
          {section === 'orders' && <CustomerOrdersPage session={session} profile={profile} />}
          {section === 'vouchers' && <FactoryVouchersPage session={session} profile={profile} />}
        </>
      )}
    </AppShell>
  )
}

export default App
