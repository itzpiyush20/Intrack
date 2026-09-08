// ============================================
// PricingPage — Modernist Clean Edition
// Incorporates official Intrack branding, live Razorpay checkout,
// dual public & member command center, and complete site requirements.
// ============================================

import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth, useToast } from '@/context'
import { supabase } from '@/services/supabase'
import { formatDate, cn } from '@/utils'
import { setPageMeta } from '@/utils/seo'
import { APP_CONFIG, PRICING } from '@/constants'
import BrandMark from '@/components/ui/BrandMark'
import {
  Loader2,
  CheckCircle2,
  Ticket,
  ArrowRight,
} from 'lucide-react'
import { cancelSubscription as cancelLegacySubscription } from '@/services'
import { createSubscription, cancelSubscription as cancelRazorpaySubscription } from '@/services/subscriptionBilling'
import { CancelSubscriptionModal, RedeemPromoModal } from './pricing'

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

type PlanType = 'trial' | 'monthly' | 'annual'

export default function PricingPage() {
  const navigate = useNavigate()
  const { user, profile, daysLeft, openAuthModal, refreshProfile } = useAuth()
  const { showToast } = useToast()

  // Mode: 'public' (Before login) | 'member' (After login)
  const [userSelectedMode, setUserSelectedMode] = useState<'public' | 'member' | null>(null)
  const mode = userSelectedMode ?? (user ? 'member' : 'public')
  const setMode = (m: 'public' | 'member') => {
    setUserSelectedMode(m)
    setUserSelectedPlan(null)
  }

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

  // Selected plan: defaults to currentPlanKey for member mode, 'annual' for public mode
  const [userSelectedPlan, setUserSelectedPlan] = useState<PlanType | null>(null)
  const defaultPlan: PlanType = mode === 'member' ? currentPlanKey : 'annual'
  const selectedPlan: PlanType = userSelectedPlan ?? defaultPlan
  const setSelectedPlan = (p: PlanType) => setUserSelectedPlan(p)

  const [autoRenew, setAutoRenew] = useState(true)

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

    if (hasMandate && plan === currentPlanKey) {
      showToast('You already have an active auto-renewing subscription on this plan.', 'info')
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
        theme: { color: '#007f57' },
        handler: async () => {
          await refreshProfile()
          showToast(
            startsAt
              ? `Mandate authorised. Your ${planTitle} plan starts on ${formatDate(new Date(startsAt * 1000).toISOString())} — you retain existing days.`
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
      setAutoRenew(false)
      showToast(`Subscription cancelled. You retain full access until ${expiryStr}.`, 'info')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      showToast(`Failed to cancel subscription: ${message}`, 'error')
    } finally {
      setCancelling(false)
    }
  }

  // Cycle calculation
  const totalCycleDays = isOnYearly ? 365 : 30
  const daysUsed = Math.max(0, totalCycleDays - Math.max(0, daysLeft))
  const cycleProgressPct = Math.min(100, Math.round((daysUsed / totalCycleDays) * 100))

  const isMember = mode === 'member'
  const isCurrentPlanSelected = isMember && selectedPlan === currentPlanKey

  const planNames: Record<PlanType, string> = {
    trial: '7-Day Trial',
    monthly: 'Monthly',
    annual: 'Annual',
  }

  const currentPlanDisplayName = isOnYearly
    ? 'Annual'
    : isOnMonthly
    ? 'Monthly'
    : isTrial
    ? '7-Day Trial'
    : isExpired
    ? 'Expired'
    : '7-Day Trial'

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

  // Summary box copy
  const summaryKicker = isMember
    ? isCurrentPlanSelected
      ? 'Current plan'
      : 'Selected change'
    : 'Selected'

  const summaryTitle = isMember
    ? isCurrentPlanSelected
      ? `${planNames[selectedPlan]} — your current plan`
      : `Switch to ${planNames[selectedPlan]}`
    : selectedPlan === 'trial'
    ? '7-Day Trial — ₹0 for 7 days'
    : selectedPlan === 'monthly'
    ? `Monthly — ₹${PRICING.MONTHLY_AMOUNT} / month`
    : `Annual — ₹${PRICING.ANNUAL_AMOUNT} / year`

  const summaryNote = isMember
    ? isCurrentPlanSelected
      ? `Renews ${renewalDateStr} · cancel any time`
      : 'Charged pro-rata; the balance on your current cycle carries over.'
    : selectedPlan === 'trial'
    ? 'No credit card needed to start the 7-day trial.'
    : 'One-click cancellation directly from settings at any time.'

  const handleCtaClick = () => {
    if (selectedPlan === 'trial') {
      if (!user) {
        openAuthModal('/pricing', 'signup')
      } else {
        navigate('/dashboard')
      }
      return
    }

    if (!user) {
      openAuthModal('/pricing', 'login')
      return
    }

    if (isCurrentPlanSelected && hasMandate) {
      navigate('/settings?tab=billing')
      return
    }

    handleDirectCheckout(selectedPlan)
  }

  const ctaLabel = isMember
    ? isCurrentPlanSelected
      ? 'Manage plan'
      : `Switch to ${planNames[selectedPlan]}`
    : selectedPlan === 'trial'
    ? 'Start free trial'
    : 'Continue to payment'

  return (
    <div className="min-h-screen bg-white text-[#101828] font-sans antialiased selection:bg-brand-500/20 selection:text-brand-900">
      {/* ── Modernist Sticky Header ─────────────────────────────── */}
      <header className="border-b border-[#eceef1] bg-white sticky top-0 z-30">
        <div className="max-w-[1120px] mx-auto px-4 sm:px-6 lg:px-10 py-3.5 flex items-center justify-between gap-4 flex-wrap">
          {/* Official Brand Logo */}
          <Link
            to={user ? '/dashboard' : '/'}
            className="flex items-center gap-2.5 shrink-0 group no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 rounded-lg p-0.5"
            aria-label="Intrack Home"
          >
            <BrandMark size={30} className="text-brand-500 shrink-0 group-hover:scale-105 transition-transform" />
            <div className="text-[19px] font-extrabold tracking-tight leading-none text-[#101828]">
              <span className="text-brand-600">In</span>track
            </div>
          </Link>

          {/* Mode Toggle: Before login vs After login */}
          <div className="flex items-center gap-1.5 bg-[#f3f4f6] border border-[#e5e7eb] rounded-full p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setMode('public')}
              className={cn(
                'text-xs font-bold px-3.5 py-1.5 rounded-full border-0 cursor-pointer transition-all whitespace-nowrap',
                !isMember ? 'bg-[#007f57] text-white shadow-xs' : 'bg-transparent text-[#6b7280] hover:text-[#101828]',
              )}
            >
              Before login
            </button>
            <button
              type="button"
              onClick={() => setMode('member')}
              className={cn(
                'text-xs font-bold px-3.5 py-1.5 rounded-full border-0 cursor-pointer transition-all whitespace-nowrap',
                isMember ? 'bg-[#007f57] text-white shadow-xs' : 'bg-transparent text-[#6b7280] hover:text-[#101828]',
              )}
            >
              After login
            </button>
          </div>

          {/* User Status / Account Indicator */}
          {user ? (
            <div className="flex items-center gap-2.5 pl-1.5">
              <div className="w-8 h-8 rounded-full bg-[#e6f1ee] text-[#006646] flex items-center justify-center font-bold text-xs shrink-0 shadow-xs border border-brand-500/20">
                {(profile?.full_name?.slice(0, 2) || user.email?.slice(0, 2) || 'IN').toUpperCase()}
              </div>
              <div className="hidden sm:block text-xs font-semibold text-[#101828] max-w-[140px] truncate">
                {user.email}
              </div>
              <Link
                to="/dashboard"
                className="hidden md:inline-flex items-center gap-1 text-xs font-semibold text-[#006646] hover:text-[#007f57] ml-2 no-underline"
              >
                Dashboard <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => openAuthModal('/pricing', 'login')}
              className="text-xs font-bold text-[#006646] hover:text-[#007f57] cursor-pointer bg-transparent border-0 py-1.5 px-3 rounded-lg hover:bg-[#e6f1ee]/50 transition-colors"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* ── Main Container ────────────────────────────────────────── */}
      <main className="max-w-[1120px] mx-auto px-4 sm:px-6 lg:px-10">
        {/* Hero Section */}
        <section className="pt-9 sm:pt-14 pb-7 sm:pb-11 max-w-[780px]">
          <div className="inline-flex items-center gap-2 bg-[#e6f1ee] text-[#006646] text-[11px] font-bold tracking-[0.12em] uppercase px-3 py-1.5 rounded-full mb-5 border border-brand-500/20 shadow-xs">
            One product · No locked features
          </div>
          <h1 className="text-3xl sm:text-5xl lg:text-[58px] leading-[1.05] tracking-tight font-extrabold m-0 mb-4 text-[#101828]">
            {isMember ? 'Your plan, and everything in it.' : 'Every feature. Every plan.'}
          </h1>
          <p className="text-base sm:text-lg leading-relaxed text-[#6b7280] m-0 max-w-[62ch]">
            {isMember
              ? 'Nothing is held back for a higher tier — you already have the whole product. Below is where your subscription stands, what it has been doing, and how to change the way you pay.'
              : 'Nothing is held back for a higher tier. The plan you choose changes one thing only: how long it runs and how often you pay. Read-only Gmail access, bank-grade encryption, cancel in one click.'}
          </p>
        </section>

        {/* ── Member Command Center (After Login) ────────────────── */}
        {isMember && (
          <section className="flex flex-col gap-4 pb-9 sm:pb-11">
            {/* Executive Status Card */}
            <div className="border border-[#e5e7eb] rounded-[18px] bg-white shadow-sm overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#e5e7eb]">
                {/* Col 1: Your Plan */}
                <div className="p-5 sm:p-7 bg-[#f7f8fa]">
                  <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#6b7280] mb-3">
                    Your plan
                  </div>
                  <div className="flex items-center gap-2.5 flex-wrap mb-1.5">
                    <div className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#101828]">
                      {currentPlanDisplayName}
                    </div>
                    <div className="inline-flex items-center gap-1.5 bg-[#e6f1ee] text-[#006646] text-[11px] font-bold tracking-[0.08em] uppercase px-2.5 py-1 rounded-full">
                      {isTrial ? 'Trial active' : isActive ? 'Active' : isCancelled ? 'Cancelled' : 'Expired'}
                    </div>
                  </div>
                  <div className="text-sm text-[#6b7280]">
                    {isOnYearly
                      ? `₹${PRICING.ANNUAL_AMOUNT} / year · auto-renewing`
                      : isOnMonthly
                      ? `₹${PRICING.MONTHLY_AMOUNT} / month · auto-renewing`
                      : isTrial
                      ? '₹0 for 7 days'
                      : 'Expired subscription'}
                  </div>
                  <div className="h-[1px] bg-[#e5e7eb] my-4" />
                  <div className="text-xs text-[#6b7280] leading-relaxed">
                    Member since {formatDate(profile?.created_at || user?.created_at || new Date().toISOString())}
                    <br />
                    Account: <span className="font-semibold text-[#101828]">{user?.email || 'arjun@gmail.com'}</span>
                  </div>
                </div>

                {/* Col 2: Next Renewal */}
                <div className="p-5 sm:p-7">
                  <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#6b7280] mb-3.5">
                    Next renewal
                  </div>
                  <div className="text-xl font-bold tracking-tight text-[#101828] mb-1">
                    {renewalDateStr}
                  </div>
                  <div className="text-sm text-[#6b7280] mb-4.5">
                    {renewalAmountStr}
                  </div>
                  <div className="h-1.5 bg-[#eceef1] rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full bg-[#007f57] rounded-full transition-all duration-500"
                      style={{ width: `${cycleProgressPct}%` }}
                    />
                  </div>
                  <div className="text-xs text-[#6b7280]">
                    {daysLeft > 0
                      ? `${daysUsed} of ${totalCycleDays} days used in this cycle (${daysLeft} days left)`
                      : 'No prepaid days remaining.'}
                  </div>
                </div>

                {/* Col 3: Payment Method */}
                <div className="p-5 sm:p-7">
                  <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#6b7280] mb-3.5">
                    Payment method
                  </div>
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div className="w-9 h-6 rounded-md bg-[#e6f1ee] text-[#006646] text-[10px] font-extrabold flex items-center justify-center">
                      {hasMandate ? 'AUTOPAY' : 'UPI'}
                    </div>
                    <div className="text-sm font-semibold text-[#101828]">
                      {hasMandate ? 'Razorpay E-Mandate' : (user?.email || 'UPI Autopay')}
                    </div>
                  </div>
                  <div className="text-xs text-[#6b7280] mb-4">
                    {hasMandate ? 'Autopay mandate active' : isTrial ? 'No credit card needed during trial' : 'Manual billing'}
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoRenew}
                      onClick={() => {
                        if (autoRenew && hasMandate) {
                          setCancelModalOpen(true)
                        } else {
                          setAutoRenew(!autoRenew)
                        }
                      }}
                      className={cn(
                        'w-11 h-6.5 rounded-full border-0 cursor-pointer p-1 flex items-center transition-colors',
                        autoRenew ? 'bg-[#007f57] justify-end' : 'bg-[#d1d5db] justify-start',
                      )}
                    >
                      <span className="w-5 h-5 rounded-full bg-white block shadow-xs" />
                    </button>
                    <div className="text-xs font-semibold text-[#101828]">
                      {autoRenew ? 'Auto-renew on' : 'Auto-renew off'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center gap-2.5 p-4 sm:px-7 border-t border-[#e5e7eb] bg-[#f9fafb]">
                <a
                  href="#billing"
                  className="text-xs font-bold px-4 py-2.5 rounded-lg bg-[#007f57] hover:bg-[#006646] text-white no-underline transition-colors cursor-pointer shadow-xs"
                >
                  Change plan
                </a>
                <button
                  type="button"
                  onClick={() => setPromoModalOpen(true)}
                  className="text-xs font-bold px-4 py-2.5 rounded-lg border border-[#e5e7eb] text-[#101828] hover:bg-[#f3f4f6] transition-colors cursor-pointer inline-flex items-center gap-1.5"
                >
                  <Ticket className="w-3.5 h-3.5 text-brand-600" /> Redeem promo code
                </button>
                {(hasMandate || isActive) && (
                  <button
                    type="button"
                    onClick={() => setCancelModalOpen(true)}
                    className="text-xs font-bold px-4 py-2.5 rounded-lg text-[#6b7280] hover:text-[#b3261e] ml-auto transition-colors cursor-pointer bg-transparent border-0"
                  >
                    Cancel subscription
                  </button>
                )}
              </div>
            </div>

            {/* Telemetry KPI Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="border border-[#e5e7eb] rounded-2xl p-5 bg-white shadow-xs">
                <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#6b7280] mb-2.5">
                  On-demand scans today
                </div>
                <div className="text-2xl font-extrabold tracking-tight text-[#101828] mb-2.5">
                  1 <span className="text-sm font-semibold text-[#6b7280]">of 2 used</span>
                </div>
                <div className="flex gap-1.5 mb-2.5">
                  <div className="h-1.5 flex-1 bg-[#007f57] rounded-full" />
                  <div className="h-1.5 flex-1 bg-[#eceef1] rounded-full" />
                </div>
                <div className="text-xs text-[#6b7280]">
                  Max 2 scans per day (4h cooldown between scans)
                </div>
              </div>

              <div className="border border-[#e5e7eb] rounded-2xl p-5 bg-white shadow-xs">
                <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#6b7280] mb-2.5">
                  Classification engine
                </div>
                <div className="text-2xl font-extrabold tracking-tight text-[#101828] mb-2.5">
                  Gemini AI <span className="text-sm font-semibold text-[#6b7280]">Active</span>
                </div>
                <div className="text-xs text-[#6b7280] leading-relaxed">
                  Real-time auto-categorization &amp; merchant learning active.
                </div>
              </div>

              <div className="border border-[#e5e7eb] rounded-2xl p-5 bg-white shadow-xs">
                <div className="text-[11px] font-bold tracking-[0.12em] uppercase text-[#6b7280] mb-2.5">
                  Gmail connection
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#007f57] animate-pulse" />
                  <span className="text-lg font-bold tracking-tight text-[#101828]">Healthy</span>
                </div>
                <div className="text-xs text-[#6b7280] leading-relaxed">
                  Read-only access verified · Bank grade security
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── "Included on every plan" Grid ────────────────────────── */}
        <section className="py-7 sm:py-11 border-t border-[#eceef1]">
          <div className="flex items-baseline justify-between gap-5 flex-wrap mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#101828] m-0">
              Included on every plan
            </h2>
            <div className="text-sm text-[#6b7280]">
              Same on day one of the trial, same on month 37.
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-0">
            {[
              {
                title: 'Read-only Gmail bank alert scans',
                desc: 'Every Indian bank and UPI app. We never get write access.',
              },
              {
                title: 'Real-time Gemini AI classification',
                desc: 'Each alert sorted into a category the moment it arrives.',
              },
              {
                title: 'Smart budgets & subscription radar',
                desc: 'Recurring charges surfaced before they renew.',
              },
              {
                title: 'Merchant & category learning',
                desc: 'Correct a merchant once and it stays corrected.',
              },
              {
                title: '2 on-demand inbox scans daily',
                desc: 'Force a fresh sweep any time, with a 4-hour cooldown.',
              },
              {
                title: 'Encrypted backup, CSV & JSON export',
                desc: 'Your full ledger out whenever you ask for it.',
              },
              {
                title: 'Instant start on sign-up',
                desc: 'Connect Gmail and see last month’s spending in a minute.',
              },
              {
                title: 'Cancel in one click',
                desc: 'No email, no retention call, no hold on your data.',
              },
              {
                title: '100% Client-side statement import',
                desc: 'Import HDFC, ICICI, SBI, Axis bank CSV statements directly.',
              },
            ].map((feat, idx) => (
              <div key={idx} className="flex gap-3 py-4 border-t border-[#eceef1]">
                <div className="w-5 h-5 rounded-full bg-[#e6f1ee] text-[#007f57] flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 className="w-3.5 h-3.5 stroke-[2.5]" />
                </div>
                <div>
                  <div className="text-sm font-bold text-[#101828] mb-1">{feat.title}</div>
                  <div className="text-xs text-[#6b7280] leading-relaxed">{feat.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── Choose / Change How You Pay Section ─────────────────── */}
        <section id="billing" className="pt-7 sm:pt-11 border-t border-[#eceef1]">
          <div className="flex items-baseline justify-between gap-5 flex-wrap mb-6 sm:mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[#101828] m-0">
              {isMember ? 'Change how you pay' : 'Choose how you pay'}
            </h2>
            <div className="text-sm text-[#6b7280]">
              Billing only — the list above never changes.
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {/* Plan 1: 7-Day Trial */}
            <button
              type="button"
              onClick={() => {
                if (!trialLocked) setSelectedPlan('trial')
              }}
              disabled={trialLocked}
              className={cn(
                'flex items-center gap-4 sm:gap-9 flex-wrap w-full text-left font-inherit text-[#101828] p-4.5 sm:p-6 rounded-2xl transition-all cursor-pointer border',
                selectedPlan === 'trial'
                  ? 'border-[#007f57] bg-[#f2f9f6] shadow-md ring-1 ring-[#007f57]/20'
                  : 'border-[#e5e7eb] bg-white shadow-xs hover:border-brand-500/40',
                trialLocked && 'opacity-50 cursor-not-allowed',
              )}
            >
              <div className="flex items-center gap-3.5 min-w-[190px] shrink-0">
                <span
                  className={cn(
                    'w-4.5 h-4.5 rounded-full shrink-0 border box-border bg-white',
                    selectedPlan === 'trial'
                      ? 'border-[5px] border-[#007f57]'
                      : 'border-2 border-[#d1d5db]',
                  )}
                />
                <div>
                  <span className="block text-lg sm:text-xl font-extrabold tracking-tight">
                    7-Day Trial
                  </span>
                  <span className="block text-[11px] font-bold tracking-[0.12em] uppercase text-[#6b7280] mt-1">
                    {trialLocked ? 'Trial used' : 'Complimentary'}
                  </span>
                </div>
              </div>
              <div className="min-w-[140px] shrink-0">
                <span className="text-xl sm:text-2xl font-extrabold tracking-tight">₹0</span>
                <span className="text-xs font-semibold text-[#6b7280]"> / 7 days</span>
              </div>
              <div className="flex-1 min-w-[200px] text-xs text-[#6b7280] leading-relaxed">
                No credit card. Full product, zero commitment.
              </div>
            </button>

            {/* Plan 2: Monthly */}
            <button
              type="button"
              onClick={() => setSelectedPlan('monthly')}
              className={cn(
                'flex items-center gap-4 sm:gap-9 flex-wrap w-full text-left font-inherit text-[#101828] p-4.5 sm:p-6 rounded-2xl transition-all cursor-pointer border',
                selectedPlan === 'monthly'
                  ? 'border-[#007f57] bg-[#f2f9f6] shadow-md ring-1 ring-[#007f57]/20'
                  : 'border-[#e5e7eb] bg-white shadow-xs hover:border-brand-500/40',
              )}
            >
              <div className="flex items-center gap-3.5 min-w-[190px] shrink-0">
                <span
                  className={cn(
                    'w-4.5 h-4.5 rounded-full shrink-0 border box-border bg-white',
                    selectedPlan === 'monthly'
                      ? 'border-[5px] border-[#007f57]'
                      : 'border-2 border-[#d1d5db]',
                  )}
                />
                <div>
                  <span className="block text-lg sm:text-xl font-extrabold tracking-tight">
                    Monthly
                  </span>
                  <span className="block text-[11px] font-bold tracking-[0.12em] uppercase text-[#6b7280] mt-1">
                    {isMember && isOnMonthly ? 'Current plan' : 'Flexible'}
                  </span>
                </div>
              </div>
              <div className="min-w-[140px] shrink-0">
                <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  ₹{PRICING.MONTHLY_AMOUNT}
                </span>
                <span className="text-xs font-semibold text-[#6b7280]"> / month</span>
              </div>
              <div className="flex-1 min-w-[200px] text-xs text-[#6b7280] leading-relaxed">
                Auto-renews monthly. Cancel anytime in one click.
              </div>
            </button>

            {/* Plan 3: Annual */}
            <button
              type="button"
              onClick={() => setSelectedPlan('annual')}
              className={cn(
                'flex items-center gap-4 sm:gap-9 flex-wrap w-full text-left font-inherit text-[#101828] p-4.5 sm:p-6 rounded-2xl transition-all cursor-pointer border',
                selectedPlan === 'annual'
                  ? 'border-[#007f57] bg-[#f2f9f6] shadow-md ring-1 ring-[#007f57]/20'
                  : 'border-[#e5e7eb] bg-white shadow-xs hover:border-brand-500/40',
              )}
            >
              <div className="flex items-center gap-3.5 min-w-[190px] shrink-0">
                <span
                  className={cn(
                    'w-4.5 h-4.5 rounded-full shrink-0 border box-border bg-white',
                    selectedPlan === 'annual'
                      ? 'border-[5px] border-[#007f57]'
                      : 'border-2 border-[#d1d5db]',
                  )}
                />
                <div>
                  <span className="block text-lg sm:text-xl font-extrabold tracking-tight">
                    Annual
                  </span>
                  <span className="block text-[11px] font-bold tracking-[0.12em] uppercase text-emerald-700 bg-emerald-100/60 px-2 py-0.5 rounded-full mt-1 w-fit">
                    {isMember && isOnYearly ? 'Current plan' : 'Save 71% · Best Value'}
                  </span>
                </div>
              </div>
              <div className="min-w-[140px] shrink-0">
                <span className="text-xl sm:text-2xl font-extrabold tracking-tight">
                  ₹{PRICING.ANNUAL_AMOUNT}
                </span>
                <span className="text-xs font-semibold text-[#6b7280]"> / year</span>
              </div>
              <div className="flex-1 min-w-[200px] text-xs text-[#6b7280] leading-relaxed">
                One payment a year instead of twelve (₹1.9/day). Auto-renews yearly.
              </div>
            </button>
          </div>

          {/* Emerald Summary Card */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-5 items-center bg-[#007f57] text-white rounded-[18px] p-5 sm:p-7 mt-5 shadow-lg">
            <div>
              <div className="text-[11px] font-bold tracking-[0.14em] uppercase opacity-80 mb-2">
                {summaryKicker}
              </div>
              <div className="text-xl sm:text-2xl font-extrabold tracking-tight leading-tight">
                {summaryTitle}
              </div>
              <div className="text-xs sm:text-sm opacity-90 mt-2 leading-relaxed">
                {summaryNote}
              </div>
            </div>

            <div className="flex flex-col sm:items-end gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCtaClick}
                disabled={processingPlan !== null}
                className="text-sm font-extrabold bg-white text-[#006646] hover:bg-[#e6f1ee] border-0 rounded-xl px-6 py-3.5 cursor-pointer whitespace-nowrap shadow-md active:scale-97 transition-all flex items-center justify-center gap-2"
              >
                {processingPlan ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Processing…
                  </>
                ) : (
                  ctaLabel
                )}
              </button>
              <button
                type="button"
                onClick={() => setPromoModalOpen(true)}
                className="text-xs font-semibold text-white/80 hover:text-white underline underline-offset-2 cursor-pointer bg-transparent border-0 p-1"
              >
                Have a coupon code?
              </button>
            </div>
          </div>
        </section>

        {/* ── Billing History Table (Member View) ─────────────────── */}
        {isMember && (
          <section className="pt-7 sm:pt-11">
            <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight text-[#101828] m-0 mb-4">
              Billing history
            </h2>
            <div className="border border-[#e5e7eb] rounded-2xl overflow-hidden bg-white shadow-xs">
              <div className="grid grid-cols-4 gap-3 p-3.5 sm:px-5 bg-[#f7f8fa] text-[11px] font-bold tracking-[0.1em] uppercase text-[#6b7280]">
                <div>Date</div>
                <div className="col-span-2">Description</div>
                <div>Amount</div>
              </div>
              <div className="divide-y divide-[#eceef1]">
                {profile?.subscription_status ? (
                  <div className="grid grid-cols-4 gap-3 p-4 sm:px-5 text-sm items-center">
                    <div className="text-[#6b7280] text-xs sm:text-sm">
                      {formatDate(profile?.created_at || new Date().toISOString())}
                    </div>
                    <div className="col-span-2 font-semibold text-[#101828] text-xs sm:text-sm">
                      {currentPlanDisplayName} Plan · {status === 'active' ? 'Active' : isTrial ? '7-Day Trial' : status}
                    </div>
                    <div className="font-bold text-[#101828] text-xs sm:text-sm">
                      {isOnYearly ? `₹${PRICING.ANNUAL_AMOUNT}` : isOnMonthly ? `₹${PRICING.MONTHLY_AMOUNT}` : '₹0'}
                    </div>
                  </div>
                ) : (
                  <div className="p-5 text-center text-xs text-[#6b7280]">
                    No past receipts recorded.
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── 3 Explanatory Feature Cards ─────────────────────────── */}
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-7 sm:py-11">
          <div className="bg-[#f7f8fa] border border-[#e5e7eb] rounded-2xl p-5">
            <div className="text-sm font-bold text-[#101828] mb-1.5">Switching plans</div>
            <div className="text-xs text-[#6b7280] leading-relaxed">
              Move between monthly and annual any time. The unused balance carries over to the new cycle.
            </div>
          </div>
          <div className="bg-[#f7f8fa] border border-[#e5e7eb] rounded-2xl p-5">
            <div className="text-sm font-bold text-[#101828] mb-1.5">After the trial</div>
            <div className="text-xs text-[#6b7280] leading-relaxed">
              Nothing charges automatically. The trial simply ends and your data waits until you pick a plan.
            </div>
          </div>
          <div className="bg-[#f7f8fa] border border-[#e5e7eb] rounded-2xl p-5">
            <div className="text-sm font-bold text-[#101828] mb-1.5">Payments &amp; refunds</div>
            <div className="text-xs text-[#6b7280] leading-relaxed">
              UPI, cards and net banking via Razorpay. Card details never touch our servers. See our{' '}
              <Link to="/refund-policy" className="text-[#006646] font-semibold hover:underline">
                refund policy
              </Link>
              .
            </div>
          </div>
        </section>

        {/* ── Footer ─────────────────────────────────────────────── */}
        <footer className="border-t border-[#eceef1] py-5 pb-12 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#6b7280]">
          <div>
            Prices in INR, inclusive of applicable taxes. Read-only Gmail access, revocable at any time.
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <Link to="/privacy" className="hover:text-[#101828] transition-colors no-underline">Privacy</Link>
            <Link to="/terms" className="hover:text-[#101828] transition-colors no-underline">Terms</Link>
            <Link to="/refund-policy" className="hover:text-[#101828] transition-colors no-underline">Refunds</Link>
            <Link to="/support" className="hover:text-[#101828] transition-colors no-underline">Support</Link>
          </div>
        </footer>
      </main>

      {/* ── Modals ──────────────────────────────────────────────── */}
      <CancelSubscriptionModal
        isOpen={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        onConfirm={handleConfirmCancel}
        isProcessing={cancelling}
        expiresAt={profile?.subscription_expires_at || null}
        daysLeft={daysLeft}
        planName={currentPlanDisplayName}
      />

      <RedeemPromoModal
        isOpen={promoModalOpen}
        onClose={() => setPromoModalOpen(false)}
        onSuccess={() => {
          refreshProfile()
        }}
      />
    </div>
  )
}
