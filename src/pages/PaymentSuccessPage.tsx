import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import AppLayout from '@/layouts/AppLayout'
import { Button } from '@/components/ui'
import { useAuth } from '@/context'

export default function PaymentSuccessPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { profile, refreshProfile } = useAuth()
  const [verifying, setVerifying] = useState(true)
  const [attempts, setAttempts] = useState(0)

  // This page is a RECEIPT for a purchase that just happened in this tab, and
  // router state is the only evidence of that. It used to substitute a default
  // — planName 'Pro', expiry 30 days out — when the state was missing, so
  // anyone who bookmarked, refreshed, or simply typed /payment-success was
  // shown "Subscription Activated!" with a fabricated renewal date for a
  // purchase that never happened. Nothing is invented now; with no state we
  // send them to the page that shows their real plan.
  const rawState = location.state as {
    planName?: string
    expiresAt?: string
    queued?: boolean
    startsAt?: string
  } | null

  const hasReceipt = !!rawState

  useEffect(() => {
    if (!hasReceipt) navigate('/pricing', { replace: true })
  }, [hasReceipt, navigate])

  // A queued purchase is paid for but does NOT start until the current plan
  // ends. Nothing about the account changes today, so this page must not
  // announce access the customer does not yet have.
  const queued = rawState?.queued === true
  const startsAt = rawState?.startsAt
  const shownDate = queued ? startsAt : rawState?.expiresAt

  // PricingPage sends 'Monthly' or 'Yearly' — the labels shown on its own
  // cards. The test here was against 'monthly', 'Starter Monthly' and 'Basic',
  // none of which it has ever sent, so capital-M 'Monthly' fell through to the
  // else branch and every customer who bought the ₹31 monthly plan was handed
  // a receipt saying "Pro". Matching is case-insensitive now so a label
  // capitalised differently cannot silently mean the wrong plan again.
  const planName = /^(monthly|starter monthly|basic)$/i.test(rawState?.planName ?? '')
    ? 'Basic'
    : 'Pro'

  // Poll profile to check if backend/webhook has updated status to active
  useEffect(() => {
    let interval: any

    // Nothing to verify without a receipt — the effect above is already
    // navigating away.
    if (!hasReceipt) return

    // A queued plan never flips the status today — polling for 'active' would
    // spin for ten seconds and then show a "status syncing" warning for
    // something that is working exactly as intended.
    if (queued) {
      setVerifying(false)
      return
    }

    const checkStatus = async () => {
      await refreshProfile()
      
      if (profile?.subscription_status === 'active') {
        setVerifying(false)
      } else if (attempts > 5) {
        // Stop polling after 5 attempts (10 seconds), let the user click manual refresh
        setVerifying(false)
      } else {
        setAttempts((prev) => prev + 1)
      }
    }

    if (profile?.subscription_status !== 'active') {
      interval = setInterval(checkStatus, 2000)
    } else {
      setVerifying(false)
    }

    return () => clearInterval(interval)
  }, [profile, attempts, queued, hasReceipt])

  // Rendered nothing rather than a placeholder receipt: the effect above
  // redirects, and a frame of "Subscription Activated!" for a purchase that
  // did not happen is the whole bug.
  if (!hasReceipt) return null

  const formattedDate = shownDate
    ? new Date(shownDate).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : 'when your current plan ends'

  return (
    <AppLayout>
      <div className="max-w-md mx-auto py-12 px-4 text-center space-y-8 animate-scale-up">
        {/* Animated Checkmark Container */}
        <div className="relative flex items-center justify-center mx-auto h-24 w-24 rounded-full bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] shadow-[var(--shadow-md)]">
          {/* Confetti Micro-animations */}
          <div className="absolute inset-0 rounded-full animate-ping bg-[var(--status-positive-subtle)]/5 duration-1000" />
          <span className="text-5xl" aria-hidden="true">{queued ? '🗓️' : '👑'}</span>
        </div>

        {/* Text Details */}
        <div className="space-y-3">
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            {queued ? 'Payment Received!' : 'Subscription Activated!'}
          </h1>
          <p className="text-zinc-400 text-sm">
            {queued
              ? 'Your new plan is scheduled. It starts automatically when your current plan ends — nothing else to do.'
              : 'Thank you for upgrading. Your account is now fully unlocked.'}
          </p>
        </div>

        {/* Details Card */}
        <div className="bg-surface-1 border border-border-subtle rounded-3xl p-6 shadow-xl space-y-4">
          <div className="flex justify-between items-center text-xs pb-3 border-b border-border-subtle/50">
            <span className="text-zinc-500">Selected Plan</span>
            <span className="font-bold text-white">{planName}</span>
          </div>

          <div className="flex justify-between items-center text-xs pb-3 border-b border-border-subtle/50">
            <span className="text-zinc-500">Subscription Status</span>
            {queued ? (
              <span className="px-2 py-0.5 rounded-full text-xs font-extrabold uppercase bg-[var(--status-warning-subtle)] border border-[var(--status-warning-border)] text-[var(--status-warning-text)]">
                Scheduled
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full text-xs font-extrabold uppercase bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] text-[var(--status-positive-text)]">
                Active
              </span>
            )}
          </div>

          <div className="flex justify-between items-center text-xs">
            {/* Not "Renewal Date". Both plans are one-time payments — no
                mandate, nothing recurring — which is the promise the pricing
                page is built around. Calling this a renewal date told the
                customer to expect a charge that will never arrive. */}
            <span className="text-zinc-500">{queued ? 'Starts On' : 'Access until'}</span>
            <span className="font-semibold text-zinc-300">{formattedDate}</span>
          </div>
        </div>

        {/* Verification Status */}
        {verifying ? (
          <div className="flex items-center justify-center gap-2 text-xs text-brand-400 animate-pulse bg-brand-500/5 border border-brand-500/10 py-3 rounded-2xl">
            <svg className="animate-spin h-4 w-4 text-brand-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Verifying subscription status...</span>
          </div>
        ) : (
          <div className="space-y-3">
            <Button
              onClick={() => navigate('/dashboard')}
              block
              size="lg"
            >
              Go to Dashboard
            </Button>
            
            {!queued && profile?.subscription_status !== 'active' && (
              <p className="text-xs text-zinc-500 leading-normal">
                Status syncing in background. If your Pro or Basic access doesn't unlock immediately, click return and refresh the page.
              </p>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}
