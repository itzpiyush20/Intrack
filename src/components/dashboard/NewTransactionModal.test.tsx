// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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

  it('renders merchant input with autocomplete datalist', () => {
    render(<NewTransactionModal open={true} onClose={mockOnClose} onAdded={mockOnAdded} />)

    const merchantInput = screen.getByLabelText('Merchant name')
    expect(merchantInput).toBeDefined()

    const datalist = document.getElementById('modal-merchant-suggestions')
    expect(datalist).toBeDefined()
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
