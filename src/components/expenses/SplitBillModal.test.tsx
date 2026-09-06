// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import SplitBillModal from './SplitBillModal'
import * as transactionServices from '@/services/transactions'

const mockShowToast = vi.fn()
vi.mock('@/context', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}))

describe('SplitBillModal', () => {
  const mockTransaction: any = {
    id: 'txn-101',
    user_id: 'u1',
    amount: 1500,
    type: 'debit',
    category: 'Food & Dining',
    description: 'Dinner with team',
    merchant: 'Olive Bistro',
    date: '2026-09-01',
    tags: ['Dinner', 'Goa Trip 2026'],
  }

  const mockOnClose = vi.fn()
  const mockOnSplitComplete = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(transactionServices, 'splitTransaction').mockResolvedValue({
      success: true,
      error: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders modal with original transaction info and equal split calculation', () => {
    render(
      <SplitBillModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
        onSplitComplete={mockOnSplitComplete}
      />
    )

    expect(screen.getByText('Split Bill with Friends')).toBeDefined()
    expect(screen.getByText('Olive Bistro')).toBeDefined()
    expect(screen.getAllByText('₹1,500').length).toBeGreaterThan(0)
    // With 1 friend + user = 2 people, 1500 / 2 = 750
    expect(screen.getByText(/Your share: ₹750/)).toBeDefined()
  })

  it('adds friend and updates equal split calculation to 3 people', () => {
    render(
      <SplitBillModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
        onSplitComplete={mockOnSplitComplete}
      />
    )

    const addFriendBtn = screen.getByText('Add friend')
    fireEvent.click(addFriendBtn)

    // With 2 friends + user = 3 people, 1500 / 3 = 500
    expect(screen.getByText(/2 friends ·/)).toBeDefined()
    expect(screen.getByText(/Your share: ₹500/)).toBeDefined()
  })

  it('validates friend names before submitting', async () => {
    render(
      <SplitBillModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
        onSplitComplete={mockOnSplitComplete}
      />
    )

    const confirmBtn = screen.getByText('Confirm Split')
    fireEvent.click(confirmBtn)

    expect(screen.getByText('Please enter a name for Person #1')).toBeDefined()
    expect(transactionServices.splitTransaction).not.toHaveBeenCalled()
  })

  it('submits equal split and marks friend share as returnable', async () => {
    render(
      <SplitBillModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
        onSplitComplete={mockOnSplitComplete}
      />
    )

    const nameInput = screen.getByPlaceholderText(/Friend #1/)
    fireEvent.change(nameInput, { target: { value: 'Rahul' } })

    const confirmBtn = screen.getByText('Confirm Split')
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(transactionServices.splitTransaction).toHaveBeenCalledWith(
        'txn-101',
        750,
        expect.arrayContaining([
          expect.objectContaining({
            counterparty: 'Rahul',
            amount: 750,
          }),
        ])
      )
    })

    expect(mockShowToast).toHaveBeenCalled()
    expect(mockOnSplitComplete).toHaveBeenCalled()
    expect(mockOnClose).toHaveBeenCalled()
  })

  it('supports custom amounts mode and displays error if sum exceeds total', () => {
    render(
      <SplitBillModal
        isOpen={true}
        onClose={mockOnClose}
        transaction={mockTransaction}
        onSplitComplete={mockOnSplitComplete}
      />
    )

    const customBtn = screen.getByText('Custom Amounts')
    fireEvent.click(customBtn)

    const amtInput = screen.getByPlaceholderText('₹ Amount')
    fireEvent.change(amtInput, { target: { value: '2000' } })

    expect(screen.getByText('Invalid (Exceeds total)')).toBeDefined()

    const confirmBtn = screen.getByText('Confirm Split')
    expect((confirmBtn as HTMLButtonElement).disabled).toBe(true)
  })
})
