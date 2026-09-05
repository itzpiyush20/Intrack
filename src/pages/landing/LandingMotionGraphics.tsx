import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { ShieldCheck, Wifi, ArrowUpRight, CheckCircle2 } from 'lucide-react'

/**
 * Ambient background with subtle glowing emerald gradient orbs.
 */
export function HeroAmbientBackground() {
  const reduce = useReducedMotion()

  if (reduce) {
    return (
      <div 
        className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[550px] bg-[radial-gradient(ellipse_70%_50%_at_50%_0%,rgba(14,122,93,0.12),transparent_70%)] pointer-events-none" 
        aria-hidden="true" 
      />
    )
  }

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
      {/* Primary Top Radial */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[600px] bg-[radial-gradient(ellipse_75%_55%_at_50%_-10%,rgba(14,122,93,0.14),transparent_70%)]" />
      
      {/* Drifting subtle ambient orb 1 */}
      <motion.div
        animate={{
          x: [-20, 20, -20],
          y: [-10, 15, -10],
          scale: [1, 1.08, 1],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full bg-brand-500/5 blur-3xl"
      />

      {/* Drifting subtle ambient orb 2 */}
      <motion.div
        animate={{
          x: [25, -25, 25],
          y: [15, -15, 15],
          scale: [1.05, 1, 1.05],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        className="absolute top-1/3 right-1/4 w-[420px] h-[420px] rounded-full bg-brand-400/5 blur-3xl"
      />
    </div>
  )
}

/**
 * Floating telemetry micro-badges positioned around the hero preview.
 */
export function FloatingHeroBadges() {
  const reduce = useReducedMotion()

  return (
    <>
      {/* Top Floating Badge: Fast AI Parse */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 15 }}
        animate={reduce ? { opacity: 1, y: 0 } : { 
          opacity: 1, 
          y: [-4, 4, -4],
        }}
        transition={reduce ? {} : { 
          y: { duration: 4, repeat: Infinity, ease: 'easeInOut' },
          opacity: { duration: 0.5, delay: 0.4 }
        }}
        className="hidden sm:flex absolute -top-4 -right-4 z-20 items-center gap-2 px-3 py-2 rounded-xl bg-surface-1/95 backdrop-blur-md border border-brand-500/30 shadow-[0_8px_24px_rgba(14,122,93,0.15)] text-xs font-semibold text-sb-ink"
      >
        <span className="flex h-2 w-2 relative">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
        </span>
        <span>ICICI Alert Auto-Parsed</span>
        <span className="text-[10px] font-mono font-bold text-brand-600 bg-brand-500/15 px-1.5 py-0.5 rounded">42ms</span>
      </motion.div>

      {/* Bottom Floating Badge: Security Shield */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: -15 }}
        animate={reduce ? { opacity: 1, y: 0 } : { 
          opacity: 1, 
          y: [4, -4, 4],
        }}
        transition={reduce ? {} : { 
          y: { duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay: 0.8 },
          opacity: { duration: 0.5, delay: 0.6 }
        }}
        className="hidden sm:flex absolute -bottom-4 -left-4 z-20 items-center gap-2 px-3.5 py-2 rounded-xl bg-surface-1/95 backdrop-blur-md border border-sb-hairline shadow-[0_8px_24px_rgba(0,0,0,0.08)] text-xs font-semibold text-sb-ink"
      >
        <ShieldCheck className="w-4 h-4 text-brand-500" />
        <span>100% Read-Only Protected</span>
      </motion.div>
    </>
  )
}

/**
 * Live Simulated Transaction Stream Ticker.
 */
export function LiveTransactionTicker() {
  const simulatedFeed = [
    { bank: 'HDFC Bank', mode: 'UPI', merchant: 'Swiggy Food', amount: '₹340.00', time: 'Just now' },
    { bank: 'ICICI Bank', mode: 'Credit Card', merchant: 'Starbucks Coffee', amount: '₹250.00', time: '1m ago' },
    { bank: 'State Bank of India', mode: 'UPI QR', merchant: 'Apollo Pharmacy', amount: '₹620.00', time: '3m ago' },
    { bank: 'Axis Bank', mode: 'Auto-Debit', merchant: 'Netflix India', amount: '₹649.00', time: '5m ago' },
    { bank: 'Kotak Bank', mode: 'UPI', merchant: 'Chai Point', amount: '₹85.00', time: '8m ago' },
    { bank: 'Google Pay', mode: 'UPI Debit', merchant: 'Blinkit Groceries', amount: '₹415.00', time: '11m ago' },
  ]

  return (
    <div className="w-full overflow-hidden select-none py-3 border-y border-sb-hairline bg-surface-1/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-2 px-4 justify-center text-xs font-bold uppercase tracking-wider text-brand-600">
        <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
        Live Automated Stream Simulation
      </div>
      <div 
        className="marquee-container overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
        }}
      >
        <div className="marquee-content flex items-center gap-4 text-xs font-medium text-sb-ink-secondary">
          {simulatedFeed.concat(simulatedFeed).map((item, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-surface-1 border border-sb-hairline shrink-0 shadow-sm"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-brand-500" />
              <span className="font-bold text-sb-ink">{item.bank}</span>
              <span className="text-[11px] text-sb-ink-muted">({item.mode})</span>
              <span>→</span>
              <span className="font-medium text-sb-ink">{item.merchant}</span>
              <span className="font-bold text-brand-600 font-mono tnum">{item.amount}</span>
              <span className="text-[10px] text-sb-ink-muted bg-surface-2 px-1.5 py-0.5 rounded">{item.time}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Animated Circular Sonar Subscription Radar Graphic.
 */
export function SubscriptionRadarVisual() {
  const reduce = useReducedMotion()

  const subscriptions = [
    { name: 'Netflix', days: '3d left', x: '22%', y: '28%', dot: '#e50914' },
    { name: 'Spotify', days: '7d left', x: '68%', y: '24%', dot: '#1db954' },
    { name: 'Google One', days: '14d left', x: '62%', y: '64%', dot: '#4285f4' },
    { name: 'AWS Cloud', days: '22d left', x: '28%', y: '68%', dot: '#ff9900' },
  ]

  return (
    <div className="relative w-full h-44 rounded-xl border border-sb-hairline bg-surface-2/40 overflow-hidden flex items-center justify-center p-4 select-none">
      {/* Concentric Radar Rings */}
      <div className="absolute w-16 h-16 rounded-full border border-brand-500/20" />
      <div className="absolute w-28 h-28 rounded-full border border-brand-500/15" />
      <div className="absolute w-40 h-40 rounded-full border border-brand-500/10" />
      <div className="absolute w-full h-[1px] bg-brand-500/10" />
      <div className="absolute h-full w-[1px] bg-brand-500/10" />

      {/* Rotating Radar Sweep Needle */}
      {!reduce && (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <div 
            className="w-1/2 h-1/2 origin-bottom-right"
            style={{
              background: 'conic-gradient(from 0deg at 100% 100%, rgba(14, 122, 93, 0.25) 0deg, transparent 60deg)',
            }}
          />
        </motion.div>
      )}

      {/* Blip Items */}
      {subscriptions.map((sub, i) => (
        <div
          key={sub.name}
          className="absolute z-10 flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-1 border border-sb-hairline shadow-sm text-[10px] font-semibold text-sb-ink"
          style={{ left: sub.x, top: sub.y }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: sub.dot }} />
          <span>{sub.name}</span>
          <span className="text-[9px] text-brand-600 font-mono bg-brand-500/10 px-1 rounded">{sub.days}</span>
          {!reduce && (
            <motion.span
              animate={{ scale: [1, 1.8, 1], opacity: [0.8, 0, 0.8] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }}
              className="absolute -inset-0.5 rounded-md border border-brand-500/40 pointer-events-none"
            />
          )}
        </div>
      ))}
    </div>
  )
}

/**
 * 3D Stacked Credit Card Fan Graphic.
 */
export function CreditCardFanVisual() {
  const [isHovered, setIsHovered] = useState(false)
  const reduce = useReducedMotion()

  return (
    <div 
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="relative w-full h-44 rounded-xl border border-sb-hairline bg-surface-2/40 overflow-hidden flex items-center justify-center p-4 cursor-pointer select-none"
    >
      {/* Card 1: SBI SimplyCLICK */}
      <motion.div
        animate={reduce ? {} : isHovered ? { rotate: -14, x: -50, y: -5 } : { rotate: -8, x: -25, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="absolute w-44 h-28 rounded-xl bg-gradient-to-tr from-slate-900 to-slate-700 text-white p-3 shadow-md border border-white/10 flex flex-col justify-between"
      >
        <div className="flex justify-between items-center text-[10px] opacity-80">
          <span>SBI SimplyCLICK</span>
          <Wifi className="w-3 h-3 rotate-90" />
        </div>
        <div className="text-[11px] font-mono tracking-wider opacity-90">•••• 8912</div>
        <div className="flex justify-between items-center text-[9px] opacity-70">
          <span>PIYUSH G</span>
          <span className="font-bold">VISA</span>
        </div>
      </motion.div>

      {/* Card 2: ICICI Sapphiro */}
      <motion.div
        animate={reduce ? {} : isHovered ? { rotate: 0, y: -12 } : { rotate: 0, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="absolute w-44 h-28 rounded-xl bg-gradient-to-tr from-[#991b1b] to-[#dc2626] text-white p-3 shadow-lg border border-white/20 flex flex-col justify-between z-10"
      >
        <div className="flex justify-between items-center text-[10px] opacity-80">
          <span>ICICI Sapphiro</span>
          <span className="text-[8px] bg-white/20 px-1 py-0.5 rounded">UPI LINKED</span>
        </div>
        <div className="text-[11px] font-mono tracking-wider opacity-90">•••• 4092</div>
        <div className="flex justify-between items-center text-[9px] opacity-70">
          <span>PIYUSH G</span>
          <span className="font-bold">Mastercard</span>
        </div>
      </motion.div>

      {/* Card 3: HDFC Regalia Gold */}
      <motion.div
        animate={reduce ? {} : isHovered ? { rotate: 14, x: 50, y: -5 } : { rotate: 8, x: 25, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="absolute w-44 h-28 rounded-xl bg-gradient-to-tr from-[#0b6549] to-[#0e7a5d] text-white p-3 shadow-md border border-white/15 flex flex-col justify-between"
      >
        <div className="flex justify-between items-center text-[10px] opacity-80">
          <span>HDFC Regalia</span>
          <Wifi className="w-3 h-3 rotate-90" />
        </div>
        <div className="text-[11px] font-mono tracking-wider opacity-90">•••• 3190</div>
        <div className="flex justify-between items-center text-[9px] opacity-70">
          <span>PIYUSH G</span>
          <span className="font-bold">RuPay</span>
        </div>
      </motion.div>
    </div>
  )
}

/**
 * Animated Burndown Graph Visual for the Smart Budgets bento card.
 */
export function AnimatedBurndownVisual() {
  const reduce = useReducedMotion()

  return (
    <div className="relative w-full h-44 rounded-xl border border-sb-hairline bg-surface-1 p-3.5 flex flex-col justify-between select-none">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-sb-ink">Monthly Allowance Burndown</span>
        <span className="text-[11px] text-brand-600 font-semibold flex items-center gap-0.5">
          Healthy Pace <ArrowUpRight className="w-3 h-3" />
        </span>
      </div>

      {/* SVG Line Graph */}
      <div className="relative h-24 w-full flex items-end">
        <svg className="w-full h-full overflow-visible" viewBox="0 0 280 90">
          <defs>
            <linearGradient id="burndownFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0e7a5d" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#0e7a5d" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Target ceiling dashed line */}
          <line x1="0" y1="20" x2="280" y2="20" stroke="#d1d5db" strokeWidth="1" strokeDasharray="3 3" />
          
          {/* Area Fill */}
          <path
            d="M 0 85 L 35 70 L 80 75 L 130 55 L 180 50 L 230 35 L 280 30 L 280 90 L 0 90 Z"
            fill="url(#burndownFill)"
          />

          {/* Animated Main Line */}
          <motion.path
            d="M 0 85 L 35 70 L 80 75 L 130 55 L 180 50 L 230 35 L 280 30"
            fill="none"
            stroke="#0e7a5d"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.8, ease: 'easeOut' }}
          />

          {/* Pulsing Active Coordinate Point */}
          <circle cx="280" cy="30" r="4" fill="#0e7a5d" />
        </svg>

        {/* Floating marker */}
        <div className="absolute top-2 right-0 bg-surface-1 border border-brand-500/30 px-2 py-0.5 rounded shadow-sm text-[10px] font-bold text-brand-600 font-mono tnum">
          ₹4,250 / ₹5,000
        </div>
      </div>

      <div className="flex justify-between items-center text-[10px] text-sb-ink-muted border-t border-sb-hairline pt-2">
        <span>Day 1 (₹0)</span>
        <span>Day 15 (₹2.4k)</span>
        <span>Day 30 (Cap ₹5k)</span>
      </div>
    </div>
  )
}

/**
 * Animated OAuth Shield Graphic for How It Works step 1.
 */
export function OAuthShieldVisual() {
  const reduce = useReducedMotion()

  return (
    <div className="relative w-full h-36 rounded-xl border border-sb-hairline bg-surface-2/50 overflow-hidden flex items-center justify-center select-none">
      {/* Concentric Pulsing Rings */}
      <div className="absolute w-20 h-20 rounded-full border border-brand-500/20" />
      <div className="absolute w-32 h-32 rounded-full border border-brand-500/10" />

      {/* Verified Shield Centerpiece */}
      <div className="relative z-10 flex flex-col items-center">
        <div className="w-12 h-12 rounded-2xl bg-surface-1 border border-brand-500/30 shadow-md flex items-center justify-center text-brand-600 mb-2">
          <ShieldCheck className="w-6 h-6 text-brand-500" />
        </div>
        <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-600 text-[10px] font-bold border border-brand-500/20">
          <CheckCircle2 className="w-3 h-3 text-brand-500" />
          <span>Google OAuth Verified · Read-Only</span>
        </div>
      </div>

      {!reduce && (
        <motion.div
          animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          className="absolute w-24 h-24 rounded-full border border-brand-400/40 pointer-events-none"
        />
      )}
    </div>
  )
}
