import { Fragment, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { Button } from '@renderer/components/ui/Button'
import { Badge } from '@renderer/components/ui/Badge'
import { CardHeader } from '@renderer/components/ui/Card'
import { EmptyState } from '@renderer/components/ui/EmptyState'
import { TableSkeleton } from '@renderer/components/ui/Skeleton'
import { TableContainer, Thead, Tbody, Tr, Th, Td } from '@renderer/components/ui/Table'
import { ReceivingIcon } from '@renderer/components/ui/icons'
import type { FactoryVoucher, Profile } from '@renderer/components/features/types'

interface Props {
  session: Session
  profile: Profile | null
}

// Read-only — this page only ever displays what FactoryVouchersPage/WarehouseArrivalPage
// already wrote, so it reuses the same GET /api/factory-vouchers response (received_qty
// comes back on each line already) instead of a dedicated report endpoint.
export function FactoryReceivingPage({ session }: Props): React.JSX.Element {
  const showToast = useToast()
  const [vouchers, setVouchers] = useState<FactoryVoucher[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)

  async function load(): Promise<void> {
    setLoading(true)
    setLoadFailed(false)
    try {
      const response = await fetch(`${apiBaseUrl}/api/factory-vouchers`, {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (!response.ok) {
        setLoadFailed(true)
        showToast('error', `Failed to load factory vouchers: ${response.status}`)
        return
      }
      setVouchers(await response.json())
    } catch {
      setLoadFailed(true)
      showToast('error', 'Failed to load factory vouchers — is the backend running?')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.access_token])

  return (
    <div className="flex flex-col gap-4">
      <CardHeader
        title="Factory voucher receiving"
        description="How much of each factory voucher has arrived at the warehouse so far. Record an arrival from Warehouse Arrival."
      />

      {vouchers === null && loading && <TableSkeleton rows={4} cols={6} />}

      {vouchers === null && !loading && loadFailed && (
        <EmptyState
          icon={<ReceivingIcon />}
          title="Couldn't load factory vouchers"
          description="Something went wrong reaching the backend."
          action={
            <Button variant="secondary" size="sm" onClick={load}>
              Try again
            </Button>
          }
        />
      )}

      {vouchers !== null && vouchers.length === 0 && (
        <EmptyState
          icon={<ReceivingIcon />}
          title="No factory vouchers yet"
          description="Add a factory voucher to see its receiving status here."
        />
      )}

      {vouchers !== null && vouchers.length > 0 && (
        <TableContainer className="pb-4">
          <Thead>
            <Tr>
              <Th>No.</Th>
              <Th>Factory</Th>
              <Th>Stock Code</Th>
              <Th>Description</Th>
              <Th className="text-right">Buying Qty</Th>
              <Th className="text-right">Receiving Qty</Th>
              <Th className="text-right">Remaining Qty</Th>
            </Tr>
          </Thead>
          <Tbody>
            {vouchers.map((voucher) => (
              <Fragment key={voucher.id}>
                {voucher.lines.map((line, lineIndex) => {
                  const remaining = line.qty - line.received_qty
                  return (
                    <Tr key={line.id}>
                      {lineIndex === 0 && (
                        <>
                          <Td rowSpan={voucher.lines.length} className="align-top whitespace-nowrap">
                            FV-{voucher.voucher_no}
                          </Td>
                          <Td rowSpan={voucher.lines.length} className="align-top">
                            {voucher.factory_name ?? '—'}
                          </Td>
                        </>
                      )}
                      <Td>{line.product_code}</Td>
                      <Td className="text-text-muted">{line.description ?? '—'}</Td>
                      <Td className="text-right tabular-nums">{line.qty}</Td>
                      <Td className="text-right tabular-nums">{line.received_qty}</Td>
                      <Td className="text-right">
                        <Badge variant={remaining > 0 ? 'warning' : 'success'}>{remaining}</Badge>
                      </Td>
                    </Tr>
                  )
                })}
              </Fragment>
            ))}
          </Tbody>
        </TableContainer>
      )}
    </div>
  )
}

export default FactoryReceivingPage
