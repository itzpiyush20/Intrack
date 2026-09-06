// ============================================
// PaymentSuccessPage — Deprecated
//
// Per plans/remove-what-razorpay-handles.md, in-app receipts are retired.
// Official receipts are handled directly by the payment aggregator via email.
// Successful checkouts redirect directly to /dashboard with an entitlement toast.
// Any bookmark or legacy visit to /payment-success redirects to /dashboard.
// ============================================

import { Navigate } from 'react-router-dom'

export default function PaymentSuccessPage() {
  return <Navigate to="/dashboard" replace />
}
