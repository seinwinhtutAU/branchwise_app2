import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { Badge } from '@renderer/components/ui/Badge'
import { Button } from '@renderer/components/ui/Button'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { CalendarCheckIcon } from '@renderer/components/ui/icons'

interface FreshnessRow {
  branch_id: string
  branch_name: string
  sales_last_imported_at: string | null
  inventory_last_imported_at: string | null
  purchase_last_imported_at: string | null
}

interface Props {
  session: Session
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

// Files are expected daily, so "fresh" has a narrow window: today is fine,
// yesterday is a soft warning (maybe just not uploaded yet today), anything
// older — or never imported — is a real gap worth someone's attention.
function freshnessBadge(iso: string | null): { variant: 'success' | 'warning' | 'error'; label: string } {
  if (!iso) return { variant: 'error', label: 'Never imported' }

  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
  if (days <= 0) return { variant: 'success', label: 'Today' }
  if (days === 1) return { variant: 'warning', label: 'Yesterday' }
  return { variant: 'error', label: `${days} days ago` }
}

function FreshnessCell({ iso }: { iso: string | null }): React.JSX.Element {
  const { variant, label } = freshnessBadge(iso)
  return (
    <div className="flex flex-col gap-1">
      <Badge variant={variant}>{label}</Badge>
      {iso && <span className="text-xs text-text-muted whitespace-nowrap">{formatDate(iso)}</span>}
    </div>
  )
}

function ImportOverviewPage({ session }: Props): React.JSX.Element {
  const showToast = useToast()
  const [rows, setRows] = useState<FreshnessRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  async function load(): Promise<void> {
    setLoading(true)
    setLoadFailed(false)
    try {
      const response = await fetch(`${apiBaseUrl}/api/imports/freshness`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load import overview: ${response.status}`)
        return
      }
      setRows(await response.json())
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load import overview — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token])

  return (
    <div className="flex flex-col">
      <div className="bg-bg-subtle overflow-hidden">
        <CardHeader
          title="Import overview"
          description="When sales, inventory, and purchase were each last imported per branch — files are expected daily."
          action={
            <Button variant="secondary" size="sm" onClick={load} loading={loading}>
              Refresh
            </Button>
          }
        />
      </div>

      {rows === null && loading && <TableSkeleton rows={4} cols={4} />}

      {rows === null && !loading && loadFailed && (
        <EmptyState
          icon={<CalendarCheckIcon />}
          title="Couldn't load import overview"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      )}

      {rows !== null && rows.length === 0 && (
        <EmptyState
          icon={<CalendarCheckIcon />}
          title="No branches yet"
          description="Once a branch has an account and imports data, it'll show up here."
        />
      )}

      {rows !== null && rows.length > 0 && (
        <TableContainer>
          <Thead>
            <Tr>
              <Th>Branch</Th>
              <Th>Sales</Th>
              <Th>Inventory</Th>
              <Th>Purchase</Th>
            </Tr>
          </Thead>
          <Tbody>
            {rows.map((row) => (
              <Tr key={row.branch_id}>
                <Td>{row.branch_name}</Td>
                <Td>
                  <FreshnessCell iso={row.sales_last_imported_at} />
                </Td>
                <Td>
                  <FreshnessCell iso={row.inventory_last_imported_at} />
                </Td>
                <Td>
                  <FreshnessCell iso={row.purchase_last_imported_at} />
                </Td>
              </Tr>
            ))}
          </Tbody>
        </TableContainer>
      )}
    </div>
  )
}

export default ImportOverviewPage
