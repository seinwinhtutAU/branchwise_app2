import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { ImportDataView } from './ImportDataView'
import type { PendingImport, Profile } from './types'

interface BranchOption {
  id: string
  name: string
}

interface Props {
  session: Session
  profile: Profile | null
  pending: PendingImport
  onBack: () => void
  onConfirmed: (summary: Record<string, unknown>) => void
}

function ImportReviewPage({ session, profile, pending, onBack, onConfirmed }: Props): React.JSX.Element {
  const { importLabel, endpoint, file, result, revertBatchId, replacingFilename } = pending
  const showToast = useToast()

  const [branches, setBranches] = useState<BranchOption[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const needsBranchSelection = profile !== null && profile.branch_id === null
  const [branchRequiredError, setBranchRequiredError] = useState(false)

  // Purchase batches have no per-line date in the source file, so the backend defaults
  // to today's date — this lets the importer override that, e.g. when uploading a file
  // for a purchase that actually happened on an earlier day.
  const isPurchaseImport = endpoint === '/api/imports/purchase'
  const [purchaseDate, setPurchaseDate] = useState(() => new Date().toISOString().slice(0, 10))

  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!needsBranchSelection) return
    fetch(`${apiBaseUrl}/api/branches`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
      .then((r) => r.json())
      .then(setBranches)
      .catch(() => setBranches([]))
  }, [needsBranchSelection, session.access_token])

  async function handleConfirm(): Promise<void> {
    if (needsBranchSelection && !selectedBranchId) {
      setBranchRequiredError(true)
      return
    }
    setBranchRequiredError(false)

    setConfirming(true)
    let removedPrevious = false

    try {
      if (revertBatchId) {
        // replaced=true marks the old batch REIMPORTED rather than REVERTED/"Removed" —
        // see ImportBatchStatus. The inline note below (not a blocking confirm() popup)
        // is the warning here; the user already chose to pick a replacement file.
        const revertResponse = await fetch(
          `${apiBaseUrl}/api/imports/history/${revertBatchId}/revert?replaced=true`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` }
          }
        )
        if (!revertResponse.ok) {
          const revertBody = await revertResponse.json().catch(() => null)
          showToast('error', revertBody?.detail ?? `Couldn't remove the previous import: ${revertResponse.status}`)
          return
        }
        removedPrevious = true
      }

      const formData = new FormData()
      formData.append('file', file)
      if (needsBranchSelection) formData.append('branch_id', selectedBranchId)
      if (isPurchaseImport && purchaseDate) formData.append('purchase_date', purchaseDate)

      const response = await fetch(`${apiBaseUrl}${endpoint}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        showToast(
          'error',
          removedPrevious
            ? `Removed the previous import, but saving the new file failed (${body?.detail ?? response.status}). Import it again from here.`
            : (body?.detail ?? `Import failed: ${response.status}`)
        )
        return
      }

      onConfirmed(body)
    } catch {
      showToast(
        'error',
        removedPrevious
          ? "Removed the previous import, but saving the new file failed — is the backend running? Import it again from here."
          : 'Import failed — is the backend running?'
      )
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in motion-reduce:animate-none">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Back to Import"
          className="w-8 h-8 rounded-md flex items-center justify-center text-text-secondary hover:bg-bg-raised transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <svg viewBox="0 0 24 24" fill="none" className="w-4.5 h-4.5" aria-hidden="true">
            <path
              d="M15 18l-6-6 6-6"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight">
            Review {importLabel} import
          </h2>
          <p className="text-sm text-text-muted truncate">{result.filename}</p>
        </div>
      </div>

      {revertBatchId && (
        <p className="text-sm text-warning bg-warning-subtle rounded-md px-3 py-2">
          Confirming will remove <strong>{replacingFilename ?? 'the previous import'}</strong> and save this file
          in its place.
        </p>
      )}

      <ImportDataView
        clean={result.clean}
        origin={result.origin}
        controls={
          <div className="flex items-end gap-3 flex-wrap">
            {isPurchaseImport && (
              <div className="w-48">
                <Input
                  type="date"
                  label="Purchase date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>
            )}
            {needsBranchSelection && (
              <div className="w-48">
                <Select
                  label="Branch"
                  value={selectedBranchId}
                  onChange={(e) => {
                    setSelectedBranchId(e.target.value)
                    setBranchRequiredError(false)
                  }}
                  error={branchRequiredError ? 'Select a branch first' : undefined}
                >
                  <option value="">Select a branch…</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            <Button onClick={handleConfirm} loading={confirming}>
              {revertBatchId ? 'Confirm & Replace' : 'Confirm Import'}
            </Button>
            <Button variant="ghost" onClick={onBack}>
              Cancel
            </Button>
          </div>
        }
      />
    </div>
  )
}

export default ImportReviewPage
