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
import { APP_CONFIG } from '@/constants'
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
import {
  PricingAmbientBackground,
  CostToValueVisual,
  TrustTelemetryRibbon,
  PricingFaqAccordion
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
  'Two automated inbox scans a day (4h cadence)',
  'Everything in the 7-day trial, without time limits',
  'Real-time merchant & category learning engine',
  'Subscription renewal radar & calendar alerts',
  'Encrypted CSV & JSON full financial ledger exports',
  'One-time payment · Zero auto-renew mandates',
]

const YEARLY_FEATURES = [
  'Everything in Monthly — full unrestricted suite',
  'Billed once a year instead of every month',
  'Works out to just ₹1.00 a day (Save 17%)',
  'Nothing to renew or re-authorise for 365 days',
  'Instant plan queueing — stack another year without losing days',
  'Priority support & early access to new banks',
]

export default function PricingPage() {
  const navigate = useNavigate()
  const { user, profile, updateSubscriptionStatus, daysLeft, openAuthModal, refreshProfile } = useAuth()
  const { showToast } = useToast()

  const [selectedPlan, setSelectedPlan] = useState<'monthly' | 'annual'>('annual')
  const [paymentMethod, setPaymentMethod] = useState<'razorpay' | 'promo'>('razorpay')
  const [promoCode, setPromoCode] = useState('')
  const [processing, setProcessing] = useState(false)

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

  const isOnYearly = isActive && profile?.subscription_plan_type !== 'monthly'
  const isOnMonthly = isActive && profile?.subscription_plan_type === 'monthly'
  const canBuy = !hasQueuedPlan

  const planName = selectedPlan === 'annual' ? 'Yearly' : 'Monthly'
  const planPrice = selectedPlan === 'annual' ? '365' : '31'
  const planSub = selectedPlan === 'annual' ? 'One payment · 365 days of full access' : 'One payment · 30 days of full access'

  useEffect(() => {
    setPageMeta({
      title: `Pricing & Plans | ${APP_CONFIG.APP_NAME}`,
      description: 'Intrack costs ₹31 for 30 days or ₹365 for a full year — one-time payments, so nothing auto-renews and no mandate touches your card. Free 7-day trial, no card required.',
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
      showToast('Failed to load Razorpay SDK. Check your internet.', 'error')
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
      const response = await fetch('/api/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          planType: selectedPlan,
        })
      })
      const orderData = await response.json()
      if (response.status === 409) {
        showToast(orderData.error || 'You already have a plan queued.', 'warning')
        setProcessing(false)
        return
      }
      if (!response.ok || orderData.error) throw new Error(orderData.error || 'Could not initiate payment order')

      const clientKey = import.meta.env.VITE_RAZORPAY_KEY_ID
      if (!clientKey || !clientKey.startsWith('rzp_')) {
        throw new Error('Payments are not configured on this deployment. Please contact support — you have not been charged.')
      }

      const options = {
        key: clientKey,
        amount: orderData.amount,
        currency: orderData.currency,
        name: APP_CONFIG.APP_NAME,
        description: `Upgrade to ${planName} Plan`,
        order_id: orderData.id,
        prefill: { name: profile?.full_name || '', email: user.email || '' },
        theme: { color: '#0e7a5d' },
        handler: async (paymentResponse: Record<string, unknown>) => {
          setProcessing(true)
          try {
            const { data: { session: verifySession } } = await supabase.auth.getSession()
            if (!verifySession?.access_token) throw new Error('Your session expired. Please log in again.')
            const verifyResponse = await fetch('/api/verify-payment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${verifySession.access_token}` },
              body: JSON.stringify({ ...paymentResponse, planType: selectedPlan })
            })
            const verifyData = await verifyResponse.json()
            if (!verifyResponse.ok || verifyData.error) throw new Error(verifyData.error || 'Payment verification failed')

            if (verifyData.outcome === 'queued' || verifyData.outcome === 'queue_extended') {
              await refreshProfile()
              showToast('Payment received. Your new plan starts when your current one ends.', 'success')
              navigate('/payment-success', {
                state: {
                  planName,
                  queued: true,
                  startsAt: verifyData.pendingActivatesAt,
                },
              })
            } else {
              await updateSubscriptionStatus('active', selectedPlan)
              showToast(
                verifyData.outcome === 'already_applied'
                  ? `Payment already confirmed — your ${planName} plan is active.`
                  : `👑 Payment Successful! ${planName} features unlocked.`,
                'success'
              )
              navigate('/payment-success', { state: { planName, expiresAt: verifyData.expiresAt } })
            }
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err)
            showToast(`Verification Failed: ${message}`, 'error')
          } finally {
            setProcessing(false)
          }
        },
        modal: { ondismiss: () => setProcessing(false) },
      }
      const RazorpayCtor = window.Razorpay
      if (!RazorpayCtor) {
        showToast('Razorpay failed to initialize.', 'error')
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

  // ── Render ────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-8 animate-fade-in text-sb-ink max-w-6xl mx-auto overflow-x-hidden">

        {/* ── LUXURY HEADER CARD ──────────────────────────────── */}
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
              Autonomous Finance · Sovereign Pricing
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
                    <span>Yearly (₹1 / day)</span>
                    <span className="text-[10px] uppercase font-mono font-bold bg-brand-500/15 text-brand-700 px-2 py-0.5 rounded-md border border-brand-500/30">
                      Save 17%
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
                  <span className="relative z-10">Monthly (₹31 / mo)</span>
                </button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* ── STATUS BANNERS ──────────────────────────────────── */}
        <div className="space-y-3">
          {isTrial && daysLeft > 0 && (
            <div className="rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-surface-1 border border-brand-500/30 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-sb-ink">
                    Trial Active — <span className="font-mono text-amber-600">{daysLeft} day{daysLeft !== 1 ? 's' : ''}</span> remaining
                  </p>
                  <p className="text-xs text-sb-ink-secondary mt-0.5">
                    Full access to automated tracking is currently active. Pick a plan below to keep uninterrupted access.
                  </p>
                </div>
              </div>
              <span className="text-xs px-3 py-1 rounded-full whitespace-nowrap shrink-0 bg-amber-500/10 text-amber-700 border border-amber-500/25 font-bold uppercase tracking-wider">
                Trial Access
              </span>
            </div>
          )}

          {neverSubscribed && (
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
              {!user ? (
                <button
                  onClick={() => openAuthModal('/pricing', 'signup')}
                  className="sb-btn-primary w-full sm:w-auto justify-center border-0 cursor-pointer shrink-0 py-2.5 px-4 text-xs font-bold"
                >
                  Start free trial <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </button>
              ) : (
                <span className="text-xs px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 bg-brand-500/10 text-brand-700 border border-brand-500/20 font-bold uppercase tracking-wider">
                  No card required
                </span>
              )}
            </div>
          )}

          {(isExpired || isCancelled) && (
            <div className="rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-surface-1 border border-amber-500/30 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-600 shrink-0">
                  <PauseCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-bold text-sb-ink">
                    {isTrialExpired
                      ? 'Your free trial has ended'
                      : isSubExpired
                      ? 'Your subscription period has ended'
                      : 'Your plan is currently inactive'}
                  </p>
                  <p className="text-xs text-sb-ink-secondary mt-0.5">
                    Renew anytime to instantly restore automated inbox scans, dynamic budgets, and recurring tracking.
                  </p>
                </div>
              </div>
              <span className="text-xs px-3 py-1 rounded-full whitespace-nowrap shrink-0 bg-amber-500/10 text-amber-700 border border-amber-500/20 font-bold uppercase tracking-wider">
                Paused
              </span>
            </div>
          )}

          {isActive && (
            <div className="rounded-2xl p-4 sm:p-5 flex items-center gap-3 bg-surface-1 border border-brand-500/30 shadow-sm">
              <div className="w-9 h-9 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <p className="text-sm font-bold text-sb-ink">
                You are on the <span className="text-brand-600">{profile?.subscription_plan_type === 'monthly' ? 'Monthly' : 'Yearly'} Plan</span> — all automation systems, AI parsing, and ledger sync are fully active.
              </p>
            </div>
          )}

          {profile?.pending_plan_type && (
            <div role="status" className="rounded-2xl border border-brand-500/30 bg-surface-1 p-4 sm:p-5 flex items-center gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 shrink-0">
                <Calendar className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-sb-ink">
                  {profile.pending_plan_type === 'annual' ? 'Annual' : 'Monthly'} Plan Queued
                </p>
                <p className="text-xs text-sb-ink-secondary mt-0.5">
                  Already paid for. It starts automatically on{' '}
                  <span className="font-semibold text-brand-600">
                    {profile.pending_activates_at
                      ? formatDate(profile.pending_activates_at)
                      : "your current plan's expiry date"}
                  </span>
                  . Zero overlap, zero lost days.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── SYMMETRICAL LUXURY PRICING CARDS ────────────────── */}
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
            <div className="absolute top-0 right-0 bg-brand-500 text-white text-[11px] font-extrabold uppercase tracking-widest px-3.5 py-1.5 rounded-bl-2xl rounded-tr-2xl shadow-sm">
              Recommended · Save 17%
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
                    <span className="font-extrabold text-4xl sm:text-5xl text-sb-ink tracking-tight tnum">₹365</span>
                    <span className="text-xs sm:text-sm text-sb-ink-muted">/ year</span>
                  </div>
                  <p className="text-[11px] text-sb-ink-muted mt-1 font-medium">
                    One-time payment · 365 days of access
                  </p>
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full bg-brand-500/15 text-brand-700 border border-brand-500/30 font-bold font-mono shrink-0">
                  ≈ ₹1.00 / day
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
              {isOnYearly && profile?.subscription_expires_at && (
                <p className="text-center text-xs font-bold text-brand-600">
                  Your active plan until {formatDate(profile.subscription_expires_at)}
                </p>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleSelectPlan('annual')
                }}
                disabled={!canBuy}
                className="sb-btn-primary w-full justify-center cursor-pointer border-0 text-sm sm:text-base py-3.5 shadow-md hover:shadow-lg transition-all"
                style={{ opacity: canBuy ? 1 : 0.5 }}
              >
                {!canBuy
                  ? 'A plan is already queued'
                  : isOnYearly
                  ? 'Renew for another year'
                  : isActive && profile?.subscription_plan_type === 'monthly'
                  ? 'Upgrade to Yearly (₹365)'
                  : 'Get Yearly · ₹365'}
              </button>
              {isOnYearly && canBuy && (
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
                    <span className="font-extrabold text-4xl sm:text-5xl text-sb-ink tracking-tight tnum">₹31</span>
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
              {isOnMonthly && profile?.subscription_expires_at && (
                <p className="text-center text-xs font-bold text-brand-600">
                  Your active plan until {formatDate(profile.subscription_expires_at)}
                </p>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleSelectPlan('monthly')
                }}
                disabled={!canBuy}
                className={cn(
                  'w-full justify-center rounded-xl py-3.5 text-sm sm:text-base font-semibold border cursor-pointer transition-all',
                  selectedPlan === 'monthly'
                    ? 'sb-btn-primary border-0'
                    : 'sb-btn-secondary'
                )}
                style={{ opacity: canBuy ? 1 : 0.5 }}
              >
                {!canBuy
                  ? 'A plan is already queued'
                  : isOnMonthly
                  ? 'Renew for another month'
                  : 'Choose Monthly · ₹31'}
              </button>
            </div>
          </div>

        </div>

        {/* ── COUPON CODE DISCLOSURE ──────────────────────────── */}
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

        {/* ── RETURN ON INVESTMENT & COST COMPARISON VISUAL ────── */}
        <CostToValueVisual />

        {/* ── TRUST & SECURITY TELEMETRY ──────────────────────── */}
        <TrustTelemetryRibbon />

        {/* ── CHECKOUT CARD ──────────────────────────────────── */}
        <div id="checkout-section" className="max-w-2xl mx-auto w-full pt-4">
          {!user ? (
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
          ) : (
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
                  <span>Pay Securely (Razorpay)</span>
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

                {/* ── Razorpay Flow ─────────────────────────────── */}
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
                            'py-3 rounded-xl text-xs font-semibold cursor-pointer transition-all bg-transparent border',
                            selectedPlan === plan
                              ? 'text-brand-700 border-brand-500 bg-brand-500/5 font-bold shadow-sm'
                              : 'text-sb-ink-secondary border-sb-hairline hover:bg-surface-2'
                          )}
                        >
                          {plan === 'annual' ? 'Yearly — ₹365 / yr' : 'Monthly — ₹31 / mo'}
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
                      className="sb-btn-primary w-full cursor-pointer border-0 py-3.5 text-base font-bold shadow-md hover:shadow-lg transition-all"
                      style={{ opacity: processing || hasQueuedPlan ? 0.6 : 1 }}
                    >
                      {hasQueuedPlan
                        ? 'A plan is already queued'
                        : processing
                        ? 'Opening secure Razorpay gateway…'
                        : `Pay ₹${planPrice} & Activate ${planName}`}
                    </button>

                    <p className="text-[11px] text-center text-sb-ink-muted">
                      🔒 Bank-grade 256-bit encryption · Card details go to Razorpay, never stored on our servers
                    </p>
                  </div>
                )}

                {/* ── Promo Flow ────────────────────────────────── */}
                {paymentMethod === 'promo' && (
                  <div className="space-y-6">
                    <div className="rounded-2xl p-4 bg-brand-500/5 border border-brand-500/20 space-y-1.5">
                      <p className="text-xs text-sb-ink font-bold flex items-center gap-1.5">
                        <Ticket className="w-4 h-4 text-brand-600" />
                        <span>Exclusive Invitation or Promo Coupon</span>
                      </p>
                      <p className="text-xs text-sb-ink-secondary leading-relaxed">
                        Enter your promotional coupon below to instantly unlock full access to automated tracking and insight tools.
                      </p>
                      <p className="text-[11px] text-sb-ink-muted pt-1">
                        * Promotional codes apply to eligible first-time accounts (limit 1 code per account).
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
          )}

          {/* Refund policy note */}
          <p className="text-xs text-center mt-5 text-sb-ink-muted">
            Questions?{' '}
            <Link to="/support" className="text-brand-600 no-underline hover:underline font-bold">Contact support</Link> ·{' '}
            <Link to="/refund-policy" className="text-brand-600 no-underline hover:underline font-bold">Refund policy</Link> — 100% full refund available within 7 days.
          </p>
        </div>

        {/* ── THE INTRACK STANDARD ────────────────────────────── */}
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

        {/* ── PRICING FAQ ACCORDION ───────────────────────────── */}
        <PricingFaqAccordion />

      </div>
    </AppLayout>
  )
}
