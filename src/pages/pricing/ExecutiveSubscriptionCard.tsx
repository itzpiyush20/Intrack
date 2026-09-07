// ============================================
// ExecutiveSubscriptionCard — Authenticated User Command Center
// Displays real-time plan status, expiry telemetry, cancel-anytime guarantee,
// and one-click upgrades, extensions, or self-serve cancellation.
// ============================================

import React from 'react'
import { motion } from 'framer-motion'
import { formatDate, cn } from '@/utils'
import { ANNUAL_SAVING_PCT, PRICING } from '@/constants'
import {
  Crown,
  Calendar,
  Clock,
  ShieldCheck,
  ArrowRight,
  AlertTriangle,
  RotateCcw,
  Zap,
  Check
} from 'lucide-react'

interface ExecutiveSubscriptionCardProps {
  profile: any
  email?: string
  daysLeft: number
  hasQueuedPlan: boolean
  onSelectPlan: (plan: 'monthly' | 'annual') => void
  onOpenCancelModal: () => void
  onReactivate: () => Promise<void>
  isReactivating: boolean
}

export const ExecutiveSubscriptionCard: React.FC<ExecutiveSubscriptionCardProps> = ({
  profile,
  email,
  daysLeft,
  hasQueuedPlan,
  onSelectPlan,
  onOpenCancelModal,
  onReactivate,
  isReactivating
}) => {
  const status = profile?.subscription_status
  const planType = profile?.subscription_plan_type

  const isActive = status === 'active' && daysLeft > 0
  const isTrial = status === 'trial' && daysLeft > 0
  const isCancelled = status === 'cancelled'
  const isExpired = status === 'expired' || (daysLeft <= 0 && status !== 'active')

  const isOnYearly = (isActive || (isCancelled && daysLeft > 0)) && planType !== 'monthly' && planType !== 'trial'
  const isOnMonthly = (isActive || (isCancelled && daysLeft > 0)) && planType === 'monthly'

  // Human-readable plan title
  const planTitle = isOnYearly
    ? 'Yearly Plan'
    : isOnMonthly
    ? 'Monthly Plan'
    : isTrial
    ? '7-Day Free Trial'
    : isCancelled
    ? 'Cancelled Subscription'
    : 'Subscription Expired'

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-3xl overflow-hidden border border-sb-hairline bg-surface-1 p-6 sm:p-8 md:p-10 shadow-sm"
    >
      {/* Ambient background glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 right-0 h-80 w-80 rounded-full bg-radial from-brand-500/10 via-brand-500/5 to-transparent blur-3xl"
      />

      <div className="relative z-10 space-y-6">
        {/* ── Top Header Row ─────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-sb-hairline">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-2 border border-sb-hairline text-sb-ink-secondary text-xs font-semibold">
                <span className="h-2 w-2 rounded-full bg-brand-500" />
                <span>Subscription &amp; Billing Center</span>
              </div>
              {email && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-surface-2/80 border border-sb-hairline text-sb-ink-muted text-xs font-medium font-mono">
                  <span>{email}</span>
                </div>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-sb-ink flex items-center gap-2.5">
              <span>{planTitle}</span>
            </h1>
            <p className="text-xs sm:text-sm text-sb-ink-secondary">
              {isActive
                ? 'Your autonomous bookkeeping and email scan suite is active and running.'
                : isTrial
                ? 'You have full access to all features during your complimentary trial period.'
                : isCancelled && daysLeft > 0
                ? 'Your subscription has been cancelled. Your access remains active until the expiration date.'
                : 'Your access period has elapsed. Choose a plan below to resume tracking.'}
            </p>
          </div>

          {/* Status Badge */}
          <div className="self-start sm:self-center shrink-0">
            {isActive && (
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-500/10 text-brand-700 border border-brand-500/20 text-xs font-bold uppercase tracking-wider">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
                </span>
                Active Subscription
              </span>
            )}

            {isTrial && (
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/20 text-xs font-bold uppercase tracking-wider">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
                Trial ({daysLeft}d left)
              </span>
            )}

            {isCancelled && daysLeft > 0 && (
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/10 text-rose-700 border border-rose-500/20 text-xs font-bold uppercase tracking-wider">
                <Clock className="w-3.5 h-3.5" />
                Cancelled · Active
              </span>
            )}

            {isExpired && (
              <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-surface-2 text-sb-ink-muted border border-sb-hairline text-xs font-bold uppercase tracking-wider">
                Plan Expired
              </span>
            )}
          </div>
        </div>

        {/* ── 4-Telemetry Metric Cards ───────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* 1. Plan & Billing Term */}
          <div className="p-4 rounded-2xl bg-surface-2/50 border border-sb-hairline space-y-1">
            <p className="text-[11px] font-bold text-sb-ink-muted uppercase tracking-wider">Billing Model</p>
            <p className="text-base sm:text-lg font-extrabold text-sb-ink">
              {isOnYearly ? `₹${PRICING.ANNUAL_AMOUNT} / year` : isOnMonthly ? `₹${PRICING.MONTHLY_AMOUNT} / month` : isTrial ? 'Free Trial' : '—'}
            </p>
            <p className="text-[11px] text-sb-ink-secondary flex items-center gap-1">
              <Check className="w-3 h-3 text-brand-600" />
              <span>Auto-renewing subscription</span>
            </p>
          </div>

          {/* 2. Expiry / Days Left */}
          <div className="p-4 rounded-2xl bg-surface-2/50 border border-sb-hairline space-y-1">
            <p className="text-[11px] font-bold text-sb-ink-muted uppercase tracking-wider">Prepaid Validity</p>
            <p className="text-base sm:text-lg font-extrabold text-sb-ink tnum">
              {profile?.subscription_expires_at ? formatDate(profile.subscription_expires_at) : '—'}
            </p>
            <p className="text-[11px] text-sb-ink-secondary">
              {daysLeft > 0 ? (
                <span className="font-semibold text-brand-600">{daysLeft} days remaining</span>
              ) : (
                <span className="text-rose-600">Access elapsed</span>
              )}
            </p>
          </div>

          {/* 3. Cancellation Control */}
          <div className="p-4 rounded-2xl bg-surface-2/50 border border-sb-hairline space-y-1">
            <p className="text-[11px] font-bold text-sb-ink-muted uppercase tracking-wider">Cancellation</p>
            <p className="text-base sm:text-lg font-extrabold text-sb-ink flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0" />
              <span>Cancel Anytime</span>
            </p>
            <p className="text-[11px] text-sb-ink-secondary">One click, no lock-in contract</p>
          </div>

          {/* 4. Automated Scan Allowance */}
          <div className="p-4 rounded-2xl bg-surface-2/50 border border-sb-hairline space-y-1">
            <p className="text-[11px] font-bold text-sb-ink-muted uppercase tracking-wider">Scan Quota</p>
            <p className="text-base sm:text-lg font-extrabold text-sb-ink">2 Scans / Day</p>
            <p className="text-[11px] text-sb-ink-secondary">4-hour interval cooldown</p>
          </div>
        </div>

        {/* ── Active Plan Entitlements & Protections ─────────── */}
        {(isActive || isTrial || (isCancelled && daysLeft > 0)) && (
          <div className="rounded-2xl bg-surface-2/40 border border-sb-hairline p-4 sm:p-5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-sb-ink-muted">
                Active Plan Entitlements &amp; Protections
              </span>
              <span className="text-[11px] font-semibold text-brand-700 flex items-center gap-1">
                <Check className="w-3.5 h-3.5 text-brand-600" />
                100% Unlocked
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
              {[
                { title: '2 Automated Daily Scans', desc: '4-hour safety cooldown between runs' },
                { title: 'Gemini AI Categorization', desc: 'Real-time merchant & category parsing' },
                { title: 'Subscription Radar', desc: 'Renewal calendar & price bump alerts' },
                { title: 'Cancel Anytime', desc: 'One click stops future charges, no lock-in' },
                { title: 'Encrypted Exports', desc: 'Full CSV & JSON financial backup' },
                { title: 'Read-Only Security', desc: 'Zero banking credentials or PINs stored' },
              ].map((ent) => (
                <div key={ent.title} className="flex items-start gap-2 p-2 rounded-xl bg-surface-1/70 border border-sb-hairline/60">
                  <Check className="w-3.5 h-3.5 text-brand-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-sb-ink leading-tight">{ent.title}</p>
                    <p className="text-[10px] text-sb-ink-secondary leading-tight mt-0.5">{ent.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Queued Plan Notice (if present) ────────────────── */}
        {hasQueuedPlan && (
          <div className="rounded-2xl border border-brand-500/30 bg-brand-500/5 p-4 sm:p-4.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-brand-500/15 border border-brand-500/25 flex items-center justify-center text-brand-700 shrink-0">
                <Calendar className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-bold text-sb-ink">
                  {profile.pending_plan_type === 'annual' ? 'Yearly' : 'Monthly'} Plan Queued
                </p>
                <p className="text-[11px] sm:text-xs text-sb-ink-secondary">
                  Already confirmed. Automatically activates on{' '}
                  <span className="font-semibold text-brand-700">
                    {profile.pending_activates_at
                      ? formatDate(profile.pending_activates_at)
                      : "your current plan's expiry date"}
                  </span>
                  . Zero overlap, zero lost days.
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md bg-brand-500/10 text-brand-700 border border-brand-500/20 shrink-0">
              Paid &amp; Queued
            </span>
          </div>
        )}

        {/* ── Cancellation Banner (if cancelled with remaining days) ── */}
        {isCancelled && daysLeft > 0 && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-xs sm:text-sm font-bold text-sb-ink">
                Subscription Cancelled · Full Access Active Until {profile?.subscription_expires_at ? formatDate(profile.subscription_expires_at) : 'Expiry'}
              </p>
              <p className="text-[11px] sm:text-xs text-sb-ink-secondary leading-relaxed">
                You will not be charged again. Your automated scans, Gemini AI categorization, and budget alerts remain 100% active until your prepaid period ends. You can resume at any time.
              </p>
            </div>
          </div>
        )}

        {/* ── Action Buttons Bar ─────────────────────────────── */}
        <div className="pt-2 flex flex-col sm:flex-row flex-wrap items-center justify-between gap-3 border-t border-sb-hairline">
          <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
            {/* If on Monthly: Upgrade to Yearly */}
            {isOnMonthly && isActive && (
              <>
                <button
                  type="button"
                  onClick={() => onSelectPlan('annual')}
                  disabled={hasQueuedPlan}
                  className="sb-btn-primary py-2.5 px-4 text-xs font-bold cursor-pointer border-0 flex items-center gap-1.5 shadow-sm"
                  style={{ opacity: hasQueuedPlan ? 0.5 : 1 }}
                >
                  <Crown className="w-3.5 h-3.5 text-amber-300" />
                  <span>Upgrade to Yearly (Save {ANNUAL_SAVING_PCT}%)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => onSelectPlan('monthly')}
                  disabled={hasQueuedPlan}
                  className="sb-btn-secondary py-2.5 px-4 text-xs font-semibold cursor-pointer"
                  style={{ opacity: hasQueuedPlan ? 0.5 : 1 }}
                >
                  Buy Another Monthly Cycle (₹{PRICING.MONTHLY_AMOUNT})
                </button>
              </>
            )}

            {/* If on Yearly: Extend */}
            {isOnYearly && isActive && (
              <button
                type="button"
                onClick={() => onSelectPlan('annual')}
                disabled={hasQueuedPlan}
                className="sb-btn-primary py-2.5 px-4 text-xs font-bold cursor-pointer border-0 flex items-center gap-1.5 shadow-sm"
                style={{ opacity: hasQueuedPlan ? 0.5 : 1 }}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Buy Another Yearly Cycle (₹{PRICING.ANNUAL_AMOUNT})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {/* If on Trial: Activate */}
            {isTrial && (
              <>
                <button
                  type="button"
                  onClick={() => onSelectPlan('annual')}
                  className="sb-btn-primary py-2.5 px-4 text-xs font-bold cursor-pointer border-0 flex items-center gap-1.5 shadow-sm"
                >
                  <Crown className="w-3.5 h-3.5 text-amber-300" />
                  <span>Activate Yearly · ₹{PRICING.ANNUAL_AMOUNT} (Best Value)</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => onSelectPlan('monthly')}
                  className="sb-btn-secondary py-2.5 px-4 text-xs font-semibold cursor-pointer"
                >
                  Activate Monthly · ₹{PRICING.MONTHLY_AMOUNT}
                </button>
              </>
            )}

            {/* If Cancelled with days remaining: Resume */}
            {isCancelled && daysLeft > 0 && (
              <button
                type="button"
                onClick={onReactivate}
                disabled={isReactivating}
                className="sb-btn-primary py-2.5 px-4 text-xs font-bold cursor-pointer border-0 flex items-center gap-1.5 shadow-sm"
              >
                <RotateCcw className={cn("w-3.5 h-3.5", isReactivating && "animate-spin")} />
                <span>{isReactivating ? 'Resuming…' : 'Resume Subscription'}</span>
              </button>
            )}

            {/* If Expired: Pick plan */}
            {isExpired && (
              <button
                type="button"
                onClick={() => onSelectPlan('annual')}
                className="sb-btn-primary py-2.5 px-4 text-xs font-bold cursor-pointer border-0 flex items-center gap-1.5 shadow-sm"
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Choose a Plan to Reactivate</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Self-serve Cancel Subscription button (only visible if active or trial) */}
          {(isActive || isTrial) && (
            <div className="flex items-center gap-2 ml-auto sm:ml-0 pt-2 sm:pt-0">
              <button
                type="button"
                onClick={onOpenCancelModal}
                className="text-xs font-semibold text-rose-600/80 hover:text-rose-700 bg-transparent border-0 cursor-pointer transition-colors px-2.5 py-1.5 rounded-lg hover:bg-rose-500/10"
              >
                Cancel subscription
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}
