// ============================================
// ExpensesPage — Full expense management
// Add, edit, delete transactions
// ============================================

import { APP_CONFIG } from '@/constants'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { AppLayout } from '@/layouts'
import { Button, Modal, DateFilterPicker } from '@/components/ui'
import ExpenseForm from '@/components/expenses/ExpenseForm'
import ExpenseList from '@/components/expenses/ExpenseList'
import { fetchAllTransactions } from '@/services/transactions'
import { formatCurrency, getCurrentMonth, withTimeout, resolveDateFilter, creditCardBillCategoryNames, makeIsCreditCardBill, type DateFilter } from '@/utils'
import type { Database } from '@/types/database'
import { Card } from '@/components/ui'
import { useToast } from '@/context'
import { useLocation } from 'react-router-dom'
import { useCategories } from '@/context/CategoriesContext'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

export default function ExpensesPage() {
  const location = useLocation()
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

  return (
    <AppLayout>
      <div className="space-y-6 animate-fade-in">
        <div className="flex flex-col gap-3">
          {/* Header row */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-white">Transactions</h1>
              <p className="mt-1 text-sm text-zinc-400">Manage your income and expenses</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap shrink-0">
              <DateFilterPicker value={dateFilter} onChange={setDateFilter} />
              <Button onClick={() => setShowForm(true)} className="whitespace-nowrap w-full sm:w-auto justify-center">
                + Add Transaction
              </Button>
            </div>
          </div>

          {/* Search + Filters row */}
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="search"
              placeholder="Search merchant, description, amount..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 h-11 bg-surface-2 border border-border-subtle/50 text-zinc-200 text-xs rounded-xl px-3 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-brand-400 transition-all"
              aria-label="Search transactions"
            />
            <div className="flex flex-wrap gap-2">
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="flex-1 min-w-[140px] h-11 bg-surface-2 border border-border-subtle/50 text-zinc-300 text-xs rounded-xl px-3 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer"
                aria-label="Filter by type"
              >
                <option value="all">All Types</option>
                <option value="credit">↗ Income</option>
                <option value="debit">↘ Expense</option>
              </select>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="flex-1 min-w-[140px] h-11 bg-surface-2 border border-border-subtle/50 text-zinc-300 text-xs rounded-xl px-3 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer"
                aria-label="Filter by category"
              >
                <option value="all">All Categories</option>
                {uniqueCategories.map((cat) => {
                  const meta = getStyle(cat)
                  return (
                    <option key={cat} value={cat}>
                      {`${meta.emoji} ${meta.label}`}
                    </option>
                  )
                })}
              </select>
              {(searchQuery || filterType !== 'all' || filterCategory !== 'all') && (
                <button
                  onClick={() => { setSearchQuery(''); setFilterType('all'); setFilterCategory('all') }}
                  className="shrink-0 h-11 px-3 rounded-xl border border-zinc-700 text-xs text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors cursor-pointer"
                  aria-label="Clear filters"
                >
                  ✕ Clear
                </button>
              )}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-2xl bg-[var(--status-danger-subtle)] border border-[var(--status-danger-border)] p-4 text-sm text-[var(--status-danger-text)]">
            {error}
            <button onClick={fetchTransactions} className="ml-3 text-xs underline hover:opacity-85">Retry</button>
          </div>
        )}

        {/* Quick stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="shadow-md">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Income</p>
            <p className="mt-1 text-xl font-semibold text-[var(--status-positive-text)]">{formatCurrency(totalIncome)}</p>
          </Card>
          <Card className="shadow-md">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Expenses</p>
            <p className="mt-1 text-xl font-semibold text-[var(--status-danger-text)]">{formatCurrency(totalExpenses)}</p>
          </Card>
          <Card className="shadow-md">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Net</p>
            <p className={`mt-1 text-xl font-semibold ${totalIncome - totalExpenses >= 0 ? 'text-[var(--status-positive-text)]' : 'text-[var(--status-danger-text)]'}`}>
              {formatCurrency(totalIncome - totalExpenses)}
            </p>
          </Card>
        </div>

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

        {/* Transaction list */}
        <div>
          <h2 className="text-lg font-medium text-white mb-3">
            Transactions
            {!loading && (
              <span className="ml-2 text-sm text-zinc-500">
                ({filteredTransactions.length}{filteredTransactions.length !== transactions.length ? ` of ${transactions.length}` : ''})
              </span>
            )}
          </h2>
          <ExpenseList
            transactions={filteredTransactions}
            loading={loading}
            onEdit={handleEdit}
            onRefresh={fetchTransactions}
          />
        </div>
      </div>
    </AppLayout>
  )
}
