// ============================================
// MarketingHeader — one header for every public page
//
// Public content had three different headers:
//
//   LandingPage      max-w-7xl, wordmark + badge, six nav links, Sign in +
//                    Get started
//   MarketingLayout  max-w-4xl, wordmark only, NO nav at all, Sign in
//   AppLayout        max-w-7xl, the app shell, showing marketing links when
//                    signed out (used by /pricing and /support)
//
// The middle one is the problem. /privacy, /terms, /about and /refund-policy
// are read by people deciding whether to trust the product, and those pages
// offered no way to reach Pricing or Support except the footer.
//
// AppLayout keeps its own header — it carries signed-in chrome (notifications,
// plan badge, app nav) that has no place here — but its signed-out link set is
// the same six, so all three now agree on what public navigation means.
// ============================================

import { Link } from 'react-router-dom'
import { useAuth } from '@/context'
import { UserMenu, BrandMark } from '@/components/ui'

/**
 * Hash targets are written as absolute paths ('/#features') rather than bare
 * fragments, so the same header works on the landing page AND on a legal page
 * where the section does not exist locally. ScrollToTop in App.tsx performs the
 * scroll once the landing route has mounted.
 */
const NAV_ITEMS = [
  { label: 'How it works', href: '/#how-it-works' },
  { label: 'Features', href: '/#features' },
  { label: 'Install App', href: '/#install-guide' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'FAQ', href: '/#faq' },
  { label: 'Support', href: '/support' },
]

export default function MarketingHeader() {
  const { user, openAuthModal } = useAuth()

  return (
    <header className="sticky top-0 z-50 bg-sb-canvas backdrop-blur-md border-b border-sb-hairline">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between" aria-label="Primary">
        <Link to="/" className="flex items-center gap-3 group no-underline shrink-0">
          <BrandMark size={32} className="text-brand-500 shrink-0 group-hover:scale-110 group-hover:rotate-6 transition-all duration-300" />
          <span className="text-base font-extrabold tracking-tight">
            <span className="text-brand-400">In</span><span>track</span>
          </span>
          <span className="hidden lg:inline-flex items-center gap-1.5 text-xs font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-400">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />Automated Tracker
          </span>
        </Link>

        <div className="hidden lg:flex items-center gap-7">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.href}
              className="text-sm text-sb-ink-muted hover:text-sb-ink transition-colors no-underline"
            >
              {item.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {user ? (
            <UserMenu />
          ) : (
            <>
              <button
                onClick={() => openAuthModal(undefined, 'login')}
                className="text-sm text-sb-ink-muted hover:text-sb-ink transition-colors bg-transparent border-0 cursor-pointer px-2 py-2 -my-2"
              >
                Sign in
              </button>
              <button
                onClick={() => openAuthModal(undefined, 'signup')}
                className="sb-btn-primary border-0 cursor-pointer"
              >
                Get started
              </button>
            </>
          )}
        </div>
      </nav>

      {/* Below md the links above are hidden, which previously left mobile
          visitors with no navigation at all. A single scrollable row keeps
          them reachable without building a second menu system. */}
      <div className="lg:hidden border-t border-sb-hairline overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-5 px-4 py-2.5 w-max">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.href}
              className="text-xs font-medium text-sb-ink-muted hover:text-sb-ink transition-colors no-underline whitespace-nowrap"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>
    </header>
  )
}
