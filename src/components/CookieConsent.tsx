// ============================================
// CookieConsent — Essential Cookie Consent Banner
// ============================================

import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants'

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const consent = localStorage.getItem('intrack_cookie_consent')
    if (!consent) {
      // Delay showing the banner slightly for better UX
      const timer = setTimeout(() => {
        setVisible(true)
      }, 1500)
      return () => clearTimeout(timer)
    }
  }, [])

  // Records that the notice has been SEEN, not that consent was given — there
  // is no optional processing here to consent to. The key name predates this
  // distinction and is kept so returning visitors are not shown the notice a
  // second time.
  const handleDismiss = () => {
    try {
      localStorage.setItem('intrack_cookie_consent', 'acknowledged')
    } catch {
      // Storage blocked. Showing the notice again next visit is the harmless
      // failure; crashing the banner is not.
    }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+1rem)] left-4 right-4 md:bottom-6 md:left-auto md:right-6 md:max-w-md z-modal animate-slide-up">
      <div className="bg-surface-1 border border-border-subtle/80 backdrop-blur-xl rounded-2xl p-5 shadow-2xl flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <span className="text-xl shrink-0 mt-0.5" aria-hidden="true">🍪</span>
          <div>
            <h4 className="text-xs font-bold text-white leading-tight">Essential Cookies Only</h4>
            {/* This used to say "By continuing, you agree" — consent by
                inaction, which DPDPA 2023 does not recognise. There is nothing
                here to consent TO: the only storage used is what keeps you
                signed in, which is strictly necessary and needs no permission.
                So this notifies rather than asks, and the button dismisses
                rather than grants. */}
            <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
              We store only what is strictly necessary to keep you signed in — no advertising cookies,
              no third-party analytics, and nothing that tracks you across other sites. There is no
              optional tracking here to turn off. Read our{' '}
              <Link to={ROUTES.PRIVACY} className="text-brand-400 underline hover:text-brand-300">
                Privacy Policy
              </Link>{' '}
              and{' '}
              <Link to={ROUTES.TERMS} className="text-brand-400 underline hover:text-brand-300">
                Terms
              </Link>.
            </p>
          </div>
        </div>
        
        <div className="flex justify-end gap-2.5 shrink-0 border-t border-border-subtle/30 pt-3">
          <Link
            to={ROUTES.PRIVACY}
            className="min-h-11 px-3.5 flex items-center justify-center rounded-xl border border-border-subtle text-xs font-bold text-zinc-400 hover:text-white hover:border-zinc-500 cursor-pointer transition-all"
          >
            Learn More
          </Link>
          <button
            onClick={handleDismiss}
            className="min-h-11 px-4 flex items-center justify-center rounded-xl bg-[var(--btn-primary-bg)] text-xs font-bold text-[var(--btn-primary-fg)] shadow-[var(--shadow-sm)] cursor-pointer transition-colors hover:bg-[var(--btn-primary-bg-hover)] active:bg-[var(--btn-primary-bg-active)]"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
