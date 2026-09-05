// ============================================
// AdminPage — tab shell for the admin section.
//
// Mostly read-only. The exceptions are Coupons (create/enable/delete, through
// /api/admin), Users (grant/end access, same endpoint), and the handled flag on
// Feedback and Support, which is an admin-only RLS policy rather than an
// endpoint. See docs/superpowers/specs/2026-08-15-admin-panel-design.md.
//
// Nav shape matches Settings: a sticky left rail from md up, a scrolling pill
// strip below it, one indicator that travels between whichever tab is active
// instead of four that blink on and off. Same primitives, same motion —
// consistency matters more than invention on an internal screen.
// ============================================

import { useEffect, useState } from 'react'
import { APP_CONFIG } from '@/constants'
import { AppLayout } from '@/layouts'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { cn } from '@/utils'
import {
  LayoutDashboard, Users, Mail, Brain, MessageSquare, LifeBuoy, Ticket,
} from 'lucide-react'
import OverviewTab from './OverviewTab'
import UsersTab from './UsersTab'
import ScannerTab from './ScannerTab'
import AiUsageTab from './AiUsageTab'
import FeedbackTab from './FeedbackTab'
import SupportTab from './SupportTab'
import CouponsTab from './CouponsTab'

const TABS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'scanner', label: 'Scanner', icon: Mail },
  { id: 'ai', label: 'AI', icon: Brain },
  { id: 'feedback', label: 'Feedback', icon: MessageSquare },
  { id: 'support', label: 'Support', icon: LifeBuoy },
  { id: 'coupons', label: 'Coupons', icon: Ticket },
] as const

type TabId = (typeof TABS)[number]['id']

export default function AdminPage() {
  const [tab, setTab] = useState<TabId>('overview')
  const reduceMotion = useReducedMotion()

  useEffect(() => { document.title = `Admin | ${APP_CONFIG.APP_NAME}` }, [])

  return (
    <AppLayout>
      <div className="animate-fade-in">
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100 md:text-3xl">Admin</h1>
          <p className="mt-1.5 text-sm text-zinc-400 max-w-2xl">
            Overview, Scanner and AI are read-only. Users and Coupons can change access;
            Feedback and Support can only be marked handled.
          </p>
        </header>

        <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
          <nav
            role="tablist"
            aria-label="Admin sections"
            className={cn(
              'flex gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:-mx-6 sm:px-6',
              'md:mx-0 md:px-0 md:pb-0 md:flex-col md:overflow-visible',
              'md:w-48 lg:w-52 md:shrink-0 md:sticky md:top-20'
            )}
          >
            {TABS.map((t) => {
              const Icon = t.icon
              const isActive = tab === t.id
              return (
                <button
                  key={t.id}
                  role="tab"
                  id={`admin-tab-${t.id}`}
                  aria-selected={isActive}
                  aria-controls={`admin-panel-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'relative flex items-center gap-2.5 rounded-xl px-3.5 h-11 text-sm font-medium',
                    'whitespace-nowrap cursor-pointer transition-colors md:w-full',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
                    isActive ? 'text-brand-400' : 'text-zinc-400 hover:text-zinc-100 hover:bg-surface-2/70'
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="admin-tab-indicator"
                      aria-hidden="true"
                      className="absolute inset-0 rounded-xl bg-brand-500/10 border border-brand-500/30"
                      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 36 }}
                    />
                  )}
                  <Icon className="h-4 w-4 shrink-0 relative" />
                  <span className="relative">{t.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="min-w-0 flex-1">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={tab}
                role="tabpanel"
                id={`admin-panel-${tab}`}
                aria-labelledby={`admin-tab-${tab}`}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 1 } : { opacity: 0, y: -6 }}
                transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
              >
                {tab === 'overview' && <OverviewTab />}
                {tab === 'users' && <UsersTab />}
                {tab === 'scanner' && <ScannerTab />}
                {tab === 'ai' && <AiUsageTab />}
                {tab === 'feedback' && <FeedbackTab />}
                {tab === 'support' && <SupportTab />}
                {tab === 'coupons' && <CouponsTab />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
