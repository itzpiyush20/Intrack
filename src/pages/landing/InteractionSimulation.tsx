import { useState, useEffect } from 'react'
import { useReducedMotion } from 'framer-motion'
import { cn } from '@/utils'

/**
 * A looping demo of what a scan does: an alert arrives, gets parsed, lands in
 * the ledger, and the matching budget moves. Every state change here mirrors
 * something the product actually does — no glow sweeps or pulsing borders
 * standing in for "something is happening". The previous version had both
 * (`laser-glow`, `pulse-emerald`); DESIGN.md retires ambient glow decoration,
 * and this was the one place it survived.
 *
 * `useReducedMotion()` stops the loop on step 0 (the resting state) so a
 * reduced-motion visitor is not shown an auto-playing sequence at all.
 */
export function InteractionSimulation() {
  const reduceMotion = useReducedMotion()
  const [step, setStep] = useState(0)
  const [budgetAmount, setBudgetAmount] = useState(4000)

  useEffect(() => {
    if (reduceMotion) return
    let active = true
    const timers: ReturnType<typeof setTimeout>[] = []

    const run = () => {
      if (!active) return
      setStep(0)
      setBudgetAmount(4000)
      timers.push(setTimeout(() => { if (active) setStep(1) }, 1200))
      timers.push(setTimeout(() => { if (active) setStep(2) }, 3600))
      timers.push(setTimeout(() => { if (active) setStep(3) }, 6000))
      timers.push(setTimeout(() => { if (active) { setStep(4); setBudgetAmount(4250) } }, 8400))
      timers.push(setTimeout(() => { if (active) run() }, 12800))
    }
    run()
    return () => { active = false; timers.forEach(clearTimeout) }
  }, [reduceMotion])

  const displayStep = reduceMotion ? 4 : step
  const displayBudget = reduceMotion ? 4250 : budgetAmount
  const totalBudget = 5000
  const budgetPercent = (displayBudget / totalBudget) * 100

  const statusLabel = displayStep === 0 ? 'Waiting' : displayStep === 1 ? 'Alert received' : displayStep === 2 ? 'Reading it' : displayStep === 3 ? 'Saved' : 'Budget updated'

  return (
    <div className="relative w-full max-w-[440px] rounded-2xl border border-sb-hairline bg-sb-canvas-soft p-5 sm:p-6 flex flex-col gap-5 shadow-[var(--shadow-md)] select-none">
      <div className="flex items-center justify-between border-b border-sb-hairline pb-3">
        <p className="text-xs font-semibold text-sb-ink-secondary">What a scan does</p>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full border transition-colors duration-300',
            displayStep >= 3
              ? 'bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)] border-[var(--status-positive-border)]'
              : 'bg-surface-2 text-sb-ink-muted border-sb-hairline'
          )}
        >
          {statusLabel}
        </span>
      </div>

      {/* 1 — the alert */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-sb-ink-muted uppercase">1 · Bank alert email</span>
        <div className="min-h-[76px] rounded-xl border border-sb-hairline bg-sb-canvas p-3 flex items-center">
          {displayStep === 0 ? (
            <p className="text-xs text-sb-ink-muted italic">No new alert yet</p>
          ) : (
            <div
              className={cn(
                'flex gap-3 items-start w-full transition-opacity duration-500',
                displayStep >= 1 ? 'opacity-100' : 'opacity-0'
              )}
            >
              <div className="h-8 w-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center shrink-0 text-brand-500 font-semibold text-sm">
                ₹
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-xs font-semibold text-sb-ink">ICICI Bank</span>
                  <span className="text-[11px] text-sb-ink-muted">Just now</span>
                </div>
                <p className="text-xs text-sb-ink-secondary leading-normal">UPI debit of ₹250.00 at Starbucks.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 2 — the ledger */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-sb-ink-muted uppercase">2 · Logged for you to approve</span>
        <div className="rounded-xl border border-sb-hairline overflow-hidden bg-sb-canvas">
          <div className="grid grid-cols-4 border-b border-sb-hairline px-3 py-2 text-[11px] font-semibold text-sb-ink-muted uppercase tracking-wide">
            <div>Date</div><div className="col-span-2">Merchant</div><div className="text-right">Amount</div>
          </div>
          <div className="divide-y divide-sb-hairline">
            <div
              className={cn(
                'grid grid-cols-4 px-3 py-2 text-xs items-center transition-colors duration-500',
                displayStep >= 3 ? 'bg-brand-500/10 opacity-100' : 'opacity-0 h-0 py-0 overflow-hidden'
              )}
            >
              <div className="text-sb-ink-muted text-[11px] tnum">Today</div>
              <div className="col-span-2">
                <div className="font-semibold text-sb-ink">Starbucks</div>
                <div className="text-[11px] text-brand-500">Food &amp; Dining</div>
              </div>
              <div className="text-right font-semibold text-sb-ink tnum">-₹250</div>
            </div>
            <div className="grid grid-cols-4 px-3 py-2 text-xs items-center">
              <div className="text-sb-ink-muted text-[11px] tnum">Yest.</div>
              <div className="col-span-2"><div className="font-medium text-sb-ink">Netflix</div><div className="text-[11px] text-sb-ink-muted">Subscription</div></div>
              <div className="text-right text-sb-ink tnum">-₹649</div>
            </div>
          </div>
        </div>
      </div>

      {/* 3 — the budget */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-semibold tracking-wide text-sb-ink-muted uppercase">3 · Budget, updated</span>
        <div className="rounded-xl border border-sb-hairline p-3.5 bg-sb-canvas flex flex-col gap-2.5">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-sb-ink">Food &amp; Dining</span>
            <span className="text-xs font-semibold text-sb-ink tnum">
              ₹{displayBudget.toLocaleString('en-IN')} <span className="text-sb-ink-muted font-normal">/ ₹{totalBudget.toLocaleString('en-IN')}</span>
            </span>
          </div>
          <div className="h-1.5 w-full bg-sb-hairline rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-brand-500 transition-[width] duration-700 ease-out"
              style={{ width: `${budgetPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] font-medium text-sb-ink-muted">
            <span>{budgetPercent.toFixed(0)}% used</span>
            <span className={cn('transition-colors duration-300', displayStep === 4 && 'text-brand-500 font-semibold')}>
              {displayStep === 4 ? '+₹250 just now' : `₹${(totalBudget - displayBudget).toLocaleString('en-IN')} left`}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
