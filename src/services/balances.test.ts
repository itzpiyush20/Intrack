import { describe, it, expect } from 'vitest'
import {
  sumAvailableMoneyMovements,
  computeTodayOpening,
  type AvailableMoneyMovement,
} from './balances'

describe('Balances Service — Available Money calculation', () => {
  it('correctly deducts standard bank/UPI spend from available money', () => {
    const rows: AvailableMoneyMovement[] = [
      { amount: 500, type: 'debit', card_id: null },
      { amount: 1200, type: 'debit', card_id: null },
    ]
    const { net, unaccountedForeignCount } = sumAvailableMoneyMovements(rows)
    expect(net).toBe(-1700)
    expect(unaccountedForeignCount).toBe(0)
  })

  it('correctly adds standard income to available money', () => {
    const rows: AvailableMoneyMovement[] = [
      { amount: 50000, type: 'credit', card_id: null },
    ]
    const { net, unaccountedForeignCount } = sumAvailableMoneyMovements(rows)
    expect(net).toBe(50000)
    expect(unaccountedForeignCount).toBe(0)
  })

  it('ignores credit card spends and refunds for available bank money', () => {
    // Spends and refunds on a credit card sit on the card, not the bank.
    const rows: AvailableMoneyMovement[] = [
      { amount: 3500, type: 'debit', card_id: 'card-123' },
      { amount: 400, type: 'credit', card_id: 'card-123' },
    ]
    const { net, unaccountedForeignCount } = sumAvailableMoneyMovements(rows)
    expect(net).toBe(0)
    expect(unaccountedForeignCount).toBe(0)
  })

  it('deducts credit card bill payments from available bank money', () => {
    // When you pay a credit card bill, it leaves your bank to settle the card.
    // In database: card_id is null (money came from bank) and settles_card_id is the card settled.
    const rows: AvailableMoneyMovement[] = [
      {
        amount: 15000,
        type: 'debit',
        card_id: null,
        settles_card_id: 'card-123',
        category: 'Credit Card Bill',
      },
    ]
    const { net, unaccountedForeignCount } = sumAvailableMoneyMovements(rows)
    expect(net).toBe(-15000)
  })

  it('adds credit card cash advance / wallet withdrawal to available bank money', () => {
    // Per plans/accounts-and-balances.md:
    // A loan with source = 'credit_card' means money arrived into the bank from the card.
    // So bank money RISES, even though it also raises card outstanding.
    const rows: AvailableMoneyMovement[] = [
      {
        amount: 20000,
        type: 'credit',
        card_id: 'card-123',
        loan_source: 'credit_card',
        category: 'Loan',
      },
    ]
    const { net, unaccountedForeignCount } = sumAvailableMoneyMovements(rows)
    expect(net).toBe(20000)
  })

  it('adds bank / friend / other loans to available bank money', () => {
    const rows: AvailableMoneyMovement[] = [
      {
        amount: 10000,
        type: 'credit',
        card_id: null,
        loan_source: 'family_friend',
        category: 'Loan',
      },
    ]
    const { net, unaccountedForeignCount } = sumAvailableMoneyMovements(rows)
    expect(net).toBe(10000)
  })

  it('excludes foreign currency transactions and increments unaccountedForeignCount', () => {
    const rows: AvailableMoneyMovement[] = [
      { amount: 1000, type: 'debit', currency: 'INR', card_id: null },
      { amount: 25, type: 'debit', currency: 'USD', card_id: null },
      { amount: 10, type: 'credit', currency: 'EUR', card_id: null },
    ]
    const { net, unaccountedForeignCount } = sumAvailableMoneyMovements(rows)
    expect(net).toBe(-1000)
    expect(unaccountedForeignCount).toBe(2)
  })

  it('converts today balance to opening balance accurately', () => {
    // If today balance is 75,000 and net movement since 1st is +15,000 (earned 20k, spent 5k)
    // Opening balance on the 1st was 60,000.
    const opening = computeTodayOpening(75000, 15000)
    expect(opening).toBe(60000)

    // If today balance is 40,000 and net movement since 1st is -10,000 (spent 10k)
    // Opening balance on the 1st was 50,000.
    const openingSpent = computeTodayOpening(40000, -10000)
    expect(openingSpent).toBe(50000)
  })
})
