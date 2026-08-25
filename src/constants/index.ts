// ============================================
// App Constants & Category Configuration
// ============================================

/** Neutral style for transactions whose category no longer exists */
export const CATEGORY_STYLE_FALLBACK = { emoji: '📌', color: '#94a3b8' }

/** Curated emoji choices for the category form */
export const CATEGORY_EMOJI_CHOICES = [
  '🍔','🛒','🚗','🛍️','💡','🏠','🏥','🎬','📚','✈️',
  '🔄','🛡️','💳','🔁','💰','💻','📈','↩️','🎁','📌',
  '🎮','🐾','👶','🏋️','🎓','🎵','☕','🍺','💊','🧾',
  '🎂','🌱','🔧','📱','👔','💇','🏦','🙏','🎗️','🚌',
]

/** Curated color swatches for the category form */
export const CATEGORY_COLOR_CHOICES = [
  '#f97316','#84cc16','#3b82f6','#ec4899','#eab308','#8b5cf6',
  '#ef4444','#f43f5e','#06b6d4','#14b8a6','#a855f7','#0891b2',
  '#475569','#6b7280','#10b981','#0ea5e9','#22c55e','#64748b',
  '#f59e0b','#94a3b8','#d946ef','#7c3aed','#059669','#b91c1c',
]

/** Analytics tag choices offered in the category form — drives Insights classification */
export const ANALYTICS_TAG_CHOICES: { value: import('@/types').AnalyticsTag; label: string }[] = [
  { value: 'needs', label: 'Needs' },
  { value: 'wants', label: 'Wants' },
  { value: 'savings', label: 'Savings' },
  { value: 'income', label: 'Primary income' },
  { value: 'subscription', label: 'Subscription' },
  { value: 'credit_card_bill', label: 'Credit card bill' },
]

/** Navigation routes */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  SIGNUP: '/signup',
  FORGOT_PASSWORD: '/forgot-password',
  DASHBOARD: '/dashboard',
  EXPENSES: '/expenses',
  BUDGETS: '/budgets',
  PENDING: '/pending',
  SETTINGS: '/settings',
  PROFILE: '/profile',
  INSIGHTS: '/insights',
  SUBSCRIPTIONS: '/subscriptions',
  PRICING: '/pricing',
  PRIVACY: '/privacy',
  ABOUT: '/about',
  TERMS: '/terms',
  REFUND: '/refund-policy',
  RESET_PASSWORD: '/reset-password',
} as const

/** Standardized, legally compliant footer navigation items across all site templates */
export const FOOTER_NAV_ITEMS = [
  { label: 'Pricing', href: '/pricing' },
  { label: 'About Us', href: '/about' },
  { label: 'Privacy Policy', href: '/privacy' },
  { label: 'Terms of Service', href: '/terms' },
  { label: 'Refund Policy', href: '/refund-policy' },
  { label: 'Support', href: '/support' },
] as const

/** App-level config */
export const APP_CONFIG = {
  APP_NAME: 'Intrack',
  APP_TAGLINE: 'Effortless Tracking. Smart Saving.',
  CURRENCY: 'INR',
  LOCALE: 'en-IN',
  DEFAULT_PAGE_SIZE: 20,
  EMAIL_SCAN_BATCH_SIZE: 50,
  // ── Public contact details ──────────────────────────────────────────────
  // These are printed as the legal contact on the Privacy Policy (§11), the
  // Refund Policy (§2, §5) and the Support Center, and Razorpay's merchant
  // verification checks that the address on the Refund Policy actually works.
  //
  // Keep them here and only here, so a new owner changes four lines rather
  // than hunting through six pages.
  //
  // Previously a support@ address on a vanity domain the site does not run on,
  // with a mailbox that was never live — so the documented route for a DPDPA
  // grievance and for a billing dispute both dead-ended.
  SUPPORT_EMAIL: 'contact.ansh@gmail.com',
  // TODO(owner): DPDPA 2023 §13 expects a contactable individual, not a team
  // alias. Replace with the responsible person's name before relying on this
  // for a grievance response.
  SUPPORT_NAME: 'Intrack Support',
  SUPPORT_DESIGNATION: 'Data Protection Officer & Grievance Officer',
  SUPPORT_ADDRESS: 'Jaipur, Rajasthan, India',
} as const

export interface FaqItem {
  q: string
  a: string
  category?: 'security' | 'scanning' | 'pricing' | 'general'
}

/** Unified single source of truth for FAQs across Landing Page & Support Center */
export const FAQ_ITEMS: FaqItem[] = [
  {
    q: 'How does Intrack detect what I spent?',
    a: 'Connect your Gmail inbox once and Intrack automatically reads bank transaction alert emails with AI, extracting the merchant, amount, and category without manual typing. You can also log any expense manually in seconds.',
    category: 'scanning',
  },
  {
    q: 'Can the app see my bank passwords, PINs, or move money?',
    a: 'Absolutely not. Intrack is completely read-only. We never request, store, or touch net-banking credentials, PINs, card numbers, CVVs, or OTPs. We cannot initiate transfers or move your money in any way.',
    category: 'security',
  },
  {
    q: 'Does Intrack read my SMSes or non-financial emails?',
    a: 'Never your SMS inbox — Intrack has no access to it at all. Detection works strictly through your authorised Gmail connection, and only on messages a financial-keyword search returns (NEFT, RTGS, UPI, card debits and the like). Judging whether one of those is a real transaction means reading its subject and the start of its body, so some newsletters and promotions caught by that search do get read — they are then discarded, never saved as transactions.',
    category: 'security',
  },
  {
    q: 'Why does my Google connection occasionally expire?',
    a: 'Standard Google OAuth security tokens expire periodically if security settings change. If automated scanning pauses, simply sign out and log back in to refresh your secure authorization token.',
    category: 'scanning',
  },
  {
    q: 'Do I have to connect my email to use the app?',
    a: 'No — connecting Gmail is completely optional. You can track all your income and expenses manually if you prefer. Connecting Gmail simply automates the logging process.',
    category: 'general',
  },
  {
    q: 'What happens after the 7-day free trial ends?',
    a: 'During the 7-day free trial, you receive full access to automated scanning, budgets, and smart insights. After the trial ends, automatic background scanning pauses until you upgrade. Manual logging remains free forever.',
    category: 'pricing',
  },
  {
    q: 'How is my personal financial data protected?',
    a: 'All data is encrypted in transit using TLS 1.3 and partitioned at rest using Supabase Row-Level Security (RLS) policies, so your rows are readable only by your own account. Your financial logs are never sold, shared, or used to train third-party AI models.',
    category: 'security',
  },
]
