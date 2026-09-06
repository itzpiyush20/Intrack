// ============================================
// BalancesWidget — Available Money, Card Debts & Net Liquid Position
//
// Desktop command center overview for:
// 1. Available Money (cash in hand + bank accounts)
// 2. Individual card outstandings
// 3. Total card debt
// 4. Net liquid position (Available Money − Total Card Debt)
// 5. Quick link to Settings (Cards & Balances tab)
// ============================================

import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { Card, Button, Skeleton, SECTION_LABEL } from '@/components/ui'
import {
  getFinancialSummary,
  type FinancialBalanceSummary,
} from '@/services/balances'
import { formatCurrency } from '@/utils'
import {
  Wallet,
  CreditCard,
  Shield,
  Settings,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  Scale,
} from 'lucide-react'

interface BalancesWidgetProps {
  className?: string
  onRefreshNeeded?: () => void
}

export default function BalancesWidget({ className = '' }: BalancesWidgetProps) {
  const [summary, setSummary] = useState<FinancialBalanceSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const reduce = useReducedMotion()

  const loadSummary = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getFinancialSummary()
      setSummary(data)
    } catch (err) {
      console.error('Failed to load financial balance summary:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  if (loading) {
    return (
      <Card className={`border-sb-hairline bg-surface-1 shadow-card p-5 ${className}`}>
        <div role="status" aria-label="Loading balance summary" className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Skeleton shape="block" className="h-8 w-8 rounded-xl" />
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-8 w-28 rounded-xl" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3 pt-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl border border-sb-hairline bg-surface-2/40 p-4 space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            ))}
          </div>
        </div>
      </Card>
    )
  }

  if (!summary) return null

  const { availableMoney, cards, totalCardDebt, netLiquidWealth } = summary
  const isAvailableConfigured = availableMoney.isConfigured
  const hasCards = cards.length > 0
  const isNetPositive = netLiquidWealth >= 0

  return (
    <Card
      className={`relative overflow-hidden border-sb-hairline bg-surface-1 shadow-card rounded-2xl p-5 md:p-6 before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-brand-500/20 via-emerald-500/50 to-brand-500/20 ${className}`}
    >
      {/* Header with section title and quick adjust button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-700 shadow-xs"
          >
            <Scale className="h-4.5 w-4.5 text-brand-600" />
          </span>
          <div>
            <h2 className="text-base font-bold text-sb-ink tracking-tight">
              Balances & Net Liquid Position
            </h2>
            <p className="text-xs text-sb-ink-muted">
              Real-time cash, bank balances, and active credit card outstandings
            </p>
          </div>
        </div>

        <Link to="/settings?tab=cards" className="shrink-0 self-start sm:self-auto">
          <Button
            size="sm"
            variant="secondary"
            className="gap-1.5 shadow-xs text-xs font-semibold h-9 rounded-xl"
          >
            <Settings className="h-3.5 w-3.5 text-sb-ink-muted" />
            <span>Adjust Balances</span>
            <ArrowRight className="h-3.5 w-3.5 text-brand-600" />
          </Button>
        </Link>
      </div>

      {/* Top 3 Core Metrics Grid */}
      <div className="grid gap-3 sm:grid-cols-3">
        {/* 1. Available Money (Cash & Bank) */}
        <div className="rounded-xl border border-sb-hairline bg-surface-2/40 p-4 transition-all hover:bg-surface-2/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--status-positive-subtle)] text-[var(--status-positive-text)]"
              >
                <Wallet className="h-3.5 w-3.5" />
              </span>
              <span className={SECTION_LABEL}>Available Money</span>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-surface-1 border border-sb-hairline text-sb-ink-muted">
              Cash + Bank
            </span>
          </div>

          <p className="mt-3 text-2xl font-extrabold tracking-tight tnum text-sb-ink">
            {isAvailableConfigured ? formatCurrency(availableMoney.current) : 'Not configured'}
          </p>

          <p className="mt-1 text-xs text-sb-ink-muted truncate">
            {isAvailableConfigured ? (
              <>
                Opening <span className="tnum font-semibold text-sb-ink-secondary">{formatCurrency(availableMoney.opening)}</span>
                {availableMoney.netMovement !== 0 && (
                  <>
                    {' · '}
                    <span className={`tnum font-semibold ${availableMoney.netMovement > 0 ? 'text-[var(--status-positive-text)]' : 'text-sb-ink'}`}>
                      {availableMoney.netMovement > 0 ? '+' : ''}{formatCurrency(availableMoney.netMovement)}
                    </span>
                  </>
                )}
              </>
            ) : (
              <Link to="/settings?tab=cards" className="text-brand-600 hover:underline font-medium">
                Set opening balance →
              </Link>
            )}
          </p>
        </div>

        {/* 2. Total Card Debt */}
        <div className="rounded-xl border border-sb-hairline bg-surface-2/40 p-4 transition-all hover:bg-surface-2/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-sb-ink-secondary"
              >
                <CreditCard className="h-3.5 w-3.5" />
              </span>
              <span className={SECTION_LABEL}>Total Card Debt</span>
            </div>
            <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-surface-1 border border-sb-hairline text-sb-ink-muted">
              {cards.length} {cards.length === 1 ? 'Card' : 'Cards'}
            </span>
          </div>

          <p className="mt-3 text-2xl font-extrabold tracking-tight tnum text-sb-ink">
            {formatCurrency(totalCardDebt)}
          </p>

          <p className="mt-1 text-xs text-sb-ink-muted truncate">
            {hasCards ? (
              <span>Across all defined credit cards</span>
            ) : (
              <Link to="/settings?tab=cards" className="text-brand-600 hover:underline font-medium">
                Add credit cards →
              </Link>
            )}
          </p>
        </div>

        {/* 3. Net Liquid Position */}
        <div className="rounded-xl border border-sb-hairline bg-surface-2/40 p-4 transition-all hover:bg-surface-2/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  isNetPositive
                    ? 'bg-emerald-500/10 text-emerald-700'
                    : 'bg-amber-500/10 text-amber-700'
                }`}
              >
                <Shield className="h-3.5 w-3.5" />
              </span>
              <span className={SECTION_LABEL}>Net Liquid</span>
            </div>
            <span
              className={`text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full ${
                isNetPositive
                  ? 'bg-emerald-500/10 text-emerald-700 border border-emerald-200/50'
                  : 'bg-amber-500/10 text-amber-800 border border-amber-200/50'
              }`}
            >
              {isNetPositive ? 'Positive' : 'Deficit'}
            </span>
          </div>

          <p
            className={`mt-3 text-2xl font-extrabold tracking-tight tnum ${
              isNetPositive
                ? 'text-[var(--status-positive-text)]'
                : 'text-[var(--status-danger-text)]'
            }`}
          >
            {formatCurrency(netLiquidWealth)}
          </p>

          <p className="mt-1 text-xs text-sb-ink-muted truncate">
            Available money − total card debt
          </p>
        </div>
      </div>

      {/* Individual Card Outstandings Strip (if any cards configured) */}
      {hasCards && (
        <div className="mt-4 pt-4 border-t border-sb-hairline">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-bold uppercase tracking-wider text-sb-ink-muted">
              Card Outstandings
            </span>
            <span className="text-xs text-sb-ink-muted">
              Total {cards.length} active
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {cards.map((c) => (
              <motion.div
                key={c.card.id}
                initial={reduce ? false : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center justify-between gap-2.5 rounded-xl border border-sb-hairline bg-surface-1 p-3 shadow-xs hover:border-brand-500/20 transition-all"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-sb-ink truncate">{c.card.name}</p>
                  <p className="text-[11px] text-sb-ink-muted truncate tnum">
                    {[c.card.issuer, c.card.last4 && `•••• ${c.card.last4}`].filter(Boolean).join(' · ') || 'Active card'}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-extrabold text-sb-ink tnum">
                    {formatCurrency(c.currentOutstanding)}
                  </p>
                  {c.netMovement !== 0 && (
                    <p className="text-[10px] text-sb-ink-muted tnum flex items-center justify-end gap-0.5">
                      {c.netMovement > 0 ? (
                        <TrendingUp className="h-2.5 w-2.5 text-sb-ink-muted" />
                      ) : (
                        <TrendingDown className="h-2.5 w-2.5 text-[var(--status-positive-text)]" />
                      )}
                      <span>{c.netMovement > 0 ? '+' : ''}{formatCurrency(c.netMovement)} this mo</span>
                    </p>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
