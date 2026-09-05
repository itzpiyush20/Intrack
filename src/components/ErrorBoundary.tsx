// ============================================
// ErrorBoundary — Catch React render errors
// Prevents white screen of death
// ============================================

import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log to console in dev; send to Sentry in production
    console.error('[Intrack] Unhandled render error:', error, info.componentStack)

    // Stale chunk after a new deploy: React.lazy()'s dynamic import() rejects because the
    // old hashed chunk filename no longer exists on the server. A plain "Try Again" re-render
    // reuses the same rejected import promise and fails again, so force a hard reload instead
    // (guarded against loops, same pattern as AutoUpdateChecker's asset-error handler).
    const isStaleChunkError =
      /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(
        error.message
      )
    if (isStaleChunkError) {
      try {
        const now = Date.now()
        const lastReload = sessionStorage.getItem('intrack_last_auto_reload')
        if (!lastReload || now - Number(lastReload) > 15000) {
          sessionStorage.setItem('intrack_last_auto_reload', String(now))
          window.location.reload()
        }
      } catch {
        // sessionStorage unavailable — safe to skip the loop guard
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.href = '/dashboard'
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div className="min-h-screen bg-surface-0 flex items-center justify-center p-6 relative overflow-hidden">
          {/* Ambient emerald backlight */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-96 w-[36rem] rounded-full bg-radial from-brand-500/15 via-brand-500/5 to-transparent blur-3xl"
          />

          <div className="relative z-10 max-w-md w-full rounded-3xl bg-surface-1 border border-sb-hairline p-8 text-center shadow-card-lg before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-500/35 before:to-transparent">
            <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-2xl mx-auto mb-4 shadow-xs">
              ⚠️
            </div>
            <h1 className="text-xl font-bold tracking-tight text-sb-ink mb-2">Something went wrong</h1>
            <p className="text-sm text-sb-ink-secondary mb-6 leading-relaxed">
              Intrack encountered an unexpected error. Your data is safe — this is a display issue only.
            </p>
            {this.state.error && (
              <pre className="text-left font-mono text-xs text-rose-700 bg-rose-50/70 rounded-xl p-3.5 mb-6 overflow-auto max-h-32 border border-rose-200/80">
                {this.state.error.message}
              </pre>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => {
                  const isStale = /failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
                    this.state.error?.message || ''
                  )
                  if (isStale) {
                    window.location.reload()
                  } else {
                    this.setState({ hasError: false, error: null })
                  }
                }}
                className="rounded-xl border border-sb-hairline bg-surface-1 hover:bg-surface-2 text-sb-ink text-sm font-semibold px-5 py-2.5 transition-colors shadow-xs cursor-pointer"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReset}
                className="rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold px-5 py-2.5 transition-colors shadow-xs cursor-pointer"
              >
                Back to Home
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
