// ============================================
// AuthLayout — the shell behind /forgot-password and /reset-password
//
// One card, centred, on the app canvas. Deliberately the same object as the
// AuthModal panel: a person who started at "Forgot password?" inside the modal
// and landed here should feel they stayed in the same place, not that they were
// handed off to a different product.
//
// The brand tile used to render `getGlobalCurrencySymbol()`, so the logo above
// the sign-in title changed shape with the viewer's currency setting. AuthModal
// fixed that by switching to BrandMark; this file was the last copy of the bug.
// ============================================

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { APP_CONFIG } from '@/constants'
import { BrandMark, panelVariants, transition } from '@/components/ui'

interface AuthLayoutProps {
  children: ReactNode
  title: string
  subtitle?: string
}

export default function AuthLayout({ children, title, subtitle }: AuthLayoutProps) {
  const reduce = useReducedMotion()

  return (
    <main
      className="flex min-h-svh flex-col items-center justify-center bg-surface-0 px-4 py-10 sm:px-6"
      role="main"
    >
      <motion.div
        variants={panelVariants(reduce)}
        initial="initial"
        animate="animate"
        transition={transition(reduce)}
        className="w-full max-w-md"
      >
        {/* Brand header */}
        <div className="flex flex-col items-center">
          <BrandMark size={44} className="text-brand-500" />
          <p className="mt-3 text-lg font-semibold tracking-tight text-zinc-50 select-none">
            <span className="text-brand-400">In</span>track
          </p>
          <p className="mt-0.5 text-xs font-medium uppercase tracking-wider text-zinc-400">
            {APP_CONFIG.APP_TAGLINE}
          </p>
        </div>

        {/* Auth card */}
        <div className="mt-6 rounded-2xl border border-border-subtle bg-surface-1 p-6 shadow-[var(--shadow-md)] sm:p-8">
          <div className="mb-6">
            <h1 className="text-xl font-semibold tracking-tight text-zinc-50 text-balance">{title}</h1>
            {subtitle && (
              <p className="mt-1.5 text-sm leading-relaxed text-zinc-400">{subtitle}</p>
            )}
          </div>
          {children}
        </div>

        {/* Footer */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-zinc-400">
          <span>{APP_CONFIG.APP_NAME}</span>
          <span aria-hidden="true">·</span>
          <Link
            to="/privacy"
            className="rounded underline underline-offset-2 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            Privacy
          </Link>
          <span aria-hidden="true">·</span>
          <Link
            to="/support"
            className="rounded underline underline-offset-2 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            Support
          </Link>
        </div>
      </motion.div>
    </main>
  )
}
