import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/context'
import { ROUTES, FAQ_ITEMS } from '@/constants'
import { Capacitor } from '@capacitor/core'
import { cn } from '@/utils'
import { useScrollReveal } from '@/hooks'
import { setPageMeta } from '@/utils/seo'
import { SiteFooter, MarketingHeader } from '@/components/ui'
import { 
  Zap, 
  ShieldCheck, 
  Landmark, 
  Wallet, 
  RefreshCw, 
  Lock, 
  Bell, 
  Sparkles, 
  ArrowRight, 
  CheckCircle2, 
  KeyRound, 
  EyeOff, 
  Database 
} from 'lucide-react'
import { 
  InteractionSimulation, 
  HeroAmbientBackground, 
  FloatingHeroBadges, 
  LiveTransactionTicker, 
  SubscriptionRadarVisual, 
  CreditCardFanVisual, 
  AnimatedBurndownVisual, 
  OAuthShieldVisual 
} from './landing'

export default function LandingPage() {
  const { user, loading, openAuthModal } = useAuth()
  const navigate = useNavigate()
  const [downloadTab, setDownloadTab] = useState<'android' | 'ios'>('android')
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  // Rotating words for Hero sub-headline
  const rotatingWords = ['expenses', 'budgets', 'subscriptions', 'cashflow']
  const [wordIndex, setWordIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % rotatingWords.length)
    }, 2600)
    return () => clearInterval(interval)
  }, [rotatingWords.length])

  const rotatingWord = rotatingWords[wordIndex]

  // Scroll reveal
  useScrollReveal()

  useEffect(() => {
    if (loading) return

    if (Capacitor.isNativePlatform()) {
      if (user) navigate(ROUTES.DASHBOARD || '/dashboard', { replace: true })
      else openAuthModal(undefined, 'login')
      return
    }

    if (!user) return
    let isStandalone: boolean
    try {
      isStandalone =
        window.matchMedia?.('(display-mode: standalone)').matches ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    } catch {
      isStandalone = false
    }
    if (isStandalone) navigate(ROUTES.DASHBOARD || '/dashboard', { replace: true })
  }, [user, loading, navigate, openAuthModal])

  useEffect(() => {
    setPageMeta({
      title: 'Intrack | Autonomous Finance & Expense Intelligence',
      description: "Intrack securely transforms your bank's transaction alert emails into real-time expenses, budgets, and subscriptions — waiting for your one-tap approval.",
      canonicalPath: '/',
    })
    if (!window.location.hash) window.scrollTo(0, 0)
  }, [])

  const supportedBanks = [
    { name: 'ICICI Bank', dot: '#f97316' },
    { name: 'HDFC Bank', dot: '#2563eb' },
    { name: 'State Bank of India', dot: '#0ea5e9' },
    { name: 'Axis Bank', dot: '#991b1b' },
    { name: 'Kotak Mahindra', dot: '#dc2626' },
    { name: 'Google Pay', dot: '#10b981' },
    { name: 'PhonePe', dot: '#7c3aed' },
    { name: 'Paytm', dot: '#06b6d4' },
    { name: 'CRED', dot: '#18181b' },
    { name: 'Jupiter', dot: '#f59e0b' },
    { name: 'Fi Money', dot: '#059669' },
    { name: 'IndusInd Bank', dot: '#b91c1c' },
    { name: 'Yes Bank', dot: '#2563eb' },
    { name: 'Bank of Baroda', dot: '#ea580c' },
    { name: 'Punjab National Bank', dot: '#b45309' },
  ]

  const workflowSteps = [
    {
      num: '01',
      title: 'Connect Gmail in 60 Seconds',
      desc: 'Authorize read-only access with Google OAuth. Intrack exclusively listens for transaction alert notifications — never touching personal correspondence.',
      icon: KeyRound,
      badge: 'Read-Only Security',
      component: <OAuthShieldVisual />,
    },
    {
      num: '02',
      title: 'Autonomous AI Extraction',
      desc: 'When an alert arrives, our machine learning engine identifies the merchant, amount, category, and payment method in milliseconds.',
      icon: Sparkles,
      badge: 'Zero Manual Entry',
      component: (
        <div className="relative w-full h-36 rounded-xl border border-sb-hairline bg-surface-2/50 overflow-hidden p-3 flex flex-col justify-between select-none">
          <div className="flex items-center justify-between text-[11px] font-semibold text-sb-ink-muted">
            <span>Raw Bank Alert Text</span>
            <span className="text-brand-600 bg-brand-500/10 px-1.5 py-0.5 rounded font-mono">Parsed 42ms</span>
          </div>
          <div className="relative overflow-hidden p-2 rounded bg-surface-1 border border-sb-hairline text-xs font-mono text-sb-ink-secondary">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-brand-500/15 to-transparent animate-[shimmer_2s_infinite]" />
            UPI debit of ₹250.00 at Starbucks Coffee. Ref: 4892019482.
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="text-[10px] font-bold text-brand-700 bg-brand-500/15 border border-brand-500/30 px-2 py-0.5 rounded">Starbucks</span>
            <span className="text-[10px] font-bold text-brand-700 bg-brand-500/15 border border-brand-500/30 px-2 py-0.5 rounded">₹250.00</span>
            <span className="text-[10px] font-bold text-brand-700 bg-brand-500/15 border border-brand-500/30 px-2 py-0.5 rounded">Food &amp; Dining</span>
          </div>
        </div>
      ),
    },
    {
      num: '03',
      title: 'One-Tap Review & Live Sync',
      desc: 'Transactions arrive in Pending for your quick confirmation. One tap reconciles your ledger, updates your budgets, and balances monthly allowances.',
      icon: CheckCircle2,
      badge: 'Real-Time Reconciled',
      component: (
        <div className="relative w-full h-36 rounded-xl border border-sb-hairline bg-surface-2/50 p-3.5 flex flex-col justify-between select-none">
          <div className="flex items-center justify-between text-[11px] font-bold text-sb-ink">
            <span>Live Budget Reconciliation</span>
            <span className="text-brand-600">85% of Budget</span>
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-sb-ink-secondary">Food &amp; Dining</span>
              <span className="font-mono text-brand-600 tnum">+₹250 Synced</span>
            </div>
            <div className="h-2 w-full bg-surface-1 rounded-full overflow-hidden border border-sb-hairline">
              <motion.div 
                className="h-full bg-brand-500 rounded-full" 
                initial={{ width: '75%' }} 
                animate={{ width: '85%' }} 
                transition={{ duration: 1.5, repeat: Infinity, repeatType: 'reverse' }} 
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-[10px] text-sb-ink-muted">
            <span>Remaining: ₹750</span>
            <span className="font-semibold text-brand-600">Auto-balanced</span>
          </div>
        </div>
      ),
    },
  ]

  const trustPillars = [
    {
      icon: Lock,
      title: 'Strictly Read-Only Scope',
      desc: 'Our Google-verified OAuth integration has read-only permission limited to email alerts. Intrack cannot compose, send, modify, or delete your emails.',
    },
    {
      icon: ShieldCheck,
      title: 'Zero Financial Credentials',
      desc: 'We never ask for your net-banking password, debit card PIN, or OTP. We have zero ability to transfer or withdraw funds from your accounts.',
    },
    {
      icon: EyeOff,
      title: 'Zero Data Monetization',
      desc: 'Your financial ledger is private to you. We do not sell data to advertisers, financial brokers, or credit bureaus. Ever.',
    },
    {
      icon: Database,
      title: 'Full Data Sovereignty',
      desc: 'Export your complete transaction history to encrypted CSV/JSON anytime. Permanently delete your account and all records in one click.',
    },
  ]

  const faqItems = FAQ_ITEMS

  return (
    <div className="min-h-screen bg-sb-canvas flex flex-col text-sb-ink page-enter selection:bg-brand-500/20 selection:text-brand-700 overflow-x-hidden w-full">
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      <MarketingHeader />

      <main id="main-content" className="w-full overflow-x-hidden">
        {/* ── HERO SECTION ───────────────────────────────────── */}
        <section className="relative pt-12 pb-16 md:pt-20 md:pb-28 border-b border-sb-hairline overflow-hidden">
          {/* Subtle Ambient Emerald Glow & Drifting Orbs */}
          <HeroAmbientBackground />

          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 relative z-10">
            <div className="grid lg:grid-cols-12 gap-12 lg:gap-14 items-center">
              {/* Left Column: Hero Content */}
              <div className="lg:col-span-7 max-w-2xl">
                {/* Brand Badge */}
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
                  className="inline-flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 rounded-full px-4 py-1.5 text-xs font-semibold text-brand-600 shadow-sm"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-brand-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-brand-500" />
                  </span>
                  Autonomous Wealth &amp; Expense Intelligence
                </motion.div>

                {/* Main Headline */}
                <motion.h1
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                  className="text-4xl sm:text-5xl lg:text-[58px] font-extrabold tracking-tight text-sb-ink leading-[1.12] mt-6"
                >
                  Your finances on autopilot.{' '}
                  <span className="text-brand-500 block sm:inline">Zero manual entry.</span>
                </motion.h1>

                {/* Subtitle */}
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="text-lg text-sb-ink-secondary leading-relaxed mt-6 max-w-xl"
                >
                  Intrack securely turns your bank's transaction alerts into real-time{' '}
                  <span className="inline-flex relative font-semibold text-brand-500 px-1 py-0.5 rounded bg-brand-500/10 border border-brand-500/20">
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={rotatingWord}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.22 }}
                      >
                        {rotatingWord}
                      </motion.span>
                    </AnimatePresence>
                  </span>
                  {' '}— merchant, amount, and category already filled in, waiting for your one-tap approval.
                </motion.p>

                {/* CTAs */}
                <motion.div
                  className="flex flex-wrap items-center gap-3.5 mt-8"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  {user ? (
                    <Link to={ROUTES.DASHBOARD} className="sb-btn-primary text-base px-6 py-3.5 no-underline shadow-md hover:shadow-lg transition-shadow">
                      Go to Dashboard <ArrowRight className="w-4 h-4 ml-1" />
                    </Link>
                  ) : (
                    <button
                      onClick={() => openAuthModal(undefined, 'signup')}
                      className="sb-btn-primary border-0 cursor-pointer text-base px-6 py-3.5 shadow-md hover:shadow-lg transition-all"
                    >
                      Start free — 7 days, no card <ArrowRight className="w-4 h-4 ml-1" />
                    </button>
                  )}
                  <a href="#how-it-works" className="sb-btn-secondary no-underline text-base px-5 py-3.5">
                    See how it works
                  </a>
                </motion.div>

                {/* High-Trust Metric Badges */}
                <motion.div
                  className="grid grid-cols-3 gap-4 pt-8 mt-10 border-t border-sb-hairline text-left"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5, delay: 0.4 }}
                >
                  <div>
                    <div className="text-base font-bold text-sb-ink">100% Read-Only</div>
                    <p className="text-xs text-sb-ink-muted mt-0.5">Never moves money</p>
                  </div>
                  <div>
                    <div className="text-base font-bold text-sb-ink">All Indian Banks</div>
                    <p className="text-xs text-sb-ink-muted mt-0.5">UPI, cards &amp; net-banking</p>
                  </div>
                  <div>
                    <div className="text-base font-bold text-sb-ink">Zero Passwords</div>
                    <p className="text-xs text-sb-ink-muted mt-0.5">No bank credentials ever</p>
                  </div>
                </motion.div>
              </div>

              {/* Right Column: Interactive Simulation with Floating Telemetry Badges */}
              <motion.div
                className="lg:col-span-5 relative flex justify-center lg:justify-end"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.6, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                <FloatingHeroBadges />
                <InteractionSimulation />
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── LIVE SIMULATED TRANSACTION STREAM ──────────────── */}
        <LiveTransactionTicker />

        {/* ── SUPPORTED BANKS & UPI APPS ─────────────────────── */}
        <section className="py-12 bg-sb-canvas border-b border-sb-hairline overflow-hidden">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-xs font-bold tracking-wider text-sb-ink-muted uppercase mb-2">
              Universal Indian Banking Compatibility
            </p>
            <h2 className="text-xl sm:text-2xl font-bold text-sb-ink mb-8">
              Works seamlessly with alerts from every bank &amp; UPI app
            </h2>

            {/* Seamless Infinite Marquee with Gradient Fade Edges */}
            <div 
              className="marquee-container select-none relative overflow-hidden"
              style={{
                maskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
                WebkitMaskImage: 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)',
              }}
            >
              <div className="marquee-content text-sm font-semibold tracking-tight text-sb-ink-secondary flex items-center gap-3">
                {/* Loop 1 */}
                {supportedBanks.map((bank) => (
                  <div
                    key={bank.name}
                    className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-surface-1 border border-sb-hairline hover:border-brand-500/40 hover:text-brand-600 transition-all shadow-sm shrink-0"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: bank.dot }} />
                    <span>{bank.name}</span>
                  </div>
                ))}
                {/* Loop 2 Duplicate */}
                {supportedBanks.map((bank) => (
                  <div
                    key={bank.name + '-dup'}
                    aria-hidden="true"
                    className="flex items-center gap-2.5 px-4 py-2 rounded-xl bg-surface-1 border border-sb-hairline hover:border-brand-500/40 hover:text-brand-600 transition-all shadow-sm shrink-0"
                  >
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: bank.dot }} />
                    <span>{bank.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-sb-ink-muted mt-6 max-w-xl mx-auto leading-normal">
              Intrack parses standard alert emails sent by these financial institutions. All trademarks and brand names remain the property of their respective owners.
            </p>
          </div>
        </section>

        {/* ── HOW IT WORKS ─────────────────────────────────── */}
        <section id="how-it-works" className="py-16 md:py-28 bg-sb-canvas-soft border-b border-sb-hairline">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div data-reveal className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-brand-600 mb-3">
                The Workflow
              </div>
              <h2 data-reveal data-delay="80" className="sb-display-lg text-sb-ink mb-4">
                Spend naturally. We handle the bookkeeping.
              </h2>
              <p data-reveal data-delay="150" className="text-sb-ink-secondary text-lg max-w-xl mx-auto leading-relaxed">
                Three effortless steps between payment and balanced budget.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-8">
              {workflowSteps.map((step, idx) => {
                const Icon = step.icon
                return (
                  <div
                    key={step.num}
                    data-reveal
                    data-delay={String(idx * 120)}
                    className="sb-card-light p-6 sm:p-7 flex flex-col justify-between relative group hover:shadow-lg transition-all duration-300 border border-sb-hairline bg-surface-1 gap-6"
                  >
                    <div>
                      <div className="flex items-center justify-between mb-5">
                        <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-brand-500/10 border border-brand-500/20 text-brand-600">
                          STEP {step.num}
                        </span>
                        <span className="text-[11px] font-semibold text-sb-ink-muted">
                          {step.badge}
                        </span>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center mb-4 text-brand-600 group-hover:scale-105 transition-transform">
                        <Icon className="w-5 h-5" />
                      </div>
                      <h3 className="text-lg font-bold text-sb-ink mb-2">{step.title}</h3>
                      <p className="text-sm text-sb-ink-secondary leading-relaxed">{step.desc}</p>
                    </div>

                    {/* Rich Visual Micro-Diagram */}
                    <div>
                      {step.component}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── BENTO FEATURES ───────────────────────────────── */}
        <section id="features" className="py-16 md:py-28 border-b border-sb-hairline bg-sb-canvas">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div data-reveal className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-brand-600 mb-3">
                Engineered For Clarity
              </div>
              <h2 data-reveal data-delay="80" className="sb-display-lg text-sb-ink mb-4">
                Everything you need to master your money.
              </h2>
              <p data-reveal data-delay="150" className="text-sb-ink-secondary text-lg max-w-xl mx-auto leading-relaxed">
                Smart automation designed with uncompromising privacy and precision.
              </p>
            </div>

            {/* Bento Grid Layout with Live Graphics */}
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {/* Feature 1: Large Span - Autonomous Alert Recognition */}
              <div data-reveal className="sm:col-span-2 sb-card-light p-6 sm:p-8 bg-surface-1 border border-sb-hairline flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 mb-5">
                    <Zap className="w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-bold text-sb-ink mb-2">Autonomous Alert Recognition</h3>
                  <p className="text-sm text-sb-ink-secondary max-w-xl leading-relaxed">
                    Connect Gmail once and trigger a scan whenever you please. Every coffee swipe, UPI QR transfer, and utility bill arrives with merchant name, exact amount, and category already classified.
                  </p>
                </div>
                <div className="mt-6 pt-5 border-t border-sb-hairline flex flex-wrap gap-2 text-xs font-semibold text-brand-600">
                  <span className="bg-surface-2 px-2.5 py-1 rounded-md">UPI Debits</span>
                  <span className="bg-surface-2 px-2.5 py-1 rounded-md">Credit Card Swipes</span>
                  <span className="bg-surface-2 px-2.5 py-1 rounded-md">Net-Banking Transfers</span>
                  <span className="bg-surface-2 px-2.5 py-1 rounded-md">Zero Manual Typing</span>
                </div>
              </div>

              {/* Feature 2: Bank-Grade Privacy */}
              <div data-reveal data-delay="100" className="sb-card-light p-6 sm:p-8 bg-surface-1 border border-sb-hairline flex flex-col justify-between">
                <div>
                  <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 mb-5">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-sb-ink mb-2">Read-Only Isolation</h3>
                  <p className="text-sm text-sb-ink-secondary leading-relaxed">
                    We never touch your banking portals, debit card numbers, or UPI PINs. Alerts are parsed in memory with enterprise security and never stored on external models.
                  </p>
                </div>
                <div className="mt-6 pt-4 border-t border-sb-hairline text-xs font-medium text-sb-ink-muted flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-brand-500" />
                  <span>Strictly Google OAuth Verified</span>
                </div>
              </div>

              {/* Feature 3: Smart Budgets with Live Burndown Visual */}
              <div data-reveal data-delay="150" className="sb-card-light p-6 sm:p-8 bg-surface-1 border border-sb-hairline flex flex-col justify-between gap-6">
                <div>
                  <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 mb-4">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-sb-ink mb-2">Real-Time Budget Guardrails</h3>
                  <p className="text-sm text-sb-ink-secondary leading-relaxed">
                    Set monthly limits per category with dynamic burndown tracking. Know immediately when dining out or shopping nears its allowance.
                  </p>
                </div>
                <AnimatedBurndownVisual />
              </div>

              {/* Feature 4: Subscription Radar with Sonar Visual */}
              <div data-reveal data-delay="200" className="sb-card-light p-6 sm:p-8 bg-surface-1 border border-sb-hairline flex flex-col justify-between gap-6">
                <div>
                  <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 mb-4">
                    <RefreshCw className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-sb-ink mb-2">Subscription Radar</h3>
                  <p className="text-sm text-sb-ink-secondary leading-relaxed">
                    Detect recurring subscriptions across Netflix, Spotify, cloud storage, and gym memberships. Spot price creep and forgotten trials.
                  </p>
                </div>
                <SubscriptionRadarVisual />
              </div>

              {/* Feature 5: Multi-Card & Bank Consolidation with 3D Stacked Fan */}
              <div data-reveal data-delay="250" className="sb-card-light p-6 sm:p-8 bg-surface-1 border border-sb-hairline flex flex-col justify-between gap-6">
                <div>
                  <div className="w-10 h-10 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 mb-4">
                    <Landmark className="w-5 h-5" />
                  </div>
                  <h3 className="text-lg font-bold text-sb-ink mb-2">Multi-Bank Consolidation</h3>
                  <p className="text-sm text-sb-ink-secondary leading-relaxed">
                    Consolidate multiple salary accounts, savings balances, and credit card expenses into one clean unified financial ledger.
                  </p>
                </div>
                <CreditCardFanVisual />
              </div>
            </div>
          </div>
        </section>

        {/* ── SECURITY & TRUST MANIFESTO ───────────────────── */}
        <section id="security" className="py-16 md:py-28 bg-sb-canvas-soft border-b border-sb-hairline">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16 max-w-2xl mx-auto">
              <div data-reveal className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-brand-600 mb-3">
                Security &amp; Privacy
              </div>
              <h2 data-reveal data-delay="80" className="sb-display-lg text-sb-ink mb-4">
                Your money, your privacy. Strictly protected.
              </h2>
              <p data-reveal data-delay="150" className="text-sb-ink-secondary text-base leading-relaxed">
                We believe financial clarity should never require surrendering your personal safety or handing credentials to third parties.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {trustPillars.map((pillar, idx) => {
                const Icon = pillar.icon
                return (
                  <div
                    key={pillar.title}
                    data-reveal
                    data-delay={String(idx * 80)}
                    className="sb-card-light p-6 bg-surface-1 border border-sb-hairline flex flex-col justify-between"
                  >
                    <div>
                      <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 mb-4">
                        <Icon className="w-5 h-5" />
                      </div>
                      <h3 className="text-base font-bold text-sb-ink mb-2">{pillar.title}</h3>
                      <p className="text-xs text-sb-ink-secondary leading-relaxed">{pillar.desc}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── PWA INSTALL GUIDE ────────────────────────────── */}
        <section id="install-guide" className="py-16 md:py-28 border-b border-sb-hairline bg-sb-canvas">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-14 items-center">
            <div className="space-y-6" data-reveal="from-left">
              <div className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-brand-600">
                PWA Technology
              </div>
              <h2 className="sb-display-lg text-sb-ink leading-tight">
                Add to your phone<br />in <span className="text-brand-500">60 seconds.</span>
              </h2>
              <p className="text-sb-ink-secondary leading-relaxed">
                Intrack is a modern Progressive Web App. No App Store downloads, APK installations, or delayed approvals. Fast, secure, and always updated.
              </p>
              <div className="space-y-3.5">
                {[
                  { icon: Zap, text: 'Instant home screen installation' },
                  { icon: Lock, text: 'Sandbox security with zero APK risks' },
                  { icon: Bell, text: 'Supports notification alerts for pending transactions' },
                ].map((item) => (
                  <div key={item.text} className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-600 shrink-0">
                      <item.icon className="h-4 w-4" />
                    </div>
                    <p className="text-sm text-sb-ink font-medium">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Platform Instructions Card */}
            <div className="sb-card-light overflow-hidden p-0 border border-sb-hairline shadow-md bg-surface-1" data-reveal="from-right">
              <div className="flex bg-surface-2 border-b border-sb-hairline">
                {(['android', 'ios'] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setDownloadTab(tab)}
                    className={cn(
                      'flex-1 py-3.5 text-sm font-semibold transition-all cursor-pointer border-0 bg-transparent flex items-center justify-center gap-2',
                      downloadTab === tab
                        ? 'text-brand-600 bg-surface-1 border-b-2 border-brand-500'
                        : 'text-sb-ink-muted hover:text-sb-ink'
                    )}
                  >
                    <span>{tab === 'android' ? 'Android (Chrome)' : 'iPhone (Safari)'}</span>
                  </button>
                ))}
              </div>
              <div className="p-7">
                <ol className="space-y-4">
                  {(downloadTab === 'android' ? [
                    'Open Chrome and navigate to the Intrack web app.',
                    'Tap the three dots (⋮) in the top-right corner.',
                    'Tap "Install app" or "Add to Home screen".',
                    'Confirm — the Intrack icon launches like a native app.',
                  ] : [
                    'Open Safari and navigate to the Intrack web app.',
                    'Tap the Share button at the bottom (square with arrow up).',
                    'Scroll down and select "Add to Home Screen".',
                    'Tap "Add" in the top-right corner — ready to go.',
                  ]).map((step, i) => (
                    <li key={i} className="flex gap-3.5 items-start">
                      <span className="h-5 w-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-600 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <p className="text-sm text-sb-ink-secondary leading-relaxed">{step}</p>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────── */}
        <section id="faq" className="py-16 md:py-28 border-b border-sb-hairline bg-sb-canvas-soft">
          <div className="mx-auto max-w-3xl px-4 sm:px-6">
            <div className="text-center mb-14">
              <div data-reveal className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-brand-600 mb-3">
                Frequently Asked Questions
              </div>
              <h2 data-reveal data-delay="80" className="sb-display-lg text-sb-ink">
                Common Questions Answered
              </h2>
            </div>
            <div className="space-y-3.5">
              {faqItems.map((item, idx) => {
                const isOpen = expandedFaq === idx
                return (
                  <div key={idx} data-reveal data-delay={String(idx * 50)} className="sb-card-light overflow-hidden p-0 border border-sb-hairline bg-surface-1">
                    <button
                      onClick={() => setExpandedFaq(isOpen ? null : idx)}
                      className="w-full text-left px-6 py-4.5 flex items-center justify-between cursor-pointer border-none bg-transparent hover:bg-surface-2/50 transition-colors"
                      aria-expanded={isOpen}
                      aria-controls={`faq-answer-${idx}`}
                      id={`faq-question-${idx}`}
                    >
                      <span className="text-base font-semibold text-sb-ink pr-4">{item.q}</span>
                      <motion.span
                        animate={{ rotate: isOpen ? 45 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-brand-500 text-xl font-bold shrink-0"
                      >
                        ＋
                      </motion.span>
                    </button>
                    <div id={`faq-answer-${idx}`} role="region" aria-labelledby={`faq-question-${idx}`}>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            key="content"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                            className="overflow-hidden"
                          >
                            <div className="px-6 pb-5 border-t border-sb-hairline pt-3.5">
                              <p className="text-sm text-sb-ink-secondary leading-relaxed">{item.a}</p>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── FINAL CALL TO ACTION ─────────────────────────── */}
        <section className="py-20 md:py-32 text-center border-b border-sb-hairline relative overflow-hidden bg-sb-canvas">
          <div 
            className="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_50%,rgba(14,122,93,0.12),transparent_70%)] pointer-events-none" 
            aria-hidden="true" 
          />
          <div className="mx-auto max-w-3xl px-4 sm:px-6 space-y-6 relative z-10">
            <h2 data-reveal="scale" className="sb-display-xl text-sb-ink">
              Take command of<br /><span className="text-brand-500">your financial life today.</span>
            </h2>
            <p data-reveal data-delay="100" className="text-lg text-sb-ink-secondary max-w-md mx-auto leading-relaxed">
              Join hundreds of mindful spenders. No credit card required. Free 7-day full access.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4 pt-4">
              {user ? (
                <Link to={ROUTES.DASHBOARD} className="sb-btn-primary text-base px-7 py-3.5 no-underline shadow-md">
                  Go to Dashboard →
                </Link>
              ) : (
                <button
                  onClick={() => openAuthModal(undefined, 'signup')}
                  className="sb-btn-primary border-0 cursor-pointer text-base px-8 py-3.5 shadow-md hover:shadow-lg transition-all"
                >
                  Start free trial — no card required →
                </button>
              )}
              <Link to={ROUTES.PRICING} className="sb-btn-secondary no-underline text-base px-6 py-3.5">
                View pricing plans
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter showWordmark className="px-4 sm:px-6 lg:px-8" />
    </div>
  )
}

