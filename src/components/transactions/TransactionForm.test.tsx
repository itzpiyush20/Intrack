// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import TransactionForm from './TransactionForm'
import type { Database } from '@/types/database'

type TransactionRow = Database['public']['Tables']['transactions']['Row']

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, currencySymbol: '₹' }),
}))

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [
      { id: '1', name: 'Food & Dining', emoji: '🍔' },
      { id: '2', name: 'Transport', emoji: '🚗' },
      { id: '3', name: 'Shopping', emoji: '🛍️' },
      { id: '4', name: 'Utilities & Bills', emoji: '💡' },
      { id: '5', name: 'Card Bill', emoji: '💳', analytics_tags: ['credit_card_bill'] },
    ],
    getStyle: (cat: string) => ({ emoji: '💳', label: cat }),
  }),
}))

vi.mock('@/services', () => ({
  getDistinctTags: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/services/cards', () => ({
  getCards: vi.fn().mockResolvedValue({
    data: [{ id: 'c1', name: 'Regalia', last4: '4321', is_archived: false }],
  }),
}))

vi.mock('@/services/transactions', () => ({
  createTransaction: vi.fn().mockResolvedValue({ data: {}, error: null }),
  updateTransaction: vi.fn().mockResolvedValue({ data: {}, error: null }),
}))

vi.mock('@/services/merchants', () => ({
  listMerchants: vi.fn().mockResolvedValue({ data: [], error: null }),
  createMerchant: vi.fn(),
  addMerchantAlias: vi.fn().mockResolvedValue(undefined),
}))

const row = (over: Partial<TransactionRow> = {}): TransactionRow =>
  ({
    id: 't1',
    type: 'debit',
    amount: 450,
    category: 'Food & Dining',
    description: 'Dinner',
    merchant: 'Swiggy',
    merchant_id: null,
    date: '2026-09-10',
    tags: ['Trip'],
    notes: null,
    is_returnable: false,
    counterparty: null,
    expected_return_date: null,
    return_status: null,
    card_id: 'c1',
    settles_card_id: null,
    loan_source: null,
    loan_source_note: null,
    ...over,
  }) as TransactionRow

describe('TransactionForm', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('offers the Account / Card choice with the user\'s cards', async () => {
    render(<TransactionForm onSaved={vi.fn()} />)
    const select = (await screen.findByLabelText('Account / Card')) as HTMLSelectElement
    expect(Array.from(select.options).map((o) => o.text)).toEqual([
      'Cash in hand & Bank balance',
      'Credit Card — Regalia (•••• 4321)',
    ])
  })

  it('edits an existing row with its saved values and updates, never creates', async () => {
    const onSaved = vi.fn()
    render(<TransactionForm editingTransaction={row()} onSaved={onSaved} />)
    expect(((await screen.findByLabelText('Account / Card')) as HTMLSelectElement).value).toBe('c1')
    expect((screen.getByLabelText('Transaction date') as HTMLInputElement).value).toBe('2026-09-10')

    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))

    const { updateTransaction, createTransaction } = await import('@/services/transactions')
    await waitFor(() =>
      expect(updateTransaction).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ amount: 450, category: 'Food & Dining', card_id: 'c1', date: '2026-09-10', tags: ['Trip'] })
      )
    )
    expect(createTransaction).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledWith({ created: false })
  })

  it('on a credit card bill asks which card is settled and records no paying card', async () => {
    render(<TransactionForm editingTransaction={row({ category: 'Card Bill', settles_card_id: 'c1' })} onSaved={vi.fn()} />)
    expect(((await screen.findByLabelText('Card settled by this payment')) as HTMLSelectElement).value).toBe('c1')
    expect(screen.queryByLabelText('Account / Card')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /Save changes/ }))

    const { updateTransaction } = await import('@/services/transactions')
    await waitFor(() =>
      expect(updateTransaction).toHaveBeenCalledWith(
        't1',
        expect.objectContaining({ card_id: null, settles_card_id: 'c1' })
      )
    )
  })
})
