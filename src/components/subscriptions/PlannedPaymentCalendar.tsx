// ============================================
// PlannedPaymentCalendar — 30-Day Timeline & Calendar View
// Visualizes upcoming bills, rent, EMIs, and subscriptions
// along with respective payment cards and bank accounts.
// ============================================

import { useState, useMemo, useRef } from 'react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  CalendarDays,
  CreditCard,
  Building2,
  Zap,
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  RotateCcw,
} from 'lucide-react'
import { Card, Badge, Button } from '@/components/ui'
import { formatCurrency, formatDate } from '@/utils'
import { useCategories } from '@/context/CategoriesContext'
import type { PlannedPayment, UpcomingBillsSummary, TimelineDay } from '@/services/plannedPayments'
import { calculateUpcomingBillsForNext30Days } from '@/services/plannedPayments'

interface PlannedPaymentCalendarProps {
  payments: PlannedPayment[]
  className?: string
}

export default function PlannedPaymentCalendar({
  payments,
  className = '',
}: PlannedPaymentCalendarProps) {
  const { getStyle } = useCategories()
  const reduce = useReducedMotion()

  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const timelineScrollRef = useRef<HTMLDivElement>(null)

  const summary: UpcomingBillsSummary = useMemo(() => {
    return calculateUpcomingBillsForNext30Days(payments)
  }, [payments])

  const {
    bills,
    totalUpcomingAmount,
    dueIn7DaysAmount,
    dueIn7DaysCount,
    overdueCount,
    overdueAmount,
    timeline,
  } = summary

  // Filter bills to display: either for the single selected day, or all 30 days
  const displayedBills = useMemo(() => {
    if (!selectedDate) return bills
    return bills.filter((b) => b.next_due_date === selectedDate)
  }, [bills, selectedDate])

  const scrollTimeline = (direction: 'left' | 'right') => {
    if (!timelineScrollRef.current) return
    const scrollAmount = direction === 'left' ? -280 : 280
    timelineScrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' })
  }

  // Account icon renderer
  const renderAccountIcon = (accountStr: string | null) => {
    if (!accountStr) return <CreditCard className="h-3.5 w-3.5 text-sb-ink-muted" />
    const lower = accountStr.toLowerCase()
    if (lower.includes('upi')) return <Zap className="h-3.5 w-3.5 text-amber-500" />
    if (lower.includes('nach') || lower.includes('net banking') || lower.includes('bank')) {
      return <Building2 className="h-3.5 w-3.5 text-blue-500" />
    }
    return <CreditCard className="h-3.5 w-3.5 text-brand-500" />
  }

  return (
    <Card className={`relative overflow-hidden bg-surface-1 border-sb-hairline p-5 shadow-card rounded-2xl ${className}`}>
      {/* Top Banner: Metrics & Controls */}
      <div className="flex flex-col gap-4 border-b border-sb-hairline pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-brand-500/20 bg-brand-500/10 text-brand-600 shadow-xs">
            <CalendarDays className="h-6 w-6" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight text-sb-ink sm:text-lg">
                30-Day Planned Payments Timeline
              </h2>
              <span className="inline-flex items-center rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-sb-ink-muted border border-sb-hairline">
                {bills.length} upcoming
              </span>
            </div>
            <p className="text-xs text-sb-ink-muted mt-0.5">
              Scheduled bills, rent, EMIs, and renewals with linked accounts
            </p>
          </div>
        </div>

        {/* Aggregate KPI Summary Badges */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex flex-col rounded-xl border border-sb-hairline bg-surface-2/60 px-3.5 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-sb-ink-muted">
              Next 30 Days Outflow
            </span>
            <span className="text-base font-extrabold text-sb-ink tnum">
              {formatCurrency(totalUpcomingAmount)}
            </span>
          </div>

          <div className="flex flex-col rounded-xl border border-amber-200/70 bg-amber-50/70 px-3.5 py-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-amber-900">
              Due in 7 Days ({dueIn7DaysCount})
            </span>
            <span className="text-base font-bold text-amber-950 tnum">
              {formatCurrency(dueIn7DaysAmount)}
            </span>
          </div>

          {overdueCount > 0 && (
            <div className="flex flex-col rounded-xl border border-rose-200/70 bg-rose-50/70 px-3.5 py-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-rose-900 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> Overdue ({overdueCount})
              </span>
              <span className="text-base font-bold text-rose-950 tnum">
                {formatCurrency(overdueAmount)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 30-Day Calendar Strip */}
      <div className="relative mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-sb-ink-muted">
            {selectedDate ? (
              <span className="flex items-center gap-2">
                <span>Showing day: <strong className="text-sb-ink">{formatDate(selectedDate)}</strong></span>
                <button
                  type="button"
                  onClick={() => setSelectedDate(null)}
                  className="cursor-pointer text-xs font-semibold text-brand-600 hover:text-brand-700 underline underline-offset-2 flex items-center gap-1"
                >
                  <RotateCcw className="h-3 w-3" /> Show all 30 days
                </button>
              </span>
            ) : (
              <span>Click a day to filter bills</span>
            )}
          </span>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => scrollTimeline('left')}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-sb-hairline bg-surface-2 text-sb-ink hover:bg-surface-3 transition-colors"
              aria-label="Scroll left"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => scrollTimeline('right')}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-sb-hairline bg-surface-2 text-sb-ink hover:bg-surface-3 transition-colors"
              aria-label="Scroll right"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable horizontal strip */}
        <div
          ref={timelineScrollRef}
          className="flex gap-2 overflow-x-auto pb-3 pt-1 scrollbar-none no-scrollbar snap-x select-none"
          tabIndex={0}
          aria-label="30 day payment schedule timeline"
        >
          {timeline.map((day: TimelineDay) => {
            const hasBills = day.bills.length > 0
            const isSelected = selectedDate === day.date

            return (
              <button
                key={day.date}
                type="button"
                onClick={() => {
                  setSelectedDate(isSelected ? null : day.date)
                }}
                className={`flex w-[4.6rem] shrink-0 snap-start flex-col items-center rounded-xl p-2 transition-all cursor-pointer border ${
                  isSelected
                    ? 'border-brand-500 bg-brand-500/10 shadow-sm ring-2 ring-brand-500/30'
                    : day.isToday
                    ? 'border-brand-400/80 bg-brand-50/50'
                    : hasBills
                    ? 'border-sb-hairline bg-surface-2/80 hover:border-brand-500/40 hover:bg-surface-2'
                    : 'border-transparent bg-surface-2/30 hover:bg-surface-2/60 opacity-70 hover:opacity-100'
                }`}
              >
                <span className="text-[10px] font-bold uppercase tracking-wider text-sb-ink-muted">
                  {day.dayOfWeek}
                </span>
                <span
                  className={`mt-0.5 text-base font-extrabold tnum ${
                    day.isToday ? 'text-brand-600' : isSelected ? 'text-brand-700' : 'text-sb-ink'
                  }`}
                >
                  {day.dayOfMonth}
                </span>

                {day.isToday && (
                  <span className="mt-0.5 rounded px-1 text-[9px] font-bold uppercase tracking-tight bg-brand-500 text-white">
                    Today
                  </span>
                )}

                {hasBills ? (
                  <div className="mt-1.5 flex flex-col items-center">
                    <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white shadow-2xs">
                      {day.bills.length}
                    </span>
                    <span className="mt-1 text-[10px] font-semibold text-sb-ink tnum truncate max-w-[4.2rem]">
                      {formatCurrency(day.totalAmount)}
                    </span>
                  </div>
                ) : (
                  <span className="mt-2.5 h-1.5 w-1.5 rounded-full bg-sb-hairline" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Bills Cards Grid / List for the Timeline */}
      <div className="mt-5 border-t border-sb-hairline pt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
            {selectedDate
              ? `Scheduled Payments on ${formatDate(selectedDate)}`
              : 'Chronological Payment Stream'}
          </h3>
          <span className="text-xs font-medium text-sb-ink-muted">
            {displayedBills.length} item{displayedBills.length === 1 ? '' : 's'}
          </span>
        </div>

        {displayedBills.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-sb-hairline py-8 text-center bg-surface-2/40">
            <CheckCircle2 className="h-8 w-8 text-brand-600 mb-2" />
            <p className="text-sm font-semibold text-sb-ink">No planned payments due</p>
            <p className="text-xs text-sb-ink-muted mt-1 max-w-sm">
              {selectedDate
                ? `No commitments are scheduled for ${formatDate(selectedDate)}.`
                : 'No recurring bills or subscriptions detected within this 30-day window.'}
            </p>
            {selectedDate && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3 text-xs"
                onClick={() => setSelectedDate(null)}
              >
                View all upcoming bills
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence initial={false}>
              {displayedBills.map((bill) => {
                const categoryMeta = getStyle(bill.category)

                let badgeVariant: 'default' | 'success' | 'warning' | 'danger' = 'default'
                let dueLabel = `In ${bill.days_until_due} days`

                if (bill.days_until_due < 0) {
                  badgeVariant = 'danger'
                  dueLabel = `${Math.abs(bill.days_until_due)}d overdue`
                } else if (bill.days_until_due === 0) {
                  badgeVariant = 'danger'
                  dueLabel = 'Due today'
                } else if (bill.days_until_due === 1) {
                  badgeVariant = 'warning'
                  dueLabel = 'Due tomorrow'
                } else if (bill.days_until_due <= 3) {
                  badgeVariant = 'warning'
                  dueLabel = `Due in ${bill.days_until_due} days`
                } else if (bill.days_until_due <= 7) {
                  badgeVariant = 'default'
                  dueLabel = `In ${bill.days_until_due} days`
                } else {
                  badgeVariant = 'default'
                }

                const cadenceLabel =
                  bill.cadence === 'monthly'
                    ? 'Monthly'
                    : bill.cadence === 'quarterly'
                    ? 'Quarterly'
                    : bill.cadence === 'annual'
                    ? 'Annual'
                    : bill.cadence === 'weekly'
                    ? 'Weekly'
                    : 'Recurring'

                return (
                  <motion.div
                    key={`${bill.id}-${bill.next_due_date}`}
                    layout={!reduce}
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className="flex flex-col justify-between rounded-xl border border-sb-hairline bg-surface-1 p-3.5 shadow-xs hover:border-brand-500/30 hover:shadow-card transition-all"
                  >
                    <div>
                      {/* Card Header: Category & Due Badge */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            aria-hidden="true"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-sb-hairline bg-surface-2 text-sm"
                          >
                            {categoryMeta.emoji}
                          </span>
                          <span className="text-xs font-semibold text-sb-ink-muted truncate max-w-[7.5rem]">
                            {categoryMeta.label}
                          </span>
                        </div>
                        <Badge variant={badgeVariant} className="text-[11px] px-2 py-0.5">
                          {dueLabel}
                        </Badge>
                      </div>

                      {/* Title & Amount */}
                      <div className="mt-3">
                        <h4 className="text-sm font-bold text-sb-ink truncate capitalize" title={bill.title}>
                          {bill.title}
                        </h4>
                        <div className="mt-1 flex items-baseline gap-1.5">
                          <span className="text-lg font-extrabold text-sb-ink tnum">
                            {formatCurrency(bill.amount)}
                          </span>
                          <span className="text-xs text-sb-ink-muted lowercase font-medium">
                            /{cadenceLabel.toLowerCase()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Footer: Due date & Account Info */}
                    <div className="mt-3.5 pt-2.5 border-t border-sb-hairline flex items-center justify-between text-xs text-sb-ink-muted">
                      <span className="flex items-center gap-1 font-medium tnum">
                        <Clock className="h-3 w-3" />
                        {formatDate(bill.next_due_date)}
                      </span>

                      <div
                        className="flex items-center gap-1 font-medium truncate max-w-[10rem] text-sb-ink-secondary"
                        title={bill.card_or_account || 'Default payment method'}
                      >
                        {renderAccountIcon(bill.card_or_account)}
                        <span className="truncate">
                          {bill.card_or_account || 'Primary account'}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </Card>
  )
}
