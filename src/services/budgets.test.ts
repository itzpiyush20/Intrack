import { describe, it, expect, vi, beforeEach } from 'vitest'

// A chainable Supabase mock. Every builder method records the call and returns
// the same object, so any chain depth works; awaiting the chain shifts the next
// queued result for that table. Results are queued in call order, which is what
// lets one test drive getBudgets' two separate budget reads.
type Result = { data?: unknown; error?: unknown }

const queue: Record<string, Result[]> = {}
let calls: Array<{ table: string; method: string; args: unknown[] }> = []

const BUILDER_METHODS = [
  'select', 'eq', 'lt', 'gt', 'order', 'limit', 'upsert', 'update', 'delete', 'insert',
]

function makeChain(table: string) {
  const chain: Record<string, unknown> = {}
  for (const m of BUILDER_METHODS) {
    chain[m] = (...args: unknown[]) => {
      calls.push({ table, method: m, args })
      return chain
    }
  }
  chain.then = (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) => {
    const result = (queue[table] || []).shift() ?? { data: [], error: null }
    return Promise.resolve(result).then(onFulfilled, onRejected)
  }
  return chain
}

const mockGetUser = vi.fn()

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (table: string) => makeChain(table),
  },
}))

import {
  getBudgets,
  deleteBudget,
  isTombstone,
  visibleBudgets,
  shouldCarryForward,
  pickSourceMonthRows,
  planCarryForward,
  TOMBSTONE_AMOUNT,
} from './budgets'
import { getCurrentMonth } from '@/utils'

const CURRENT = getCurrentMonth()

/** A month strictly before the current one, in YYYY-MM. */
function monthsAgo(n: number): string {
  const [y, m] = CURRENT.split('-').map(Number)
  const d = new Date(y, m - 1 - n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function queueFor(table: string, ...results: Result[]) {
  queue[table] = results
}

function callsFor(table: string, method: string) {
  return calls.filter((c) => c.table === table && c.method === method)
}

beforeEach(() => {
  calls = []
  for (const k of Object.keys(queue)) delete queue[k]
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
})

// ============================================================
// Pure helpers
// ============================================================

describe('isTombstone / visibleBudgets', () => {
  it('treats a zero amount as a deliberate deletion', () => {
    expect(isTombstone({ amount: 0 })).toBe(true)
    expect(isTombstone({ amount: '0' })).toBe(true)
    expect(isTombstone({ amount: 5000 })).toBe(false)
  })

  it('hides tombstones from anything that reads budgets', () => {
    const rows = [
      { category: 'Food', amount: 5000 },
      { category: 'Travel', amount: TOMBSTONE_AMOUNT },
    ]
    expect(visibleBudgets(rows)).toEqual([{ category: 'Food', amount: 5000 }])
  })
})

describe('shouldCarryForward', () => {
  it('only ever targets the current month', () => {
    expect(shouldCarryForward('2026-05', '2026-05')).toBe(true)
    expect(shouldCarryForward('2026-04', '2026-05')).toBe(false) // never rewrite history
    expect(shouldCarryForward('2026-06', '2026-05')).toBe(false) // future months wait their turn
  })
})

describe('pickSourceMonthRows', () => {
  it('picks the most recent earlier month, not the immediately preceding one', () => {
    const rows = [
      { month: '2026-01', category: 'Food' },
      { month: '2026-03', category: 'Food' },
      { month: '2026-03', category: 'Travel' },
    ]
    expect(pickSourceMonthRows(rows, '2026-07')).toEqual([
      { month: '2026-03', category: 'Food' },
      { month: '2026-03', category: 'Travel' },
    ])
  })

  it('ignores the target month and anything after it', () => {
    const rows = [
      { month: '2026-05', category: 'Food' },
      { month: '2026-06', category: 'Travel' },
      { month: '2026-07', category: 'Fuel' },
    ]
    expect(pickSourceMonthRows(rows, '2026-06')).toEqual([{ month: '2026-05', category: 'Food' }])
  })

  it('returns nothing when there is no earlier month', () => {
    expect(pickSourceMonthRows([{ month: '2026-06', category: 'Food' }], '2026-06')).toEqual([])
    expect(pickSourceMonthRows([], '2026-06')).toEqual([])
  })
})

describe('planCarryForward', () => {
  const eligibleCategories = ['Food', 'Travel']

  it('copies the most recent month forward into an empty month', () => {
    const plan = planCarryForward({
      targetMonth: '2026-06',
      existingRows: [],
      priorRows: [
        { month: '2026-01', category: 'Food', amount: 1000 },
        { month: '2026-04', category: 'Food', amount: 5000 },
        { month: '2026-04', category: 'Travel', amount: 2000 },
      ],
      eligibleCategories,
    })
    expect(plan).toEqual([
      { month: '2026-06', category: 'Food', amount: 5000 },
      { month: '2026-06', category: 'Travel', amount: 2000 },
    ])
  })

  it('does nothing when the month already has budgets', () => {
    const plan = planCarryForward({
      targetMonth: '2026-06',
      existingRows: [{ month: '2026-06', category: 'Food', amount: 3000 }],
      priorRows: [{ month: '2026-05', category: 'Travel', amount: 2000 }],
      eligibleCategories,
    })
    expect(plan).toEqual([])
  })

  it('does not resurrect a budget the user deleted this month', () => {
    // A tombstone is the only row left in the target month. It must still count
    // as "this month has been decided", or the deletion would be undone on the
    // very next read.
    const plan = planCarryForward({
      targetMonth: '2026-06',
      existingRows: [{ month: '2026-06', category: 'Food', amount: TOMBSTONE_AMOUNT }],
      priorRows: [{ month: '2026-05', category: 'Food', amount: 5000 }],
      eligibleCategories,
    })
    expect(plan).toEqual([])
  })

  it('does not carry a deletion forward as a budget', () => {
    const plan = planCarryForward({
      targetMonth: '2026-06',
      existingRows: [],
      priorRows: [
        { month: '2026-05', category: 'Food', amount: TOMBSTONE_AMOUNT },
        { month: '2026-05', category: 'Travel', amount: 2000 },
      ],
      eligibleCategories,
    })
    expect(plan).toEqual([{ month: '2026-06', category: 'Travel', amount: 2000 }])
  })

  it('keeps a deletion sticky across an unopened month', () => {
    // May holds only a tombstone. June is skipped entirely. July must resolve
    // its source to May (the latest month with rows) and copy nothing, rather
    // than reaching further back to April's live budget.
    const plan = planCarryForward({
      targetMonth: '2026-07',
      existingRows: [],
      priorRows: [
        { month: '2026-04', category: 'Food', amount: 5000 },
        { month: '2026-05', category: 'Food', amount: TOMBSTONE_AMOUNT },
      ],
      eligibleCategories,
    })
    expect(plan).toEqual([])
  })

  it('skips categories that no longer exist or can no longer be budgeted', () => {
    const plan = planCarryForward({
      targetMonth: '2026-06',
      existingRows: [],
      priorRows: [
        { month: '2026-05', category: 'Food', amount: 5000 },
        { month: '2026-05', category: 'DeletedCategory', amount: 900 },
      ],
      eligibleCategories,
    })
    expect(plan).toEqual([{ month: '2026-06', category: 'Food', amount: 5000 }])
  })

  it('returns nothing when there is no earlier month to copy', () => {
    expect(
      planCarryForward({ targetMonth: '2026-06', existingRows: [], priorRows: [], eligibleCategories })
    ).toEqual([])
  })
})

// ============================================================
// getBudgets — lazy carry-forward on read
// ============================================================

describe('getBudgets carry-forward', () => {
  it('fills an empty current month from the most recent month that has budgets', async () => {
    queueFor(
      'budgets',
      { data: [], error: null }, // first read of the current month: empty
      { data: [{ category: 'Food', amount: 5000, month: monthsAgo(3) }], error: null }, // prior rows
      { data: null, error: null }, // upsert
      { data: [{ id: 'b1', category: 'Food', amount: 5000, month: CURRENT }], error: null } // re-read
    )
    queueFor('categories', {
      data: [{ name: 'Food', type: 'expense', budget_eligible: true }],
      error: null,
    })

    const { data, error } = await getBudgets(CURRENT)

    expect(error).toBeNull()
    expect(data).toEqual([{ id: 'b1', category: 'Food', amount: 5000, month: CURRENT }])

    const upserts = callsFor('budgets', 'upsert')
    expect(upserts).toHaveLength(1)
    expect(upserts[0].args[0]).toEqual([
      { user_id: 'u1', category: 'Food', amount: 5000, month: CURRENT },
    ])
    // Concurrent readers (Dashboard + Budgets page) must not clobber each other.
    expect(upserts[0].args[1]).toEqual({ onConflict: 'user_id,category,month', ignoreDuplicates: true })
  })

  it('never back-fills a past month', async () => {
    queueFor('budgets', { data: [], error: null })

    const { data } = await getBudgets(monthsAgo(2))

    expect(data).toEqual([])
    expect(callsFor('budgets', 'upsert')).toHaveLength(0)
  })

  it('leaves the current month alone once it has rows', async () => {
    queueFor('budgets', {
      data: [{ id: 'b1', category: 'Food', amount: 3000, month: CURRENT }],
      error: null,
    })

    const { data } = await getBudgets(CURRENT)

    expect(data).toHaveLength(1)
    expect(callsFor('budgets', 'upsert')).toHaveLength(0)
  })

  it('does not carry forward when a tombstone is all that is left', async () => {
    queueFor('budgets', {
      data: [{ id: 'b1', category: 'Food', amount: TOMBSTONE_AMOUNT, month: CURRENT }],
      error: null,
    })

    const { data } = await getBudgets(CURRENT)

    expect(data).toEqual([]) // hidden from the UI...
    expect(callsFor('budgets', 'upsert')).toHaveLength(0) // ...but not refilled
  })

  it('hides tombstones from the rows it returns', async () => {
    queueFor('budgets', {
      data: [
        { id: 'b1', category: 'Food', amount: 5000, month: CURRENT },
        { id: 'b2', category: 'Travel', amount: TOMBSTONE_AMOUNT, month: CURRENT },
      ],
      error: null,
    })

    const { data } = await getBudgets(CURRENT)

    expect(data).toEqual([{ id: 'b1', category: 'Food', amount: 5000, month: CURRENT }])
  })

  it('can be asked for a pure read with carryForward: false', async () => {
    queueFor('budgets', { data: [], error: null })

    const { data } = await getBudgets(CURRENT, { carryForward: false })

    expect(data).toEqual([])
    expect(callsFor('budgets', 'upsert')).toHaveLength(0)
  })

  it('still returns the month when the carry-forward write fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    queueFor(
      'budgets',
      { data: [], error: null },
      { data: [{ category: 'Food', amount: 5000, month: monthsAgo(1) }], error: null },
      { data: null, error: { message: 'insert denied' } } // upsert fails
    )
    queueFor('categories', {
      data: [{ name: 'Food', type: 'expense', budget_eligible: true }],
      error: null,
    })

    const { data, error } = await getBudgets(CURRENT)

    expect(error).toBeNull() // a convenience write must not break the read
    expect(data).toEqual([])
    warn.mockRestore()
  })

  it('returns an error, and writes nothing, when there is no signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })

    const { data, error } = await getBudgets(CURRENT)

    expect(data).toBeNull()
    expect(error).toBeInstanceOf(Error)
    expect(callsFor('budgets', 'upsert')).toHaveLength(0)
  })
})

// ============================================================
// deleteBudget — tombstone vs. real delete
// ============================================================

describe('deleteBudget', () => {
  it('tombstones a current-month budget so carry-forward cannot restore it', async () => {
    queueFor('budgets', { data: null, error: null })

    const { error } = await deleteBudget('b1', { month: CURRENT })

    expect(error).toBeNull()
    expect(callsFor('budgets', 'delete')).toHaveLength(0)
    const updates = callsFor('budgets', 'update')
    expect(updates).toHaveLength(1)
    expect(updates[0].args[0]).toEqual({ amount: TOMBSTONE_AMOUNT })
    expect(callsFor('budgets', 'eq')[0].args).toEqual(['id', 'b1'])
  })

  it('really deletes a row from a month nothing carries into', async () => {
    queueFor('budgets', { data: null, error: null })

    await deleteBudget('b1', { month: monthsAgo(2) })

    expect(callsFor('budgets', 'update')).toHaveLength(0)
    expect(callsFor('budgets', 'delete')).toHaveLength(1)
  })

  it('deletes outright when no month is supplied', async () => {
    queueFor('budgets', { data: null, error: null })

    await deleteBudget('b1')

    expect(callsFor('budgets', 'delete')).toHaveLength(1)
  })
})
