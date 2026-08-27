// src/context/DrillDownContext.test.ts
import { describe, it, expect } from 'vitest'
import { filterTransactionsForDrillDown, type DrillDownFilter } from './DrillDownContext'

interface Txn {
  id: string
  category: string
  date: string
}

const txns: Txn[] = [
  { id: '1', category: 'Food & Dining', date: '2026-08-05' },
  { id: '2', category: 'Food & Dining', date: '2026-07-20' },
  { id: '3', category: 'Groceries', date: '2026-08-05' },
  { id: '4', category: 'Food & Dining', date: '2026-08-10' },
]

describe('filterTransactionsForDrillDown', () => {
  it('filters by category and an explicit date range', () => {
    const filter: DrillDownFilter = { category: 'Food & Dining', dateFrom: '2026-08-01', dateTo: '2026-08-31' }
    const result = filterTransactionsForDrillDown(txns, filter)
    expect(result.map((t) => t.id)).toEqual(['1', '4'])
  })

  it('filters by category and a month prefix', () => {
    const filter: DrillDownFilter = { category: 'Food & Dining', month: '2026-07' }
    const result = filterTransactionsForDrillDown(txns, filter)
    expect(result.map((t) => t.id)).toEqual(['2'])
  })

  it('dateFrom/dateTo take precedence over month when both are given', () => {
    const filter: DrillDownFilter = { category: 'Food & Dining', month: '2026-07', dateFrom: '2026-08-01', dateTo: '2026-08-31' }
    const result = filterTransactionsForDrillDown(txns, filter)
    expect(result.map((t) => t.id)).toEqual(['1', '4'])
  })

  it('filters by category alone when no date constraint is given', () => {
    const filter: DrillDownFilter = { category: 'Groceries' }
    const result = filterTransactionsForDrillDown(txns, filter)
    expect(result.map((t) => t.id)).toEqual(['3'])
  })

  it('returns an empty array when nothing matches', () => {
    const filter: DrillDownFilter = { category: 'Travel' }
    expect(filterTransactionsForDrillDown(txns, filter)).toEqual([])
  })

  it('filters by merchant', () => {
    const merchantTxns = [
      { id: '1', category: 'Food & Dining', date: '2026-08-01', merchant: 'Zomato' },
      { id: '2', category: 'Food & Dining', date: '2026-08-02', merchant: 'Swiggy' },
      { id: '3', category: 'Shopping', date: '2026-08-03', merchant: 'Zomato' },
    ]
    const result = filterTransactionsForDrillDown(merchantTxns, { merchant: 'Zomato' })
    expect(result.map((t) => t.id)).toEqual(['1', '3'])
  })

  it('filters by categories (match-any) combined with a date range', () => {
    const catTxns = [
      { id: '1', category: 'Groceries', date: '2026-08-05' },
      { id: '2', category: 'Rent', date: '2026-08-05' },
      { id: '3', category: 'Shopping', date: '2026-08-05' },
      { id: '4', category: 'Groceries', date: '2026-07-01' },
    ]
    const result = filterTransactionsForDrillDown(catTxns, {
      categories: ['Groceries', 'Rent'],
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    })
    expect(result.map((t) => t.id)).toEqual(['1', '2'])
  })

  it('categories takes precedence over a single category field if both are somehow set', () => {
    const catTxns = [
      { id: '1', category: 'Groceries', date: '2026-08-05' },
      { id: '2', category: 'Rent', date: '2026-08-05' },
    ]
    const result = filterTransactionsForDrillDown(catTxns, { category: 'Groceries', categories: ['Rent'] })
    expect(result.map((t) => t.id)).toEqual(['2'])
  })
})

describe('filterTransactionsForDrillDown — merchant matches resolved identity', () => {
  // The Merchant Leaderboard groups by resolveTransactionIdentity().title, so the
  // filter has to as well. Matching the raw `merchant` column meant a bar reading
  // 500 opened a list totalling 200, and 'Unclassified' opened nothing at all.
  const txns = [
    { id: '1', category: 'Food', date: '2026-08-01', merchant: 'Swiggy', description: 'Swiggy order' },
    { id: '2', category: 'Food', date: '2026-08-02', merchant: null, description: 'UPI/4412/SWIGGY-ORDER-BLR' },
    { id: '3', category: 'Other', date: '2026-08-03', merchant: null, description: 'IMPS/1/JOHN DOE' },
    { id: '4', category: 'Other', date: '2026-08-04', merchant: null, description: 'NEFT/2/JANE DOE' },
  ]

  it('folds a brand recognised in the narration under its real merchant', () => {
    const result = filterTransactionsForDrillDown(txns, { merchant: 'Swiggy' })
    expect(result.map((t) => t.id)).toEqual(['1', '2'])
  })

  it('resolves the Unclassified bucket instead of returning nothing', () => {
    const result = filterTransactionsForDrillDown(txns, { merchant: 'Unclassified' })
    expect(result.map((t) => t.id)).toEqual(['3', '4'])
  })
})

describe('filterTransactionsForDrillDown — excludeCategories', () => {
  const txns = [
    { id: '1', category: 'Food & Dining', date: '2026-08-05' },
    { id: '2', category: 'Credit Card Bill Payment', date: '2026-08-06' },
    { id: '3', category: 'Groceries', date: '2026-08-07' },
  ]

  it('drops rows the chart pool had already removed', () => {
    const result = filterTransactionsForDrillDown(txns, {
      excludeCategories: ['Credit Card Bill Payment'],
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
    })
    expect(result.map((t) => t.id)).toEqual(['1', '3'])
  })

  it('is a no-op when the list is empty', () => {
    const result = filterTransactionsForDrillDown(txns, { excludeCategories: [] })
    expect(result.map((t) => t.id)).toEqual(['1', '2', '3'])
  })
})
