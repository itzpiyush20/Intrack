// ============================================
// App — Root component with routing
// Code-split via React.lazy for performance
// ============================================

import { useState, useEffect, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { AuthProvider, ToastProvider, CategoriesProvider, useAuth } from '@/context'
import ProtectedRoute from '@/components/auth/ProtectedRoute'
import AdminRoute from '@/components/auth/AdminRoute'
import AutoUpdateChecker from '@/components/AutoUpdateChecker'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import CookieConsent from '@/components/CookieConsent'
import URLAuthTrigger from '@/components/auth/URLAuthTrigger'
import AuthModal from '@/components/auth/AuthModal'
import ScrollProgressBar from '@/components/ui/ScrollProgressBar'
import { PageSkeleton } from '@/components/ui'
import { applyLightTheme, clearStoredTheme } from '@/utils/theme'
import { setCanonical } from '@/utils/seo'
import { lazyWithRetry, prefetchOnIntent } from '@/utils/chunkLoad'
import ScrollToTop from '@/components/ScrollToTop'

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
  const { user } = useAuth()
  if (!MARKETING_ROUTES.has(pathname) || (pathname === '/pricing' && !!user)) return null
  return <ScrollProgressBar />
}

// ─── Lazy loaded (code split) ────────────────────────────
// One import per route path, shared by lazyWithRetry (renders it, retrying a
// failed download) and prefetchOnIntent (starts the download when a finger
// lands on a link to it). See src/utils/chunkLoad.ts for why both exist.
const pageImports = {
  '/dashboard':      () => import('@/pages/DashboardPage'),
  '/expenses':       () => import('@/pages/ExpensesPage'),
  '/budgets':        () => import('@/pages/BudgetsPage'),
  '/pending':        () => import('@/pages/PendingPage'),
  '/insights':       () => import('@/pages/InsightsPage'),
  '/settings':       () => import('@/pages/SettingsPage'),
  '/profile':        () => import('@/pages/ProfilePage'),
  '/subscriptions':  () => import('@/pages/SubscriptionsPage'),
  '/privacy':        () => import('@/pages/PrivacyPage'),
  '/about':          () => import('@/pages/AboutPage'),
  '/terms':          () => import('@/pages/TermsPage'),
  '/pricing':        () => import('@/pages/PricingPage'),
  '/refund-policy':  () => import('@/pages/RefundPage'),
  '/reset-password': () => import('@/pages/ResetPasswordPage'),
  '/admin':          () => import('@/pages/admin/AdminPage'),
  '/motion-lab':     () => import('@/pages/admin/MotionLabPage'),
}

const DashboardPage     = lazyWithRetry(pageImports['/dashboard'])
const ExpensesPage      = lazyWithRetry(pageImports['/expenses'])
const BudgetsPage       = lazyWithRetry(pageImports['/budgets'])
const PendingPage       = lazyWithRetry(pageImports['/pending'])
const InsightsPage      = lazyWithRetry(pageImports['/insights'])
const SettingsPage      = lazyWithRetry(pageImports['/settings'])
const ProfilePage       = lazyWithRetry(pageImports['/profile'])
const SubscriptionsPage = lazyWithRetry(pageImports['/subscriptions'])
const PrivacyPage       = lazyWithRetry(pageImports['/privacy'])
const AboutPage         = lazyWithRetry(pageImports['/about'])
const TermsPage         = lazyWithRetry(pageImports['/terms'])
const PricingPage       = lazyWithRetry(pageImports['/pricing'])
const RefundPage        = lazyWithRetry(pageImports['/refund-policy'])
const ResetPasswordPage = lazyWithRetry(pageImports['/reset-password'])
const AdminPage         = lazyWithRetry(pageImports['/admin'])
const MotionLabPage     = lazyWithRetry(pageImports['/motion-lab'])

// ─── Loading fallback ────────────────────────────────────
/**
 * What fills a route while its code chunk downloads.
 *
 * This used to be a centred spinner, which meant every navigation flashed a
 * "Loading…" screen even when the chunk arrived in 40ms — the flash itself was
 * most of the perceived slowness. Now nothing renders for the first 160ms, so
 * a fast route simply appears, and a genuinely slow one gets a skeleton in the
 * shape of a page rather than a spinner that says only "wait".
 */
function PageLoader() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // setState in a timer callback, not synchronously in the effect body —
    // react-hooks/set-state-in-effect flags the latter.
    const timer = setTimeout(() => setVisible(true), 160)
    return () => clearTimeout(timer)
  }, [])

  if (!visible) return null
  return (
    <div className="min-h-screen bg-surface-0">
      <PageSkeleton />
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
            <Route path="/payment-success" element={<Navigate to="/dashboard" replace />} />
            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminPage />} />
              {/* Temporary: motion tuning page, removed when the motion rollout ends. */}
              <Route path="/motion-lab" element={<MotionLabPage />} />
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

  useEffect(() => prefetchOnIntent(pageImports), [])

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
