// ============================================
// PricingPage — Clean Fintech Pricing with Motion Graphics
// 3-Column Plan Cards, Animated Selections, Dual Auth Views
// ============================================

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import AppLayout from '@/layouts/AppLayout'
import { useAuth, useToast } from '@/context'
import { formatDate, cn } from '@/utils'
import { useScrollReveal } from '@/hooks'
import { setPageMeta } from '@/utils/seo'
import { ANNUAL_PER_DAY, ANNUAL_SAVING_PCT, APP_CONFIG, PRICING } from '@/constants'
import { supabase } from '@/services/supabase'
import { cancelSubscription as cancelLegacySubscription } from '@/services'
import { createSubscription, cancelSubscription as cancelRazorpaySubscription } from '@/services/subscriptionBilling'
import {
  PricingAmbientBackground,
  PricingFaqAccordion,
  PricingTrustPills,
  CancelSubscriptionModal,
  RedeemPromoModal,
} from './pricing'
import {
  Ticket,
  Loader2,
  Sparkles,
  Check,
} from 'lucide-react'

type PlanType = 'trial' | 'monthly' | 'annual'

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

// ── Motion presets ───────────────────────────────────────────────
const EASE = [0.16, 1, 0.3, 1] as const

const cardVariants = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
}

export default function PricingPage() {
  const navigate = useNavigate()
  const { user, profile, daysLeft, openAuthModal, refreshProfile } = useAuth()
  const { showToast } = useToast()
  const reduce = useReducedMotion()

  // Scroll-reveal for CSS-animated sections (trust pills, FAQ)
  useScrollReveal()

  // ── Profile subscription status ────────────────────────────────
  const status = profile?.subscription_status
  const isExpired = status === 'expired' || (status === 'active' && daysLeft <= 0) || (status === 'trial' && daysLeft <= 0)
  const isCancelled = status === 'cancelled'
  const hasQueuedPlan = !!profile?.pending_plan_type
  const isActive = status === 'active' && daysLeft > 0
  const isTrial = status === 'trial' && daysLeft > 0

  const isOnYearly = (isActive || (isCancelled && daysLeft > 0)) && profile?.subscription_plan_type !== 'monthly' && profile?.subscription_plan_type !== 'trial'
  const isOnMonthly = (isActive || (isCancelled && daysLeft > 0)) && profile?.subscription_plan_type === 'monthly'
  const hasMandate = !!profile?.razorpay_subscription_id

  const currentPlanKey: PlanType = isOnYearly ? 'annual' : isOnMonthly ? 'monthly' : 'trial'
  const trialLocked = !!user && (isActive || isCancelled || profile?.trial_started_at !== undefined)

  // ── Plan selection ─────────────────────────────────────────────
  const [userSelectedPlan, setUserSelectedPlan] = useState<PlanType | null>(null)
  const defaultPlan: PlanType = user ? currentPlanKey : 'annual'
  const selectedPlan: PlanType = userSelectedPlan ?? defaultPlan
  const setSelectedPlan = (p: PlanType) => setUserSelectedPlan(p)

  // ── Modals & Async state ───────────────────────────────────────
  const [processingPlan, setProcessingPlan] = useState<'monthly' | 'annual' | null>(null)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [promoModalOpen, setPromoModalOpen] = useState(false)

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
      const planTitle = plan === 'annual' ? 'Annual Plan' : 'Monthly Plan'

      const options = {
        key: clientKey,
        subscription_id: subscriptionId,
        name: APP_CONFIG.APP_NAME,
        description: `${planTitle}`,
        prefill: { name: profile?.full_name || '', email: user.email || '' },
        theme: { color: '#0e7a5d' },
        handler: async () => {
          await refreshProfile()
          showToast(
            startsAt
              ? `Mandate authorised. Your ${planTitle} starts on ${formatDate(new Date(startsAt * 1000).toISOString())} — you retain existing days, and the verification charge is refunded automatically.`
              : `Payment received. Your ${planTitle} is active.`,
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
      const expiryStr = profile?.subscription_expires_at
        ? formatDate(profile.subscription_expires_at)
        : 'the end of your prepaid period'

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

  // ── Plan Labels ────────────────────────────────────────────────
  const activePlanName = isOnYearly
    ? 'Annual Plan'
    : isOnMonthly
    ? 'Monthly Plan'
    : isTrial
    ? '7-Day Free Trial'
    : isCancelled
    ? 'Cancelled Subscription'
    : isExpired
    ? 'Subscription Expired'
    : 'Subscription Expired'

  const isCurrentPlanSelected = user && (
    (selectedPlan === 'annual' && isOnYearly) ||
    (selectedPlan === 'monthly' && isOnMonthly) ||
    (selectedPlan === 'trial' && isTrial)
  )

  const planTitles: Record<PlanType, string> = {
    trial: '7-Day Trial',
    monthly: 'Monthly Plan',
    annual: 'Annual Plan',
  }

  // ══════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════

  return (
    <AppLayout>
      <div className="relative min-h-screen bg-surface-0 text-sb-ink pb-20 pt-6 sm:pt-10 px-4 sm:px-6 lg:px-8">
        <PricingAmbientBackground />

        <div className="relative mx-auto max-w-5xl space-y-10 sm:space-y-14">

          {/* ══════════════════════════════════════════════════════
              HERO — Unified for both public and authenticated
              ══════════════════════════════════════════════════════ */}
          <motion.div
            initial={reduce ? undefined : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE }}
            className="text-center space-y-3 max-w-2xl mx-auto pt-4"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 text-brand-600 border border-brand-500/20 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
              <span>Simple, transparent pricing</span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight font-display text-sb-ink">
              Pricing
            </h1>
            <p className="text-sm sm:text-base text-sb-ink-secondary leading-relaxed max-w-lg mx-auto">
              {!user
                ? 'Start with a free 7-day trial. Every feature included on every plan. Cancel anytime.'
                : 'Manage your subscription. Every feature included on every plan.'}
            </p>
          </motion.div>

          {/* ══════════════════════════════════════════════════════
              MEMBER STATUS BANNER — Compact, logged-in only
              ══════════════════════════════════════════════════════ */}
          {user && (
            <motion.div
              initial={reduce ? undefined : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.4, ease: EASE, delay: 0.1 }}
              className="rounded-2xl border border-sb-hairline bg-surface-1 px-5 py-4 shadow-xs"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className={cn(
                    'inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full border font-mono shrink-0',
                    isActive ? 'bg-brand-500/10 text-brand-600 border-brand-500/20' :
                    isTrial ? 'bg-amber-500/10 text-amber-700 border-amber-500/20' :
                    isCancelled ? 'bg-rose-500/10 text-rose-600 border-rose-500/20' :
                    'bg-surface-2 text-sb-ink-muted border-sb-hairline'
                  )}>
                    <span className={cn(
                      'w-1.5 h-1.5 rounded-full',
                      isActive ? 'bg-brand-500 animate-pulse' :
                      isTrial ? 'bg-amber-500 animate-pulse' :
                      isCancelled ? 'bg-rose-500' :
                      'bg-sb-ink-muted'
                    )} />
                    {isTrial ? 'Trial' : isActive ? 'Active' : isCancelled ? 'Cancelled' : 'Expired'}
                  </span>
                  <div className="min-w-0">
                    <span className="text-sm font-bold text-sb-ink">{activePlanName}</span>
                    {daysLeft > 0 && (
                      <span className="text-xs text-sb-ink-secondary ml-1.5">· {daysLeft}d left</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setPromoModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sb-hairline text-xs font-semibold text-sb-ink hover:bg-surface-2 transition-colors cursor-pointer bg-surface-1"
                  >
                    <Ticket className="w-3 h-3 text-brand-600" />
                    Redeem code
                  </button>
                  {(hasMandate || isActive) && (
                    <button
                      type="button"
                      onClick={() => setCancelModalOpen(true)}
                      className="text-xs font-semibold text-rose-600/80 hover:text-rose-700 bg-transparent border-0 cursor-pointer transition-colors px-2 py-1.5 rounded-lg hover:bg-rose-500/10"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}

          {/* ══════════════════════════════════════════════════════
              PLAN CARDS — 3-Column Grid with Motion
              ══════════════════════════════════════════════════════ */}
          <section id="billing" className="space-y-6">
            <motion.div
              initial="initial"
              animate="animate"
              variants={reduce ? undefined : {
                initial: {},
                animate: { transition: { staggerChildren: 0.1 } },
              }}
              className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-5"
            >
              {/* ── Trial Card ──────────────────────────────────── */}
              <motion.button
                variants={reduce ? undefined : cardVariants}
                whileHover={reduce || trialLocked ? undefined : { y: -4, transition: { duration: 0.2 } }}
                whileTap={reduce || trialLocked ? undefined : { scale: 0.98 }}
                type="button"
                onClick={() => { if (!trialLocked) setSelectedPlan('trial') }}
                disabled={trialLocked}
                className={cn(
                  'relative flex flex-col items-start text-left p-6 rounded-2xl border transition-colors font-sans',
                  trialLocked
                    ? 'opacity-50 cursor-not-allowed border-sb-hairline bg-surface-1'
                    : selectedPlan === 'trial'
                    ? 'border-brand-500 bg-brand-500/5 shadow-sm cursor-pointer'
                    : 'border-sb-hairline bg-surface-1 shadow-xs hover:border-brand-500/40 cursor-pointer',
                )}
              >
                {selectedPlan === 'trial' && !trialLocked && (
                  <motion.div
                    layoutId="plan-ring"
                    className="absolute inset-0 rounded-2xl ring-2 ring-brand-500/30 pointer-events-none"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className={cn(
                  'inline-flex text-[10px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded border mb-4',
                  trialLocked
                    ? 'text-sb-ink-muted bg-surface-2 border-sb-hairline'
                    : user && isTrial
                    ? 'text-amber-700 bg-amber-500/10 border-amber-500/20'
                    : 'text-brand-600 bg-brand-500/10 border-brand-500/20'
                )}>
                  {trialLocked ? 'Trial used' : user && isTrial ? 'Current plan' : 'Free'}
                </span>
                <h3 className="text-lg font-extrabold text-sb-ink mb-1 tracking-tight">7-Day Trial</h3>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-3xl font-extrabold font-mono tnum text-sb-ink">₹0</span>
                  <span className="text-xs font-medium text-sb-ink-muted">/ 7 days</span>
                </div>
                <p className="text-xs text-sb-ink-secondary leading-relaxed mt-auto">
                  No credit card required. Full product access, zero commitment.
                </p>
              </motion.button>

              {/* ── Monthly Card ─────────────────────────────────── */}
              <motion.button
                variants={reduce ? undefined : cardVariants}
                whileHover={reduce ? undefined : { y: -4, transition: { duration: 0.2 } }}
                whileTap={reduce ? undefined : { scale: 0.98 }}
                type="button"
                onClick={() => setSelectedPlan('monthly')}
                className={cn(
                  'relative flex flex-col items-start text-left p-6 rounded-2xl border transition-colors cursor-pointer font-sans',
                  selectedPlan === 'monthly'
                    ? 'border-brand-500 bg-brand-500/5 shadow-sm'
                    : 'border-sb-hairline bg-surface-1 shadow-xs hover:border-brand-500/40',
                )}
              >
                {selectedPlan === 'monthly' && (
                  <motion.div
                    layoutId="plan-ring"
                    className="absolute inset-0 rounded-2xl ring-2 ring-brand-500/30 pointer-events-none"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className={cn(
                  'inline-flex text-[10px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded border mb-4',
                  user && isOnMonthly
                    ? 'text-brand-600 bg-brand-500/10 border-brand-500/20'
                    : 'text-sb-ink-muted bg-surface-2 border-sb-hairline'
                )}>
                  {user && isOnMonthly ? 'Current plan' : 'Flexible'}
                </span>
                <h3 className="text-lg font-extrabold text-sb-ink mb-1 tracking-tight">Monthly Plan</h3>
                <div className="flex items-baseline gap-1 mb-3">
                  <span className="text-3xl font-extrabold font-mono tnum text-sb-ink">₹{PRICING.MONTHLY_AMOUNT}</span>
                  <span className="text-xs font-medium text-sb-ink-muted">/ month</span>
                </div>
                <p className="text-xs text-sb-ink-secondary leading-relaxed mt-auto">
                  Auto-renews via UPI Autopay or card mandate. Cancel anytime in one click.
                </p>
              </motion.button>

              {/* ── Annual Card — Elevated with Best Value ────────── */}
              <motion.button
                variants={reduce ? undefined : cardVariants}
                whileHover={reduce ? undefined : { y: -6, transition: { duration: 0.2 } }}
                whileTap={reduce ? undefined : { scale: 0.98 }}
                type="button"
                onClick={() => setSelectedPlan('annual')}
                className={cn(
                  'relative flex flex-col items-start text-left p-6 pt-8 rounded-2xl border transition-colors cursor-pointer font-sans',
                  selectedPlan === 'annual'
                    ? 'border-brand-500 bg-brand-500/5 shadow-md'
                    : 'border-brand-500/30 bg-surface-1 shadow-sm hover:border-brand-500/50',
                )}
              >
                {/* Best Value floating ribbon */}
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-brand-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm whitespace-nowrap">
                    <Sparkles className="w-3 h-3" />
                    Best Value
                  </span>
                </div>
                {selectedPlan === 'annual' && (
                  <motion.div
                    layoutId="plan-ring"
                    className="absolute inset-0 rounded-2xl ring-2 ring-brand-500/30 pointer-events-none"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className={cn(
                  'inline-flex text-[10px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded border mb-4',
                  user && isOnYearly
                    ? 'text-brand-600 bg-brand-500/10 border-brand-500/20'
                    : 'text-brand-600 bg-brand-500/10 border-brand-500/20'
                )}>
                  {user && isOnYearly ? 'Current plan' : `Save ${ANNUAL_SAVING_PCT}%`}
                </span>
                <h3 className="text-lg font-extrabold text-sb-ink mb-1 tracking-tight">Annual Plan</h3>
                <div className="flex items-baseline gap-1 mb-1">
                  <span className="text-3xl font-extrabold font-mono tnum text-sb-ink">₹{PRICING.ANNUAL_AMOUNT}</span>
                  <span className="text-xs font-medium text-sb-ink-muted">/ year</span>
                </div>
                <span className="text-[11px] font-mono text-brand-600 font-semibold mb-3">
                  ≈ ₹{ANNUAL_PER_DAY} / day
                </span>
                <p className="text-xs text-sb-ink-secondary leading-relaxed mt-auto">
                  Maximum savings. Uninterrupted autonomous tracking all year.
                </p>
              </motion.button>
            </motion.div>

            {/* ── Selected Plan Summary + CTA ─────────────────── */}
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedPlan}
                initial={reduce ? undefined : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -8 }}
                transition={reduce ? { duration: 0 } : { duration: 0.22, ease: EASE }}
                className="rounded-2xl border border-brand-500/25 bg-brand-500/5 p-6 sm:p-7 shadow-xs"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                  <div className="space-y-1 max-w-xl">
                    <div className="inline-flex items-center gap-2">
                      <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-700 bg-brand-500/15 px-2 py-0.5 rounded border border-brand-500/25 font-mono">
                        {isCurrentPlanSelected ? 'Current Plan' : 'Selected Plan'}
                      </span>
                    </div>
                    <h3 className="text-lg sm:text-xl font-extrabold text-sb-ink font-display m-0">
                      {planTitles[selectedPlan]} {selectedPlan === 'annual' && `(Save ${ANNUAL_SAVING_PCT}%)`}
                    </h3>
                    <p className="text-xs sm:text-sm text-sb-ink-secondary leading-relaxed m-0">
                      {selectedPlan === 'trial'
                        ? '7 days complimentary access with full email scanning and auto-categorization. No credit card required.'
                        : selectedPlan === 'monthly'
                        ? `₹${PRICING.MONTHLY_AMOUNT} billed monthly. Flexible cadence, pause or cancel anytime in one click.`
                        : `₹${PRICING.ANNUAL_AMOUNT} billed once a year (≈ ₹${ANNUAL_PER_DAY} / day). Maximum savings, uninterrupted autonomous tracking.`}
                    </p>
                  </div>

                  <div className="shrink-0 flex flex-col items-stretch sm:items-end gap-2">
                    {!user ? (
                      /* Public CTA */
                      <button
                        type="button"
                        onClick={() => openAuthModal('/pricing', 'signup')}
                        className="sb-btn-primary py-3 px-6 text-sm font-bold shadow-md hover:shadow-lg transition-all"
                      >
                        {selectedPlan === 'trial'
                          ? 'Start 7-Day Free Trial'
                          : `Subscribe to ${planTitles[selectedPlan]}`}
                      </button>
                    ) : isCurrentPlanSelected ? (
                      /* Current Plan Badge */
                      <button
                        type="button"
                        disabled
                        className="py-3 px-6 text-xs font-bold rounded-xl bg-surface-2 text-sb-ink-muted border border-sb-hairline cursor-default inline-flex items-center gap-1.5"
                      >
                        <Check className="w-4 h-4" />
                        Current Plan Active
                      </button>
                    ) : selectedPlan === 'trial' ? (
                      /* Trial Disabled for Logged In */
                      <button
                        type="button"
                        disabled
                        className="py-3 px-6 text-xs font-bold rounded-xl bg-surface-2 text-sb-ink-muted border border-sb-hairline cursor-default"
                      >
                        Trial Already Used
                      </button>
                    ) : (
                      /* Direct Razorpay Checkout */
                      <button
                        type="button"
                        onClick={() => handleDirectCheckout(selectedPlan)}
                        disabled={processingPlan === selectedPlan || hasMandate}
                        className={cn(
                          'sb-btn-primary py-3 px-6 text-sm font-bold shadow-md hover:shadow-lg transition-all',
                          hasMandate && 'opacity-50 cursor-not-allowed',
                        )}
                      >
                        {processingPlan === selectedPlan ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            <span>Opening Gateway…</span>
                          </>
                        ) : hasMandate ? (
                          'Auto-renewing Mandate'
                        ) : (
                          `Pay Now ₹${selectedPlan === 'annual' ? PRICING.ANNUAL_AMOUNT : PRICING.MONTHLY_AMOUNT}`
                        )}
                      </button>
                    )}

                    <span className="text-[11px] text-sb-ink-muted text-center sm:text-right">
                      {selectedPlan === 'trial'
                        ? 'No credit card or payment method required'
                        : 'Auto-renews via UPI Autopay / card mandate · Cancel anytime'}
                    </span>
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>
          </section>

          {/* ── Promo Coupon Link (public only — logged-in has it in the status banner) ── */}
          {!user && (
            <div className="text-center">
              <button
                type="button"
                onClick={() => openAuthModal('/pricing', 'login')}
                className="inline-flex items-center gap-2 text-xs font-semibold text-sb-ink-muted hover:text-brand-600 transition-colors bg-transparent border-0 cursor-pointer"
              >
                <Ticket className="w-3.5 h-3.5" />
                <span>Have an invitation or coupon code? Sign in to redeem</span>
              </button>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════
              TRUST PILLS — Compact Row
              ══════════════════════════════════════════════════════ */}
          <PricingTrustPills />

          {/* ══════════════════════════════════════════════════════
              FAQ ACCORDION
              ══════════════════════════════════════════════════════ */}
          <PricingFaqAccordion />

          {/* ══════════════════════════════════════════════════════
              MODALS
              ══════════════════════════════════════════════════════ */}
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
      </div>
    </AppLayout>
  )
}
