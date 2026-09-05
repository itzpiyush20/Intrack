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
import { fetchAllTransactions } from '@/services/transactions'
import { cn, formatCurrency, getCurrentMonth, withTimeout, resolveDateFilter, creditCardBillCategoryNames, makeIsCreditCardBill, type DateFilter } from '@/utils'
import type { Database } from '@/types/database'
import { useToast } from '@/context'
import { useLocation } from 'react-router-dom'
import { useCategories } from '@/context/CategoriesContext'
import { Search, Plus, X, AlertTriangle, ArrowDown, ArrowUp, Scale } from 'lucide-react'

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
  const [dateFilter, setDateFilter] = useState<DateFilter>({ mode: 'month', month: getCurrentMonth() })
  const { showToast } = useToast()
  const [error, setError] = useState<string | null>(null)

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all')
  const [filterCategory, setFilterCategory] = useState('all')

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
    return matchSearch && matchType && matchCat
  })

  const uniqueCategories = [...new Set(transactions.map((t) => t.category).filter(Boolean))]

  const net = totalIncome - totalExpenses
  const inSurplus = net >= 0
  const isFiltered = !!searchQuery || filterType !== 'all' || filterCategory !== 'all'

  // The three figures that describe the fetched range. Kept as data so the
  // markup below is one loop rather than three near-identical cards that drift
  // apart the first time one of them is edited.
  const totals = [
    {
      key: 'income',
      label: 'Money in',
      value: totalIncome,
      icon: ArrowUp,
      tone: 'text-[var(--status-positive-text)]',
      note: 'Everything credited in this range',
    },
    {
      key: 'expenses',
      label: 'Money out',
      value: totalExpenses,
      icon: ArrowDown,
      tone: 'text-zinc-50',
      // Say why the figure may be smaller than the rows add up to, rather than
      // letting the user find the discrepancy and distrust the page.
      note: 'Card bill payments left out — their purchases already count',
    },
    {
      key: 'net',
      label: inSurplus ? 'Left over' : 'Short by',
      value: Math.abs(net),
      icon: Scale,
      tone: inSurplus ? 'text-[var(--status-positive-text)]' : 'text-[var(--status-danger-text)]',
      note: inSurplus ? 'In came to more than out' : 'Out came to more than in',
    },
  ] as const

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight text-zinc-50 md:text-3xl">Transactions</h1>
            <p className="mt-1 text-sm text-zinc-400">
              Every rupee in and out, for the range you pick. Edit anything that landed under the
              wrong name or category.
            </p>
          </div>

          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center md:shrink-0">
            <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
            <Button
              onClick={() => setShowForm(true)}
              className="h-11 justify-center gap-1.5 whitespace-nowrap"
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> Add transaction
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

        {/* What the range came to. Above the filters because these describe the
            whole range, not the search below them. */}
        <motion.div
          className="grid gap-3 sm:grid-cols-3"
          variants={staggerParent(reduceMotion, 3)}
          initial="initial"
          animate="animate"
        >
          {totals.map(({ key, label, value, icon: Icon, tone, note }) => (
            <motion.div key={key} variants={staggerChild(reduceMotion)}>
              <Card className="h-full p-4 sm:p-5">
                <p className={SECTION_LABEL}>{label}</p>
                {/* Icon plus a named label, so none of the three figures depends
                    on its colour to be understood. */}
                <p className={cn('mt-2 flex items-center gap-1.5 text-2xl font-semibold tracking-tight tnum', tone)}>
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {formatCurrency(value)}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-zinc-400">{note}</p>
              </Card>
            </motion.div>
          ))}
        </motion.div>

        {/* Search and filters. Their own card so it is obvious they act on the
            list beneath and not on the totals above. */}
        <Card className="p-3 sm:p-4">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            {/* Input renders its own wrapper and puts className on the <input>,
                so the flex sizing has to live out here. */}
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

              {isFiltered && (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setFilterType('all'); setFilterCategory('all') }}
                  className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border-default px-3 text-sm font-medium text-zinc-400 transition-colors hover:border-border-hover hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40"
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
          title={editingTransaction ? 'Edit transaction' : 'Add transaction'}
          sheet
        >
          <ExpenseForm
            editingTransaction={editingTransaction}
            onSaved={handleSaved}
            onCancel={handleCancel}
          />
        </Modal>

        {/* The list */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="text-base font-semibold tracking-tight text-zinc-50">
              {isFiltered ? 'Matching transactions' : 'All transactions'}
            </h2>
            {!loading && (
              <p className="tnum text-xs text-zinc-400">
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
            onRefresh={fetchTransactions}
            isFiltered={isFiltered}
            emptyAction={
              <Button onClick={() => setShowForm(true)} className="h-11 justify-center gap-1.5">
                <Plus className="h-4 w-4 shrink-0" aria-hidden="true" /> Add transaction
              </Button>
            }
          />
        </section>
      </div>
    </AppLayout>
  )
}
