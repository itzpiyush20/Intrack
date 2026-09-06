import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getDistinctTags, splitTransaction } from './transactions'

const mockGetUser = vi.fn()
const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockUpdate = vi.fn()
const mockSingle = vi.fn()

function makeChain() {
  const chain: any = {
    select: (...args: any[]) => {
      mockSelect(...args)
      return chain
    },
    eq: () => chain,
    not: () => chain,
    single: (...args: any[]) => mockSingle(...args),
  }
  return chain
}

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: (...args: any[]) => mockGetUser(...args) },
    from: (table: string) => ({
      select: (...args: any[]) => {
        const custom = mockSelect(table, ...args)
        return custom || makeChain()
      },
      insert: (...args: any[]) => {
        mockInsert(table, ...args)
        return {
          select: () => ({ single: (...a: any[]) => mockSingle(...a) }),
          error: null,
        }
      },
      update: (...args: any[]) => ({
        eq: (...a: any[]) => {
          mockUpdate(table, ...args, ...a)
          return Promise.resolve({ error: null })
        },
      }),
    }),
  },
}))

describe('getDistinctTags', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  })

  it('extracts, deduplicates, trims, and sorts tags across transactions', async () => {
    const chain = makeChain()
    const queryData = [
      { tags: ['Goa Trip 2026', 'Vacation'] },
      { tags: ['goa trip 2026', 'Food'] },
      { tags: ['  Wedding  ', 'Party'] },
      { tags: null },
    ]
    chain.not = vi.fn().mockResolvedValue({
      data: queryData,
      error: null,
    })
    chain.eq = vi.fn().mockReturnValue(chain)

    mockSelect.mockReturnValue(chain)

    const tags = await getDistinctTags()
    expect(tags).toEqual(['Food', 'Goa Trip 2026', 'Party', 'Vacation', 'Wedding', 'goa trip 2026'].sort((a, b) => a.localeCompare(b)))
  })

  it('returns empty array when user is unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const tags = await getDistinctTags()
    expect(tags).toEqual([])
  })
})

describe('splitTransaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  })

  it('updates original transaction amount and creates returnable debits for friends', async () => {
    const originalRow = {
      id: 'txn-1',
      user_id: 'u1',
      amount: 1500,
      type: 'debit',
      category: 'Food & Dining',
      description: 'Dinner with friends',
      merchant: 'Bistro',
      date: '2026-09-01',
      tags: ['Dinner', 'Goa Trip 2026'],
      card_id: 'c1',
      is_returnable: false,
    }

    mockSingle.mockResolvedValue({ data: originalRow, error: null })

    const friendShares = [
      {
        counterparty: 'Rahul',
        amount: 500,
        expected_return_date: '2026-10-01',
      },
      {
        counterparty: 'Priya',
        amount: 500,
        expected_return_date: '2026-10-01',
      },
    ]

    const result = await splitTransaction('txn-1', 500, friendShares)

    expect(result.success).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith(
      'transactions',
      expect.objectContaining({
        amount: 500,
      }),
      'id',
      'txn-1'
    )

    expect(mockInsert).toHaveBeenCalledWith(
      'transactions',
      expect.arrayContaining([
        expect.objectContaining({
          counterparty: 'Rahul',
          amount: 500,
          is_returnable: true,
          return_status: 'pending',
          category: 'Food & Dining',
        }),
        expect.objectContaining({
          counterparty: 'Priya',
          amount: 500,
          is_returnable: true,
          return_status: 'pending',
          category: 'Food & Dining',
        }),
      ])
    )
  })

  it('assigns first friend to original transaction if user amount is 0', async () => {
    const originalRow = {
      id: 'txn-2',
      user_id: 'u1',
      amount: 1000,
      type: 'debit',
      category: 'Shopping',
      description: 'Shoes for Rahul',
      merchant: 'Nike',
      date: '2026-09-02',
      tags: [],
    }

    mockSingle.mockResolvedValue({ data: originalRow, error: null })

    const friendShares = [
      {
        counterparty: 'Rahul',
        amount: 1000,
        expected_return_date: '2026-10-02',
      },
    ]

    const result = await splitTransaction('txn-2', 0, friendShares)

    expect(result.success).toBe(true)
    expect(mockUpdate).toHaveBeenCalledWith(
      'transactions',
      expect.objectContaining({
        amount: 1000,
        counterparty: 'Rahul',
        is_returnable: true,
        return_status: 'pending',
      }),
      'id',
      'txn-2'
    )
  })
})
