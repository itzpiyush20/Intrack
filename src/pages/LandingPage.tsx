import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuth } from '@/context'
import { ROUTES, FAQ_ITEMS } from '@/constants'
import { Capacitor } from '@capacitor/core'
import { cn } from '@/utils'
import { useScrollReveal } from '@/hooks'
import { setPageMeta } from '@/utils/seo'
import { SiteFooter, MarketingHeader } from '@/components/ui'
import { Zap, Shield, Landmark, Wallet, Smartphone, RefreshCw, Lock, Bell } from 'lucide-react'
import { InteractionSimulation } from './landing'

export default function LandingPage() {
  const { user, loading, openAuthModal } = useAuth()
  const navigate = useNavigate()
  const [downloadTab, setDownloadTab] = useState<'android' | 'ios'>('android')
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  // Rotating words for Hero sub-headline
  const rotatingWords = ['transactions', 'expenses', 'budgets', 'subscriptions']
  const [wordIndex, setWordIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % rotatingWords.length)
    }, 2800)
    return () => clearInterval(interval)
  }, [])

  const rotatingWord = rotatingWords[wordIndex]

  // Intersection observer for How It Works step lines drawing
  const stepsRef = useRef<HTMLDivElement>(null)
  const [stepsVisible, setStepsVisible] = useState(false)

  useEffect(() => {
    const el = stepsRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setStepsVisible(true); obs.disconnect() } },
      { threshold: 0.15 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // Scroll reveal
  useScrollReveal()

  useEffect(() => {
    if (loading) return

    if (Capacitor.isNativePlatform()) {
      if (user) navigate(ROUTES.DASHBOARD || '/dashboard', { replace: true })
      // Native app launch with no session. Left on 'login' deliberately: someone
      // opening an installed app has usually signed up already. Every marketing
      // "Get started" passes 'signup' explicitly instead.
      else openAuthModal(undefined, 'login')
      return
    }

    // Installed PWA. The manifest's start_url used to be /dashboard, which
    // bounced anyone launching the app without a session through
    // ProtectedRoute and back out to the landing page. It is now "/", so the
    // signed-in shortcut it used to provide has to happen here instead.
    // Signed-out launches simply land on the landing page.
    if (!user) return
    let isStandalone: boolean
    try {
      isStandalone =
        window.matchMedia?.('(display-mode: standalone)').matches ||
        // iOS Safari predates display-mode and exposes this instead.
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    } catch {
      isStandalone = false
    }
    if (isStandalone) navigate(ROUTES.DASHBOARD || '/dashboard', { replace: true })
  }, [user, loading, navigate, openAuthModal])

  useEffect(() => {
    setPageMeta({
      title: 'Intrack | Expenses, without the data entry.',
      description: "Connect Gmail once and Intrack turns your bank's transaction alert emails into expenses you approve. Read-only access, every Indian bank and UPI app, free 7-day trial.",
      canonicalPath: '/',
    })
    // Arriving at /#features from another page must land on that section, not
    // the top — ScrollToTop in App.tsx performs that scroll, and this would
    // undo it.
    if (!window.location.hash) window.scrollTo(0, 0)
  }, [])

  const features = [
    { icon: Zap, title: 'No typing amounts', desc: 'Connect Gmail once, then run a scan whenever you like. Bank alert emails come back as transactions for you to approve.' },
    // Kept accurate, but trimmed: at ~3x the length of its neighbours this
    // single card set the height of the whole first row.
    { icon: Shield, title: 'Privacy-respecting', desc: 'Read-only Gmail access, never your whole mailbox. Alert text passes through our server to Google’s Gemini in real time — never stored, never sold, never used to train a model.' },
    { icon: Landmark, title: 'All Indian banks', desc: 'Works with ICICI, HDFC, SBI, Axis, Kotak and every UPI-enabled bank.' },
    { icon: Wallet, title: 'Smart budgets', desc: 'Set monthly limits per category. Get alerted before you overspend.' },
    { icon: Smartphone, title: 'Install like an app', desc: 'Add to your home screen in seconds. No App Store, no APK needed.' },
    { icon: RefreshCw, title: 'Subscription tracker', desc: 'See all recurring charges in one place. Cancel what you forgot about.' },
  ]

  const steps = [
    { num: '01', title: 'Connect Gmail, or add manually', desc: 'Link your Gmail inbox once, or just add an expense yourself in seconds — whichever you prefer, whenever you prefer.' },
    { num: '02', title: 'You run a scan, we read the alerts', desc: 'Start a scan whenever it suits you and our AI parser pulls the merchant, amount and category out of your bank’s alert emails.' },
    { num: '03', title: 'You approve, budgets update', desc: 'Detected transactions land in Pending for a quick review — approve them and the matching budget updates instantly.' },
  ]

  const faqItems = FAQ_ITEMS

  return (
    <div className="min-h-screen bg-sb-canvas flex flex-col text-sb-ink page-enter">
      {/* The busiest nav on the site sat in front of the content with no way
          past it. AppLayout has had this; the public pages had not. */}
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      <MarketingHeader />

      <main id="main-content">
        {/* ── HERO ─────────────────────────────────────────── */}
        <section className="pt-12 pb-10 md:pt-24 md:pb-20 border-b border-sb-hairline overflow-hidden relative">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-16 items-center relative z-10">
            <div className="space-y-8">
              {/* Badge */}
              <motion.div
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                className="inline-flex items-center gap-2 bg-brand-500/10 border border-brand-500/20 rounded-full px-4 py-1.5 text-xs font-semibold text-brand-400"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                Read-only, always · Zero bank access required
              </motion.div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.2 }}
              >
                <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.1] tracking-tight text-sb-ink mb-4">
                  One tap.<br />Every expense, sorted.
                </h1>
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="text-lg text-sb-ink-secondary leading-relaxed max-w-md min-h-[3.5rem]"
                >
                  Your bank emails you every time money moves. Intrack reads those alerts and keeps your{" "}
                  <span className="inline-flex relative min-w-[135px] overflow-hidden align-baseline font-semibold text-brand-400">
                    <AnimatePresence mode="wait">
                      <motion.span
                        key={rotatingWord}
                        className="inline-block"
                        initial={{ y: 12, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -12, opacity: 0 }}
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      >
                        {rotatingWord}
                      </motion.span>
                    </AnimatePresence>
                  </span>{" "}
                  up to date — merchant, amount and category already filled in. Add anything else by hand in seconds.
                </motion.p>
              </motion.div>

              {/* CTAs */}
              <motion.div
                className="flex flex-wrap gap-3"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
              >
                {user ? (
                  <Link to={ROUTES.DASHBOARD} className="sb-btn-primary no-underline">
                    Go to Dashboard →
                  </Link>
                ) : (
                  // One signup CTA, not two. This sat beside a second button,
                  // "See your first week free", which opened the same signup
                  // modal — two primary-weight buttons competing to do one
                  // thing, next to a third that scrolls. Its `/dashboard`
                  // redirect was dead anyway: signup ends on a "check your
                  // email" toast and never redirects.
                  <button onClick={() => openAuthModal(undefined, 'signup')} className="sb-btn-primary border-0 cursor-pointer">
                    Start free — 7 days, no card →
                  </button>
                )}
                <a href="#how-it-works" className="sb-btn-secondary no-underline">
                  See how it works
                </a>
              </motion.div>

              {/* Stats */}
              <motion.div
                className="flex flex-wrap gap-x-6 gap-y-3 pt-2 border-t border-sb-hairline"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.6, delay: 0.2 }}
              >
                {[
                  { val: 'Auto', label: 'via Gmail', accent: true },
                  { val: 'Read-only', label: 'always' },
                  { val: 'All', label: 'Indian banks & UPI' },
                ].map((m, i) => (
                  <motion.div
                    key={m.label}
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4, delay: 0.25 + i * 0.08, type: 'spring', bounce: 0.4 }}
                  >
                    <p className={cn('text-xl font-bold', m.accent ? 'text-brand-400' : 'text-sb-ink')}>{m.val}</p>
                    <p className="text-xs text-sb-ink-muted mt-0.5">{m.label}</p>
                  </motion.div>
                ))}
              </motion.div>
            </div>

            <motion.div
              className="flex justify-center lg:justify-end"
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            >
              <InteractionSimulation />
            </motion.div>
          </div>
        </section>

        {/* ── BANK MARQUEE ───────────────────────────────────── */}
        <section className="py-10 bg-sb-canvas border-b border-sb-hairline overflow-hidden">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 text-center">
            <p className="text-xs font-semibold tracking-wider text-sb-ink-muted uppercase mb-5">
              Works with every Indian bank & UPI app
            </p>
            {/* Naming 15 banks and payment apps with no qualifier reads as an
                endorsement none of them have given. */}
            <p className="text-xs text-sb-ink-muted mb-5 max-w-xl mx-auto leading-relaxed">
              Intrack reads the alert emails these providers send you. It is not affiliated with,
              endorsed by, or partnered with any of them, and all names and marks belong to their owners.
            </p>
            <div className="marquee-container select-none">
              <div className="marquee-content font-mono text-sm font-semibold tracking-tight text-sb-ink-muted flex items-center">
                {/* Loop 1 */}
                {[
                  'ICICI Bank', 'HDFC Bank', 'SBI', 'Axis Bank', 'Kotak Bank', 
                  'Paytm', 'PhonePe', 'Google Pay', 'Cred', 'Jupiter', 'Fi Money',
                  'IndusInd Bank', 'Yes Bank', 'PNB', 'BOB'
                ].map((bank) => (
                  <div key={bank} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sb-canvas-soft border border-sb-hairline hover:border-brand-500/30 hover:text-sb-primary transition-all duration-300 animate-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500/70" />
                    {bank}
                  </div>
                ))}
                {/* Loop 2 — duplicated only to create a seamless scroll loop; hidden from assistive tech */}
                {[
                  'ICICI Bank', 'HDFC Bank', 'SBI', 'Axis Bank', 'Kotak Bank',
                  'Paytm', 'PhonePe', 'Google Pay', 'Cred', 'Jupiter', 'Fi Money',
                  'IndusInd Bank', 'Yes Bank', 'PNB', 'BOB'
                ].map((bank) => (
                  <div key={bank + '-dup'} aria-hidden="true" className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sb-canvas-soft border border-sb-hairline hover:border-brand-500/30 hover:text-sb-primary transition-all duration-300 animate-none">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500/70" />
                    {bank}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ────────────────────────────────── */}
        <section id="how-it-works" className="py-12 md:py-24 bg-sb-canvas-soft border-b border-sb-hairline">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div data-reveal className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-sb-ink-muted mb-4">How it works</div>
              <h2 data-reveal data-delay="80" className="text-4xl font-bold tracking-tight text-sb-ink mb-4">Spend money. We handle the rest.</h2>
              <p data-reveal data-delay="150" className="text-sb-ink-secondary text-lg max-w-lg mx-auto">Three steps, zero effort from your end.</p>
            </div>
            <div ref={stepsRef} className="grid md:grid-cols-3 md:auto-rows-fr gap-6">
              {steps.map((s, i) => (
                <div key={s.num} data-reveal data-delay={String(i * 150)} className="h-full flex flex-col">
                  <div className="sb-card-light p-5 sm:p-8 relative group transition-shadow duration-300 hover:shadow-md h-full flex flex-col justify-start">
                    <div className="text-5xl font-black text-sb-ink-faint mb-6 leading-none group-hover:text-brand-500/40 transition-colors duration-300">{s.num}</div>
                    {i < steps.length - 1 && (
                      <svg className="hidden md:block absolute top-[60px] -right-[15px] w-8 h-6 text-brand-500/40 z-10" viewBox="0 0 32 16" fill="none">
                        <path
                          d="M0 8C8 8 12 12 16 8S24 4 32 8"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          className={stepsVisible ? "animate-draw-path" : "stroke-dasharray-200 stroke-dashoffset-200"}
                        />
                        <path
                          d="M26 4l6 4-6 4"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="transition-opacity duration-300 delay-[1200ms]"
                          style={{ opacity: stepsVisible ? 1 : 0 }}
                        />
                      </svg>
                    )}
                    <h3 className="text-lg font-semibold text-sb-ink mb-3">{s.title}</h3>
                    <p className="text-sm text-sb-ink-secondary leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FEATURES ────────────────────────────────────── */}
        <section id="features" className="py-12 md:py-24 border-b border-sb-hairline">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <div data-reveal className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-sb-ink-muted mb-4">Features</div>
              <h2 data-reveal data-delay="80" className="text-4xl font-bold tracking-tight text-sb-ink mb-4">Smart, simple, and <span className="text-sb-primary">privacy-respecting.</span></h2>
              <p data-reveal data-delay="150" className="text-sb-ink-secondary text-lg max-w-lg mx-auto">Everything you need to manage your money — without handing over your data.</p>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 sm:auto-rows-fr gap-5">
              {features.map((f, i) => (
                <div key={f.title} data-reveal data-delay={String(i * 80)} className="h-full flex flex-col">
                  <div className="sb-card-light p-6 group h-full flex flex-col justify-start transition-shadow duration-300 hover:shadow-md">
                    <div className="h-10 w-10 rounded-xl flex items-center justify-center text-xl mb-5 bg-brand-500/10 border border-brand-500/20 transition-transform duration-200 group-hover:scale-110 shrink-0">
                      <f.icon className="h-5 w-5 text-brand-400" />
                    </div>
                    <h3 className="text-base font-semibold text-sb-ink mb-2">{f.title}</h3>
                    <p className="text-sm text-sb-ink-secondary leading-relaxed flex-1">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── TRUST / PRIVACY ─────────────────────────────── */}
        <section className="py-10 md:py-20 border-b border-sb-hairline">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div data-reveal className="sb-card-light p-6 sm:p-10 md:p-12 flex flex-col md:flex-row items-center gap-10 justify-between">
              <div className="max-w-lg">
                <h2 className="text-2xl font-bold text-sb-ink mb-4">Your money, your data. Your control.</h2>
                <p className="text-sb-ink-secondary leading-relaxed text-sm">
                  Your transactions live in a database row that only your account can read, enforced by Postgres row-level security — never sold, never handed to advertisers. To detect an alert, its text passes through our server to Google's Gemini in real time and is not retained afterwards. We never ask for your net-banking credentials, PINs, or OTPs, and we can't touch your money.
                </p>
              </div>
              <div className="flex gap-12 shrink-0">
                {[
                  { val: 'Read-only', label: 'access', sub: 'Never touches your money' },
                  { val: 'TLS 1.3', label: 'in transit', sub: 'Encrypted end to end' },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <p className="text-4xl font-black text-brand-400 font-mono">{s.val}</p>
                    <p className="text-sm font-semibold text-sb-ink mt-2">{s.label}</p>
                    <p className="text-xs text-sb-ink-muted mt-1">{s.sub}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── INSTALL GUIDE ───────────────────────────────── */}
        <section id="install-guide" className="py-12 md:py-24 bg-sb-canvas-soft border-b border-sb-hairline">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 grid lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6" data-reveal="from-left">
              <div className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-sb-ink-muted">Install</div>
              <h2 className="text-4xl font-bold text-sb-ink leading-tight">
                On your phone<br />in <span className="text-sb-primary">60 seconds.</span>
              </h2>
              <p className="text-sb-ink-secondary leading-relaxed">
                Intrack is a Progressive Web App. No App Store, no APK, no Play Store approvals. Just open the website and install it to your home screen.
              </p>
              <div className="space-y-3">
                {[
                  { icon: Zap, text: 'No App Store or APK needed' },
                  { icon: Lock, text: 'Safe, lightweight, and offline-capable' },
                  { icon: Bell, text: 'Enable notifications for instant spend alerts' },
                ].map((item, i) => (
                  <motion.div
                    key={item.text}
                    className="flex items-center gap-3"
                    initial={{ opacity: 0, x: -16 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ duration: 0.4, delay: i * 0.1 }}
                  >
                    <div className="h-8 w-8 rounded-full bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-sm shrink-0">
                      <item.icon className="h-4 w-4 text-brand-400" />
                    </div>
                    <p className="text-sm text-sb-ink-secondary font-medium">{item.text}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            <div className="sb-card-light overflow-hidden p-0" data-reveal="from-right">
              <div className="flex bg-sb-canvas border-b border-sb-hairline">
                {(['android', 'ios'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setDownloadTab(tab)}
                    className={cn(
                      'flex-1 py-4 text-sm transition-all cursor-pointer border-none bg-transparent font-medium flex items-center justify-center gap-2',
                      downloadTab === tab
                        ? 'text-brand-400 border-b-2 border-brand-400'
                        : 'text-sb-ink-muted border-b-2 border-transparent hover:text-sb-ink-secondary'
                    )}
                  >
                    {tab === 'android' ? (
                      <>
                        <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path d="M17.523 15.3c-.551 0-1-.449-1-1 0-.551.449-1 1-1s1 .449 1 1c0 .551-.449 1-1 1zm-11.046 0c-.551 0-1-.449-1-1 0-.551.449-1 1-1s1 .449 1 1c0 .551-.449 1-1 1zm11.233-5.963l1.854-3.21a.501.501 0 0 0-.183-.683.499.499 0 0 0-.683.183l-1.884 3.261C15.483 8.35 13.814 8 12 8s-3.483.35-4.83.891L5.286 5.63a.499.499 0 0 0-.683-.183.501.501 0 0 0-.183.683l1.854 3.21C3.473 10.917 1.8 13.399 1.5 16.325h21c-.3-2.926-1.973-5.408-4.743-6.988z"/>
                        </svg>
                        <span>Android</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 4.17c.66-.81 1.11-1.93.99-3.06-1 .04-2.22.67-2.94 1.5-.62.72-1.16 1.87-1.02 2.98 1.11.09 2.27-.58 2.97-1.42"/>
                        </svg>
                        <span>iOS (iPhone)</span>
                      </>
                    )}
                  </button>
                ))}
              </div>
              <AnimatePresence mode="wait">
                <motion.div
                  key={downloadTab}
                  className="p-8"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.22 }}
                >
                  <ol className="space-y-4">
                    {(downloadTab === 'android' ? [
                      'Open Google Chrome on your Android device.',
                      'Tap the three-dot menu icon in the top-right corner.',
                      'Select "Add to Home screen" or "Install App".',
                      'Confirm — the app icon appears on your home screen.',
                    ] : [
                      'Open Safari on your iPhone or iPad.',
                      'Tap the Share button (square with arrow pointing up).',
                      'Scroll down the share sheet and tap "Add to Home Screen".',
                      'Tap Add in the top right — done.',
                    ]).map((step, i) => (
                      <motion.li
                        key={i}
                        className="flex gap-3 items-start"
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25, delay: i * 0.07 }}
                      >
                        <span className="h-5 w-5 rounded-full bg-brand-500/15 border border-brand-500/25 text-brand-400 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                        <p className="text-sm text-sb-ink-secondary leading-relaxed">{step}</p>
                      </motion.li>
                    ))}
                  </ol>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────── */}
        <section id="faq" className="py-12 md:py-24 border-b border-sb-hairline">
          <div className="mx-auto max-w-3xl px-6">
            <div className="text-center mb-14">
              <div data-reveal className="inline-flex items-center gap-2 text-xs font-bold tracking-widest uppercase text-sb-ink-muted mb-4">FAQ</div>
              <h2 data-reveal data-delay="80" className="text-4xl font-bold text-sb-ink">Questions people ask</h2>
            </div>
            <div className="space-y-3">
              {faqItems.map((item, idx) => {
                const isOpen = expandedFaq === idx
                return (
                  <div key={idx} data-reveal data-delay={String(idx * 70)} className="sb-card-light overflow-hidden p-0">
                    <button
                      onClick={() => setExpandedFaq(isOpen ? null : idx)}
                      className="w-full text-left px-6 py-5 flex items-center justify-between cursor-pointer border-none bg-transparent"
                      aria-expanded={isOpen}
                      aria-controls={`faq-answer-${idx}`}
                      id={`faq-question-${idx}`}
                    >
                      <span className="text-base font-semibold text-sb-ink pr-4">{item.q}</span>
                      <motion.span
                        animate={{ rotate: isOpen ? 45 : 0 }}
                        transition={{ duration: 0.2 }}
                        className="text-brand-400 text-xl shrink-0"
                      >
                        ＋
                      </motion.span>
                    </button>
                    {/* The id lives on this always-present wrapper. It used to
                        sit on the animated panel, which only exists while the
                        item is open — so the button's aria-controls pointed at
                        nothing for every collapsed question. */}
                    <div id={`faq-answer-${idx}`} role="region" aria-labelledby={`faq-question-${idx}`}>
                    <AnimatePresence initial={false}>
                      {isOpen && (
                        <motion.div
                          key="content"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="px-6 pb-5 border-t border-sb-hairline pt-4">
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

        {/* ── FINAL CTA ────────────────────────────────────── */}
        <section className="py-14 md:py-28 text-center border-b border-sb-hairline relative overflow-hidden">
          <div className="mx-auto max-w-2xl px-6 space-y-6 relative z-10">
            <h2 data-reveal="scale" className="text-4xl md:text-5xl font-bold tracking-tight text-sb-ink">
              Take control of<br /><span className="text-sb-primary">your finances today.</span>
            </h2>
            <p data-reveal data-delay="100" className="text-lg text-sb-ink-secondary max-w-md mx-auto leading-relaxed">
              No credit card required. 7-day full trial. Delete your data anytime.
            </p>
            <motion.div
              className="flex flex-wrap items-center justify-center gap-4 pt-2"
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              {user ? (
                <Link to={ROUTES.DASHBOARD} className="sb-btn-primary no-underline">
                  Go to Dashboard →
                </Link>
              ) : (
                <button onClick={() => openAuthModal(undefined, 'signup')} className="sb-btn-primary border-0 cursor-pointer text-base px-7 py-3.5">
                  Start free — no card needed →
                </button>
              )}
              <Link to={ROUTES.PRICING} className="sb-btn-secondary no-underline">
                View pricing
              </Link>
            </motion.div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ───────────────────────────────────────── */}
      <SiteFooter showWordmark className="px-4 sm:px-6 lg:px-8" />
    </div>
  )
}
