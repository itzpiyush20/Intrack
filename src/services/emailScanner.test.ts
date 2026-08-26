// src/services/emailScanner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractCardLast4, extractEmailBody, HARD_ACCEPT_SUBJECT_PATTERNS } from './emailScanner.js'
import { extractAmountMatches } from './currency.js'
import { makeAxisEmiGmailMessage } from './__fixtures__/axisEmiDebit'
import { makeUberTripGmailMessage } from './__fixtures__/uberTripReceipt'
import { makeUnknownVendorGmailMessage } from './__fixtures__/unknownVendorReceipt'
import { makeZomatoOrderGmailMessage } from './__fixtures__/zomatoOrderReceipt'
import { makeBusinessStandardGmailMessage } from './__fixtures__/businessStandardNewsletter'
import { makeBulkProseGmailMessage } from './__fixtures__/bulkMailWithPaymentProse'
import { makeBankMarketingGmailMessage } from './__fixtures__/bankMarketingFromTrustedSender'
import { makeRefundGmailMessage, makePremiumGmailMessage } from './__fixtures__/refundAndPremium'

vi.mock('./googleAuth', () => ({
  getGoogleToken: () => 'fake-access-token',
  clearGoogleToken: () => {},
  tryRefreshGoogleToken: async () => null,
}))

// No merchant rules stored for these users, so every email falls through to
// the local applyMerchantRules heuristics — the same outcome the previous
// mock forced by making the DB lookup throw. applyMerchantRulesFromRows is
// left as the real implementation because that fall-through IS the behaviour
// under test.
vi.mock('./learningEngine', async () => {
  const actual = await vi.importActual<typeof import('./learningEngine')>('./learningEngine')
  return { ...actual, getMerchantRulesFromDB: async () => [] }
})

function makeTableMock(response: any, opts: { insertCapture?: any[] } = {}) {
  const handler: any = {
    select: () => handler,
    eq: () => handler,
    order: () => handler,
    limit: () => handler,
    gte: () => handler,
    single: () => Promise.resolve(response),
    insert: (row: any) => {
      opts.insertCapture?.push(row)
      return {
        select: () => ({ single: () => Promise.resolve(response) }),
        then: (resolve: any) => resolve(response),
      }
    },
    then: (resolve: any) => resolve(response),
  }
  return handler
}

/** Shared across the "no debit/credit keyword" and "low confidence" test groups below. */
function makeMockDb(insertedTransactions: any[], insertedRejections: any[]): any {
  const makeTableMock = (response: any, opts: { insertCapture?: any[] } = {}) => {
    const handler: any = {
      select: () => handler, eq: () => handler, order: () => handler, limit: () => handler, gte: () => handler,
      single: () => Promise.resolve(response),
      insert: (row: any) => {
        opts.insertCapture?.push(row)
        return { select: () => ({ single: () => Promise.resolve(response) }), then: (resolve: any) => resolve(response) }
      },
      then: (resolve: any) => resolve(response),
    }
    return handler
  }
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } } }) },
    from: (table: string) => {
      if (table === 'profiles') return makeTableMock({ data: null, error: null })
      if (table === 'email_scan_logs') return makeTableMock({ data: [], error: null })
      if (table === 'cards') return makeTableMock({ data: [], error: null })
      if (table === 'transactions') return makeTableMock({ data: [], error: null }, { insertCapture: insertedTransactions })
      if (table === 'categories') return makeTableMock({ data: [{ name: 'Transport', is_permanent: false }, { name: 'Food & Dining', is_permanent: false }, { name: 'Other', is_permanent: true }], error: null })
      if (table === 'email_scan_rejections') return makeTableMock({ error: null }, { insertCapture: insertedRejections })
      return makeTableMock({ data: [], error: null })
    },
  }
}

describe('scanRealGmailInbox — Axis EMI debit regression', () => {
  const insertedTransactions: any[] = []
  const insertedRejections: any[] = []

  let mockDb: any

  beforeEach(() => {
    insertedTransactions.length = 0
    insertedRejections.length = 0

    mockDb = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } },
        }),
      },
      from: (table: string) => {
        if (table === 'profiles') return makeTableMock({ data: null, error: null })
        if (table === 'email_scan_logs') return makeTableMock({ data: [], error: null })
        if (table === 'cards') return makeTableMock({ data: [], error: null })
        if (table === 'transactions') {
          return makeTableMock({ data: [], error: null }, { insertCapture: insertedTransactions })
        }
        if (table === 'categories') {
          return makeTableMock({
            data: [
              { name: 'Food & Dining', is_permanent: false },
              { name: 'Groceries', is_permanent: false },
              { name: 'Other', is_permanent: true },
            ],
            error: null,
          })
        }
        if (table === 'email_scan_rejections') {
          return makeTableMock({ error: null }, { insertCapture: insertedRejections })
        }
        return makeTableMock({ data: [], error: null })
      },
    }

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'msg-axis-emi-1', threadId: 'thread-axis-emi-1' }] }),
        } as any
      }
      if (url.includes('/messages/msg-axis-emi-1')) {
        return { ok: true, status: 200, json: async () => makeAxisEmiGmailMessage() } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
  })

  it('captures the Axis EMI debit email as a transaction (amount, direction, event type)', async () => {
    const { scanRealGmailInbox } = await import('./emailScanner')

    const result = await scanRealGmailInbox({
      db: mockDb,
      // Force the AI path to fail so this test exercises the regex
      // fallback path — the one that was silently dropping this email.
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    expect(insertedTransactions).toHaveLength(1)
    const txn = insertedTransactions[0][0]
    expect(txn.amount).toBe(42293)
    expect(txn.type).toBe('debit')
    expect(txn.event_type).toBe('emi')
  })
})

describe('scanRealGmailInbox — fetch query includes receipt-shaped keywords', () => {
  it('builds a Gmail query that matches both bank-alert and generic receipt language', async () => {
    let capturedUrl = ''
    const mockDb: any = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } },
        }),
      },
      from: (_table: string) => {
        const handler: any = {
          select: () => handler, eq: () => handler, order: () => handler, limit: () => handler, gte: () => handler,
          single: () => Promise.resolve({ data: null, error: null }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }), then: (r: any) => r({ data: [], error: null }) }),
          then: (resolve: any) => resolve({ data: [], error: null }),
        }
        return handler
      },
    }

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        capturedUrl = url
        return { ok: true, status: 200, json: async () => ({ messages: [] }) } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    const decodedQuery = decodeURIComponent(capturedUrl.match(/[?&]q=([^&]+)/)?.[1] || '')
    expect(decodedQuery).toMatch(/debited\b.*credited/i)
    expect(decodedQuery).toMatch(/receipt OR invoice OR order OR booking OR trip OR fare OR ride OR subscription OR renewal OR total/i)
  })
})

describe('scanRealGmailInbox — receipt-shaped emails with no debit/credit keyword', () => {
  it('inserts the Uber trip receipt as pending instead of dropping it, and logs why', async () => {
    const insertedTransactions: any[] = []
    const insertedRejections: any[] = []
    const mockDb = makeMockDb(insertedTransactions, insertedRejections)

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-uber-trip-1', threadId: 'thread-uber-trip-1' }] }) } as any
      if (url.includes('/messages/msg-uber-trip-1')) return { ok: true, status: 200, json: async () => makeUberTripGmailMessage() } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(result.error).toBeNull()
    expect(insertedTransactions).toHaveLength(1)
    const txn = insertedTransactions[0][0]
    // Regression check: the fixture has both "Total ₹224.76" and a
    // "Payments" section header sitting right above "Suggested fare
    // ₹214.76". Before the txKeywordsRe fix, the literal substring
    // "payment" inside "Payments" false-matched as a transaction keyword,
    // and its proximity to 214.76 made the amount-selection heuristic
    // pick the suggested fare instead of the actual total. This asserts
    // the correct total (224.76) wins, not the false-matched 214.76.
    expect(txn.amount).toBe(224.76)
    expect(txn.type).toBe('debit')
    expect(txn.approval_status).toBe('pending')

    expect(insertedRejections.flat().some((r: any) => r.gate === 'no_debit_credit_signal')).toBe(true)
  })

  it('inserts a receipt from a wholly unrecognized vendor as pending (not list-dependent)', async () => {
    const insertedTransactions: any[] = []
    const insertedRejections: any[] = []
    const mockDb = makeMockDb(insertedTransactions, insertedRejections)

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-unknown-vendor-1', threadId: 'thread-unknown-vendor-1' }] }) } as any
      if (url.includes('/messages/msg-unknown-vendor-1')) return { ok: true, status: 200, json: async () => makeUnknownVendorGmailMessage() } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(result.error).toBeNull()
    expect(insertedTransactions).toHaveLength(1)
    const txn = insertedTransactions[0][0]
    expect(txn.amount).toBe(120)
    expect(txn.type).toBe('debit')
    expect(txn.approval_status).toBe('pending')
  })

  it('inserts the Zomato order receipt end-to-end (stripped footer survives the OTP gate, "Total paid" gives a clear debit signal)', async () => {
    const insertedTransactions: any[] = []
    const insertedRejections: any[] = []
    const mockDb = makeMockDb(insertedTransactions, insertedRejections)

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-zomato-order-1', threadId: 'thread-zomato-order-1' }] }) } as any
      if (url.includes('/messages/msg-zomato-order-1')) return { ok: true, status: 200, json: async () => makeZomatoOrderGmailMessage() } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(result.error).toBeNull()
    expect(insertedTransactions).toHaveLength(1)
    const txn = insertedTransactions[0][0]
    expect(txn.amount).toBe(286.47)
    expect(txn.type).toBe('debit')
    expect(txn.approval_status).toBe('pending')
    // This email's own debit signal ("Total paid") is clear on its own —
    // it should NOT need the no_debit_credit_signal fallback from this task.
    expect(insertedRejections.flat().some((r: any) => r.gate === 'no_debit_credit_signal')).toBe(false)
  })

  it('still rejects a promotional email even though the fetch query and pending-floor are both wider now', async () => {
    const insertedTransactions: any[] = []
    const insertedRejections: any[] = []
    const mockDb = makeMockDb(insertedTransactions, insertedRejections)

    function toBase64Url(text: string): string {
      return Buffer.from(text, 'utf-8').toString('base64url')
    }
    const promoBody = 'Get cashback on your next Zomato order! Limited period offer, shop now. Total savings up to ₹200.'
    const promoMessage = {
      id: 'msg-promo-1',
      threadId: 'thread-promo-1',
      snippet: 'Get cashback on your next Zomato order!',
      // RELATIVE, never a fixed date. This was `Date.UTC(2026, 7, 10)`, which
      // sat inside the default 7-day scan window when the test was written and
      // fell outside it a week later. Out-of-window mail is skipped by a bare
      // `continue` with no rejection logged — deliberately, since it is not junk,
      // just old — so the email stopped being evaluated at all. The gate
      // assertion below then failed, and worse, the `toHaveLength(0)` above
      // started passing for the wrong reason: nothing was inserted because
      // nothing was examined. A guardrail that silently stops guarding is worse
      // than one that fails loudly. Matches the convention used by every other
      // fixture in this file.
      internalDate: String(Date.now() - 2 * 24 * 60 * 60 * 1000),
      payload: {
        headers: [
          { name: 'Subject', value: 'Exclusive cashback offer just for you' },
          { name: 'From', value: 'Zomato <noreply@zomato.com>' },
        ],
        mimeType: 'text/plain',
        body: { data: toBase64Url(promoBody) },
      },
    }

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-promo-1', threadId: 'thread-promo-1' }] }) } as any
      if (url.includes('/messages/msg-promo-1')) return { ok: true, status: 200, json: async () => promoMessage } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(insertedTransactions).toHaveLength(0)
    // The subject itself ("...offer...") trips the hard_reject_subject
    // gate before evaluateRegexGates (and its promotional_spam check) is
    // ever reached — that's the actual (correct, pre-existing) gate that
    // fires here, not promotional_spam. Either way the email is rejected
    // and logged, which is what this guardrail test cares about.
    expect(insertedRejections.flat().some((r: any) => r.gate === 'hard_reject_subject')).toBe(true)
  })
})

describe('scanRealGmailInbox — low regex confidence inserts pending, not dropped', () => {
  it('inserts the Uber receipt (untrusted sender, no reference id) as pending despite scoring below 65', async () => {
    const insertedTransactions: any[] = []
    const insertedRejections: any[] = []
    const mockDb = makeMockDb(insertedTransactions, insertedRejections)

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-uber-trip-1', threadId: 'thread-uber-trip-1' }] }) } as any
      if (url.includes('/messages/msg-uber-trip-1')) return { ok: true, status: 200, json: async () => makeUberTripGmailMessage() } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(insertedTransactions).toHaveLength(1)
    const txn = insertedTransactions[0][0]
    expect(txn.approval_status).toBe('pending')
    expect(txn.confidence_score).toBeLessThan(65)
    expect(insertedRejections.flat().some((r: any) => r.gate === 'confidence_below_65')).toBe(true)
    expect(result.data?.lowConfidencePendingCount).toBeGreaterThanOrEqual(1)
  })
})

describe('scanRealGmailInbox — newsletter false positives', () => {
  const insertedTransactions: any[] = []
  const insertedRejections: any[] = []
  let mockDb: any

  beforeEach(() => {
    insertedTransactions.length = 0
    insertedRejections.length = 0
    mockDb = makeMockDb(insertedTransactions, insertedRejections)
  })

  it('rejects a subscription-advertisement newsletter without calling the AI', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-bs-newsletter-1', threadId: 'thread-bs-newsletter-1' }] }) } as any
      }
      if (url.includes('/messages/msg-bs-newsletter-1')) {
        return { ok: true, status: 200, json: async () => makeBusinessStandardGmailMessage() } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const askAISpy = vi.fn(async () => null)
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: askAISpy as any })

    expect(result.error).toBeNull()
    expect(insertedTransactions).toHaveLength(0)
    // The quota-preservation guarantee: junk must not reach the AI at all.
    expect(askAISpy).not.toHaveBeenCalled()
    const gates = insertedRejections.flat().map((r: any) => r.gate)
    expect(gates).toContain('bulk_mail_no_payment_evidence')
  })

  it('rejects bulk mail whose payment language is far from the amount', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-bulk-prose-1', threadId: 'thread-bulk-prose-1' }] }) } as any
      }
      if (url.includes('/messages/msg-bulk-prose-1')) {
        return { ok: true, status: 200, json: async () => makeBulkProseGmailMessage() } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(result.error).toBeNull()
    expect(insertedTransactions).toHaveLength(0)
    const gates = insertedRejections.flat().map((r: any) => r.gate)
    expect(gates).toContain('bulk_mail_no_payment_near_amount')
  })
})

describe('scanRealGmailInbox — trusted-sender marketing', () => {
  it('rejects marketing from a trusted bank domain (no more exemption)', async () => {
    const insertedTransactions: any[] = []
    const insertedRejections: any[] = []
    const mockDb = makeMockDb(insertedTransactions, insertedRejections)

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-bank-marketing-1', threadId: 'thread-bank-marketing-1' }] }) } as any
      }
      if (url.includes('/messages/msg-bank-marketing-1')) {
        return { ok: true, status: 200, json: async () => makeBankMarketingGmailMessage() } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(result.error).toBeNull()
    expect(insertedTransactions).toHaveLength(0)
    const gates = insertedRejections.flat().map((r: any) => r.gate)
    expect(gates).toContain('bulk_mail_no_payment_evidence')
  })
})

describe('scanRealGmailInbox — genuine receipts still detected (regression)', () => {
  const cases = [
    { name: 'Uber trip receipt', id: 'msg-uber-trip-1', make: makeUberTripGmailMessage },
    { name: 'Zomato order receipt', id: 'msg-zomato-order-1', make: makeZomatoOrderGmailMessage },
    { name: 'unknown vendor receipt', id: 'msg-unknown-vendor-1', make: makeUnknownVendorGmailMessage },
  ]

  for (const c of cases) {
    it(`still inserts a pending transaction for the ${c.name}`, async () => {
      const insertedTransactions: any[] = []
      const insertedRejections: any[] = []
      const mockDb = makeMockDb(insertedTransactions, insertedRejections)

      global.fetch = vi.fn(async (url: string) => {
        if (url.includes('/messages?')) {
          return { ok: true, status: 200, json: async () => ({ messages: [{ id: c.id, threadId: `thread-${c.id}` }] }) } as any
        }
        if (url.includes(`/messages/${c.id}`)) {
          return { ok: true, status: 200, json: async () => c.make() } as any
        }
        throw new Error(`Unexpected fetch URL in test: ${url}`)
      }) as any

      const { scanRealGmailInbox } = await import('./emailScanner')
      const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

      expect(result.error).toBeNull()
      expect(insertedTransactions).toHaveLength(1)
      expect(insertedTransactions[0][0].approval_status).toBe('pending')
    })
  }
})

describe('scanRealGmailInbox — transient fetch failure handling', () => {
  it('retries a message fetch that returns 429 and succeeds on a later attempt', async () => {
    const insertedTransactions: any[] = []
    const insertedRejections: any[] = []
    const mockDb = makeMockDb(insertedTransactions, insertedRejections)

    let messageFetchAttempts = 0
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-axis-emi-1', threadId: 'thread-axis-emi-1' }] }) } as any
      }
      if (url.includes('/messages/msg-axis-emi-1')) {
        messageFetchAttempts++
        if (messageFetchAttempts < 3) {
          return { ok: false, status: 429, json: async () => ({}) } as any
        }
        return { ok: true, status: 200, json: async () => makeAxisEmiGmailMessage() } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(result.error).toBeNull()
    expect(messageFetchAttempts).toBe(3)
    expect(insertedTransactions).toHaveLength(1)
  })

  it('logs a fetch_failed rejection and drops the message when retries exhaust', async () => {
    const insertedTransactions: any[] = []
    const insertedRejections: any[] = []
    const mockDb = makeMockDb(insertedTransactions, insertedRejections)

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-axis-emi-1', threadId: 'thread-axis-emi-1' }] }) } as any
      }
      if (url.includes('/messages/msg-axis-emi-1')) {
        return { ok: false, status: 429, json: async () => ({}) } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(result.error).toBeNull()
    expect(insertedTransactions).toHaveLength(0)
    const gates = insertedRejections.flat().map((r: any) => r.gate)
    expect(gates).toContain('fetch_failed')
  }, 15000)
})

describe('scanRealGmailInbox — batch insert fault isolation', () => {
  it('falls back to per-row insert when the batch hits a unique-constraint conflict, keeping the non-conflicting rows', async () => {
    const insertedRejections: any[] = []
    let batchInsertAttempted = false
    const perRowInserted: any[] = []

    const mockDb: any = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } } }) },
      from: (table: string) => {
        const baseHandler: any = {
          select: () => baseHandler,
          eq: () => baseHandler,
          order: () => baseHandler,
          limit: () => baseHandler,
          gte: () => baseHandler,
          single: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: any) => resolve({ data: [], error: null }),
        }
        if (table === 'profiles') return baseHandler
        if (table === 'email_scan_logs') {
          return {
            ...baseHandler,
            insert: (row: any) => ({ select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }),
          }
        }
        if (table === 'cards') return baseHandler
        if (table === 'categories') return { ...baseHandler, then: (resolve: any) => resolve({ data: [{ name: 'Food & Dining', is_permanent: false }, { name: 'Other', is_permanent: true }], error: null }) }
        if (table === 'email_scan_rejections') {
          return { ...baseHandler, insert: (row: any) => { insertedRejections.push(row); return Promise.resolve({ error: null }) } }
        }
        if (table === 'transactions') {
          return {
            ...baseHandler,
            insert: (rows: any) => {
              const rowArray = Array.isArray(rows) ? rows : [rows]
              if (rowArray.length > 1) {
                batchInsertAttempted = true
                return { select: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }) }
              }
              // Per-row fallback: second row (the one "already inserted by another scan") conflicts, first succeeds.
              const row = rowArray[0]
              if (perRowInserted.length === 1) {
                return { select: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }) }
              }
              perRowInserted.push(row)
              return { select: () => Promise.resolve({ data: [row], error: null }) }
            },
          }
        }
        return baseHandler
      },
    }

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-uber-trip-1', threadId: 't1' }, { id: 'msg-zomato-order-1', threadId: 't2' }] }) } as any
      }
      if (url.includes('/messages/msg-uber-trip-1')) {
        return { ok: true, status: 200, json: async () => makeUberTripGmailMessage() } as any
      }
      if (url.includes('/messages/msg-zomato-order-1')) {
        return { ok: true, status: 200, json: async () => makeZomatoOrderGmailMessage() } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(batchInsertAttempted).toBe(true)
    expect(result.error).toBeNull()
    // One of the two rows conflicted and was skipped; the other succeeded —
    // the scan must not throw and must not lose the non-conflicting row.
    expect(perRowInserted).toHaveLength(1)
  })

  it('still throws on a non-conflict database error', async () => {
    const mockDb: any = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } } }) },
      from: (table: string) => {
        const baseHandler: any = {
          select: () => baseHandler, eq: () => baseHandler, order: () => baseHandler, limit: () => baseHandler,
          single: () => Promise.resolve({ data: null, error: null }),
          then: (resolve: any) => resolve({ data: [], error: null }),
        }
        if (table === 'profiles') return baseHandler
        if (table === 'cards') return baseHandler
        if (table === 'categories') return { ...baseHandler, then: (resolve: any) => resolve({ data: [{ name: 'Transport', is_permanent: false }, { name: 'Other', is_permanent: true }], error: null }) }
        if (table === 'email_scan_rejections') return { ...baseHandler, insert: () => Promise.resolve({ error: null }) }
        if (table === 'email_scan_logs') return { ...baseHandler, insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }) }) }
        if (table === 'transactions') {
          return { ...baseHandler, insert: () => ({ select: () => Promise.resolve({ data: null, error: { code: '500', message: 'connection reset' } }) }) }
        }
        return baseHandler
      },
    }

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'msg-uber-trip-1', threadId: 't1' }] }) } as any
      }
      if (url.includes('/messages/msg-uber-trip-1')) {
        return { ok: true, status: 200, json: async () => makeUberTripGmailMessage() } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    expect(result.error).not.toBeNull()
  })
})

// ============================================================
// Stage B — batched AI classification.
//
// The scanner used to spend one sequential Gemini round trip per email, which
// put a 50-email scan at 100-160s and made timeouts routine. These tests pin
// the batching contract: emails are grouped, gates still run BEFORE any AI
// call is made, and an AI outage still degrades to the regex ladder rather
// than dropping mail.
// ============================================================

describe('scanRealGmailInbox — batched AI classification', () => {
  function makeMessages(n: number) {
    // Distinct ids so dedup and verdict-mapping are exercised properly.
    return Array.from({ length: n }, (_, i) => makeAxisEmiGmailMessage(`msg-batch-${i}`))
  }

  function mockGmail(messages: any[]) {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
  }

  it('groups 12 emails into 3 batch calls instead of 12 single calls', async () => {
    const messages = makeMessages(12)
    mockGmail(messages)
    const mockDb = makeMockDb([], [])

    const batchSizes: number[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: mockDb,
      askAIBatch: async (emails) => {
        batchSizes.push(emails.length)
        return new Map(emails.map((e) => [e.index, null]))
      },
    })

    // AI_BATCH_SIZE is 5 → 5 + 5 + 2
    expect(batchSizes).toEqual([5, 5, 2])
  })

  it('maps each batch verdict back to the right email', async () => {
    const messages = makeMessages(3)
    mockGmail(messages)
    const insertedTransactions: any[] = []
    const mockDb = makeMockDb(insertedTransactions, [])

    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: mockDb,
      askAIBatch: async (emails) =>
        new Map(
          emails.map((e) => [
            e.index,
            // Give each email a distinct amount keyed off its position.
            {
              is_transaction: true,
              transaction_type: 'debit',
              amount: 100 + e.index,
              merchant: `Merchant${e.index}`,
              category: 'Other',
              description: 'd',
              payment_mode: 'upi',
              card_issuer: null,
              card_brand: null,
              transaction_time: null,
              reference_id: null,
              date: e.emailDate,
              confidence_score: 95,
            } as any,
          ])
        ),
    })

    const rows = insertedTransactions.flat()
    expect(rows).toHaveLength(3)
    // Every verdict landed on a distinct email, none duplicated or lost.
    expect(new Set(rows.map((r: any) => r.amount)).size).toBe(3)
    expect(rows.every((r: any) => r.merchant.startsWith('Merchant'))).toBe(true)
  })

  it('never sends gate-rejected junk to the AI', async () => {
    // One genuine debit alert plus two pieces of bulk marketing. Only the
    // genuine one may reach Stage B — junk must never cost an AI call or a
    // slice of the daily quota.
    const messages = [
      makeAxisEmiGmailMessage('msg-genuine-1'),
      makeBankMarketingGmailMessage('msg-marketing-1'),
      makeBusinessStandardGmailMessage('msg-newsletter-1'),
    ]
    mockGmail(messages)
    const mockDb = makeMockDb([], [])

    const seenSubjects: string[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: mockDb,
      askAIBatch: async (emails) => {
        emails.forEach((e) => seenSubjects.push(e.subject))
        return new Map(emails.map((e) => [e.index, null]))
      },
    })

    expect(seenSubjects).toHaveLength(1)
    expect(seenSubjects[0]).toMatch(/Debit transaction alert/i)
  })

  it('makes no AI call at all when every email is gate-rejected', async () => {
    mockGmail([makeBankMarketingGmailMessage('msg-marketing-only')])
    const mockDb = makeMockDb([], [])

    const askAIBatch = vi.fn(async (emails: any[]) => new Map(emails.map((e) => [e.index, null])))
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({ db: mockDb, askAIBatch: askAIBatch as any })

    expect(askAIBatch).not.toHaveBeenCalled()
  })

  it('falls back to the regex ladder when the batch analyzer throws', async () => {
    // AI failure must never surface as a scan failure or a dropped email.
    mockGmail([makeAxisEmiGmailMessage('msg-ai-down-1')])
    const insertedTransactions: any[] = []
    const mockDb = makeMockDb(insertedTransactions, [])

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: mockDb,
      askAIBatch: async () => { throw new Error('gemini down') },
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    // The Axis EMI email is still captured, by regex.
    const rows = insertedTransactions.flat()
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(42293)
  })

  it('degrades a thrown batch to per-email single calls before giving up', async () => {
    mockGmail(makeMessages(3))
    const mockDb = makeMockDb([], [])

    let singleCalls = 0
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: mockDb,
      askAIBatch: async () => { throw new Error('batch unavailable') },
      askAI: async () => { singleCalls++; return null },
    })

    expect(singleCalls).toBe(3)
  })

  it('routes through the batch path even when only askAI is supplied', async () => {
    // Back-compat: every pre-existing caller passes askAI alone and must keep
    // working, with unchanged one-call-per-email semantics.
    mockGmail(makeMessages(4))
    const mockDb = makeMockDb([], [])

    let singleCalls = 0
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: mockDb,
      askAI: async () => { singleCalls++; return null },
    })

    expect(result.error).toBeNull()
    expect(singleCalls).toBe(4)
  })
})

describe('scanRealGmailInbox — merchant rules are fetched once per scan', () => {
  it('reads merchant_rules once regardless of how many emails are scanned', async () => {
    // Previously this table was re-read for every email in the loop.
    const messages = Array.from({ length: 8 }, (_, i) => makeAxisEmiGmailMessage(`msg-rules-${i}`))
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const learningEngine = await import('./learningEngine')
    const spy = vi.spyOn(learningEngine, 'getMerchantRulesFromDB')

    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb([], []),
      askAIBatch: async (emails) => new Map(emails.map((e) => [e.index, null])),
    })

    expect(spy).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
})

// ============================================================
// Scan window — strict rolling 7 days (requirements R3/R4), and the
// year-boundary handling that a fixed 7-day window makes load-bearing.
// ============================================================

describe('scanRealGmailInbox — strict 7-day scan window', () => {
  function mockGmailCapturingQuery(messages: any[] = []) {
    const captured = { url: '' }
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        captured.url = url
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
    return captured
  }

  /** The `after:` epoch-seconds value the scanner put in the Gmail query. */
  function afterSecondsFrom(url: string): number {
    const m = decodeURIComponent(url).match(/after:(\d+)/)
    if (!m) throw new Error(`no after: clause in ${url}`)
    return Number(m[1])
  }

  it('asks Gmail for exactly the last 7 days on a first scan', async () => {
    const captured = mockGmailCapturingQuery()
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb([], []),
      askAI: async () => null,
    })

    const expected = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000)
    expect(Math.abs(afterSecondsFrom(captured.url) - expected)).toBeLessThan(10)
  })

  it('still asks for 7 days when a recent successful scan exists', async () => {
    // Previously the window narrowed to "since the last successful scan"
    // (26h floor). R3 requires the same 7 days every time.
    // 6h, not 2h: a 2-hour-old scan now trips the 4-hour minimum gap (R7) and
    // the scan is refused before it ever builds a Gmail query, which is not
    // what this test is about.
    const recent = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()
    const mockDb = makeMockDb([], [])
    const baseFrom = mockDb.from
    mockDb.from = (table: string) => {
      if (table === 'profiles') {
        // Premium, so the 24h manual cooldown doesn't short-circuit the scan
        // before it builds a Gmail query — the window is what's under test here.
        const handler: any = {
          select: () => handler, eq: () => handler, order: () => handler, limit: () => handler, gte: () => handler,
          single: () => Promise.resolve({ data: { subscription_status: 'active', subscription_expires_at: null }, error: null }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }), then: (r: any) => r({ data: [], error: null }) }),
          then: (r: any) => r({ data: null, error: null }),
        }
        return handler
      }
      if (table === 'email_scan_logs') {
        const handler: any = {
          select: () => handler, eq: () => handler, order: () => handler, gte: () => handler,
          limit: () => Promise.resolve({ data: [{ scanned_at: recent }], error: null }),
          single: () => Promise.resolve({ data: null, error: null }),
          insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }), then: (r: any) => r({ data: [], error: null }) }),
          then: (r: any) => r({ data: [{ scanned_at: recent }], error: null }),
        }
        return handler
      }
      return baseFrom(table)
    }

    const captured = mockGmailCapturingQuery()
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: mockDb,
      askAI: async () => null,
    })

    const expected = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000)
    expect(Math.abs(afterSecondsFrom(captured.url) - expected)).toBeLessThan(10)
  })

  it('drops an email older than the window without an AI call', async () => {
    const stale = makeAxisEmiGmailMessage('msg-stale-1')
    stale.internalDate = String(Date.now() - 9 * 24 * 60 * 60 * 1000)
    mockGmailCapturingQuery([stale])

    const insertedTransactions: any[] = []
    const askAI = vi.fn(async () => null)
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(insertedTransactions, []),
      askAI: askAI as any,
    })

    expect(result.error).toBeNull()
    expect(insertedTransactions.flat()).toHaveLength(0)
    expect(askAI).not.toHaveBeenCalled()
  })

  it('rejects an email with no internalDate instead of treating it as arriving now', async () => {
    // The fallback used to be Date.now(), which always passes the window check
    // regardless of how old the mail actually is — a malformed API response
    // could slip an out-of-window email straight through the date gate.
    const undated = makeAxisEmiGmailMessage('msg-undated-1')
    delete (undated as any).internalDate
    mockGmailCapturingQuery([undated])

    const insertedTransactions: any[] = []
    const insertedRejections: any[] = []
    const askAI = vi.fn(async () => null)
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(insertedTransactions, insertedRejections),
      askAI: askAI as any,
    })

    expect(result.error).toBeNull()
    expect(insertedTransactions.flat()).toHaveLength(0)
    expect(askAI).not.toHaveBeenCalled()
    expect(insertedRejections.flat().map((r: any) => r.gate)).toContain('no_internal_date')
  })

  it('does not reprocess an email already attached to a transaction', async () => {
    // R4. The window deliberately overlaps previous scans; dedup is what makes
    // that free.
    const seen = makeAxisEmiGmailMessage('msg-already-seen')
    mockGmailCapturingQuery([seen])

    const insertedTransactions: any[] = []
    const mockDb = makeMockDb(insertedTransactions, [])
    const baseFrom = mockDb.from
    mockDb.from = (table: string) => {
      if (table === 'transactions') {
        const handler: any = {
          select: () => handler, eq: () => handler, order: () => handler, limit: () => handler, gte: () => handler,
          single: () => Promise.resolve({ data: null, error: null }),
          insert: (row: any) => {
            insertedTransactions.push(row)
            return { select: () => ({ single: () => Promise.resolve({ data: [], error: null }) }), then: (r: any) => r({ data: [], error: null }) }
          },
          // Dedup preload reports this message id as already imported.
          then: (r: any) => r({ data: [{ email_message_id: 'msg-already-seen', reference_id: null }], error: null }),
        }
        return handler
      }
      return baseFrom(table)
    }

    const askAI = vi.fn(async () => null)
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: mockDb,
      askAI: askAI as any,
    })

    expect(insertedTransactions.flat()).toHaveLength(0)
    expect(askAI).not.toHaveBeenCalled()
  })
})

describe('scanRealGmailInbox — year boundary', () => {
  function mockGmail(messages: any[]) {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
  }

  it('keeps a late-December email when the window straddles 1 January', async () => {
    // The regression this fix exists for: scanning on 3 January with the
    // window reaching back into December used to discard every one of those
    // transactions silently and unrecoverably.
    const thisYear = new Date().getUTCFullYear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.UTC(thisYear, 0, 3, 10, 0, 0))) // 3 Jan

    try {
      const december = makeAxisEmiGmailMessage('msg-dec-31')
      december.internalDate = String(Date.UTC(thisYear - 1, 11, 29, 10, 0, 0)) // 29 Dec
      mockGmail([december])

      const insertedTransactions: any[] = []
      const { scanRealGmailInbox } = await import('./emailScanner')
      const result = await scanRealGmailInbox({
        db: makeMockDb(insertedTransactions, []),
        askAI: async () => null,
      })

      expect(result.error).toBeNull()
      const rows = insertedTransactions.flat()
      expect(rows).toHaveLength(1)
      // Attributed to the year it actually belongs to, not the active year.
      expect(rows[0].date.startsWith(String(thisYear - 1))).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

})

// ============================================================
// Tiered manual-scan quotas (requirements R6/R7/R8):
//   free            1 manual scan per day, no automatic scan
//   premium/trial   daily automatic scan + 2 manual scans per day
//   owner           daily automatic scan + unlimited manual scans
//
// Only manual scans count — the daily automatic scan must never consume a
// user's manual allowance.
// ============================================================

describe('isPremiumProfile', () => {
  it('treats an open-ended active subscription as premium', async () => {
    const { isPremiumProfile } = await import('./emailScanner')
    expect(isPremiumProfile({ subscription_status: 'active', subscription_expires_at: null })).toBe(true)
  })

  it('treats an unexpired active subscription as premium', async () => {
    const { isPremiumProfile } = await import('./emailScanner')
    const future = new Date(Date.now() + 86400000).toISOString()
    expect(isPremiumProfile({ subscription_status: 'active', subscription_expires_at: future })).toBe(true)
  })

  it('treats a lapsed active subscription as not premium', async () => {
    const { isPremiumProfile } = await import('./emailScanner')
    const past = new Date(Date.now() - 86400000).toISOString()
    expect(isPremiumProfile({ subscription_status: 'active', subscription_expires_at: past })).toBe(false)
  })

  it('requires an unexpired end date for a trial, unlike an active subscription', async () => {
    const { isPremiumProfile } = await import('./emailScanner')
    const future = new Date(Date.now() + 86400000).toISOString()
    expect(isPremiumProfile({ subscription_status: 'trial', subscription_expires_at: future })).toBe(true)
    expect(isPremiumProfile({ subscription_status: 'trial', subscription_expires_at: null })).toBe(false)
  })

  it('treats missing, free and expired profiles as not premium', async () => {
    const { isPremiumProfile } = await import('./emailScanner')
    expect(isPremiumProfile(null)).toBe(false)
    expect(isPremiumProfile({ subscription_status: 'free', subscription_expires_at: null })).toBe(false)
    expect(isPremiumProfile({ subscription_status: 'expired', subscription_expires_at: null })).toBe(false)
  })
})

describe('resolveManualScanLimit', () => {
  it('gives the owner an unlimited allowance', async () => {
    const { resolveManualScanLimit } = await import('./emailScanner')
    expect(resolveManualScanLimit(true, false)).toBe(Infinity)
    expect(resolveManualScanLimit(true, true)).toBe(Infinity)
  })

  it('gives premium 2 and free 1', async () => {
    const { resolveManualScanLimit } = await import('./emailScanner')
    expect(resolveManualScanLimit(false, true)).toBe(2)
    expect(resolveManualScanLimit(false, false)).toBe(1)
  })
})

describe('computeManualQuotaState', () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString()

  it('reports an available scan when under the limit and outside the gap', async () => {
    // 5h ago: one scan left AND clear of the 4-hour minimum gap (R7).
    const { computeManualQuotaState } = await import('./emailScanner')
    const q = computeManualQuotaState([hoursAgo(5)], 2)
    expect(q.used).toBe(1)
    expect(q.remaining).toBe(1)
    expect(q.nextAvailableAt).toBeNull()
  })

  it('holds a premium user inside the 4-hour gap even with a scan remaining', async () => {
    // R7: two scans a day, but never back to back. One scan left, yet the last
    // one was an hour ago, so the next is due three hours from now.
    const { computeManualQuotaState } = await import('./emailScanner')
    const q = computeManualQuotaState([hoursAgo(1)], 2)
    expect(q.remaining).toBe(1)
    expect(q.nextAvailableAt).not.toBeNull()
    const hoursUntil = (q.nextAvailableAt!.getTime() - Date.now()) / 3600000
    expect(hoursUntil).toBeGreaterThan(2.5)
    expect(hoursUntil).toBeLessThan(3.5)
  })

  it('does not let the gap shorten the 24-hour wait on a free allowance', async () => {
    // The gap must never be the answer when the allowance is what blocks: a
    // free user 5h past their only scan still waits ~19h, not 0.
    const { computeManualQuotaState } = await import('./emailScanner')
    const q = computeManualQuotaState([hoursAgo(5)], 1)
    expect(q.remaining).toBe(0)
    const hoursUntil = (q.nextAvailableAt!.getTime() - Date.now()) / 3600000
    expect(hoursUntil).toBeGreaterThan(18.5)
    expect(hoursUntil).toBeLessThan(19.5)
  })

  it('returns the later of the two rules when both bind', async () => {
    // Premium at the limit with both scans recent. The gap would say ~3h; the
    // rolling allowance says ~22h. Returning the gap would hand out a third
    // scan, so the allowance has to win.
    const { computeManualQuotaState } = await import('./emailScanner')
    const q = computeManualQuotaState([hoursAgo(1), hoursAgo(2)], 2)
    expect(q.remaining).toBe(0)
    const hoursUntil = (q.nextAvailableAt!.getTime() - Date.now()) / 3600000
    expect(hoursUntil).toBeGreaterThan(21.5)
    expect(hoursUntil).toBeLessThan(22.5)
  })

  it('exempts the owner from the gap', async () => {
    const { computeManualQuotaState } = await import('./emailScanner')
    const q = computeManualQuotaState([hoursAgo(0.1)], Infinity)
    expect(q.nextAvailableAt).toBeNull()
  })

  it('blocks at the limit and dates the next slot off the oldest counted scan', async () => {
    // Premium: two scans used, 3h and 20h ago. The next slot opens when the
    // OLDER one ages out — about 4h away, not 21h.
    const { computeManualQuotaState } = await import('./emailScanner')
    const q = computeManualQuotaState([hoursAgo(3), hoursAgo(20)], 2)
    expect(q.remaining).toBe(0)
    const hoursUntil = (q.nextAvailableAt!.getTime() - Date.now()) / 3600000
    expect(hoursUntil).toBeGreaterThan(3.5)
    expect(hoursUntil).toBeLessThan(4.5)
  })

  it('dates a free user off their single scan', async () => {
    const { computeManualQuotaState } = await import('./emailScanner')
    const q = computeManualQuotaState([hoursAgo(10)], 1)
    expect(q.remaining).toBe(0)
    const hoursUntil = (q.nextAvailableAt!.getTime() - Date.now()) / 3600000
    expect(hoursUntil).toBeGreaterThan(13.5)
    expect(hoursUntil).toBeLessThan(14.5)
  })

  it('never blocks an unlimited allowance', async () => {
    const { computeManualQuotaState } = await import('./emailScanner')
    const q = computeManualQuotaState([hoursAgo(1), hoursAgo(2), hoursAgo(3)], Infinity)
    expect(q.remaining).toBe(Infinity)
    expect(q.nextAvailableAt).toBeNull()
  })

  it('reports availability when no scans have been used', async () => {
    const { computeManualQuotaState } = await import('./emailScanner')
    expect(computeManualQuotaState([], 1).nextAvailableAt).toBeNull()
  })
})

describe('scanRealGmailInbox — quota enforcement', () => {
  /** Mock DB whose email_scan_logs table returns the given manual-scan history. */
  function makeQuotaDb(manualScanTimes: string[], profile: any) {
    const chain = (payload: any): any => {
      const h: any = {
        select: () => h, eq: () => h, order: () => h, gte: () => h, limit: () => h,
        single: () => Promise.resolve({ data: profile, error: null }),
        insert: (row: any) => ({
          select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
          then: (r: any) => r({ data: [], error: null }),
        }),
        update: () => ({ eq: () => ({ then: (r: any) => r({ error: null }) }) }),
        then: (r: any) => r(payload),
      }
      return h
    }
    return {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } } }) },
      from: (table: string) => {
        if (table === 'profiles') return chain({ data: profile, error: null })
        if (table === 'email_scan_logs') {
          return chain({ data: manualScanTimes.map((t) => ({ scanned_at: t })), error: null })
        }
        if (table === 'categories') return chain({ data: [{ name: 'Other', is_permanent: true }], error: null })
        return chain({ data: [], error: null })
      },
    } as any
  }

  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString()

  beforeEach(() => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: [] }) } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
  })

  it('blocks a free user after 1 manual scan', async () => {
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeQuotaDb([hoursAgo(2)], { subscription_status: 'free', subscription_expires_at: null }),
      askAI: async () => null,
    })

    expect(result.error?.message).toMatch(/Daily scan limit reached \(1 manual scan per day\)/)
    // PendingPage keys its cooldown banner off this exact phrase.
    expect(result.error?.message).toMatch(/Next scan available in/)
  })

  it('allows a premium user a second manual scan, then blocks the third', async () => {
    // Timings deliberately clear the 4-hour minimum gap (R7) so this test stays
    // about the allowance. The gap itself is covered by the case below.
    const { scanRealGmailInbox } = await import('./emailScanner')
    const premium = { subscription_status: 'active', subscription_expires_at: null }

    const second = await scanRealGmailInbox({
      db: makeQuotaDb([hoursAgo(5)], premium),
      askAI: async () => null,
    })
    expect(second.error).toBeNull()

    const third = await scanRealGmailInbox({
      db: makeQuotaDb([hoursAgo(5), hoursAgo(9)], premium),
      askAI: async () => null,
    })
    expect(third.error?.message).toMatch(/Daily scan limit reached \(2 manual scans per day\)/)
    expect(third.error?.message).toMatch(/Next scan available in/)
  })

  it('refuses a premium scan inside the 4-hour gap, even with an allowance left', async () => {
    // The engine must enforce the gap itself. It used to gate purely on
    // `remaining === 0`, which the gap never triggers — so the rule would have
    // lived in the UI and nowhere else, and any direct call would sail past it.
    const { scanRealGmailInbox } = await import('./emailScanner')
    const premium = { subscription_status: 'active', subscription_expires_at: null }

    const tooSoon = await scanRealGmailInbox({
      db: makeQuotaDb([hoursAgo(1)], premium),
      askAI: async () => null,
    })
    expect(tooSoon.error?.message).toMatch(/at least 4 hours apart/)
    expect(tooSoon.error?.message).toMatch(/Next scan available in/)
  })

  it('never blocks a scheduled scan, however many manual scans were used', async () => {
    // R7: the automatic daily scan is "in addition to" the manual allowance.
    // Premium, because R6 gives a free user no automatic scan to exempt.
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeQuotaDb([hoursAgo(1), hoursAgo(2), hoursAgo(3)], { subscription_status: 'active', subscription_expires_at: null }),
      scanMode: 'scheduled',
      askAI: async () => null,
    })
    expect(result.error).toBeNull()
  })

  it('refuses a browser scan that calls itself scheduled without auto-scan entitlement', async () => {
    // R6: free tier has no automatic scan. Both pages run a background sync on
    // mount labelled 'scheduled' to keep it off the manual allowance — which,
    // unenforced, handed free users a daily scan the tier does not include and
    // that no quota counted.
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeQuotaDb([], { subscription_status: 'free', subscription_expires_at: null }),
      scanMode: 'scheduled',
      askAI: async () => null,
    })
    // Wording changed with R5: there is no automatic scanning to be entitled
    // to any more, so the refusal says what to do instead.
    expect(result.error?.message).toMatch(/Scans are started by you/)
  })

  it('records scan_mode on the scan log', async () => {
    const inserted: any[] = []
    const db = makeQuotaDb([], { subscription_status: 'active', subscription_expires_at: null })
    const baseFrom = db.from
    db.from = (table: string) => {
      const h = baseFrom(table)
      if (table === 'email_scan_logs') {
        const origInsert = h.insert
        h.insert = (row: any) => { inserted.push(row); return origInsert(row) }
      }
      return h
    }

    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db, scanMode: 'scheduled', askAI: async () => null,
    })

    expect(inserted.length).toBeGreaterThan(0)
    expect(inserted[0].scan_mode).toBe('scheduled')
  })
})

// ============================================================
// Phase 2 — visible progress and durable partial results.
//
// Before this, nothing was written until the whole per-email loop finished, so
// a scan that timed out at email 40 of 50 saved NOTHING and the retry re-paid
// the AI cost for every one of them.
// ============================================================

describe('scanRealGmailInbox — progress reporting', () => {
  function mockGmail(messages: any[]) {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
  }

  it('reports listing, fetching, analyzing and saving in order', async () => {
    const messages = Array.from({ length: 3 }, (_, i) => makeAxisEmiGmailMessage(`msg-prog-${i}`))
    mockGmail(messages)

    const phases: string[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb([], []),
      askAI: async () => null,
      onProgress: (p) => phases.push(p.phase),
    })

    expect(phases[0]).toBe('listing')
    expect(phases).toContain('fetching')
    // Each stage announces itself the moment it begins, so a stall is
    // attributable to a specific stage rather than to "somewhere after fetch".
    expect(phases).toContain('preparing')
    expect(phases).toContain('filtering')
    expect(phases).toContain('analyzing')
    expect(phases).toContain('saving')
    // Phases never run backwards. `preparing` precedes `fetching` on purpose:
    // the dedup set has to be loaded BEFORE message bodies are downloaded, so
    // mail an earlier scan already handled is never fetched at all (R4).
    const order = ['listing', 'preparing', 'fetching', 'filtering', 'analyzing', 'saving']
    const seen = phases.map((p) => order.indexOf(p))
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
  })

  it('reports totals that match the mail actually found', async () => {
    const messages = Array.from({ length: 4 }, (_, i) => makeAxisEmiGmailMessage(`msg-total-${i}`))
    mockGmail(messages)

    const events: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb([], []),
      askAI: async () => null,
      onProgress: (p) => events.push(p),
    })

    expect(events.find((e) => e.phase === 'listing').total).toBe(4)
    const fetching = events.filter((e) => e.phase === 'fetching')
    expect(fetching[fetching.length - 1].current).toBe(4)
  })

  it('does not fail the scan when the progress callback throws', async () => {
    mockGmail([makeAxisEmiGmailMessage('msg-throwing-cb')])

    const insertedTransactions: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(insertedTransactions, []),
      askAI: async () => null,
      onProgress: () => { throw new Error('UI blew up') },
    })

    expect(result.error).toBeNull()
    expect(insertedTransactions.flat()).toHaveLength(1)
  })

  // Yielding is time-based (STAGE_YIELD_BUDGET_MS), so these two tests must
  // give the scanner enough real work to exceed that budget — a handful of
  // small text/plain fixtures now legitimately finishes inside one slice and
  // never needs to yield at all. Heavy HTML bodies are what a yield exists to
  // survive in production, so that is what these exercise: each message carries
  // a real debit line plus enough markup to make the decode + DOM parse cost
  // genuine, and the count is set well above the threshold so the assertions
  // are not timing-marginal on a fast machine.
  function makeHeavyHtmlMessage(id: string) {
    const filler = '<tr><td><table><tr><td>promotional layout cell with padding text</td></tr></table></td></tr>'.repeat(1200)
    const html = `<html><body><p>Rs.450.00 debited from your account XX4471 at SWIGGY on 10-08-26.</p><table>${filler}</table></body></html>`
    return {
      id,
      threadId: `thread-${id}`,
      snippet: 'debited',
      internalDate: String(Date.now() - 2 * 24 * 60 * 60 * 1000),
      payload: {
        headers: [
          { name: 'Subject', value: 'Debit transaction alert' },
          { name: 'From', value: 'Alerts <alerts@hdfcbank.com>' },
        ],
        mimeType: 'text/html',
        body: { data: Buffer.from(html, 'utf-8').toString('base64url') },
      },
    }
  }

  it('yields to the event loop during Stage A so the UI can repaint', async () => {
    // Regression guard. Stage A had no awaits at all, so it ran as one
    // uninterrupted synchronous block: React could not repaint, and the scan's
    // own setTimeout timeout could not fire either — a large scan wedged the
    // tab instead of timing out.
    const messages = Array.from({ length: 40 }, (_, i) => makeHeavyHtmlMessage(`msg-yield-${i}`))
    mockGmail(messages)

    let timerFiredDuringScan = false
    const timer = setTimeout(() => { timerFiredDuringScan = true }, 0)

    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb([], []),
      askAIBatch: async (emails) => new Map(emails.map((e) => [e.index, null])),
    })
    clearTimeout(timer)

    expect(timerFiredDuringScan).toBe(true)
  })

  it('keeps yielding through Stage C, where the regex ladder runs', async () => {
    // Stage C awaits absorbIntoExistingPayment, but that resolves
    // synchronously whenever no merge partner is found — a microtask, which
    // does NOT let the browser paint. Same freeze as Stage A had, in the
    // stage that does more work per email.
    const messages = Array.from({ length: 40 }, (_, i) => makeHeavyHtmlMessage(`msg-stagec-${i}`))
    mockGmail(messages)

    let ticks = 0
    const interval = setInterval(() => { ticks++ }, 1)

    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb([], []),
      // Resolves synchronously, so Stage B contributes no macrotask yields of
      // its own — any ticks observed must come from Stage A and Stage C.
      askAIBatch: async (emails) => new Map(emails.map((e) => [e.index, null])),
    })
    clearInterval(interval)

    expect(ticks).toBeGreaterThan(0)
  })

  it('reports filtering progress while sorting a large batch', async () => {
    const messages = Array.from({ length: 25 }, (_, i) => makeAxisEmiGmailMessage(`msg-filter-${i}`))
    mockGmail(messages)

    const phases: string[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb([], []),
      askAIBatch: async (emails) => new Map(emails.map((e) => [e.index, null])),
      onProgress: (p) => phases.push(p.phase),
    })

    expect(phases).toContain('filtering')
  })

  it('formats each phase into readable copy', async () => {
    const { formatScanProgress } = await import('./emailScanner')
    expect(formatScanProgress({ phase: 'listing', current: 0, total: 0 })).toMatch(/No new emails/i)
    expect(formatScanProgress({ phase: 'listing', current: 7, total: 7 })).toMatch(/Found 7 emails/i)
    expect(formatScanProgress({ phase: 'fetching', current: 3, total: 9 })).toMatch(/Reading email 3 of 9/i)
    expect(formatScanProgress({ phase: 'filtering', current: 4, total: 9 })).toMatch(/Sorting email 4 of 9/i)
    expect(formatScanProgress({ phase: 'analyzing', current: 5, total: 9 })).toMatch(/Analyzing email 5 of 9/i)
    expect(formatScanProgress({ phase: 'saving', current: 2, total: 9 })).toMatch(/Saving/i)
  })
})

describe('scanRealGmailInbox — incremental inserts keep partial results', () => {
  it('writes transactions in chunks rather than one insert at the end', async () => {
    // 25 parsed transactions at a chunk size of 10 → 3 writes, not 1.
    const messages = Array.from({ length: 25 }, (_, i) => makeAxisEmiGmailMessage(`msg-chunk-${i}`))
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const insertCalls: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(insertCalls, []),
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    const batches = insertCalls.filter((rows) => Array.isArray(rows))
    expect(batches.length).toBeGreaterThan(1)
    expect(insertCalls.flat()).toHaveLength(25)
  })

  it('keeps already-flushed transactions when the scan dies partway, and says so', async () => {
    const messages = Array.from({ length: 25 }, (_, i) => makeAxisEmiGmailMessage(`msg-die-${i}`))
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const persisted: any[] = []
    let writes = 0
    const chain = (payload: any): any => {
      const h: any = {
        select: () => h, eq: () => h, order: () => h, gte: () => h, limit: () => h,
        single: () => Promise.resolve({ data: null, error: null }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }), then: (r: any) => r({ data: [], error: null }) }),
        then: (r: any) => r(payload),
      }
      return h
    }
    const mockDb: any = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } } }) },
      from: (table: string) => {
        if (table === 'categories') return chain({ data: [{ name: 'Other', is_permanent: true }], error: null })
        if (table === 'transactions') {
          const h = chain({ data: [], error: null })
          h.insert = (rows: any) => {
            const arr = Array.isArray(rows) ? rows : [rows]
            writes++
            // Second chunk hits an unrecoverable database error.
            if (writes === 2) {
              return { select: () => Promise.resolve({ data: null, error: { code: '08006', message: 'connection failure' } }) }
            }
            persisted.push(...arr)
            return { select: () => Promise.resolve({ data: arr, error: null }) }
          }
          return h
        }
        return chain({ data: [], error: null })
      },
    }

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: mockDb,
      askAI: async () => null,
    })

    // The scan fails...
    expect(result.error).not.toBeNull()
    // ...but the first chunk survived, instead of the whole scan being lost.
    expect(persisted).toHaveLength(10)
    // ...and the user is told, so they don't assume they lost everything.
    expect(result.error!.message).toMatch(/10 transactions found before the error were already saved/i)
  })

  it('still isolates a unique-constraint conflict within a chunk', async () => {
    // The 23505 row-by-row fallback must survive being moved into the shared
    // chunk helper — it is what makes concurrent and retried scans safe.
    const messages = Array.from({ length: 3 }, (_, i) => makeAxisEmiGmailMessage(`msg-conflict-${i}`))
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const perRow: any[] = []
    let perRowAttempts = 0
    const chain = (payload: any): any => {
      const h: any = {
        select: () => h, eq: () => h, order: () => h, gte: () => h, limit: () => h,
        single: () => Promise.resolve({ data: null, error: null }),
        insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: {}, error: null }) }), then: (r: any) => r({ data: [], error: null }) }),
        then: (r: any) => r(payload),
      }
      return h
    }
    const mockDb: any = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } } }) },
      from: (table: string) => {
        if (table === 'categories') return chain({ data: [{ name: 'Other', is_permanent: true }], error: null })
        if (table === 'transactions') {
          const h = chain({ data: [], error: null })
          h.insert = (rows: any) => {
            const arr = Array.isArray(rows) ? rows : [rows]
            if (arr.length > 1) {
              return { select: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }) }
            }
            // Per-row retry: exactly the SECOND row was already inserted by a
            // concurrent scan; the first and third must still go through.
            perRowAttempts++
            if (perRowAttempts === 2) {
              return { select: () => Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }) }
            }
            perRow.push(arr[0])
            return { select: () => Promise.resolve({ data: arr, error: null }) }
          }
          return h
        }
        return chain({ data: [], error: null })
      },
    }

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: mockDb,
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    // One row conflicted and was skipped; the others were kept.
    expect(perRow).toHaveLength(2)
  })
})

// ============================================================
// D3 — scope widened to "everything financial" (requirement R2).
//
// The Gmail query is the hard ceiling on coverage: an email matching none of
// its keywords is never fetched, so no gate, AI verdict or dedup pass can
// recover it. These cover the classes that were previously invisible.
// ============================================================

describe('scanRealGmailInbox — fetch query covers everything financial', () => {
  async function captureQuery(): Promise<string> {
    let captured = ''
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        captured = url
        return { ok: true, status: 200, json: async () => ({ messages: [] }) } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb([], []),
      askAI: async () => null,
    })
    return decodeURIComponent(captured)
  }

  it('asks for refund, insurance premium and investment vocabulary', async () => {
    const q = await captureQuery()
    for (const term of ['refund', 'premium', 'dividend', 'folio', 'nach', 'autopay']) {
      expect(q).toContain(term)
    }
  })

  it('keeps the original bank-alert and receipt vocabulary', async () => {
    const q = await captureQuery()
    for (const term of ['debited', 'credited', 'salary', 'emi', 'sip', 'receipt', 'invoice', 'subscription', 'renewal']) {
      expect(q).toContain(term)
    }
  })

  it('does not ask for reminder-shaped or stem-noisy terms', async () => {
    // "bill"/"statement"/"due" only add reminders, which are rejected anyway;
    // a genuinely paid bill already matches on "payment". "interest" stems to
    // "interested" and would flood the net with marketing.
    const q = await captureQuery()
    expect(q).not.toMatch(/\bOR statement\b/)
    expect(q).not.toMatch(/\bOR interest\b/)
    expect(q).not.toMatch(/\bOR due\b/)
  })
})

describe('scanRealGmailInbox — newly in-scope financial transactions', () => {
  function mockGmail(messages: any[]) {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
  }

  it('captures a refund whose email never says "credited"', async () => {
    mockGmail([makeRefundGmailMessage()])
    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(inserted, []),
      askAI: async () => null, // force the regex ladder — no AI safety net
    })

    expect(result.error).toBeNull()
    const rows = inserted.flat()
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(1299)
  })

  it('captures an insurance premium whose email says "collected", not "debited"', async () => {
    mockGmail([makePremiumGmailMessage()])
    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(inserted, []),
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    const rows = inserted.flat()
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(12500)
    expect(rows[0].type).toBe('debit')
  })

  it('still rejects the junk classes now that the net is wider', async () => {
    // The widened query pulls in more mail, so R1/R13 must still hold.
    mockGmail([
      makeBankMarketingGmailMessage('msg-wide-marketing'),
      makeBusinessStandardGmailMessage('msg-wide-newsletter'),
    ])
    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(inserted, []),
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    expect(inserted.flat()).toHaveLength(0)
  })
})

// ============================================================
// D5 / R10 — a bank alert and the merchant's receipt for ONE payment become
// one transaction. Covers both directions: two emails in the same scan, and a
// new email matching a transaction stored by an earlier scan.
// ============================================================

describe('scanRealGmailInbox — smart-merges duplicate payments', () => {
  function toBase64Url(text: string): string {
    return Buffer.from(text, 'utf-8').toString('base64url')
  }

  /** A minimal payment email with controllable merchant/amount/reference. */
  function paymentMessage(id: string, subject: string, body: string) {
    return {
      id,
      threadId: `thread-${id}`,
      snippet: body.slice(0, 80),
      internalDate: String(Date.now() - 2 * 24 * 60 * 60 * 1000),
      payload: {
        headers: [
          { name: 'Subject', value: subject },
          { name: 'From', value: 'Alerts <alerts@hdfcbank.com>' },
        ],
        mimeType: 'text/plain',
        body: { data: toBase64Url(body) },
      },
    }
  }

  const BANK_ALERT = paymentMessage(
    'msg-bank-alert',
    'Debit transaction alert',
    'Rs.450.00 has been debited from your HDFC Bank A/c XX4471 at SWIGGY on 10-08-26. UPI Ref 445566778899.'
  )
  const MERCHANT_RECEIPT = paymentMessage(
    'msg-merchant-receipt',
    'Your Swiggy order receipt',
    'Thanks for ordering from Swiggy. Total paid Rs.450.00 for your order. We hope you enjoyed your meal.'
  )

  function mockGmail(messages: any[]) {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
  }

  /** Mock DB seeded with pre-existing transactions, capturing inserts and updates. */
  function makeMergeDb(existing: any[], inserted: any[], updates: any[]) {
    const chain = (payload: any): any => {
      const h: any = {
        select: () => h, eq: () => h, order: () => h, gte: () => h, limit: () => h,
        single: () => Promise.resolve({ data: null, error: null }),
        insert: (row: any) => ({
          select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
          then: (r: any) => r({ data: [], error: null }),
        }),
        update: (patch: any) => ({ eq: (_c: any, id: any) => { updates.push({ id, patch }); return Promise.resolve({ error: null }) } }),
        then: (r: any) => r(payload),
      }
      return h
    }
    return {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } } }) },
      from: (table: string) => {
        if (table === 'categories') return chain({ data: [{ name: 'Food & Dining', is_permanent: false }, { name: 'Other', is_permanent: true }], error: null })
        if (table === 'transactions') {
          const h = chain({ data: existing, error: null })
          h.insert = (rows: any) => {
            const arr = Array.isArray(rows) ? rows : [rows]
            inserted.push(...arr)
            return { select: () => Promise.resolve({ data: arr.map((r: any, i: number) => ({ ...r, id: `new-${inserted.length}-${i}` })), error: null }) }
          }
          h.update = (patch: any) => ({ eq: (_col: any, id: any) => { updates.push({ id, patch }); return Promise.resolve({ error: null }) } })
          return h
        }
        return chain({ data: [], error: null })
      },
    } as any
  }

  it('keeps both rows when a same-scan pair cannot be proven identical', async () => {
    // The bank alert carries a UPI reference and the receipt does not, so
    // nothing proves these are one payment rather than two identical orders.
    // Both are kept and the newer one is flagged for the user to decide.
    mockGmail([BANK_ALERT, MERCHANT_RECEIPT])
    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMergeDb([], inserted, []),
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    // Two emails in, TWO transactions out — nothing destroyed silently.
    expect(inserted).toHaveLength(2)
    expect(result.data?.mergedDuplicateCount).toBe(0)
    const flagged = inserted.filter((r) => r.possible_duplicate_of)
    expect(flagged).toHaveLength(1)
    expect(flagged[0].email_message_id).toBe('msg-merchant-receipt')
    expect(flagged[0].possible_duplicate_of).toBeTruthy()
  })

  it('still folds a same-scan pair the reference id proves identical', async () => {
    const alert = paymentMessage('msg-alert-ref', 'Debit transaction alert',
      'Rs.450.00 debited from your A/c XX4471 at SWIGGY on 10-08-26. UPI Ref 445566778899.')
    const receipt = paymentMessage('msg-receipt-ref', 'Your Swiggy order receipt',
      'Thanks for ordering from Swiggy. Total paid Rs.450.00. UPI Ref No 445566778899.')
    mockGmail([alert, receipt])

    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMergeDb([], inserted, []),
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    // Proven the same payment — one transaction out.
    expect(inserted).toHaveLength(1)
    expect(result.data?.mergedDuplicateCount).toBe(1)
    expect(inserted[0].reference_id).toBe('445566778899')
    expect(inserted[0].merged_email_message_ids).toContain('msg-receipt-ref')
    expect(inserted[0].possible_duplicate_of).toBeFalsy()
  })

  it('does not merge two same-amount payments to different merchants', async () => {
    const swiggy = paymentMessage('msg-swiggy', 'Debit transaction alert',
      'Rs.450.00 debited from your A/c XX4471 at SWIGGY on 10-08-26. UPI Ref 111111111111.')
    const zomato = paymentMessage('msg-zomato', 'Debit transaction alert',
      'Rs.450.00 debited from your A/c XX4471 at ZOMATO on 10-08-26. UPI Ref 222222222222.')
    mockGmail([swiggy, zomato])

    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMergeDb([], inserted, []),
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    expect(inserted).toHaveLength(2)
    expect(result.data?.mergedDuplicateCount).toBe(0)
  })

  it('flags a receipt against a look-alike transaction stored by an earlier scan', async () => {
    const today = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const storedBankAlert = {
      id: 'stored-1',
      amount: 450,
      type: 'debit',
      date: today,
      merchant: 'HDFC Bank', // weak label — the receipt should improve it
      description: 'Bank transaction',
      reference_id: null,
      payment_mode: 'unknown',
      card_issuer: null,
      card_brand: null,
      transaction_time: null,
      confidence_score: 60,
      approval_status: 'pending',
      category_confirmed_at: null,
      email_message_id: 'msg-old-bank-alert',
      merged_email_message_ids: null,
    }

    // Receipt names the merchant, so the pair corresponds via the reference id
    // the bank alert carries... which it does not here, so use a named receipt
    // whose merchant matches a NON-weak stored label instead.
    storedBankAlert.merchant = 'Swiggy'
    mockGmail([MERCHANT_RECEIPT])

    const inserted: any[] = []
    const updates: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMergeDb([storedBankAlert], inserted, updates),
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    // Neither side carries a reference id, so nothing proves this receipt
    // belongs to the stored row rather than being a second identical order.
    // The row is kept and flagged; the stored row is left untouched.
    expect(inserted).toHaveLength(1)
    expect(inserted[0].possible_duplicate_of).toBe('stored-1')
    expect(result.data?.mergedDuplicateCount).toBe(0)
    expect(updates).toHaveLength(0)
  })

  it('never rewrites a transaction the user has already acted on', async () => {
    const today = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const approved = {
      id: 'stored-approved',
      amount: 450, type: 'debit', date: today,
      merchant: 'Swiggy',
      description: 'My own edited description',
      reference_id: null, payment_mode: 'unknown',
      card_issuer: null, card_brand: null, transaction_time: null,
      confidence_score: 95,
      approval_status: 'approved',          // user approved it
      category_confirmed_at: '2026-08-11T00:00:00Z', // and confirmed the category
      email_message_id: 'msg-old-approved',
      merged_email_message_ids: null,
    }
    mockGmail([MERCHANT_RECEIPT])

    const inserted: any[] = []
    const updates: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMergeDb([approved], inserted, updates),
      askAI: async () => null,
    })

    // Unproven look-alike: the receipt becomes its own flagged row and the
    // approved transaction is not written to at all.
    expect(inserted).toHaveLength(1)
    expect(inserted[0].possible_duplicate_of).toBe('stored-approved')
    expect(updates).toHaveLength(0)
  })

  it('treats an already-absorbed email id as seen on the next scan', async () => {
    const today = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const stored = {
      id: 'stored-merged',
      amount: 450, type: 'debit', date: today,
      merchant: 'Swiggy', description: 'Swiggy order',
      reference_id: '445566778899', payment_mode: 'upi',
      card_issuer: 'HDFC', card_brand: null, transaction_time: null,
      confidence_score: 90,
      approval_status: 'pending', category_confirmed_at: null,
      email_message_id: 'msg-bank-alert',
      merged_email_message_ids: ['msg-merchant-receipt'],
    }
    mockGmail([MERCHANT_RECEIPT])

    const inserted: any[] = []
    const updates: any[] = []
    const askAI = vi.fn(async () => null)
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMergeDb([stored], inserted, updates),
      askAI: askAI as any,
    })

    // Dedup catches it before any work — no insert, no update, no AI call.
    expect(inserted).toHaveLength(0)
    expect(updates).toHaveLength(0)
    expect(askAI).not.toHaveBeenCalled()
  })
})

// ============================================================
// D6 / R11 — foreign-currency transactions are captured as what they are.
//
// The bug: amount extraction only recognised rupee markers, while the AI path
// returns a bare number for ANY currency. A USD 50 charge was therefore either
// invisible or stored indistinguishably from Rs.50 — a wrong number in the
// ledger, worse than a missing one.
// ============================================================

describe('scanRealGmailInbox — foreign currency', () => {
  function toBase64Url(text: string): string {
    return Buffer.from(text, 'utf-8').toString('base64url')
  }

  function chargeMessage(id: string, subject: string, body: string) {
    return {
      id,
      threadId: `thread-${id}`,
      snippet: body.slice(0, 80),
      internalDate: String(Date.now() - 2 * 24 * 60 * 60 * 1000),
      payload: {
        headers: [
          { name: 'Subject', value: subject },
          { name: 'From', value: 'Alerts <alerts@hdfcbank.com>' },
        ],
        mimeType: 'text/plain',
        body: { data: toBase64Url(body) },
      },
    }
  }

  function mockGmail(messages: any[]) {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
  }

  it('stores a USD charge as USD, not as rupees', async () => {
    mockGmail([chargeMessage('msg-usd', 'Debit transaction alert',
      'Your card ending 4471 was charged $50.00 at NETFLIX.COM on 10-08-26.')])

    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(inserted, []),
      askAI: async () => null, // regex path
    })

    expect(result.error).toBeNull()
    const rows = inserted.flat()
    expect(rows).toHaveLength(1)
    expect(rows[0].amount).toBe(50)
    expect(rows[0].currency).toBe('USD')
  })

  it('still stores a rupee charge as INR', async () => {
    mockGmail([chargeMessage('msg-inr', 'Debit transaction alert',
      'Rs.450.00 has been debited from your A/c XX4471 at SWIGGY on 10-08-26.')])

    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb(inserted, []),
      askAI: async () => null,
    })

    const rows = inserted.flat()
    expect(rows[0].amount).toBe(450)
    expect(rows[0].currency).toBe('INR')
  })

  it('records the currency the AI reports', async () => {
    mockGmail([chargeMessage('msg-ai-eur', 'Payment confirmation',
      'Your payment has been processed successfully.')])

    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb(inserted, []),
      askAI: async () => ({
        is_transaction: true, transaction_type: 'debit', amount: 12.99, currency: 'EUR',
        merchant: 'Spotify', category: 'Subscriptions', description: 'Spotify',
        payment_mode: 'credit_card', card_issuer: null, card_brand: null,
        transaction_time: null, reference_id: null, date: null, confidence_score: 92,
      } as any),
    })

    const rows = inserted.flat()
    expect(rows[0].currency).toBe('EUR')
    expect(rows[0].amount).toBe(12.99)
  })

  it('falls back to INR when the AI omits a currency', async () => {
    // The model returns a bare number for any currency, so an unstated one
    // must resolve explicitly rather than being left undefined.
    mockGmail([chargeMessage('msg-ai-nocur', 'Payment confirmation',
      'Your payment has been processed successfully.')])

    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb(inserted, []),
      askAI: async () => ({
        is_transaction: true, transaction_type: 'debit', amount: 300,
        merchant: 'Airtel', category: 'Other', description: 'Airtel',
        payment_mode: 'upi', card_issuer: null, card_brand: null,
        transaction_time: null, reference_id: null, date: null, confidence_score: 88,
      } as any),
    })

    expect(inserted.flat()[0].currency).toBe('INR')
  })

  it('does not merge same-amount payments in different currencies', async () => {
    // $50 and Rs.50 on the same day to the same merchant are not one payment.
    mockGmail([
      chargeMessage('msg-cur-usd', 'Debit transaction alert', 'Charged $50.00 at SWIGGY on 10-08-26.'),
      chargeMessage('msg-cur-inr', 'Debit transaction alert', 'Rs.50.00 debited at SWIGGY on 10-08-26.'),
    ])

    const inserted: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb(inserted, []),
      askAI: async () => null,
    })

    const rows = inserted.flat()
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r: any) => r.currency))).toEqual(new Set(['USD', 'INR']))
  })
})

// ============================================================
// D7 / R12 — attachment-only bills are skipped, but not silently.
// The skip itself is the owner's decision; logging it makes the cost of that
// decision measurable in the rejection audit trail.
// ============================================================

describe('scanRealGmailInbox — logs emails with no readable amount', () => {
  function toBase64Url(t: string) { return Buffer.from(t, 'utf-8').toString('base64url') }

  function msg(id: string, subject: string, body: string) {
    return {
      id, threadId: `t-${id}`, snippet: body.slice(0, 60),
      internalDate: String(Date.now() - 2 * 24 * 60 * 60 * 1000),
      payload: {
        headers: [
          { name: 'Subject', value: subject },
          { name: 'From', value: 'Billing <billing@tatapower.com>' },
        ],
        mimeType: 'text/plain',
        body: { data: toBase64Url(body) },
      },
    }
  }

  function mockGmail(messages: any[]) {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }) } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
  }

  it('logs no_amount_in_body when the amount is only in an attachment', async () => {
    mockGmail([msg('msg-pdf-bill', 'Your electricity bill payment receipt',
      'Thank you. Your payment receipt is attached as a PDF. Please find the details enclosed.')])

    const inserted: any[] = []
    const rejections: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(inserted, rejections),
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    expect(inserted.flat()).toHaveLength(0)
    expect(rejections.flat().map((r: any) => r.gate)).toContain('no_amount_in_body')
  })

  it('distinguishes balance-only amounts from no amount at all', async () => {
    mockGmail([msg('msg-balance-only', 'Account update',
      'Your payment was processed. Available balance Rs.9,999.00. Reward points balance Rs.250.00.')])

    const inserted: any[] = []
    const rejections: any[] = []
    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({
      db: makeMockDb(inserted, rejections),
      askAI: async () => null,
    })

    expect(inserted.flat()).toHaveLength(0)
    const gates = rejections.flat().map((r: any) => r.gate)
    expect(gates).toContain('only_balance_or_reward_amounts')
    expect(gates).not.toContain('no_amount_in_body')
  })
})

// ============================================================
// Self-reporting failures. Three rounds of this scanner's production stalls
// were misdiagnosed because a frozen spinner said nothing about WHERE it
// stopped. The scan now names its own stage and its own elapsed time.
// ============================================================

describe('scanRealGmailInbox — failures name their stage', () => {
  it('records the stage in the error when the scan throws', async () => {
    // The LIST call is unrecoverable — unlike a single message detail fetch,
    // which the scan deliberately survives by logging fetch_failed and moving on.
    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb([], []),
      askAI: async () => null,
    })

    expect(result.error).not.toBeNull()
    expect(result.error!.message).toMatch(/stage: /)
  })

  it('survives a single message detail fetch failing, without failing the scan', async () => {
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'm1', threadId: 't1' }] }) } as any
      }
      throw new TypeError('Failed to fetch')
    }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb([], []),
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
  })

  it('writes the stage into the failed scan log, not just the returned error', async () => {
    const logs: any[] = []
    const chain = (payload: any): any => {
      const h: any = {
        select: () => h, eq: () => h, order: () => h, gte: () => h, limit: () => h,
        single: () => Promise.resolve({ data: null, error: null }),
        insert: (row: any) => ({
          select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }),
          then: (r: any) => r({ data: [], error: null }),
        }),
        then: (r: any) => r(payload),
      }
      return h
    }
    const mockDb: any = {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } } }) },
      from: (table: string) => {
        if (table === 'email_scan_logs') {
          const h = chain({ data: [], error: null })
          h.insert = (row: any) => { logs.push(row); return { select: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) } }
          return h
        }
        return chain({ data: [], error: null })
      },
    }

    global.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as any

    const { scanRealGmailInbox } = await import('./emailScanner')
    await scanRealGmailInbox({ db: mockDb, askAI: async () => null })

    const failed = logs.find((l) => l.status === 'failed')
    expect(failed).toBeDefined()
    expect(failed.error_message).toMatch(/stage: /)
  })

  it('surfaces elapsed time on progress once a scan is not instant', async () => {
    const { formatScanProgress } = await import('./emailScanner')
    // Under 3s stays quiet; past it the label carries the number, so a
    // screenshot distinguishes "slow" from "wedged".
    expect(formatScanProgress({ phase: 'preparing', current: 0, total: 0, elapsedMs: 500 })).not.toMatch(/\(\d+s\)/)
    expect(formatScanProgress({ phase: 'preparing', current: 0, total: 0, elapsedMs: 47000 })).toMatch(/\(47s\)/)
  })
})

// ============================================================
// extractEmailBody must not block on an oversized HTML part. Same class of
// bug as stripBoilerplate's tail bound: one huge marketing email should not
// be able to stall the scan for seconds on its own, regardless of how many
// emails surround it or how often the loop yields between them.
// ============================================================

describe('scanRealGmailInbox — bounded cost on an oversized HTML email', () => {
  function toBase64Url(t: string) { return Buffer.from(t, 'utf-8').toString('base64url') }

  it('processes a very large HTML email without blocking for long', async () => {
    // ~600KB of deeply-nested table markup — the classic heavy email-template
    // shape — with a real debit alert folded in so a false negative here
    // would also be a correctness signal, not just a timing one.
    // Real content first, filler after — matches how actual bank/marketing
    // emails are shaped, and proves the truncation bound does not cost the
    // transaction itself, only the trailing bloat.
    const filler = '<tr><td><table><tr><td>lorem ipsum filler layout cell</td></tr></table></td></tr>'.repeat(4000)
    const html = `<html><body><p>Rs.450.00 debited from your account XX4471 at SWIGGY on 10-08-26.</p>${filler}</body></html>`

    const messages = [{
      id: 'msg-huge-html', threadId: 't-huge', snippet: 'debited',
      internalDate: String(Date.now() - 2 * 24 * 60 * 60 * 1000),
      payload: {
        headers: [
          { name: 'Subject', value: 'Debit transaction alert' },
          { name: 'From', value: 'Alerts <alerts@hdfcbank.com>' },
        ],
        mimeType: 'text/html',
        body: { data: toBase64Url(html) },
      },
    }]

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }) } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const inserted: any[] = []
    const start = Date.now()
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(inserted, []),
      askAI: async () => null,
    })

    expect(Date.now() - start).toBeLessThan(3000)
    expect(result.error).toBeNull()
    expect(inserted.flat()).toHaveLength(1)
    expect(inserted.flat()[0].amount).toBe(450)
  })

  // Regression test for the actual root cause of the "Page Unresponsive"
  // freeze: the previous fix truncated the DECODED html to MAX_HTML_PARSE_CHARS
  // but decoded the FULL, untruncated base64 body first. A marketing email
  // with a large inline base64 image in its text/html part (common — these
  // are exactly the emails the bulk-marketing gate exists to filter) still
  // paid the full decode cost, which is a synchronous byte-copy loop over
  // the entire binary length. This test uses a raw body far larger than the
  // 600KB case above — big enough that decoding it in full (rather than a
  // bounded prefix) would blow the time budget on its own.
  it('does not decode more of an oversized HTML part than the parse bound needs', async () => {
    // ~160MB of raw HTML — the size class of a heavy template with a large
    // inline base64 image, not just a bloated text layout. Real content
    // first, so a regression that decodes nothing at all would also fail on
    // correctness. Sized well past the point where an unbounded decode blows
    // the time budget on its own (direct benchmark: ~10s unbounded vs ~15ms
    // bounded at this scale — a wide, non-flaky margin either side of the
    // 5s assertion below).
    const filler = '<tr><td><table><tr><td>lorem ipsum filler layout cell</td></tr></table></td></tr>'.repeat(2000000)
    const html = `<html><body><p>Rs.450.00 debited from your account XX4471 at SWIGGY on 10-08-26.</p>${filler}</body></html>`

    const messages = [{
      id: 'msg-massive-html', threadId: 't-massive', snippet: 'debited',
      internalDate: String(Date.now() - 2 * 24 * 60 * 60 * 1000),
      payload: {
        headers: [
          { name: 'Subject', value: 'Debit transaction alert' },
          { name: 'From', value: 'Alerts <alerts@hdfcbank.com>' },
        ],
        mimeType: 'text/html',
        body: { data: toBase64Url(html) },
      },
    }]

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }) } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) return { ok: true, status: 200, json: async () => hit } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    const inserted: any[] = []
    const start = Date.now()
    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: makeMockDb(inserted, []),
      askAI: async () => null,
    })

    expect(Date.now() - start).toBeLessThan(5000)
    expect(result.error).toBeNull()
    expect(inserted.flat()).toHaveLength(1)
    expect(inserted.flat()[0].amount).toBe(450)
    // Explicit vitest timeout: building the ~160MB fixture above costs a
    // couple of seconds on its own and is charged to the test's own budget,
    // which left barely any margin under the 5s default and made this fail
    // spuriously on a loaded machine. The behavioural assertion is still the
    // 5s one above — it starts timing after the fixture exists.
  }, 30000)
})

// ============================================================
// R4 — "never reconsider an email already considered in an earlier scan."
// This was previously honoured only in Stage A, i.e. AFTER every message body
// had already been downloaded and decoded. Combined with R3's strict rolling
// 7-day window (every scan re-lists the whole week), that meant each scan
// re-fetched ~160 message bodies in order to process the handful that were
// actually new. The check has to happen before the network cost, not after it.
// ============================================================

describe('scanRealGmailInbox — skips already-processed mail before fetching it', () => {
  it('never requests a message body for an email an earlier scan already handled', async () => {
    const messages = [
      makeAxisEmiGmailMessage('msg-seen-1'),
      makeAxisEmiGmailMessage('msg-seen-2'),
      makeAxisEmiGmailMessage('msg-fresh'),
    ]
    const bodyFetches: string[] = []

    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return {
          ok: true, status: 200,
          json: async () => ({ messages: messages.map((m) => ({ id: m.id, threadId: m.threadId })) }),
        } as any
      }
      const hit = messages.find((m) => url.includes(`/messages/${m.id}`))
      if (hit) {
        bodyFetches.push(hit.id)
        return { ok: true, status: 200, json: async () => hit } as any
      }
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any

    // Two of the three are already stored from a previous scan.
    const storedRows = [
      { id: 'txn-1', email_message_id: 'msg-seen-1', merged_email_message_ids: null },
      { id: 'txn-2', email_message_id: 'msg-seen-2', merged_email_message_ids: null },
    ]

    const txnHandler: any = {
      select: () => txnHandler, eq: () => txnHandler, order: () => txnHandler,
      limit: () => txnHandler, gte: () => txnHandler,
      single: () => Promise.resolve({ data: storedRows, error: null }),
      insert: () => ({
        select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }),
        then: (resolve: any) => resolve({ data: [], error: null }),
      }),
      then: (resolve: any) => resolve({ data: storedRows, error: null }),
    }

    const mockDb: any = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } },
        }),
      },
      from: (table: string) => {
        if (table === 'transactions') return txnHandler
        return makeTableMock({ data: [], error: null })
      },
    }

    const { scanRealGmailInbox } = await import('./emailScanner')
    const result = await scanRealGmailInbox({
      db: mockDb,
      askAI: async () => null,
    })

    expect(result.error).toBeNull()
    // The two seen ids cost no network round trip at all — not "were fetched
    // and then skipped", which is what the old ordering did.
    expect(bodyFetches).toEqual(['msg-fresh'])
  })
})

// ============================================================
// A total AI outage must be visible.
//
// `null` from the classifier means "no AI opinion on this email", and the
// engine deliberately answers that with the regex ladder rather than dropping
// the email (guardrail 3). That per-email tolerance is correct — but it also
// meant a classifier that was answering NOTHING, ever, looked exactly like a
// classifier having a quiet day. Google retired gemini-2.0-flash on
// 1 June 2026; every call 404'd from then on; the scanner logged ten weeks of
// clean successes while categorising every email with regex alone. The only
// symptom was that the output quietly got worse.
// ============================================================
describe('scanRealGmailInbox — AI outage is recorded, not swallowed', () => {
  const scanLogInserts: any[] = []

  function makeLogCapturingDb(insertedTransactions: any[]): any {
    // Reads and inserts must answer differently. The manual-quota check reads
    // email_scan_logs and maps over `data`, so a read has to yield an array;
    // the scan-log insert then reads back a single row.
    const table = (readResponse: any, capture?: any[], insertResponse: any = readResponse) => {
      const handler: any = {
        select: () => handler, eq: () => handler, order: () => handler, limit: () => handler, gte: () => handler,
        single: () => Promise.resolve(readResponse),
        update: () => handler,
        insert: (row: any) => {
          capture?.push(row)
          return { select: () => ({ single: () => Promise.resolve(insertResponse) }), then: (r: any) => r(insertResponse) }
        },
        then: (r: any) => r(readResponse),
      }
      return handler
    }
    return {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } } }) },
      from: (name: string) => {
        if (name === 'email_scan_logs') {
          return table({ data: [], error: null }, scanLogInserts, { data: { id: 'log-1' }, error: null })
        }
        if (name === 'transactions') return table({ data: [], error: null }, insertedTransactions)
        if (name === 'categories') return table({ data: [{ name: 'Other', is_permanent: true }], error: null })
        return table({ data: [], error: null })
      },
    }
  }

  beforeEach(() => {
    scanLogInserts.length = 0
    const msg = makeAxisEmiGmailMessage('msg-ai-health-1')
    global.fetch = vi.fn(async (url: string) => {
      if (url.includes('/messages?')) {
        return { ok: true, status: 200, json: async () => ({ messages: [{ id: msg.id, threadId: msg.threadId }] }) } as any
      }
      if (url.includes(`/messages/${msg.id}`)) return { ok: true, status: 200, json: async () => msg } as any
      throw new Error(`Unexpected fetch URL in test: ${url}`)
    }) as any
  })

  it('flags the scan log when the AI gave no verdict on a single email', async () => {
    const inserted: any[] = []
    const { scanRealGmailInbox, AI_UNAVAILABLE_NOTE } = await import('./emailScanner')

    const result = await scanRealGmailInbox({
      db: makeLogCapturingDb(inserted),
      askAIBatch: async (emails) => new Map(emails.map((e) => [e.index, null])),
      askAI: async () => null,
    })

    // Guardrail 3 still holds: the scan succeeds and the transaction survives.
    expect(result.error).toBeNull()
    expect(inserted.flat()).toHaveLength(1)

    const log = scanLogInserts.flat().find((r: any) => r.status === 'success')
    expect(log.error_message).toContain(AI_UNAVAILABLE_NOTE)
  })

  it('leaves the note off when the AI did answer', async () => {
    const inserted: any[] = []
    const { scanRealGmailInbox, AI_UNAVAILABLE_NOTE } = await import('./emailScanner')

    await scanRealGmailInbox({
      db: makeLogCapturingDb(inserted),
      askAIBatch: async (emails) =>
        new Map(emails.map((e) => [e.index, {
          is_transaction: true, transaction_type: 'debit', amount: 5000, currency: 'INR',
          merchant: 'Axis', category: 'Other', description: 'EMI', payment_mode: 'net_banking',
          card_issuer: null, card_brand: null, transaction_time: null, reference_id: null,
          date: null, confidence_score: 95,
        } as any])),
    })

    const log = scanLogInserts.flat().find((r: any) => r.status === 'success')
    expect(log.error_message ?? '').not.toContain(AI_UNAVAILABLE_NOTE)
  })
})

describe('extractCardLast4 — ReDoS regression', () => {
  it('returns promptly on a long masking run with no trailing card digits', () => {
    const evil = 'Card ending ' + 'x'.repeat(35) + '!'
    const started = Date.now()
    const result = extractCardLast4(evil)
    const elapsed = Date.now() - started
    expect(result).toBeNull()
    expect(elapsed).toBeLessThan(1000)
  })

  it('still extracts the last 4 from every masking format in use', () => {
    expect(extractCardLast4('spent on card xxxx1234')).toBe('1234')
    expect(extractCardLast4('Card XXXX-5678 debited')).toBe('5678')
    expect(extractCardLast4('card ****4321 charged')).toBe('4321')
    expect(extractCardLast4('Card ending 9876')).toBe('9876')
    expect(extractCardLast4('HDFC Card XXXX-XXXX-XXXX-2468')).toBe('2468')
  })
})

describe('hard-accept subjects must assert that money moved', () => {
  const isHardAccepted = (subject: string) => HARD_ACCEPT_SUBJECT_PATTERNS.some((p) => p.test(subject))

  it('does not override the AI on a bare CRED mention', () => {
    expect(isHardAccepted('Your CRED coins are expiring soon')).toBe(false)
    expect(isHardAccepted('CRED Cashback offers just for you')).toBe(false)
  })

  it('still overrides the AI on a genuine CRED bill payment', () => {
    expect(isHardAccepted('Payment successful on CRED for your HDFC card bill')).toBe(true)
    expect(isHardAccepted('CRED: your credit card bill payment is complete')).toBe(true)
  })
})

describe('extractEmailBody bounds total decoded size across parts', () => {
  const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_')

  it('caps the body no matter how many text parts the email has', () => {
    // 40 parts x 20KB each. The per-part bound is 60000, so before the total
    // budget existed this decoded ~800KB and returned all of it.
    const chunk = 'Axis Nifty Energy Index Fund NFO is now live. '.repeat(450)
    const parts = Array.from({ length: 40 }, () => ({
      mimeType: 'text/plain',
      body: { data: b64(chunk) },
    }))
    const mail = { payload: { mimeType: 'multipart/mixed', parts }, snippet: 's' }

    const body = extractEmailBody(mail)

    expect(body.length).toBeLessThanOrEqual(60000)
  })

  it('still reads a normal single-part bank alert in full', () => {
    const alert = 'INR 200.00 was debited from your A/c no. XX5154 at SWIGGY on 14-08-2026.'
    const mail = { payload: { mimeType: 'text/plain', body: { data: b64(alert) } }, snippet: '' }

    expect(extractEmailBody(mail)).toContain('INR 200.00 was debited')
  })

  it('still prefers the part that actually carries an amount', () => {
    const noAmount = 'Newsletter header with no money in it at all.'
    const withAmount = 'Rs. 2247.97 was spent on your HDFC card.'
    const mail = {
      payload: {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: { data: b64(noAmount) } },
          { mimeType: 'text/html', body: { data: b64(`<html><body><p>${withAmount}</p></body></html>`) } },
        ],
      },
      snippet: '',
    }

    expect(extractEmailBody(mail)).toContain('2247.97')
  })
})

describe('extractEmailBody — space-padded plain-text parts', () => {
  const b64url = (s: string) =>
    Buffer.from(s, 'utf-8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_')

  const pad = (n: number) => ' '.repeat(n)

  // Mirrors the real CRED bill-payment mail of 2026-08-16 (Gmail id
  // 1a008f9f49b569df). Its multipart/alternative text/plain part uses long runs
  // of spaces as visual padding, which put ₹10,000.00 at character 2204 — past
  // the 2000-character slice every gate reads — while the HTML alternative says
  // the same thing densely. The scan rejected a real ₹10,000 payment as
  // no_amount_in_body.
  const paddedPlain =
    pad(150) + 'Piyush,' + pad(120) + 'here is your payment' + pad(24) + 'confirmation' +
    pad(340) + 'Your credit card payment was successful' + pad(53) + 'in 16 seconds' +
    pad(530) + 'HDFC Bank' + pad(160) + '•••• 7185' + pad(400) +
    'payment details' + pad(280) + 'amount paid' + pad(62) + '₹10,000.00' + pad(380) +
    'payment date' + pad(67) + 'Aug 16, 2026'

  const html =
    '<html><body><p>Your credit card payment was successful</p>' +
    '<table><tr><td>amount paid</td><td>₹10,000.00</td></tr></table></body></html>'

  const makeMail = () => ({
    id: 'padded-plain',
    internalDate: String(Date.now()),
    snippet: '',
    payload: {
      mimeType: 'multipart/alternative',
      headers: [{ name: 'Subject', value: 'your credit card bill payment was successful' }],
      parts: [
        { mimeType: 'text/plain', body: { data: b64url(paddedPlain) } },
        { mimeType: 'text/html', body: { data: b64url(html) } },
      ],
    },
  })

  it('puts the amount inside the 2000-character parsing window', () => {
    const body = extractEmailBody(makeMail())
    expect(body.indexOf('₹10,000.00')).toBeGreaterThanOrEqual(0)
    expect(body.indexOf('₹10,000.00')).toBeLessThan(2000)
  })

  it('extracts ₹10,000 from the same slice the gates read', () => {
    const content =
      `your credit card bill payment was successful ${extractEmailBody(makeMail())}`.substring(0, 2000)
    const matches = extractAmountMatches(content)
    expect(matches).toHaveLength(1)
    expect(matches[0].value).toBe(10000)
    expect(matches[0].currency).toBe('INR')
  })

  it('keeps words separated rather than running them together', () => {
    expect(extractEmailBody(makeMail())).toContain('amount paid ₹10,000.00')
  })
})
