import { describe, it, expect } from 'vitest'
import { buildRestoreRow, buildDedupKey, selectRowsToRestore } from './backupRestore'

// A row as handleBackup writes it: the whole transactions row, every column
// populated, so a dropped field shows up as a missing value rather than as a
// null that might have been null anyway.
const fullBackupRow = {
  id: 'row-from-another-database',
  user_id: 'the-old-account',
  amount: '1250.50',
  type: 'debit',
  category: 'Food',
  description: 'Dinner',
  notes: 'split with A',
  date: '2026-03-04',
  source: 'email',
  approval_status: 'pending',
  reference_id: 'REF123',
  merchant: 'Swiggy',
  currency: 'USD',
  payment_mode: 'upi',
  card_issuer: 'HDFC',
  card_brand: 'Visa',
  transaction_time: '19:42',
  confidence_score: 88,
  email_message_id: 'msg-1',
  event_type: 'purchase',
  tags: ['work'],
  is_returnable: true,
  counterparty: 'Anita',
  expected_return_date: '2026-04-01',
  return_status: 'pending',
  settled_by_transaction_id: 'some-other-row',
  created_at: '2026-03-04T19:42:00Z',
  updated_at: '2026-03-04T19:42:00Z',
}

describe('buildRestoreRow', () => {
  it('carries back every field the user would notice losing', () => {
    const restored = buildRestoreRow(fullBackupRow, 'the-new-account')

    // The regression this file exists for. The restore used to name eleven
    // fields and silently drop the rest, so each of these was lost on every
    // restore. Listed one by one rather than as a snapshot: a snapshot would
    // happily record a future field going missing as the new expected value.
    expect(restored.currency).toBe('USD')
    expect(restored.payment_mode).toBe('upi')
    expect(restored.card_issuer).toBe('HDFC')
    expect(restored.card_brand).toBe('Visa')
    expect(restored.transaction_time).toBe('19:42')
    expect(restored.confidence_score).toBe(88)
    expect(restored.email_message_id).toBe('msg-1')
    expect(restored.event_type).toBe('purchase')
    expect(restored.tags).toEqual(['work'])
    expect(restored.is_returnable).toBe(true)
    expect(restored.counterparty).toBe('Anita')
    expect(restored.expected_return_date).toBe('2026-04-01')
    expect(restored.return_status).toBe('pending')

    // And the fields that always worked still do.
    expect(restored.amount).toBe(1250.5)
    expect(restored.type).toBe('debit')
    expect(restored.category).toBe('Food')
    expect(restored.description).toBe('Dinner')
    expect(restored.notes).toBe('split with A')
    expect(restored.date).toBe('2026-03-04')
    expect(restored.source).toBe('email')
    expect(restored.approval_status).toBe('pending')
    expect(restored.reference_id).toBe('REF123')
    expect(restored.merchant).toBe('Swiggy')
  })

  it('a foreign currency does not come back as rupees', () => {
    // The quietest form of the bug: the number survives, its meaning does not,
    // and nothing on screen looks wrong afterwards.
    expect(buildRestoreRow({ ...fullBackupRow, currency: 'USD' }, 'u').currency).toBe('USD')
  })

  it('defaults currency to INR for a backup taken before the column existed', () => {
    const { currency, ...withoutCurrency } = fullBackupRow
    void currency
    expect(buildRestoreRow(withoutCurrency, 'u').currency).toBe('INR')
  })

  it('always attributes the row to the restoring account, never to the file', () => {
    const restored = buildRestoreRow(fullBackupRow, 'the-new-account')
    expect(restored.user_id).toBe('the-new-account')
  })

  it('does not copy keys that belong to the old database', () => {
    const restored = buildRestoreRow(fullBackupRow, 'u') as Record<string, unknown>
    // id would collide on the primary key; settled_by_transaction_id points at
    // a row that no longer exists and the foreign key would reject it;
    // created_at/updated_at should record the restore, not the original write.
    expect(restored).not.toHaveProperty('id')
    expect(restored).not.toHaveProperty('settled_by_transaction_id')
    expect(restored).not.toHaveProperty('created_at')
    expect(restored).not.toHaveProperty('updated_at')
  })

  it('ignores arbitrary keys in a tampered or corrupt file', () => {
    // The file is user-supplied. An allowlist, not a spread.
    const restored = buildRestoreRow(
      { ...fullBackupRow, is_admin: true, subscription_status: 'active' },
      'u'
    ) as Record<string, unknown>
    expect(restored).not.toHaveProperty('is_admin')
    expect(restored).not.toHaveProperty('subscription_status')
  })

  it('coerces a malformed tags value rather than posting it', () => {
    expect(buildRestoreRow({ ...fullBackupRow, tags: 'work' }, 'u').tags).toEqual([])
    expect(buildRestoreRow({ ...fullBackupRow, tags: undefined }, 'u').tags).toEqual([])
  })

  it('treats a missing is_returnable as false, not as undefined', () => {
    const { is_returnable, ...without } = fullBackupRow
    void is_returnable
    expect(buildRestoreRow(without, 'u').is_returnable).toBe(false)
  })
})

describe('buildDedupKey', () => {
  it('matches the same transaction across casing and whitespace', () => {
    expect(buildDedupKey({ date: '2026-03-04', amount: 100, merchant: ' Swiggy ', description: 'Dinner' }))
      .toBe(buildDedupKey({ date: '2026-03-04', amount: '100', merchant: 'swiggy', description: 'dinner' }))
  })

  it('separates transactions that differ on amount', () => {
    expect(buildDedupKey({ date: '2026-03-04', amount: 100, merchant: 'A' }))
      .not.toBe(buildDedupKey({ date: '2026-03-04', amount: 101, merchant: 'A' }))
  })
})

describe('selectRowsToRestore', () => {
  const existing = [
    { date: '2026-03-04', amount: 100, merchant: 'Swiggy', description: 'Dinner', email_message_id: 'msg-1' },
  ]

  it('skips a row the account already holds', () => {
    const result = selectRowsToRestore(
      [{ date: '2026-03-04', amount: 100, merchant: 'Swiggy', description: 'Dinner' }],
      existing
    )
    expect(result).toHaveLength(0)
  })

  it('restores a row the account does not have', () => {
    const result = selectRowsToRestore(
      [{ date: '2026-03-05', amount: 250, merchant: 'Zomato', description: 'Lunch' }],
      existing
    )
    expect(result).toHaveLength(1)
  })

  it('skips a row whose email_message_id is already present even when its text was edited', () => {
    // Without this the batch insert hits UNIQUE (email_message_id, user_id)
    // and a single stale row fails the user's entire restore with a 23505.
    const result = selectRowsToRestore(
      [{ date: '2026-03-04', amount: 100, merchant: 'Swiggy', description: 'Dinner with A', email_message_id: 'msg-1' }],
      existing
    )
    expect(result).toHaveLength(0)
  })

  it('does not treat two manual rows without an email id as duplicates of each other', () => {
    const result = selectRowsToRestore(
      [
        { date: '2026-03-06', amount: 10, merchant: 'A', description: 'x', email_message_id: null },
        { date: '2026-03-07', amount: 20, merchant: 'B', description: 'y', email_message_id: null },
      ],
      existing
    )
    expect(result).toHaveLength(2)
  })
})
