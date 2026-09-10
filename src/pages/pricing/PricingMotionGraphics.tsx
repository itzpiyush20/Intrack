import { useState } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  ShieldCheck,
  Lock,
  ChevronDown,
  RotateCcw,
  Zap,
  Sparkles,
  Mail,
  Tags,
  Calendar,
  FileSpreadsheet,
  DownloadCloud,
} from 'lucide-react'
import { cn } from '@/utils'
import { APP_CONFIG, PRICING } from '@/constants'

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
 * Core product capabilities & benefits highlighting value before pricing cards.
 */
export const PRODUCT_FEATURES = [
  {
    icon: Mail,
    // "Autonomous" was wrong: automatic scanning was removed on 2026-08-27 and
    // every scan is user-initiated. The product reads and categorises for you —
    // it does not run on its own — so the copy says one-tap, not autonomous.
    title: 'One-Tap Bank Alert Sync',
    desc: 'Seamlessly reads transaction emails from 50+ Indian banks & UPI apps (HDFC, ICICI, SBI, Axis, Cred, Google Pay, Paytm). Zero manual entry.',
    tag: 'Read-only OAuth',
    highlight: '50+ Indian Banks & UPI',
  },
  {
    icon: Tags,
    title: 'Intelligent Auto-Categorization',
    desc: 'Sorts every expense into dining, groceries, utilities, and travel. Automatically cleans messy merchant strings and remembers your corrections.',
    tag: 'Learning Engine',
    highlight: 'Auto Merchant Cleanup',
  },
  {
    icon: Calendar,
    title: 'Subscription & Renewal Radar',
    desc: 'Detects upcoming recurring charges, subscriptions, and EMIs well in advance so you avoid unexpected debits and forgotten renewals.',
    tag: 'Proactive Alerts',
    highlight: 'Zero Surprise Debits',
  },
  {
    icon: FileSpreadsheet,
    title: 'Client-Side Statement Import',
    desc: 'Import HDFC, ICICI, SBI, and Axis CSV statements directly. Parsing runs 100% locally in your browser — your files never touch external servers.',
    tag: '100% Private',
    highlight: 'Zero Server Storage',
  },
  {
    icon: DownloadCloud,
    title: 'Instant Data Export & Zero Lock-in',
    desc: 'Download your entire financial ledger anytime as CSV or JSON. Cancel anytime in one click without retention calls or roadblocks.',
    tag: 'Full Ownership',
    highlight: 'One-Click CSV / JSON',
  },
  {
    icon: ShieldCheck,
    title: 'Bank-Grade Privacy Architecture',
    desc: 'Restricted read-only Google OAuth scope. We never request or store bank account passwords, debit/credit cards, PINs, or OTPs.',
    tag: 'Safe & Secure',
    highlight: 'Google-Verified Scope',
  },
]

export function PricingFeatureGrid({
  title = 'Everything you need for effortless finances',
  subtitle = 'Bank-grade intelligence built specifically for the Indian financial ecosystem. Included on every plan.',
}: {
  title?: string
  subtitle?: string
}) {
  const reduce = useReducedMotion()

  return (
    <section className="space-y-6" data-reveal>
      <div className="text-center max-w-2xl mx-auto">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-600 mb-1.5 px-3 py-1 rounded-full bg-brand-500/10 border border-brand-500/20 font-mono">
          <Sparkles className="w-3.5 h-3.5 text-brand-500" />
          <span>Platform Capabilities</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight font-display text-sb-ink">
          {title}
        </h2>
        <p className="text-xs sm:text-sm text-sb-ink-secondary mt-1.5 leading-relaxed">
          {subtitle}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
        {PRODUCT_FEATURES.map((feat) => {
          const Icon = feat.icon
          return (
            <motion.div
              key={feat.title}
              whileHover={reduce ? undefined : { y: -3, transition: { duration: 0.2 } }}
              className="p-5 sm:p-6 rounded-2xl border border-sb-hairline bg-surface-1 shadow-xs hover:border-brand-500/35 hover:shadow-md transition-all flex flex-col justify-between group relative overflow-hidden"
            >
              <div>
                <div className="flex items-center justify-between mb-3.5">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500/15 to-brand-500/5 text-brand-600 flex items-center justify-center border border-brand-500/20 group-hover:scale-105 group-hover:border-brand-500/40 transition-all">
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-600 bg-brand-500/10 px-2 py-0.5 rounded border border-brand-500/20 font-mono">
                    {feat.tag}
                  </span>
                </div>
                <h3 className="text-sm sm:text-base font-bold text-sb-ink mb-1.5 tracking-tight group-hover:text-brand-600 transition-colors">
                  {feat.title}
                </h3>
                <p className="text-xs text-sb-ink-secondary leading-relaxed mb-4">
                  {feat.desc}
                </p>
              </div>

              <div className="pt-3 border-t border-sb-hairline/60 flex items-center justify-between text-[11px] font-mono text-sb-ink-muted">
                <span className="text-brand-600 font-semibold">{feat.highlight}</span>
                <span className="opacity-40 font-sans">100% Unlocked</span>
              </div>
            </motion.div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Compact trust indicator pills for below the pricing cards.
 * Uses CSS scroll-reveal (data-reveal) for entrance animation.
 */
export function PricingTrustPills() {
  const items = [
    { icon: ShieldCheck, text: 'Cancel anytime, one click' },
    { icon: RotateCcw, text: '7-day full refund policy' },
    { icon: Lock, text: 'Read-only OAuth, no passwords' },
  ]

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4" data-reveal>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div
            key={item.text}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-sb-hairline bg-surface-1 shadow-xs text-xs font-medium text-sb-ink-secondary"
          >
            <Icon className="w-3.5 h-3.5 text-brand-600 shrink-0" />
            <span>{item.text}</span>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Interactive FAQ Accordion tailored for Pricing.
 * Uses CSS scroll-reveal for entrance, framer-motion for expand/collapse.
 */
export function PricingFaqAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(0)

  const faqs = [
    {
      q: 'Will my card or bank account be charged automatically on renewal?',
      a: `Yes. Both the Monthly and Yearly plans auto-renew — we register a UPI Autopay or card e-mandate at checkout, and Razorpay charges it automatically each cycle (₹${PRICING.MONTHLY_AMOUNT}/month or ₹${PRICING.ANNUAL_AMOUNT}/year) until you cancel. Razorpay sends a pre-debit notification before every charge. You can cancel anytime from Settings → Plan & Billing — future charges stop immediately, and your access continues until the end of the period you already paid for.`,
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
      q: 'How does the 7-day refund policy work?',
      a: `Contact us within 7 days of a charge — email ${APP_CONFIG.SUPPORT_EMAIL} or use in-app support — and we will refund it in full to your original payment method. A refund also cancels your subscription and ends access immediately.`,
    },
    {
      q: 'Which payment methods do you accept?',
      a: 'Through our secure payment gateway partner, we accept all Indian UPI applications (Google Pay, PhonePe, Paytm, CRED, BHIM), RuPay, Visa, Mastercard, and NetBanking across 50+ Indian commercial and public sector banks.',
    },
  ]

  return (
    <div className="space-y-4" data-reveal>
      <div className="text-center max-w-xl mx-auto mb-2">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-brand-600 mb-1">
          <Zap className="w-3.5 h-3.5 text-brand-500" />
          Frequently Asked Questions
        </div>
        <h3 className="text-xl sm:text-2xl font-bold text-sb-ink">Everything you need to know</h3>
      </div>

      <div className="space-y-2.5 max-w-2xl mx-auto">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx
          return (
            <div
              key={idx}
              className="rounded-xl border border-sb-hairline bg-surface-1 overflow-hidden transition-colors"
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
