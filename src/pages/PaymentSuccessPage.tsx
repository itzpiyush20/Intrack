// ============================================
// PaymentSuccessPage — the receipt for a purchase made in this tab
//
// Restyle only. The router-state guard, the redirect when there is no receipt,
// the plan-name matching and the status polling are all untouched.
//
// The visual brief here is "receipt", not "celebration": this is the screen a
// customer screenshots when something later goes wrong with their money, so it
// reads as a record — a labelled list of what was bought, its state, and the
// date that matters. The 👑 in a pinging halo and "Subscription Activated!"
// went with the aurora era; an animated ring is also decoration, which the
// motion rules ban outright.
// ============================================

import { useEffect, useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { CheckCircle2, CalendarClock, Loader2 } from 'lucide-react'
import { motion, useReducedMotion } from 'framer-motion'
import AppLayout from '@/layouts/AppLayout'
import { Button, Card, panelVariants, transition } from '@/components/ui'
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

  const reduce = useReducedMotion()

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
      <motion.div
        variants={panelVariants(reduce)}
        initial="initial"
        animate="animate"
        transition={transition(reduce)}
        className="mx-auto max-w-md"
      >
        <div className="flex flex-col items-center text-center">
          <span
            className={
              queued
                ? 'flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)] text-[var(--status-warning-text)]'
                : 'flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)]'
            }
          >
            {queued
              ? <CalendarClock className="h-7 w-7" aria-hidden="true" />
              : <CheckCircle2 className="h-7 w-7" aria-hidden="true" />}
          </span>

          <h1 className="mt-5 text-2xl font-bold tracking-tight text-zinc-50 text-balance md:text-3xl">
            {queued ? 'Payment received' : 'You’re all set'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            {queued
              ? 'Your new plan is paid for and scheduled. It starts on its own the day your current plan ends — there is nothing else to do.'
              : 'Your payment went through and your plan is on. Everything Intrack does is open to you.'}
          </p>
        </div>

        {/* The receipt itself. A description list, not a stack of rows: these
            are labelled facts about one purchase. */}
        <Card className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Your purchase</h2>
          <dl className="mt-4 flex flex-col">
            <div className="flex items-center justify-between gap-4 border-b border-border-subtle py-3 first:pt-0">
              <dt className="text-sm text-zinc-400">Plan</dt>
              <dd className="text-sm font-semibold text-zinc-100">{planName}</dd>
            </div>

            <div className="flex items-center justify-between gap-4 border-b border-border-subtle py-3">
              <dt className="text-sm text-zinc-400">Status</dt>
              <dd>
                {queued ? (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--status-warning-border)] bg-[var(--status-warning-subtle)] px-2.5 py-0.5 text-xs font-medium text-[var(--status-warning-text)]">
                    <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Scheduled
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--status-positive-border)] bg-[var(--status-positive-subtle)] px-2.5 py-0.5 text-xs font-medium text-[var(--status-positive-text)]">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Active
                  </span>
                )}
              </dd>
            </div>

            <div className="flex items-center justify-between gap-4 py-3 last:pb-0">
              {/* Not "Renewal Date". Both plans are one-time payments — no
                  mandate, nothing recurring — which is the promise the pricing
                  page is built around. Calling this a renewal date told the
                  customer to expect a charge that will never arrive. */}
              <dt className="text-sm text-zinc-400">{queued ? 'Starts on' : 'Access until'}</dt>
              <dd className="text-sm font-semibold text-zinc-100 tnum">{formattedDate}</dd>
            </div>
          </dl>
        </Card>

        {/* Verification Status */}
        {verifying ? (
          <p
            role="status"
            className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-border-subtle bg-surface-2 py-3 text-sm text-zinc-400"
          >
            <Loader2
              className={reduce ? 'h-4 w-4 shrink-0' : 'h-4 w-4 shrink-0 animate-spin'}
              aria-hidden="true"
            />
            Switching your plan on…
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            <Button onClick={() => navigate('/dashboard')} block size="lg">
              Go to my dashboard
            </Button>

            {!queued && profile?.subscription_status !== 'active' && (
              <p className="text-sm leading-relaxed text-zinc-400">
                Your payment is confirmed. Switching the plan on can take up to a minute — open
                your dashboard, and reload the page once if anything still looks locked. If it
                is still locked after that,{' '}
                <Link
                  to="/support"
                  className="rounded font-medium text-brand-400 underline underline-offset-2 transition-colors hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  tell support
                </Link>{' '}
                and we'll sort it out.
              </p>
            )}
          </div>
        )}
      </motion.div>
    </AppLayout>
  )
}
