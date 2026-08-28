// ============================================
// App — Root component with routing
// Code-split via React.lazy for performance
// ============================================

import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { AuthProvider, ToastProvider, CategoriesProvider } from '@/context'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import AdminRoute from '@/components/auth/AdminRoute'
import AutoUpdateChecker from '@/components/AutoUpdateChecker'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import CookieConsent from '@/components/CookieConsent'
import URLAuthTrigger from '@/components/auth/URLAuthTrigger'
import AuthModal from '@/components/auth/AuthModal'
import ScrollProgressBar from '@/components/ui/ScrollProgressBar'
import { applyLightTheme, clearStoredTheme } from '@/utils/theme'
import { setCanonical } from '@/utils/seo'

// Marketing/legal routes only — app routes don't need a reading-progress chrome element.
const MARKETING_ROUTES = new Set(['/', '/support', '/privacy', '/about', '/terms', '/pricing', '/refund-policy'])

// ─── Eagerly loaded (public pages — tiny) ───────────────
import LandingPage from '@/pages/LandingPage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import SupportPage from '@/pages/SupportPage'

// Helper redirects for in-context authentication modal triggers
function LoginRedirect() {
  const location = useLocation()
  return <Navigate to={`/?auth=login${location.search ? '&' + location.search.substring(1) : ''}${location.hash}`} replace />
}

function SignupRedirect() {
  const location = useLocation()
  return <Navigate to={`/?auth=signup${location.search ? '&' + location.search.substring(1) : ''}${location.hash}`} replace />
}

// Keeps <link rel="canonical"> and og:url pointing at the route actually being
// viewed. Public pages also set it through setPageMeta, to the same value; this
// exists so a route that sets no metadata of its own cannot leave the previous
// page's canonical URL standing.
function CanonicalUrl() {
  const { pathname } = useLocation()
  useEffect(() => { setCanonical(pathname) }, [pathname])
  return null
}

function MarketingScrollProgress() {
  const { pathname } = useLocation()
  if (!MARKETING_ROUTES.has(pathname)) return null
  return <ScrollProgressBar />
}

function ScrollToTop() {
  const { pathname, search, hash } = useLocation()

  useEffect(() => {
    // Check if the change is just an auth modal query param opening/closing
    const params = new URLSearchParams(search)
    // If it has 'auth' and nothing else, ignore. If it has 'auth' and others, or no 'auth', we scroll to top.
    const isOnlyAuthChange = params.has('auth') && Array.from(params.keys()).length === 1
    if (isOnlyAuthChange) return

    // A hash means "take me to that section", which is the opposite of scrolling
    // to the top. Cross-page links like /#features used to be plain <a> tags so
    // the browser handled this with a full page reload; now that they route
    // client-side, the scroll is ours to perform.
    if (hash) {
      // decodeURIComponent THROWS on a lone '%'. This code path runs on every
      // Google OAuth callback, whose hash carries provider tokens and, on
      // failure, an `error_description` of arbitrary text — so an undecodable
      // hash must degrade to the raw string, never take down the sign-in
      // redirect with a URIError.
      let id: string
      try {
        id = decodeURIComponent(hash.slice(1))
      } catch {
        id = hash.slice(1)
      }
      // The target belongs to the route being navigated TO, which has not
      // mounted yet: AnimatedRoutes runs a 300ms exit animation first. So poll
      // rather than checking once.
      //
      // setTimeout, NOT requestAnimationFrame. rAF is paused outright in a
      // backgrounded or non-compositing tab — the same hazard documented on
      // AnimatedRoutes below — which would leave the scroll silently undone.
      // A hash carrying key=value pairs is an auth callback payload, not an
      // anchor name. Bail immediately rather than spending 1.2s polling for an
      // element that cannot exist — this runs on every Google sign-in.
      if (!id || id.includes('=') || id.includes('&')) {
        window.scrollTo(0, 0)
        return
      }

      let cancelled = false
      const deadline = Date.now() + 1200
      const tryScroll = () => {
        if (cancelled) return
        const el = document.getElementById(id)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }
        if (Date.now() < deadline) {
          setTimeout(tryScroll, 60)
          return
        }
        // Gave up. Normal for a hash that was never an anchor — above all
        // Supabase's OAuth `#access_token=…` callback.
        window.scrollTo(0, 0)
      }
      tryScroll()
      return () => { cancelled = true }
    }

    window.scrollTo(0, 0)
  }, [pathname, search, hash])

  return null
}

// ─── Lazy loaded (protected pages — code split) ─────────
const DashboardPage    = lazy(() => import('@/pages/DashboardPage'))
const ExpensesPage     = lazy(() => import('@/pages/ExpensesPage'))
const BudgetsPage      = lazy(() => import('@/pages/BudgetsPage'))
const PendingPage      = lazy(() => import('@/pages/PendingPage'))
const InsightsPage     = lazy(() => import('@/pages/InsightsPage'))
const SettingsPage     = lazy(() => import('@/pages/SettingsPage'))
const ProfilePage      = lazy(() => import('@/pages/ProfilePage'))
const SubscriptionsPage = lazy(() => import('@/pages/SubscriptionsPage'))
const PrivacyPage      = lazy(() => import('@/pages/PrivacyPage'))
const AboutPage        = lazy(() => import('@/pages/AboutPage'))
const TermsPage        = lazy(() => import('@/pages/TermsPage'))
const PricingPage      = lazy(() => import('@/pages/PricingPage'))
const RefundPage       = lazy(() => import('@/pages/RefundPage'))
const ResetPasswordPage = lazy(() => import('@/pages/ResetPasswordPage'))

const PaymentSuccessPage = lazy(() => import('@/pages/PaymentSuccessPage'))

const AdminPage = lazy(() => import('@/pages/admin/AdminPage'))

// ─── Loading fallback ────────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 rounded-full border-2 border-brand-500 border-t-transparent animate-spin" />
        <span className="text-xs text-zinc-500 font-medium">Loading…</span>
      </div>
    </div>
  )
}

// ─── Animated Routes — page transition wrapper ───────────
function AnimatedRoutes() {
  const location = useLocation()
  // No `mode="wait"`, and no exit animation.
  //
  // `mode="wait"` holds the incoming page until the outgoing one has finished
  // exiting. When a route redirects immediately on mount — a mistyped URL,
  // /login, /signup, or any protected route opened while signed out — the key
  // changes before the entry animation has finished, so the exit never starts
  // and the incoming page is never mounted. The result was a blank page showing
  // only the cookie banner: no console error, no failed request, and a correct
  // URL in the address bar. Reproduced on production, and verified fixed
  // against a production build here.
  //
  // Dropping `mode="wait"` alone would let both pages render together for the
  // length of the exit, and since each sets `min-height: 100vh` the document
  // briefly doubles in height and the scrollbar jumps. Removing `exit` too
  // means the outgoing page unmounts at once, so there is no overlap.
  // Transitions are entry-only now, which is what the eye reads anyway.
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={location.pathname}
        // IMPORTANT: animate TRANSFORM ONLY — never opacity — for the app-shell
        // wrapper. framer-motion sets `initial` as an inline style on mount and
        // fades to `animate` via requestAnimationFrame. The browser PAUSES rAF in a
        // backgrounded / mid-transition tab (exactly the tab state during a Google
        // OAuth redirect back to /dashboard) and on a GPU compositor stall (a known
        // failure mode here — see commit 55d2ace). If we gated visibility on opacity,
        // a stalled animation would leave the ENTIRE app (nav + content) at opacity:0
        // — a blank white screen with a correct page title. A stalled transform only
        // leaves content a few px off, so the app is always visible regardless.
        initial={{ y: 14 }}
        animate={{ y: 0 }}
        transition={{ duration: 0.30, ease: [0.16, 1, 0.3, 1] }}
        style={{ minHeight: '100vh' }}
      >
        <Routes location={location}>
          {/* Public routes */}
          <Route path="/"                element={<LandingPage />} />
          <Route path="/login"           element={<LoginRedirect />} />
          <Route path="/signup"          element={<SignupRedirect />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/support"         element={<SupportPage />} />
          <Route path="/privacy"         element={<PrivacyPage />} />
          <Route path="/about"           element={<AboutPage />} />
          <Route path="/terms"           element={<TermsPage />} />
          <Route path="/pricing"         element={<PricingPage />} />
          <Route path="/refund-policy"   element={<RefundPage />} />
          <Route path="/reset-password"  element={<ResetPasswordPage />} />

          {/* Protected routes */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard"       element={<DashboardPage />} />
            <Route path="/expenses"        element={<ExpensesPage />} />
            <Route path="/budgets"         element={<BudgetsPage />} />
            <Route path="/pending"         element={<PendingPage />} />
            <Route path="/insights"        element={<InsightsPage />} />
            <Route path="/settings"        element={<SettingsPage />} />
            <Route path="/profile"         element={<ProfilePage />} />
            <Route path="/subscriptions"   element={<SubscriptionsPage />} />
            <Route path="/payment-success" element={<PaymentSuccessPage />} />
            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
  )
}

function App() {

  // The inline script in index.html already painted light before first paint.
  // This re-applies it after hydration and drops any preference left over from
  // the removed toggle — see src/utils/theme.ts.
  useEffect(() => {
    applyLightTheme()
    clearStoredTheme()
  }, [])

  return (
    <BrowserRouter>
      <MotionConfig reducedMotion="user">
        <ScrollToTop />
        <CanonicalUrl />
        <AutoUpdateChecker />
        <CookieConsent />
        <AuthProvider>
          <CategoriesProvider>
            <ToastProvider>
              <ErrorBoundary>
                <Suspense fallback={<PageLoader />}>
                  <ErrorBoundary fallback={null}>
                    <URLAuthTrigger />
                  </ErrorBoundary>
                  <AuthModal />
                  <MarketingScrollProgress />

                  <AnimatedRoutes />
                </Suspense>
              </ErrorBoundary>
            </ToastProvider>
          </CategoriesProvider>
        </AuthProvider>
      </MotionConfig>
    </BrowserRouter>
  )
}

export default App
