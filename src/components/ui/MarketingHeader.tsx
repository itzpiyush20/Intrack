import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Menu, X } from 'lucide-react'
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
  { label: 'Security', href: '/#security' },
  { label: 'Install App', href: '/#install-guide' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'FAQ', href: '/#faq' },
  { label: 'Support', href: '/support' },
]

export default function MarketingHeader() {
  const { user, openAuthModal } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <header className="sticky top-0 z-50 bg-sb-canvas/90 backdrop-blur-md border-b border-sb-hairline transition-all">
      <nav className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between" aria-label="Primary">
        <Link to="/" className="flex items-center gap-3 group no-underline shrink-0">
          <BrandMark size={32} className="text-brand-500 shrink-0 group-hover:scale-105 transition-transform duration-300" />
          <span className="text-base font-extrabold tracking-tight">
            <span className="text-brand-500">In</span><span className="text-sb-ink">track</span>
          </span>
          <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wider uppercase px-2.5 py-0.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-600">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Autonomous Finance
          </span>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden lg:flex items-center gap-7">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              to={item.href}
              className="text-sm font-medium text-sb-ink-muted hover:text-sb-ink transition-colors no-underline"
            >
              {item.label}
            </Link>
          ))}
        </div>

        {/* Auth CTA & Mobile Trigger */}
        <div className="flex items-center gap-3">
          {user ? (
            <UserMenu />
          ) : (
            <div className="hidden sm:flex items-center gap-3">
              <button
                onClick={() => openAuthModal(undefined, 'login')}
                className="text-sm font-medium text-sb-ink-muted hover:text-sb-ink transition-colors bg-transparent border-0 cursor-pointer px-2.5 py-2"
              >
                Sign in
              </button>
              <button
                onClick={() => openAuthModal(undefined, 'signup')}
                className="sb-btn-primary border-0 cursor-pointer shadow-sm hover:shadow-md transition-shadow"
              >
                Start free trial
              </button>
            </div>
          )}

          {/* Mobile Menu Button */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            className="lg:hidden flex items-center justify-center w-10 h-10 rounded-lg border border-sb-hairline text-sb-ink-secondary hover:text-sb-ink hover:bg-surface-2 transition-colors cursor-pointer bg-transparent"
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Dropdown */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="lg:hidden border-t border-sb-hairline bg-sb-canvas shadow-lg overflow-hidden"
          >
            <div className="px-4 pt-3 pb-6 space-y-1">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2.5 rounded-lg text-sm font-medium text-sb-ink-secondary hover:text-sb-ink hover:bg-surface-2 transition-colors no-underline"
                >
                  {item.label}
                </Link>
              ))}

              {!user && (
                <div className="pt-4 mt-2 border-t border-sb-hairline flex flex-col gap-2">
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false)
                      openAuthModal(undefined, 'login')
                    }}
                    className="w-full text-center py-2.5 text-sm font-medium text-sb-ink hover:bg-surface-2 rounded-lg border border-sb-hairline bg-surface-1 cursor-pointer"
                  >
                    Sign in
                  </button>
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false)
                      openAuthModal(undefined, 'signup')
                    }}
                    className="sb-btn-primary w-full justify-center py-2.5 text-sm font-medium border-0 cursor-pointer"
                  >
                    Start free trial
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
