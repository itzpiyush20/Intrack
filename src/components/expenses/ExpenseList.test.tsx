// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ExpenseList from './ExpenseList'
import { ToastProvider } from '@/context/ToastContext'
import type { Database } from '@/types/database'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [{ name: 'Travel', emoji: '✈️' }],
    getStyle: (cat: string) => ({ emoji: '💳', label: cat, color: '#000000' }),
  }),
}))

const deleteTransaction = vi.fn()
const bulkDeleteTransactions = vi.fn()
const bulkUpdateTransactionsCategory = vi.fn()
vi.mock('@/services/transactions', () => ({
  deleteTransaction: (id: string) => deleteTransaction(id),
  bulkDeleteTransactions: (ids: string[]) => bulkDeleteTransactions(ids),
  bulkUpdateTransactionsCategory: (ids: string[], category: string) =>
    bulkUpdateTransactionsCategory(ids, category),
}))

const row = (id: string, merchant: string) => ({
  id, merchant, amount: 100, type: 'debit', category: 'Food', date: '2026-09-15',
  description: null, tags: null,
}) as unknown as TransactionRow
const rows = [row('t1', 'Swiggy'), row('t2', 'Uber'), row('t3', 'Amazon')]

function renderList(props: Partial<Parameters<typeof ExpenseList>[0]> = {}) {
  return render(
    <ToastProvider>
      <ExpenseList transactions={rows} loading={false} onEdit={() => {}} onRefresh={() => {}} {...props} />
    </ToastProvider>,
  )
}

describe('ExpenseList motion', () => {
  afterEach(() => {
    cleanup()
    deleteTransaction.mockReset()
  })

  it('tints only the row just added', () => {
    renderList({ highlight: { id: 't2', key: 1 } })
    const tints = screen.getAllByTestId('row-new-tint')
    expect(tints).toHaveLength(1)
    expect(within(tints[0].closest('li')!).getByLabelText('Select Uber')).toBeTruthy()
  })

  it('tints nothing without a highlight', () => {
    renderList()
    expect(screen.queryByTestId('row-new-tint')).toBeNull()
  })

  it('removes a deleted row without waiting for the refetch, and keeps it on failure', async () => {
    deleteTransaction.mockResolvedValueOnce({ error: null })
    const onRefresh = vi.fn()
    renderList({ onRefresh })

    fireEvent.click(screen.getByLabelText('Delete Uber'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByLabelText('Select Uber')).toBeNull())
    expect(screen.getByLabelText('Select Swiggy')).toBeTruthy()

    deleteTransaction.mockResolvedValueOnce({ error: { message: 'nope' } })
    fireEvent.click(screen.getByLabelText('Delete Amazon'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2))
    expect(screen.getByLabelText('Select Amazon')).toBeTruthy()
  })
})

describe('ExpenseList failures are told to the user', () => {
  afterEach(() => {
    cleanup()
    deleteTransaction.mockReset()
    bulkDeleteTransactions.mockReset()
    bulkUpdateTransactionsCategory.mockReset()
  })

  it('says so when a single delete fails, and keeps the row', async () => {
    deleteTransaction.mockResolvedValueOnce({ error: { message: 'permission denied for table transactions' } })
    renderList()

    fireEvent.click(screen.getByLabelText('Delete Uber'))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't delete that transaction. Try again.")
    expect(alert.textContent).not.toContain('permission denied')
    expect(screen.getByLabelText('Select Uber')).toBeTruthy()
  })

  it('says so when a bulk delete fails, and keeps every row', async () => {
    bulkDeleteTransactions.mockResolvedValueOnce({ error: { message: 'boom' } })
    const onRefresh = vi.fn()
    renderList({ onRefresh })

    fireEvent.click(screen.getByLabelText('Select Uber'))
    fireEvent.click(screen.getByLabelText('Select Amazon'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't delete those transactions. Try again.")
    expect(alert.textContent).not.toContain('boom')
    expect(screen.getByLabelText('Select Uber')).toBeTruthy()
    expect(screen.getByLabelText('Select Amazon')).toBeTruthy()
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })

  it('says so when a bulk category change fails, and shows the stored category', async () => {
    bulkUpdateTransactionsCategory.mockResolvedValueOnce({ error: { message: 'boom' } })
    const onRefresh = vi.fn()
    renderList({ onRefresh })

    fireEvent.click(screen.getByLabelText('Select Uber'))
    fireEvent.change(screen.getByLabelText('Set a category for the selected transactions'), {
      target: { value: 'Travel' },
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't change the category. Try again.")
    expect(bulkUpdateTransactionsCategory).toHaveBeenCalledWith(['t2'], 'Travel')
    // The list re-reads what is stored rather than trusting the failed write.
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    const uberRow = screen.getByLabelText('Select Uber').closest('li')!
    expect(within(uberRow).queryByText(/Travel/)).toBeNull()
    expect(within(uberRow).getAllByText(/Food/).length).toBeGreaterThan(0)
  })

  it('says so when a bulk category change throws', async () => {
    bulkUpdateTransactionsCategory.mockRejectedValueOnce(new Error('network down'))
    renderList()

    fireEvent.click(screen.getByLabelText('Select Uber'))
    fireEvent.change(screen.getByLabelText('Set a category for the selected transactions'), {
      target: { value: 'Travel' },
    })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain("Couldn't change the category. Try again.")
  })

  it('shows no error when the bulk category change succeeds', async () => {
    bulkUpdateTransactionsCategory.mockResolvedValueOnce({ error: null })
    const onRefresh = vi.fn()
    renderList({ onRefresh })

    fireEvent.click(screen.getByLabelText('Select Uber'))
    fireEvent.change(screen.getByLabelText('Set a category for the selected transactions'), {
      target: { value: 'Travel' },
    })

    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
