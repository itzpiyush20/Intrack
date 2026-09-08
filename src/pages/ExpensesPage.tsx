// ============================================
// ExpensesPage — the ledger and its controls
//
// Restyle and recompose only: the fetch, the date filter, the client-side
// search and both totals are untouched. What changed is the reading order.
//
// The page now goes: what range am I looking at → what did it come to →
// narrow it down → the rows themselves. The three totals moved above the
// filter bar because they describe the fetched range, not the search, and
// standing them next to the search box implied otherwise.
//
// One domain note that governs the copy here: the Expenses total excludes
// credit-card *bill payments*, because the purchases they settle were already
// counted when they happened. A Credit Card Withdrawal is a cash advance, not
// a bill payment — it stays in this total, and nothing on this page calls it
// one.
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { AppLayout } from '@/layouts'
import {
  Card, Button, Modal, Input, Select, DateFilterPicker,
  SECTION_LABEL, staggerParent, staggerChild,
} from '@/components/ui'
import { motion, useReducedMotion } from 'framer-motion'
import ExpenseForm from '@/components/expenses/ExpenseForm'
import ExpenseList from '@/components/expenses/ExpenseList'
import SplitBillModal from '@/components/expenses/SplitBillModal'
import { fetchAllTransactions } from '@/services/transactions'
import { cn, formatCurrency, getCurrentMonth, withTimeout, resolveDateFilter, creditCardBillCategoryNames, makeIsCreditCardBill, type DateFilter } from '@/utils'
import type { Database } from '@/types/database'
import { useToast } from '@/context'
import { useLocation } from 'react-router-dom'
import { useCategories } from '@/context/CategoriesContext'
import { Search, Plus, X, AlertTriangle, ArrowDown, ArrowUp, Scale, FileSpreadsheet } from 'lucide-react'
import StatementImportModal from '@/components/importer/StatementImportModal'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

export default function ExpensesPage() {
  const location = useLocation()
  const reduceMotion = useReducedMotion()
  const { getStyle, categories, loading: categoriesLoading } = useCategories()
  // See DashboardPage: undefined-while-loading, so a not-yet-populated category
  // list falls back to the legacy name rather than excluding nothing.
  const isCreditCardBill = useMemo(
    () => makeIsCreditCardBill(categoriesLoading ? undefined : creditCardBillCategoryNames(categories)),
    [categories, categoriesLoading]
  )
  const [transactions, setTransactions] = useState<TransactionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(() => !!(location.state as any)?.openForm)
  const [editingTransaction, setEditingTransaction] = useState<TransactionRow | null>(null)
  const [splittingTransaction, setSplittingTransaction] = useState<TransactionRow | null>(null)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false)
  const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: 'month', month: getCurrentMonth() })
  const { showToast } = useToast()
  const [error, setError] = useState<string | null>(null)

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterTag, setFilterTag] = useState<string>(
    () => (location.state as any)?.tag || 'all'
  )

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Pages through every row rather than taking PostgREST's default 1000-row
      // ceiling: this list drives the quick-stats totals below, and a silently
      // truncated fetch would under-report income and expenses for any user
      // whose selected range holds more than a thousand transactions.
      const { data } = await withTimeout(
        fetchAllTransactions(resolveDateFilter(dateFilter)),
        45000,
        'Transactions fetch'
      )
      setTransactions(data || [])
    } catch (err: any) {
      console.error('Error fetching transactions:', err)
      setError(err.message || 'Failed to load transactions.')
    } finally {
      setLoading(false)
    }
  }, [dateFilter])

  useEffect(() => {
    document.title = `Transactions | ${APP_CONFIG.APP_NAME}`
    fetchTransactions()
  }, [fetchTransactions])

  useEffect(() => {
    const handleTxAdded = () => fetchTransactions()
    window.addEventListener('intrack:transaction-added', handleTxAdded)
    return () => window.removeEventListener('intrack:transaction-added', handleTxAdded)
  }, [fetchTransactions])

  useEffect(() => {
    if ((location.state as any)?.tag) {
      setFilterTag((location.state as any).tag)
    }
    if ((location.state as any)?.openForm) {
      setShowForm(true)
      // Clear navigation state
      window.history.replaceState({}, document.title)
    }
  }, [location.state])

  const handleEdit = (txn: TransactionRow) => {
    setEditingTransaction(txn)
    setShowForm(true)
  }

  const handleSaved = () => {
    if (editingTransaction) {
      showToast('Transaction edited successfully')
    } else {
      showToast('Transaction added successfully')
    }
    setShowForm(false)
    setEditingTransaction(null)
    fetchTransactions()
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingTransaction(null)
  }

  // Quick stats (from ALL transactions, not filtered) — credit card bill
  // payments are excluded from totalExpenses to avoid double-booking spend
  // already counted when the underlying purchases happened.
  const totalIncome = transactions
    .filter((t) => t.type === 'credit')
    .reduce((sum, t) => sum + Number(t.amount), 0)
  const totalExpenses = transactions
    .filter((t) => t.type === 'debit' && !isCreditCardBill(t.category))
    .reduce((sum, t) => sum + Number(t.amount), 0)

  // Client-side search + filter
  const filteredTransactions = transactions.filter((t) => {
    const q = searchQuery.toLowerCase()
    const matchSearch = !q ||
      t.merchant?.toLowerCase().includes(q) ||
      t.description?.toLowerCase().includes(q) ||
      String(t.amount).includes(q) ||
      t.category?.toLowerCase().includes(q) ||
      (t.tags && t.tags.some((tag) => tag.toLowerCase().includes(q)))
    const matchType = filterType === 'all' || t.type === filterType
    const matchCat = filterCategory === 'all' || t.category === filterCategory
    const matchTag = filterTag === 'all' || (t.tags && t.tags.includes(filterTag))
    return matchSearch && matchType && matchCat && matchTag
  })

  const uniqueCategories = [...new Set(transactions.map((t) => t.category).filter(Boolean))]

  const uniqueTags = useMemo(() => {
    const set = new Set<string>()
    transactions.forEach((t) => {
      t.tags?.forEach((tag) => {
        const trimmed = (tag || '').trim()
        if (trimmed) set.add(trimmed)
      })
    })
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [transactions])

  const net = totalIncome - totalExpenses
  const inSurplus = net >= 0
  const isFiltered = !!searchQuery || filterType !== 'all' || filterCategory !== 'all' || filterTag !== 'all'

  // The three figures that describe the fetched range. Kept as data so the
  // markup below is one loop rather than three near-identical cards that drift
  const totals = [
    {
      key: 'income',
      label: 'Money in',
      value: totalIncome,
      icon: ArrowUp,
      tone: 'text-[var(--status-positive-text)]',
      accent: 'before:via-emerald-500',
      pill: 'bg-emerald-500/10 text-emerald-700',
      pillLabel: 'Inflow',
      note: 'Everything credited in this range',
    },
    {
      key: 'expenses',
      label: 'Money out',
      value: totalExpenses,
      icon: ArrowDown,
      tone: 'text-sb-ink',
      accent: 'before:via-brand-500/40',
      pill: 'bg-surface-2 text-sb-ink-muted',
      pillLabel: 'Outflow',
      note: 'Card bill payments left out — their purchases already count',
    },
    {
      key: 'net',
      label: inSurplus ? 'Left over' : 'Short by',
      value: Math.abs(net),
      icon: Scale,
      tone: inSurplus ? 'text-[var(--status-positive-text)]' : 'text-[var(--status-danger-text)]',
      accent: 'before:via-brand-500',
      pill: inSurplus ? 'bg-brand-500/10 text-brand-700' : 'bg-red-500/10 text-red-700',
      pillLabel: inSurplus ? 'Surplus' : 'Deficit',
      note: inSurplus ? 'In came to more than out' : 'Out came to more than in',
    },
  ] as const

  return (
    <AppLayout>
      {/* Ambient luxury emerald backlight */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/3 -translate-x-1/2 h-72 w-[40rem] rounded-full bg-radial from-brand-500/12 via-brand-500/4 to-transparent blur-3xl"
      />

      <div className="relative z-10 space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-sb-ink md:text-3xl">Transactions</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
              <p className="text-sm font-medium text-sb-ink-secondary">
                Every rupee in and out, for the range you pick.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center md:shrink-0">
            <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
            <Button
              variant="secondary"
              onClick={() => setIsImportModalOpen(true)}
              className="h-11 justify-center gap-1.5 whitespace-nowrap font-semibold shadow-xs"
            >
              <FileSpreadsheet className="h-4 w-4 text-brand-600 shrink-0" aria-hidden="true" /> Import Statement
            </Button>
            <Button
              onClick={() => setShowForm(true)}
              className="h-11 justify-center gap-1.5 whitespace-nowrap font-semibold shadow-xs"
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> Add Transaction
            </Button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-2xl border border-[var(--status-danger-border)] bg-[var(--status-danger-subtle)] p-4 sm:flex-row sm:items-center"
          >
            <p className="flex flex-1 items-start gap-2 text-sm text-[var(--status-danger-text)]">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </p>
            <Button
              variant="secondary"
              onClick={fetchTransactions}
              className="h-11 shrink-0 justify-center"
            >
              Try again
            </Button>
          </div>
        )}

        {/* What the range came to */}
        <motion.div
          className="grid gap-3 sm:grid-cols-3"
          variants={staggerParent(reduceMotion, 3)}
          initial="initial"
          animate="animate"
        >
          {totals.map(({ key, label, value, icon: Icon, tone, accent, pill, pillLabel, note }) => (
            <motion.div key={key} variants={staggerChild(reduceMotion)}>
              <Card className={cn(
                'relative overflow-hidden h-full p-4 sm:p-5 border-sb-hairline bg-surface-1 shadow-card group hover:shadow-card-hover transition-all duration-300',
                'before:absolute before:inset-x-0 before:top-0 before:h-1 before:bg-gradient-to-r before:from-transparent before:to-transparent',
                accent
              )}>
                <div className="flex items-center justify-between">
                  <p className={SECTION_LABEL}>{label}</p>
                  <span className={cn('text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full', pill)}>
                    {pillLabel}
                  </span>
                </div>
                <p className={cn('mt-3 flex items-center gap-1.5 text-2xl sm:text-3xl font-extrabold tracking-tight tnum', tone)}>
                  <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                  {formatCurrency(value)}
                </p>
                <p className="mt-2 text-xs font-medium leading-relaxed text-sb-ink-muted">{note}</p>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        {/* Search and filters */}
        <Card className="p-3 sm:p-4 border-sb-hairline bg-surface-1 shadow-card">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <label htmlFor="txn-search" className="sr-only">Search transactions</label>
              <Input
                id="txn-search"
                type="search"
                placeholder="Search a merchant, note, amount or tag"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="h-4 w-4" aria-hidden="true" />}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row lg:shrink-0">
              <div className="min-w-0 sm:w-40">
                <label htmlFor="txn-type" className="sr-only">Filter by direction</label>
                <Select
                  id="txn-type"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value as any)}
                >
                  <option value="all">In and out</option>
                  <option value="credit">Money in only</option>
                  <option value="debit">Money out only</option>
                </Select>
              </div>

              <div className="min-w-0 sm:w-48">
                <label htmlFor="txn-category" className="sr-only">Filter by category</label>
                <Select
                  id="txn-category"
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                >
                  <option value="all">All categories</option>
                  {uniqueCategories.map((cat) => {
                    const meta = getStyle(cat)
                    return (
                      <option key={cat} value={cat}>
                        {`${meta.emoji} ${meta.label}`}
                      </option>
                    )
                  })}
                </Select>
              </div>

              <div className="min-w-0 sm:w-48">
                <label htmlFor="txn-tag" className="sr-only">Filter by tag / event</label>
                <Select
                  id="txn-tag"
                  value={filterTag}
                  onChange={(e) => setFilterTag(e.target.value)}
                >
                  <option value="all">All tags / events</option>
                  {uniqueTags.map((tag) => (
                    <option key={tag} value={tag}>
                      #{tag}
                    </option>
                  ))}
                </Select>
              </div>

              {isFiltered && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setFilterType('all')
                    setFilterCategory('all')
                    setFilterTag('all')
                  }}
                  className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-sb-hairline bg-surface-1 px-3 text-sm font-semibold text-sb-ink-muted transition-colors hover:border-brand-500/30 hover:text-sb-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
                >
                  <X className="h-4 w-4 shrink-0" aria-hidden="true" /> Clear
                </button>
              )}
            </div>
          </div>
        </Card>

        {/* Add/Edit Transaction Modal */}
        <Modal
          isOpen={showForm}
          onClose={handleCancel}
          title={editingTransaction ? 'Edit Transaction' : 'Add Transaction'}
          sheet
        >
          <ExpenseForm
            editingTransaction={editingTransaction}
            onSaved={handleSaved}
            onCancel={handleCancel}
          />
        </Modal>

        {/* Import Statement Modal */}
        <StatementImportModal
          isOpen={isImportModalOpen}
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={() => {
            fetchTransactions()
          }}
        />

        {/* Split Bill Modal */}
        <SplitBillModal
          isOpen={splittingTransaction !== null}
          onClose={() => setSplittingTransaction(null)}
          transaction={splittingTransaction}
          onSplitComplete={() => {
            fetchTransactions()
          }}
        />

        {/* The list */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-base font-bold tracking-tight text-sb-ink">
              {isFiltered ? 'Matching transactions' : 'All transactions'}
            </h2>
            {!loading && (
              <p className="tnum text-xs font-semibold text-sb-ink-muted bg-surface-2/60 border border-sb-hairline px-2.5 py-0.5 rounded-full">
                {filteredTransactions.length !== transactions.length
                  ? `${filteredTransactions.length} of ${transactions.length}`
                  : `${transactions.length} ${transactions.length === 1 ? 'transaction' : 'transactions'}`}
              </p>
            )}
          </div>

          <ExpenseList
            transactions={filteredTransactions}
            loading={loading}
            onEdit={handleEdit}
            onSplit={(txn) => setSplittingTransaction(txn)}
            onRefresh={fetchTransactions}
            isFiltered={isFiltered}
            emptyAction={
              <Button onClick={() => setShowForm(true)} className="h-11 justify-center gap-1.5 font-semibold shadow-xs">
                <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> Add Transaction
              </Button>
            }
          />
        </section>
      </div>
    </AppLayout>
  )
}
