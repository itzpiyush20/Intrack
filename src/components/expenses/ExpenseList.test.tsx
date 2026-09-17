// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ExpenseList from './ExpenseList'
import type { Database } from '@/types/database'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [],
    getStyle: (cat: string) => ({ emoji: '💳', label: cat, color: '#000000' }),
  }),
}))

const deleteTransaction = vi.fn()
vi.mock('@/services/transactions', () => ({
  deleteTransaction: (id: string) => deleteTransaction(id),
  bulkDeleteTransactions: vi.fn().mockResolvedValue({ error: null }),
  bulkUpdateTransactionsCategory: vi.fn().mockResolvedValue({ error: null }),
}))

const row = (id: string, merchant: string) => ({
  id, merchant, amount: 100, type: 'debit', category: 'Food', date: '2026-09-15',
  description: null, tags: null,
}) as unknown as TransactionRow
const rows = [row('t1', 'Swiggy'), row('t2', 'Uber'), row('t3', 'Amazon')]

function renderList(props: Partial<Parameters<typeof ExpenseList>[0]> = {}) {
  return render(
    <ExpenseList transactions={rows} loading={false} onEdit={() => {}} onRefresh={() => {}} {...props} />,
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
