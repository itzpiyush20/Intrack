// ============================================
// PricingPage — Modern Luxury Fintech Edition
// 3-Column Plan Cards, Animated Selections, Dual Auth Views
// ============================================

import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import AppLayout from '@/layouts/AppLayout'
import { usePageHeroHandoff } from '@/layouts/PageHeaderContext'
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
  PricingFeatureGrid,
  CancelSubscriptionModal,
  RedeemPromoModal,
} from './pricing'
import {
  Ticket,
  Loader2,
  Sparkles,
  Check,
  Clock,
  Calendar,
  AlertTriangle,
  Zap,
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

  // Scroll-reveal for CSS-animated sections
  useScrollReveal()

  // Signed in, /pricing is an app route with the sticky top bar, so the
  // centred hero below hands the title over on scroll like every other page.
  const pricingTitleRef = useRef<HTMLHeadingElement>(null)
  usePageHeroHandoff(pricingTitleRef, 'Pricing')

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

  // ── Telemetry & Metrics for Logged-In Members ───────────────────
  const totalCycleDays = isOnYearly ? 365 : isOnMonthly ? 30 : 7
  const daysUsed = Math.max(0, totalCycleDays - daysLeft)
  const cycleProgressPct = Math.min(100, Math.max(0, Math.round((daysUsed / totalCycleDays) * 100)))

  const scansToday = profile?.scans_today ?? 0
  const scansRemaining = Math.max(0, 2 - scansToday)

  const renewalDateStr = profile?.subscription_expires_at
    ? formatDate(profile.subscription_expires_at)
    : isTrial
    ? `Trial ends in ${daysLeft} days`
    : 'No renewal scheduled'

  const renewalAmountStr = isTrial
    ? 'No charge — choose a plan to continue'
    : isOnYearly
    ? `₹${PRICING.ANNUAL_AMOUNT} on autopay`
    : isOnMonthly
    ? `₹${PRICING.MONTHLY_AMOUNT} on autopay`
    : 'Expired'

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

        <div className="relative mx-auto max-w-5xl space-y-12 sm:space-y-16">

          {/* ══════════════════════════════════════════════════════
              HERO — Named "Pricing", elegant & luxury fintech tone
              ══════════════════════════════════════════════════════ */}
          <motion.div
            initial={reduce ? undefined : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={reduce ? { duration: 0 } : { duration: 0.5, ease: EASE }}
            className="text-center space-y-3 max-w-2xl mx-auto pt-4"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 text-brand-600 border border-brand-500/20 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
              <span>Intrack Expense Intelligence · Built for India</span>
            </div>
            <h1
              ref={pricingTitleRef}
              className="text-3xl sm:text-5xl font-extrabold tracking-tight font-display text-sb-ink"
            >
              Pricing
            </h1>
            <p className="text-sm sm:text-base text-sb-ink-secondary leading-relaxed max-w-lg mx-auto">
              {!user
                ? 'Autonomous bank alert scans, intelligent categorization, and subscription radar. Start free, cancel anytime.'
                : 'Review your active subscription, daily scan telemetry, or change your billing plan.'}
            </p>
          </motion.div>

          {/* ══════════════════════════════════════════════════════
              LOGGED-IN MEMBER COMMAND CENTER:
              - Days left for the subscription to end
              - Scans left today
              - Cancel subscription button (prominently accessible)
              - Redeem promo button
              ══════════════════════════════════════════════════════ */}
          {user && (
            <motion.div
              initial={reduce ? undefined : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={reduce ? { duration: 0 } : { duration: 0.45, ease: EASE, delay: 0.1 }}
              className="rounded-3xl border border-sb-hairline bg-surface-1 p-6 sm:p-8 shadow-xs relative overflow-hidden"
            >
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-brand-500/5 blur-3xl"
              />

              <div className="relative z-10 space-y-6">
                {/* Header: Status + Plan Name + Quick Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-sb-hairline">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={cn(
                        'inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-md border font-mono',
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
                        {isTrial ? 'Trial Active' : isActive ? 'Active Membership' : isCancelled ? 'Cancelled · Access Active' : 'Subscription Expired'}
                      </span>
                      {hasMandate && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-surface-2 text-sb-ink-secondary border border-sb-hairline font-mono">
                          Autopay Active
                        </span>
                      )}
                    </div>
                    <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight font-display text-sb-ink">
                      {activePlanName}
                    </h2>
                    <p className="text-xs text-sb-ink-secondary mt-0.5">
                      {isTrial
                        ? `Complimentary unrestricted trial · ${daysLeft} days remaining.`
                        : isActive
                        ? `Active on autopay · Renews on ${renewalDateStr}.`
                        : isCancelled && daysLeft > 0
                        ? `Cancelled · Full access continues until ${renewalDateStr}.`
                        : 'No active subscription. Pick a plan below to resume scans.'}
                    </p>
                  </div>

                  {/* Actions: Redeem code + Prominent Cancel Button */}
                  <div className="flex items-center gap-2.5 shrink-0 self-start sm:self-center">
                    <button
                      type="button"
                      onClick={() => setPromoModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-sb-hairline text-xs font-semibold text-sb-ink hover:bg-surface-2 transition-colors cursor-pointer bg-surface-1"
                    >
                      <Ticket className="w-3.5 h-3.5 text-brand-600" />
                      <span>Redeem code</span>
                    </button>

                    {(hasMandate || isActive || isTrial) && (
                      <button
                        type="button"
                        onClick={() => setCancelModalOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-rose-500/25 bg-rose-500/10 text-rose-600 hover:bg-rose-500/15 hover:text-rose-700 transition-colors text-xs font-semibold cursor-pointer"
                      >
                        <span>Cancel subscription</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Operational Telemetry Grid: Days Left + Scans Remaining + Renewal Info */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 pt-1">
                  {/* Metric 1: Days Left */}
                  <div className="p-4 rounded-2xl bg-surface-2/40 border border-sb-hairline space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-sb-ink-muted">
                      <span>Days Remaining</span>
                      <Clock className="w-3.5 h-3.5 text-brand-600" />
                    </div>
                    <div className="text-xl sm:text-2xl font-extrabold font-mono text-sb-ink">
                      {daysLeft > 0 ? `${daysLeft} Days` : '0 Days'}
                    </div>
                    {/* Cycle Progress bar */}
                    <div className="space-y-1 pt-1">
                      <div className="h-1.5 bg-surface-1 rounded-full overflow-hidden border border-sb-hairline/80">
                        <div
                          className="h-full bg-brand-500 rounded-full transition-all duration-500"
                          style={{ width: `${cycleProgressPct}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-sb-ink-muted">
                        {daysLeft > 0
                          ? `${daysUsed} of ${totalCycleDays} days used in this cycle`
                          : 'Prepaid period elapsed'}
                      </div>
                    </div>
                  </div>

                  {/* Metric 2: Scans Left Today */}
                  <div className="p-4 rounded-2xl bg-surface-2/40 border border-sb-hairline space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-sb-ink-muted">
                      <span>Daily Scan Allowance</span>
                      <Zap className="w-3.5 h-3.5 text-brand-600" />
                    </div>
                    <div className="text-xl sm:text-2xl font-extrabold font-mono text-sb-ink">
                      {scansRemaining} of 2 Remaining
                    </div>
                    {/* Quota Indicators */}
                    <div className="flex items-center gap-2 pt-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={cn(
                            'h-2 w-5 rounded-full transition-colors',
                            scansRemaining >= 2 ? 'bg-brand-500' : 'bg-surface-3'
                          )}
                        />
                        <span
                          className={cn(
                            'h-2 w-5 rounded-full transition-colors',
                            scansRemaining >= 1 ? 'bg-brand-500' : 'bg-surface-3'
                          )}
                        />
                      </div>
                      <span className="text-[11px] text-sb-ink-muted">
                        {scansToday === 0
                          ? 'All scans ready'
                          : `${scansToday} scan${scansToday === 1 ? '' : 's'} used today`}
                      </span>
                    </div>
                    <div className="text-[10px] text-sb-ink-secondary">
                      Resets every 24h · 4-hour safety cooldown
                    </div>
                  </div>

                  {/* Metric 3: Renewal & Payment Details */}
                  <div className="p-4 rounded-2xl bg-surface-2/40 border border-sb-hairline space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-sb-ink-muted">
                      <span>Billing &amp; Renewal</span>
                      <Calendar className="w-3.5 h-3.5 text-brand-600" />
                    </div>
                    <div className="text-base sm:text-lg font-extrabold font-mono text-sb-ink truncate">
                      {renewalDateStr}
                    </div>
                    <div className="text-xs text-sb-ink-secondary">
                      {renewalAmountStr}
                    </div>
                    <div className="text-[11px] text-sb-ink-muted pt-0.5">
                      {hasMandate ? 'Automatic UPI / card debit' : 'Zero lock-in · Cancel anytime'}
                    </div>
                  </div>
                </div>

                {/* Cancelled Banner Warning (if cancelled with remaining active days) */}
                {isCancelled && daysLeft > 0 && (
                  <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-4 flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div className="space-y-0.5 text-xs">
                      <p className="font-bold text-sb-ink">
                        Subscription cancelled · Full access active until {renewalDateStr}
                      </p>
                      <p className="text-sb-ink-secondary leading-relaxed">
                        You will not be charged again. Your automated inbox scans, categorization, and alerts remain fully active until your paid period ends.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ══════════════════════════════════════════════════════
              BENEFITS / FEATURES SHOWCASE
              For visitors before logging in, presented BEFORE the pricing cards!
              ══════════════════════════════════════════════════════ */}
          {!user && (
            <PricingFeatureGrid
              title="Everything you need for effortless finances"
              subtitle="Bank-grade intelligence built specifically for the Indian financial ecosystem. Included on every plan."
            />
          )}

          {/* ══════════════════════════════════════════════════════
              PLAN CARDS — 3-Column Grid with Pricing Details & Motion
              ══════════════════════════════════════════════════════ */}
          <section id="billing" className="space-y-6">
            <div className="text-center max-w-xl mx-auto">
              <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-600 mb-1">
                <Check className="w-3.5 h-3.5 text-brand-500" />
                <span>Transparent Pricing</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display text-sb-ink">
                {user ? 'Change or extend your plan' : 'Choose how you pay'}
              </h2>
              <p className="text-xs sm:text-sm text-sb-ink-secondary mt-1">
                Billing cadence only — all platform features are 100% unlocked across all options.
              </p>
            </div>

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
                  'inline-flex text-[10px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded border mb-4 font-mono',
                  trialLocked
                    ? 'text-sb-ink-muted bg-surface-2 border-sb-hairline'
                    : user && isTrial
                    ? 'text-amber-700 bg-amber-500/10 border-amber-500/20'
                    : 'text-brand-600 bg-brand-500/10 border-brand-500/20'
                )}>
                  {trialLocked ? 'Trial used' : user && isTrial ? 'Current plan' : 'Free Trial'}
                </span>
                <h3 className="text-lg font-extrabold text-sb-ink mb-1 tracking-tight">7-Day Trial</h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-3xl font-extrabold font-mono tnum text-sb-ink">₹0</span>
                  <span className="text-xs font-medium text-sb-ink-muted">/ 7 days</span>
                </div>
                <p className="text-xs text-sb-ink-secondary leading-relaxed mb-4">
                  No credit card required. Full unrestricted product, zero commitment.
                </p>

                {/* Plan Checklist Details */}
                <div className="pt-3 border-t border-sb-hairline/60 space-y-2 w-full mt-auto">
                  <div className="flex items-center gap-2 text-xs text-sb-ink">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>7 days unrestricted access</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sb-ink">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>2 automated scans / day</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sb-ink">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>Zero card or bank info required</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sb-ink-muted">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>Automatic pause on day 7</span>
                  </div>
                </div>
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
                  'inline-flex text-[10px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded border mb-4 font-mono',
                  user && isOnMonthly
                    ? 'text-brand-600 bg-brand-500/10 border-brand-500/20'
                    : 'text-sb-ink-muted bg-surface-2 border-sb-hairline'
                )}>
                  {user && isOnMonthly ? 'Current plan' : 'Flexible'}
                </span>
                <h3 className="text-lg font-extrabold text-sb-ink mb-1 tracking-tight">Monthly Plan</h3>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-3xl font-extrabold font-mono tnum text-sb-ink">₹{PRICING.MONTHLY_AMOUNT}</span>
                  <span className="text-xs font-medium text-sb-ink-muted">/ month</span>
                </div>
                <p className="text-xs text-sb-ink-secondary leading-relaxed mb-4">
                  Auto-renews via UPI Autopay or card mandate. Cancel anytime in one click.
                </p>

                {/* Plan Checklist Details */}
                <div className="pt-3 border-t border-sb-hairline/60 space-y-2 w-full mt-auto">
                  <div className="flex items-center gap-2 text-xs text-sb-ink">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>30 days rolling membership</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sb-ink">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>2 automated scans / day</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sb-ink">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>UPI Autopay or card e-mandate</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sb-ink-muted">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>Self-serve 1-click cancellation</span>
                  </div>
                </div>
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
                  <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-brand-500 text-white text-[10px] font-bold uppercase tracking-wider shadow-sm whitespace-nowrap font-mono">
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
                  'inline-flex text-[10px] font-extrabold tracking-wider uppercase px-2 py-0.5 rounded border mb-4 font-mono',
                  user && isOnYearly
                    ? 'text-brand-600 bg-brand-500/10 border-brand-500/20'
                    : 'text-brand-600 bg-brand-500/10 border-brand-500/20'
                )}>
                  {user && isOnYearly ? 'Current plan' : `Save ${ANNUAL_SAVING_PCT}%`}
                </span>
                <h3 className="text-lg font-extrabold text-sb-ink mb-1 tracking-tight">Annual Plan</h3>
                <div className="flex items-baseline gap-1 mb-0.5">
                  <span className="text-3xl font-extrabold font-mono tnum text-sb-ink">₹{PRICING.ANNUAL_AMOUNT}</span>
                  <span className="text-xs font-medium text-sb-ink-muted">/ year</span>
                </div>
                <span className="text-[11px] font-mono text-brand-600 font-semibold mb-2">
                  ≈ ₹{ANNUAL_PER_DAY} / day
                </span>
                <p className="text-xs text-sb-ink-secondary leading-relaxed mb-4">
                  Maximum savings. Uninterrupted autonomous tracking all year.
                </p>

                {/* Plan Checklist Details */}
                <div className="pt-3 border-t border-sb-hairline/60 space-y-2 w-full mt-auto">
                  <div className="flex items-center gap-2 text-xs text-sb-ink">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span className="font-semibold text-brand-700">Save {ANNUAL_SAVING_PCT}% vs monthly</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sb-ink">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>365 days continuous peace of mind</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sb-ink">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>2 automated scans / day</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-sb-ink-muted">
                    <Check className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                    <span>UPI Autopay · Cancel anytime</span>
                  </div>
                </div>
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
                        className="sb-btn-primary py-3 px-6 text-sm font-bold shadow-md hover:shadow-lg transition-all cursor-pointer"
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
                        <Check className="w-4 h-4 text-brand-600" />
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
                          'sb-btn-primary py-3 px-6 text-sm font-bold shadow-md hover:shadow-lg transition-all cursor-pointer',
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

          {/* ── Promo Coupon Link (public only — logged-in has button in status banner) ── */}
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
