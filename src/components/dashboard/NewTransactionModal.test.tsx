// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import NewTransactionModal from './NewTransactionModal'

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user-123' },
    currencySymbol: '₹',
  }),
}))

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [
      { id: '1', name: 'Food & Dining', emoji: '🍔' },
      { id: '2', name: 'Transport', emoji: '🚗' },
      { id: '3', name: 'Shopping', emoji: '🛍️' },
      { id: '4', name: 'Utilities & Bills', emoji: '💡' },
    ],
    getStyle: (cat: string) => ({ emoji: '💳', label: cat }),
  }),
}))

vi.mock('@/context', () => ({
  useToast: () => ({ showToast: vi.fn() }),
}))

vi.mock('@/services', () => ({
  getDistinctTags: vi.fn().mockResolvedValue(['Trip', 'Groceries']),
}))

vi.mock('@/services/cards', () => ({
  getCards: vi.fn().mockResolvedValue({ data: [] }),
}))

vi.mock('@/services/transactions', () => ({
  createTransaction: vi.fn().mockResolvedValue({ data: {}, error: null }),
}))

vi.mock('@/services/merchants', () => ({
  listMerchants: vi.fn().mockResolvedValue({
    data: [{ id: 'm1', name: 'Swiggy', default_category: 'Food & Dining', aliases: [] }],
    error: null,
  }),
  createMerchant: vi.fn(),
  addMerchantAlias: vi.fn().mockResolvedValue(undefined),
}))

describe('NewTransactionModal (Add Transaction Modal)', () => {
  const mockOnClose = vi.fn()
  const mockOnAdded = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders uniformly with "Add Transaction" title and submit button', () => {
    render(<NewTransactionModal open={true} onClose={mockOnClose} onAdded={mockOnAdded} />)

    // Modal title must be "Add Transaction"
    const heading = screen.getByRole('heading', { name: 'Add Transaction' })
    expect(heading).toBeDefined()

    // Submit button must be "Add Transaction"
    const submitBtn = screen.getByRole('button', { name: /Add Transaction/i })
    expect(submitBtn).toBeDefined()
  })

  it('uses the saved-merchant picker for the merchant field', () => {
    render(<NewTransactionModal open={true} onClose={mockOnClose} onAdded={mockOnAdded} />)
    expect(screen.getByRole('combobox', { name: 'Merchant' })).toBeDefined()
    expect(document.getElementById('modal-merchant-suggestions')).toBeNull()
  })

  it('pre-fills the category from a picked merchant, and saves the link', async () => {
    render(<NewTransactionModal open={true} onClose={mockOnClose} onAdded={mockOnAdded} />)
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '250' } })
    const box = screen.getByRole('combobox', { name: 'Merchant' })
    fireEvent.focus(box)
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Swiggy/ }))
    fireEvent.click(screen.getByRole('button', { name: /Add Transaction/i }))

    const { createTransaction } = await import('@/services/transactions')
    await waitFor(() =>
      expect(createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ merchant: 'Swiggy', merchant_id: 'm1', category: 'Food & Dining' })
      )
    )
  })

  it('never overwrites a category the user already chose', async () => {
    render(<NewTransactionModal open={true} onClose={mockOnClose} onAdded={mockOnAdded} />)
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: /Transport/ }))
    fireEvent.focus(screen.getByRole('combobox', { name: 'Merchant' }))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Swiggy/ }))
    fireEvent.click(screen.getByRole('button', { name: /Add Transaction/i }))

    const { createTransaction } = await import('@/services/transactions')
    await waitFor(() =>
      expect(createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ merchant_id: 'm1', category: 'Transport' })
      )
    )
  })

  it('expands more details section when clicked', () => {
    render(<NewTransactionModal open={true} onClose={mockOnClose} onAdded={mockOnAdded} />)

    // Details initially hidden
    expect(screen.queryByLabelText('Transaction date')).toBeNull()

    // Click more options toggle
    const toggle = screen.getByRole('button', { name: /More options/i })
    fireEvent.click(toggle)

    // Date, Notes, and Returnable inputs are now visible
    expect(screen.getByLabelText('Transaction date')).toBeDefined()
    expect(screen.getByLabelText('Notes')).toBeDefined()
    expect(screen.getByText('I expect this money back (split or advance)')).toBeDefined()
  })
})
