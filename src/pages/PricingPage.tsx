// ============================================
// PricingPage — Modern Luxury Fintech Edition
// Minimalist, sovereign, transparent pricing
// ============================================

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppLayout from '@/layouts/AppLayout'
import { useAuth, useToast } from '@/context'
import { motion, useReducedMotion } from 'framer-motion'
import { useScrollReveal } from '@/hooks'
import { supabase } from '@/services/supabase'
import { formatDate, cn } from '@/utils'
import { setPageMeta } from '@/utils/seo'
import { ANNUAL_PER_DAY, ANNUAL_SAVING_PCT, APP_CONFIG, PRICING } from '@/constants'
import {
  Sparkles,
  CheckCircle2,
  ShieldCheck,
  Ticket,
  RotateCcw,
  Loader2,
  Clock,
  AlertTriangle,
  Crown,
  Lock,
} from 'lucide-react'
import { cancelSubscription as cancelLegacySubscription } from '@/services'
import { createSubscription, cancelSubscription as cancelRazorpaySubscription } from '@/services/subscriptionBilling'
import {
  PricingAmbientBackground,
  PricingFaqAccordion,
  CancelSubscriptionModal,
  RedeemPromoModal,
} from './pricing'

interface RazorpayInstance {
  on: (event: string, callback: (response: { error?: { description?: string } }) => void) => void
  open: () => void
}

interface RazorpayConstructor {
  new (options: Record<string, unknown>): RazorpayInstance
}

declare global {
  interface Window {
    Razorpay?: RazorpayConstructor
  }
}

export default function PricingPage() {
  const navigate = useNavigate()
  const { user, profile, daysLeft, openAuthModal, refreshProfile } = useAuth()
  const { showToast } = useToast()
  const reduceMotion = useReducedMotion()

  const [processingPlan, setProcessingPlan] = useState<'monthly' | 'annual' | null>(null)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [promoModalOpen, setPromoModalOpen] = useState(false)

  useScrollReveal()

  const status = profile?.subscription_status
  const isExpired = status === 'expired' || (status === 'active' && daysLeft <= 0) || (status === 'trial' && daysLeft <= 0)
  const isCancelled = status === 'cancelled'
  const hasQueuedPlan = !!profile?.pending_plan_type
  const isActive = status === 'active' && daysLeft > 0
  const isTrial = status === 'trial' && daysLeft > 0

  const isOnYearly = (isActive || (isCancelled && daysLeft > 0)) && profile?.subscription_plan_type !== 'monthly' && profile?.subscription_plan_type !== 'trial'
  const isOnMonthly = (isActive || (isCancelled && daysLeft > 0)) && profile?.subscription_plan_type === 'monthly'
  const hasMandate = !!profile?.razorpay_subscription_id

  const activePlanName = isOnYearly
    ? 'Annual Plan'
    : isOnMonthly
    ? 'Monthly Plan'
    : isTrial
    ? '7-Day Free Trial'
    : 'Subscription'

  useEffect(() => {
    setPageMeta({
      title: `Pricing | ${APP_CONFIG.APP_NAME}`,
      description: `Intrack costs ₹${PRICING.MONTHLY_AMOUNT}/month or ₹${PRICING.ANNUAL_AMOUNT}/year. Every plan starts with an unrestricted 7-day trial. Auto-renews via UPI Autopay or card e-mandate. Cancel anytime.`,
      canonicalPath: '/pricing',
    })
  }, [])

  // ── Razorpay Script Loader ─────────────────────────────────────
  const loadRazorpayScript = () =>
    new Promise<boolean>((resolve) => {
      if (window.Razorpay) return resolve(true)
      const existingScript = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(true))
        existingScript.addEventListener('error', () => resolve(false))
        return
      }
      const script = document.createElement('script')
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      script.async = true
      script.onload = () => resolve(true)
      script.onerror = () => resolve(false)
      document.body.appendChild(script)
    })

  // ── Direct One-Click Checkout ──────────────────────────────────
  const handleDirectCheckout = async (plan: 'monthly' | 'annual') => {
    if (!user) {
      openAuthModal('/pricing', 'login')
      return
    }

    if (hasMandate) {
      showToast('You already have an auto-renewing subscription. Manage it in Settings.', 'info')
      navigate('/settings?tab=billing')
      return
    }

    if (hasQueuedPlan) {
      showToast('A plan is already queued on your account.', 'warning')
      return
    }

    setProcessingPlan(plan)
    const scriptLoaded = await loadRazorpayScript()
    if (!scriptLoaded) {
      showToast('Failed to load payment gateway SDK. Check your internet connection.', 'error')
      setProcessingPlan(null)
      return
    }

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        showToast('Your session expired. Please log in again.', 'error')
        setProcessingPlan(null)
        return
      }

      const clientKey = import.meta.env.VITE_RAZORPAY_KEY_ID
      if (!clientKey || !clientKey.startsWith('rzp_')) {
        throw new Error('Payments are not configured on this deployment. Please contact support — you have not been charged.')
      }

      const { id: subscriptionId, startsAt } = await createSubscription(plan, session.access_token)
      const planTitle = plan === 'annual' ? 'Annual' : 'Monthly'

      const options = {
        key: clientKey,
        subscription_id: subscriptionId,
        name: APP_CONFIG.APP_NAME,
        description: `${planTitle} plan`,
        prefill: { name: profile?.full_name || '', email: user.email || '' },
        theme: { color: '#0e7a5d' },
        handler: async () => {
          await refreshProfile()
          showToast(
            startsAt
              ? `Mandate authorised. Your ${planTitle} plan starts on ${formatDate(new Date(startsAt * 1000).toISOString())} — you retain existing days, and the verification charge is refunded automatically.`
              : `Payment received. Your ${planTitle} plan is active.`,
            'success',
          )
          navigate('/dashboard')
        },
        modal: {
          ondismiss: () => setProcessingPlan(null),
        },
      }

      const RazorpayCtor = window.Razorpay
      if (!RazorpayCtor) {
        showToast('Payment gateway failed to initialize.', 'error')
        setProcessingPlan(null)
        return
      }

      const rzp = new RazorpayCtor(options)
      rzp.on('payment.failed', (response: { error?: { description?: string } }) => {
        showToast(`Payment Failed: ${response?.error?.description || 'Unknown error'}`, 'error')
        setProcessingPlan(null)
      })
      rzp.open()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast(`Checkout error: ${message}`, 'error')
      setProcessingPlan(null)
    }
  }

  // ── Confirm Cancellation ───────────────────────────────────────
  const handleConfirmCancel = async (reason: string, feedback: string) => {
    setCancelling(true)
    try {
      const expiryStr = profile?.subscription_expires_at ? formatDate(profile.subscription_expires_at) : 'the end of your prepaid period'
      if (profile?.razorpay_subscription_id) {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          throw new Error('Your session expired. Please log in again.')
        }
        await cancelRazorpaySubscription(session.access_token)
      } else {
        const { error } = await cancelLegacySubscription(reason, feedback)
        if (error) throw error
      }
      await refreshProfile()
      setCancelModalOpen(false)
      showToast(`Subscription cancelled. You retain full access until ${expiryStr}.`, 'info')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast(`Failed to cancel subscription: ${message}`, 'error')
    } finally {
      setCancelling(false)
    }
  }

  // ── Resume Renewal ─────────────────────────────────────────────
  const handleReactivate = async () => {
    setReactivating(true)
    try {
      const targetPlan = profile?.subscription_plan_type === 'monthly' ? 'monthly' : 'annual'
      await handleDirectCheckout(targetPlan)
    } finally {
      setReactivating(false)
    }
  }

  return (
    <AppLayout>
      <div className="relative animate-fade-in text-sb-ink max-w-6xl mx-auto space-y-10 pb-16 overflow-x-hidden">
        {/* Ambient lighting */}
        <PricingAmbientBackground />

        {/* ── Logged-in Member Status Ribbon ────────────────────────── */}
        {user && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className="rounded-2xl bg-surface-1/90 backdrop-blur-md border border-sb-hairline p-4 sm:p-4.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs"
          >
            <div className="flex items-center gap-3">
              <div className={cn(
                "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border",
                isActive ? "bg-brand-500/10 border-brand-500/20 text-brand-600" :
                isTrial ? "bg-amber-500/10 border-amber-500/20 text-amber-600" :
                isCancelled ? "bg-rose-500/10 border-rose-500/20 text-rose-600" :
                "bg-surface-2 border-sb-hairline text-sb-ink-muted"
              )}>
                {isActive ? <Crown className="w-4 h-4" /> :
                 isTrial ? <Sparkles className="w-4 h-4" /> :
                 isCancelled ? <Clock className="w-4 h-4" /> :
                 <AlertTriangle className="w-4 h-4" />}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-sb-ink">
                    {activePlanName}
                  </span>
                  <span className={cn(
                    "text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full border",
                    isActive ? "bg-brand-500/10 text-brand-700 border-brand-500/20" :
                    isTrial ? "bg-amber-500/10 text-amber-700 border-amber-500/20" :
                    isCancelled ? "bg-rose-500/10 text-rose-700 border-rose-500/20" :
                    "bg-surface-2 text-sb-ink-muted border-sb-hairline"
                  )}>
                    {isActive ? 'Active' : isTrial ? `${daysLeft}d left` : isCancelled ? 'Cancelled' : isExpired ? 'Expired' : 'Active'}
                  </span>
                </div>

                <p className="text-[11px] text-sb-ink-secondary mt-0.5">
                  {profile?.subscription_expires_at ? (
                    <>
                      {hasMandate && isActive && !isCancelled
                        ? `Renews automatically on ${formatDate(profile.subscription_expires_at)}`
                        : `Prepaid access active until ${formatDate(profile.subscription_expires_at)}`}
                      {daysLeft > 0 && ` (${daysLeft} days remaining)`}
                    </>
                  ) : (
                    'Complimentary access'
                  )}
                </p>
              </div>
            </div>

            {/* In-bar actions */}
            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              {isCancelled && daysLeft > 0 && (
                <button
                  type="button"
                  onClick={handleReactivate}
                  disabled={reactivating}
                  className="sb-btn-primary py-1.5 px-3 text-xs font-semibold cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className={cn("w-3.5 h-3.5", reactivating && "animate-spin")} />
                  <span>{reactivating ? 'Opening checkout…' : 'Resume renewal'}</span>
                </button>
              )}

              {(isActive || isTrial) && (
                <button
                  type="button"
                  onClick={() => setCancelModalOpen(true)}
                  className="text-xs font-medium text-sb-ink-muted hover:text-rose-600 px-2.5 py-1.5 rounded-lg transition-colors bg-transparent border-0 cursor-pointer"
                >
                  Cancel subscription
                </button>
              )}

              {hasMandate && (
                <Link
                  to="/settings?tab=billing"
                  className="text-xs font-medium text-brand-600 hover:text-brand-700 px-2.5 py-1.5 rounded-lg transition-colors no-underline"
                >
                  Manage
                </Link>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Page Hero Header ──────────────────────────────────────── */}
        <div className="text-center max-w-2xl mx-auto space-y-3 pt-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-600 text-xs font-semibold tracking-wide">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Sovereign Financial Intelligence</span>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-sb-ink">
            Pricing
          </h1>

          <p className="text-sm sm:text-base text-sb-ink-secondary leading-relaxed max-w-lg mx-auto">
            Zero manual entry. Transparent, sovereign plans backed by bank-grade security.
            Start free, cancel anytime.
          </p>
        </div>

        {/* ── 3-Card Symmetrical Grid ───────────────────────────────── */}
        <div className="grid md:grid-cols-3 gap-6 items-stretch pt-2">
          {/* 1. Trial Plan Card */}
          <div className="rounded-3xl p-6 sm:p-7 flex flex-col justify-between relative bg-surface-1 border border-sb-hairline shadow-xs hover:border-sb-hairline/80 transition-all">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-sb-ink-muted font-mono bg-surface-2 px-2.5 py-0.5 rounded-md border border-sb-hairline">
                  Complimentary
                </span>
                {user && isTrial && (
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-700 bg-brand-500/10 px-2 py-0.5 rounded-md border border-brand-500/20">
                    Current Plan
                  </span>
                )}
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-sb-ink">7-Day Trial</h2>
              <p className="text-xs text-sb-ink-secondary leading-relaxed mt-1 mb-5">
                Experience full automated intelligence with zero upfront commitment.
              </p>

              {/* Price */}
              <div className="mb-6 p-4 rounded-2xl bg-surface-2/40 border border-sb-hairline">
                <div className="flex items-baseline gap-1">
                  <span className="font-extrabold text-3xl sm:text-4xl text-sb-ink tracking-tight font-mono tnum">₹0</span>
                  <span className="text-xs text-sb-ink-muted">/ 7 days</span>
                </div>
                <p className="text-[11px] text-sb-ink-muted mt-1">
                  No credit card required
                </p>
              </div>

              {/* Features */}
              <ul className="space-y-2.5 border-t border-sb-hairline/80 pt-4 mb-6">
                {[
                  'Full read-only Gmail bank alert scans',
                  'Real-time Gemini AI expense classification',
                  'Smart budgets & subscription radar',
                  'Instant start on sign-up with zero risk',
                ].map((feat) => (
                  <li key={feat} className="flex items-start gap-2.5 text-xs text-sb-ink font-medium">
                    <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0 mt-0.2" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Action */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    openAuthModal('/pricing', 'signup')
                  }
                }}
                disabled={!!user}
                className={cn(
                  "w-full justify-center py-3 text-xs sm:text-sm font-semibold rounded-xl border transition-all",
                  !user
                    ? "sb-btn-secondary cursor-pointer hover:bg-surface-2"
                    : isTrial
                    ? "bg-brand-500/10 text-brand-700 border-brand-500/20 cursor-default"
                    : "opacity-40 cursor-default border-sb-hairline bg-surface-2 text-sb-ink-muted"
                )}
              >
                {!user
                  ? 'Start 7-Day Free Trial'
                  : isTrial
                  ? `Current Plan (${daysLeft}d left)`
                  : isExpired
                  ? 'Trial Expired'
                  : 'Trial Completed'}
              </button>
            </div>
          </div>

          {/* 2. Monthly Plan Card */}
          <div className="rounded-3xl p-6 sm:p-7 flex flex-col justify-between relative bg-surface-1 border border-sb-hairline shadow-xs hover:border-sb-hairline/80 transition-all">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-sb-ink-muted font-mono bg-surface-2 px-2.5 py-0.5 rounded-md border border-sb-hairline">
                  Flexible
                </span>
                {user && isOnMonthly && (
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-700 bg-brand-500/10 px-2 py-0.5 rounded-md border border-brand-500/20">
                    Current Plan
                  </span>
                )}
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-sb-ink">Monthly</h2>
              <p className="text-xs text-sb-ink-secondary leading-relaxed mt-1 mb-5">
                Month-to-month sovereignty. Cancel anytime in one click.
              </p>

              {/* Price */}
              <div className="mb-6 p-4 rounded-2xl bg-surface-2/40 border border-sb-hairline">
                <div className="flex items-baseline gap-1">
                  <span className="font-extrabold text-3xl sm:text-4xl text-sb-ink tracking-tight font-mono tnum">
                    ₹{PRICING.MONTHLY_AMOUNT}
                  </span>
                  <span className="text-xs text-sb-ink-muted">/ month</span>
                </div>
                <p className="text-[11px] text-sb-ink-muted mt-1">
                  Auto-renews monthly · Cancel anytime
                </p>
              </div>

              {/* Features */}
              <ul className="space-y-2.5 border-t border-sb-hairline/80 pt-4 mb-6">
                {[
                  'Everything in Trial without expiry',
                  '2 on-demand inbox scans daily (4h cooldown)',
                  'Real-time merchant & category learning',
                  'Encrypted offline backup & CSV/JSON export',
                ].map((feat) => (
                  <li key={feat} className="flex items-start gap-2.5 text-xs text-sb-ink font-medium">
                    <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0 mt-0.2" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Action */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => handleDirectCheckout('monthly')}
                disabled={
                  processingPlan === 'monthly' ||
                  (!!user && isOnMonthly) ||
                  (!!user && hasMandate)
                }
                className={cn(
                  "w-full justify-center py-3 text-xs sm:text-sm font-semibold rounded-xl border transition-all flex items-center gap-1.5 shadow-xs",
                  user && isOnMonthly
                    ? "bg-brand-500/10 text-brand-700 border-brand-500/20 cursor-default"
                    : user && hasMandate
                    ? "opacity-50 cursor-not-allowed border-sb-hairline bg-surface-2 text-sb-ink-muted"
                    : "sb-btn-secondary cursor-pointer hover:border-brand-500/40"
                )}
              >
                {processingPlan === 'monthly' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Opening Gateway…</span>
                  </>
                ) : user && isOnMonthly ? (
                  'Current Plan'
                ) : user && hasMandate ? (
                  'Auto-renewing'
                ) : (
                  'Monthly Pay Now'
                )}
              </button>
            </div>
          </div>

          {/* 3. Annual Plan Card (Featured Crown Jewel) */}
          <div className="rounded-3xl p-6 sm:p-7 flex flex-col justify-between relative bg-surface-1 border-2 border-brand-500/60 shadow-[0_12px_45px_-10px_rgba(14,122,93,0.18)] hover:shadow-[0_16px_50px_-10px_rgba(14,122,93,0.24)] transition-all">
            {/* Top highlight ribbon */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-brand-600 to-emerald-600 text-white text-[10px] font-extrabold uppercase tracking-wider px-3 py-0.5 rounded-full shadow-sm flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-amber-300" />
              <span>Save {ANNUAL_SAVING_PCT}% · Best Value</span>
            </div>

            <div>
              <div className="flex items-center justify-between gap-2 mb-3 mt-1">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-brand-700 font-mono bg-brand-500/10 px-2.5 py-0.5 rounded-md border border-brand-500/20">
                  Annual Sovereign
                </span>
                {user && isOnYearly && (
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-700 bg-brand-500/10 px-2 py-0.5 rounded-md border border-brand-500/20">
                    Current Plan
                  </span>
                )}
              </div>

              <h2 className="text-xl sm:text-2xl font-bold text-sb-ink">Annual</h2>
              <p className="text-xs text-sb-ink-secondary leading-relaxed mt-1 mb-5">
                Our definitive tier. Complete peace of mind and maximum savings for the full year.
              </p>

              {/* Price */}
              <div className="mb-6 p-4 rounded-2xl bg-brand-500/5 border border-brand-500/20">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-1">
                    <span className="font-extrabold text-3xl sm:text-4xl text-sb-ink tracking-tight font-mono tnum">
                      ₹{PRICING.ANNUAL_AMOUNT}
                    </span>
                    <span className="text-xs text-sb-ink-muted">/ year</span>
                  </div>
                  <span className="text-[11px] font-mono font-bold text-brand-700 bg-brand-500/15 px-2 py-0.5 rounded-md border border-brand-500/25 shrink-0">
                    ≈ ₹{ANNUAL_PER_DAY} / day
                  </span>
                </div>
                <p className="text-[11px] text-sb-ink-muted mt-1">
                  Auto-renews yearly · Save {ANNUAL_SAVING_PCT}%
                </p>
              </div>

              {/* Features */}
              <ul className="space-y-2.5 border-t border-sb-hairline/80 pt-4 mb-6">
                {[
                  'Everything in Monthly for a full 365 days',
                  `Save ${ANNUAL_SAVING_PCT}% over monthly billing (₹${ANNUAL_PER_DAY}/day)`,
                  'Priority bank alert parsing & rapid format updates',
                  'Concierge support & early access to new banks',
                ].map((feat) => (
                  <li key={feat} className="flex items-start gap-2.5 text-xs text-sb-ink font-medium">
                    <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0 mt-0.2" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Action */}
            <div className="pt-2">
              <button
                type="button"
                onClick={() => handleDirectCheckout('annual')}
                disabled={
                  processingPlan === 'annual' ||
                  (!!user && isOnYearly) ||
                  (!!user && hasMandate)
                }
                className={cn(
                  "w-full justify-center py-3 text-xs sm:text-sm font-bold rounded-xl border-0 transition-all flex items-center gap-1.5 shadow-md hover:shadow-lg",
                  user && isOnYearly
                    ? "bg-brand-500/10 text-brand-700 border border-brand-500/20 cursor-default shadow-none"
                    : user && hasMandate
                    ? "opacity-50 cursor-not-allowed bg-surface-2 text-sb-ink-muted shadow-none"
                    : "sb-btn-primary cursor-pointer"
                )}
              >
                {processingPlan === 'annual' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Opening Gateway…</span>
                  </>
                ) : user && isOnYearly ? (
                  'Current Plan'
                ) : user && isOnMonthly && !hasMandate ? (
                  `Upgrade to Annual (Save ${ANNUAL_SAVING_PCT}%)`
                ) : user && hasMandate ? (
                  'Auto-renewing'
                ) : (
                  'Annually Pay Now'
                )}
              </button>
            </div>
          </div>
        </div>

        {/* ── Discrete Promo Coupon Trigger ─────────────────────────── */}
        <div className="text-center pt-1">
          <button
            type="button"
            onClick={() => {
              if (!user) {
                openAuthModal('/pricing', 'login')
                return
              }
              setPromoModalOpen(true)
            }}
            className="inline-flex items-center gap-2 text-xs font-semibold text-sb-ink-muted hover:text-brand-600 transition-colors bg-transparent border-0 cursor-pointer"
          >
            <Ticket className="w-3.5 h-3.5" />
            <span>Have an invitation or coupon code? Click to redeem</span>
          </button>
        </div>

        {/* ── Sovereign Trust & Security Ribbon ─────────────────────── */}
        <div className="rounded-3xl border border-sb-hairline bg-surface-1 p-6 sm:p-8 shadow-xs">
          <div className="grid sm:grid-cols-3 gap-6 text-xs">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sb-ink font-bold text-sm">
                <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0" />
                <span>Cancel Anytime</span>
              </div>
              <p className="text-sb-ink-secondary leading-relaxed">
                One click stops future charges with zero hassle. Your access continues until the paid period ends.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sb-ink font-bold text-sm">
                <RotateCcw className="w-4 h-4 text-brand-600 shrink-0" />
                <span>7-Day Full Refund</span>
              </div>
              <p className="text-sb-ink-secondary leading-relaxed">
                Contact us within 7 days of any charge for an unconditional 100% refund.
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-sb-ink font-bold text-sm">
                <Lock className="w-4 h-4 text-brand-600 shrink-0" />
                <span>Bank-Grade Privacy</span>
              </div>
              <p className="text-sb-ink-secondary leading-relaxed">
                Google OAuth read-only permissions. Intrack never asks for nor stores passwords, PINs, or card numbers.
              </p>
            </div>
          </div>
        </div>

        {/* ── Compact FAQ Accordion ─────────────────────────────────── */}
        <PricingFaqAccordion />

        {/* ── Modals ────────────────────────────────────────────────── */}
        <CancelSubscriptionModal
          isOpen={cancelModalOpen}
          onClose={() => setCancelModalOpen(false)}
          onConfirm={handleConfirmCancel}
          isProcessing={cancelling}
          expiresAt={profile?.subscription_expires_at || null}
          daysLeft={daysLeft}
          planName={activePlanName}
        />

        <RedeemPromoModal
          isOpen={promoModalOpen}
          onClose={() => setPromoModalOpen(false)}
          onSuccess={async () => {
            await refreshProfile()
            navigate('/dashboard')
          }}
        />
      </div>
    </AppLayout>
  )
}
