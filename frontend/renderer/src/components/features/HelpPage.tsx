import { useMemo, useState, type ReactNode } from 'react'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { Badge } from '@renderer/components/ui/Badge'
import { Input } from '@renderer/components/ui/Input'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import {
  SalesIcon,
  InventoryIcon,
  PurchaseIcon,
  WarningIcon,
  UploadIcon,
  DollarIcon,
  ConstructionIcon,
  SearchIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClipboardIcon,
  FactoryIcon,
  WarehouseIcon,
  ReceivingIcon,
  ChatIcon
} from '@renderer/components/ui/icons'

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'brand'

interface SourceRow {
  label: string
  variant: BadgeVariant
  description: string
}

function SourceLegend({ rows }: { rows: SourceRow[] }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      {rows.map((row, i) => (
        <div
          key={row.label}
          className={`flex items-start gap-3 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
        >
          <Badge variant={row.variant} className="mt-0.5 shrink-0">
            {row.label}
          </Badge>
          <p className="text-sm text-text-secondary leading-relaxed">{row.description}</p>
        </div>
      ))}
    </div>
  )
}

interface IconRow {
  icon: ReactNode
  dotColor: string
  title: string
  description: string
}

function IconRowList({ rows }: { rows: IconRow[] }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      {rows.map((row, i) => (
        <div
          key={row.title}
          className={`flex items-start gap-3 py-3 ${i > 0 ? 'border-t border-border' : ''}`}
        >
          <div
            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-white ${row.dotColor}`}
          >
            {row.icon}
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">{row.title}</div>
            <p className="text-sm text-text-secondary leading-relaxed mt-0.5">{row.description}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function Callout({
  tone,
  title,
  children
}: {
  tone: 'warning' | 'info'
  title: string
  children: ReactNode
}): React.JSX.Element {
  const toneClasses = tone === 'warning' ? 'bg-warning-subtle' : 'bg-info-subtle'
  const iconColor = tone === 'warning' ? 'text-warning' : 'text-info'
  return (
    <div className={`flex gap-3 rounded-lg p-4 ${toneClasses}`}>
      <WarningIcon className={`w-5 h-5 shrink-0 mt-0.5 ${iconColor}`} />
      <div>
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        <div className="text-sm text-text-secondary mt-1 leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

function ProcessSteps({ steps }: { steps: string[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {steps.map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          {i > 0 && <span className="text-text-disabled">→</span>}
          <div className="flex items-center gap-2 rounded-full bg-bg-raised pl-2 pr-3 py-1.5">
            <span className="w-5 h-5 rounded-full bg-brand text-white text-xs font-semibold flex items-center justify-center shrink-0">
              {i + 1}
            </span>
            <span className="text-sm font-medium text-text-primary whitespace-nowrap">{step}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// --- Help content -----------------------------------------------------------------------
//
// Content is organized as categories, each holding one or more articles. To add a new
// article to an existing topic, push onto that category's `articles` array; to add a whole
// new topic, push a new category onto HELP_CATEGORIES. Nothing else in this file needs to
// change — the sidebar, search index, and content pane all derive from this list.

interface HelpArticle {
  id: string
  title: string
  summary: string
  keywords?: string
  render: () => ReactNode
}

interface HelpCategory {
  id: string
  label: string
  description: string
  icon: ReactNode
  articles: HelpArticle[]
}

const HELP_CATEGORIES: HelpCategory[] = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    description: 'Where data comes from and how it flows into the system.',
    icon: <UploadIcon className="w-4 h-4" />,
    articles: [
      {
        id: 'how-data-gets-in',
        title: 'How data gets in',
        summary: 'The three-step flow every retail import goes through, and how Wholesale differs.',
        keywords: 'upload clean review confirm save csv xls xlsx pos export',
        render: () => (
          <div className="flex flex-col gap-4">
            <ProcessSteps steps={['Upload', 'Clean & review', 'Confirm & save']} />
            <p className="text-sm text-text-secondary leading-relaxed">
              Retail branches upload their POS exports (Sale, Inventory, Purchase) as CSV/XLS/XLSX
              files. Each one is cleaned automatically — messy printed-report formatting, mixed
              Myanmar text encoding, and so on — then shown for review before it's confirmed and
              saved.
            </p>
            <div className="flex gap-3 rounded-lg bg-bg-raised p-4">
              <div className="text-sm text-text-secondary leading-relaxed">
                <span className="font-medium text-text-primary">Wholesale works differently:</span>{' '}
                Customer Orders and Factory Vouchers are typed in directly rather than imported, and
                use their own product codes that aren't connected to the retail product catalog at
                all. An admin account sees both sides; a retail or wholesale account only sees its
                own.
              </div>
            </div>
          </div>
        )
      },
      {
        id: 'sale-purchase-vs-overview',
        title: 'Sale/Purchase pages vs Data Overview',
        summary: "Same underlying data, three different windows onto it — a common source of confusion.",
        keywords: '90 days default range window filter data overview inventory missing disappeared',
        render: () => (
          <div className="flex flex-col gap-4">
            <SourceLegend
              rows={[
                {
                  label: 'Sale / Purchase',
                  variant: 'brand',
                  description:
                    "Only shows a recent window by default (90 days, admin-configurable in Settings → Sale & Purchase list default range) — otherwise the table would only get slower to load as more history piles up. Use the date filter at the top of the page to look further back, or clear it to return to the default window."
                },
                {
                  label: 'Data Overview',
                  variant: 'info',
                  description:
                    'Shows every sale line ever imported, no date limit at all, merged with inventory/purchase pricing context. Best for full-history exports; can take longer to load once a branch has years of data.'
                },
                {
                  label: 'Inventory',
                  variant: 'warning',
                  description:
                    "Different again — it never shows history, only each product's single most recent count (its Last Updated column). Filtering by Last Updated narrows down to \"which products' most recent count happens to fall in this range,\" not \"what was in stock as of this date.\" A product with no recent recount simply won't appear, even though it still has stock."
                }
              ]}
            />
            <Callout tone="info" title="Rule of thumb">
              If a number "disappears" as soon as you add a date filter, it's almost always still
              there — just outside the window you asked for. Widen or clear the filter before
              assuming data is missing.
            </Callout>
          </div>
        )
      },
      {
        id: 'import-history-fix',
        title: 'Import History — fixing a bad import',
        summary: 'What the Reimport and Remove buttons on each row actually do.',
        keywords: 'reimport remove removed completed reverted duplicate wrong branch wrong file undo history locked',
        render: () => (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary leading-relaxed">
              Every confirmed import (Sale, Inventory, or Purchase) shows up as its own row in{' '}
              <span className="font-medium text-text-primary">Import History</span>, with a{' '}
              <span className="font-medium text-text-primary">Status</span> of{' '}
              <span className="font-medium text-text-primary">Completed</span>. Click a row to see
              exactly what it added. If a file turns out to be wrong (wrong branch, wrong date,
              bad values), that row has two buttons:
            </p>
            <SourceLegend
              rows={[
                {
                  label: 'Reimport',
                  variant: 'brand',
                  description:
                    "Pick a corrected file to replace this import — it removes the original data and confirms the new file in one action. Status becomes Reimported."
                },
                {
                  label: 'Remove',
                  variant: 'error',
                  description:
                    "Just deletes the data this import added, with nothing to replace it yet — a confirmation box asks first. Status becomes Removed. The row itself always stays, as a record that it happened, not a silent erase."
                }
              ]}
            />
            <Callout tone="warning" title="Don't just re-upload a Purchase file on its own">
              Sale imports are safe to re-upload on their own — already-imported slips are
              automatically skipped.{' '}
              <span className="font-medium text-text-primary">Purchase imports are not</span> —
              nothing recognizes "this is the same one again," so uploading a corrected purchase
              file through the normal Import page (instead of using Reimport on the bad row) will
              double-count everything in it.
            </Callout>
            <p className="text-sm text-text-secondary leading-relaxed">
              A retail account can only Reimport or Remove a row within 1 day of importing it —
              past that, the buttons are replaced with a "Locked" label. An admin account has no
              such limit.
            </p>
          </div>
        )
      }
    ]
  },
  {
    id: 'costing-profit',
    label: 'Costing & Profit',
    description: 'How Buying Price and Profit are calculated, and the setting that controls it.',
    icon: <DollarIcon className="w-4 h-4" />,
    articles: [
      {
        id: 'buying-price-profit-source',
        title: 'Buying Price, Profit & Buying Price Source',
        summary: 'What those columns on the Sale and Data Overview tables actually mean.',
        keywords: 'buying price profit margin source purchase stock count recount blank',
        render: () => (
          <div className="flex flex-col gap-5">
            <p className="text-sm text-text-secondary leading-relaxed">
              <span className="font-medium text-text-primary">Buying Price</span> is what the system
              believes a product cost on the day it was sold — not today's cost, the cost as of that
              sale's own date. <span className="font-medium text-text-primary">Profit</span> and{' '}
              <span className="font-medium text-text-primary">Profit Margin %</span> are calculated
              from that. If no buying price could be worked out, all three are left blank rather than
              guessed.
            </p>
            <div>
              <div className="text-sm font-medium text-text-primary mb-1">
                Buying Price Source — where that price came from
              </div>
              <SourceLegend
                rows={[
                  {
                    label: 'Purchase',
                    variant: 'success',
                    description:
                      "A purchase record for this product existed on or before the sale date, and recently enough (within the purchase price lookback days window). The most reliable case."
                  },
                  {
                    label: 'Stock count',
                    variant: 'info',
                    description:
                      "No usable purchase record that early, but an inventory count (a recount of physical stock) did, within the inventory price lookback days window."
                  },
                  {
                    label: 'Later recount (est.)',
                    variant: 'warning',
                    description:
                      'Neither existed yet as of the sale date — filled in from a recount that happened afterward, within the inventory price forward days window (see below). An estimate, not an exact match.'
                  },
                  {
                    label: '—',
                    variant: 'default',
                    description:
                      'Nothing could be found at all, even the later-recount fallback. Buying Price and Profit are blank on that row.'
                  }
                ]}
              />
            </div>
          </div>
        )
      },
      {
        id: 'inventory-price-forward-days',
        title: 'Inventory price forward days',
        summary: 'Settings → Inventory price forward days (admin only).',
        keywords: 'settings forward days lookback recount stale later',
        render: () => (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary leading-relaxed">
              A missing buying price usually gets fixed by someone physically recounting the stock —
              and that almost always happens a few days after the sale, not the same day. This setting
              controls how many days later a recount is still trusted as that sale's buying price (the
              "Later recount (est.)" case above). It's business-wide — everyone sees the same numbers,
              unlike the per-device settings below it on the Settings page. Two related settings,
              "Purchase price lookback days" and "Inventory price lookback days," control the opposite
              direction — how old a purchase or stock record is allowed to be before it's treated as
              too stale to use as of the sale's own date.
            </p>
            <Callout tone="info" title="Set it to 0 to turn this off">
              With 0 forward days, only an exact-date match is ever used — a sale with no price on
              record as of its own date stays blank instead of borrowing a later recount.
            </Callout>
          </div>
        )
      }
    ]
  },
  {
    id: 'data-quality',
    label: 'Data Quality & Warnings',
    description: 'What the Warning page checks, and why a tab can look empty.',
    icon: <WarningIcon className="w-4 h-4" />,
    articles: [
      {
        id: 'warning-tabs',
        title: 'What each Warning tab checks',
        summary: 'Sale, Inventory, Purchase, and the Daily check — what each one actually flags.',
        keywords: 'warning page sale inventory purchase daily check negative price zero quantity',
        render: () => (
          <IconRowList
            rows={[
              {
                icon: <SalesIcon className="w-4 h-4" />,
                dotColor: 'bg-emerald-400',
                title: 'Sale',
                description:
                  'Flags a sale line with an obviously wrong value — a negative price, a zero quantity, and similar.'
              },
              {
                icon: <InventoryIcon className="w-4 h-4" />,
                dotColor: 'bg-sky-400',
                title: 'Inventory',
                description:
                  "A wrong value on each product's Last Updated row (no date window — always just the latest one), plus any stock code sold or purchased within the Sale/Purchase check windows below that still has no inventory record at all."
              },
              {
                icon: <PurchaseIcon className="w-4 h-4" />,
                dotColor: 'bg-pink-400',
                title: 'Purchase',
                description: 'Same idea as Sale, but for purchase lines.'
              },
              {
                icon: <WarningIcon className="w-4 h-4" />,
                dotColor: 'bg-text-muted',
                title: 'Daily check',
                description:
                  'Compares the latest stock count against what it should be (previous count + purchases − sales since then). A mismatch usually means a recount is needed, or an import was missed.'
              }
            ]}
          />
        )
      },
      {
        id: 'warning-empty-windows',
        title: 'Why Sale/Purchase warnings can look empty',
        summary: 'The default check window is today only — here\'s how to widen it.',
        keywords: 'daily check window settings today history empty missing',
        render: () => (
          <Callout tone="warning" title="Why Sale/Purchase warnings can look empty">
            By default, the Sale and Purchase checks only look at <strong>today</strong> — not all
            history — so the checks stay fast as data piles up. Each has its own independent window,
            so widening one doesn't affect the other. If the data you're looking at is from an
            earlier date, those two tabs will show nothing even if bad values exist there. Widen the
            relevant one in <strong>Settings → Daily check windows</strong> to cover it. The
            missing-inventory-record half of the Inventory tab uses these same two windows too — an
            old, still-unfixed product that hasn't been sold or purchased recently can drop off the
            list until it's active again. Only the Last-Updated half of Inventory, and the Daily
            check tab, are unaffected — they don't work on a calendar range in the first place.
          </Callout>
        )
      }
    ]
  },
  {
    id: 'settings',
    label: 'Settings',
    description: 'Every setting is business-wide now — the same value for every account and device.',
    icon: <ClipboardIcon className="w-4 h-4" />,
    articles: [
      {
        id: 'settings-reference',
        title: 'What every setting does',
        summary: 'A quick reference for the whole Settings page, admin-only to change.',
        keywords: 'settings appearance theme check window list range buying price source lookback forward branch date format admin',
        render: () => (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary leading-relaxed">
              Only an admin account can change anything on the Settings page (enforced by the
              server too, not just hidden in the app) — but the effect of every change below
              applies to everyone immediately, not just the device it was changed on.
            </p>
            <SourceLegend
              rows={[
                {
                  label: 'Appearance',
                  variant: 'default',
                  description: 'Light, dark, or match-the-device theme — for every signed-in account.'
                },
                {
                  label: 'Daily check windows',
                  variant: 'warning',
                  description:
                    'How many days back the Sale and Purchase Warning checks each look — see What each Warning tab checks.'
                },
                {
                  label: 'Sale & Purchase list default range',
                  variant: 'brand',
                  description:
                    'How many days back the Sale and Purchase pages load by default before you touch the date filter — see Sale/Purchase pages vs Data Overview.'
                },
                {
                  label: 'Buying Price Source column',
                  variant: 'info',
                  description: 'Show or hide that column on the Sale and Data Overview tables.'
                },
                {
                  label: 'Purchase price lookback days',
                  variant: 'success',
                  description: "How old a purchase record can be before it's too stale to price a sale — see Inventory price forward days."
                },
                {
                  label: 'Inventory price lookback days',
                  variant: 'success',
                  description: 'Same idea as above, for a stock count instead of a purchase record.'
                },
                {
                  label: 'Inventory price forward days',
                  variant: 'success',
                  description: "How many days after the sale a later recount can still be borrowed as that sale's price — see Inventory price forward days."
                },
                {
                  label: 'Branch date formats',
                  variant: 'default',
                  description:
                    "Per branch, not shared across branches — whether that branch's POS terminal prints dates day-first or month-first, for Sale and Inventory files separately. Sale usually figures this out on its own from the file; this only matters for the rare file where every date in it is ambiguous."
                }
              ]}
            />
          </div>
        )
      }
    ]
  },
  {
    id: 'wholesale',
    label: 'Wholesale',
    description: "Customer Orders, Factory Vouchers, and the warehouse receiving flow — a separate workflow from retail imports.",
    icon: <FactoryIcon className="w-4 h-4" />,
    articles: [
      {
        id: 'orders-and-vouchers',
        title: 'Customer Orders & Factory Vouchers',
        summary: 'How an order line gets priced and moves from Not started to Complete.',
        keywords: 'customer order factory voucher not started waiting complete status second commitment qty',
        render: () => (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary leading-relaxed">
              A <span className="font-medium text-text-primary">Customer Order</span> is typed in
              directly, line by line — no file upload. Each line moves through three statuses:
            </p>
            <ProcessSteps steps={['Not started', 'Waiting', 'Complete']} />
            <p className="text-sm text-text-secondary leading-relaxed">
              A <span className="font-medium text-text-primary">Factory Voucher</span> records
              what was ordered from the factory and at what price. Saving one automatically finds
              every open order line with the same product code (in the same branch), fills in its
              price, and flips it from <span className="font-medium text-text-primary">Not started</span>{' '}
              to <span className="font-medium text-text-primary">Waiting</span>. A line already
              marked <span className="font-medium text-text-primary">Complete</span> is left alone
              — a later voucher never re-prices it.
            </p>
            <Callout tone="info" title="Second qty commitment column">
              A firmer, follow-up quantity sent to the factory after the first order goes in — it
              exists because the first number is often provisional. Only an admin account can
              change it once it's set.
            </Callout>
          </div>
        )
      },
      {
        id: 'warehouse-receiving',
        title: 'Warehouse Arrival & Factory Receiving',
        summary: 'Tracking what physically shows up against what was ordered.',
        keywords: 'warehouse arrival factory receiving matched voucher remaining qty buying receiving',
        render: () => (
          <IconRowList
            rows={[
              {
                icon: <WarehouseIcon className="w-4 h-4" />,
                dotColor: 'bg-brand',
                title: 'Warehouse Arrival',
                description:
                  "Where staff record what actually showed up — just a date, warehouse name, stock code, and quantity. You don't need to know which Factory Voucher it belongs to; the system matches it automatically by stock code."
              },
              {
                icon: <ReceivingIcon className="w-4 h-4" />,
                dotColor: 'bg-text-muted',
                title: 'Factory Receiving',
                description:
                  'A read-only report, grouped by voucher: how much was ordered (Buying Qty), how much has arrived so far (Receiving Qty), and how much is still outstanding (Remaining Qty).'
              }
            ]}
          />
        )
      }
    ]
  },
  {
    id: 'other-features',
    label: 'Other Features',
    description: 'Additional tools alongside the core import and warning workflow.',
    icon: <ChatIcon className="w-4 h-4" />,
    articles: [
      {
        id: 'chat-assistant',
        title: 'Chat assistant',
        summary: 'A quick way to ask about your own data instead of digging through tables.',
        keywords: 'chat assistant ask sales top selling stock low warnings question',
        render: () => (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary leading-relaxed">
              Available to retail and admin accounts (not wholesale — it only knows the retail
              data model). Ask it about sales totals, top-selling products, current or low stock,
              purchases, or existing data-quality warnings, for whatever date range you mention —
              it defaults to the last 30 days if you don't say one.
            </p>
            <Callout tone="info" title="Good to know">
              It only reads your own branch's already-imported data (or every branch's, for
              admin) — it can't change anything, and it doesn't remember earlier conversations
              once you reload or navigate away.
            </Callout>
          </div>
        )
      }
    ]
  },
  {
    id: 'known-limitations',
    label: 'Known Limitations',
    description: 'Honest limitations, not bugs — worth knowing before you question a number.',
    icon: <ConstructionIcon className="w-4 h-4" />,
    articles: [
      {
        id: 'known-rough-edges',
        title: 'Known rough edges',
        summary: 'Honest limitations, not bugs — worth knowing before you question a number.',
        keywords: 'purchase duplicate date invoice cost units uom each box limitation',
        render: () => (
          <SourceLegend
            rows={[
              {
                label: 'Purchase',
                variant: 'default',
                description:
                  'Re-uploading the same purchase file a second time adds it again rather than replacing it. If a purchase total looks too high, check Import History for a duplicate and revert it.'
              },
              {
                label: 'Date',
                variant: 'default',
                description:
                  "A purchase's date shown is really its import date, not a real supplier invoice date — it's whenever the file was confirmed, not necessarily when the goods were actually bought."
              },
              {
                label: 'Cost',
                variant: 'default',
                description:
                  'Buying Price/Profit reflect the best information on record, not a guaranteed-accurate cost accounting figure — see Buying Price Source above for how much to trust a given row.'
              },
              {
                label: 'Units',
                variant: 'default',
                description:
                  'Quantities are free text (e.g. "Each", "Box") with nothing enforcing consistency. In this business it\'s reportedly always "Each," so this is a theoretical risk more than a routine one — but it hasn\'t been fully ruled out.'
              }
            ]}
          />
        )
      }
    ]
  }
]

// A stable accent per category — used for the sidebar's icon badges and the landing grid's
// cards, so a category reads as the same "color" everywhere it appears in the page.
const CATEGORY_ACCENT: Record<string, BadgeVariant> = {
  'getting-started': 'brand',
  'costing-profit': 'success',
  'data-quality': 'warning',
  settings: 'default',
  wholesale: 'info',
  'other-features': 'brand',
  'known-limitations': 'error'
}

const ACCENT_ICON_BG: Record<BadgeVariant, string> = {
  default: 'bg-bg-raised text-text-secondary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  error: 'bg-error-subtle text-error',
  info: 'bg-info-subtle text-info',
  brand: 'bg-brand-subtle text-brand'
}

// --- Sidebar navigation -------------------------------------------------------------------

interface FlatArticle {
  category: HelpCategory
  article: HelpArticle
}

function CategoryTree({
  expandedIds,
  activeArticleId,
  onToggleCategory,
  onSelectArticle
}: {
  expandedIds: Set<string>
  activeArticleId: string
  onToggleCategory: (categoryId: string) => void
  onSelectArticle: (categoryId: string, articleId: string) => void
}): React.JSX.Element {
  return (
    <nav className="flex flex-col gap-1">
      {HELP_CATEGORIES.map((category) => {
        const expanded = expandedIds.has(category.id)
        return (
          <div key={category.id}>
            <button
              type="button"
              onClick={() => onToggleCategory(category.id)}
              aria-expanded={expanded}
              className="w-full flex items-center gap-2.5 h-10 px-3 rounded-md text-sm font-medium text-text-primary hover:bg-bg-raised transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base"
            >
              <span
                className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${ACCENT_ICON_BG[CATEGORY_ACCENT[category.id] ?? 'default']}`}
              >
                {category.icon}
              </span>
              <span className="flex-1 text-left">{category.label}</span>
              <span className="text-xs text-text-muted">{category.articles.length}</span>
              <ChevronDownIcon
                className={`w-3.5 h-3.5 text-text-muted shrink-0 transition-transform duration-150 ${
                  expanded ? '' : '-rotate-90'
                }`}
              />
            </button>
            {expanded && (
              <div className="flex flex-col gap-0.5 ml-4 pl-4 border-l border-border mb-1">
                {category.articles.map((article) => {
                  const active = article.id === activeArticleId
                  return (
                    <button
                      key={article.id}
                      type="button"
                      onClick={() => onSelectArticle(category.id, article.id)}
                      aria-current={active}
                      className={`text-left text-sm px-3 py-2 rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base ${
                        active
                          ? 'bg-brand-subtle text-brand font-medium'
                          : 'text-text-secondary hover:bg-bg-raised hover:text-text-primary'
                      }`}
                    >
                      {article.title}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </nav>
  )
}

function SearchResults({
  results,
  activeArticleId,
  onSelect
}: {
  results: FlatArticle[]
  activeArticleId: string
  onSelect: (categoryId: string, articleId: string) => void
}): React.JSX.Element {
  if (results.length === 0) {
    return (
      <EmptyState
        icon={<SearchIcon className="w-5 h-5" />}
        title="No results"
        description="Try a different word, or browse by topic instead."
      />
    )
  }
  return (
    <div className="flex flex-col gap-1">
      {results.map(({ category, article }) => {
        const active = article.id === activeArticleId
        return (
          <button
            key={article.id}
            type="button"
            onClick={() => onSelect(category.id, article.id)}
            aria-current={active}
            className={`text-left rounded-md px-3 py-2.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 focus-visible:ring-offset-bg-base ${
              active ? 'bg-brand-subtle' : 'hover:bg-bg-raised'
            }`}
          >
            <div className="text-sm font-medium text-text-primary">{article.title}</div>
            <div className="text-xs text-text-muted mt-0.5 flex items-center gap-1.5">
              <span className="shrink-0 [&>svg]:w-3 [&>svg]:h-3">{category.icon}</span>
              {category.label}
            </div>
          </button>
        )
      })}
    </div>
  )
}

function CategoryGrid({
  onSelectCategory
}: {
  onSelectCategory: (categoryId: string) => void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {HELP_CATEGORIES.map((category) => (
        <Card
          key={category.id}
          interactive
          className="p-5"
          onClick={() => onSelectCategory(category.id)}
        >
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${ACCENT_ICON_BG[CATEGORY_ACCENT[category.id] ?? 'default']}`}
            >
              {category.icon}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-text-primary">{category.label}</div>
                <Badge variant={CATEGORY_ACCENT[category.id] ?? 'default'} className="shrink-0">
                  {category.articles.length} article{category.articles.length === 1 ? '' : 's'}
                </Badge>
              </div>
              <p className="text-sm text-text-secondary leading-relaxed mt-1">
                {category.description}
              </p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  )
}

function ArticleNav({
  previous,
  next,
  onSelect
}: {
  previous: FlatArticle | null
  next: FlatArticle | null
  onSelect: (categoryId: string, articleId: string) => void
}): React.JSX.Element | null {
  if (!previous && !next) return null
  return (
    <div className="flex items-stretch gap-3 pt-1">
      {previous ? (
        <button
          type="button"
          onClick={() => onSelect(previous.category.id, previous.article.id)}
          className="flex-1 flex items-center gap-2 rounded-lg border border-border p-3 text-left hover:bg-bg-raised hover:border-border-strong transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <ChevronLeftIcon className="w-4 h-4 text-text-muted shrink-0" />
          <div className="min-w-0">
            <div className="text-xs text-text-muted">Previous</div>
            <div className="text-sm font-medium text-text-primary truncate">{previous.article.title}</div>
          </div>
        </button>
      ) : (
        <div className="flex-1" />
      )}
      {next ? (
        <button
          type="button"
          onClick={() => onSelect(next.category.id, next.article.id)}
          className="flex-1 flex items-center justify-end gap-2 rounded-lg border border-border p-3 text-right hover:bg-bg-raised hover:border-border-strong transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <div className="min-w-0">
            <div className="text-xs text-text-muted">Next</div>
            <div className="text-sm font-medium text-text-primary truncate">{next.article.title}</div>
          </div>
          <ChevronRightIcon className="w-4 h-4 text-text-muted shrink-0" />
        </button>
      ) : (
        <div className="flex-1" />
      )}
    </div>
  )
}

// --- Page -----------------------------------------------------------------------------

export function HelpPage(): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(HELP_CATEGORIES.map((c) => c.id))
  )
  // null = the landing overview (a grid of categories) — an article is only ever shown once
  // one has actually been picked, from the grid, the sidebar, or a search result.
  const [active, setActive] = useState<{ categoryId: string; articleId: string } | null>(null)

  const flatArticles = useMemo<FlatArticle[]>(
    () => HELP_CATEGORIES.flatMap((category) => category.articles.map((article) => ({ category, article }))),
    []
  )

  const searchResults = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return []
    return flatArticles.filter(({ category, article }) => {
      const haystack = `${article.title} ${article.summary} ${article.keywords ?? ''} ${category.label}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [flatArticles, search])

  function selectArticle(categoryId: string, articleId: string): void {
    setActive({ categoryId, articleId })
    setExpandedIds((prev) => new Set(prev).add(categoryId))
    setSearch('')
  }

  function selectCategory(categoryId: string): void {
    const category = HELP_CATEGORIES.find((c) => c.id === categoryId)
    if (!category) return
    selectArticle(categoryId, category.articles[0].id)
  }

  function goHome(): void {
    setActive(null)
    setSearch('')
  }

  function toggleCategory(categoryId: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  const activeCategory = active ? HELP_CATEGORIES.find((c) => c.id === active.categoryId) : undefined
  const activeArticle = activeCategory?.articles.find((a) => a.id === active?.articleId)
  const activeIndex = activeArticle
    ? flatArticles.findIndex((f) => f.article.id === activeArticle.id)
    : -1
  const previousArticle = activeIndex > 0 ? flatArticles[activeIndex - 1] : null
  const nextArticle =
    activeIndex >= 0 && activeIndex < flatArticles.length - 1 ? flatArticles[activeIndex + 1] : null

  return (
    <div className="flex flex-col gap-6">
      <CardHeader
        title="Help Center"
        description="Browse by topic, or search for what you need."
      />

      <div className="flex flex-col lg:flex-row gap-6 lg:items-start">
        <aside className="lg:w-72 shrink-0 flex flex-col gap-4">
          <Input
            placeholder="Search help articles..."
            startIcon={<SearchIcon className="w-4 h-4" />}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search help articles"
          />
          {search.trim() ? (
            <SearchResults
              results={searchResults}
              activeArticleId={activeArticle?.id ?? ''}
              onSelect={selectArticle}
            />
          ) : (
            <CategoryTree
              expandedIds={expandedIds}
              activeArticleId={activeArticle?.id ?? ''}
              onToggleCategory={toggleCategory}
              onSelectArticle={selectArticle}
            />
          )}
        </aside>

        <div className="flex-1 min-w-0 flex flex-col gap-4">
          {activeCategory && activeArticle ? (
            <>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                  <button
                    type="button"
                    onClick={goHome}
                    className="hover:text-text-primary hover:underline underline-offset-2 transition-colors"
                  >
                    Help Center
                  </button>
                  <span className="text-text-disabled">/</span>
                  <span className="shrink-0">{activeCategory.icon}</span>
                  <span>{activeCategory.label}</span>
                </div>
                <h2 className="text-xl font-semibold text-text-primary tracking-tight">
                  {activeArticle.title}
                </h2>
                {activeArticle.summary && (
                  <p className="text-sm text-text-muted leading-relaxed">{activeArticle.summary}</p>
                )}
              </div>
              <Card>{activeArticle.render()}</Card>
              <ArticleNav previous={previousArticle} next={nextArticle} onSelect={selectArticle} />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold text-text-primary tracking-tight">
                  What do you need help with?
                </h2>
                <p className="text-sm text-text-muted leading-relaxed">
                  Pick a topic below, or use the sidebar to jump straight to an article.
                </p>
              </div>
              <CategoryGrid onSelectCategory={selectCategory} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default HelpPage
