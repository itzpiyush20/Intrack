// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import EventRollupSection from './EventRollupSection'

const mockOpenDrillDown = vi.fn()
vi.mock('@/context/DrillDownContext', () => ({
  useDrillDown: () => ({ openDrillDown: mockOpenDrillDown }),
}))

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    getStyle: (cat: string) => ({ emoji: '🏷️', label: cat }),
  }),
}))

describe('EventRollupSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders onboarding empty state when no tagged transactions exist', () => {
    render(
      <MemoryRouter>
        <EventRollupSection
          transactions={[
            { id: '1', amount: 500, type: 'debit', category: 'Food', date: '2026-09-01', tags: [] },
          ]}
          loading={false}
        />
      </MemoryRouter>
    )

    expect(screen.getByText('Event & Trip Expenses')).toBeDefined()
    expect(screen.getByText(/Group spending across multiple categories/)).toBeDefined()
  })

  it('aggregates debit transactions by tag and computes total, percentage, and category breakdown', () => {
    const transactions = [
      {
        id: '1',
        amount: 2000,
        type: 'debit',
        category: 'Travel',
        date: '2026-09-01',
        tags: ['Goa Trip 2026'],
      },
      {
        id: '2',
        amount: 1000,
        type: 'debit',
        category: 'Food & Dining',
        date: '2026-09-02',
        tags: ['Goa Trip 2026'],
      },
      {
        id: '3',
        amount: 1000,
        type: 'debit',
        category: 'Shopping',
        date: '2026-09-03',
        tags: ['Other Spend'],
      },
    ]

    render(
      <MemoryRouter>
        <EventRollupSection
          transactions={transactions}
          loading={false}
        />
      </MemoryRouter>
    )

    // Total for Goa Trip 2026 = 3000 out of 4000 total = 75.0%
    expect(screen.getByText('₹3,000')).toBeDefined()
    expect(screen.getAllByText(/75\.0%/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Across 2 transactions/)).toBeDefined()
    expect(screen.getAllByText('Travel').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Food & Dining').length).toBeGreaterThan(0)
  })

  it('opens drilldown modal when category row is clicked', () => {
    const transactions = [
      {
        id: '1',
        amount: 2000,
        type: 'debit',
        category: 'Travel',
        date: '2026-09-01',
        tags: ['Goa Trip 2026'],
      },
    ]

    render(
      <MemoryRouter>
        <EventRollupSection
          transactions={transactions}
          loading={false}
        />
      </MemoryRouter>
    )

    const travelRows = screen.getAllByText('Travel')
    fireEvent.click(travelRows[0])

    expect(mockOpenDrillDown).toHaveBeenCalledWith(
      { tag: 'Goa Trip 2026', category: 'Travel', type: 'debit' },
      '#Goa Trip 2026 — Travel'
    )
  })
})
