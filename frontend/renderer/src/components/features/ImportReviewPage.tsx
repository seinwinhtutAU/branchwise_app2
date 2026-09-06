import { useEffect, useState } from 'react'
import type { Session } from '@renderer/lib/auth'
import { apiBaseUrl } from '@renderer/lib/auth'
import { invalidateImportedData } from '@renderer/lib/useCachedFetch'
import { useToast } from '@renderer/lib/useToast'
import { Button } from '@renderer/components/ui/Button'
import { Input } from '@renderer/components/ui/Input'
import { ProgressBar } from '@renderer/components/ui/ProgressBar'
import { Select } from '@renderer/components/ui/Select'
import { ImportDataView } from './ImportDataView'
import type { ImportPreviewResult, PendingImport, Profile } from './types'

interface BranchOption {
  id: string
  name: string
}

interface Props {
  session: Session
  profile: Profile | null
  pending: PendingImport
  // Set only when this file is one of several picked at once (see FileImportCard) — an
  // ad-hoc single-file reimport (Import History, Warning page) has no queue to show.
  queuePosition?: { index: number; total: number }
  onBack: () => void
  onConfirmed: (summary: Record<string, unknown>) => void
}

function ImportReviewPage({ session, profile, pending, queuePosition, onBack, onConfirmed }: Props): React.JSX.Element {
  const { importLabel, endpoint, file, result, revertBatchId, replacingFilename } = pending
  const showToast = useToast()

  const [branches, setBranches] = useState<BranchOption[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const needsBranchSelection = profile !== null && profile.branch_id === null
  const [branchRequiredError, setBranchRequiredError] = useState(false)

  // Sale and Inventory dates are cleaned using the branch's own date-format setting
  // (see backend app.routers.imports) — for an admin account, that branch isn't known
  // until picked above, so the very first preview (before any pick) can only guess.
  // Once a branch is picked, re-run preview with it so what's shown here always
  // matches what actually gets saved on Confirm, rather than only fixing itself
  // silently after the fact. Purchase has no per-line date in the source file at all,
  // so it has nothing to re-preview.
  const needsDateFormatRepreview = endpoint === '/api/imports/sales' || endpoint === '/api/imports/inventory'
  const [displayResult, setDisplayResult] = useState<ImportPreviewResult>(result)
  const [repreviewing, setRepreviewing] = useState(false)

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

  useEffect(() => {
    if (!needsBranchSelection || !needsDateFormatRepreview || !selectedBranchId) return
    let cancelled = false
    setRepreviewing(true)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('branch_id', selectedBranchId)

    fetch(`${apiBaseUrl}${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData
    })
      .then(async (r) => (r.ok ? ((await r.json()) as ImportPreviewResult) : null))
      .then((body) => {
        if (cancelled || !body) return
        setDisplayResult(body)
      })
      .catch(() => {
        // Leaves the prior preview showing — Confirm still re-parses server-side with
        // the now-known branch regardless, so this only affects what's displayed here.
      })
      .finally(() => {
        if (!cancelled) setRepreviewing(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBranchId, needsBranchSelection, needsDateFormatRepreview])

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

      // Sales/inventory/purchase data just changed, so every cached dashboard and
      // Warning page is out of date. This is the honest invalidation signal in this app
      // — a confirmed or reverted import is the only thing that moves that data.
      invalidateImportedData()
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
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight">
            Review {importLabel} import
            {queuePosition && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                File {queuePosition.index} of {queuePosition.total}
              </span>
            )}
          </h2>
          <p className="text-sm text-text-muted truncate">{result.filename}</p>
        </div>
      </div>

      {queuePosition && (
        <ProgressBar
          value={((queuePosition.index - 1) / queuePosition.total) * 100}
          className="max-w-sm"
        />
      )}

      {revertBatchId && (
        <p className="text-sm text-warning bg-warning-subtle rounded-md px-3 py-2">
          Confirming will remove <strong>{replacingFilename ?? 'the previous import'}</strong> and save this file
          in its place.
        </p>
      )}

      <ImportDataView
        clean={displayResult.clean}
        origin={displayResult.origin}
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
            <Button onClick={handleConfirm} loading={confirming} disabled={repreviewing}>
              {revertBatchId ? 'Confirm & Replace' : 'Confirm Import'}
            </Button>
            <Button variant="ghost" onClick={onBack}>
              {queuePosition ? 'Skip this file' : 'Cancel'}
            </Button>
          </div>
        }
      />
    </div>
  )
}

export default ImportReviewPage
