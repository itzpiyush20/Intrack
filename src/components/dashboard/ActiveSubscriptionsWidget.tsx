// ============================================
// ActiveSubscriptionsWidget — recurring payments detected from history.
//
// Restyled 2026-09-06 (plans/ui-overhaul-2026-09-05.md); no behaviour change.
// The detection window, the detector and the "render nothing when nothing is
// detected" rule are all untouched. What changed: the header icon stopped
// spinning forever (motion has to report a change, and nothing here is
// changing), the amounts got tabular figures, the renewal chips say a word
// rather than relying on red/amber/green, and the tiles are a real list.
// ============================================

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Card, staggerParent, staggerChild } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useCategories } from '@/context/CategoriesContext'
import { formatCurrency } from '@/utils'
import { toISODateLocal } from '@/utils/dateFilter'
import { fetchAllTransactions } from '@/services/transactions'
import {
  detectSubscriptions,
  loadIgnoredSubscriptionKeys,
  SUBSCRIPTION_LOOKBACK_MONTHS,
  type DetectedSubscription,
} from '@/services/subscriptionDetection'
import { RefreshCw, ArrowRight } from 'lucide-react'

interface ActiveSubscriptionsWidgetProps {
  isVisible: boolean
}

/** How many tiles fit before the list stops being scannable. */
const PREVIEW_COUNT = 6

export default function ActiveSubscriptionsWidget({ isVisible }: ActiveSubscriptionsWidgetProps) {
  const { user } = useAuth()
  const { getStyle } = useCategories()
  const [subs, setSubs] = useState<DetectedSubscription[] | null>(null)
  const reduce = useReducedMotion()

  // This widget used to run detection over the Dashboard's five most recent
  // transactions, which is not enough data for the algorithm to work: two
  // charges from one merchant a month apart never appear in five rows, so
  // every merchant fell through to the category heuristic and a single
  // "Utilities & Bills" charge was rendered as an active subscription with an
  // invented 30-day renewal — and counted in "monthly burn". It now fetches
  // the same window the Subscriptions page uses, through the same detector.
  useEffect(() => {
    if (!user || !isVisible) return
    let cancelled = false

    const since = new Date()
    since.setMonth(since.getMonth() - SUBSCRIPTION_LOOKBACK_MONTHS)

    // Debits only — detection ignores credits anyway, and halving the row count
    // matters on a fetch that now runs on every Dashboard visit.
    fetchAllTransactions({ dateFrom: toISODateLocal(since), type: 'debit' })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) {
          setSubs([])
          return
        }
        setSubs(
          detectSubscriptions(data, { ignoredKeys: loadIgnoredSubscriptionKeys(user.id) })
        )
      })
      .catch((e) => {
        if (cancelled) return
        console.error('Failed to detect subscriptions:', e)
        setSubs([])
      })

    return () => {
      cancelled = true
    }
  }, [user, isVisible])

  if (!isVisible || subs === null || subs.length === 0) return null

  const monthlyBurn = subs.reduce((s, sub) => s + sub.amount, 0)
  const shown = subs.slice(0, PREVIEW_COUNT)

  return (
    <Card id="subscription-widget">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-brand-700"
            >
              <RefreshCw className="h-4.5 w-4.5" />
            </span>
            <h2 className="text-base font-bold text-zinc-100">
              Recurring payments
              <span className="ml-2 align-middle text-xs font-medium text-zinc-400">
                found in your history
              </span>
            </h2>
          </div>
          <p className="mt-2 text-sm text-zinc-400">
            About <span className="font-semibold tnum text-zinc-100">{formatCurrency(monthlyBurn)}</span>{' '}
            leaves your accounts every month across{' '}
            <span className="tnum">{subs.length}</span> service{subs.length === 1 ? '' : 's'}.
          </p>
        </div>
        <Link
          to="/subscriptions"
          className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-brand-700 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
        >
          Manage
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      </div>

      <motion.ul
        variants={staggerParent(reduce, shown.length)}
        initial="initial"
        animate="animate"
        className="mt-5 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {shown.map((sub) => {
          const due = sub.daysToRenewal
          // Urgency is carried by the wording first; the colour only agrees
          // with it. "Due!" alone in red told a colour-blind reader nothing a
          // green "18d" did not.
          const tone =
            due <= 3
              ? 'text-[var(--status-danger-text)] bg-[var(--status-danger-subtle)] border-[var(--status-danger-border)]'
              : due <= 7
              ? 'text-[var(--status-warning-text)] bg-[var(--status-warning-subtle)] border-[var(--status-warning-border)]'
              : 'text-zinc-300 bg-surface-2 border-border-subtle/60'
          const dueLabel =
            due <= 0 ? 'Due now' : due === 1 ? 'Tomorrow' : `${due} days`
          const cat = getStyle(sub.category)

          return (
            <motion.li
              key={sub.merchant}
              variants={staggerChild(reduce)}
              className="flex items-center gap-3 rounded-xl border border-border-subtle/50 bg-surface-2/50 px-3.5 py-3 transition-colors hover:border-border-hover"
            >
              <span aria-hidden="true" className="shrink-0 text-xl">{cat.emoji}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-100" title={sub.merchant}>
                  {sub.merchant}
                </p>
                <p className="mt-0.5 text-xs tnum text-zinc-400">
                  {formatCurrency(sub.amount)} a month
                </p>
              </div>
              <span
                className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold tnum ${tone}`}
              >
                {dueLabel}
                <span className="sr-only"> until the next charge</span>
              </span>
            </motion.li>
          )
        })}
      </motion.ul>

      {subs.length > PREVIEW_COUNT && (
        <p className="mt-4 text-center text-sm text-zinc-400">
          <span className="tnum">{subs.length - PREVIEW_COUNT}</span> more —{' '}
          <Link
            to="/subscriptions"
            className="rounded font-semibold text-brand-700 underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
          >
            see every subscription
          </Link>
        </p>
      )}
    </Card>
  )
}
