// ============================================
// SupportPage — Support, Privacy Policy & FAQ
// Visually stunning, responsive, and Supabaze Design Language compliant
// ============================================

import { useState, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { AppLayout } from '@/layouts'
import { APP_CONFIG, FAQ_ITEMS, ROUTES } from '@/constants'
import { submitSupportTicket } from '@/services/support'
import { useAuth } from '@/context/AuthContext'
import { cn } from '@/utils'
import { setPageMeta } from '@/utils/seo'

export default function SupportPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'privacy'
  const { user } = useAuth()

  // FAQs Accordion State
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)

  // Form Field States
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  // A send that failed. Kept separate from `errors`, which is per-field
  // validation — this one is about delivery, and the user needs to know their
  // message did NOT arrive rather than be reassured.
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    setPageMeta({
      title: 'Support & Privacy | Intrack',
      description: 'Get help with Intrack: file a support ticket, browse FAQs about Gmail scanning and billing, and read our privacy, OAuth scope and DPDPA commitments.',
      canonicalPath: '/support',
    })
  }, [])

  // Prefill the email of a signed-in user. They can still change it — someone
  // reporting a problem with a second account needs to be able to say so.
  useEffect(() => {
    if (user?.email) setEmail((current) => current || user.email!)
  }, [user])

  const handleTabChange = (tabId: string) => {
    setSearchParams({ tab: tabId })
    window.scrollTo(0, 0)
  }

  // Toggle FAQ accordion
  const toggleFaq = (index: number) => {
    setExpandedFaq(expandedFaq === index ? null : index)
  }

  // Handle support ticket form submission
  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSuccess(false)
    setSendError(null)

    // Form validation
    const newErrors: Record<string, string> = {}
    if (!name.trim()) {
      newErrors.name = 'Name is required'
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!email.trim()) {
      newErrors.email = 'Email is required'
    } else if (!emailRegex.test(email)) {
      newErrors.email = 'Please enter a valid email address'
    }

    if (!subject.trim()) {
      newErrors.subject = 'Subject is required'
    }

    if (message.trim().length < 10) {
      newErrors.message = 'Message must contain at least 10 characters'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setErrors({})
    setSubmitting(true)

    const { error } = await submitSupportTicket({ name, email, subject, message })

    setSubmitting(false)

    // Only clear the form once the ticket is genuinely stored. Wiping it on a
    // failed send would destroy what the user just wrote, which is the worst
    // possible moment to lose it.
    if (error) {
      setSendError(error.message)
      return
    }

    setSuccess(true)
    setSubject('')
    setMessage('')
  }

  // FAQ List Definition (Central Single Source of Truth)
  const faqs = FAQ_ITEMS

  // Sidebar Tabs Config
  const tabs = [
    { id: 'privacy', label: 'Privacy Policy', icon: '🛡️' },
    { id: 'faq', label: 'FAQs', icon: '❓' },
    { id: 'contact', label: 'Help & Contact', icon: '✉️' },
  ]

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in" style={{ fontFamily: "'Inter', -apple-system, system-ui, sans-serif" }}>
        
        {/* Header */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight text-sb-ink md:text-3xl">Support Center</h1>
          <p className="text-sm text-sb-ink-secondary">
            Review security compliance documents, browse FAQs, contact support, and explore technical details.
          </p>
        </div>

        {/* Outer Grid layout */}
        <div className="grid gap-6 md:grid-cols-12">
          
          {/* Navigation Tabs Bar / Sidebar */}
          <div className="md:col-span-3 space-y-2">
            {/* Desktop vertical sidebar navigation */}
            <div role="tablist" aria-label="Support navigation topics" className="hidden md:flex flex-col space-y-1.5 p-2 rounded-[20px] bg-surface-1 border border-border-subtle shadow-md">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`flex items-center gap-3 px-4 py-3 text-sm font-semibold rounded-xl text-left transition-all cursor-pointer border border-transparent bg-transparent ${
                      isActive
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'text-zinc-400 hover:text-sb-ink hover:bg-surface-2'
                    }`}
                    aria-selected={isActive}
                    role="tab"
                  >
                    <span className="text-lg" aria-hidden="true">{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Mobile horizontal navigation tabs */}
            <div role="tablist" aria-label="Support navigation topics mobile" className="flex flex-row flex-nowrap md:hidden overflow-x-auto pb-2 gap-2 scrollbar-none max-w-full">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.id
                return (
                  <button
                    key={tab.id}
                    onClick={() => handleTabChange(tab.id)}
                    className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-bold rounded-xl whitespace-nowrap transition-all shrink-0 cursor-pointer border ${
                      isActive
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 bg-transparent'
                        : 'bg-surface-1 text-zinc-400 border-border-subtle'
                    }`}
                    aria-selected={isActive}
                    role="tab"
                  >
                    <span className="text-sm" aria-hidden="true">{tab.icon}</span>
                    <span>{tab.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Active Tab Panel Details */}
          <div className="md:col-span-9">
            
            {/* Tab 1: Privacy Policy */}
            {activeTab === 'privacy' && (
              <div className="space-y-6 animate-scale-up" role="tabpanel" aria-label="Privacy Policy">
                <div className="rounded-3xl sb-card-light p-8 shadow-md space-y-6">
                  <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
                    <span className="text-3xl" aria-hidden="true">🛡️</span>
                    <div>
                      <h2 className="text-lg font-bold text-sb-ink">Privacy Policy & Security Standards</h2>
                      <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mt-1">
                        How we protect your data
                      </p>
                    </div>
                  </div>

                  <div className="space-y-5 text-sm text-zinc-300 leading-relaxed">
                    <section className="space-y-2">
                      <h3 className="text-base font-bold text-sb-ink">
                        1. Where Your Email Is Processed
                      </h3>
                      <p>
                        Scanning runs in your browser: your inbox is read directly from Gmail by this app, not by a
                        server that holds a copy of your mail. To classify an alert accurately, the subject and the
                        first part of the body are sent to Google's Gemini through a proxy we operate only to keep the
                        API key secret. That text is processed in real time and is not stored or retained by us
                        afterwards, and it is never used to train any model. We do not upload your whole mailbox
                        anywhere, and we never store the full body of an email.
                      </p>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-base font-bold text-sb-ink">
                        2. Restricted OAuth 2.0 Scopes
                      </h3>
                      <p>
                        We utilize Google OAuth 2.0 configurations targeting the restricted <code className="font-mono text-xs bg-surface-2 border border-border-subtle/50 px-1.5 py-0.5 rounded-lg">gmail.readonly</code> scope. This is a read-only credential that only reads email content. We have zero permissions to write, send, delete, or modify emails.
                      </p>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-base font-bold text-sb-ink">
                        3. Google API Services Compliance (Limited Use)
                      </h3>
                      <p>
                        Intrack's use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">Google API Services User Data Policy</a>, including the Limited Use requirements. We do not store raw emails on our servers, nor do we sell or use your Google data for advertisements or AI model training.
                      </p>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-base font-bold text-sb-ink">
                        4. Row-Level Data Security (RLS)
                      </h3>
                      <p>
                        All categorized transactions saved to our cloud servers are protected by Supabase Row-Level Security (RLS) tables. This physical partitioning prevents cross-tenant access. No user can view, edit, or leak your transactions, even in case of system-wide anomalies.
                      </p>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-base font-bold text-sb-ink">
                        5. DPDPA 2023 Consent & Grievance Redressal
                      </h3>
                      <p>
                        In compliance with the Digital Personal Data Protection Act 2023, you can withdraw consent or request complete erasure of your data at any time under Settings. For queries, grievances, or details regarding data processing, contact our designated Grievance & Data Protection Officer:
                      </p>
                      <div className="mt-2 text-xs text-zinc-400 bg-surface-2/30 border border-border-subtle/30 p-3 rounded-xl space-y-1">
                        <p>• <strong className="text-sb-ink">Officer:</strong> {APP_CONFIG.SUPPORT_NAME}</p>
                        <p>• <strong className="text-sb-ink">Email:</strong> {APP_CONFIG.SUPPORT_EMAIL}</p>
                        <p>• <strong className="text-sb-ink">Designation:</strong> {APP_CONFIG.SUPPORT_DESIGNATION}</p>
                        <p>• <strong className="text-sb-ink">Address:</strong> {APP_CONFIG.SUPPORT_ADDRESS}</p>
                      </div>
                    </section>

                    <div className="p-4 rounded-2xl bg-surface-2/40 border border-border-subtle/50">
                      <p className="font-bold text-sb-ink">🔒 Summary Security Commitment:</p>
                      <p className="mt-1 text-zinc-400">
                        No selling data · No advertising or marketing profiling · No third-party usage tracking · No banking passwords, PINs or OTPs ever requested.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Tab 2: FAQs */}
            {activeTab === 'faq' && (
              <div className="space-y-4 animate-scale-up" role="tabpanel" aria-label="Frequently Asked Questions">
                <div className="rounded-3xl sb-card-light p-8 shadow-md space-y-4">
                  <div className="flex items-center gap-3 border-b border-border-subtle pb-4">
                    <span className="text-3xl" aria-hidden="true">❓</span>
                    <div>
                      <h2 className="text-lg font-bold text-sb-ink">Frequently Asked Questions</h2>
                      <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mt-1">
                        Common Security & Product Queries
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {faqs.map((faq, idx) => {
                      const isExpanded = expandedFaq === idx
                      return (
                        <div key={idx} className="rounded-2xl border border-border-subtle overflow-hidden">
                          <button
                            onClick={() => toggleFaq(idx)}
                            className="w-full text-left px-4 py-4 flex items-center justify-between font-semibold transition-colors bg-surface-2 hover:bg-surface-2/85 border-none cursor-pointer"
                            aria-expanded={isExpanded}
                            aria-controls={`support-faq-${idx}`}
                            id={`support-faq-q-${idx}`}
                          >
                            <span className="text-sm font-semibold text-sb-ink">{faq.q}</span>
                            <span className="text-lg text-emerald-400">
                              {isExpanded ? '−' : '＋'}
                            </span>
                          </button>
                          {/* Rendered always and hidden when collapsed, so the
                              button's aria-controls always resolves to a real
                              element. It used to be mounted only while open. */}
                          <div
                            id={`support-faq-${idx}`}
                            role="region"
                            aria-labelledby={`support-faq-q-${idx}`}
                            hidden={!isExpanded}
                            className="px-4 pb-4 pt-2 border-t border-border-subtle/50 bg-surface-2/40"
                          >
                            <p className="text-xs text-zinc-400 leading-relaxed">{faq.a}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Tab 3: Help & Contact Form */}
            {activeTab === 'contact' && (
              <div className="space-y-6 animate-scale-up" role="tabpanel" aria-label="Help and Contact">
                <div className="rounded-3xl sb-card-light p-8 shadow-md space-y-6">
                  <div className="flex items-center justify-between border-b border-border-subtle pb-4">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl" aria-hidden="true">✉️</span>
                      <div>
                        <h2 className="text-lg font-bold text-sb-ink">Submit Support Ticket</h2>
                        <p className="text-xs font-semibold text-zinc-500 uppercase tracking-widest mt-1">
                          We reply to the email you give us
                        </p>
                      </div>
                    </div>
                  </div>

                  {success && (
                    <div role="status" className="rounded-2xl p-4 bg-emerald-500/10 border border-emerald-500/20">
                      <p className="text-xs font-bold text-emerald-400">✅ Ticket received</p>
                      {/* This used to say the message "has reached our support
                          inbox", which implies an email landed somewhere. It is
                          a stored ticket, read in the admin panel — the same
                          reason submitSupportTicket stopped pretending a failed
                          write had succeeded. */}
                      <p className="text-xs mt-1 text-zinc-400">
                        Your ticket is logged and we'll reply to {email || 'the email you entered'}, usually within 24–48 hours.
                        If it's urgent, email{' '}
                        <a href={`mailto:${APP_CONFIG.SUPPORT_EMAIL}`} className="text-brand-400 underline">
                          {APP_CONFIG.SUPPORT_EMAIL}
                        </a>{' '}
                        directly.
                      </p>
                    </div>
                  )}

                  {sendError && (
                    <div role="alert" className="rounded-2xl p-4 bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)]">
                      <p className="text-xs font-bold text-[var(--status-danger-text)]">Your ticket was not sent</p>
                      <p className="text-xs mt-1 text-zinc-400">
                        {sendError} Your message is still in the box below — nothing was lost. You can also email{' '}
                        <a href={`mailto:${APP_CONFIG.SUPPORT_EMAIL}`} className="text-brand-400 underline">
                          {APP_CONFIG.SUPPORT_EMAIL}
                        </a>{' '}
                        directly.
                      </p>
                    </div>
                  )}

                  <form onSubmit={handleFormSubmit} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="support-name" className="text-xs block mb-1.5 font-bold uppercase tracking-widest text-zinc-500">Full Name</label>
                        <input
                          type="text"
                          id="support-name"
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          className={cn(
                            "w-full bg-surface-2 border text-zinc-300 text-xs rounded-xl px-3 py-2.5 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand-400 transition-all",
                            errors.name ? "border-[var(--status-danger-border)]" : "border-border-subtle/50"
                          )}
                          placeholder="e.g. Rahul Sharma"
                        />
                        {errors.name && <p className="text-xs text-red-400 mt-1">{errors.name}</p>}
                      </div>
                      <div>
                        <label htmlFor="support-email" className="text-xs block mb-1.5 font-bold uppercase tracking-widest text-zinc-500">Email Address</label>
                        <input
                          type="email"
                          id="support-email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={cn(
                            "w-full bg-surface-2 border text-zinc-300 text-xs rounded-xl px-3 py-2.5 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand-400 transition-all",
                            errors.email ? "border-[var(--status-danger-border)]" : "border-border-subtle/50"
                          )}
                          placeholder="e.g. piyush@example.com"
                        />
                        {errors.email && <p className="text-xs text-red-400 mt-1">{errors.email}</p>}
                      </div>
                    </div>

                    <div>
                      <label htmlFor="support-subject" className="text-xs block mb-1.5 font-bold uppercase tracking-widest text-zinc-500">Subject</label>
                      <input
                        type="text"
                        id="support-subject"
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className={cn(
                          "w-full bg-surface-2 border text-zinc-300 text-xs rounded-xl px-3 py-2.5 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand-400 transition-all",
                          errors.subject ? "border-[var(--status-danger-border)]" : "border-border-subtle/50"
                        )}
                        placeholder="e.g. Gmail integration scan error"
                      />
                      {errors.subject && <p className="text-xs text-red-400 mt-1">{errors.subject}</p>}
                    </div>

                    <div>
                      <label htmlFor="support-message" className="text-xs block mb-1.5 font-bold uppercase tracking-widest text-zinc-500">Detailed Message</label>
                      <textarea
                        id="support-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={4}
                        className={cn(
                          "w-full bg-surface-2 border text-zinc-300 text-xs rounded-xl px-3 py-2.5 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand-400 transition-all resize-none",
                          errors.message ? "border-[var(--status-danger-border)]" : "border-border-subtle/50"
                        )}
                        placeholder="Tell us what went wrong. Include bank or credit card names..."
                      />
                      {errors.message && <p className="text-xs text-red-400 mt-1">{errors.message}</p>}
                    </div>

                    {/* Notice at the point of collection. The form accepts
                        tickets from signed-out visitors, so for many people
                        this is the first personal data they hand over — DPDPA
                        2023 expects them to be told what it is used for
                        before, not after. */}
                    <p className="text-xs leading-relaxed text-zinc-500">
                      We use the name and email you enter here only to answer this ticket. It is stored
                      with your message and is not used for marketing or shared with anyone else. See our{' '}
                      <Link to={ROUTES.PRIVACY} className="text-brand-400 underline hover:text-brand-300">
                        Privacy Policy
                      </Link>.
                    </p>

                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full justify-center py-3.5 px-4 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-xs tracking-wide transition-all active:scale-98 shadow-md cursor-pointer border-0"
                    >
                      {submitting ? 'Sending ticket…' : 'Submit Ticket'}
                    </button>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

    </AppLayout>
  )
}
