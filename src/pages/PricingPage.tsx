// ============================================
// PricingPage — Modern Luxury Fintech Edition
// Sovereign, transparent, zero-surprise pricing
// ============================================

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppLayout from '@/layouts/AppLayout'
import { useAuth, useToast } from '@/context'
import { motion } from 'framer-motion'
import { useScrollReveal } from '@/hooks'
import { supabase } from '@/services/supabase'
import { formatDate, cn } from '@/utils'
import { setPageMeta } from '@/utils/seo'
import { ANNUAL_PER_DAY, ANNUAL_SAVING_PCT, APP_CONFIG, PRICING } from '@/constants'
import {
  Sparkles,
  Clock,
  PauseCircle,
  CheckCircle2,
  ShieldCheck,
  Lock,
  KeyRound,
  CreditCard,
  ArrowRight,
  Calendar,
  Ticket,
  EyeOff
} from 'lucide-react'
import { cancelSubscription as cancelLegacySubscription, resumeSubscription } from '@/services'
import { createSubscription, cancelSubscription as cancelRazorpaySubscription } from '@/services/subscriptionBilling'
import {
  PricingAmbientBackground,
  CostToValueVisual,
  TrustTelemetryRibbon,
  PricingFaqAccordion,
  ExecutiveSubscriptionCard,
  CancelSubscriptionModal
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

// ── Feature lists for different subscription tiers ───────────
const MONTHLY_FEATURES = [
  'Two on-demand inbox scans a day (4h cooldown)',
  'Everything in the 7-day trial, without time limits',
  'Real-time merchant & category learning engine',
  'Subscription renewal radar & calendar alerts',
  'Full CSV & JSON exports + Encrypted offline backup',
  'One-time payment · Zero auto-renew mandates',
]

const YEARLY_FEATURES = [
  'Everything in Monthly — full unrestricted suite',
  'Billed once a year instead of every month',
  `Works out to just ₹${ANNUAL_PER_DAY} a day (Save ${ANNUAL_SAVING_PCT}%)`,
  'Nothing to renew or re-authorise for 365 days',
  'Instant plan queueing — stack another year without losing days',
  'Priority support & early access to new banks',
]

export default function PricingPage() {
  const navigate = useNavigate()
  const { user, profile, daysLeft, openAuthModal, refreshProfile } = useAuth()
  const { showToast } = useToast()

  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual')
  const [paymentMethod, setPaymentMethod] = useState<'razorpay' | 'promo'>('razorpay')
  const [promoCode, setPromoCode] = useState('')
  const [processing, setProcessing] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [reactivating, setReactivating] = useState(false)

  useScrollReveal()

  const status = profile?.subscription_status
  const isExpired = status === 'expired' || (status === 'active' && daysLeft <= 0) || (status === 'trial' && daysLeft <= 0)
  const isTrialExpired = (status === 'trial' && daysLeft <= 0) || (status === 'expired' && profile?.subscription_plan_type === 'trial')
  const isSubExpired = (status === 'active' && daysLeft <= 0) || (status === 'expired' && profile?.subscription_plan_type !== 'trial')
  const neverSubscribed = !user || status === 'free' || !status
  const isCancelled = status === 'cancelled'

  const hasQueuedPlan = !!profile?.pending_plan_type
  const isActiveActive = status === 'active' && daysLeft > 0
  const isTrialActive = status === 'trial' && daysLeft > 0

  const isActive = isActiveActive
  const isTrial = isTrialActive

  const isOnYearly = (isActive || (isCancelled && daysLeft > 0)) && profile?.subscription_plan_type !== 'monthly' && profile?.subscription_plan_type !== 'trial'
  const isOnMonthly = (isActive || (isCancelled && daysLeft > 0)) && profile?.subscription_plan_type === 'monthly'
  const canBuy = !hasQueuedPlan

  const planName = selectedPlan === 'annual' ? 'Yearly' : 'Monthly'
  const planPrice = selectedPlan === 'annual' ? String(PRICING.ANNUAL_AMOUNT) : String(PRICING.MONTHLY_AMOUNT)
  const planSub = selectedPlan === 'annual' ? 'One payment · 365 days of full access' : 'One payment · 30 days of full access'

  const activePlanName = isOnYearly
    ? 'Yearly Plan'
    : isOnMonthly
    ? 'Monthly Plan'
    : isTrial
    ? 'Trial Access'
    : 'Subscription'

  const handleConfirmCancel = async (reason: string, feedback: string) => {
    setCancelling(true)
    try {
      const expiryStr = profile?.subscription_expires_at ? formatDate(profile.subscription_expires_at) : 'the end of your prepaid period'
      if (profile?.razorpay_subscription_id) {
        // Auto-renewing subscription: the mandate lives at Razorpay, so the
        // local status flag alone does nothing to stop the next charge. This
        // must reach /api/cancel-subscription to actually cancel it (at cycle
        // end — access is unaffected today).
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          throw new Error('Your session expired. Please log in again.')
        }
        await cancelRazorpaySubscription(session.access_token)
      } else {
        // Legacy one-time customer: there is no mandate to cancel, so flipping
        // the status flag is all there is.
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

  const handleReactivate = async () => {
    setReactivating(true)
    try {
      const { error } = await resumeSubscription()
      if (error) throw error
      await refreshProfile()
      showToast('Subscription resumed! Full automated tracking remains active.', 'success')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast(`Failed to resume subscription: ${message}`, 'error')
    } finally {
      setReactivating(false)
    }
  }

  useEffect(() => {
    setPageMeta({
      title: `Pricing & Plans | ${APP_CONFIG.APP_NAME}`,
      description: `Intrack costs ₹${PRICING.MONTHLY_AMOUNT} for 30 days or ₹${PRICING.ANNUAL_AMOUNT} for a full year — one-time payments, so nothing auto-renews and no mandate touches your card. Free 7-day trial, no card required.`,
      canonicalPath: '/pricing',
    })
  }, [])

  useEffect(() => {
    if (isActive && profile?.subscription_plan_type === 'monthly') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedPlan('annual')
    }
  }, [isActive, profile])

  // ── Razorpay Checkout ─────────────────────────────────────────
  const loadRazorpayScript = () =>
    new Promise((resolve) => {
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

  const handleRazorpayCheckout = async () => {
    if (!user) {
      showToast('Please log in to upgrade your plan.', 'warning')
      openAuthModal('/pricing')
      return
    }
    setProcessing(true)
    const scriptLoaded = await loadRazorpayScript()
    if (!scriptLoaded) {
      showToast('Failed to load payment gateway SDK. Check your internet.', 'error')
      setProcessing(false)
      return
    }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        showToast('Your session expired. Please log in again.', 'error')
        setProcessing(false)
        return
      }
      const clientKey = import.meta.env.VITE_RAZORPAY_KEY_ID
      if (!clientKey || !clientKey.startsWith('rzp_')) {
        throw new Error('Payments are not configured on this deployment. Please contact support — you have not been charged.')
      }

      const { id: subscriptionId } = await createSubscription(selectedPlan, session.access_token)

      const options = {
        key: clientKey,
        // Razorpay derives the amount and cadence from the plan, so no amount or
        // currency is passed for a subscription.
        subscription_id: subscriptionId,
        name: APP_CONFIG.APP_NAME,
        description: `${planName} plan`,
        prefill: { name: profile?.full_name || '', email: user.email || '' },
        theme: { color: '#0e7a5d' },
        handler: async () => {
          // No verify step: the authorisation charge and every renewal arrive
          // as `subscription.charged` webhooks, which are the only thing that
          // grants access. A closed browser or a handler that never fires
          // must never cost the customer their plan.
          await refreshProfile()
          showToast(`Payment received. Your ${planName} plan activates in a moment.`, 'success')
          navigate('/dashboard')
        },
        modal: { ondismiss: () => setProcessing(false) },
      }
      const RazorpayCtor = window.Razorpay
      if (!RazorpayCtor) {
        showToast('Payment gateway failed to initialize.', 'error')
        setProcessing(false)
        return
      }
      const rzp = new RazorpayCtor(options)
      rzp.on('payment.failed', (response: { error?: { description?: string } }) => {
        showToast(`Payment Failed: ${response?.error?.description || 'Unknown error'}`, 'error')
        setProcessing(false)
      })
      rzp.open()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast(`Checkout error: ${message}`, 'error')
      setProcessing(false)
    }
  }

  const handleSelectPlan = (plan: 'monthly' | 'annual') => {
    setSelectedPlan(plan)
    setPaymentMethod('razorpay')
    const checkoutElem = document.getElementById('checkout-section')
    if (checkoutElem) {
      checkoutElem.scrollIntoView({ behavior: 'smooth' })
    }
  }

  const handleSelectPromo = () => {
    if (!user) {
      showToast('Please sign in or create an account to redeem a coupon.', 'warning')
      openAuthModal('/pricing')
      return
    }
    setPaymentMethod('promo')
    const checkoutElem = document.getElementById('checkout-section')
    if (checkoutElem) {
      checkoutElem.scrollIntoView({ behavior: 'smooth' })
    }
  }

  // ── Promo Code Simulator & Redemption ─────────────────────────
  const handlePromoSimulator = async () => {
    if (!user) {
      showToast('Please log in to redeem a promo code.', 'warning')
      openAuthModal('/pricing')
      return
    }

    const enteredCode = promoCode.trim()
    if (!enteredCode) {
      showToast('Please enter a coupon code.', 'warning')
      return
    }

    setProcessing(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        showToast('Your session expired. Please sign in again.', 'error')
        setProcessing(false)
        return
      }

      const response = await fetch('/api/redeem-promo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ code: enteredCode }),
      })

      const result = await response.json()

      if (!response.ok) {
        showToast(result.error || 'Could not redeem this coupon.', 'error')
        return
      }

      await refreshProfile()
      const days = result.durationDays
      showToast(`👑 ${days} day${days === 1 ? '' : 's'} of full access unlocked!`, 'success')
      navigate('/dashboard')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast('Coupon error: ' + message, 'error')
    } finally {
      setProcessing(false)
    }
  }

  // ── Symmetrical Plan Cards Component ─────────────────────────
  const renderPlanCards = (isVisitor: boolean) => (
    <div className="grid md:grid-cols-2 gap-6 items-stretch max-w-5xl mx-auto pt-2">
      {/* ── Featured: Yearly Plan ─────────────────────────── */}
      <div
        onClick={() => handleSelectPlan('annual')}
        className={cn(
          'rounded-3xl p-6 sm:p-8 flex flex-col justify-between relative overflow-hidden transition-all duration-300 cursor-pointer select-none bg-surface-1 border-2',
          selectedPlan === 'annual'
            ? 'border-brand-500 shadow-[0_12px_40px_-10px_rgba(14,122,93,0.18)]'
            : 'border-sb-hairline hover:border-brand-500/40 shadow-sm'
        )}
      >
        {/* Top Tag */}
        <div
          className={cn(
            'absolute top-0 right-0 text-[11px] font-extrabold uppercase tracking-widest px-3.5 py-1.5 rounded-bl-2xl rounded-tr-2xl shadow-sm',
            !isVisitor && isOnYearly ? 'bg-brand-600 text-white' : 'bg-brand-500 text-white'
          )}
        >
          {!isVisitor && isOnYearly ? '✓ Current Plan' : `Recommended · Save ${ANNUAL_SAVING_PCT}%`}
        </div>

        <div>
          <div className="flex items-center gap-2.5 mb-2 mt-1">
            <h2 className="text-2xl font-bold text-sb-ink">Yearly Plan</h2>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-600 bg-brand-500/10 px-2 py-0.5 rounded-md border border-brand-500/20 font-mono">
              BEST VALUE
            </span>
          </div>
          <p className="text-xs sm:text-sm text-sb-ink-secondary leading-relaxed mb-6">
            The choice of mindful spenders. Pay once, enjoy effortless bookkeeping for 12 months with zero surprise charges.
          </p>

          {/* Price Display */}
          <div className="mb-6 p-4 rounded-2xl bg-surface-2/60 border border-sb-hairline flex items-baseline justify-between">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="font-extrabold text-4xl sm:text-5xl text-sb-ink tracking-tight tnum">₹{PRICING.ANNUAL_AMOUNT}</span>
                <span className="text-xs sm:text-sm text-sb-ink-muted">/ year</span>
              </div>
              <p className="text-[11px] text-sb-ink-muted mt-1 font-medium">
                One-time payment · 365 days of access
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-brand-500/15 text-brand-700 border border-brand-500/30 font-bold font-mono shrink-0">
              ≈ ₹{ANNUAL_PER_DAY} / day
            </span>
          </div>

          {/* Feature Checklist */}
          <ul className="space-y-3 border-t border-sb-hairline pt-5 mb-8">
            {YEARLY_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-xs sm:text-sm font-medium text-sb-ink">
                <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2.5 pt-2">
          {!isVisitor && isOnYearly && profile?.subscription_expires_at && (
            <p className="text-center text-xs font-bold text-brand-600">
              Your active plan until {formatDate(profile.subscription_expires_at)}
            </p>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (isVisitor) {
                openAuthModal('/pricing', 'signup')
                return
              }
              handleSelectPlan('annual')
            }}
            disabled={!isVisitor && !canBuy}
            className="sb-btn-primary w-full justify-center cursor-pointer border-0 text-sm sm:text-base py-3.5 shadow-md hover:shadow-lg transition-all"
            style={{ opacity: !isVisitor && !canBuy ? 0.5 : 1 }}
          >
            {isVisitor
              ? `Get Yearly · ₹${PRICING.ANNUAL_AMOUNT}`
              : !canBuy
              ? 'A plan is already queued'
              : isOnYearly
              ? `Extend for another year (₹${PRICING.ANNUAL_AMOUNT})`
              : isActive && profile?.subscription_plan_type === 'monthly'
              ? `Upgrade to Yearly (₹${PRICING.ANNUAL_AMOUNT})`
              : `Get Yearly · ₹${PRICING.ANNUAL_AMOUNT}`}
          </button>
          {!isVisitor && isOnYearly && canBuy && (
            <p className="text-[11px] text-center text-sb-ink-muted">
              Renewing now adds 365 days to your end date — you lose zero prepaid time.
            </p>
          )}
        </div>
      </div>

      {/* ── Secondary: Monthly Plan ───────────────────────── */}
      <div
        onClick={() => handleSelectPlan('monthly')}
        className={cn(
          'rounded-3xl p-6 sm:p-8 flex flex-col justify-between relative overflow-hidden transition-all duration-300 cursor-pointer select-none bg-surface-1 border-2',
          selectedPlan === 'monthly'
            ? 'border-brand-500 shadow-[0_12px_40px_-10px_rgba(14,122,93,0.18)]'
            : 'border-sb-hairline hover:border-brand-500/40 shadow-sm'
        )}
      >
        {/* Top Tag for active monthly */}
        {!isVisitor && isOnMonthly && (
          <div className="absolute top-0 right-0 bg-brand-600 text-white text-[11px] font-extrabold uppercase tracking-widest px-3.5 py-1.5 rounded-bl-2xl rounded-tr-2xl shadow-sm">
            ✓ Current Plan
          </div>
        )}

        <div>
          <div className="flex items-center gap-2.5 mb-2 mt-1">
            <h2 className="text-2xl font-bold text-sb-ink">Monthly Plan</h2>
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sb-ink-muted bg-surface-2 px-2 py-0.5 rounded-md border border-sb-hairline font-mono">
              FLEXIBLE
            </span>
          </div>
          <p className="text-xs sm:text-sm text-sb-ink-secondary leading-relaxed mb-6">
            Test the power of autonomous money management month-to-month without long-term commitment.
          </p>

          {/* Price Display */}
          <div className="mb-6 p-4 rounded-2xl bg-surface-2/60 border border-sb-hairline flex items-baseline justify-between">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="font-extrabold text-4xl sm:text-5xl text-sb-ink tracking-tight tnum">₹{PRICING.MONTHLY_AMOUNT}</span>
                <span className="text-xs sm:text-sm text-sb-ink-muted">/ month</span>
              </div>
              <p className="text-[11px] text-sb-ink-muted mt-1 font-medium">
                One-time payment · 30 days of access
              </p>
            </div>
            <span className="text-xs px-2.5 py-1 rounded-full bg-surface-1 text-sb-ink-secondary border border-sb-hairline font-bold shrink-0">
              Zero Mandates
            </span>
          </div>

          {/* Feature Checklist */}
          <ul className="space-y-3 border-t border-sb-hairline pt-5 mb-8">
            {MONTHLY_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-xs sm:text-sm font-medium text-sb-ink">
                <CheckCircle2 className="w-4 h-4 text-brand-600 shrink-0 mt-0.5" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2.5 pt-2">
          {!isVisitor && isOnMonthly && profile?.subscription_expires_at && (
            <p className="text-center text-xs font-bold text-brand-600">
              Your active plan until {formatDate(profile.subscription_expires_at)}
            </p>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              if (isVisitor) {
                openAuthModal('/pricing', 'signup')
                return
              }
              handleSelectPlan('monthly')
            }}
            disabled={!isVisitor && !canBuy}
            className={cn(
              'w-full justify-center rounded-xl py-3.5 text-sm sm:text-base font-semibold border cursor-pointer transition-all',
              selectedPlan === 'monthly'
                ? 'sb-btn-primary border-0'
                : 'sb-btn-secondary'
            )}
            style={{ opacity: !isVisitor && !canBuy ? 0.5 : 1 }}
          >
            {isVisitor
              ? `Choose Monthly · ₹${PRICING.MONTHLY_AMOUNT}`
              : !canBuy
              ? 'A plan is already queued'
              : isOnMonthly
              ? `Renew for another month (₹${PRICING.MONTHLY_AMOUNT})`
              : `Choose Monthly · ₹${PRICING.MONTHLY_AMOUNT}`}
          </button>
        </div>
      </div>
    </div>
  )

  // ── Authenticated User Checkout Box ───────────────────────────
  const renderInAppCheckout = () => (
    <div id="checkout-section" className="max-w-2xl mx-auto w-full pt-2">
      <div className="rounded-3xl shadow-sm overflow-hidden bg-surface-1 border border-sb-hairline">
        {/* Tab Switcher */}
        <div className="flex bg-surface-2/60 border-b border-sb-hairline">
          <button
            type="button"
            onClick={() => setPaymentMethod('razorpay')}
            className={cn(
              'flex-1 py-4 text-xs font-bold cursor-pointer transition-colors border-none bg-transparent flex items-center justify-center gap-2 border-b-2',
              paymentMethod === 'razorpay'
                ? 'text-brand-600 border-brand-500 bg-surface-1'
                : 'text-sb-ink-muted border-transparent hover:text-sb-ink'
            )}
          >
            <CreditCard className="w-4 h-4" />
            <span>Pay Securely Online</span>
          </button>

          <button
            type="button"
            onClick={() => setPaymentMethod('promo')}
            className={cn(
              'flex-1 py-4 text-xs font-bold cursor-pointer transition-colors border-none bg-transparent flex items-center justify-center gap-2 border-b-2',
              paymentMethod === 'promo'
                ? 'text-brand-600 border-brand-500 bg-surface-1'
                : 'text-sb-ink-muted border-transparent hover:text-sb-ink'
            )}
          >
            <Ticket className="w-4 h-4" />
            <span>Promo Coupon</span>
          </button>
        </div>

        <div className="p-6 sm:p-8 space-y-6">
          {/* Payment Gateway Flow */}
          {paymentMethod === 'razorpay' && (
            <div className="space-y-6">
              {/* Order Summary Box */}
              <div className="rounded-2xl p-5 flex justify-between items-start bg-surface-2/40 border border-sb-hairline">
                <div>
                  <p className="text-[10px] text-sb-ink-muted font-bold uppercase tracking-widest">Order Summary</p>
                  <p className="text-lg mt-1 font-extrabold text-sb-ink">{planName} Plan</p>
                  <p className="text-xs text-sb-ink-secondary mt-0.5">{planSub}</p>
                </div>
                <div className="text-right">
                  <p className="font-extrabold text-2xl sm:text-3xl text-sb-ink tracking-tight font-mono tnum">
                    ₹{planPrice}
                  </p>
                  <p className="text-[10px] text-brand-600 font-bold uppercase tracking-wider">
                    One-time total
                  </p>
                </div>
              </div>

              {/* Plan Quick Selector Switcher */}
              <div className="grid grid-cols-2 gap-3">
                {(['annual', 'monthly'] as const).map((plan) => (
                  <button
                    key={plan}
                    type="button"
                    onClick={() => setSelectedPlan(plan)}
                    className={cn(
                      'py-3 rounded-xl text-xs font-semibold cursor-pointer transition-all bg-transparent border min-h-[44px]',
                      selectedPlan === plan
                        ? 'text-brand-700 border-brand-500 bg-brand-500/5 font-bold shadow-sm'
                        : 'text-sb-ink-secondary border-sb-hairline hover:bg-surface-2'
                    )}
                  >
                    {plan === 'annual' ? `Yearly — ₹${PRICING.ANNUAL_AMOUNT} / yr` : `Monthly — ₹${PRICING.MONTHLY_AMOUNT} / mo`}
                  </button>
                ))}
              </div>

              {/* Supported Payment Rails */}
              <div className="rounded-xl p-3 flex flex-wrap items-center justify-center gap-2 bg-surface-2/30 border border-sb-hairline">
                {['UPI QR', 'Google Pay', 'PhonePe', 'Paytm', 'CRED', 'RuPay', 'Cards', 'NetBanking'].map((m) => (
                  <span key={m} className="text-[10px] px-2.5 py-0.5 rounded-full bg-surface-1 border border-sb-hairline text-sb-ink-secondary font-semibold">
                    {m}
                  </span>
                ))}
              </div>

              {/* Checkout Trigger */}
              <button
                onClick={handleRazorpayCheckout}
                disabled={processing || hasQueuedPlan}
                className="sb-btn-primary w-full cursor-pointer border-0 py-3.5 text-base font-bold shadow-md hover:shadow-lg transition-all min-h-[44px]"
                style={{ opacity: processing || hasQueuedPlan ? 0.6 : 1 }}
              >
                {hasQueuedPlan
                  ? 'A plan is already queued'
                  : processing
                  ? 'Opening secure payment gateway…'
                  : `Pay ₹${planPrice} & Activate ${planName}`}
              </button>

              <p className="text-[11px] text-center text-sb-ink-muted">
                🔒 Bank-grade 256-bit encryption · Card details are handled directly by the licensed payment gateway, never stored on our servers
              </p>
            </div>
          )}

          {/* Promo Flow */}
          {paymentMethod === 'promo' && (
            <div className="space-y-6">
              <div className="rounded-2xl p-4 bg-brand-500/5 border border-brand-500/20 space-y-1.5">
                <p className="text-xs text-sb-ink font-bold flex items-center gap-1.5">
                  <Ticket className="w-4 h-4 text-brand-600" />
                  <span>Exclusive Invitation or Promo Coupon</span>
                </p>
                <p className="text-xs text-sb-ink-secondary leading-relaxed">
                  Enter your promotional coupon below to instantly unlock full access to on-demand tracking and insight tools.
                </p>
                <p className="text-[11px] text-sb-ink-muted pt-1">
                  * Promotional codes apply to eligible accounts (limit 1 code per account).
                </p>
              </div>

              <form onSubmit={(e) => { e.preventDefault(); handlePromoSimulator() }} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs block font-bold uppercase tracking-wider text-sb-ink-muted">
                    Coupon Code
                  </label>
                  <input
                    className="w-full bg-surface-2 border border-sb-hairline text-sb-ink text-sm rounded-xl px-4 py-3 placeholder:text-sb-ink-muted focus:outline-none focus:ring-2 focus:ring-brand-500/30 transition-all uppercase font-semibold tracking-wider font-mono"
                    type="text"
                    placeholder="e.g. INTRACKVIP"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                  />
                </div>
                <button
                  type="submit"
                  disabled={processing || !promoCode.trim()}
                  className="sb-btn-primary w-full cursor-pointer border-0 py-3 text-sm font-bold"
                  style={{ opacity: processing || !promoCode.trim() ? 0.5 : 1 }}
                >
                  {processing ? 'Applying coupon…' : 'Redeem Code & Activate'}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Refund policy note */}
      <p className="text-xs text-center mt-5 text-sb-ink-muted">
        Questions?{' '}
        <Link to="/support" className="text-brand-600 no-underline hover:underline font-bold">Contact support</Link> ·{' '}
        <Link to="/refund-policy" className="text-brand-600 no-underline hover:underline font-bold">Refund policy</Link> — 100% full refund available within 7 days.
      </p>
    </div>
  )

  // ── Visitor Checkout Sign-In Card ─────────────────────────────
  const renderVisitorCheckout = () => (
    <div id="checkout-section" className="max-w-2xl mx-auto w-full pt-4">
      <div className="rounded-3xl shadow-sm p-8 text-center space-y-5 bg-surface-1 border border-sb-hairline">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-600">
          <Lock className="w-7 h-7" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-xl font-bold text-sb-ink">Sign in to activate your plan</h3>
          <p className="text-xs sm:text-sm text-sb-ink-secondary leading-relaxed max-w-sm mx-auto">
            To securely associate your payment and enable automated Gmail alert parsing, sign in or register in seconds.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
          <button
            onClick={() => openAuthModal('/pricing', 'login')}
            className="sb-btn-primary w-full sm:w-auto cursor-pointer border-0 px-6 py-3"
          >
            Sign In
          </button>
          <button
            onClick={() => openAuthModal('/pricing', 'signup')}
            className="sb-btn-secondary w-full sm:w-auto cursor-pointer px-6 py-3"
          >
            Create Account
          </button>
        </div>
        <p className="text-[11px] text-sb-ink-muted">
          Zero spam · strictly read-only Gmail access · 256-bit encrypted
        </p>
      </div>

      {/* Refund policy note */}
      <p className="text-xs text-center mt-5 text-sb-ink-muted">
        Questions?{' '}
        <Link to="/support" className="text-brand-600 no-underline hover:underline font-bold">Contact support</Link> ·{' '}
        <Link to="/refund-policy" className="text-brand-600 no-underline hover:underline font-bold">Refund policy</Link> — 100% full refund available within 7 days.
      </p>
    </div>
  )

  // ── Render ────────────────────────────────────────────────────
  return (
    <AppLayout>
      {user ? (
        /* ── IN-APP BILLING VIEW (FOR AUTHENTICATED USERS) ── */
        <div className="space-y-8 animate-fade-in text-sb-ink max-w-6xl mx-auto overflow-x-hidden">
          {/* In-app Sub-Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-sb-hairline/60">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-sb-ink">
                Subscription &amp; Billing
              </h1>
              <p className="text-xs sm:text-sm text-sb-ink-secondary mt-1">
                Manage your membership, view active entitlements, extend your prepaid coverage, or cancel anytime.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                to="/support"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-sb-hairline text-xs font-semibold text-sb-ink-secondary hover:text-sb-ink hover:bg-surface-2 transition-colors no-underline"
              >
                Billing Support
              </Link>
              <Link
                to="/refund-policy"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-sb-hairline text-xs font-semibold text-sb-ink-secondary hover:text-sb-ink hover:bg-surface-2 transition-colors no-underline"
              >
                Refund Policy
              </Link>
            </div>
          </div>

          {/* Executive Subscription Card */}
          <ExecutiveSubscriptionCard
            profile={profile}
            email={user.email}
            daysLeft={daysLeft}
            hasQueuedPlan={hasQueuedPlan}
            onSelectPlan={handleSelectPlan}
            onOpenCancelModal={() => setCancelModalOpen(true)}
            onReactivate={handleReactivate}
            isReactivating={reactivating}
          />

          {/* Switch Plans or Extend Coverage */}
          <div className="space-y-6 pt-2">
            <div className="text-center max-w-xl mx-auto space-y-1">
              <h2 className="text-xl sm:text-2xl font-bold text-sb-ink tracking-tight">
                Switch Plans or Extend Coverage
              </h2>
              <p className="text-xs sm:text-sm text-sb-ink-secondary leading-relaxed">
                Choose a plan below to switch billing cadence or queue additional prepaid time onto your existing period without losing days.
              </p>
            </div>

            {/* Symmetrical Plan Cards */}
            {renderPlanCards(false)}

            {/* Coupon link */}
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={handleSelectPromo}
                className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-brand-600 hover:text-brand-700 bg-transparent border-0 cursor-pointer underline underline-offset-4"
              >
                <Ticket className="w-4 h-4" />
                <span>Have an invite or coupon code? Click to redeem</span>
              </button>
            </div>
          </div>

          {/* Checkout Card for Logged In User */}
          {renderInAppCheckout()}

          {/* Sovereign Guarantee Box for Authenticated Users */}
          <div className="rounded-3xl border border-sb-hairline bg-surface-1 p-6 sm:p-8 shadow-sm">
            <div className="flex items-center gap-2.5 mb-4">
              <ShieldCheck className="w-5 h-5 text-brand-600" />
              <h3 className="text-base sm:text-lg font-bold text-sb-ink">The Intrack Sovereign Guarantee</h3>
            </div>
            <div className="grid sm:grid-cols-3 gap-5 text-xs">
              <div className="space-y-1.5">
                <p className="font-bold text-sb-ink text-sm">Zero Mandates</p>
                <p className="text-sb-ink-secondary leading-relaxed">
                  No recurring auto-debit mandates on your card or UPI. You retain complete sovereignty and renew only on your terms.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="font-bold text-sb-ink text-sm">7-Day Full Refund</p>
                <p className="text-sb-ink-secondary leading-relaxed">
                  Unsatisfied for any reason within 7 days? Contact support for a 100% full reversal to your original payment method.
                </p>
              </div>
              <div className="space-y-1.5">
                <p className="font-bold text-sb-ink text-sm">Bank-Grade 256-Bit Security</p>
                <p className="text-sb-ink-secondary leading-relaxed">
                  Transactions are handled exclusively by licensed gateway partners. Intrack never sees or stores card numbers or UPI PINs.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ── PUBLIC VISITOR VIEW (FOR GUESTS / PROSPECTIVE SUBSCRIBERS) ── */
        <div className="space-y-8 animate-fade-in text-sb-ink max-w-6xl mx-auto overflow-x-hidden">
          {/* Public Hero Card */}
          <motion.div
            className="relative rounded-3xl overflow-hidden border border-sb-hairline bg-surface-1 p-6 sm:p-10 md:p-14 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)]"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Ambient Lighting Orbs */}
            <PricingAmbientBackground />

            <div className="relative z-10 flex flex-col items-center max-w-2xl mx-auto space-y-4">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-600 text-xs font-semibold tracking-wide shadow-sm">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
                </span>
                Effortless Expense Intelligence
              </div>

              <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-sb-ink leading-tight">
                Invest in peace of mind.{' '}
                <span className="text-brand-500 block sm:inline">Zero manual entry.</span>
              </h1>

              <p className="text-sm sm:text-base text-sb-ink-secondary leading-relaxed max-w-xl">
                One-time payments with no recurring debit mandates, no auto-renewal surprises, and no stored card details. Every plan starts with a full 7-day trial.
              </p>

              {/* Interactive Billing Toggle Pill */}
              <div className="pt-2">
                <div className="inline-flex items-center p-1.5 rounded-2xl bg-surface-2 border border-sb-hairline shadow-inner">
                  <button
                    type="button"
                    onClick={() => setSelectedPlan('annual')}
                    className={cn(
                      'relative px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer border-0',
                      selectedPlan === 'annual'
                        ? 'text-brand-700 font-bold'
                        : 'text-sb-ink-muted hover:text-sb-ink bg-transparent'
                    )}
                  >
                    {selectedPlan === 'annual' && (
                      <motion.div
                        layoutId="billing-pill"
                        className="absolute inset-0 bg-surface-1 rounded-xl shadow-sm border border-brand-500/30"
                        transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                      />
                    )}
                    <span className="relative z-10 flex items-center gap-2">
                      <span>Yearly (₹{ANNUAL_PER_DAY} / day)</span>
                      <span className="text-[10px] uppercase font-mono font-bold bg-brand-500/15 text-brand-700 px-2 py-0.5 rounded-md border border-brand-500/30">
                        Save {ANNUAL_SAVING_PCT}%
                      </span>
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPlan('monthly')}
                    className={cn(
                      'relative px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer border-0',
                      selectedPlan === 'monthly'
                        ? 'text-brand-700 font-bold'
                        : 'text-sb-ink-muted hover:text-sb-ink bg-transparent'
                    )}
                  >
                    {selectedPlan === 'monthly' && (
                      <motion.div
                        layoutId="billing-pill"
                        className="absolute inset-0 bg-surface-1 rounded-xl shadow-sm border border-brand-500/30"
                        transition={{ type: 'spring', stiffness: 350, damping: 28 }}
                      />
                    )}
                    <span className="relative z-10">Monthly (₹{PRICING.MONTHLY_AMOUNT} / mo)</span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Trial Banner for visitors */}
          <div className="rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-surface-1 border border-brand-500/30 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 shrink-0">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-sb-ink">Every account starts with a free 7-day trial</p>
                <p className="text-xs text-sb-ink-secondary mt-0.5">
                  Full access — automated email parsing, smart budgets, and subscription detection. No credit card required.
                </p>
              </div>
            </div>
            <button
              onClick={() => openAuthModal('/pricing', 'signup')}
              className="sb-btn-primary w-full sm:w-auto justify-center border-0 cursor-pointer shrink-0 py-2.5 px-4 text-xs font-bold"
            >
              Start free trial <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </button>
          </div>

          {/* Public Pricing Cards */}
          {renderPlanCards(true)}

          {/* Coupon Code Disclosure for visitors */}
          <div className="text-center pt-1">
            <button
              type="button"
              onClick={handleSelectPromo}
              className="inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-brand-600 hover:text-brand-700 bg-transparent border-0 cursor-pointer underline underline-offset-4"
            >
              <Ticket className="w-4 h-4" />
              <span>Have an invite or coupon code? Click to redeem</span>
            </button>
          </div>

          {/* Return On Investment & Cost Comparison Visual */}
          <CostToValueVisual />

          {/* Trust & Security Telemetry */}
          <TrustTelemetryRibbon />

          {/* Visitor Checkout Card */}
          {renderVisitorCheckout()}

          {/* The Intrack Standard */}
          <div className="border-t border-sb-hairline pt-12">
            <div className="text-center max-w-xl mx-auto mb-8 space-y-2">
              <div className="inline-flex items-center gap-1.5 bg-surface-2 border border-sb-hairline px-3 py-1 rounded-full text-xs font-semibold text-brand-600 uppercase tracking-wider">
                The Intrack Standard
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-sb-ink tracking-tight">
                Built on Privacy &amp; Local Isolation
              </h2>
              <p className="text-xs sm:text-sm text-sb-ink-secondary leading-relaxed">
                We believe your financial transcripts are strictly confidential. Intrack is engineered from day one with zero data monetization.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              <div className="rounded-3xl bg-surface-1 border border-sb-hairline p-6 space-y-3 shadow-sm hover:shadow-md transition-all">
                <div className="h-10 w-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600">
                  <EyeOff className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-sb-ink text-base">Nothing Stored, Nothing Sold</h3>
                <p className="text-xs text-sb-ink-secondary leading-relaxed">
                  Your mailbox is read straight from Gmail. No server retains an archive of your personal emails. Alerts pass in memory to Google's Gemini in real time and are never used for ad targeting.
                </p>
              </div>

              <div className="rounded-3xl bg-surface-1 border border-sb-hairline p-6 space-y-3 shadow-sm hover:shadow-md transition-all">
                <div className="h-10 w-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-sb-ink text-base">Read-Only Email Scans</h3>
                <p className="text-xs text-sb-ink-secondary leading-relaxed">
                  Our Google OAuth permissions are strictly read-only. Intrack cannot compose, send, modify, or delete any messages in your mailbox.
                </p>
              </div>

              <div className="rounded-3xl bg-surface-1 border border-sb-hairline p-6 space-y-3 shadow-sm hover:shadow-md transition-all">
                <div className="h-10 w-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600">
                  <KeyRound className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-sb-ink text-base">Zero Banking Passwords</h3>
                <p className="text-xs text-sb-ink-secondary leading-relaxed">
                  We never ask for your net-banking password, debit card PIN, OTP, or CVV. Your banking credentials never cross our systems.
                </p>
              </div>
            </div>
          </div>

          {/* Pricing FAQ Accordion */}
          <PricingFaqAccordion />
        </div>
      )}

      {/* ── Cancel Subscription Modal ── */}
      <CancelSubscriptionModal
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirm={handleConfirmCancel}
        isProcessing={cancelling}
        expiresAt={profile?.subscription_expires_at || null}
        daysLeft={daysLeft}
        planName={activePlanName}
      />
    </AppLayout>
  )
}
