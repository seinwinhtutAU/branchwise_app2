import { useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { apiBaseUrl } from '@renderer/lib/supabaseClient'
import { useToast } from '@renderer/lib/toast'
import { Card, CardHeader } from '@renderer/components/ui/Card'
import { UploadIcon } from '@renderer/components/ui/icons'
import type { ImportPreviewResult, PendingImport } from './types'

interface Props {
  session: Session
  label: string
  description: string
  endpoint: string
  icon: ReactNode
  onFileReady: (pending: PendingImport) => void
}

// Upload trigger only — the origin/clean preview + confirm step lives on
// ImportReviewPage, reached after a file is picked and parsed here.
function FileImportCard({ session, label, description, endpoint, icon, onFileReady }: Props): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const showToast = useToast()

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return

    setUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`${apiBaseUrl}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData
      })

      if (!response.ok) {
        const body = await response.json().catch(() => null)
        showToast('error', body?.detail ?? `Upload failed: ${response.status}`)
        return
      }

      const result: ImportPreviewResult = await response.json()
      onFileReady({ importLabel: label, endpoint, file, result })
    } catch {
      showToast('error', 'Upload failed — is the backend running?')
    } finally {
      setUploading(false)
    }
  }

  return (
    <Card className="flex flex-col">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-brand-subtle text-brand flex items-center justify-center shrink-0">
              {icon}
            </span>
            {label}
          </span>
        }
        description={description}
      />

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xls,.xlsx"
        onChange={handleFileSelected}
        className="hidden"
      />

      {!uploading && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border text-text-muted py-10 px-4 transition-all duration-150 hover:border-brand hover:text-brand hover:bg-brand-subtle/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <UploadIcon />
          <span className="text-sm font-medium">Click to choose a file</span>
          <span className="text-xs">.csv, .xls, or .xlsx</span>
        </button>
      )}

      {uploading && (
        <div className="flex flex-col gap-2 py-6" role="status" aria-label="Uploading">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-8 rounded-md bg-bg-raised animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      )}
    </Card>
  )
}

export default FileImportCard
