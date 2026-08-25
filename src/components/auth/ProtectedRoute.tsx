// ============================================
// ProtectedRoute — Redirect to login if not authenticated
// ============================================

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'

export default function ProtectedRoute() {
  const { user, loading, isSubscriptionActive } = useAuth()
  const location = useLocation()

  // `loading` from AuthContext now stays true until the subscription question
  // has a database-backed answer, so this spinner — not a redirect to /pricing —
  // is what a signed-in user sees while the profile row is in flight. That is
  // deliberate: isSubscriptionActive is false until proven otherwise, and
  // rendering the paywall on "not proven yet" would show every paying customer
  // an upgrade screen on each cold load.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
          <p className="text-sm text-zinc-400">Loading...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to={`/?auth=login&redirect=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }

  // Exemptions list for expired accounts: /settings, /profile, /support, and /pricing itself
  // /admin is exempt so an owner or buyer can always reach operational tooling,
  // even if their own subscription has lapsed. AdminRoute still gates it.
  const isExempted = ['/settings', '/profile', '/support', '/pricing', '/admin'].includes(location.pathname)

  // isSubscriptionActive is derived from the profiles row alone, never from the
  // intrack_sub_* localStorage cache that paints the header. Editing those
  // keys changes what the plan badge says and nothing about what this gate does.
  if (!isSubscriptionActive && !isExempted) {
    return <Navigate to="/pricing" replace />
  }

  return <Outlet />
}
