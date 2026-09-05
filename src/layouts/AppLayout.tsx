// ============================================
// AppLayout — Main application shell
// Sticky nav with working links
// ============================================

import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ROUTES } from '@/constants'
import { cn } from '@/utils'
import { useState, useEffect, useCallback } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { transition } from '@/components/ui'
import { useAuth, useToast } from '@/context'
import Button from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SiteFooter from '@/components/ui/SiteFooter'
import BrandMark from '@/components/ui/BrandMark'
import { submitFeedback, supabase } from '@/services'
import { getActiveReceivables } from '@/services/transactions'
import {
  Bell,
  User,
  Settings,
  Crown,
  LogOut,
  Menu,
  X,
  BarChart3,
  Clock,
  MessageSquare,
  ChevronDown,
  CheckCircle2,
  Home,
  CreditCard,
  Plus,
  Sparkles,
  Wallet,
  HandCoins,
  ShieldCheck,
} from 'lucide-react'
import { canAccessAdmin } from '@/services/adminAccess'
import ScrollHint from '@/components/ui/ScrollHint'

interface AppLayoutProps {
  children: ReactNode
}

const navItems = [
  { label: 'Home', path: ROUTES.DASHBOARD },
  { label: 'Transactions', path: ROUTES.EXPENSES },
  { label: 'Budgets', path: ROUTES.BUDGETS },
  { label: 'Pending', path: ROUTES.PENDING },
  { label: 'Insights', path: ROUTES.INSIGHTS },
  { label: 'Subscriptions', path: ROUTES.SUBSCRIPTIONS },
]
// Pricing is deliberately NOT here. It is a marketing page, not a daily tool:
// the six entries above are the app. Anyone who actually wants to change plans
// is going to billing, so Pricing lives in the profile/user menu instead
// ("Pricing & Plans", in the dropdown below, the mobile menu and UserMenu).
// The /pricing route itself is untouched and stays exempt in ProtectedRoute.

/**
 * What plan an active account actually holds.
 *
 * The header badge used to ask `plan_type === 'monthly' ? Monthly : Yearly`, so
 * EVERY active account whose plan_type was anything else rendered as
 * "Yearly Plan 👑" — including null (admin-granted access with no type set),
 * '' (written by AuthContext's cache fallback when the profile read fails) and
 * 'trial'. The app upsells yearly, so the buggy default was also the most
 * generous possible claim about what the user had bought.
 *
 * 'annual' is what updateSubscriptionStatus and the payment endpoint write;
 * 'yearly' is accepted too because older rows and admin edits use that spelling.
 * Anything we do not recognise is reported as 'unknown' and labelled honestly
 * rather than guessed at — a plan we cannot name is not a reason to name the
 * expensive one.
 */
function resolveActivePlan(planType: unknown): 'monthly' | 'yearly' | 'unknown' {
  const normalized = typeof planType === 'string' ? planType.trim().toLowerCase() : ''
  if (normalized === 'monthly') return 'monthly'
  if (normalized === 'annual' || normalized === 'yearly') return 'yearly'
  return 'unknown'
}

export default function AppLayout({ children }: AppLayoutProps) {
  const { user, signOut, profile, daysLeft, openAuthModal } = useAuth()
  const { showToast } = useToast()
  const location = useLocation()

  // Header plan badge. Only 'monthly' gets the "Upgrade to Yearly" call to
  // action; only a recognised annual plan gets the yearly wording. Everything
  // else is an active account whose plan we cannot name, and it says so instead
  // of borrowing the yearly label — see resolveActivePlan.
  const activePlan = resolveActivePlan(profile?.subscription_plan_type)
  const activePlanLabel =
    activePlan === 'monthly' ? 'Monthly Plan' : activePlan === 'yearly' ? 'Yearly Plan' : 'Active Plan'
  const showPlanValidity = () => {
    const until = profile?.subscription_expires_at
      ? ` until ${new Date(profile.subscription_expires_at).toLocaleDateString('en-IN')}`
      : ''
    showToast(
      activePlan === 'unknown'
        ? `Your subscription is active${until}. No plan type is recorded on this account — contact support if that looks wrong.`
        : `Your ${activePlanLabel} is active${until}.`,
      'info'
    )
  }
  const isAppRoute = [
    '/dashboard',
    '/expenses',
    '/budgets',
    '/pending',
    '/insights',
    '/settings',
    '/profile',
    '/subscriptions',
    '/payment-success',
    '/admin'
  ].includes(location.pathname)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Motion reports state: the mobile menu opening, the install banner
  // arriving. Both collapse to nothing under a reduced-motion preference.
  const reduceMotion = useReducedMotion()
  type NotificationItem = { key: string; message: string; type: 'danger' | 'warning' | 'info'; href: string }
  const [notifications, setNotifications] = useState<NotificationItem[]>([])
  const [notificationDropdownOpen, setNotificationDropdownOpen] = useState(false)

  const getDismissedKeys = (): Set<string> => {
    try {
      const raw = localStorage.getItem('intrack_dismissed_notifications')
      return new Set(raw ? JSON.parse(raw) : [])
    } catch {
      return new Set()
    }
  }

  const fetchNotifications = useCallback(async () => {
    if (!user) return

    // Check if we have cached notifications that are less than 5 minutes old (V2: extended from 30s to reduce Supabase load)
    try {
      const cachedData = sessionStorage.getItem('intrack_notifications_cache')
      if (cachedData) {
        const { items, timestamp } = JSON.parse(cachedData)
        if (Date.now() - timestamp < 300000) {
          const dismissed = getDismissedKeys()
          setNotifications((items as NotificationItem[]).filter((i) => !dismissed.has(i.key)))
          return
        }
      }
    } catch { /* Cached notifications unreadable; fall through and rebuild them. */ }

    const items: NotificationItem[] = []

    try {
      const curMonth = new Date().toISOString().substring(0, 7)

      // 1. Fetch pending alerts count
      const { count: pendingCount, error: pendingErr } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('approval_status', 'pending')

      if (!pendingErr && pendingCount && pendingCount > 0) {
        items.push({
          key: 'pending_count',
          message: `You have ${pendingCount} pending transaction alert(s) requiring review.`,
          type: 'info',
          href: '/pending',
        })
      }

      // 2. Fetch budgets and expenses for current month
      const [budgetsRes, summaryRes] = await Promise.all([
        supabase.from('budgets').select('*').eq('user_id', user.id).eq('month', curMonth),
        supabase.from('transactions').select('amount, category').eq('approval_status', 'approved').eq('type', 'debit').gte('date', `${curMonth}-01`)
      ])

      if (!budgetsRes.error && budgetsRes.data && !summaryRes.error && summaryRes.data) {
        const spentMap: Record<string, number> = {}
        summaryRes.data.forEach((t) => {
          spentMap[t.category] = (spentMap[t.category] || 0) + Number(t.amount)
        })

        budgetsRes.data.forEach((budget) => {
          const spent = spentMap[budget.category] || 0
          const pct = budget.amount > 0 ? (spent / budget.amount) * 100 : 0
          const catLabel = budget.category.toUpperCase()

          if (pct >= 100) {
            items.push({
              key: `budget_over_${budget.category}_${curMonth}`,
              message: `Budget exceeded for ${catLabel}! (Spent ${Math.round(pct)}% of limit)`,
              type: 'danger',
              href: '/budgets',
            })
          } else if (pct >= 70) {
            items.push({
              key: `budget_near_${budget.category}_${curMonth}`,
              message: `Reached ${Math.round(pct)}% of budget limit for ${catLabel}.`,
              type: 'warning',
              href: '/budgets',
            })
          }
        })
      }

      // 3. Receivables due within 7 days or overdue
      const todayStr = new Date().toISOString().split('T')[0]
      const { data: receivables } = await getActiveReceivables()

      if (receivables) {
        receivables.forEach((r) => {
          if (!r.expected_return_date) return
          const dueDate = new Date(r.expected_return_date)
          const isOverdue = r.expected_return_date < todayStr
          const daysOut = Math.ceil((dueDate.getTime() - new Date(todayStr).getTime()) / (24 * 60 * 60 * 1000))
          if (isOverdue) {
            items.push({
              key: `receivable_overdue_${r.id}`,
              message: `${r.counterparty || 'Someone'} still owes you back for an expense (overdue).`,
              type: 'danger',
              href: '/dashboard',
            })
          } else if (daysOut <= 7) {
            items.push({
              key: `receivable_soon_${r.id}`,
              message: `${r.counterparty || 'Someone'} owes you back within ${daysOut} day(s).`,
              type: 'warning',
              href: '/dashboard',
            })
          }
        })
      }

    } catch (e) {
      console.error('Error fetching notifications:', e)
    }

    // Save the full (undismissed-filtered) set to cache, then filter for display
    try {
      sessionStorage.setItem('intrack_notifications_cache', JSON.stringify({
        items,
        timestamp: Date.now()
      }))
    } catch { /* sessionStorage blocked; skip the cache, the list still renders. */ }

    const dismissed = getDismissedKeys()
    setNotifications(items.filter((i) => !dismissed.has(i.key)))
  }, [user])

  const handleClearNotifications = () => {
    try {
      const dismissed = getDismissedKeys()
      notifications.forEach((n) => dismissed.add(n.key))
      localStorage.setItem('intrack_dismissed_notifications', JSON.stringify([...dismissed]))
    } catch { /* localStorage blocked; dismissals just will not persist. */ }
    setNotifications([])
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 300000) // 5 min — matches cache TTL
    return () => clearInterval(interval)
  }, [user, fetchNotifications])



  // Helper to extract first name of the user, ignoring standard titles
  const getFirstName = (fullName?: string) => {
    const nameToParse = profile?.full_name || fullName || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.user_metadata?.first_name || user?.email?.split('@')[0] || 'Account'
    
    const parts = nameToParse.trim().split(/\s+/)
    let result = parts[0]
    const cleanWord = (word: string) => word.replace(/[^a-zA-Z]/g, '').toLowerCase()
    
    if (parts.length > 1 && ['ca', 'dr', 'mr', 'ms', 'mrs'].includes(cleanWord(parts[0]))) {
      result = parts[1]
    }
    return result
  }

  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false)

  // Escape closes whichever header dropdown/menu is open
  useEffect(() => {
    if (!notificationDropdownOpen && !profileDropdownOpen && !mobileMenuOpen) return
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setNotificationDropdownOpen(false)
      setProfileDropdownOpen(false)
      setMobileMenuOpen(false)
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [notificationDropdownOpen, profileDropdownOpen, mobileMenuOpen])

  // Feedback Modal States
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackCategory, setFeedbackCategory] = useState<'bug' | 'feature_request' | 'ui_ux' | 'other'>('ui_ux')
  const [feedbackRating, setFeedbackRating] = useState<number>(5)
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackLoading, setFeedbackLoading] = useState(false)
  const [feedbackSuccess, setFeedbackSuccess] = useState(false)
  // A send that failed. The modal used to have nowhere to show this, because
  // submitFeedback always claimed success — so a failed write closed the modal
  // with a 🎉 and the message was gone.
  const [feedbackError, setFeedbackError] = useState<string | null>(null)

  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (feedbackMessage.trim().length < 5) return

    setFeedbackLoading(true)
    setFeedbackError(null)
    try {
      const { success, error } = await submitFeedback({
        rating: feedbackRating,
        category: feedbackCategory,
        message: feedbackMessage,
      })

      if (!success) {
        // The typed message stays in the box — losing it here is the one thing
        // that would make a failed send worse than it already is.
        setFeedbackError(error?.message || 'Could not send your feedback. Please try again.')
        return
      }

      setFeedbackSuccess(true)
      setFeedbackMessage('')
      setFeedbackRating(5)
      setFeedbackCategory('ui_ux')

      // Auto close overlay after 2.2 seconds
      setTimeout(() => {
        setFeedbackSuccess(false)
        setFeedbackOpen(false)
      }, 2200)
    } catch (err) {
      console.error('Error submitting feedback:', err)
      setFeedbackError('Could not send your feedback. Please try again.')
    } finally {
      setFeedbackLoading(false)
    }
  }

  // First-run privacy explainer — a single static dismissible card (no fake
  // "verification" timer; just tells the user what happens once and gets out
  // of the way).
  const [showPrivacyNote, setShowPrivacyNote] = useState(() => {
    try {
      return localStorage.getItem('intrack_security_acknowledged') !== 'true'
    } catch {
      return true
    }
  })

  const handleDismissPrivacyNote = () => {
    setShowPrivacyNote(false)
    try {
      localStorage.setItem('intrack_security_acknowledged', 'true')
    } catch { /* localStorage blocked; the note reappears next visit. */ }
  }





  // PWA Install Prompt State and Logic for Mobile Viewports
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null)
  const [showInstallBanner, setShowInstallBanner] = useState(false)

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault()
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e)
      // Check if user has previously dismissed the banner
      const isDismissed = localStorage.getItem('intrack_pwa_dismissed') === 'true'
      if (!isDismissed) {
        setShowInstallBanner(true)
      }
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)

    // Listen for appinstalled event
    const handleAppInstalled = () => {
      setDeferredPrompt(null)
      setShowInstallBanner(false)
    }
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  const handleInstallClick = async () => {
    if (!deferredPrompt) return
    // Show the install prompt
    deferredPrompt.prompt()
    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice
    console.log(`User response to the install prompt: ${outcome}`)
    // We've used the prompt, and can't use it again, discard it
    setDeferredPrompt(null)
    setShowInstallBanner(false)
  }

  const handleDismissBanner = () => {
    localStorage.setItem('intrack_pwa_dismissed', 'true')
    setShowInstallBanner(false)
  }

  // Maps a notification's key prefix (set when the item was pushed in
  // fetchNotifications above) to its source concern, so the dropdown reads
  // at a glance instead of requiring every line to be read individually.
  const getNotificationIcon = (key: string) => {
    if (key.startsWith('budget_')) return Wallet
    if (key.startsWith('receivable_')) return HandCoins
    return Bell
  }

  return (
    <div className={cn("min-h-screen flex flex-col", "bg-sb-canvas text-sb-ink")}>
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>
      <header className={cn(
        "sticky top-0 z-50 w-full border-b select-none transition-all duration-300",
        "border-sb-hairline bg-sb-canvas text-sb-ink backdrop-blur-xl"
      )}>
        <div className="mx-auto max-w-7xl h-[64px] flex items-center justify-between px-4 sm:px-6 lg:px-8 gap-6">
          <Link to="/" className="flex items-center gap-3 shrink-0 group">
            <BrandMark size={32} className="text-brand-500 shrink-0" />
            <div className="flex items-center gap-2.5">
              <div className="text-base tracking-tight leading-none">
                <span className={cn(
                  "font-extrabold transition-colors duration-300",
                  "text-sb-primary"
                )}>In</span><span className={cn("text-sb-ink")}>track</span>
              </div>
              <span className={cn(
                "text-xs font-bold tracking-wider uppercase px-2.5 py-0.5 rounded-full border hidden md:inline-flex items-center gap-1.5",
                "bg-brand-50 border-brand-200/60 text-brand-700"
              )}>
                <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", "bg-brand-600")} />
                Automated Tracker
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          {user && isAppRoute ? (
            <ScrollHint
              wrapperClassName="hidden lg:block"
              className="flex items-center gap-3 text-xs font-semibold"
              ariaLabel="Desktop navigation"
            >
                {navItems
                  .map((item) => {
                    const isActive = location.pathname === item.path
                    return (
                      <Link
                        key={item.path}
                        to={item.path}
                        className={cn(
                          "relative py-1.5 px-2.5 rounded-lg text-xs font-semibold shrink-0 transition-all duration-200 whitespace-nowrap",
                          isActive
                            ? "bg-emerald-50 text-emerald-700 font-bold border border-emerald-200/60 shadow-sm"
                            : "text-sb-ink-muted hover:text-sb-ink hover:bg-sb-canvas-soft"
                        )}
                      >
                        {item.label}
                      </Link>
                    )
                  })}
              </ScrollHint>
            ) : (
              <nav className="hidden lg:flex items-center gap-8" aria-label="Desktop navigation">
                {[
                  { label: 'How it works', href: '/#how-it-works' },
                  { label: 'Features', href: '/#features' },
                  { label: 'Install App', href: '/#install-guide' },
                  { label: 'Pricing', href: '/pricing' },
                  { label: 'FAQ', href: '/#faq' },
                  { label: 'Support', href: '/support' },
                ].map((item) => (
                  // All of these route client-side now, hash targets included —
                  // ScrollToTop in App.tsx scrolls to the section. They used to
                  // be plain <a> tags, which re-downloaded the whole bundle just
                  // to jump to an anchor on the landing page.
                  <Link
                    key={item.label}
                    to={item.href}
                    className="sb-caption font-semibold transition-colors text-sb-ink-muted hover:text-sb-primary whitespace-nowrap no-underline"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}

            {/* Actions: Notifications, Profile, Hamburger, Upgrade CTA */}
            <div className="flex items-center gap-3 sm:gap-4 shrink-0">


              {/* Notification Bell */}
              {user && (
                <div className="relative shrink-0">
                  <button
                    onClick={() => setNotificationDropdownOpen(!notificationDropdownOpen)}
                    className={cn(
                      "transition-colors h-11 w-11 flex items-center justify-center rounded-lg relative cursor-pointer",
                      "text-sb-ink-muted hover:text-sb-ink hover:bg-sb-canvas-soft"
                    )}
                    title="Notifications"
                    aria-label={notifications.length > 0 ? `View notifications (${notifications.length} unread)` : 'View notifications'}
                    aria-expanded={notificationDropdownOpen}
                  >
                    <Bell className="h-4 w-4" />
                    {notifications.length > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--status-danger-text)] px-0.5 text-[10px] font-bold text-white ring-1 ring-white/10">
                        {notifications.length > 9 ? '9+' : notifications.length}
                      </span>
                    )}
                  </button>

                  {notificationDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setNotificationDropdownOpen(false)} />
                      <div className={cn("absolute right-0 mt-2 w-64 rounded-xl border p-3 shadow-2xl z-50 animate-scale-up backdrop-blur-xl max-h-[80vh] overflow-y-auto", "border-sb-hairline bg-sb-canvas text-sb-ink")}>
                        <div className="flex items-center justify-between border-b border-border-subtle pb-2 mb-2">
                          <span className={cn("text-xs font-bold uppercase tracking-widest flex items-center gap-1.5", "text-sb-ink-muted")}>
                            <Bell className="h-3 w-3" /> Notifications
                          </span>
                          {notifications.length > 0 && (
                            <button
                              onClick={handleClearNotifications}
                              className={cn("text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer", "text-sb-primary hover:text-sb-primary-deep")}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        {notifications.length === 0 ? (
                          <p className="text-xs text-zinc-500 py-4 text-center font-medium">
                            No new notifications. All caught up!
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {notifications.map((n) => {
                              const NotifIcon = getNotificationIcon(n.key)
                              return (
                                <Link
                                  key={n.key}
                                  to={n.href}
                                  onClick={() => setNotificationDropdownOpen(false)}
                                  className={cn(
                                    "flex items-start gap-2 p-2.5 rounded-lg border text-xs leading-relaxed font-semibold transition-all hover:opacity-85",
                                    n.type === 'danger'
                                      ? 'bg-[var(--status-danger-subtle)] border-[var(--status-danger-border)] text-[var(--status-danger-text)]'
                                      : n.type === 'warning'
                                      ? 'bg-[var(--status-warning-subtle)] border-[var(--status-warning-border)] text-[var(--status-warning-text)]'
                                      : ('bg-sb-canvas-soft border-sb-hairline text-sb-ink')
                                  )}
                                >
                                  <NotifIcon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                                  <span>{n.message}</span>
                                </Link>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Upgrade or Status CTA */}
              <div className="hidden sm:flex items-center shrink-0">
                {!isAppRoute && user ? (
                  <Link
                    to="/dashboard"
                    className="sb-btn-primary rounded-[6px] text-xs font-semibold border-0 cursor-pointer whitespace-nowrap shadow-sm"
                  >
                    Open app
                  </Link>
                ) : profile?.subscription_status === 'active' ? (
                  activePlan === 'monthly' ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2.5 py-1 rounded-[6px] text-xs font-bold uppercase tracking-wider text-zinc-300 bg-surface-2 border border-border-subtle shrink-0 select-none">
                        Monthly Plan 👑
                      </span>
                      <Link
                        to="/pricing"
                        className="inline-flex items-center justify-center px-3 py-1.5 rounded-[6px] text-[11px] font-bold uppercase tracking-wider text-[var(--sb-on-primary)] bg-[var(--sb-primary)] hover:bg-[var(--sb-primary-deep)] active:scale-97 transition-all cursor-pointer shrink-0 whitespace-nowrap shadow-sm"
                      >
                        Upgrade to Yearly
                      </Link>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={showPlanValidity}
                        className="px-2.5 py-1 rounded-[6px] text-xs font-bold uppercase tracking-wider text-[var(--status-positive-text)] bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] shrink-0 cursor-pointer hover:bg-[var(--status-positive-border)]/20 transition-all select-none"
                        title="Click to view validity"
                      >
                        {activePlanLabel} 👑
                      </button>
                    </div>
                  )
                ) : user ? (
                  <Link
                    to="/pricing"
                    className="inline-flex items-center justify-center px-3 py-1.5 rounded-[6px] text-[11px] font-bold uppercase tracking-wider text-[var(--sb-on-primary)] bg-[var(--sb-primary)] hover:bg-[var(--sb-primary-deep)] active:scale-97 transition-all cursor-pointer shrink-0 whitespace-nowrap shadow-sm"
                  >
                    Upgrade
                  </Link>
                ) : (
                  <button
                    onClick={() => openAuthModal(undefined, 'signup')}
                    className="sb-btn-primary rounded-[6px] border-0 cursor-pointer text-xs font-semibold whitespace-nowrap shadow-sm"
                  >
                    Get started
                  </button>
                )}
              </div>

              {/* Profile Dropdown */}
              {user ? (
                <div className="relative shrink-0">
                  <button
                    onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                    className={cn(
                      "flex items-center gap-1.5 h-11 px-1 transition-colors cursor-pointer",
                      "text-sb-ink hover:text-sb-ink"
                    )}
                    aria-label="User profile menu"
                    aria-expanded={profileDropdownOpen}
                  >
                    <div className="h-6 w-6 rounded-full bg-brand-500/10 flex items-center justify-center text-xs font-bold text-brand-500 overflow-hidden border border-brand-500/25 shrink-0">
                      {user?.user_metadata?.avatar_url ? (
                        <img src={user.user_metadata.avatar_url} alt="Avatar" className="h-full w-full object-cover" />
                      ) : (
                        user?.user_metadata?.full_name?.substring(0, 1).toUpperCase() || 'U'
                      )}
                    </div>
                    <span className="text-[11px] font-medium truncate max-w-[60px] hidden sm:inline">{getFirstName()}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>

                  {profileDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setProfileDropdownOpen(false)} />
                      <div className={cn("absolute right-0 mt-2 w-48 rounded-xl border p-2 shadow-xl z-50 animate-scale-up", "border-sb-hairline bg-sb-canvas text-sb-ink")}>
                        <Link
                          to="/profile"
                          onClick={() => setProfileDropdownOpen(false)}
                          className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors", "text-sb-ink hover:bg-sb-canvas-soft")}
                        >
                          <User className="h-3.5 w-3.5 text-zinc-500 shrink-0" /> Profile Section
                        </Link>
                        <Link
                          to="/settings"
                          onClick={() => setProfileDropdownOpen(false)}
                          className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors", "text-sb-ink hover:bg-sb-canvas-soft")}
                        >
                          <Settings className="h-3.5 w-3.5 text-zinc-500 shrink-0" /> Settings Section
                        </Link>
                        {canAccessAdmin(profile) && (
                          <Link
                            to="/admin"
                            onClick={() => setProfileDropdownOpen(false)}
                            className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors", "text-sb-ink hover:bg-sb-canvas-soft")}
                          >
                            <ShieldCheck className="h-3.5 w-3.5 text-zinc-500 shrink-0" /> Admin Section
                          </Link>
                        )}
                        <Link
                          to="/pricing"
                          onClick={() => setProfileDropdownOpen(false)}
                          className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors", "text-sb-ink hover:bg-sb-canvas-soft")}
                        >
                          <Crown className="h-3.5 w-3.5 text-zinc-500 shrink-0" /> Pricing & Plans
                        </Link>
                        <button
                          onClick={() => {
                            setProfileDropdownOpen(false)
                            setFeedbackOpen(true)
                          }}
                          className={cn("w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors cursor-pointer", "text-sb-ink hover:bg-sb-canvas-soft")}
                        >
                          <MessageSquare className="h-3.5 w-3.5 text-zinc-500 shrink-0" /> Send Feedback
                        </button>
                        <button
                          onClick={() => {
                            setProfileDropdownOpen(false)
                            signOut()
                          }}
                          className={cn("w-full text-left flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors border-t mt-1.5 pt-1.5 cursor-pointer", "border-sb-hairline text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)]")}
                        >
                          <LogOut className="h-3.5 w-3.5 text-red-400 shrink-0" /> Sign Out
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => openAuthModal(undefined, 'login')}
                  className="sb-caption font-semibold border-0 bg-transparent cursor-pointer text-sb-ink-muted hover:text-sb-ink no-underline whitespace-nowrap px-1"
                >
                  Sign in
                </button>
              )}

              {/* Hamburger Menu button for mobile */}
              <button
                className={cn(
                  "flex lg:hidden h-11 w-11 items-center justify-center rounded-lg transition-colors cursor-pointer shrink-0",
                  "text-sb-ink hover:bg-sb-canvas-soft"
                )}
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={mobileMenuOpen}
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </button>
            </div>
          </div>

        {/* Mobile menu dropdown */}
        {mobileMenuOpen && (
          <motion.nav
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            transition={transition(reduceMotion)}
            className={cn("border-b px-4 py-3 space-y-1 lg:hidden overflow-hidden", "border-sb-hairline bg-sb-canvas text-sb-ink")}
            aria-label="Mobile navigation"
          >
            {user && isAppRoute ? (
              <>
                {navItems
                  .map((item) => {
                    const isActive = location.pathname === item.path
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        'block rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                        isActive
                          ? ('bg-sb-canvas-soft text-sb-ink font-bold')
                          : ('text-sb-ink-muted hover:bg-sb-canvas-soft')
                      )}
                    >
                      {item.label}
                    </Link>
                  )
                })}
                <Link
                  to="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn("flex items-center rounded-lg px-3 py-2.5 text-sm font-medium border-t mt-2 pt-3", "text-sb-ink border-sb-hairline hover:bg-sb-canvas-soft")}
                >
                  <User className="h-4 w-4 mr-2 text-zinc-500 shrink-0" /> Profile Section
                </Link>
                <Link
                  to="/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    location.pathname === '/settings'
                      ? 'font-bold'
                      : ''
                  )}
                >
                  <Settings className="h-4 w-4 mr-2 text-zinc-500 shrink-0" /> Settings Section
                </Link>
                {canAccessAdmin(profile) && (
                  <Link
                    to="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      location.pathname === '/admin' ? 'font-bold' : ''
                    )}
                  >
                    <ShieldCheck className="h-4 w-4 mr-2 text-zinc-500 shrink-0" /> Admin Section
                  </Link>
                )}
                <Link
                  to="/pricing"
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                    location.pathname === '/pricing'
                      ? 'font-bold'
                      : ''
                  )}
                >
                  <Crown className="h-4 w-4 mr-2 text-zinc-500 shrink-0" /> Pricing & Plans
                </Link>

                <button
                  onClick={() => {
                    setMobileMenuOpen(false)
                    signOut()
                  }}
                  className={cn("w-full text-left flex items-center rounded-lg px-3 py-2.5 text-sm font-medium border-t mt-1 pt-3 cursor-pointer", "border-sb-hairline text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)]")}
                >
                  <LogOut className="h-4 w-4 mr-2 text-red-400 shrink-0" /> Sign Out
                </button>
              </>
            ) : (
              <>
                {user && (
                  <Link
                    to="/dashboard"
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold mb-3 text-center no-underline transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                      "bg-brand-500/10 text-brand-700 border border-brand-500/30 hover:bg-brand-500/15"
                    )}
                  >
                    <BarChart3 className="h-4 w-4 shrink-0" aria-hidden="true" /> Open app
                  </Link>
                )}
                {/* Mirrors the desktop nav above. "Daily Life" used to point at
                    /#daily-utility, a section that does not exist on the landing
                    page — the four real ids are how-it-works, features,
                    install-guide and faq. */}
                {[
                  { label: 'How it works', href: '/#how-it-works' },
                  { label: 'Features', href: '/#features' },
                  { label: 'Install App', href: '/#install-guide' },
                  { label: 'FAQ', href: '/#faq' },
                  { label: 'Pricing', href: '/pricing' },
                  { label: 'Support', href: '/support' },
                ].map((item) => (
                  <Link
                    key={item.label}
                    to={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium no-underline transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40",
                      "text-sb-ink hover:bg-sb-canvas-soft"
                    )}
                  >
                    {item.label}
                  </Link>
                ))}

                {user ? (
                  <button
                    onClick={() => {
                      setMobileMenuOpen(false)
                      signOut()
                    }}
                    className={cn(
                      "w-full text-left flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-medium border-t mt-1 pt-3 cursor-pointer transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--status-danger-border)]",
                      "border-sb-hairline text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)]"
                    )}
                  >
                    <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" /> Sign out
                  </button>
                ) : (
                  <div className="mt-3 space-y-2 border-t border-sb-hairline pt-3">
                    <Button variant="secondary" block onClick={() => {
                      setMobileMenuOpen(false)
                      openAuthModal(undefined, 'login')
                    }}>
                      Sign in
                    </Button>
                    <Button block onClick={() => {
                      setMobileMenuOpen(false)
                      openAuthModal(undefined, 'signup')
                    }}>
                      Get started
                    </Button>
                  </div>
                )}
              </>
            )}
          </motion.nav>
        )}
      </header>

      {/* Main Content */}
      {/* Trial strip. There is no free tier — when the trial ends, access stops
          — so the copy says what runs out and what the deadline is, without
          implying a downgraded-but-still-working state afterwards. */}
      {profile?.subscription_status === 'trial' && (
        <div className="bg-[var(--status-warning-subtle)] text-[var(--status-warning-text)] text-sm py-2.5 px-4 text-center flex flex-col sm:flex-row items-center justify-center gap-x-2 gap-y-1 border-b border-[var(--status-warning-border)]">
          <span className="flex items-center gap-1.5 justify-center font-medium">
            <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              Trial · <span className="tnum font-semibold">{daysLeft}</span>{' '}
              {daysLeft === 1 ? 'day' : 'days'} of full access left
            </span>
          </span>
          <Link
            to="/pricing"
            className="rounded underline underline-offset-2 hover:opacity-85 transition-opacity font-semibold text-[var(--status-warning-text)] flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--status-warning-border)]"
          >
            Choose a plan <Crown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </Link>
        </div>
      )}
      {/* pb-28 clears the fixed mobile bottom nav (h-16 plus its safe-area inset).
          Without it the last row of every list and the last button of every form
          sat underneath the nav on a phone. md:pb-6 restores normal spacing from
          the breakpoint where that nav is hidden. */}
      <main
        className="mx-auto flex-1 max-w-7xl w-full px-4 pt-6 pb-28 sm:px-6 lg:px-8 lg:pb-6"
        id="main-content"
      >
        {user && isAppRoute && showPrivacyNote && (
          <div className="mb-6 rounded-2xl border border-border-subtle bg-surface-1 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start gap-4 shadow-[var(--shadow-sm)]">
            <span
              aria-hidden="true"
              className="h-10 w-10 shrink-0 rounded-xl bg-brand-500/10 text-brand-700 flex items-center justify-center"
            >
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div className="flex-1 min-w-0 space-y-1.5">
              <p className="text-sm font-semibold text-zinc-100">How your data is handled</p>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Your inbox is read straight from Gmail — we never hold a copy of your mailbox. To
                classify an alert, its subject and the start of its body pass through our server to
                Google’s Gemini in real time and are not retained. Your Google access is read-only,
                and we never ask for passwords, PINs, or OTPs.
              </p>
            </div>
            <Button variant="secondary" size="md" onClick={handleDismissPrivacyNote} className="shrink-0 self-start">
              Got it
            </Button>
          </div>
        )}
        {children}
      </main>

      {/* Footer Nav and Legal compliance links */}
      {/* The build-metadata line that used to live here — "Version 1.0.0
          (Production Build) · Proprietary Closed-Source License" — was
          developer-facing text printed on /pricing and /support, two pages a
          prospective customer reads before signing up. */}
      <SiteFooter tone="app" />

      {/* Feedback Modal — opened from the profile menu / Settings, not a FAB */}
      <Modal
        isOpen={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        title={feedbackSuccess ? 'Feedback submitted' : 'Send feedback'}
      >
            {/* Success screen */}
            {feedbackSuccess ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <span
                  aria-hidden="true"
                  className="h-16 w-16 rounded-2xl bg-[var(--status-positive-subtle)] border border-[var(--status-positive-border)] flex items-center justify-center text-[var(--status-positive-text)]"
                >
                  <CheckCircle2 className="h-7 w-7" />
                </span>
                <h3 className="mt-4 text-lg font-semibold text-zinc-100">Sent — thank you</h3>
                <p className="mt-1.5 max-w-xs text-sm text-zinc-400 leading-relaxed">
                  We read every note. If you reported a bug, this is what tells us where to look.
                </p>
              </div>
            ) : (
              <>
                {/* Form */}
                <form onSubmit={handleFeedbackSubmit} className="space-y-5 flex-1">

                  {/* Category Selection */}
                  <fieldset>
                    <legend className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                      What is this about?
                    </legend>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {([
                        { key: 'ui_ux', label: 'Design & layout', desc: 'Spacing, colour, wording' },
                        { key: 'bug', label: 'Something broke', desc: 'An error or wrong figure' },
                        { key: 'feature_request', label: 'Feature idea', desc: 'Something you wish it did' },
                        { key: 'other', label: 'Anything else', desc: 'General thoughts' },
                      ] as const).map((cat) => (
                        <button
                          key={cat.key}
                          type="button"
                          onClick={() => setFeedbackCategory(cat.key)}
                          aria-pressed={feedbackCategory === cat.key}
                          className={cn(
                            'min-h-11 p-3 rounded-xl border text-left transition-colors cursor-pointer',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                            feedbackCategory === cat.key
                              ? 'bg-brand-500/10 border-brand-500/40 text-zinc-100'
                              : 'bg-surface-2/50 border-border-subtle/50 text-zinc-300 hover:border-border-hover'
                          )}
                        >
                          <span className="block text-sm font-semibold">{cat.label}</span>
                          <span className="block text-xs text-zinc-400 mt-0.5 leading-normal">{cat.desc}</span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  {/* Rating Selector */}
                  <fieldset>
                    <legend className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">
                      How is it going?
                    </legend>
                    <div className="flex items-stretch justify-between gap-1 bg-surface-2/40 border border-border-subtle/40 rounded-xl p-1.5">
                      {[
                        { val: 1, emoji: '😠', label: 'Bad' },
                        { val: 2, emoji: '🙁', label: 'Poor' },
                        { val: 3, emoji: '😐', label: 'Ok' },
                        { val: 4, emoji: '🙂', label: 'Good' },
                        { val: 5, emoji: '😍', label: 'Great' }
                      ].map((rt) => (
                        <button
                          key={rt.val}
                          type="button"
                          onClick={() => setFeedbackRating(rt.val)}
                          aria-pressed={feedbackRating === rt.val}
                          aria-label={`${rt.label} — ${rt.val} out of 5`}
                          className={cn(
                            'flex flex-1 min-w-0 min-h-11 flex-col items-center justify-center gap-1 rounded-lg py-2 cursor-pointer transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                            feedbackRating === rt.val
                              ? 'bg-surface-1 border border-brand-500/40'
                              : 'border border-transparent hover:bg-surface-2'
                          )}
                        >
                          <span aria-hidden="true" className={cn('text-xl select-none', feedbackRating === rt.val ? 'opacity-100' : 'opacity-50')}>
                            {rt.emoji}
                          </span>
                          <span
                            aria-hidden="true"
                            className={cn(
                              'text-xs font-medium truncate max-w-full',
                              feedbackRating === rt.val ? 'text-zinc-100' : 'text-zinc-400'
                            )}
                          >
                            {rt.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </fieldset>

                  {/* Suggestion Text */}
                  <div>
                    <label htmlFor="feedback-message" className="block text-sm font-medium text-zinc-300 mb-1.5">
                      Tell us what happened
                    </label>
                    <textarea
                      id="feedback-message"
                      placeholder="What could be better, or what went wrong?"
                      value={feedbackMessage}
                      onChange={(e) => setFeedbackMessage(e.target.value)}
                      disabled={feedbackLoading}
                      maxLength={500}
                      rows={4}
                      required
                      className="w-full bg-surface-1 border border-border-default rounded-lg p-3 text-sm text-zinc-50 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 hover:border-border-hover transition-[border-color,box-shadow] duration-150 resize-y leading-relaxed"
                    />
                    <div className="flex justify-between items-center gap-3 mt-1.5 text-xs text-zinc-400 px-0.5">
                      <span>At least 5 characters</span>
                      <span className="tnum">{feedbackMessage.length}/500</span>
                    </div>
                  </div>

                  {feedbackError && (
                    <div
                      role="alert"
                      className="rounded-xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-3 text-sm text-[var(--status-danger-text)] leading-relaxed flex items-start gap-2"
                    >
                      <X className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{feedbackError}</span>
                    </div>
                  )}

                  <Button type="submit" block loading={feedbackLoading} disabled={feedbackMessage.trim().length < 5}>
                    Send feedback
                  </Button>
                </form>
              </>
            )}
      </Modal>

      {/* PWA Install Banner for Mobile Viewports.
          It stacks at 360px rather than squeezing two buttons beside two lines
          of text — the old row put "Dismiss" and "Install" at roughly 60px each
          on the narrowest phones. */}
      {showInstallBanner && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={transition(reduceMotion, 0.24)}
          className="fixed bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] left-4 right-4 z-40 lg:hidden"
        >
          <div className="bg-surface-1 border border-border-default rounded-2xl p-4 shadow-[var(--shadow-lg)] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <span
                aria-hidden="true"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500 shadow-[var(--shadow-sm)] text-base font-bold text-static-white"
              >
                <BrandMark size={22} className="text-static-white" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-zinc-100 leading-tight">Add Intrack to your home screen</p>
                <p className="text-sm text-zinc-400 mt-0.5 leading-relaxed">Opens like an app, straight to your dashboard.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="ghost" size="md" onClick={handleDismissBanner} className="flex-1 sm:flex-none">
                Not now
              </Button>
              <Button size="md" onClick={handleInstallClick} className="flex-1 sm:flex-none">
                Install
              </Button>
            </div>
          </div>
        </motion.div>
      )}
      {/* =========================================================== */}
      {/* Mobile Bottom Navigation Bar — shown only on mobile (<md) */}
      {/* =========================================================== */}
      {/* Four destinations either side of one action.
          The labels are deliberately short: at 360px each slot is roughly 70px
          wide, and "Transactions" at 12px does not fit in that — it used to
          overflow its slot. Every label also carries `truncate` so no future
          rename can push the bar wider than the viewport. The full word stays
          in the desktop nav, the mobile menu and each page's own heading. */}
      {user && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-50 lg:hidden bg-surface-1 border-t border-border-subtle safe-area-inset-bottom"
          aria-label="Mobile navigation"
        >
          <div className="flex items-stretch justify-around h-16 px-1">
            {([
              { to: ROUTES.DASHBOARD, icon: Home, label: 'Home', aria: 'Home' },
              { to: ROUTES.EXPENSES, icon: CreditCard, label: 'Spends', aria: 'Transactions' },
            ] as const).map(({ to, icon: TabIcon, label, aria }) => {
              const isActive = location.pathname === to
              return (
                <Link
                  key={to}
                  to={to}
                  aria-label={aria}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                    isActive ? 'text-brand-700' : 'text-zinc-400 hover:text-zinc-200'
                  )}
                >
                  <TabIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  <span className="text-xs font-medium truncate max-w-full">{label}</span>
                </Link>
              )
            })}

            {/* Quick Add — the one action in the bar, so it is the one filled
                shape. No hover scale: on a touch device hover never resolves,
                and the press already reports itself. */}
            <div className="flex-1 flex items-center justify-center">
              <Link
                to={ROUTES.EXPENSES}
                state={{ openForm: true }}
                className={cn(
                  'flex h-12 w-12 items-center justify-center rounded-2xl shadow-[var(--shadow-md)] transition-colors active:scale-95',
                  'bg-[var(--btn-primary-bg)] hover:bg-[var(--btn-primary-bg-hover)] text-[var(--btn-primary-fg)]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40'
                )}
                aria-label="Add a transaction"
              >
                <Plus className="h-6 w-6" strokeWidth={2.5} aria-hidden="true" />
              </Link>
            </div>

            {/* Pending */}
            <Link
              to={ROUTES.PENDING}
              aria-label={
                notifications.length > 0
                  ? `Pending — ${notifications.length} notification${notifications.length === 1 ? '' : 's'}`
                  : 'Pending'
              }
              aria-current={location.pathname === ROUTES.PENDING ? 'page' : undefined}
              className={cn(
                'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                location.pathname === ROUTES.PENDING ? 'text-brand-700' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              <span className="relative inline-flex shrink-0">
                <Bell className="h-5 w-5" aria-hidden="true" />
                {notifications.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--status-danger-text)] px-1 text-[10px] font-bold tnum text-static-white"
                  >
                    {notifications.length > 9 ? '9+' : notifications.length}
                  </span>
                )}
              </span>
              <span className="text-xs font-medium truncate max-w-full">Pending</span>
            </Link>

            {/* Insights */}
            <Link
              to={ROUTES.INSIGHTS}
              aria-label="Insights"
              aria-current={location.pathname === ROUTES.INSIGHTS ? 'page' : undefined}
              className={cn(
                'flex flex-1 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                location.pathname === ROUTES.INSIGHTS ? 'text-brand-700' : 'text-zinc-400 hover:text-zinc-200'
              )}
            >
              <Sparkles className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span className="text-xs font-medium truncate max-w-full">Insights</span>
            </Link>
          </div>
        </nav>
      )}
    </div>
  )
}
