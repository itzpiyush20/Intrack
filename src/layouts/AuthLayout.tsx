// ============================================
// AuthLayout — Centered layout for auth pages
// Clean, minimal, premium feel
// ============================================

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { APP_CONFIG } from '@/constants'
import { getGlobalCurrencySymbol } from '@/utils'

interface AuthLayoutProps {
  children: ReactNode
  title: string
  subtitle?: string
}

export default function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface-0 px-4" role="main">
      <div className="relative w-full max-w-md animate-fade-in">
        {/* Logo & Brand Header */}
        <div className="mb-6 flex flex-col items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500 shadow-[var(--shadow-sm)]">
            <span className="text-2xl font-bold text-static-white" aria-hidden="true">{getGlobalCurrencySymbol()}</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white mb-1 flex items-center justify-center select-none">
            <span className="text-brand-400">In</span><span className="text-white">track</span>
          </h1>
          <p className="text-xs font-semibold tracking-wider text-brand-400 uppercase mb-4 text-center">
            {APP_CONFIG.APP_TAGLINE}
          </p>

        </div>

        {/* Auth form card */}
        <div className="rounded-2xl border border-border-subtle bg-surface-1 p-6 sm:p-8 shadow-2xl shadow-black/20">
          <div className="mb-5 text-center">
            <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-xs text-zinc-400">{subtitle}</p>
            )}
          </div>
          {children}
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-zinc-500 space-y-1.5 font-medium">
          <p>
            {APP_CONFIG.APP_NAME} · {APP_CONFIG.APP_TAGLINE}
          </p>
          <p>
            <Link to="/support" className="text-zinc-400 hover:text-brand-400 underline underline-offset-2 transition-colors">
              Privacy Policy & Support Center
            </Link>
          </p>
        </div>
      </div>
    </main>
  )
}
