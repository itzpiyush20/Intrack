// ============================================
// PricingPage — Supabaze Design Language version
// Premium layout with glowing grids, dual-tone wordmarks, and brand showcases
// ============================================

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppLayout from '@/layouts/AppLayout'
import { useAuth, useToast } from '@/context'
import { motion } from 'framer-motion'
import { useScrollReveal } from '@/hooks'
import { Card } from '@/components/ui'
import { supabase } from '@/services/supabase'
import { formatDate, cn } from '@/utils'
import { setPageMeta } from '@/utils/seo'
import { APP_CONFIG } from '@/constants'

// ── Feature lists for different subscription tiers ───────────
// Kept deliberately accurate against what the code actually does.
//
// These lists used to advertise "Encrypted CSV & JSON data export",
// "Subscription renewal tracking" and "Priority support" as YEARLY-only. No
// such gate exists anywhere: every subscription_plan_type check in the app is
// a badge label or an upsell button, and ProtectedRoute gates on
// isSubscriptionActive alone. A monthly subscriber already has all of it, so
// the yearly card was selling features the monthly plan silently included.
// There is no free tier. The owner settled this on 2026-09-04: after the
// 7-day trial, access stops unless the user pays. This list used to promise
// that manual entry, budgets and one daily scan stayed free afterwards, which
// ProtectedRoute has never allowed — it sends every user without an active
// subscription to this page. The card now describes the trial, which is the
// only thing here that costs nothing.
const TRIAL_FEATURES = [
  'Every feature, for 7 days',
  'Manual expense & income entry',
  'Budgets, categories and insights',
  'No card required to start',
]

const MONTHLY_FEATURES = [
  'Two inbox scans a day, at least 4 hours apart',
  'Everything the trial had, without the 7-day limit',
  'Real-time category learning engine',
  'Subscription renewal tracking & calendar',
  'Encrypted CSV & JSON data export',
]

const YEARLY_FEATURES = [
  'Everything in Monthly — the same features',
  'Billed once a year instead of every month',
  'Works out at ₹1 a day',
  'Nothing to renew or re-authorise for 12 months',
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
  // Never subscribed (signed-out visitor, or a signed-in account that hasn't started a trial yet) —
  // this is a prospective customer, not someone who lost access. Show them the trial offer, not a lock screen.
  const neverSubscribed = !user || status === 'free' || !status
  const isCancelled = status === 'cancelled'

  // A plan already bought and waiting for the current one to end. The server
  // refuses a second purchase in this state (409), so the buttons come off too.
  const hasQueuedPlan = !!profile?.pending_plan_type

  const isActiveActive = status === 'active' && daysLeft > 0
  const isTrialActive = status === 'trial' && daysLeft > 0

  const isActive  = isActiveActive
  const isTrial   = isTrialActive

  // WHICH PLAN they hold. Deliberately not the same question as whether they
  // may buy, which is `canBuy` below.
  //
  // These were one flag — `isPro` — and merging them locked annual subscribers
  // out of paying: it hid the entire checkout section AND disabled the yearly
  // button, so a customer on the yearly plan had no way to buy another year
  // until their access lapsed. apply_plan_purchase() has queued renewals since
  // 035 (buying again returns outcome 'queued' and the new plan starts the day
  // the current one ends), and monthly subscribers could already reach it.
  // Only annual subscribers, the ones most worth renewing, could not.
  const isOnYearly  = isActive && profile?.subscription_plan_type !== 'monthly'
  const isOnMonthly = isActive && profile?.subscription_plan_type === 'monthly'

  // The one thing that genuinely stops a purchase: the server refuses a second
  // one while a plan is already queued (create-order.ts returns 409), because
  // stacking two would take money for time the customer cannot reach for up to
  // a year.
  const canBuy = !hasQueuedPlan

  const planName  = selectedPlan === 'annual' ? 'Yearly' : 'Monthly'
  const planPrice = selectedPlan === 'annual' ? '365' : '31'
  // Both plans are ONE-TIME payments. create-order.ts calls orders.create, not
  // the Subscriptions API — there is no mandate, no plan id, and nothing that
  // charges a card a second time. Access simply ends on the expiry date. The
  // copy used to say "Billed every month · cancel anytime", which invented a
  // recurring charge that does not exist and a cancellation there is nothing to
  // perform.
  const planSub   = selectedPlan === 'annual' ? 'One payment · 365 days of access' : 'One payment · 30 days of access'

  useEffect(() => {
    setPageMeta({
      title: `Pricing & Plans | ${APP_CONFIG.APP_NAME}`,
      description: 'Intrack costs ₹31 for 30 days or ₹365 for a year — one-time payments, so nothing auto-renews and no mandate touches your card. Free 7-day trial, no card required.',
      canonicalPath: '/pricing',
    })
  }, [])

  useEffect(() => {
    if (isActive && profile?.subscription_plan_type === 'monthly') {
      setSelectedPlan('annual')
    }
  }, [isActive, profile])

  // ── Razorpay ──────────────────────────────────────────────────
  const loadRazorpayScript = () =>
    new Promise((resolve) => {
      if ((window as any).Razorpay) return resolve(true)
      const existingScript = document.querySelector('script[src="https://checkout.razorpay.com/v1/checkout.js"]')
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(true))
        existingScript.addEventListener('error', () => resolve(false))
        return
      }
      const script = document.createElement('script')
      script.src = 'https://checkout.razorpay.com/v1/checkout.js'
      script.async = true
      script.onload  = () => resolve(true)
      script.onerror = () => resolve(false)
      document.body.appendChild(script)
    })

  const handleRazorpayCheckout = async () => {
    if (!user) { showToast('Please log in to upgrade your plan.', 'warning'); openAuthModal('/pricing'); return }
    setProcessing(true)
    const scriptLoaded = await loadRazorpayScript()
    if (!scriptLoaded) { showToast('Failed to load Razorpay SDK. Check your internet.', 'error'); setProcessing(false); return }
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) { showToast('Your session expired. Please log in again.', 'error'); setProcessing(false); return }
      const response  = await fetch('/api/create-order', {
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
      // The server refuses a purchase while a plan is queued. This is an
      // expected answer, not a checkout fault, so it must not be prefixed as one.
      if (response.status === 409) {
        showToast(orderData.error || 'You already have a plan queued.', 'warning')
        setProcessing(false)
        return
      }
      if (!response.ok || orderData.error) throw new Error(orderData.error || 'Could not initiate payment order')

      // A missing or malformed key used to fall back to 'rzp_test_placeholder',
      // so checkout opened and then failed inside Razorpay's iframe with an
      // error the customer could neither understand nor act on. Fail here
      // instead, where the message can say what is actually wrong.
      const clientKey = import.meta.env.VITE_RAZORPAY_KEY_ID
      if (!clientKey || !clientKey.startsWith('rzp_')) {
        throw new Error('Payments are not configured on this deployment. Please contact support — you have not been charged.')
      }

      const options = {
        key: clientKey,
        amount: orderData.amount, currency: orderData.currency,
        // The merchant name on the Razorpay sheet and on the receipt the
        // customer keeps. Sourced from the constant so a rename can never leave
        // the old brand printed on someone's payment record.
        name: APP_CONFIG.APP_NAME, description: `Upgrade to ${planName} Plan`,
        order_id: orderData.id,
        prefill: { name: profile?.full_name || '', email: user.email || '' },
        theme: { color: '#0e7a5d' },
        handler: async (paymentResponse: any) => {
          setProcessing(true)
          try {
            const { data: { session: verifySession } } = await supabase.auth.getSession()
            if (!verifySession?.access_token) throw new Error('Your session expired. Please log in again.')
            const verifyResponse = await fetch('/api/verify-payment', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${verifySession.access_token}` }, body: JSON.stringify({ ...paymentResponse, planType: selectedPlan }) })
            const verifyData = await verifyResponse.json()
            if (!verifyResponse.ok || verifyData.error) throw new Error(verifyData.error || 'Payment verification failed')
            
            // Only an immediate activation may touch local subscription state.
            // A 'queued' outcome means the customer paid for a plan that starts
            // when the current one ends; marking it active now would apply the
            // change the queue exists to defer.
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
              // 'already_applied' means this order was credited earlier — the
              // webhook usually beats the browser here. The plan IS active, so
              // this is still a success, but announcing a fresh unlock for a
              // second delivery of the same payment reads as a double charge.
              showToast(
                verifyData.outcome === 'already_applied'
                  ? `Payment already confirmed — your ${planName} plan is active.`
                  : `👑 Payment Successful! ${planName} features unlocked.`,
                'success'
              )
              navigate('/payment-success', { state: { planName, expiresAt: verifyData.expiresAt } })
            }
          } catch (err: any) { showToast(`Verification Failed: ${err.message}`, 'error') }
          finally { setProcessing(false) }
        },
        modal: { ondismiss: () => setProcessing(false) },
      }
      const rzp = new (window as any).Razorpay(options)
      rzp.on('payment.failed', (response: any) => {
        showToast(`Payment Failed: ${response.error.description || 'Unknown error'}`, 'error')
        setProcessing(false)
      })
      rzp.open()
    } catch (err: any) { showToast(`Checkout error: ${err.message}`, 'error'); setProcessing(false) }
  }

  const handleSelectPlan = (plan: 'monthly' | 'annual') => {
    if (!user) {
      showToast('Please sign in or create an account to proceed.', 'warning')
      openAuthModal('/pricing')
      return
    }
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

  // ── Promo code ────────────────────────────────────────────────
  // Redemption happens entirely on the server. The codes used to be listed in
  // VITE_PROMO_CODES, which ships inside the public JavaScript bundle, so any
  // visitor could read them; and the grant only reached localStorage, so it
  // disappeared on the user's next device. Both halves now live in
  // api/redeem-promo.ts.
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

      // The grant is already in the database; pull it into the app's state.
      await refreshProfile()
      const days = result.durationDays
      showToast(`👑 ${days} day${days === 1 ? '' : 's'} of full access unlocked!`, 'success')
      navigate('/dashboard')
    } catch (err: any) {
      showToast('Coupon error: ' + err.message, 'error')
    } finally {
      setProcessing(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────
  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in" style={{ fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>

        {/* ── HEADER CARD ──────────────────────────────────── */}
        <motion.div
          className="relative rounded-3xl overflow-hidden sb-card-light p-5 sm:p-8 md:p-10"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="relative z-10 flex flex-col items-center text-center space-y-4 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold tracking-wide">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Plans & Pricing
            </div>
            
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-sb-ink select-none">
              Simple, <span className="text-sb-primary">honest pricing</span>
            </h1>
            <p className="text-xs sm:text-sm text-sb-ink-secondary leading-relaxed">
              The subscription tracker that isn't a subscription. Pay once for a second daily scan, a categoriser that learns your merchants, and encrypted exports — then nothing renews, and we never store your card.
            </p>
          </div>
        </motion.div>

        {/* ── STATUS BANNERS ──────────────────────────────────── */}
        <div className="space-y-3 animate-fade-in">
          {isTrial && daysLeft > 0 && (
            <div className="rounded-3xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-surface-1 border border-border-subtle shadow-md">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⏳</span>
                <div>
                  <p className="text-sm font-bold text-sb-ink">Trial Active — {daysLeft} day{daysLeft !== 1 ? 's' : ''} remaining</p>
                  <p className="text-xs text-zinc-400 font-medium mt-0.5">Full access to premium features active. Upgrade to keep two inbox scans a day instead of one.</p>
                </div>
              </div>
              <span className="text-xs px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 bg-amber-500/10 text-amber-400 border border-amber-500/20 font-bold uppercase tracking-wider">Trial Access</span>
            </div>
          )}

          {neverSubscribed && (
            <div className="rounded-3xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-surface-1 border border-border-subtle shadow-md">
              <div className="flex items-center gap-3">
                <span className="text-2xl">✨</span>
                <div>
                  <p className="text-sm font-bold text-sb-ink">Start your 7-day free trial</p>
                  <p className="text-xs text-zinc-400 font-medium mt-0.5">
                    Try two daily scans, budgets, and insights free for 7 days. No card required.
                  </p>
                </div>
              </div>
              {!user && (
                <span className="text-xs px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)] border border-[var(--status-positive-border)] font-bold uppercase tracking-wider">No card needed</span>
              )}
            </div>
          )}

          {(isExpired || isCancelled) && (
            <div className="rounded-3xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-surface-1 border border-border-subtle shadow-md">
              <div className="flex items-center gap-3">
                <span className="text-2xl">⏸️</span>
                <div>
                  <p className="text-sm font-bold text-sb-ink">
                    {isTrialExpired
                      ? 'Your trial has ended'
                      : isSubExpired
                      ? 'Your subscription has ended'
                      : 'Your plan is inactive'}
                  </p>
                  <p className="text-xs text-zinc-400 font-medium mt-0.5">
                    {isCancelled
                      ? 'Resubscribe to turn the second daily scan, budgets, and priority tracking back on.'
                      : 'Renew to restore the second daily scan, budgets, and priority tracking.'}
                  </p>
                </div>
              </div>
              <span className="text-xs px-3 py-1.5 rounded-full whitespace-nowrap shrink-0 bg-[var(--status-warning-subtle)] text-[var(--status-warning-text)] border border-[var(--status-warning-border)] font-bold uppercase tracking-wider">Inactive</span>
            </div>
          )}

          {isActive && (
            <div className="rounded-3xl p-5 flex items-center gap-3 bg-surface-1 border border-border-subtle shadow-md">
              <span className="text-2xl">✅</span>
              <p className="text-sm font-bold text-emerald-400">You are on the {profile?.subscription_plan_type === 'monthly' ? 'Monthly' : 'Yearly'} Plan — all automation and sync systems are fully active.</p>
            </div>
          )}

          {profile?.pending_plan_type && (
            <div role="status" className="rounded-2xl border border-border-subtle bg-surface-1 p-4 text-sm">
              <p className="font-semibold text-zinc-200">
                {profile.pending_plan_type === 'annual' ? 'Annual' : 'Monthly'} plan queued
              </p>
              <p className="text-xs text-zinc-500 mt-0.5">
                Already paid for. It starts automatically on{' '}
                {profile.pending_activates_at
                  ? formatDate(profile.pending_activates_at)
                  : "your current plan's expiry"}
                , when your current plan ends. You can buy again once it begins.
              </p>
            </div>
          )}
        </div>

        {/* ── PRICING CARDS ───────────────────────────────────── */}
        <div className="py-6 animate-fade-in">
          <div className="grid md:grid-cols-2 lg:grid-cols-4 md:auto-rows-fr gap-6 items-stretch">

            {/* ── Trial: 7 days, then pay ───────────────────────── */}
            <Card
              hoverable
              className="p-8 flex flex-col relative group"
            >
              <div className="mb-6">
                <span className="inline-flex items-center bg-surface-2 border border-border-subtle px-2.5 py-0.5 rounded-full text-xs font-semibold text-zinc-400">Free Trial</span>
                <h2 className="text-lg font-bold text-sb-ink mt-4">Trial</h2>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="font-extrabold text-4xl text-sb-ink tracking-tight">₹0</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 font-medium">7 days of full access · no card required</p>
              </div>

              <ul className="space-y-3.5 flex-1 border-t border-border-subtle pt-5">
                {TRIAL_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <span className="text-emerald-400 shrink-0 text-sm font-bold">✓</span>
                    <span className="text-xs text-zinc-400 font-medium">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                {!user ? (
                  <button
                    onClick={() => openAuthModal('/pricing', 'signup')}
                    className="w-full justify-center rounded-xl py-3 font-semibold text-xs border border-zinc-700 bg-surface-2 hover:bg-zinc-800 text-zinc-300 transition-all active:scale-98 shadow-sm cursor-pointer"
                  >
                    Start Free Trial
                  </button>
                ) : (
                  <button
                    disabled
                    className="w-full justify-center rounded-xl py-3 font-semibold text-xs border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 cursor-not-allowed"
                  >
                    {neverSubscribed ? 'Trial available on signup' : 'Included with your account'}
                  </button>
                )}
              </div>
            </Card>

            {/* ── Standard: Monthly ─────────────────────────────── */}
            <Card
              hoverable
              className={cn("p-8 flex flex-col relative group transition-all", selectedPlan === 'monthly' ? "border-emerald-400 border-2 shadow-lg" : "border-border-subtle")}
              onClick={() => handleSelectPlan('monthly')}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-bold text-sb-ink">Monthly</h2>
                <input type="radio" readOnly checked={selectedPlan === 'monthly'} className="h-5 w-5 cursor-pointer accent-[#3ecf8e]" />
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="font-extrabold text-4xl text-sb-ink tracking-tight">₹31</span>
                  <span className="text-xs text-zinc-400">/month</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 font-medium">One payment · 30 days · no auto-renewal</p>
              </div>

              <ul className="space-y-3.5 flex-1 border-t border-border-subtle pt-5">
                {MONTHLY_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <span className="text-emerald-400 shrink-0 text-sm font-bold">✓</span>
                    <span className="text-xs text-zinc-400 font-medium">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 space-y-3">
                {/* Same change as the yearly card: holding this plan is a note,
                    not a disabled button. A monthly subscriber buying again
                    queues the next month behind the running one. */}
                {isOnMonthly && profile?.subscription_expires_at && (
                  <p className="text-center text-xs font-bold text-emerald-400">
                    Your current plan · active until {formatDate(profile.subscription_expires_at)}
                  </p>
                )}
                <button
                  onClick={() => canBuy && handleSelectPlan('monthly')}
                  disabled={!canBuy}
                  className={`w-full justify-center rounded-xl py-3 font-semibold text-xs border ${
                    !canBuy
                      ? 'border-zinc-800 bg-zinc-900/50 text-zinc-500 cursor-not-allowed'
                      : 'border-zinc-700 bg-surface-2 hover:bg-zinc-800 text-zinc-300 transition-all active:scale-98 shadow-sm cursor-pointer'
                  }`}
                >
                  {!canBuy
                    ? 'A plan is already queued'
                    : isOnMonthly
                    ? 'Renew for another month'
                    : 'Choose Monthly'}
                </button>
              </div>
            </Card>

            {/* ── Featured: Annual ── */}
            <Card
              hoverable
              className={cn("p-8 flex flex-col relative overflow-hidden group transition-all", selectedPlan === 'annual' ? "border-emerald-400 border-2 shadow-lg" : "border-border-subtle")}
              onClick={() => handleSelectPlan('annual')}
            >
              {/* Best value badge */}
              <div className="absolute top-0 right-0 sb-pill-tag-green text-xs font-extrabold uppercase tracking-widest px-4 py-2 rounded-bl-2xl rounded-tr-2xl">
                Best Value · ₹1 a day
              </div>

              <div className="flex items-center justify-between mb-6 mt-2">
                <h2 className="text-lg font-bold text-sb-ink">Yearly</h2>
                <input type="radio" readOnly checked={selectedPlan === 'annual'} className="h-5 w-5 cursor-pointer accent-[#3ecf8e]" />
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="font-extrabold text-4xl text-sb-ink tracking-tight">₹365</span>
                  <span className="text-xs text-zinc-400">/year</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">₹1 per day</span>
                  <span className="text-xs text-zinc-400 font-medium">One payment · 365 days</span>
                </div>
              </div>

              <ul className="space-y-3.5 flex-1 border-t border-border-subtle pt-5">
                {YEARLY_FEATURES.map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <span className="text-emerald-400 shrink-0 text-sm font-bold">✓</span>
                    <span className="text-xs text-zinc-300 font-medium">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8 space-y-3">
                {/* Holding the yearly plan is now a NOTE, not a locked button.
                    It used to be the button itself, which is what left an
                    annual subscriber with no way to pay again. */}
                {isOnYearly && profile?.subscription_expires_at && (
                  <p className="text-center text-xs font-bold text-emerald-400">
                    Your current plan · active until {formatDate(profile.subscription_expires_at)}
                  </p>
                )}
                <button
                  onClick={() => handleSelectPlan('annual')}
                  disabled={!canBuy}
                  className="sb-btn-primary w-full cursor-pointer border-0"
                  style={{ opacity: canBuy ? 1 : 0.5 }}
                >
                  {!canBuy
                    ? 'A plan is already queued'
                    : isOnYearly
                    ? 'Renew for another year'
                    : isActive && profile?.subscription_plan_type === 'monthly'
                    ? 'Upgrade to Yearly'
                    : 'Get Yearly'}
                </button>
                {isOnYearly && canBuy && (
                  <p className="text-xs text-center text-zinc-500 font-medium">
                    Renewing now adds 365 days to the end of your current plan — you lose nothing.
                  </p>
                )}
                <p className="text-xs text-center text-zinc-500 font-medium">Payments handled by Razorpay · encrypted in transit</p>
              </div>
            </Card>

            {/* ── Promo / Coupon ────────────────────────────────── */}
            <Card
              hoverable
              className="p-8 flex flex-col relative group"
            >
              <div className="mb-6">
                <span className="inline-flex items-center bg-surface-2 border border-border-subtle px-2.5 py-0.5 rounded-full text-xs font-semibold text-zinc-400">Special Access</span>
                <h2 className="text-lg font-bold text-sb-ink mt-4">Coupon Code</h2>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="font-extrabold text-4xl text-sb-ink tracking-tight">Free</span>
                </div>
                <p className="text-xs text-zinc-400 mt-1 font-medium">Free access with a valid coupon</p>
              </div>

              <ul className="space-y-3.5 flex-1 border-t border-border-subtle pt-5">
                {['Full access for the coupon\'s duration', 'Usually one free month', 'No payment card required', 'Instant dashboard activation'].map((f) => (
                  <li key={f} className="flex items-start gap-3">
                    <span className="text-emerald-400 shrink-0 text-sm font-bold">✓</span>
                    <span className="text-xs text-zinc-400 font-medium">{f}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-8">
                <button
                  onClick={handleSelectPromo}
                  className="w-full justify-center rounded-xl py-3 font-semibold text-xs border border-zinc-700 bg-surface-2 hover:bg-zinc-800 text-zinc-300 transition-all active:scale-98 shadow-sm cursor-pointer"
                >
                  Enter Coupon Code
                </button>
              </div>
            </Card>

          </div>
        </div>

        {/* ── CHECKOUT SECTION ─────────────────────────────────
            Rendered for everyone, including subscribers on the yearly plan.
            This was gated on `!isOnYearly`, which meant the only customers who had
            already committed to a full year were the only ones with no way to
            give money again — the checkout simply did not exist on their page.
            A queued purchase is refused by create-order.ts, not by hiding the
            form, so `hasQueuedPlan` is the only state that disables buying. */}
        {(
          <div id="checkout-section" className="max-w-2xl mx-auto pb-12 w-full animate-fade-in">
            {!user ? (
              <Card className="rounded-3xl shadow-md p-8 text-center space-y-6">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-3xl shadow-sm">
                  🔒
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-bold text-sb-ink">Sign in to complete checkout</h3>
                  <p className="text-xs text-zinc-400 leading-relaxed font-medium max-w-sm mx-auto">
                    To secure your billing and unlock the second daily scan, please log in or create an account first.
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    onClick={() => openAuthModal('/pricing', 'login')}
                    className="sb-btn-primary w-full sm:w-auto cursor-pointer border-0"
                  >
                    Sign In
                  </button>
                  <button
                    onClick={() => openAuthModal('/pricing', 'signup')}
                    className="sb-btn-secondary w-full sm:w-auto cursor-pointer"
                  >
                    Create Account
                  </button>
                </div>
                <p className="text-xs text-zinc-500 font-semibold uppercase tracking-wider">
                  Checkout is handled by Razorpay · encrypted in transit
                </p>
              </Card>
            ) : (
              <Card noPadding className="rounded-3xl shadow-md overflow-hidden">

                {/* Tab switcher */}
                <div className="flex bg-surface-2/40 border-b border-border-subtle">
                  {([['razorpay', '💳 Pay Securely'], ['promo', '🎟️ Promo Code']] as const).map(([tab, label]) => (
                    <button
                      key={tab}
                      onClick={() => setPaymentMethod(tab)}
                      className={cn(
                        "flex-1 py-4 text-xs cursor-pointer transition-colors border-none bg-transparent font-bold border-b-2",
                        paymentMethod === tab
                          ? "text-emerald-400 border-emerald-400"
                          : "text-zinc-500 border-transparent hover:text-zinc-300"
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="p-8 space-y-6">

                  {/* ── Razorpay flow ─────────────────────────────── */}
                  {paymentMethod === 'razorpay' && (
                    <div className="space-y-6 animate-fade-in">
                      {/* Order summary card */}
                      <div className="rounded-2xl p-5 flex justify-between items-start bg-surface-2/40 border border-border-subtle/50">
                        <div>
                          <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Order Summary</p>
                          <p className="text-lg mt-2 font-extrabold text-sb-ink">{planName} Plan</p>
                          <p className="text-xs text-zinc-400 font-medium mt-0.5">{planSub}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-extrabold text-2xl text-sb-ink tracking-tight">₹{planPrice}</p>
                          <p className="text-xs text-zinc-500 font-bold uppercase tracking-wider">Total payable</p>
                        </div>
                      </div>

                      {/* Plan picker */}
                      <div className="flex gap-3">
                        {(['annual', 'monthly'] as const).map((plan) => (
                          <button
                            key={plan}
                            onClick={() => setSelectedPlan(plan)}
                            className={cn(
                              "flex-1 py-3.5 rounded-xl text-xs cursor-pointer transition-all bg-transparent font-bold border",
                              selectedPlan === plan
                                ? "text-emerald-400 border-emerald-400"
                                : "text-zinc-400 border-border-subtle hover:border-zinc-700 hover:text-zinc-200"
                            )}
                          >
                            {plan === 'annual' ? 'Annual — ₹365/yr' : 'Monthly — ₹31/mo'}
                          </button>
                        ))}
                      </div>

                      {/* Trust bar */}
                      <div className="rounded-2xl p-3 flex flex-wrap items-center justify-center gap-2 bg-surface-2/40 border border-border-subtle/50">
                        {['UPI', 'Debit/Credit Cards', 'NetBanking', 'Google Pay', 'PhonePe'].map((m) => (
                          <span key={m} className="text-xs px-3 py-1 rounded-full bg-surface-1 border border-border-subtle text-zinc-400 font-bold uppercase tracking-wider">{m}</span>
                        ))}
                      </div>

                      <button
                        onClick={handleRazorpayCheckout}
                        disabled={processing || hasQueuedPlan}
                        className="sb-btn-primary w-full cursor-pointer border-0"
                        style={{ opacity: processing || hasQueuedPlan ? 0.6 : 1 }}
                      >
                        {hasQueuedPlan
                          ? 'A plan is already queued'
                          : processing
                          ? 'Opening secure checkout…'
                          : `Pay ₹${planPrice} & Activate ${planName}`}
                      </button>

                      <p className="text-xs text-center text-zinc-500 font-semibold uppercase tracking-wider">
                        🔒 Encrypted in transit · Card details go to Razorpay, never to us
                      </p>
                    </div>
                  )}

                  {/* ── Promo flow ────────────────────────────────── */}
                  {paymentMethod === 'promo' && (
                    <div className="space-y-6 animate-fade-in">
                      <div className="rounded-2xl p-4 bg-emerald-500/5 border border-emerald-500/25">
                        <p className="text-xs text-zinc-400 leading-relaxed font-medium">
                          🎟️ <strong className="text-sb-ink">Have a promo code?</strong> Enter your exclusive code below to unlock a free month of all tracking, backup, and dashboard automation tools instantly.
                        </p>
                        {/* Stated up front rather than left to the refusal message.
                            Both conditions are permanent for an account, so someone
                            who has paid before can never make a coupon work — telling
                            them only after they have typed a code reads as a fault. */}
                        <p className="text-xs text-zinc-500 mt-2 leading-relaxed">
                          Coupons are for first-time users — accounts that have never had a paid plan — and one coupon per account.
                        </p>
                      </div>
                      <form onSubmit={(e) => { e.preventDefault(); handlePromoSimulator(); }} className="space-y-4">
                        <div className="flex flex-col gap-2">
                          <label className="text-xs block font-bold uppercase tracking-widest text-zinc-500">Promo Code</label>
                          <input
                            className="w-full bg-surface-2 border border-border-subtle/50 text-zinc-200 text-sm rounded-xl px-4 py-3 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand-400 transition-all uppercase font-semibold tracking-wider"
                            type="text"
                            placeholder="e.g. DHANVIP"
                            value={promoCode}
                            onChange={(e) => setPromoCode(e.target.value)}
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={processing || !promoCode.trim()}
                          className="sb-btn-primary w-full cursor-pointer border-0"
                          style={{ opacity: processing || !promoCode.trim() ? 0.5 : 1 }}
                        >
                          {processing ? 'Applying promo coupon…' : 'Redeem Code & Activate'}
                        </button>
                      </form>
                    </div>
                  )}

                </div>
              </Card>
            )}

            {/* Refund note */}
            <p className="text-xs text-center mt-6 text-zinc-500 font-medium">
              Have questions?{' '}
              <Link to="/support" className="text-emerald-400 no-underline hover:underline font-bold">Contact support</Link> ·{' '}
              <Link to="/refund-policy" className="text-emerald-400 no-underline hover:underline font-bold">Refund policy</Link> — refunds are available in limited cases, so please read it before paying.
            </p>
          </div>
        )}

        {/* ── BRAND PROMISE SECTION (THE INTRACK STANDARD) ───── */}
        <div className="border-t border-border-subtle py-16 animate-fade-in">
          <div className="mx-auto max-w-7xl">
            <div className="text-center max-w-xl mx-auto mb-12 space-y-4">
              <span className="inline-flex items-center bg-surface-1 border border-border-subtle px-3 py-1 rounded-full text-xs font-semibold text-zinc-400 uppercase tracking-widest">The Intrack Standard</span>
              <h2 className="text-3xl font-extrabold text-sb-ink tracking-tight">Built on Privacy & Local Isolation</h2>
              <p className="text-xs text-zinc-400 leading-relaxed font-medium">
                We believe your banking transcripts are private. Intrack is designed from the ground up to prevent data brokerage.
              </p>
            </div>
            
            <div className="grid md:grid-cols-3 md:auto-rows-fr gap-6">
              <div className="rounded-3xl bg-surface-1 border border-border-subtle p-6 space-y-4 shadow-md hover:shadow-lg transition-all h-full flex flex-col justify-start">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-xl text-emerald-400 shadow-sm animate-pulse shrink-0">
                  🔒
                </div>
                <h3 className="font-bold text-sb-ink text-base">Nothing stored, nothing sold</h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-medium flex-1">
                  Your inbox is read straight from Gmail — no server here holds a copy of your mail. To read an
                  alert accurately, its text passes through our server to Google's Gemini in real time — never
                  stored, never sold, never used to train anyone's model.
                </p>
              </div>

              <div className="rounded-3xl bg-surface-1 border border-border-subtle p-6 space-y-4 shadow-md hover:shadow-lg transition-all h-full flex flex-col justify-start">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-xl text-emerald-400 shadow-sm animate-pulse shrink-0">
                  🛡️
                </div>
                <h3 className="font-bold text-sb-ink text-base">Read-only mail scans</h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-medium flex-1">
                  Our Google authentication API permissions are strictly read-only. We have no authority to initiate transfers or drafts.
                </p>
              </div>

              <div className="rounded-3xl bg-surface-1 border border-border-subtle p-6 space-y-4 shadow-md hover:shadow-lg transition-all h-full flex flex-col justify-start">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-xl text-emerald-400 shadow-sm animate-pulse shrink-0">
                  🔑
                </div>
                <h3 className="font-bold text-sb-ink text-base">No passwords required</h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-medium flex-1">
                  We never prompt for net-banking passwords, PIN numbers, OTPs, or card security details. Your bank credentials remain isolated.
                </p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </AppLayout>
  )
}
