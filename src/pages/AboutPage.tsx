// ============================================
// AboutPage — founder story + Trust building
// ============================================

import { Link } from 'react-router-dom'
import { ROUTES } from '@/constants'
import { motion } from 'framer-motion'
import { useAuth } from '@/context'
import { useScrollReveal } from '@/hooks'
import { MarketingLayout } from '@/layouts'
import { Shield, Brain, Lock, TrendingUp, Check } from 'lucide-react'

export default function AboutPage() {
  const { user, openAuthModal } = useAuth()
  useScrollReveal()

  return (
    <MarketingLayout
      title="About"
      description="Why Intrack exists: automatic expense tracking built on read-only Gmail bank alerts, for people who abandon manual expense trackers within two weeks."
    >
      {/* Ambient emerald background glow */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 overflow-hidden">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 h-80 w-[42rem] max-w-[95vw] rounded-full bg-radial from-brand-500/12 via-brand-500/4 to-transparent blur-3xl" />
      </div>

      {/* Hero */}
      <div className="text-center mb-16">
        <div className="flex justify-center mb-4">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold tracking-wider uppercase bg-brand-50 border border-brand-200/70 text-brand-700 shadow-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse" />
            Alerts In · Clarity Out
          </span>
        </div>
        <motion.div
          className="inline-flex items-center justify-center h-20 w-20 rounded-2xl bg-brand-50 border border-brand-200/80 mb-6 shadow-xs"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <Shield className="w-9 h-9 text-brand-700" />
        </motion.div>
        <motion.h1
          className="sb-display-xl text-sb-ink font-extrabold tracking-tight"
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          Built for Financial Clarity
        </motion.h1>
        <motion.p
          className="text-base mt-4 max-w-2xl mx-auto text-sb-ink-secondary leading-relaxed"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
        >
          Intrack was born from a simple frustration — most personal finance apps either cost too much, share your data, or require manual effort that nobody actually does.
        </motion.p>
      </div>

      {/* Mission */}
      <div data-reveal className="relative overflow-hidden bg-surface-1 border border-sb-hairline shadow-card rounded-2xl p-6 sm:p-8 mb-12 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/30 before:to-transparent">
        <h2 className="sb-display-md text-sb-ink">Our Mission</h2>
        <p className="text-sm mt-3 leading-relaxed text-sb-ink-secondary">
          To give every Indian professional the financial intelligence of a personal CFO — without the ₹5,000/hour consulting fees.
        </p>
        <div className="grid sm:grid-cols-3 sm:auto-rows-fr gap-4 mt-8">
          {[
            { icon: <Brain className="w-8 h-8 text-brand-700" />, title: 'Intelligent', body: 'Reads and categorizes your spending from bank emails with human-like accuracy, every time you run a scan.' },
            { icon: <Lock className="w-8 h-8 text-brand-700" />, title: 'Private', body: 'Read-only Gmail access, limited to what a bank-alert search returns. Nothing is kept but the transaction — plus a 30-day diagnostic note on mail we rejected, so a missing expense can be traced. No ads, no data sold, ever.' },
            { icon: <TrendingUp className="w-8 h-8 text-brand-700" />, title: 'Actionable', body: 'Turns raw transaction data into insights that help you actually improve your financial behavior.' },
          ].map((item, i) => (
            <div key={item.title} data-reveal data-delay={String(i * 100)} className="h-full flex flex-col">
              <div className="rounded-xl p-5 bg-surface-1 border border-sb-hairline shadow-xs h-full flex flex-col justify-start hover:border-brand-500/30 transition-all">
                <div className="mb-3">{item.icon}</div>
                <p className="text-sm font-bold text-sb-ink">{item.title}</p>
                <p className="text-xs mt-2 leading-relaxed text-sb-ink-muted flex-1">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* The Problem */}
      <section className="mb-12 space-y-6">
        <h2 data-reveal className="sb-display-md text-sb-ink">Why Intrack Exists</h2>
        <div className="space-y-4">
          {[
            { q: 'Existing apps require too much manual input', a: 'Most people abandon expense trackers within 2 weeks because manually entering every transaction is tedious. Intrack automates this via Gmail bank alerts — the most reliable financial data source you already have.' },
            { q: 'Bank apps show data, not insight', a: 'Your HDFC or ICICI app tells you what happened. Intrack tells you what it means — whether you are on track, overspending, or wasting money on subscriptions you forgot about.' },
            { q: 'Privacy should not be negotiable', a: 'We built Intrack on a read-only Gmail connection, with Row Level Security on every database table, and zero advertising business model. Your data is yours.' },
          ].map((item, i) => (
            <div key={item.q} data-reveal data-delay={String(i * 100)} className="relative overflow-hidden bg-surface-1 border border-sb-hairline shadow-card rounded-2xl p-6 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/20 before:to-transparent">
              <p className="text-sm font-bold flex items-start gap-2 text-sb-ink">
                <span className="text-brand-600 font-bold shrink-0 mt-0.5">✦</span>
                {item.q}
              </p>
              <p className="text-sm leading-relaxed pl-5 mt-2 text-sb-ink-secondary">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Technology */}
      <section className="mb-12 space-y-6">
        <h2 data-reveal className="sb-display-md text-sb-ink">Technology & Architecture</h2>
        <div className="grid sm:grid-cols-2 sm:auto-rows-fr gap-4">
          {[
            { label: 'Email Intelligence Engine', value: '5-layer AI pipeline with 50+ bank patterns, confidence scoring, and self-learning rules' },
            { label: 'Database', value: 'Supabase (Postgres) with Row Level Security on all tables — your data is physically isolated' },
            { label: 'Authentication', value: 'OAuth 2.0 with Google (Gmail read-only scope) — we never see your password' },
            { label: 'Learning Engine', value: 'Merchant rules that improve from every correction you make — personalized to your spending patterns' },
            { label: 'Frontend', value: 'React 19 + TypeScript — fast, type-safe, and optimized with code splitting' },
            { label: 'Hosting', value: 'Vercel global CDN with HTTPS enforcement, security headers, and HSTS' },
          ].map((item, i) => (
            <div key={item.label} data-reveal data-delay={String(i * 70)} className="h-full flex flex-col">
              <div className="relative overflow-hidden bg-surface-1 border border-sb-hairline shadow-card rounded-2xl p-5 h-full flex flex-col justify-start before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/20 before:to-transparent">
                <p className="text-xs font-bold uppercase tracking-wider mb-1.5 text-brand-700">{item.label}</p>
                <p className="text-sm leading-relaxed text-sb-ink-secondary flex-1">{item.value}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Trust Signals */}
      <section className="mb-12 space-y-6">
        <h2 data-reveal className="sb-display-md text-sb-ink">Our Commitments to You</h2>
        <div className="grid sm:grid-cols-2 sm:auto-rows-fr gap-3">
          {[
            'We never store your banking passwords',
            'Anything read that is not a transaction is discarded within 30 days',
            'We never sell your financial data',
            'We never show you ads based on your spending',
            'You can export all your data anytime',
            'You can delete your account and all data anytime',
            'Row Level Security on every database table',
            'Password-protected AES-256 encrypted backups only you can decrypt',
          ].map((commitment, i) => (
            <motion.div
              key={commitment}
              className="flex items-center gap-3 bg-surface-1 border border-sb-hairline shadow-xs rounded-xl px-4 py-3 text-sm font-semibold text-sb-ink"
              initial={{ opacity: 0, x: -12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: i * 0.05 }}
            >
              <Check className="w-4 h-4 text-brand-600 shrink-0" /> {commitment}
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <div className="relative overflow-hidden bg-surface-1 border border-sb-hairline shadow-card rounded-3xl text-center p-8 sm:p-12 space-y-6 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:via-brand-500/40 before:to-transparent">
        <h2 className="sb-display-md text-sb-ink">Start Taking Control of Your Finances</h2>
        <p className="text-sm leading-relaxed text-sb-ink-secondary" style={{ maxWidth: 480, margin: '0 auto' }}>Connect your Gmail and let Intrack handle the tracking while you focus on the decisions.</p>
        {user ? (
          <Link
            to={ROUTES.DASHBOARD}
            className="sb-btn-primary no-underline inline-flex items-center justify-center gap-2"
            style={{ padding: '13px 28px' }}
          >
            Open app →
          </Link>
        ) : (
          <button
            onClick={() => openAuthModal(undefined, 'signup')}
            className="sb-btn-primary border-0 cursor-pointer inline-flex items-center justify-center gap-2"
            style={{ padding: '13px 28px' }}
          >
            Start free — no card needed →
          </button>
        )}
      </div>
    </MarketingLayout>
  )
}
