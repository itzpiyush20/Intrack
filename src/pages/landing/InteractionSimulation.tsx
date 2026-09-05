import { useState, useEffect } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { ShieldCheck, Sparkles, CheckCircle2, ArrowRight, Wallet, BellRing } from 'lucide-react'
import { cn } from '@/utils'

export function InteractionSimulation() {
  const reduceMotion = useReducedMotion()
  const [step, setStep] = useState(0)
  const [isPaused, setIsPaused] = useState(false)

  const steps = [
    { id: 0, label: 'Alert Arrives', icon: BellRing },
    { id: 1, label: 'AI Extraction', icon: Sparkles },
    { id: 2, label: 'One-Tap Review', icon: CheckCircle2 },
    { id: 3, label: 'Budget Synced', icon: Wallet },
  ]

  // Auto-play loop when not paused and not prefers-reduced-motion
  useEffect(() => {
    if (reduceMotion || isPaused) return
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % steps.length)
    }, 2800)
    return () => clearInterval(timer)
  }, [reduceMotion, isPaused, steps.length])

  const activeStep = reduceMotion ? 3 : step
  const totalBudget = 5000
  const budgetSpent = activeStep === 3 ? 4250 : 4000
  const budgetPercent = (budgetSpent / totalBudget) * 100

  return (
    <div
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className="relative w-full max-w-[480px] rounded-2xl border border-sb-hairline bg-surface-1 p-5 sm:p-6 shadow-[0_12px_40px_-8px_rgba(14,122,93,0.12),0_4px_16px_rgba(0,0,0,0.06)] select-none transition-shadow"
    >
      {/* Top Console Bar */}
      <div className="flex items-center justify-between border-b border-sb-hairline pb-3.5 mb-4">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
          </span>
          <span className="text-xs font-semibold text-sb-ink">Live Simulation</span>
          <span className="text-[11px] text-sb-ink-muted">· Read-only pipeline</span>
        </div>
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-600 border border-brand-500/20 text-[11px] font-semibold">
          <ShieldCheck className="w-3 h-3 text-brand-500" />
          Bank-Grade Isolated
        </div>
      </div>

      {/* Step Visualizer / State Screens */}
      <div className="min-h-[220px] flex flex-col justify-between">
        <AnimatePresence mode="wait">
          {activeStep === 0 && (
            <motion.div
              key="step-0"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between text-xs text-sb-ink-muted font-medium">
                <span>Stage 1 · Bank Alert Email Inbound</span>
                <span className="text-[11px] bg-surface-2 px-2 py-0.5 rounded text-sb-ink-secondary">Instant</span>
              </div>
              <div className="rounded-xl border border-brand-500/20 bg-brand-500/5 p-4 relative overflow-hidden">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg bg-white border border-brand-500/30 flex items-center justify-center font-bold text-brand-600 shadow-sm shrink-0">
                    ₹
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-sb-ink">ICICI Bank Alert</span>
                      <span className="text-[10px] font-medium text-brand-600 bg-brand-500/15 px-1.5 py-0.5 rounded">Just Now</span>
                    </div>
                    <p className="text-xs text-sb-ink-secondary font-medium leading-relaxed">
                      UPI transaction of <span className="font-bold text-sb-ink">₹250.00</span> at Starbucks Coffee Mumbai. Ref: 4892019482.
                    </p>
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-brand-500/15 flex items-center justify-between text-[11px] text-sb-ink-muted">
                  <span>From: alerts@icicibank.com</span>
                  <span className="font-mono text-brand-600">A/c XX4092</span>
                </div>
              </div>
            </motion.div>
          )}

          {activeStep === 1 && (
            <motion.div
              key="step-1"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between text-xs text-sb-ink-muted font-medium">
                <span>Stage 2 · Autonomous Entity Extraction</span>
                <span className="text-[11px] text-brand-600 font-semibold flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> 99.4% Confidence
                </span>
              </div>
              <div className="rounded-xl border border-sb-hairline bg-surface-2/60 p-4 space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div className="bg-surface-1 border border-sb-hairline p-2.5 rounded-lg">
                    <span className="text-[10px] uppercase font-semibold text-sb-ink-muted block mb-0.5">Merchant</span>
                    <span className="text-xs font-bold text-sb-ink">Starbucks Coffee</span>
                  </div>
                  <div className="bg-surface-1 border border-sb-hairline p-2.5 rounded-lg">
                    <span className="text-[10px] uppercase font-semibold text-sb-ink-muted block mb-0.5">Amount</span>
                    <span className="text-xs font-bold text-sb-ink tnum">₹250.00</span>
                  </div>
                  <div className="bg-surface-1 border border-brand-500/30 p-2.5 rounded-lg bg-brand-500/5">
                    <span className="text-[10px] uppercase font-semibold text-brand-600 block mb-0.5">Category</span>
                    <span className="text-xs font-bold text-brand-700">Food & Dining</span>
                  </div>
                  <div className="bg-surface-1 border border-sb-hairline p-2.5 rounded-lg">
                    <span className="text-[10px] uppercase font-semibold text-sb-ink-muted block mb-0.5">Payment Method</span>
                    <span className="text-xs font-medium text-sb-ink">UPI · ICICI</span>
                  </div>
                </div>
                <div className="text-[11px] text-sb-ink-muted flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
                  <span>Parsed in 42ms · Zero human entry required</span>
                </div>
              </div>
            </motion.div>
          )}

          {activeStep === 2 && (
            <motion.div
              key="step-2"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between text-xs text-sb-ink-muted font-medium">
                <span>Stage 3 · One-Tap Approval</span>
                <span className="text-[11px] text-brand-600 font-semibold">1 Pending Review</span>
              </div>
              <div className="rounded-xl border border-sb-hairline bg-surface-1 overflow-hidden">
                <div className="p-3 bg-brand-500/10 border-b border-brand-500/20 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-sb-ink">Starbucks Coffee</div>
                    <div className="text-[11px] text-brand-600 font-medium">Food & Dining · Today</div>
                  </div>
                  <div className="text-right flex items-center gap-3">
                    <span className="text-xs font-bold text-sb-ink tnum">-₹250.00</span>
                    <button
                      type="button"
                      className="px-2.5 py-1 rounded-md bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold flex items-center gap-1 shadow-sm border-0 cursor-pointer transition-colors"
                    >
                      Approve <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <div className="p-3 divide-y divide-sb-hairline text-xs opacity-60">
                  <div className="flex items-center justify-between py-1">
                    <div>
                      <span className="font-medium text-sb-ink">Netflix Premium</span>
                      <span className="text-[10px] text-sb-ink-muted block">Subscription · Yesterday</span>
                    </div>
                    <span className="font-semibold text-sb-ink tnum">-₹649.00</span>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeStep === 3 && (
            <motion.div
              key="step-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="space-y-3"
            >
              <div className="flex items-center justify-between text-xs text-sb-ink-muted font-medium">
                <span>Stage 4 · Monthly Budget Auto-Reconciled</span>
                <span className="text-[11px] text-brand-600 font-semibold">Live Update</span>
              </div>
              <div className="rounded-xl border border-sb-hairline bg-surface-1 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-sb-ink">Food & Dining Budget</span>
                    <span className="text-[11px] text-sb-ink-muted block">March Monthly Allowance</span>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-sb-ink tnum">
                      ₹{budgetSpent.toLocaleString('en-IN')}
                    </span>
                    <span className="text-[11px] text-sb-ink-muted"> / ₹{totalBudget.toLocaleString('en-IN')}</span>
                  </div>
                </div>
                <div className="h-2 w-full bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-[width] duration-700 ease-out"
                    style={{ width: `${budgetPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-sb-ink-muted">{budgetPercent.toFixed(0)}% utilized</span>
                  <span className="font-semibold text-brand-600">+₹250 reconciled automatically</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Interactive Step Selector Controls */}
      <div className="pt-4 mt-4 border-t border-sb-hairline">
        <div className="grid grid-cols-4 gap-1.5 bg-surface-2 p-1 rounded-xl">
          {steps.map((s) => {
            const Icon = s.icon
            const isCurrent = activeStep === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setStep(s.id)}
                className={cn(
                  'flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg text-[11px] font-medium transition-all cursor-pointer border-0',
                  isCurrent
                    ? 'bg-surface-1 text-brand-600 shadow-sm font-semibold'
                    : 'bg-transparent text-sb-ink-muted hover:text-sb-ink'
                )}
                aria-label={`Show ${s.label}`}
              >
                <Icon className={cn('w-3 h-3', isCurrent ? 'text-brand-500' : 'text-sb-ink-muted')} />
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
