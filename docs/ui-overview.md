# Branchwise UI Overview

Purpose of this doc: a complete inventory of the app's current UI — screens, layout, components, states, and design tokens — written so it can be handed to another designer/AI to propose visual design improvements without needing to read the source code.

App type: Electron desktop app (fixed-ish window, but layout is responsive down to mobile widths), React + Tailwind CSS, light/dark theme support built in via CSS variables.

## 1. Design tokens (current)

Defined as CSS variables in `frontend/renderer/src/styles/globals.css`, consumed via Tailwind utility classes (e.g. `bg-bg-base`, `text-text-primary`, `border-border`, `bg-brand`).

**Backgrounds** (3 layers of depth)

- `bg-base` (#ffffff light / #0f1117 dark) — cards, inputs, the main content surface
- `bg-subtle` (#f9fafb light / #161b27 dark) — page background, table header row, tab-strip track
- `bg-raised` (#f3f4f6 light / #1e2535 dark) — hover states, skeleton blocks, default badges
- `bg-overlay` — subtle black/white wash (currently barely used)

**Text**

- `text-primary` #111827 / #f9fafb — headings, body, table cell values
- `text-secondary` #374151 / #d1d5db — nav labels, form labels
- `text-muted` #6b7280 / #9ca3af — descriptions, placeholders, table headers, timestamps
- `text-disabled`, `text-inverse` (white-on-brand)

**Brand** — indigo: `#6366f1` (light) / `#818cf8` (dark), with `hover`/`active`/`subtle` steps. Used for primary buttons, active nav item, focus rings, links, the logo mark.

**Semantic** — success (emerald `#10b981`), warning (amber `#f59e0b`), error (red `#ef4444`), info (blue `#3b82f6`), each with a paired `-subtle` background tint. Used in badges, toasts, the "invalid row" warning banner.

**Borders**: `border` (8% black/white), `border-strong` (16%), `border-brand`.

**Shadows**: `xs` through `xl`, generally very light (cards use `shadow-sm`, dropdowns/modals would use `md`/`lg`).

**Radius**: `sm` 4px, `md` 8px (buttons/inputs/table), `lg` 12px (cards), `xl` 16px (auth logo mark), `full` (badges, pills, avatar-style icon chips).

**Typography**: system font stack (`-apple-system, Segoe UI, Roboto...`), no custom webfont. Monospace stack for the debug JSON dump only. No type scale is defined beyond ad hoc Tailwind sizes (`text-xs` / `text-sm` / `text-base` / `text-lg`) — there's no documented heading hierarchy (h1/h2/h3 sizes) beyond what's used inline.

**Motion**: small, consistent — `transition-all duration-150` on interactive elements, `active:scale-[0.98]` press feedback on buttons, `animate-fade-in`/`animate-slide-up` for screen/toast entrances, all respecting `prefers-reduced-motion`.

This is a fairly generic "shadcn-adjacent" indigo SaaS palette — competent but not distinctive. A design pass could reasonably start here: brand personality, type scale, and information density are the biggest open questions.

## 1b. Data fetching and caching

`frontend/renderer/src/lib/useCachedFetch.ts` backs the dashboard tabs and the Warning
page. It exists because `App.tsx` renders each section as `{section === 'x' && ...}` and
`DashboardPage` does the same per tab — so navigating away _unmounts_ the component and
destroys its state, and coming back was always a fresh mount: skeleton, refetch, wait.
On the heaviest page that was a couple of seconds every single time, which is what made
the app feel slow.

The cache key is the full request URL, so any change to period, date range or branch is
a different key and fetches properly. Beyond that a cached entry is reused until one of
four things happens: `invalidateCachedPages()` is called (from confirming an import in
`ImportReviewPage`, from reverting one in `ImportHistoryTable` — the only things that
change the sale/inventory/purchase data these pages read — and from saving any business
setting other than the theme in `appSettings.updateSettings`, since a health weight, an
alert threshold or a check window changes what the server computes _from_ that data, and
without it an admin could save a new weight and return to a dashboard still scored under
the old one);
`useImportedDataWatch` (called once in `App.tsx`) notices that _someone else_ changed it,
by polling `GET /api/imports/data-version` every minute and on window focus — a token
built from the newest created/reverted import-batch timestamps and the batch count,
scoped to the branch the account can see, so another branch's import doesn't invalidate
anything here; the entry ages past five minutes, now only a backstop against a page left
open all day; or the caller calls `reload()`. `clearFetchCache()` runs on sign
out, since the next account may be scoped to a different branch.

When an entry is reused but needs revalidating, the hook returns the old data
immediately and refetches behind it with `isRefreshing` set, which the tabs render as a
quiet `RefreshingHint`. A skeleton says "you have nothing"; last minute's numbers say
"here's what we knew" — for a dashboard the second is nearly always better. A background
refresh that fails leaves the good data on screen and only toasts.

### 1c. Not losing the user's place

Two rules the app has to follow, both learned the hard way:

**A token refresh must not blank the app.** Supabase refreshes the access token whenever
the window regains focus, which fires `onAuthStateChange` and re-runs `App.tsx`'s
profile-loading effect. That effect used to set `profileLoading` every time, and
`profileLoading` renders a full-screen spinner — unmounting every page below it. The
visible symptom was that switching to another app and back reset the Dashboard to its
first tab, closed whichever branch was open, and cleared every table filter. The spinner
now shows only on the _first_ load, when there is no profile yet; later refreshes happen
silently behind whatever is on screen.

**State a user navigates back to belongs above the thing that unmounts.** `App.tsx` renders
sections as `{section === 'x' && ...}` and `DashboardPage` renders tabs the same way, so
moving away destroys the component. Anything the user expects to find again on return has
to be held higher up: which branch the Overview tab has open lives in `App.tsx`, so going
Overview → Revenue → Overview comes back to that branch's page rather than the branch
list. Only "← All branches" clears it.

## 2. Global layout (`AppShell`)

Two states depending on viewport:

- **Desktop (`lg:` and up)**: fixed 256px-wide left sidebar + fluid main content area. Sidebar has three stacked zones:
  1. Header (64px): app icon (indigo rounded-square logo mark) + "Branchwise" wordmark.
  2. Nav list: one row per section, icon + label, 40px tall, active item gets an indigo-tinted background and indigo text; others are plain text that highlight on hover.
  3. Footer: current user's name (or email if no profile name) + role badge + branch name (plain text) + full-width "Sign out" secondary button + a collapsible "Debug" `<details>` block (dev-only: a button that calls `/api/me` and dumps the JSON response in a `<pre>`).
- **Mobile**: sidebar collapses into a 56px sticky top bar (hamburger icon + wordmark). Tapping the hamburger opens the same sidebar content as a left-anchored drawer over a dark scrim, closable by tapping the scrim.

Main content area: `padding: 32px 16–24px`, vertical stack (`gap-8`) of a page title + optional description, then the section's content.

**Navigation items are role-dependent**, all implemented (no more "Coming soon" placeholders):

- **Admin and development** see both workspaces and all operational screens. **Retail management** sees the full retail nav; a plain **retail** account sees only Import and Import History.
- **Wholesale** accounts see the wholesale nav — this was an empty placeholder as of 2026-09-11 while the workflow was being redesigned from scratch, but it has since been rebuilt into a real multi-screen workflow (Customer Orders, Supplier Vouchers, Shipment, Receiving, Inventory, Finance, Master Data, plus a Dashboard with Summary, Revenue, Cost, Customer and Inventory tabs) — see [wholesale/](./wholesale/) rather than trusting the "empty placeholder" description, which is stale.
- **Admin** has all settings and operational access, but its Dashboard shows only Summary and Health; Revenue, Cost, Inventory, and Customer are hidden and rejected by the API.
- **Development** can additionally assign and manage every role, including development.

## 3. Screens

### 3.1 Auth screen (`AuthScreen`)

Shown instead of the app shell whenever there's no active session. Centered card layout, max-width ~384px, vertically centered on the page.

- App mark (indigo rounded-square icon, a simple house/building glyph) + "Branchwise" title + subtitle "Sign in to manage your branch's data".
- White card containing:
  - A 2-tab segmented control: **Sign in** / **Sign up** (pill-style, active tab has a white pill + shadow inside a gray track).
  - A form: Email input, Password input (both full-width, labeled), and a full-width primary submit button (label changes to "Create account" in sign-up mode; shows an inline spinner while submitting).
- Below the card, in dev builds only: a "Demo accounts · password 12345678" section with 5 small pill buttons (Admin, Wholesale, AungThitSar, Ashley, Retail 3) that one-click sign in as seeded test accounts.

No password-reset / forgot-password flow exists yet. Sign-up success (no immediate session, i.e. email confirmation required) shows a toast and flips back to the sign-in tab rather than showing a dedicated confirmation screen.

### 3.2 Import ("Import data")

> After login the app opens on **Dashboard** for admin, development and retail-management accounts (`App.tsx` starts with `section = "dashboard"`). A plain `retail` account has no Dashboard in its nav, so it falls back to Import; a wholesale account falls back to the first item in the wholesale nav (its Dashboard).

Page description: "Upload a POS export to preview the cleaned data before saving it."

Three upload cards in a responsive grid (Sales + Purchase side-by-side on ≥small screens, Inventory full-width below):

- **FileImportCard**: card header = small indigo icon chip + type label ("Sales" / "Purchase" / "Inventory") + one-line description of what kind of report it expects. Body is a large dashed-border drop-zone-style button ("Click to choose a file", accepts .csv/.xls/.xlsx) — note it's click-to-browse only, not an actual drag-and-drop target despite the visual styling suggesting one. While uploading, the drop-zone is replaced by 3 pulsing skeleton bars.
- On successful upload/parse, the app navigates (in-place, not a route change) to the **Import Review** page.

### 3.3 Import Review page (`ImportReviewPage`)

Reached right after picking a file; shows the parsed-but-not-yet-saved data so the user can sanity-check it before committing.

- Back button (chevron) + "Review {Sales/Purchase/Inventory} import" heading + filename subtitle.
- The shared **Import data table** (see 3.6) with an extra controls row injected above the table: a Branch `<select>` (only shown for users with no fixed branch, i.e. admin accounts — required field, shows a validation error if the user hits Confirm without picking one) + "Confirm Import" primary button (loading state while saving) + "Cancel" ghost button (returns to the Import section, discarding the pending file).

### 3.4 Import History (`ImportHistoryTable`)

List of every confirmed import batch, each row clickable to drill into detail.

- Header: title + description ("Every confirmed upload, with the option to revert a mistaken one.") + a "Refresh" secondary button (top-right).
- States: loading → 4-row table skeleton; load failure → empty-state illustration + "Couldn't load import history" + Try again button; zero rows → empty-state "No imports yet"; otherwise a data table.
- Table columns: **Type** (capitalized: sale/inventory/purchase), **Filename** (truncated), **Branch**, **Uploaded by**, **Status** (badge — green "completed", gray otherwise, e.g. "reverted"), **Created** (localized date+time), and a trailing action column with a **Revert** destructive-red button (only shown for completed batches; confirms via a native `window.confirm` dialog, then deletes the batch's data rows server-side while keeping the batch record itself as an audit trail marked reverted).
- Rows are grouped under a date divider ("Today (25 Sep)", "Yesterday (24 Sep)", then the date), and **Uploaded by** shows a small person icon before the name.
- Clicking anywhere on a row (other than the Revert button) opens the Import History Detail page for that batch.

### 3.5 Import History Detail (`ImportHistoryDetailPage`)

Read-only view of one past import batch — same visual shape as the Review page, minus the ability to confirm/re-save.

- Back button + "{Type} import" heading + filename.
- Loading: centered spinner. Load failure: toast error + auto-navigates back.
- Metadata row: Branch, Uploaded by, Date, and a status badge, laid out inline with muted labels / bold values.
- A row of small pill-shaped summary stat chips, one per key in the batch's summary payload (e.g. rows imported, rows skipped — whatever the backend returns; keys are auto-humanized from snake_case, `batch_id` is filtered out).
- The same shared **Import data table** below (read-only, no controls row).

### 3.6 Shared "Import data" table (`ImportDataView`)

Used by both the Review page and the History Detail page — this is the core "did the cleaning pipeline get this right" artifact in the app.

- A 2-tab segmented control: **Cleaned data** / **Original data**.
  - Cleaned tab: shows the structured, typed output (one column per parsed field) plus a row-number column pinned to the left.
  - Original tab: shows the raw source grid as-is (no column headers, since raw POS exports don't have clean tabular headers) — same row numbering.
- If any rows have data-quality issues (e.g. a suspicious/unparseable number), a warning banner appears above the table ("N rows below have numbers that don't look right — see the note on each yellow row."), those rows get a yellow/warning background tint in **both** tabs, and (cleaned tab only) an extra trailing **Note** column lists the specific issue message(s) per row with small bullet markers.
- This is a wide, dense, horizontally-scrolling spreadsheet-style table (sticky header, sticky first column, gridlines on every cell) — for large imports (hundreds of rows) this is effectively a raw data dump with no pagination, filtering, or search.

### 3.7 Data Overview (`DataOverviewTable`)

A single wide merged table: sales line items joined with inventory and purchase data by stock code — the closest thing the app has to an "analytics/reporting" view today.

- Header + description explaining the color coding + Refresh button. Same loading-skeleton / error-empty-state / zero-rows-empty-state pattern as Import History.
- Each column header has a small "source strip" above its label — 1–3 tiny colored bars (green = came from sale.csv, blue = inventory, pink = purchase; a column can show more than one color if it's populated from multiple sources, e.g. Stock Code shows all three).
- 18 columns total: Date, Slip ID, Slip Number, Line No, Line ID, Stock Code, Description, Location, Selling Price, Qty, UOM, Discount Amount, Amount, Net Amount, Time, Buying Price, Group, Profit, Profit Margin %. Money/qty columns are right-aligned with 2-decimal formatting; empty values render as "—".
- No filtering, sorting, date-range picker, search, or per-branch breakdown yet — it's every row, unpaginated, in one flat table. This is the most likely place a redesign would want to introduce real dashboard/analytics UI (charts, KPI tiles, filters) rather than a raw joined table.

### 3.8 Sale, Inventory, Purchase (list tables)

These three nav sections each render a flat, unfiltered table of the corresponding data type, backed by their own `GET /api/sales` / `/api/inventory` / `/api/purchases` endpoints (distinct from the merged Data Overview endpoint) — same shared visual pattern as Data Overview minus the source-color strips, since each table is single-sourced. Header + description + Refresh button; loading skeleton, load-failure empty state, zero-rows empty state, and a dense right-aligned-numbers gridline table, all via one generic `SimpleDataTable` component.

- **Sale**: Branch, Date, Time, Slip Number, Stock Code, Description, Selling Price, Qty, UOM, Discount Amount, Amount, Net Amount, Buying Price, **Profit**, **Profit Margin %** — profit/margin are computed server-side the same way as in Data Overview (latest known purchase price, falling back to the latest inventory snapshot price).
- **Inventory**: Branch, Snapshot At, Stock Code, Description, Group, On Hand Qty, Buying Price, Selling Price, Location — every stock snapshot row (full history, not deduped to "current").
- **Purchase**: Branch, Date, Stock Code, Description, Quantity, UOM, Buying Price, Location.

Same open questions as Data Overview apply here (no pagination/filter/search, one flat table per section) — these are functional first passes, not a finished analytics UI.

### 3.9 Import Health (`ImportHealthPage`)

The Import Hub exposes one branch-card view backed by the existing `GET /api/imports/freshness` and `GET /api/imports/completeness` endpoints. A shared Refresh button reloads both responses, which the frontend merges by `branch_id`.

- Each branch card shows an `All caught up` / `N to check` overall pill and three responsive columns: Sales, Inventory, and Purchase.
- Sales and Inventory reuse the daily freshness grading (Today, Yesterday, or `N days ago`) and show a missing-day chip only when there are open dates. Purchase stays neutral because uploads are occasional and shows purchase-number gap information instead of missing-day counts.
- Clicking a missing-day chip expands date selection for that import type. The card's `Ignored (N)` link expands ignored dates for that branch and allows authorized users to restore them. These interactions reuse the existing completeness close/reopen endpoints.

### 3.10 Warning (`WarningsPage`)

Data-quality issues found in already-imported retail data, backed by `GET /api/warnings`. Retail/admin only — not shown to wholesale accounts (no sale/inventory/purchase data to check).

- Header + description, a 4-tab segmented control (**All** / **Inventory** / **Sale** / **Purchase**) grouping the backend's individual checks into broader categories, and a sidebar nav badge (red pill, count of all open rows across every check) that updates on load and after any import is confirmed.
- Each row: a severity badge (amber "Warning" or red "Critical" — the daily reconciliation mismatch check is the only critical one), Branch, Date (where applicable), Stock Code, Description, and a plain-English note describing the problem (e.g. "Buying Price can't be a negative number (currently -500.00)").
- A row can expand (chevron toggle) into a bordered **Details** grid of every other field the check returned, with the offending field(s) visually called out; if the row is traceable to one confirmed import, the grid includes a "Source Import" link that jumps to Import History with that batch's row highlighted, ready to revert.
- Checks covered: bad numeric values on sale/inventory/purchase lines; stock codes sold or purchased with no inventory record yet; and the daily inventory reconciliation (latest snapshot vs. previous snapshot + purchases − sales since then), split into a "recount these" (mismatch) and a separate "verify by hand" (mixed-unit, can't reliably auto-check) group.

### 3.11 Wholesale

The wholesale workspace is a full set of screens (Dashboard, Customer Orders, Supplier Vouchers, Shipments, Receiving, Inventory, Finance, Master Data). `App.tsx` still contains a leftover `WholesalePlaceholder` ("Wholesale is being rebuilt") for a `wholesale` section, but no nav item leads to it, so nobody sees it. See [wholesale/](./wholesale/) for each screen.

### 3.12 Settings (`SettingsPage`)

Business-wide preferences — the same for every account and device. Every role reaches
the page; only an admin account sees anything editable (the server enforces this too).

Settings are grouped into **seven tabs**, using the same pill tab bar as the Dashboard
and Import Overview (a wholesale account sees only General, Buying price, Branches and
Wholesale):

- **General** — Appearance (the `ThemeSwitcher`: a 3-way Light / Dark / System segmented
  control backed by `data-theme` + `prefers-color-scheme`), the Sale/Purchase list
  default range (90 days), and the Buying Price Source column toggle.
- **Reorder Buffer** — target stock buffer months per ABC tier (A/B/C) for replenishment.
- **Data checks** — the daily check cutoff time (shop close, default 20:00; only the Physical Stock Audit uses it) and how far
  back the Warning page's Sale and Purchase checks look, independently of each other.
  Inventory always checks only the latest snapshot, so there is nothing to configure for it.
- **Buying price** — the three point-in-time pricing windows (purchase lookback,
  inventory lookback, inventory forward fallback).
- **Branch health** — the Overview score's dimension weights, with a running total, and
  every Early Warning rule's firing point. See `docs/retail/branch_health.md`.
- **Branches** — per-branch Sale/Inventory date formats. Per branch, not business-wide.
- **Wholesale** — the MMK exchange rates that prefill new foreign-currency transactions.

The retail-only tabs (Reorder Buffer, Data checks, Branch health) are hidden from a
wholesale account, which has no Warning page or retail dashboard.

## 3b. Wording: one name per thing

The same idea had three names across the app — a sale slip was a _transaction_ on the
Revenue tab, a _visit_ in an alert sentence and a _customer_ in a chart label — which is
exactly how a reader ends up wondering whether they are three different numbers.

**The Dashboard's words are the app's words.** It is where these figures are first met
and most often read, so everything else follows it rather than the other way round:

| Idea                                      | The word we use                  | Never                                    |
| ----------------------------------------- | -------------------------------- | ---------------------------------------- |
| One sale slip                             | **transaction**                  | visit, customer, footfall (in labels)    |
| What one transaction comes to, on average | **average sale**                 | basket, basket value                     |
| How many lines are on one slip            | **items per transaction**        | items per basket, items per visit        |
| Transactions with one line only           | **single-item transactions**     | single-item baskets, single-item visits  |
| Money taken, after returns                | **net revenue** (or **revenue**) | sales (which reads as "number of sales") |

This governs tile captions, chart titles, the measure rows on the Overview page, and the
alert sentences and chips — the alerts were the ones that had drifted, saying "visits"
and "baskets" where the Dashboard says "transactions" and "average sale".

It deliberately does **not** rename data: `transaction_count`, `avg_basket`,
`single_item_basket_share_pct` and the rest keep their names in the API, the payloads and
the database, since renaming those would churn the contract for a wording change and the
mapping is one line of vocabulary, not a second meaning.

## 4. Reusable UI primitives (`components/ui/`)

- **Button** — variants `primary` (solid indigo), `secondary` (white/bordered), `ghost` (text-only), `destructive` (solid red); sizes sm/md/lg; supports a `loading` state that swaps in an inline spinner and disables the button; slight scale-down press animation.
- **Badge** — small pill, variants default/success/warning/error/info/brand. Used for role, import status, etc.
- **Card** + **CardHeader** — white bordered rounded container with `title` + optional `description` + optional right-aligned `action` slot (used for the Refresh buttons on the two data tables).
- **Input** / **Select** — labeled form fields, consistent 40px height, error state turns the border/ring red and shows a message below; Select has a custom chevron icon (native `<select>` underneath, not a custom listbox).
- **Table** (`TableContainer`, `Thead`, `Tbody`, `Tr`, `Th`, `Td`) — spreadsheet-style with full gridlines, sticky header, row hover highlight.
- **EmptyState** — icon chip + title + optional description + optional action button; used for every "no data" / "failed to load" case app-wide.
- **Skeleton** / **TableSkeleton** — pulsing gray placeholder blocks for loading states.
- **Spinner** — small inline SVG spinner (buttons, standalone loading screens).
- **Toast** (`lib/toast.tsx`) — success/error/info variants, colored icon chip + message + dismiss button, slides up, presumably auto-stacks/auto-dismisses (see `lib/toast.tsx` for timing if needed).
- **icons.tsx** — a small hand-rolled icon set (logo, menu/hamburger, upload, history, calendar-check, overview/grid, sales, inventory, purchase, download, construction, chevrons, clipboard, trash, warning, sun/moon/monitor, settings, factory) — simple stroked line icons, no icon library dependency.

## 5. Cross-cutting UX notes worth flagging to a design collaborator

- **No true drag-and-drop** on the file upload cards despite the dashed-border "drop zone" visual convention — currently click-to-browse only.
- **Pagination is uneven**: Import History, Data Overview, Purchasing and the import preview tables page their rows; other tables (for example the Warning page) still render their full result set at once. Search/filter exist only on some screens.
- **Density is very high** by default — every table is a dense spreadsheet grid; there's no "card list" or summarized alternative view.
- **Sale/Inventory/Purchase are functional first passes, not finished** — same dense unfiltered table pattern as Data Overview, so they're fair game for a real redesign rather than a from-scratch build.
- **Dark mode has a visible in-app toggle now** — the Settings page's Appearance card (Light/Dark/System), on top of the existing token-level support (`data-theme="dark"` + `prefers-color-scheme`).
- **Role-based branch context** is a persistent bit of state (shown in the sidebar footer, and drives the branch-picker requirement on import) — any new layout should keep "who am I / which branch am I acting as" visible.
- **Landing screen depends on role**: admin/development/retail-management land on the Dashboard, a plain `retail` account on Import, and a wholesale account on the wholesale Dashboard (their nav has no `import` entry).
- **Wholesale is its own workspace inside the same shell** — its own nav, screens and data model (see `docs/wholesale/`), sharing only the visual language and login. Treat it as its own flow rather than assuming every screen is reachable from every role.
