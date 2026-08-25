// ============================================
// SiteFooter — one footer for every page
//
// There were three, and a visitor crossing between public pages saw all of
// them:
//
//   LandingPage       "© 2026 Intrack. Built with privacy by design."
//   MarketingLayout   "© 2026 Intrack. Your Personal CFO."
//   AppLayout         "© 2026 · Version 1.0.0 (Production Build) ·
//                      Proprietary Closed-Source License"
//
// Three different taglines for one product, the third of which is build
// metadata addressed to a developer, printed on /pricing and /support — two
// pages a prospective customer sees before they ever sign up.
//
// The year was hardcoded to 2026 in all three.
// ============================================

import { Link } from 'react-router-dom'
import { FOOTER_NAV_ITEMS } from '@/constants'
import { cn } from '@/utils'

interface SiteFooterProps {
  /**
   * 'marketing' is the light, brand-forward footer used by the landing and
   * legal pages. 'app' matches the signed-in shell, which can render on a dark
   * surface and dims accordingly.
   */
  tone?: 'marketing' | 'app'
  /** Show the ₹ wordmark above the copyright. The landing page does. */
  showWordmark?: boolean
  /** Extra classes for the <footer> element. */
  className?: string
  /** True when the surrounding app shell is forcing its light palette. */
  isLight?: boolean
}

export default function SiteFooter({
  tone = 'marketing',
  showWordmark = false,
  className,
  isLight = true,
}: SiteFooterProps) {
  // Derived, not hardcoded — the previous footers all said 2026 forever.
  const year = new Date().getFullYear()

  const isApp = tone === 'app'
  const muted = isApp && !isLight ? 'text-zinc-400' : 'text-sb-ink-muted'
  const strong = isApp && !isLight ? 'text-zinc-300' : 'text-sb-ink'

  return (
    <footer
      className={cn(
        'border-t shrink-0',
        isApp
          ? cn('pt-8 pb-20 md:pb-8 px-4 sm:px-6 lg:px-8 mt-auto', isLight ? 'border-sb-hairline bg-sb-canvas-soft' : 'border-border-subtle bg-surface-1/40')
          : 'py-14 border-sb-hairline bg-sb-canvas-soft',
        muted,
        className
      )}
    >
      <div className="mx-auto max-w-7xl flex flex-col md:flex-row items-center justify-between gap-6 text-center md:text-left">
        <div className="flex flex-col items-center md:items-start gap-1">
          {showWordmark && (
            <div className="flex items-center gap-2">
              <span className="h-6 w-6 rounded-lg bg-brand-500 flex items-center justify-center text-xs font-black text-white" aria-hidden="true">₹</span>
              <span className="text-sm font-extrabold">
                <span className="text-brand-400">Dhan</span><span className={strong}>rakshak</span>
              </span>
            </div>
          )}
          {/* One tagline, everywhere. */}
          <p className={cn('text-xs', muted)}>
            © {year} Intrack · Built with privacy by design.
          </p>
        </div>

        <nav className="flex flex-wrap justify-center gap-6 font-medium" aria-label="Footer">
          {FOOTER_NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.href}
              className={cn('text-xs no-underline transition-colors hover:text-brand-400', muted)}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  )
}
