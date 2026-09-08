// ============================================
// PricingPage — Modern Luxury Fintech Edition
// Features-First Showcase, Intrack Design System & Dynamic Auth Views
// ============================================

import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import AppLayout from '@/layouts/AppLayout'
import { useAuth, useToast } from '@/context'
import { formatDate, cn } from '@/utils'
import { setPageMeta } from '@/utils/seo'
import { ANNUAL_PER_DAY, ANNUAL_SAVING_PCT, APP_CONFIG, PRICING } from '@/constants'
import { supabase } from '@/services/supabase'
import { cancelSubscription as cancelLegacySubscription } from '@/services'
import { createSubscription, cancelSubscription as cancelRazorpaySubscription } from '@/services/subscriptionBilling'
import {
  PricingAmbientBackground,
  PricingFaqAccordion,
  CancelSubscriptionModal,
  RedeemPromoModal,
  CostToValueVisual,
} from './pricing'
import {
  ShieldCheck,
  Ticket,
  RotateCcw,
  Loader2,
  Clock,
  Sparkles,
  Lock,
  Mail,
  Tags,
  Calendar,
  FileSpreadsheet,
  DownloadCloud,
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

export default function PricingPage() {
  const navigate = useNavigate()
  const { user, profile, daysLeft, openAuthModal, refreshProfile } = useAuth()
  const { showToast } = useToast()

  // Profile subscription status
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

  // Plan selection (derived cleanly without cascading render effects)
  const [userSelectedPlan, setUserSelectedPlan] = useState<PlanType | null>(null)
  const defaultPlan: PlanType = user ? currentPlanKey : 'annual'
  const selectedPlan: PlanType = userSelectedPlan ?? defaultPlan
  const setSelectedPlan = (p: PlanType) => setUserSelectedPlan(p)

  // Modals & Async state
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

  // ── Plan Labels & Computations ─────────────────────────────────
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

  const renewalDateStr = profile?.subscription_expires_at
    ? formatDate(profile.subscription_expires_at)
    : isTrial
    ? `Trial ends in ${daysLeft} days`
    : 'No renewal scheduled'

  const renewalAmountStr = isTrial
    ? 'No charge — pick a plan to continue'
    : isOnYearly
    ? `₹${PRICING.ANNUAL_AMOUNT} on autopay`
    : isOnMonthly
    ? `₹${PRICING.MONTHLY_AMOUNT} on autopay`
    : 'Expired'

  const totalCycleDays = isOnYearly ? 365 : isOnMonthly ? 30 : 7
  const daysUsed = Math.max(0, totalCycleDays - daysLeft)
  const cycleProgressPct = Math.min(100, Math.max(0, Math.round((daysUsed / totalCycleDays) * 100)))

  // Scans telemetry
  const scansToday = profile?.scans_today ?? 0
  const scansRemaining = Math.max(0, 2 - scansToday)

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

  // Core product capabilities
  const productFeatures = [
    {
      icon: Mail,
      title: 'Autonomous Bank Alert Sync',
      desc: 'Seamlessly reads transaction emails from 50+ Indian banks & UPI apps (HDFC, ICICI, SBI, Axis, Cred, Google Pay, Paytm). Zero manual entry.',
      tag: 'Read-only OAuth',
    },
    {
      icon: Tags,
      title: 'Intelligent Auto-Categorization',
      desc: 'Sorts every expense into dining, groceries, utilities, and travel. Automatically cleans messy merchant strings and remembers your corrections.',
      tag: 'Learning Engine',
    },
    {
      icon: Calendar,
      title: 'Subscription & Renewal Radar',
      desc: 'Detects upcoming recurring charges, subscriptions, and EMIs well in advance so you avoid unexpected debits and forgotten renewals.',
      tag: 'Proactive Alerts',
    },
    {
      icon: FileSpreadsheet,
      title: 'Client-Side Statement Import',
      desc: 'Import HDFC, ICICI, SBI, and Axis CSV statements directly. Parsing runs 100% locally in your browser — your files never touch external servers.',
      tag: '100% Private',
    },
    {
      icon: DownloadCloud,
      title: 'Instant Data Export & Zero Lock-in',
      desc: 'Download your entire financial ledger anytime as CSV or JSON. Cancel anytime in one click without retention calls or roadblocks.',
      tag: 'Full Ownership',
    },
    {
      icon: ShieldCheck,
      title: 'Bank-Grade Privacy Architecture',
      desc: 'Restricted read-only Google OAuth scope. We never request or store bank account passwords, debit/credit cards, PINs, or OTPs.',
      tag: 'Safe & Secure',
    },
  ]

  return (
    <AppLayout>
      <div className="relative min-h-screen bg-surface-0 text-sb-ink pb-20 pt-6 sm:pt-10 px-4 sm:px-6 lg:px-8">
        <PricingAmbientBackground />

        <div className="relative mx-auto max-w-5xl space-y-12 sm:space-y-16">

          {/* ══════════════════════════════════════════════════════════════
              HEADER AREA
              Public Hero (Before Login) vs Member Command Center (After Login)
              ══════════════════════════════════════════════════════════════ */}
          {!user ? (
            /* ── Public Visitor Hero ──────────────────────────────── */
            <div className="text-center space-y-4 max-w-3xl mx-auto pt-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-500/10 text-brand-600 border border-brand-500/20 text-xs font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                <span>Intrack Expense Intelligence · Built for India</span>
              </div>
              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight font-display text-sb-ink">
                Plans that pay for themselves.
              </h1>
              <p className="text-sm sm:text-base text-sb-ink-secondary leading-relaxed">
                Connect Gmail once. Autonomous bank alert scans, smart category learning, subscription radar, and automated financial clarity. Zero lock-in, cancel anytime.
              </p>
            </div>
          ) : (
            /* ── Member Command Center Header ─────────────────────── */
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-600 border border-brand-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
                  Member Command Center
                </span>
                <span className="text-xs font-mono text-sb-ink-muted">
                  {user.email}
                </span>
              </div>
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight font-display text-sb-ink">
                Subscription &amp; Billing
              </h1>
              <p className="text-xs sm:text-sm text-sb-ink-secondary leading-relaxed">
                Review your active membership, billing cycle telemetry, and plan options.
              </p>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              MEMBER STATUS CARD (LOGGED-IN ONLY)
              ══════════════════════════════════════════════════════════════ */}
          {user && (
            <div className="rounded-2xl border border-sb-hairline bg-surface-1 p-6 sm:p-8 shadow-xs relative overflow-hidden">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -top-24 right-0 h-72 w-72 rounded-full bg-brand-500/5 blur-3xl"
              />

              <div className="relative z-10 space-y-6">
                {/* Top Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-sb-hairline">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-0.5 rounded-md bg-brand-500/10 text-brand-600 border border-brand-500/20 font-mono">
                        {isTrial ? 'Trial Active' : isActive ? 'Active Member' : isCancelled ? 'Cancellation Scheduled' : isExpired ? 'Subscription Expired' : 'Plan Inactive'}
                      </span>
                      {hasMandate && (
                        <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded bg-surface-2 text-sb-ink-secondary border border-sb-hairline font-mono">
                          Autopay Mandate Active
                        </span>
                      )}
                    </div>
                    <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display text-sb-ink">
                      {activePlanName}
                    </h2>
                    <p className="text-xs sm:text-sm text-sb-ink-secondary mt-1">
                      {isTrial
                        ? `Complimentary unrestricted trial · ${daysLeft} days remaining.`
                        : isActive
                        ? `Active on autopay. Renews on ${renewalDateStr}.`
                        : isCancelled && daysLeft > 0
                        ? `Cancelled · full access active until ${renewalDateStr}.`
                        : 'No active subscription. Pick a plan below to resume scans.'}
                    </p>
                  </div>

                  <div className="shrink-0 flex items-center gap-3">
                    <a
                      href="#billing"
                      className="sb-btn-primary py-2 px-4 text-xs font-bold shadow-sm"
                    >
                      Change plan
                    </a>
                    <button
                      type="button"
                      onClick={() => setPromoModalOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-sb-hairline text-xs font-bold text-sb-ink hover:bg-surface-2 transition-colors cursor-pointer bg-surface-1"
                    >
                      <Ticket className="w-3.5 h-3.5 text-brand-600" />
                      <span>Redeem promo</span>
                    </button>
                  </div>
                </div>

                {/* 3 Columns: Expiry, Cycle Bar, Payment Method */}
                <div className="grid sm:grid-cols-3 gap-6 pt-1">
                  {/* Col 1 */}
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold tracking-wider uppercase text-sb-ink-muted">
                      Renewal &amp; Expiry
                    </div>
                    <div className="text-base sm:text-lg font-extrabold font-mono text-sb-ink">
                      {renewalDateStr}
                    </div>
                    <div className="text-xs text-sb-ink-secondary">
                      {renewalAmountStr}
                    </div>
                  </div>

                  {/* Col 2 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-bold tracking-wider uppercase text-sb-ink-muted">
                      <span>Billing cycle</span>
                      <span className="font-mono">{daysLeft > 0 ? `${daysLeft}d left` : '0d left'}</span>
                    </div>
                    <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand-500 rounded-full transition-all duration-500"
                        style={{ width: `${cycleProgressPct}%` }}
                      />
                    </div>
                    <div className="text-xs text-sb-ink-secondary">
                      {daysLeft > 0
                        ? `${daysUsed} of ${totalCycleDays} days used in this cycle`
                        : 'Prepaid period complete'}
                    </div>
                  </div>

                  {/* Col 3 */}
                  <div className="space-y-2">
                    <div className="text-[11px] font-bold tracking-wider uppercase text-sb-ink-muted">
                      Payment method
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-brand-500/10 text-brand-600 text-[10px] font-extrabold font-mono border border-brand-500/20">
                          {hasMandate ? 'AUTOPAY' : 'UPI'}
                        </span>
                        <span className="text-xs font-semibold text-sb-ink">
                          {hasMandate ? 'Razorpay E-Mandate' : isTrial ? 'No card required' : 'Manual UPI'}
                        </span>
                      </div>
                      {(hasMandate || isActive) && (
                        <button
                          type="button"
                          onClick={() => setCancelModalOpen(true)}
                          className="text-xs font-semibold text-[var(--status-danger-text)] hover:underline bg-transparent border-0 cursor-pointer"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-sb-ink-muted">
                      {hasMandate ? 'Automatic recurring billing active' : 'Cancel anytime in one click'}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════
              FEATURE SHOWCASE (PRESENTED FIRST)
              Highlighting Core Product Capabilities with Motion Graphics
              ══════════════════════════════════════════════════════════════ */}
          <section className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-600 mb-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Platform Capabilities</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display text-sb-ink">
                  Everything you need for effortless finances
                </h2>
                <p className="text-xs sm:text-sm text-sb-ink-secondary mt-1 max-w-2xl">
                  Bank-grade intelligence built specifically for the Indian financial ecosystem. Full product access is included on every plan.
                </p>
              </div>

              {user && (
                /* Member quick telemetry pill */
                <div className="flex items-center gap-2 bg-surface-1 border border-sb-hairline px-3.5 py-1.5 rounded-xl shadow-xs self-start sm:self-auto">
                  <Clock className="w-4 h-4 text-brand-600" />
                  <span className="text-xs font-semibold text-sb-ink">
                    {scansRemaining > 0 ? `${scansRemaining} daily scans remaining` : '2/2 scans used today'}
                  </span>
                </div>
              )}
            </div>

            {/* 6 Feature Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {productFeatures.map((feat) => {
                const Icon = feat.icon
                return (
                  <div
                    key={feat.title}
                    className="p-6 rounded-2xl border border-sb-hairline bg-surface-1 shadow-xs hover:shadow-md hover:border-brand-500/30 transition-all flex flex-col justify-between group"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className="w-10 h-10 rounded-xl bg-brand-500/10 text-brand-600 flex items-center justify-center border border-brand-500/20 group-hover:scale-105 transition-transform">
                          <Icon className="w-5 h-5" />
                        </div>
                        <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-600 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20 font-mono">
                          {feat.tag}
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-sb-ink mb-2">
                        {feat.title}
                      </h3>
                      <p className="text-xs text-sb-ink-secondary leading-relaxed">
                        {feat.desc}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Interactive Return-on-Investment & Cost-to-Value Motion Graphic */}
            <CostToValueVisual />
          </section>

          {/* ══════════════════════════════════════════════════════════════
              PAYMENT OPTIONS / PRICING SELECTOR
              Presented after features so the user reads capabilities first
              ══════════════════════════════════════════════════════════════ */}
          <section id="billing" className="space-y-6 pt-6 border-t border-sb-hairline">
            <div className="flex items-baseline justify-between gap-5 flex-wrap">
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand-600 mb-1.5">
                  <Check className="w-3.5 h-3.5" />
                  <span>Transparent Pricing</span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display text-sb-ink">
                  {user ? 'Change how you pay' : 'Choose how you pay'}
                </h2>
                <p className="text-xs sm:text-sm text-sb-ink-secondary mt-1">
                  Billing cadence only — all 6 capabilities above are identical across all options.
                </p>
              </div>
            </div>

            {/* 3 Selectable Cards in Vertical Selector Layout */}
            <div className="flex flex-col gap-3">
              {/* Plan 1: 7-Day Trial */}
              <button
                type="button"
                onClick={() => {
                  if (!trialLocked) setSelectedPlan('trial')
                }}
                disabled={trialLocked}
                className={cn(
                  'flex items-center gap-4 sm:gap-8 flex-wrap w-full text-left font-sans p-5 sm:p-6 rounded-2xl transition-all border',
                  trialLocked
                    ? 'opacity-50 cursor-not-allowed border-sb-hairline bg-surface-1'
                    : selectedPlan === 'trial'
                    ? 'border-brand-500 bg-brand-500/5 shadow-sm ring-1 ring-brand-500/20 cursor-pointer'
                    : 'border-sb-hairline bg-surface-1 shadow-xs hover:border-brand-500/40 cursor-pointer',
                )}
              >
                <div className="flex items-center gap-3.5 min-w-[200px] shrink-0">
                  <span
                    className={cn(
                      'w-4.5 h-4.5 rounded-full shrink-0 border box-border bg-surface-1 transition-all',
                      selectedPlan === 'trial'
                        ? 'border-[5px] border-brand-500'
                        : 'border-2 border-border-default',
                    )}
                  />
                  <div>
                    <span className="block text-lg sm:text-xl font-extrabold tracking-tight font-display text-sb-ink">
                      7-Day Trial
                    </span>
                    <span className="inline-block text-[10px] font-extrabold tracking-wider uppercase text-brand-600 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20 mt-1">
                      {trialLocked ? 'Trial used' : 'Complimentary'}
                    </span>
                  </div>
                </div>
                <div className="min-w-[140px] shrink-0">
                  <span className="text-xl sm:text-2xl font-extrabold tracking-tight font-mono tnum text-sb-ink">
                    ₹0
                  </span>
                  <span className="text-xs font-semibold text-sb-ink-muted"> / 7 days</span>
                </div>
                <div className="flex-1 min-w-[200px] text-xs sm:text-sm text-sb-ink-secondary leading-relaxed">
                  No credit card required. Full unrestricted product, zero commitment.
                </div>
              </button>

              {/* Plan 2: Monthly */}
              <button
                type="button"
                onClick={() => setSelectedPlan('monthly')}
                className={cn(
                  'flex items-center gap-4 sm:gap-8 flex-wrap w-full text-left font-sans p-5 sm:p-6 rounded-2xl transition-all cursor-pointer border',
                  selectedPlan === 'monthly'
                    ? 'border-brand-500 bg-brand-500/5 shadow-sm ring-1 ring-brand-500/20'
                    : 'border-sb-hairline bg-surface-1 shadow-xs hover:border-brand-500/40',
                )}
              >
                <div className="flex items-center gap-3.5 min-w-[200px] shrink-0">
                  <span
                    className={cn(
                      'w-4.5 h-4.5 rounded-full shrink-0 border box-border bg-surface-1 transition-all',
                      selectedPlan === 'monthly'
                        ? 'border-[5px] border-brand-500'
                        : 'border-2 border-border-default',
                    )}
                  />
                  <div>
                    <span className="block text-lg sm:text-xl font-extrabold tracking-tight font-display text-sb-ink">
                      Monthly Plan
                    </span>
                    <span className="inline-block text-[10px] font-extrabold tracking-wider uppercase text-brand-600 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20 mt-1">
                      {user && isOnMonthly ? 'Current plan' : 'Flexible'}
                    </span>
                  </div>
                </div>
                <div className="min-w-[140px] shrink-0">
                  <span className="text-xl sm:text-2xl font-extrabold tracking-tight font-mono tnum text-sb-ink">
                    ₹{PRICING.MONTHLY_AMOUNT}
                  </span>
                  <span className="text-xs font-semibold text-sb-ink-muted"> / month</span>
                </div>
                <div className="flex-1 min-w-[200px] text-xs sm:text-sm text-sb-ink-secondary leading-relaxed">
                  Auto-renews monthly via UPI Autopay or card mandate. Cancel anytime in one click.
                </div>
              </button>

              {/* Plan 3: Annual */}
              <button
                type="button"
                onClick={() => setSelectedPlan('annual')}
                className={cn(
                  'flex items-center gap-4 sm:gap-8 flex-wrap w-full text-left font-sans p-5 sm:p-6 rounded-2xl transition-all cursor-pointer border',
                  selectedPlan === 'annual'
                    ? 'border-brand-500 bg-brand-500/5 shadow-sm ring-1 ring-brand-500/20'
                    : 'border-sb-hairline bg-surface-1 shadow-xs hover:border-brand-500/40',
                )}
              >
                <div className="flex items-center gap-3.5 min-w-[200px] shrink-0">
                  <span
                    className={cn(
                      'w-4.5 h-4.5 rounded-full shrink-0 border box-border bg-surface-1 transition-all',
                      selectedPlan === 'annual'
                        ? 'border-[5px] border-brand-500'
                        : 'border-2 border-border-default',
                    )}
                  />
                  <div>
                    <span className="block text-lg sm:text-xl font-extrabold tracking-tight font-display text-sb-ink">
                      Annual Plan
                    </span>
                    <span className="inline-block text-[10px] font-extrabold tracking-wider uppercase text-brand-600 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20 mt-1">
                      {user && isOnYearly ? 'Current plan' : `Save ${ANNUAL_SAVING_PCT}% · Best Value`}
                    </span>
                  </div>
                </div>
                <div className="min-w-[140px] shrink-0">
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl sm:text-2xl font-extrabold tracking-tight font-mono tnum text-sb-ink">
                      ₹{PRICING.ANNUAL_AMOUNT}
                    </span>
                    <span className="text-xs font-semibold text-sb-ink-muted"> / year</span>
                  </div>
                  <span className="block text-[11px] font-mono text-brand-600 font-semibold mt-0.5">
                    ≈ ₹{ANNUAL_PER_DAY} / day
                  </span>
                </div>
                <div className="flex-1 min-w-[200px] text-xs sm:text-sm text-sb-ink-secondary leading-relaxed">
                  Our most popular tier. Complete peace of mind and maximum savings for the full year.
                </div>
              </button>
            </div>

            {/* Selected Plan Summary Callout Box */}
            <div className="rounded-2xl border border-brand-500/25 bg-brand-500/5 p-6 sm:p-7 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                <div className="space-y-1.5 max-w-xl">
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
                      className="py-3 px-6 text-xs font-bold rounded-xl bg-surface-2 text-sb-ink-muted border border-sb-hairline cursor-default"
                    >
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
                    Auto-renews via UPI Autopay / card mandate · Cancel anytime
                  </span>
                </div>
              </div>
            </div>

            {/* Discrete Promo Coupon Trigger */}
            <div className="text-center pt-2">
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
          </section>

          {/* ══════════════════════════════════════════════════════════════
              TRUST & SECURITY RIBBON
              ══════════════════════════════════════════════════════════════ */}
          <div className="rounded-2xl border border-sb-hairline bg-surface-1 p-6 sm:p-8 shadow-xs">
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

          {/* ══════════════════════════════════════════════════════════════
              COMPACT FAQ ACCORDION
              ══════════════════════════════════════════════════════════════ */}
          <PricingFaqAccordion />

          {/* ══════════════════════════════════════════════════════════════
              MODALS
              ══════════════════════════════════════════════════════════════ */}
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
