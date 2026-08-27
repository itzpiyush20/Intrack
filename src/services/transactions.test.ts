import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockQueryResult = vi.fn()
const mockSingle = vi.fn()
const mockInsert = vi.fn()
const mockEqUpdate = vi.fn()

// The resolved value of a terminal call. It is the promise mockQueryResult
// returns, with the methods real code may still chain off it hung on the side:
// .lte() (getSummary narrows a range after .gte()) and .order()/.range()
// (getSummary pages). .order()/.range() hand back the same promise so a paged
// caller keeps awaiting the value the test set up.
function terminal(...args: unknown[]) {
  const result = mockQueryResult(...args)
  if (!result) return result
  result.lte = (...a: unknown[]) => terminal(...a)
  result.order = () => result
  // .range() re-consults mockQueryResult with the (from, to) offsets, so a test
  // that cares about paging can hand back a different page per request.
  result.range = (...a: unknown[]) => terminal(...a)
  return result
}

// A reusable chainable query-builder mock. Every intermediate method
// (.select()/.eq()) returns the SAME chain object, so any number of chained
// .eq() calls works — real code chains a different number of .eq()s per query
// (getLoggingStreak: 2, getActiveReceivables: 3, settleReceivable's
// fetch-by-id: 1) and hand-nesting to a fixed depth breaks whichever query
// doesn't match that exact depth. Only the terminal methods
// (.gte/.lte/.range/.single) resolve to a value.
function makeChain() {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    // .gte() is terminal on its own for callers like getLoggingStreak, but
    // getMonthlySummary chains a further .lte() off it — so the resolved
    // value also carries a .lte() that resolves the same way.
    gte: (...args: any[]) => terminal(...args),
    lte: (...args: any[]) => terminal(...args),
    single: (...args: any[]) => mockSingle(...args),
  }
  return chain
}

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: (...args: any[]) => mockGetUser(...args) },
    from: (table: string) => ({
      select: () => makeChain(),
      insert: (...args: any[]) => {
        mockInsert(table, ...args)
        return { select: () => ({ single: (...a: any[]) => mockSingle(...a) }) }
      },
      update: (...args: any[]) => ({
        eq: (...a: any[]) => mockEqUpdate(table, ...args, ...a),
      }),
    }),
  },
}))

import { getLoggingStreak, getActiveReceivables, settleReceivable, getMonthlySummary, getSummary, getTransactionById } from './transactions'

function isoDaysAgo(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

beforeEach(() => {
  mockGetUser.mockReset()
  mockQueryResult.mockReset()
  mockSingle.mockReset()
  mockInsert.mockReset()
  mockEqUpdate.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

describe('getLoggingStreak', () => {
  it('counts a streak of consecutive days ending today', async () => {
    mockQueryResult.mockResolvedValue({
      data: [
        { created_at: isoDaysAgo(0) },
        { created_at: isoDaysAgo(1) },
        { created_at: isoDaysAgo(2) },
      ],
      error: null,
    })
    const { data } = await getLoggingStreak()
    expect(data).toEqual({ streak: 3, loggedToday: true })
  })

  it('gives grace when nothing logged today yet but yesterday was logged', async () => {
    mockQueryResult.mockResolvedValue({
      data: [{ created_at: isoDaysAgo(1) }, { created_at: isoDaysAgo(2) }],
      error: null,
    })
    const { data } = await getLoggingStreak()
    expect(data).toEqual({ streak: 2, loggedToday: false })
  })

  it('resets to zero after a gap', async () => {
    mockQueryResult.mockResolvedValue({
      data: [{ created_at: isoDaysAgo(3) }, { created_at: isoDaysAgo(4) }],
      error: null,
    })
    const { data } = await getLoggingStreak()
    expect(data).toEqual({ streak: 0, loggedToday: false })
  })

  it('returns zero for a user with no transactions', async () => {
    mockQueryResult.mockResolvedValue({ data: [], error: null })
    const { data } = await getLoggingStreak()
    expect(data).toEqual({ streak: 0, loggedToday: false })
  })
})

describe('getActiveReceivables', () => {
  it('includes a receivable due this month', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockQueryResult.mockResolvedValue({
      data: [{ id: 't1', counterparty: 'Rahul', amount: 500, expected_return_date: '2026-07-20', notes: 'lunch split' }],
      error: null,
    })
    const { data } = await getActiveReceivables()
    expect(data).toHaveLength(1)
    expect(data![0].counterparty).toBe('Rahul')
  })

  it('returns empty when nothing is pending', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockQueryResult.mockResolvedValue({ data: [], error: null })
    const { data } = await getActiveReceivables()
    expect(data).toEqual([])
  })
})

describe('settleReceivable', () => {
  it('creates a credit transaction and marks the receivable received', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const original = {
      id: 't1',
      user_id: 'u1',
      amount: 500,
      category: 'food',
      counterparty: 'Rahul',
    }
    mockSingle.mockResolvedValueOnce({ data: original, error: null }) // fetch original
    mockSingle.mockResolvedValueOnce({ data: { id: 't2' }, error: null }) // insert credit
    mockEqUpdate.mockResolvedValueOnce({ error: null }) // update original

    const { error } = await settleReceivable('t1')
    expect(error).toBeNull()
  })

  it('returns an error if the original transaction is not found', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } })

    const { error } = await settleReceivable('missing')
    expect(error).not.toBeNull()
  })

  it('propagates the error if creating the credit transaction fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const original = {
      id: 't1',
      user_id: 'u1',
      amount: 500,
      category: 'food',
      counterparty: 'Rahul',
    }
    const insertError = { message: 'insert failed' }
    mockSingle.mockResolvedValueOnce({ data: original, error: null }) // fetch original
    mockSingle.mockResolvedValueOnce({ data: null, error: insertError }) // insert credit fails

    const { data, error } = await settleReceivable('t1')
    expect(data).toBeNull()
    expect(error).toBe(insertError)
  })

  it('propagates the error if marking the original as received fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const original = {
      id: 't1',
      user_id: 'u1',
      amount: 500,
      category: 'food',
      counterparty: 'Rahul',
    }
    const updateError = { message: 'update failed' }
    mockSingle.mockResolvedValueOnce({ data: original, error: null }) // fetch original
    mockSingle.mockResolvedValueOnce({ data: { id: 't2' }, error: null }) // insert credit
    mockEqUpdate.mockResolvedValueOnce({ error: updateError }) // update original fails

    const { data, error } = await settleReceivable('t1')
    expect(data).toBeNull()
    expect(error).toBe(updateError)
  })
})

describe('getMonthlySummary', () => {
  it('excludes credit_card_bill_payment transactions from total_expenses and the category breakdown', async () => {
    mockQueryResult.mockResolvedValue({
      data: [
        { amount: 500, type: 'debit', category: 'food' },
        { amount: 15000, type: 'debit', category: 'Credit Card Bill Payment' },
        { amount: 2000, type: 'credit', category: 'salary' },
      ],
      error: null,
      count: 3,
    })
    const { data } = await getMonthlySummary('2026-07')
    expect(data!.total_expenses).toBe(500)
    expect(data!.category_breakdown.find((c) => c.category === 'Credit Card Bill Payment')).toBeUndefined()
  })

  it('still totals ordinary debit transactions when there is no credit card bill payment', async () => {
    mockQueryResult.mockResolvedValue({
      data: [
        { amount: 300, type: 'debit', category: 'food' },
        { amount: 200, type: 'debit', category: 'transport' },
      ],
      error: null,
      count: 2,
    })
    const { data } = await getMonthlySummary('2026-07')
    expect(data!.total_expenses).toBe(500)
  })
})

describe('getSummary', () => {
  it('aggregates income, expenses and category breakdown for an explicit range', async () => {
    mockQueryResult.mockResolvedValue({
      data: [
        { amount: 500, type: 'debit', category: 'food' },
        { amount: 300, type: 'debit', category: 'transport' },
        { amount: 2000, type: 'credit', category: 'salary' },
      ],
      error: null,
      count: 3,
    })
    const { data } = await getSummary({ dateFrom: '2026-06-20', dateTo: '2026-07-05' })
    expect(data!.total_income).toBe(2000)
    expect(data!.total_expenses).toBe(800)
    expect(data!.category_breakdown).toHaveLength(2)
  })

  it('excludes credit_card_bill_payment from totals, same as getMonthlySummary', async () => {
    mockQueryResult.mockResolvedValue({
      data: [
        { amount: 500, type: 'debit', category: 'food' },
        { amount: 15000, type: 'debit', category: 'Credit Card Bill Payment' },
      ],
      error: null,
      count: 2,
    })
    const { data } = await getSummary({ dateFrom: '2026-07-01', dateTo: '2026-07-31' })
    expect(data!.total_expenses).toBe(500)
  })

  it('keeps paging past the first page, so a range wider than db-max-rows still totals in full', async () => {
    // 1500 debits of 1 each: more than the 1000 PostgREST will hand back at
    // once. A single unbounded select would total 1000 and report no error.
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      id: `t${i}`,
      amount: 1,
      type: 'debit',
      category: 'food',
    }))

    mockQueryResult.mockImplementation((...args: unknown[]) => {
      const [from, to] = args
      // Only the .range() call carries numeric offsets; the .gte()/.lte()
      // calls that precede it are just links in the chain.
      if (typeof from !== 'number' || typeof to !== 'number') {
        return Promise.resolve({ data: [], error: null, count: rows.length })
      }
      return Promise.resolve({
        data: rows.slice(from, to + 1),
        error: null,
        count: rows.length,
      })
    })

    const { data } = await getSummary({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })
    expect(data!.total_expenses).toBe(1500)
    expect(data!.category_breakdown[0].count).toBe(1500)
  })

  it('stops paging when a page comes back empty, even without a count', async () => {
    const firstPage = Array.from({ length: 3 }, (_, i) => ({
      id: `t${i}`,
      amount: 100,
      type: 'debit',
      category: 'food',
    }))
    let served = false

    mockQueryResult.mockImplementation((...args: unknown[]) => {
      if (typeof args[0] !== 'number') return Promise.resolve({ data: [], error: null })
      if (served) return Promise.resolve({ data: [], error: null })
      served = true
      return Promise.resolve({ data: firstPage, error: null })
    })

    const { data } = await getSummary({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })
    expect(data!.total_expenses).toBe(300)
  })

  it('surfaces an error from a later page instead of returning partial totals', async () => {
    const pageError = { message: 'connection reset' }
    let calls = 0

    mockQueryResult.mockImplementation((...args: unknown[]) => {
      if (typeof args[0] !== 'number') return Promise.resolve({ data: [], error: null })
      calls++
      if (calls === 1) {
        return Promise.resolve({
          data: [{ id: 't0', amount: 100, type: 'debit', category: 'food' }],
          error: null,
          count: 2,
        })
      }
      return Promise.resolve({ data: null, error: pageError, count: null })
    })

    const { data, error } = await getSummary({ dateFrom: '2026-01-01', dateTo: '2026-12-31' })
    expect(data).toBeNull()
    expect(error).toBe(pageError)
  })
})

describe('getTransactionById', () => {
  it('returns the full transaction row for a given id', async () => {
    const fullRow = {
      id: 't1', user_id: 'u1', amount: 500, type: 'debit', category: 'Food & Dining',
      date: '2026-08-01', merchant: 'Zomato', description: 'Zomato order',
      source: 'manual', approval_status: 'approved', category_confirmed_at: '2026-08-01T00:00:00Z',
    }
    mockSingle.mockResolvedValue({ data: fullRow, error: null })
    const { data, error } = await getTransactionById('t1')
    expect(error).toBeNull()
    expect(data).toEqual(fullRow)
  })
})

