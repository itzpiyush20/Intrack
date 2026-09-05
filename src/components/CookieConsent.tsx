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
      <div className="relative overflow-hidden bg-surface-1/95 border border-sb-hairline backdrop-blur-xl rounded-2xl p-5 shadow-card-lg flex flex-col gap-4 before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand-500/35 before:to-transparent">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-brand-50 border border-brand-200/60 flex items-center justify-center text-base shrink-0 mt-0.5 shadow-xs" aria-hidden="true">
            🍪
          </div>
          <div>
            <h4 className="text-xs font-bold text-sb-ink tracking-tight leading-tight">Essential Cookies Only</h4>
            {/* This used to say "By continuing, you agree" — consent by
                inaction, which DPDPA 2023 does not recognise. There is nothing
                here to consent TO: the only storage used is what keeps you
                signed in, which is strictly necessary and needs no permission.
                So this notifies rather than asks, and the button dismisses
                rather than grants. */}
            <p className="text-xs text-sb-ink-secondary mt-1.5 leading-relaxed">
              We store only what is strictly necessary to keep you signed in — no advertising cookies,
              no third-party analytics, and nothing that tracks you across other sites. Read our{' '}
              <Link to={ROUTES.PRIVACY} className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700">
                Privacy Policy
              </Link>{' '}
              and{' '}
              <Link to={ROUTES.TERMS} className="font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-700">
                Terms
              </Link>.
            </p>
          </div>
        </div>
        
        <div className="flex justify-end gap-2.5 shrink-0 border-t border-sb-hairline pt-3">
          <Link
            to={ROUTES.PRIVACY}
            className="min-h-10 px-3.5 flex items-center justify-center rounded-xl border border-sb-hairline text-xs font-semibold text-sb-ink-secondary hover:text-sb-ink hover:bg-surface-2 transition-all cursor-pointer"
          >
            Learn More
          </Link>
          <button
            onClick={handleDismiss}
            className="min-h-10 px-4 flex items-center justify-center rounded-xl bg-brand-600 text-xs font-semibold text-white shadow-xs cursor-pointer transition-colors hover:bg-brand-700 active:bg-brand-800"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
