import { describe, it, expect, vi, beforeEach } from 'vitest'

type Result = { data?: unknown; error?: unknown }

const queue: Record<string, Result[]> = {}
let calls: Array<{ table: string; method: string; args: unknown[] }> = []

const BUILDER_METHODS = [
  'select', 'eq', 'or', 'order', 'limit', 'upsert', 'update', 'delete', 'insert', 'single',
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
  calculateDebtSummary,
  resolveLoanSource,
  getActiveDebts,
  recordDebtTransaction,
  LOAN_SOURCE_LABELS,
  type DebtTransactionItem,
} from './debts'

function queueFor(table: string, ...results: Result[]) {
  queue[table] = results
}

beforeEach(() => {
  calls = []
  for (const k of Object.keys(queue)) delete queue[k]
  mockGetUser.mockReset()
  mockGetUser.mockResolvedValue({ data: { user: { id: 'user-debts-1' } } })
})

describe('resolveLoanSource', () => {
  it('identifies explicit loan sources correctly', () => {
    expect(resolveLoanSource({ loan_source: 'bank' })).toBe('bank')
    expect(resolveLoanSource({ loan_source: 'credit_card' })).toBe('credit_card')
    expect(resolveLoanSource({ loan_source: 'family_friend' })).toBe('family_friend')
    expect(resolveLoanSource({ loan_source: 'other' })).toBe('other')
  })

  it('falls back to "other" for category Loan when loan_source is missing', () => {
    expect(resolveLoanSource({ category: 'Loan' })).toBe('other')
    expect(resolveLoanSource({ category: 'loan' })).toBe('other')
  })

  it('falls back to "bank" when event_type is loan_repayment', () => {
    expect(resolveLoanSource({ event_type: 'loan_repayment' })).toBe('bank')
  })

  it('returns null for unrelated transactions', () => {
    expect(resolveLoanSource({ category: 'Food', event_type: 'debit' })).toBeNull()
  })
})

describe('calculateDebtSummary', () => {
  it('accurately aggregates borrowed vs repaid across all 4 loan sources', () => {
    const transactions: DebtTransactionItem[] = [
      // Bank: borrowed 50,000, repaid 10,000 -> 40,000 outstanding
      {
        id: '1',
        amount: 50000,
        type: 'credit',
        date: '2026-08-01',
        category: 'Loan',
        description: 'Personal Loan',
        loan_source: 'bank',
      },
      {
        id: '2',
        amount: 10000,
        type: 'debit',
        date: '2026-08-15',
        category: 'Loan',
        description: 'EMI 1',
        loan_source: 'bank',
      },
      // Credit card: borrowed 20,000, repaid 5,000 -> 15,000 outstanding
      {
        id: '3',
        amount: 20000,
        type: 'credit',
        date: '2026-08-05',
        category: 'Loan',
        description: 'Cash advance',
        loan_source: 'credit_card',
      },
      {
        id: '4',
        amount: 5000,
        type: 'debit',
        date: '2026-08-20',
        category: 'Loan',
        description: 'Advance payback',
        loan_source: 'credit_card',
      },
      // Family / friend: borrowed 15,000, repaid 15,000 -> 0 outstanding
      {
        id: '5',
        amount: 15000,
        type: 'credit',
        date: '2026-08-10',
        category: 'Loan',
        description: 'Borrow from Amit',
        loan_source: 'family_friend',
      },
      {
        id: '6',
        amount: 15000,
        type: 'debit',
        date: '2026-08-25',
        category: 'Loan',
        description: 'Repay Amit',
        loan_source: 'family_friend',
      },
      // Other: borrowed 5,000, repaid 0 -> 5,000 outstanding
      {
        id: '7',
        amount: 5000,
        type: 'credit',
        date: '2026-08-12',
        category: 'Loan',
        description: 'Peer loan',
        loan_source: 'other',
      },
    ]

    const summary = calculateDebtSummary(transactions)

    // Bank
    expect(summary.sources.bank.borrowed).toBe(50000)
    expect(summary.sources.bank.repaid).toBe(10000)
    expect(summary.sources.bank.outstanding).toBe(40000)
    expect(summary.sources.bank.transactionCount).toBe(2)

    // Credit Card
    expect(summary.sources.credit_card.borrowed).toBe(20000)
    expect(summary.sources.credit_card.repaid).toBe(5000)
    expect(summary.sources.credit_card.outstanding).toBe(15000)
    expect(summary.sources.credit_card.transactionCount).toBe(2)

    // Family / Friend
    expect(summary.sources.family_friend.borrowed).toBe(15000)
    expect(summary.sources.family_friend.repaid).toBe(15000)
    expect(summary.sources.family_friend.outstanding).toBe(0)
    expect(summary.sources.family_friend.transactionCount).toBe(2)

    // Other
    expect(summary.sources.other.borrowed).toBe(5000)
    expect(summary.sources.other.repaid).toBe(0)
    expect(summary.sources.other.outstanding).toBe(5000)
    expect(summary.sources.other.transactionCount).toBe(1)

    // Total metrics
    expect(summary.totalBorrowed).toBe(90000)
    expect(summary.totalRepaid).toBe(30000)
    expect(summary.totalOutstanding).toBe(60000) // 40,000 + 15,000 + 0 + 5,000
    expect(summary.bySourceList).toHaveLength(4)
  })

  it('clamps outstanding to 0 if repayments exceed borrowings', () => {
    const transactions: DebtTransactionItem[] = [
      {
        id: '1',
        amount: 5000,
        type: 'credit',
        date: '2026-08-01',
        category: 'Loan',
        description: 'Loan',
        loan_source: 'family_friend',
      },
      {
        id: '2',
        amount: 6000, // Repaid with interest or extra
        type: 'debit',
        date: '2026-08-15',
        category: 'Loan',
        description: 'Payback with interest',
        loan_source: 'family_friend',
      },
    ]

    const summary = calculateDebtSummary(transactions)
    expect(summary.sources.family_friend.outstanding).toBe(0)
    expect(summary.totalOutstanding).toBe(0)
  })

  it('handles empty transaction list gracefully', () => {
    const summary = calculateDebtSummary([])
    expect(summary.totalBorrowed).toBe(0)
    expect(summary.totalRepaid).toBe(0)
    expect(summary.totalOutstanding).toBe(0)
    expect(summary.sources.bank.outstanding).toBe(0)
    expect(summary.sources.credit_card.outstanding).toBe(0)
    expect(summary.sources.family_friend.outstanding).toBe(0)
    expect(summary.sources.other.outstanding).toBe(0)
  })
})

describe('getActiveDebts', () => {
  it('queries Supabase and returns calculated active debt summary', async () => {
    queueFor('transactions', {
      data: [
        {
          id: 't1',
          amount: 25000,
          type: 'credit',
          date: '2026-08-10',
          category: 'Loan',
          description: 'Friend advance',
          loan_source: 'family_friend',
          loan_source_note: 'Amit',
          approval_status: 'approved',
        },
        {
          id: 't2',
          amount: 10000,
          type: 'debit',
          date: '2026-08-20',
          category: 'Loan',
          description: 'Partial payback',
          loan_source: 'family_friend',
          loan_source_note: 'Amit',
          approval_status: 'approved',
        },
      ],
      error: null,
    })

    const { data, error } = await getActiveDebts()

    expect(error).toBeNull()
    expect(data).not.toBeNull()
    expect(data?.totalBorrowed).toBe(25000)
    expect(data?.totalRepaid).toBe(10000)
    expect(data?.totalOutstanding).toBe(15000)
    expect(data?.sources.family_friend.outstanding).toBe(15000)
  })

  it('returns error when user is unauthenticated', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null } })

    const { data, error } = await getActiveDebts()
    expect(data).toBeNull()
    expect(error).toBeInstanceOf(Error)
  })
})

describe('recordDebtTransaction', () => {
  it('inserts approved loan transaction into Supabase', async () => {
    queueFor('transactions', {
      data: {
        id: 'new-txn-1',
        amount: 30000,
        type: 'credit',
        category: 'Loan',
        description: 'Bank Personal Loan',
        loan_source: 'bank',
        approval_status: 'approved',
      },
      error: null,
    })

    const { data, error } = await recordDebtTransaction({
      type: 'credit',
      amount: 30000,
      loan_source: 'bank',
      description: 'Bank Personal Loan',
      date: '2026-09-01',
    })

    expect(error).toBeNull()
    expect(data?.id).toBe('new-txn-1')
  })
})
