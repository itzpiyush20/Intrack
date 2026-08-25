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
        <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-3xl bg-zinc-900 border border-zinc-800 p-8 text-center">
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
              Intrack encountered an unexpected error. Your data is safe — this is a display issue only.
            </p>
            {this.state.error && (
              <pre className="text-left text-xs text-[var(--status-danger-text)] bg-zinc-950 rounded-xl p-3 mb-6 overflow-auto max-h-32 border border-[var(--status-danger-border)]">
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
                className="rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold px-5 py-2.5 transition-colors"
              >
                Try Again
              </button>
              <button
                onClick={this.handleReset}
                className="rounded-xl bg-brand-500 hover:bg-brand-400 text-white text-sm font-semibold px-5 py-2.5 transition-colors"
              >
                Go to Dashboard
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
