import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { Button } from '@renderer/components/ui/Button'
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
  const { importLabel, endpoint, file, result } = pending
  const showToast = useToast()

  const [branches, setBranches] = useState<BranchOption[]>([])
  const [selectedBranchId, setSelectedBranchId] = useState('')
  const needsBranchSelection = profile !== null && profile.branch_id === null
  const [branchRequiredError, setBranchRequiredError] = useState(false)

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

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (needsBranchSelection) formData.append('branch_id', selectedBranchId)

      const response = await fetch(`${apiBaseUrl}${endpoint}/confirm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        showToast('error', body?.detail ?? `Import failed: ${response.status}`)
        return
      }

      onConfirmed(body)
    } catch {
      showToast('error', 'Import failed — is the backend running?')
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

      <ImportDataView
        clean={result.clean}
        origin={result.origin}
        controls={
          <div className="flex items-end gap-3 flex-wrap">
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
              Confirm Import
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
