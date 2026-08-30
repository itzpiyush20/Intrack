import { createContext, useContext, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: string
  message: string
  type: ToastType
  action?: ToastAction
}

interface ShowToastOptions {
  action?: ToastAction
  duration?: number
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, options?: ShowToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = (message: string, type: ToastType = 'success', options?: ShowToastOptions) => {
    const id = Math.random().toString(36).substring(2) + Date.now().toString(36)
    setToasts((prev) => [...prev, { id, message, type, action: options?.action }])

    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, options?.duration ?? 3500)
  }

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}

      {/* Floating Toast Container */}
      <div className="fixed bottom-6 right-6 z-toast flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((toast) => {
          let bgColor = 'bg-[var(--surface-1)] border-border-subtle'
          let textColor = 'text-zinc-200'
          let emoji = 'ℹ️'

          if (toast.type === 'success') {
            bgColor = 'bg-[var(--surface-1)] border-[var(--status-positive-border)] text-[var(--status-positive-text)]'
            textColor = 'text-[var(--text-primary)]'
            emoji = '✔️'
          } else if (toast.type === 'error') {
            bgColor = 'bg-[var(--surface-1)] border-[var(--status-danger-border)] text-[var(--status-danger-text)]'
            textColor = 'text-[var(--text-primary)]'
            emoji = '❌'
          } else if (toast.type === 'warning') {
            bgColor = 'bg-[var(--surface-1)] border-[var(--status-warning-border)] text-[var(--status-warning-text)]'
            textColor = 'text-[var(--text-primary)]'
            emoji = '⚠️'
          }

          return (
            <div
              key={toast.id}
              className={`flex items-center justify-between p-4 rounded-2xl border backdrop-blur-xl shadow-2xl pointer-events-auto animate-scale-up transition-all duration-300 ${bgColor}`}
              role="alert"
              aria-atomic="true"
            >
              <div className="flex items-center gap-3">
                <span className="text-base shrink-0 select-none" aria-hidden="true">
                  {emoji}
                </span>
                <p className={`text-xs font-semibold leading-relaxed ${textColor}`}>{toast.message}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                {toast.action && (
                  <button
                    onClick={() => {
                      toast.action!.onClick()
                      removeToast(toast.id)
                    }}
                    className={`text-xs font-bold underline underline-offset-2 hover:opacity-80 transition-opacity cursor-pointer ${textColor}`}
                  >
                    {toast.action.label}
                  </button>
                )}
                <button
                  onClick={() => removeToast(toast.id)}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                  aria-label="Dismiss toast"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
