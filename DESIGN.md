# Design System

## Stack
- framework: Electron + React 19 (electron-vite) — renderer at `frontend/renderer`
- styling: Tailwind CSS 3 (`frontend/renderer/src/styles/globals.css`)
- components: custom primitives (no external component library)
- animation: CSS transitions/keyframes only (no animation library — kept the Electron bundle lean)
- icons: inline SVG (no icon library dependency)

## Path map (adapted from the `vite-react-tailwind` preset for this project's electron-vite layout)

| Resource | Path |
|---|---|
| Components (primitives) | `frontend/renderer/src/components/ui/` |
| Components (features) | `frontend/renderer/src/components/features/` |
| Utils | `frontend/renderer/src/lib/utils.ts` |
| Global styles | `frontend/renderer/src/styles/globals.css` |
| Tailwind config | `tailwind.config.ts` (repo root) |
| Path alias | `@renderer` → `frontend/renderer/src` (already defined in `electron.vite.config.ts` / `tsconfig.web.json`, reused rather than adding a second `@` alias) |

## Tokens
- brand: `#6366f1` (indigo) / dark `#818cf8`
- bg-base: `#ffffff` / dark `#0f1117`
- text-primary: `#111827` / dark `#f9fafb`
- radius: 8px (`md`), 12px (`lg`)
- shadow: layered (xs–xl), see `globals.css`
- full token map in `frontend/renderer/src/styles/globals.css`

## Decisions
- 2026-08-23 — init: Vite+React detected, no Tailwind present → installed Tailwind 3 + `clsx`/`tailwind-merge`, adapted the `vite-react-tailwind` preset's paths to this project's electron-vite renderer layout (`frontend/renderer/src` instead of `src`). Reused the existing `@renderer` alias instead of adding `@`.
- 2026-08-23 — full UI recreation requested ("clean and pretty", don't reference existing design). Existing app had zero styling (bare HTML elements). Rebuilt from scratch: primitives (Button, Input, Card, Badge, Spinner, EmptyState, Skeleton, Table) then features (AuthScreen, AppShell, FileImportCard, ImportHistoryTable), preserving all existing functionality (auth flow, demo logins, 3 import types with preview/confirm, branch picker, import history + revert).
- 2026-08-23 — theme: `minimal-light`-leaning custom palette (indigo brand, neutral greys), dark mode via `.dark` class token overrides, not yet wired to a toggle (Electron `prefers-color-scheme` follows OS — left as a follow-up, not blocking this pass).
- 2026-08-23 — navigation: switched `AppShell` from a top bar to a left sidebar (256px, collapses to a drawer under `lg`) with 6 sections: Import, Import History, Data Overview, Sale, Inventory, Purchase. Only Import and Import History are functional; the other 4 render a `ComingSoon` placeholder (reuses `EmptyState`) since they need new backend list endpoints that don't exist yet — scoped as a deliberate follow-up, not this pass. Centralized icons (previously duplicated per-component) into `components/ui/icons.tsx`.
- 2026-08-23 — import flow split into two steps: `FileImportCard` (`components/features/FileImportCard.tsx`) is now upload-trigger only — picking a file parses it via the preview endpoint and hands off to a new full-width `ImportReviewPage` (`components/features/ImportReviewPage.tsx`) showing the origin/clean tables, branch picker, and Confirm action. Import page layout changed from 3 cards in one row to Sale+Purchase side by side with Inventory in its own row below. Shared types moved to `components/features/types.ts` (`ImportPreviewResult`, `PendingImport`).
- 2026-08-23 — notifications moved to toasts (`components/ui/Toast.tsx` + `lib/toast.tsx`'s `ToastProvider`/`useToast()`, fixed bottom-right, wrapped around `<App />` in `main.tsx`). Replaced the scattered inline error/notice banners in `FileImportCard`, `ImportReviewPage`, `ImportHistoryTable`, and `AuthScreen` — transient status only; field-level guidance (e.g. "select a branch first") stays inline next to the control it's about. Confirming an import now fires a single plain success toast instead of a summary banner (the summary already lives in Import History — no duplication). Added numeric row validation: `validate_rows()` in `import_common.py` checks each numeric column per import type against rules owned by each `*_import.py` module (`VALIDATION_RULES`) — parseability always, plus a minimum for some (Sales `Qty>=1`/`Selling_Price>=0`, Inventory `On_Hand_Qty>=0`, Purchase `Quantity>=1`/`Buying_Price>=0`). Preview responses carry `clean.row_issues` and `origin.row_issues` (same shape: `{column, message}[]` per row, `origin`'s mapped from `clean`'s via each parser stashing `df.attrs["origin_indices"]`) so `ImportReviewPage` highlights the same rows yellow (`bg-warning-subtle`) in both the Cleaned and Original data tables. Warn-only — Confirm Import stays enabled regardless.
- 2026-08-23 — validation messages made plain-language for non-technical shop staff: `import_common.py` now generates a human `message` per issue (e.g. "Quantity can't be zero — enter at least 1", "Selling Price can't be a negative number") via `_friendly_label`/`_describe_failure`, derived from the same rule (column + minimum) rather than hardcoded per-rule text, so wording can't drift from the actual rule. Shown directly, not hover-only: both Cleaned and Original tables in `ImportReviewPage` get a trailing "Note" column (only rendered when at least one row has an issue) showing the message text right in the row, no interaction needed to see it. `Tr` (`components/ui/Table.tsx`) now forwards all HTML attributes (was `children`/`className` only) — kept for future use even though the tooltip approach was replaced by the always-visible column.
- 2026-08-23 — review tables reworked for a spreadsheet feel and to reclaim screen space: dropped the `Card` wrapper around `ImportReviewPage`'s tables/tabs/footer (was eating horizontal padding on both sides for no real benefit there). Removed `AppShell`'s `max-w-5xl mx-auto` cap on the main content area — content now genuinely tracks the window width instead of plateauing past ~1024px, which was the actual blocker on "the table doesn't get wider." `Table.tsx` primitives: replaced the table's blanket `min-w-[640px]` (was forcing horizontal scroll even when content could fit) with per-cell borders (`border-b border-r border-border` on `Th`/`Td`, replacing `Tbody`'s `divide-y`) for full Excel-style gridlines. Added a sticky `#` row-number column (`ROW_NUM_CLASS` in `ImportReviewPage.tsx`, `position: sticky; left: 0`, background matches the row's warning state) to both tables — stays visible while scrolling horizontally through a 15-column sales row, like a frozen spreadsheet column. The Note column now has an explicit `min-w-[22rem]` and renders each issue as its own bulleted line (`NoteCell`) instead of a period-joined run-on string.
- 2026-08-23 — `ImportReviewPage` no longer boxes the table in a fixed-height scroll well (`max-h-[32rem]` removed from both `TableContainer` calls) — the table now renders at full height and the page itself scrolls, matching how the rest of the app scrolls. The Branch selector + Confirm Import + Cancel controls moved from below the table to directly above it (right after the validation warning banner), so they're reachable without scrolling past a potentially long table first. `Table.tsx`'s `Thead` primitive is now `sticky top-14 lg:top-0 z-20 bg-bg-subtle` (`top-14` clears the mobile top bar, which is itself `sticky top-0`; `lg:top-0` because the desktop sidebar is `fixed` and reserves no top-bar space) — the header row stays pinned while the page scrolls vertically, composing with the existing sticky-left row-number column (`ROW_NUM_CLASS`, unchanged) for a frozen-corner spreadsheet feel. This is a primitive-level change, so `ImportHistoryTable` inherits the sticky header too. The "Original data" tab has no `Thead` (raw grid rows only), so it's unaffected — horizontal scroll (`TableContainer`'s `overflow-x-auto`) and the frozen row-number column were left exactly as they were on both tabs.
- 2026-08-23 — applied the same boxless, full-page-scroll treatment to `ImportHistoryTable`: dropped the `Card` wrapper (was padding the sticky header away from the viewport edge and boxing the table in a bordered/shadowed card, same issue `ImportReviewPage`'s tables had). Kept `CardHeader` (title/description + Refresh button) for the header row — it's a standalone markup component, not dependent on `Card` — so the header still sits directly above the table, unchanged in content. It already had no fixed-height scrollbox, so nothing to remove there; the sticky `Thead` now applies cleanly since there's no card padding/border cutting off its stuck position.
- 2026-08-23 — import history rows are now clickable instead of showing a Summary column inline: removed the "Summary" column from `ImportHistoryTable` (was a truncated, period-joined run-on string — not very readable in an 8-column row anyway) and made each `Tr` navigate to a new full-page `ImportHistoryDetailPage` on click (`cursor-pointer`; the Revert button's own click stops propagation so it doesn't also trigger navigation). The detail page shows the batch's metadata (branch/uploader/date/status), the full summary as a row of stat chips, and the same Cleaned/Original tabbed tables as the live review screen — but read-only (no branch picker, no Confirm/Cancel). Extracted the tab-switcher + warning banner + both tables (previously duplicated) out of `ImportReviewPage` into a new shared `ImportDataView` component, taking an optional `controls` slot rendered between the banner and the table so the review page's branch picker/Confirm/Cancel still sit in the same place. Backend: added a `preview_data` JSON column to `import_batches` (migration `6a69cbde81e9`) — the confirm endpoints now snapshot the same origin/clean grid shape the preview endpoints return (via a shared `_build_preview` helper in `app/routers/imports.py`) and store it on the batch, since the persisted `Sale`/`PurchaseLine`/`StockLevel` rows don't preserve the original file layout or row-level validation notes. New `GET /api/imports/history/{batch_id}` endpoint reads it back, same branch-visibility rule as the list/revert endpoints.

## Components

| Component | Path |
|---|---|
| Button | `frontend/renderer/src/components/ui/Button.tsx` |
| Input | `frontend/renderer/src/components/ui/Input.tsx` |
| Card | `frontend/renderer/src/components/ui/Card.tsx` |
| Badge | `frontend/renderer/src/components/ui/Badge.tsx` |
| Spinner | `frontend/renderer/src/components/ui/Spinner.tsx` |
| EmptyState | `frontend/renderer/src/components/ui/EmptyState.tsx` |
| Skeleton | `frontend/renderer/src/components/ui/Skeleton.tsx` |
| Table primitives | `frontend/renderer/src/components/ui/Table.tsx` |
| Select | `frontend/renderer/src/components/ui/Select.tsx` |
| Icons (shared set) | `frontend/renderer/src/components/ui/icons.tsx` |
| Toast + ToastProvider | `frontend/renderer/src/components/ui/Toast.tsx`, `frontend/renderer/src/lib/toast.tsx` |
| AuthScreen | `frontend/renderer/src/components/features/AuthScreen.tsx` |
| AppShell (sidebar layout) | `frontend/renderer/src/components/features/AppShell.tsx` |
| ImportDataView (shared clean/original tabs + tables) | `frontend/renderer/src/components/features/ImportDataView.tsx` |
| ImportReviewPage | `frontend/renderer/src/components/features/ImportReviewPage.tsx` |
| ImportHistoryDetailPage | `frontend/renderer/src/components/features/ImportHistoryDetailPage.tsx` |
| FileImportCard | `frontend/renderer/src/components/features/FileImportCard.tsx` |
| ImportHistoryTable | `frontend/renderer/src/components/features/ImportHistoryTable.tsx` |

## Non-Goals
- No Figma sync
- No image generation
- No dark-mode toggle UI yet (tokens support it; no switch wired up)
