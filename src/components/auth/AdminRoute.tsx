// ============================================
// AdminRoute — hides the admin section from non-admins.
//
// Cosmetic by design: the real gate is the is_admin() check inside every admin
// SQL function. Defeating this in a browser yields an empty page.
// ============================================

import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { canAccessAdmin } from '@/services/adminAccess'
import { PageSkeleton } from '@/components/ui'

export default function AdminRoute() {
  const { profile, loading } = useAuth()

  // A null profile means the fetch has not resolved yet, not that the user is
  // unauthorised. Redirecting on it would eject an admin whenever the profile
  // is momentarily in flight — which is what minimising the window causes.
  if (loading || !profile) {
    return (
      <div className="min-h-svh bg-surface-0">
        <PageSkeleton />
      </div>
    )
  }

  if (!canAccessAdmin(profile)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
