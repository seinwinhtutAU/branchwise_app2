import { useCallback, useRef, useState, type ReactNode } from 'react'
import { Toast, type ToastData, type ToastVariant } from '@renderer/components/ui/Toast'
import { ToastContext, type ShowToast } from './useToast'

const AUTO_DISMISS_MS: Record<ToastVariant, number> = {
  success: 4000,
  info: 4000,
  error: 7000
}

export function ToastProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<ToastData[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const show = useCallback<ShowToast>(
    (variant, message) => {
      const id = String(nextId.current++)
      setToasts((current) => [...current, { id, variant, message }])
      setTimeout(() => dismiss(id), AUTO_DISMISS_MS[variant])
    },
    [dismiss]
  )

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 items-end">
        {toasts.map((t) => (
          <Toast key={t.id} {...t} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}
