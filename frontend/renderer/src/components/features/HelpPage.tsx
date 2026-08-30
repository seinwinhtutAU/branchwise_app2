import type { ReactNode } from 'react'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { Badge } from '@renderer/components/ui/Badge'
import { SalesIcon, InventoryIcon, PurchaseIcon, WarningIcon } from '@renderer/components/ui/icons'

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

export function HelpPage(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6">
      <CardHeader
        title="Help"
        description="Plain-language notes on what this system actually does and why some numbers look the way they do."
      />

      <Card>
        <CardHeader title="How data gets in" />
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
      </Card>

      <Card>
        <CardHeader
          title="Buying Price, Profit & Buying Price Source"
          description="What those columns on the Sale and Data Overview tables actually mean."
        />
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
      </Card>

      <Card>
        <CardHeader
          title="Inventory price forward days"
          description="Settings → Inventory price forward days (admin only)."
        />
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
      </Card>

      <Card>
        <CardHeader
          title="The Warning page"
          description="What each tab actually checks, and a common surprise."
        />
        <div className="flex flex-col gap-5">
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
                  "A wrong value on the latest stock snapshot (no date window — always just the latest snapshot), plus any stock code sold or purchased within the Sale/Purchase check windows below that still has no inventory record."
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
          <Callout tone="warning" title="Why Sale/Purchase warnings can look empty">
            By default, the Sale and Purchase checks only look at <strong>today</strong> — not all
            history — so the checks stay fast as data piles up. Each has its own independent window,
            so widening one doesn't affect the other. If the data you're looking at is from an
            earlier date, those two tabs will show nothing even if bad values exist there. Widen the
            relevant one in <strong>Settings → Daily check windows</strong> to cover it. The
            missing-inventory-record half of the Inventory tab uses these same two windows too — an
            old, still-unfixed product that hasn't been sold or purchased recently can drop off the
            list until it's active again. Only the stock-snapshot half of Inventory, and the Daily
            check tab, are unaffected — they don't work on a calendar range in the first place.
          </Callout>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Known rough edges"
          description="Honest limitations, not bugs — worth knowing before you question a number."
        />
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
      </Card>
    </div>
  )
}

export default HelpPage
