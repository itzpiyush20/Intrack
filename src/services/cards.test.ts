// ============================================
// Cards service — the arithmetic that turns "what it owes today" into the
// month opening the database stores.
//
// The signs here are the ones in plans/accounts-and-balances.md. Getting one
// backwards would make every card outstanding wrong in a way no test elsewhere
// would notice, which is why they are pinned here.
// ============================================

import { describe, it, expect } from 'vitest'
import { sumCardMovements, movesCardIdentity, todayKey, monthKey, type CardMovement } from './cards'

const row = (r: Partial<CardMovement>): CardMovement => ({
  amount: 0,
  type: 'debit',
  card_id: null,
  settles_card_id: null,
  loan_source: null,
  ...r,
})

describe('sumCardMovements', () => {
  it('raises the outstanding for a spend on the card', () => {
    expect(sumCardMovements([row({ card_id: 'a', amount: 500 })])).toEqual({ a: 500 })
  })

  it('lowers it for a refund back to the card', () => {
    expect(sumCardMovements([row({ card_id: 'a', amount: 200, type: 'credit' })])).toEqual({ a: -200 })
  })

  it('raises it for a cash advance, even though the money arrived', () => {
    // The one case where money in makes a card owe MORE. Without loan_source
    // this row is indistinguishable from a refund.
    expect(sumCardMovements([
      row({ card_id: 'a', amount: 1000, type: 'credit', loan_source: 'credit_card' }),
    ])).toEqual({ a: 1000 })
  })

  it('lowers the card a bill payment settles', () => {
    expect(sumCardMovements([row({ settles_card_id: 'a', amount: 750 })])).toEqual({ a: -750 })
  })

  it('ignores rows that name no card', () => {
    expect(sumCardMovements([row({ amount: 900 })])).toEqual({})
  })

  it('keeps each card separate and sums within one', () => {
    expect(sumCardMovements([
      row({ card_id: 'a', amount: 100 }),
      row({ card_id: 'a', amount: 50 }),
      row({ card_id: 'b', amount: 400 }),
      row({ settles_card_id: 'a', amount: 30 }),
    ])).toEqual({ a: 120, b: 400 })
  })
})

describe('movesCardIdentity', () => {
  // Only a move is guarded, and only for these two fields. Anything wrong here
  // either freezes a card the user should still be able to correct, or lets the
  // scanner's match key shift under existing history.
  it('sees a changed last4 as a move', () => {
    expect(movesCardIdentity({ last4: '1234' }, { last4: '1243' })).toBe(true)
  })

  it('sees a changed issuer as a move', () => {
    expect(movesCardIdentity({ issuer: 'HDFC' }, { issuer: 'Axis' })).toBe(true)
  })

  it('does not treat filling in a blank as a move', () => {
    // A card added before last4 was required must still be completable.
    expect(movesCardIdentity({ last4: null }, { last4: '1234' })).toBe(false)
    expect(movesCardIdentity({ issuer: '' }, { issuer: 'HDFC' })).toBe(false)
  })

  it('does not treat resaving the same value as a move', () => {
    // The edit form submits every field, so an unchanged one must not lock out
    // a rename the user actually asked for.
    expect(movesCardIdentity({ last4: '1234', issuer: 'HDFC' }, { last4: '1234', issuer: 'HDFC' })).toBe(false)
  })

  it('ignores fields the patch does not mention', () => {
    expect(movesCardIdentity({ last4: '1234', issuer: 'HDFC' }, {})).toBe(false)
  })

  it('counts clearing a value as a move', () => {
    // Blanking the issuer on a card that shares its digits with another is
    // exactly the ambiguity the rule is there to stop.
    expect(movesCardIdentity({ issuer: 'HDFC' }, { issuer: null })).toBe(true)
  })
})

describe('date keys', () => {
  it('reads the local date, not the UTC one', () => {
    // 23:30 IST on the 5th is already the 6th in UTC. Using the UTC date would
    // put a spend in the wrong month for anyone entering one late at night.
    const late = new Date(2026, 8, 5, 23, 30)
    expect(todayKey(late)).toBe('2026-09-05')
    expect(monthKey(late)).toBe('2026-09-01')
  })
})
