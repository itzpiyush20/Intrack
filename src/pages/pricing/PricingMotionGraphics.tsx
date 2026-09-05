import { useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { 
  ShieldCheck, 
  Lock, 
  Sparkles, 
  Coffee, 
  ChevronDown, 
  CreditCard,
  Zap,
  RotateCcw
} from 'lucide-react'
import { cn } from '@/utils'

/**
 * Subtle radiant emerald ambient background glow for the Pricing header.
 */
export function PricingAmbientBackground() {
  const reduce = useReducedMotion()

  if (reduce) {
    return (
      <div 
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-5xl h-72 bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(14,122,93,0.12),transparent_70%)] pointer-events-none" 
        aria-hidden="true" 
      />
    )
  }

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-6xl h-80 bg-[radial-gradient(ellipse_75%_55%_at_50%_-10%,rgba(14,122,93,0.14),transparent_70%)]" />
      <motion.div
        animate={{
          x: [-15, 15, -15],
          y: [-8, 12, -8],
          scale: [1, 1.05, 1],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-6 left-1/3 w-80 h-80 rounded-full bg-brand-500/5 blur-3xl"
      />
      <motion.div
        animate={{
          x: [15, -15, 15],
          y: [10, -10, 10],
          scale: [1.05, 1, 1.05],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        className="absolute top-10 right-1/3 w-80 h-80 rounded-full bg-brand-400/5 blur-3xl"
      />
    </div>
  )
}

/**
 * Interactive Cost-to-Value Comparison Component.
 * Shows how Intrack's ₹1/day compares to everyday discretionary purchases.
 */
export function CostToValueVisual() {
  const [selectedItem, setSelectedItem] = useState<number>(0)

  const comparisons = [
    { label: 'Cutting Chai', cost: 15, desc: 'Single tea tap' },
    { label: 'Filter Coffee', cost: 80, desc: 'Cafe beverage' },
    { label: 'Swiggy Delivery', cost: 240, desc: 'Average food order' },
    { label: 'OTT Subscription', cost: 649, desc: 'Monthly streaming' },
  ]

  const current = comparisons[selectedItem]
  const intrackDailyCost = 1
  const ratio = Math.round(current.cost / intrackDailyCost)
  const percentSaved = Math.round(((current.cost - intrackDailyCost) / current.cost) * 100)

  return (
    <div className="rounded-3xl border border-sb-hairline bg-surface-1 p-6 sm:p-8 shadow-sm relative overflow-hidden">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-sb-hairline pb-5 mb-6">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-600 mb-1">
            <Sparkles className="w-3.5 h-3.5 text-brand-500" />
            <span>Perspective &amp; Return On Investment</span>
          </div>
          <h3 className="text-xl font-bold text-sb-ink">The ₹1 / Day Reality Check</h3>
          <p className="text-xs sm:text-sm text-sb-ink-secondary mt-1">
            Compare Intrack's full autonomous finance suite with everyday expenses.
          </p>
        </div>

        {/* Selected badge */}
        <div className="flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 px-3.5 py-1.5 rounded-2xl shrink-0 self-start sm:self-auto">
          <Coffee className="w-4 h-4 text-brand-600" />
          <span className="text-xs font-bold text-brand-700">
            1 Day = ₹1.00
          </span>
        </div>
      </div>

      {/* Comparison Selector Chips */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6">
        {comparisons.map((item, idx) => {
          const isSelected = selectedItem === idx
          return (
            <button
              key={item.label}
              type="button"
              onClick={() => setSelectedItem(idx)}
              className={cn(
                'flex flex-col p-3 rounded-xl border text-left transition-all cursor-pointer bg-transparent',
                isSelected
                  ? 'bg-surface-2 border-brand-500/50 shadow-sm ring-1 ring-brand-500/20'
                  : 'border-sb-hairline bg-surface-1 hover:bg-surface-2/50 text-sb-ink-muted'
              )}
            >
              <span className="text-xs font-semibold text-sb-ink">{item.label}</span>
              <span className="text-[11px] font-mono text-sb-ink-muted mt-0.5">₹{item.cost}</span>
            </button>
          )
        })}
      </div>

      {/* Animated Visual Gauge */}
      <div className="p-5 rounded-2xl bg-surface-2/50 border border-sb-hairline space-y-4">
        <div className="flex items-center justify-between text-xs font-bold">
          <span className="text-sb-ink">{current.label} (₹{current.cost}) vs Intrack (₹1/day)</span>
          <span className="text-brand-600 font-mono">1 Intrack Day = {(100 / ratio).toFixed(1)}% of cost</span>
        </div>

        {/* Dual Bar Graphic */}
        <div className="space-y-2">
          {/* Competitor / Daily Spends bar */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-sb-ink-muted w-24 shrink-0 truncate">{current.label}</span>
            <div className="flex-1 h-3 rounded-full bg-surface-1 border border-sb-hairline overflow-hidden">
              <div className="h-full bg-slate-300 rounded-full w-full" />
            </div>
            <span className="text-xs font-mono font-semibold text-sb-ink w-14 text-right">₹{current.cost}</span>
          </div>

          {/* Intrack Bar */}
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-bold text-brand-600 w-24 shrink-0 truncate">Intrack</span>
            <div className="flex-1 h-3 rounded-full bg-surface-1 border border-sb-hairline overflow-hidden">
              <motion.div
                key={selectedItem}
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(4, Math.min(100, (1 / current.cost) * 100))}%` }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
                className="h-full bg-brand-500 rounded-full"
              />
            </div>
            <span className="text-xs font-mono font-bold text-brand-600 w-14 text-right">₹1.00</span>
          </div>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs text-sb-ink-secondary gap-2 border-t border-sb-hairline">
          <span>
            Intrack gives you 24 hours of autonomous transaction bookkeeping for <strong className="text-brand-700">{ratio}x less</strong> than one {current.label.toLowerCase()}.
          </span>
          <span className="font-semibold text-brand-600 shrink-0 bg-brand-500/10 px-2.5 py-0.5 rounded-full border border-brand-500/20">
            {percentSaved}% Less Than {current.label}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * High-Trust Telemetry Ribbon.
 */
export function TrustTelemetryRibbon() {
  const items = [
    { icon: ShieldCheck, title: '100% Read-Only', desc: 'Google-verified OAuth scope' },
    { icon: Lock, title: 'No Bank Credentials', desc: 'Never asks for passwords or PINs' },
    { icon: CreditCard, title: 'Razorpay Protected', desc: '256-bit encrypted checkout' },
    { icon: RotateCcw, title: '7-Day Refund Policy', desc: 'Full refund, no questions asked' },
  ]

  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div
            key={item.title}
            className="flex items-start gap-3 p-4 rounded-2xl bg-surface-1 border border-sb-hairline shadow-sm"
          >
            <div className="w-8 h-8 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 shrink-0 mt-0.5">
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-sb-ink">{item.title}</div>
              <p className="text-[11px] text-sb-ink-muted mt-0.5 leading-snug">{item.desc}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Interactive Pricing FAQ Accordion.
 */
export function PricingFaqAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  const faqs = [
    {
      q: 'Will my card or bank account be charged automatically on renewal?',
      a: 'No. Both the Monthly and Yearly plans are strictly ONE-TIME payments. We do not place recurring auto-debit mandates or e-mandates on your card or UPI handle. When your plan expires, access simply pauses until you choose to renew.',
    },
    {
      q: 'What happens when my free 7-day trial ends?',
      a: 'You can explore all features free for 7 days with no credit card required. When the trial ends, automation pauses. Your historical transactions, budgets, and categorization tags remain completely safe and are never deleted.',
    },
    {
      q: 'Can I extend or renew my plan before my current one expires?',
      a: 'Yes! When you buy a plan while already having active days, our server seamlessly queues the new plan to begin the exact day your existing plan concludes. You never lose any prepaid time.',
    },
    {
      q: 'How does the 7-day refund guarantee work?',
      a: 'If you are unsatisfied for any reason within 7 days of your payment, email support@intrack.co.in or contact us via in-app support. We issue a 100% full refund directly through Razorpay, no questions asked.',
    },
    {
      q: 'Which payment methods do you accept?',
      a: 'Through Razorpay, we accept all Indian UPI applications (Google Pay, PhonePe, Paytm, CRED, BHIM), RuPay, Visa, Mastercard, and NetBanking across 50+ Indian commercial and public sector banks.',
    },
  ]

  return (
    <div className="rounded-3xl border border-sb-hairline bg-surface-1 p-6 sm:p-8 space-y-4">
      <div className="text-center max-w-xl mx-auto mb-6">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-600 mb-1">
          <Zap className="w-3.5 h-3.5 text-brand-500" />
          Frequently Asked Questions
        </div>
        <h3 className="text-2xl font-bold text-sb-ink">Everything you need to know</h3>
      </div>

      <div className="space-y-3 max-w-2xl mx-auto">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx
          return (
            <div
              key={idx}
              className="rounded-xl border border-sb-hairline bg-surface-2/40 overflow-hidden transition-colors"
            >
              <button
                type="button"
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                className="w-full text-left px-5 py-4 flex items-center justify-between gap-4 cursor-pointer bg-transparent border-0"
                aria-expanded={isOpen}
              >
                <span className="text-xs sm:text-sm font-bold text-sb-ink">{faq.q}</span>
                <ChevronDown
                  className={cn(
                    'w-4 h-4 text-sb-ink-muted shrink-0 transition-transform duration-200',
                    isOpen && 'rotate-180 text-brand-600'
                  )}
                />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  >
                    <div className="px-5 pb-4 pt-1 border-t border-sb-hairline/60 text-xs sm:text-sm text-sb-ink-secondary leading-relaxed">
                      {faq.a}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )
        })}
      </div>
    </div>
  )
}
