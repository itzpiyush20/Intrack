# Universal Vendor-Agnostic Email Transaction Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Gmail transaction scanner detect receipts from any vendor — known or never-seen-before — instead of silently dropping emails that don't match bank-alert phrasing or a hardcoded vendor list.

**Architecture:** Widen the Gmail fetch query to generic receipt language, give the AI classifier its own quota (split from the unrelated AI-insights feature) so it becomes the primary parser instead of a starved fallback, generalize one boilerplate-stripper pattern, and close every silent-drop point in the regex fallback path so unresolved-but-receipt-shaped emails land as `pending` transactions (never auto-approved) instead of vanishing.

**Tech Stack:** TypeScript, Vitest, Supabase (Postgres), Vercel serverless functions (`api/*.ts`), Gmail API, Gemini API.

Spec: [docs/superpowers/specs/2026-08-11-merchant-receipt-email-detection-design.md](../specs/2026-08-11-merchant-receipt-email-detection-design.md)

---

## Task 1: Generalize the boilerplate-stripper "do not share" pattern

**Files:**
- Modify: `src/services/emailBoilerplate.ts:22`
- Test: `src/services/emailBoilerplate.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/services/emailBoilerplate.test.ts` (inside the existing `describe('stripBoilerplate', ...)` block):

```typescript
  it('removes the "do not share these details" security sentence (Zomato-style phrasing)', () => {
    const body = `Thank you for ordering from Patiala House. Total paid - ₹286.47. Eternal employees or representatives will NEVER ask you for your personal information i.e. your bank account details, password, PIN, CVV, OTP etc. For your own safety, DO NOT share these details with anyone over phone, SMS or email.`
    const result = stripBoilerplate(body)
    expect(result).not.toMatch(/DO NOT share these details/i)
    expect(result).not.toMatch(/CVV, OTP/i)
    expect(result).toContain('Total paid - ₹286.47')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/emailBoilerplate.test.ts`
Expected: FAIL — the new test's `not.toMatch(/DO NOT share these details/i)` assertion fails because the current pattern only matches "do not share **your** ...".

- [ ] **Step 3: Broaden the pattern**

In `src/services/emailBoilerplate.ts`, replace line 22:

```typescript
  /\bdo\s+not\s+share\s+your[^.]*?(?:otp|cvv|pin|password|card\s*number)[^.]*\./gi,
```

with:

```typescript
  /\bdo\s+not\s+share\s+(?:your|these|this|such)[^.]*?(?:otp|cvv|pin|password|card\s*number|details)[^.]*\./gi,
```

(Also add `details` as an acceptable trailing noun, since "share these **details**" doesn't repeat "OTP/CVV/PIN/password/card number" verbatim before the sentence boundary in the Zomato fixture — the sentence is "DO NOT share these details with anyone..." with the actual sensitive-info words in the *preceding* sentence. Verify against the fixture in Step 4; if this single pattern doesn't fully remove the two-sentence block, extend the OTP/PIN/CVV sentence pattern at the same file to also accept "will NEVER ask you for your personal information i.e. ... etc." as its own sentence-boundary match — add:)

```typescript
  /\b\S+\s+(?:employees|representatives)?\s*(?:or\s+representatives)?\s+will\s+never\s+ask\s+you\s+for\s+your\s+personal\s+information[^.]*\./gi,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/emailBoilerplate.test.ts`
Expected: PASS — all tests in the file green, including the new one and the pre-existing Axis EMI regression tests (confirm nothing regressed).

- [ ] **Step 5: Commit**

```bash
git add src/services/emailBoilerplate.ts src/services/emailBoilerplate.test.ts
git commit -m "fix: strip 'do not share these/this details' security footers

Generalizes the existing 'do not share your ...' boilerplate pattern to
also match 'these/this/such details' phrasing (e.g. Zomato's security
footer), which was surviving the stripper and tripping the OTP gate on
otherwise-genuine transaction emails."
```

---

## Task 2: Add real Uber/Zomato and synthetic unknown-vendor fixtures

**Files:**
- Create: `src/services/__fixtures__/uberTripReceipt.ts`
- Create: `src/services/__fixtures__/zomatoOrderReceipt.ts`
- Create: `src/services/__fixtures__/unknownVendorReceipt.ts`

These follow the exact pattern of the existing `src/services/__fixtures__/axisEmiDebit.ts` (subject/from/body constants + a `makeXGmailMessage()` helper that base64url-encodes the body into a mocked Gmail API response). No test in this task — these are test infrastructure consumed by Tasks 3–5's tests.

- [ ] **Step 1: Create the Uber fixture**

Write `src/services/__fixtures__/uberTripReceipt.ts`:

```typescript
// src/services/__fixtures__/uberTripReceipt.ts
//
// Real (redacted) Uber trip receipt that the scanner silently dropped
// before this fix. Contains no bank-style debit keyword ("paid",
// "debited", "charged") anywhere in the body — it's receipt-shaped, not
// alert-shaped — which is exactly the class of email the fetch query,
// debit/credit classifier, and confidence scoring all previously assumed
// would never happen.

export const UBER_TRIP_SUBJECT = '[Personal] Your Monday evening trip with Uber'

export const UBER_TRIP_FROM = 'Uber Receipts <noreply@uber.com>'

export const UBER_TRIP_BODY = `Thanks for riding, Piyush
We hope you enjoyed your ride this evening.

Total ₹224.76

Booking fee ₹10.00
Suggested fare ₹214.76

Payments
Visa ••••2000 (Piyush Amazon ICICI) ₹224.76
8/10/26 10:25 pm

This receipt reflects the suggested fare (excluding GST) and is not a tax invoice but it can be used for official reimbursement purposes. No GST is being recovered by Uber from the riders on this trip.

Trip details
Uber Go
11.52 kilometres, 26 minutes

Need help?
Our support team is happy to help with any concern you might have.`

/** Base64url-encode text the way Gmail's API does for message body parts. */
function toBase64Url(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64url')
}

/** A full mocked Gmail `messages.get` response for the Uber trip receipt, for integration tests. */
export function makeUberTripGmailMessage(id = 'msg-uber-trip-1') {
  return {
    id,
    threadId: 'thread-uber-trip-1',
    snippet: 'Thanks for riding, Piyush. We hope you enjoyed your ride this evening. Total ₹224.76...',
    internalDate: String(Date.UTC(2026, 7, 10, 16, 55, 17)),
    payload: {
      headers: [
        { name: 'Subject', value: UBER_TRIP_SUBJECT },
        { name: 'From', value: UBER_TRIP_FROM },
      ],
      mimeType: 'text/plain',
      body: { data: toBase64Url(UBER_TRIP_BODY) },
    },
  }
}
```

- [ ] **Step 2: Create the Zomato fixture**

Write `src/services/__fixtures__/zomatoOrderReceipt.ts`:

```typescript
// src/services/__fixtures__/zomatoOrderReceipt.ts
//
// Real (redacted) Zomato order receipt that the scanner silently dropped
// before this fix. Its security footer ("do not share these details")
// wasn't covered by the boilerplate stripper's "do not share your ..."
// pattern, so the survived footer's "OTP" mention tripped the
// otp_or_security_code gate.

export const ZOMATO_ORDER_SUBJECT = 'Your Zomato order from Patiala House'

export const ZOMATO_ORDER_FROM = 'Zomato <noreply@zomato.com>'

export const ZOMATO_ORDER_BODY = `Hi Piyush Khandelwal,
Thank you for ordering from Patiala House

ORDER ID: 8454583228

Delivered

Patiala House
Plot 516/1728/3687, 3rd Floor, Kamal Heights, Ward 3, Patia, Bhubaneshwar

1 X Malai Kofta

Total paid - ₹286.47

Eternal employees or representatives will NEVER ask you for your personal information i.e. your bank account details, password, PIN, CVV, OTP etc. For your own safety, DO NOT share these details with anyone over phone, SMS or email.

©2026 - Zomato, All rights reserved.
Eternal Limited (Formerly known as Zomato Limited) • GF-12A, 94 Meghdoot, Nehru Place, New Delhi-110019`

function toBase64Url(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64url')
}

/** A full mocked Gmail `messages.get` response for the Zomato order receipt, for integration tests. */
export function makeZomatoOrderGmailMessage(id = 'msg-zomato-order-1') {
  return {
    id,
    threadId: 'thread-zomato-order-1',
    snippet: 'Hi Piyush Khandelwal, Thank you for ordering from Patiala House ORDER ID: 8454583228 Delivered...',
    internalDate: String(Date.UTC(2026, 7, 10, 15, 15, 21)),
    payload: {
      headers: [
        { name: 'Subject', value: ZOMATO_ORDER_SUBJECT },
        { name: 'From', value: ZOMATO_ORDER_FROM },
      ],
      mimeType: 'text/plain',
      body: { data: toBase64Url(ZOMATO_ORDER_BODY) },
    },
  }
}
```

- [ ] **Step 3: Create the synthetic unknown-vendor fixture**

Write `src/services/__fixtures__/unknownVendorReceipt.ts`:

```typescript
// src/services/__fixtures__/unknownVendorReceipt.ts
//
// Wholly synthetic receipt from a vendor that does not exist anywhere in
// KNOWN_MERCHANTS, TRUSTED_SENDER_DOMAINS, or any other list in this
// codebase. Proves that detection works for a vendor the app has never
// seen before, not just for Uber/Zomato specifically.

export const UNKNOWN_VENDOR_SUBJECT = 'Your order from Ramesh Tiffin Service'

export const UNKNOWN_VENDOR_FROM = 'Ramesh Tiffin Service <orders@rameshtiffins.example>'

export const UNKNOWN_VENDOR_BODY = `Hello,

Your daily tiffin order has been delivered.

Order #4471
1 X Full Thali

Total ₹120.00

Thank you for choosing Ramesh Tiffin Service!`

function toBase64Url(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64url')
}

/** A full mocked Gmail `messages.get` response for the unknown-vendor receipt, for integration tests. */
export function makeUnknownVendorGmailMessage(id = 'msg-unknown-vendor-1') {
  return {
    id,
    threadId: 'thread-unknown-vendor-1',
    snippet: 'Hello, Your daily tiffin order has been delivered. Order #4471 1 X Full Thali Total ₹120.00...',
    internalDate: String(Date.UTC(2026, 7, 10, 12, 0, 0)),
    payload: {
      headers: [
        { name: 'Subject', value: UNKNOWN_VENDOR_SUBJECT },
        { name: 'From', value: UNKNOWN_VENDOR_FROM },
      ],
      mimeType: 'text/plain',
      body: { data: toBase64Url(UNKNOWN_VENDOR_BODY) },
    },
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/services/__fixtures__/uberTripReceipt.ts src/services/__fixtures__/zomatoOrderReceipt.ts src/services/__fixtures__/unknownVendorReceipt.ts
git commit -m "test: add Uber, Zomato, and unknown-vendor email fixtures

Real (redacted) fixtures for the two reported missed transactions, plus
a wholly synthetic unknown-vendor fixture proving the upcoming fix isn't
specific to these two senders."
```

---

## Task 3: Widen the Gmail fetch query to generic receipt language

**Files:**
- Modify: `src/services/emailScanner.ts:882`
- Test: `src/services/emailScanner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/services/emailScanner.test.ts` (new `describe` block, after the existing Axis EMI one):

```typescript
describe('scanRealGmailInbox — fetch query includes receipt-shaped keywords', () => {
  it('builds a Gmail query that matches both bank-alert and generic receipt language', async () => {
    let capturedUrl = ''
    const mockDb: any = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: 'user-1', email: 'test@example.com' }, access_token: 'tok' } },
        }),
      },
      from: (table: string) => {
        const handler: any = {
          select: () => handler, eq: () => handler, order: () => handler, limit: () => handler,
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
    await scanRealGmailInbox({ db: mockDb, activeYear: 2026, askAI: async () => null })

    const decodedQuery = decodeURIComponent(capturedUrl.match(/[?&]q=([^&]+)/)?.[1] || '')
    expect(decodedQuery).toMatch(/debited OR credited/i)
    expect(decodedQuery).toMatch(/receipt OR invoice OR order OR booking OR trip OR fare OR ride OR subscription OR renewal OR total/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/emailScanner.test.ts -t "fetch query includes receipt-shaped keywords"`
Expected: FAIL — the decoded query string has no `receipt OR invoice OR ...` group yet.

- [ ] **Step 3: Widen `EMAIL_KEYWORDS`**

In `src/services/emailScanner.ts`, replace line 882:

```typescript
    const EMAIL_KEYWORDS = '(debited OR credited OR spent OR paid OR payment OR txn OR transaction OR transfer OR received OR withdrawn OR charged OR neft OR imps OR rtgs OR netbanking OR upi OR emi OR sip OR salary)'
```

with:

```typescript
    // Two OR-ed groups: the original bank-alert-style keywords, plus generic
    // receipt-shaped language that direct-vendor emails use instead (a trip
    // receipt or food-delivery order confirmation rarely says "debited" or
    // "paid" — it says "receipt", "order", "trip", "total"). Together these
    // widen the fetch net without fetching every email in the window.
    const BANK_ALERT_KEYWORDS = '(debited OR credited OR spent OR paid OR payment OR txn OR transaction OR transfer OR received OR withdrawn OR charged OR neft OR imps OR rtgs OR netbanking OR upi OR emi OR sip OR salary)'
    const RECEIPT_KEYWORDS = '(receipt OR invoice OR order OR booking OR trip OR fare OR ride OR subscription OR renewal OR total)'
    const EMAIL_KEYWORDS = `(${BANK_ALERT_KEYWORDS} OR ${RECEIPT_KEYWORDS})`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/emailScanner.test.ts`
Expected: PASS — new test passes, and the pre-existing Axis EMI regression test still passes (its fetch mock only checks `url.includes('/messages?')`, unaffected by the query contents).

- [ ] **Step 5: Commit**

```bash
git add src/services/emailScanner.ts src/services/emailScanner.test.ts
git commit -m "fix: widen Gmail fetch query to catch receipt-shaped vendor emails

The fetch query previously required bank-alert phrasing (debited, paid,
transaction, ...). A direct vendor receipt (Uber trip, Zomato order) uses
neither and was never fetched at all, regardless of any downstream gate
or scoring fix. Adds a second OR-ed keyword group for generic receipt
language, vendor-agnostic by construction — no per-vendor list."
```

---

## Task 4: Stop silently dropping emails with no debit/credit keyword match

**Files:**
- Modify: `src/services/emailScanner.ts:1183-1191`
- Test: `src/services/emailScanner.test.ts`

- [ ] **Step 1: Add a shared mock-DB helper at module scope**

Add this near the top of `src/services/emailScanner.test.ts`, alongside the existing `makeTableMock` helper (outside any `describe` block, so both this task's and Task 5's `describe` blocks can call it):

```typescript
import { makeUberTripGmailMessage } from './__fixtures__/uberTripReceipt'
import { makeUnknownVendorGmailMessage } from './__fixtures__/unknownVendorReceipt'
import { makeZomatoOrderGmailMessage } from './__fixtures__/zomatoOrderReceipt'

/** Shared across the "no debit/credit keyword" and "low confidence" test groups below. */
function makeMockDb(insertedTransactions: any[], insertedRejections: any[]) {
  const makeTableMock = (response: any, opts: { insertCapture?: any[] } = {}) => {
    const handler: any = {
      select: () => handler, eq: () => handler, order: () => handler, limit: () => handler,
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
```

- [ ] **Step 2: Write the failing test**

Add to `src/services/emailScanner.test.ts`:

```typescript
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
    const result = await scanRealGmailInbox({ db: mockDb, activeYear: 2026, askAI: async () => null })

    expect(result.error).toBeNull()
    expect(insertedTransactions).toHaveLength(1)
    const txn = insertedTransactions[0][0]
    expect(txn.amount).toBe(224.76)
    expect(txn.type).toBe('debit')
    expect(txn.approval_status).toBe('pending')

    expect(insertedRejections.some((r: any) => r[0].gate === 'no_debit_credit_signal')).toBe(true)
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
    const result = await scanRealGmailInbox({ db: mockDb, activeYear: 2026, askAI: async () => null })

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
    const result = await scanRealGmailInbox({ db: mockDb, activeYear: 2026, askAI: async () => null })

    expect(result.error).toBeNull()
    expect(insertedTransactions).toHaveLength(1)
    const txn = insertedTransactions[0][0]
    expect(txn.amount).toBe(286.47)
    expect(txn.type).toBe('debit')
    expect(txn.approval_status).toBe('pending')
    // This email's own debit signal ("Total paid") is clear on its own —
    // it should NOT need the no_debit_credit_signal fallback from this task.
    expect(insertedRejections.some((r: any) => r[0].gate === 'no_debit_credit_signal')).toBe(false)
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
      internalDate: String(Date.UTC(2026, 7, 10, 9, 0, 0)),
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
    await scanRealGmailInbox({ db: mockDb, activeYear: 2026, askAI: async () => null })

    expect(insertedTransactions).toHaveLength(0)
    expect(insertedRejections.some((r: any) => r[0].gate === 'promotional_spam')).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/services/emailScanner.test.ts -t "receipt-shaped emails with no debit/credit keyword"`
Expected: The Uber and unknown-vendor tests FAIL (both currently dropped — `insertedTransactions` has length 0 — since line 1191's `continue` exits the loop before any insert). The Zomato test also currently FAILS, but for a *different* reason: Task 1 already fixed the stripper, so the footer no longer trips the OTP gate — but without this task's change, if Zomato's own "Total paid" signal were ever ambiguous the email would still just fall through normally (it isn't blocked by line 1191, since "paid" already scores debitScore > 0), so in practice this test should already pass after Task 1 alone. Verify this: if it fails, check whether the failure is from the OTP gate (Task 1 regression) or from something else before proceeding. The promo test already PASSES (the unchanged `promotional_spam` gate already rejects it) — included as a guardrail regression check for this task's change, not a new failing case.

- [ ] **Step 4: Remove the silent drop, add logging**

In `src/services/emailScanner.ts`, replace lines 1183-1191:

```typescript
        if (debitScore === 0 && creditScore === 0) {
          debitWords.forEach(w => { if (lowerContent.includes(w)) debitScore += 5 })
          creditWords.forEach(w => {
            if (w === 'received' && FALSE_CREDIT_RECEIVED.test(lowerContent)) return
            if (lowerContent.includes(w)) creditScore += 5
          })
        }

        if (debitScore === 0 && creditScore === 0) continue
```

with:

```typescript
        if (debitScore === 0 && creditScore === 0) {
          debitWords.forEach(w => { if (lowerContent.includes(w)) debitScore += 5 })
          creditWords.forEach(w => {
            if (w === 'received' && FALSE_CREDIT_RECEIVED.test(lowerContent)) return
            if (lowerContent.includes(w)) creditScore += 5
          })
        }

        // No debit/credit keyword anywhere near the amount — this used to be a
        // silent `continue` with no logRejection call, the one rejection point
        // in this file that left no trace. A receipt-shaped email (Uber trip,
        // Zomato order) legitimately has no such keyword, so instead of
        // dropping it, fall through: txType below naturally resolves to
        // 'debit' (creditScore is not > debitScore when both are 0) and
        // debitCreditClear is naturally false (|0-0| < 10), which correctly
        // marks the direction as inferred, not keyword-confirmed. The email
        // still has to clear every gate above and the confidence check below.
        const hadNoDirectionSignal = debitScore === 0 && creditScore === 0
        if (hadNoDirectionSignal) {
          logRejection(supabase, user.id, scanLogId, 'no_debit_credit_signal', senderDomain, subject, `amount=${amount}`)
        }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/services/emailScanner.test.ts`
Expected: PASS — all four new tests pass (Uber and unknown-vendor receipt insertion, Zomato end-to-end, and the promo guardrail). The pre-existing Axis EMI test still passes (its email has a clear "debited" keyword, so `hadNoDirectionSignal` is false and no rejection is logged for it).

- [ ] **Step 6: Commit**

```bash
git add src/services/emailScanner.ts src/services/emailScanner.test.ts
git commit -m "fix: insert pending instead of silently dropping keyword-less receipts

The debit/credit classifier dropped any email whose text near the amount
matched neither the debitWords nor creditWords list — with no
logRejection call, the only rejection point in the file that left no
trace. Receipt-shaped emails (a trip receipt, a food-delivery order) use
neither vocabulary. Now the direction defaults to 'debit' (already the
formula's natural result when both scores are 0) and the email proceeds
to insert as pending, with the miss now logged to email_scan_rejections."
```

---

## Task 5: Insert low-confidence regex-path transactions as pending instead of dropping them

**Files:**
- Modify: `src/services/emailScanner.ts:1001-1006, 1294-1301, 1337, 1364, 1377`
- Test: `src/services/emailScanner.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/services/emailScanner.test.ts`, reusing the module-scoped `makeMockDb` helper and `makeUberTripGmailMessage` import added in Task 4 (both already at the top of the file — no new imports needed for this test):

```typescript
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
    const result = await scanRealGmailInbox({ db: mockDb, activeYear: 2026, askAI: async () => null })

    expect(insertedTransactions).toHaveLength(1)
    const txn = insertedTransactions[0][0]
    expect(txn.approval_status).toBe('pending')
    expect(txn.confidence_score).toBeLessThan(65)
    expect(insertedRejections.some((r: any) => r[0].gate === 'confidence_below_65')).toBe(true)
    expect(result.data?.lowConfidencePendingCount).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/emailScanner.test.ts -t "low regex confidence inserts pending"`
Expected: FAIL — `insertedTransactions` has length 0 (the email is dropped at the `confidence < 65` `continue`), and `result.data?.lowConfidencePendingCount` is `undefined` (field doesn't exist yet).

- [ ] **Step 3: Stop dropping on low confidence; rename the counter**

In `src/services/emailScanner.ts`, replace line 1005-1006:

```typescript
    let skippedConfidence = 0
    const skippedEmailsDetails: string[] = []
```

with:

```typescript
    // Renamed from skippedConfidence: these emails are no longer skipped —
    // they're inserted as pending transactions with their low score
    // preserved, so the name should say what actually happens to them now.
    let lowConfidencePendingCount = 0
    const lowConfidenceEmailsDetails: string[] = []
```

Then replace lines 1294-1301:

```typescript
        if (confidence < 65) {
          skippedConfidence++
          if (skippedEmailsDetails.length < 5) {
            skippedEmailsDetails.push(`${senderDomain || 'unknown'}|"${subject.substring(0, 30)}"|Conf:${confidence}`)
          }
          logRejection(supabase, user.id, scanLogId, 'confidence_below_65', senderDomain, subject, `confidence=${confidence}`)
          continue
        }
```

with:

```typescript
        // Below-threshold confidence used to drop the email outright. It now
        // still gets logged (so the audit trail in email_scan_rejections is
        // unchanged), but inserts as a pending transaction instead of being
        // discarded — approval_status is already guaranteed 'pending' here
        // (applyMerchantRulesFromDB/applyMerchantRules never return
        // 'approved'), so a low-confidence guess costs the user one
        // dismiss-tap on the Pending page rather than a permanently missing
        // transaction.
        if (confidence < 65) {
          lowConfidencePendingCount++
          if (lowConfidenceEmailsDetails.length < 5) {
            lowConfidenceEmailsDetails.push(`${senderDomain || 'unknown'}|"${subject.substring(0, 30)}"|Conf:${confidence}`)
          }
          logRejection(supabase, user.id, scanLogId, 'confidence_below_65', senderDomain, subject, `confidence=${confidence}`)
        }
```

Now find and update the three remaining references (they still say `skippedConfidence`/`skippedEmailsDetails`/wording "skipped"):

At `emailScanner.ts:1337` and `emailScanner.ts:1364`, replace both occurrences of:

```typescript
        error_message: skippedConfidence > 0 ? `${skippedConfidence} email(s) skipped (low confidence). Samples: ${skippedEmailsDetails.join('; ')}` : null,
```

and

```typescript
        error_message: skippedConfidence > 0 ? `${skippedConfidence} email(s) skipped (confidence < 65). Samples: ${skippedEmailsDetails.join('; ')}` : null,
```

with (matching each site's exact original wording style, just the new variable names and corrected verb):

```typescript
        error_message: lowConfidencePendingCount > 0 ? `${lowConfidencePendingCount} email(s) added as pending (low confidence). Samples: ${lowConfidenceEmailsDetails.join('; ')}` : null,
```

At `emailScanner.ts:1377`, replace:

```typescript
        skippedConfidence,
```

with:

```typescript
        lowConfidencePendingCount,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/emailScanner.test.ts`
Expected: PASS — all tests green, including the new one and every pre-existing test in the file.

- [ ] **Step 5: Commit**

```bash
git add src/services/emailScanner.ts src/services/emailScanner.test.ts
git commit -m "fix: insert low-confidence regex-path transactions as pending

confidence < 65 previously dropped the email after already extracting a
valid amount and surviving every gate. Since approval_status is always
'pending' regardless of confidence (an existing, tested invariant), a
low score no longer justifies discarding the transaction — it's inserted
pending with the score preserved. Renamed skippedConfidence ->
lowConfidencePendingCount throughout to describe the new behavior."
```

---

## Task 6: Update Pending page UI copy for the renamed low-confidence field

**Files:**
- Modify: `src/pages/PendingPage.tsx:155, 650, 900`

- [ ] **Step 1: Update the state type and field read**

In `src/pages/PendingPage.tsx`, replace line 155:

```typescript
    skipped: number
```

with:

```typescript
    lowConfidence: number
```

Replace line 650:

```typescript
      const skipped = (res.data as any)?.skippedConfidence || 0
```

with:

```typescript
      const lowConfidence = (res.data as any)?.lowConfidencePendingCount || 0
```

Find the `setScanSuccessMessage` call just below (around line 654) and update its `skipped` field to `lowConfidence`:

```typescript
      setScanSuccessMessage({ total: count, autoApproved, pendingReview: pendingCount, skipped })
```

becomes:

```typescript
      setScanSuccessMessage({ total: count, autoApproved, pendingReview: pendingCount, lowConfidence })
```

- [ ] **Step 2: Update the banner copy**

Replace line 900:

```typescript
                    {scanSuccessMessage.skipped > 0 ? ` · ${scanSuccessMessage.skipped} skipped (low confidence)` : ''}
```

with:

```typescript
                    {scanSuccessMessage.lowConfidence > 0 ? ` · ${scanSuccessMessage.lowConfidence} flagged low-confidence (please review)` : ''}
```

- [ ] **Step 3: Verify no other references remain**

Run: `grep -rn "skippedConfidence\|scanSuccessMessage.skipped" src/`
Expected: no output (confirms the rename is complete everywhere).

- [ ] **Step 4: Commit**

```bash
git add src/pages/PendingPage.tsx
git commit -m "fix: update Pending page copy for low-confidence transactions

These transactions are no longer skipped/dropped — they're inserted
pending like any other scan result. Copy now says 'flagged low-confidence
(please review)' instead of the now-inaccurate 'skipped'."
```

---

## Task 7: Split the AI quota into separate scan and insights counters (DB migration)

**Files:**
- Modify: `supabase/schema.sql:36-37` (add alongside, for fresh installs)
- Create: `supabase/013_ai_scan_quota_split.sql`

- [ ] **Step 1: Add the new columns to `schema.sql`**

In `supabase/schema.sql`, after line 37 (`ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_calls_reset_at ...`), add:

```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_scan_calls_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_scan_calls_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();
```

- [ ] **Step 2: Write the migration file**

Create `supabase/013_ai_scan_quota_split.sql`:

```sql
-- ============================================================
-- Migration 013 — Split AI quota: email-scan classification vs
-- AI-insights generation (one-time, run once against an existing
-- production database; the objects this creates are already part
-- of supabase/schema.sql for fresh installs)
--
-- Before this migration, analyzeTransactionEmailWithAI (called once per
-- scanned email during a Gmail scan) and generateAIInsights (a separate,
-- on-demand insights feature) shared the same ai_calls_count/
-- ai_calls_reset_at counters and the same 50-calls/day limit. A single
-- scan can touch dozens of emails, so scanning alone could exhaust the
-- shared quota and starve the unrelated insights feature (or vice
-- versa). This adds a second counter pair so the two features have
-- independent budgets.
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_scan_calls_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ai_scan_calls_reset_at TIMESTAMPTZ NOT NULL DEFAULT now();
```

- [ ] **Step 3: Apply the migration**

Run this against the Supabase project (via the Supabase SQL Editor, or `psql`/CLI if configured — check `README.md` or existing migration-runner tooling for this project's convention before running manually):

```bash
cat supabase/013_ai_scan_quota_split.sql
```

Expected: file contents print correctly; then apply via whichever mechanism the team already uses for migrations 010-012 (check for a `supabase db push` script or manual SQL-editor convention — this project's `docs/superpowers/plans/2026-08-05-email-scan-recall-fix.md` may document the convention used for migration 010).

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql supabase/013_ai_scan_quota_split.sql
git commit -m "feat: add separate AI quota counters for scan vs insights

analyzeTransactionEmailWithAI and generateAIInsights currently share one
counter and one 50/day limit. A multi-email scan can exhaust it before
the unrelated insights feature ever runs. Adds ai_scan_calls_count /
ai_scan_calls_reset_at as an independent counter pair."
```

---

## Task 8: Give `api/gemini-proxy.ts` a `purpose`-aware dual quota

**Files:**
- Modify: `api/gemini-proxy.ts`
- Test: `api/gemini-proxy.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `api/gemini-proxy.test.ts`, following the mocking pattern in `api/auto-sync-gmail.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const { mockProfileSelect, mockProfileUpdate, mockGetUser, mockGeminiFetch } = vi.hoisted(() => ({
  mockProfileSelect: vi.fn(),
  mockProfileUpdate: vi.fn(),
  mockGetUser: vi.fn(),
  mockGeminiFetch: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({ eq: () => ({ single: mockProfileSelect }) }),
          update: (payload: any) => ({ eq: (_col: string, _val: string) => { mockProfileUpdate(payload); return Promise.resolve({ error: null }) } }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

process.env.GEMINI_API_KEY = 'fake-key'
process.env.VITE_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role'

vi.stubGlobal('fetch', mockGeminiFetch)

import handler from './gemini-proxy'

function makeReqRes(body: any) {
  const req = {
    method: 'POST',
    headers: { origin: 'https://intrack-five.vercel.app', authorization: 'Bearer fake-jwt' },
    body,
  } as unknown as VercelRequest

  let statusVal = 200
  let jsonVal: any = null
  const res = {
    setHeader: () => {},
    status: (code: number) => { statusVal = code; return { json: (data: any) => { jsonVal = data }, end: () => {} } },
  } as unknown as VercelResponse

  return { req, res, getStatus: () => statusVal, getJson: () => jsonVal }
}

describe('api/gemini-proxy — purpose-aware quota split', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    mockGeminiFetch.mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) })
  })

  it('increments ai_scan_calls_count for purpose: "scan", leaving ai_calls_count untouched', async () => {
    mockProfileSelect.mockResolvedValue({
      data: { ai_calls_count: 10, ai_calls_reset_at: new Date().toISOString(), ai_scan_calls_count: 3, ai_scan_calls_reset_at: new Date().toISOString() },
      error: null,
    })

    const { req, res, getStatus } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(200)
    expect(mockProfileUpdate).toHaveBeenCalledTimes(1)
    const updatePayload = mockProfileUpdate.mock.calls[0][0]
    expect(updatePayload.ai_scan_calls_count).toBe(4)
    expect(updatePayload.ai_calls_count).toBeUndefined()
  })

  it('increments ai_calls_count for purpose: "insights" (or omitted), leaving ai_scan_calls_count untouched', async () => {
    mockProfileSelect.mockResolvedValue({
      data: { ai_calls_count: 10, ai_calls_reset_at: new Date().toISOString(), ai_scan_calls_count: 3, ai_scan_calls_reset_at: new Date().toISOString() },
      error: null,
    })

    const { req, res, getStatus } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }] })
    await handler(req, res)

    expect(getStatus()).toBe(200)
    const updatePayload = mockProfileUpdate.mock.calls[0][0]
    expect(updatePayload.ai_calls_count).toBe(11)
    expect(updatePayload.ai_scan_calls_count).toBeUndefined()
  })

  it('rejects a scan request at its own 500-call limit even when insights quota has headroom', async () => {
    mockProfileSelect.mockResolvedValue({
      data: { ai_calls_count: 0, ai_calls_reset_at: new Date().toISOString(), ai_scan_calls_count: 500, ai_scan_calls_reset_at: new Date().toISOString() },
      error: null,
    })

    const { req, res, getStatus } = makeReqRes({ contents: [{ parts: [{ text: 'x' }] }], purpose: 'scan' })
    await handler(req, res)

    expect(getStatus()).toBe(429)
    expect(mockProfileUpdate).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/gemini-proxy.test.ts`
Expected: FAIL — `handler` currently ignores `purpose` entirely, always reads/writes `ai_calls_count`, so the "scan" tests' assertions about `ai_scan_calls_count` fail (that field is never touched).

- [ ] **Step 3: Implement the purpose-aware quota**

In `api/gemini-proxy.ts`, replace lines 60-93 (from the `DAILY_AI_CALL_LIMIT` comment through the profile update, up to and including the `contents`/`generationConfig`/`safetySettings` destructure) with:

```typescript
  // Per-user daily quota, tracked in Postgres so it survives cold starts
  // (the in-memory IP limiter above resets per serverless instance and
  // doesn't actually bound cost under any real load).
  //
  // Two independent counters: email-scan classification (one call per
  // scanned email, can be dozens per scan) and AI-insights generation
  // (roughly one call per user action) used to share a single 50/day
  // limit, which meant a normal scan could exhaust the quota the
  // insights feature depends on, or vice versa. `purpose` selects which
  // counter/limit applies; omitting it preserves the original behavior
  // for any caller written before this change.
  const purpose: 'scan' | 'insights' = req.body?.purpose === 'scan' ? 'scan' : 'insights'
  const DAILY_AI_CALL_LIMIT = 50
  const DAILY_AI_SCAN_CALL_LIMIT = 500
  const countColumn = purpose === 'scan' ? 'ai_scan_calls_count' : 'ai_calls_count'
  const resetColumn = purpose === 'scan' ? 'ai_scan_calls_reset_at' : 'ai_calls_reset_at'
  const dailyLimit = purpose === 'scan' ? DAILY_AI_SCAN_CALL_LIMIT : DAILY_AI_CALL_LIMIT

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select(`${countColumn}, ${resetColumn}`)
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return res.status(500).json({ error: 'Failed to verify usage quota' })
  }

  const resetAt = new Date((profile as any)[resetColumn]).getTime()
  const needsReset = Date.now() - resetAt > 24 * 60 * 60 * 1000
  const currentCount = needsReset ? 0 : (profile as any)[countColumn]

  if (currentCount >= dailyLimit) {
    const limitMessage = purpose === 'scan' ? 'Daily AI scan limit reached. Try again tomorrow.' : 'Daily AI insights limit reached. Try again tomorrow.'
    return res.status(429).json({ error: limitMessage })
  }

  await supabaseAdmin
    .from('profiles')
    .update({
      [countColumn]: currentCount + 1,
      ...(needsReset ? { [resetColumn]: new Date().toISOString() } : {}),
    })
    .eq('id', user.id)

  const { contents, generationConfig, safetySettings } = req.body ?? {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/gemini-proxy.test.ts`
Expected: PASS — all three tests green.

Also run the full suite to confirm no other test depended on the old quota structure:

Run: `npx vitest run`
Expected: PASS (all existing tests still green).

- [ ] **Step 5: Commit**

```bash
git add api/gemini-proxy.ts api/gemini-proxy.test.ts
git commit -m "feat: split gemini-proxy quota by purpose (scan vs insights)

Reads a purpose field ('scan' | 'insights', defaulting to 'insights' for
backward compatibility) and checks/increments the matching counter pair
added in the prior migration, with its own daily limit. A large email
scan can no longer exhaust the quota the insights feature depends on."
```

---

## Task 9: Route AI calls through the new `purpose` field

**Files:**
- Modify: `src/services/aiService.ts:14-26, 360-365, 453-461` (and the `generateAIInsights` call site around line 56)
- Test: `src/services/aiService.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/services/aiService.test.ts`:

```typescript
  it('passes purpose: "scan" through to the Gemini proxy call', async () => {
    const fakeCallGemini = vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: JSON.stringify({ is_transaction: false, transaction_type: null, amount: null, merchant: null, category: null, description: null, payment_mode: null, card_issuer: null, card_brand: null, transaction_time: null, reference_id: null, date: null, confidence_score: 0 }) }] } }],
    })

    await analyzeTransactionEmailWithAI('subj', 'body', '2026-08-10', fakeCallGemini)

    expect(fakeCallGemini).toHaveBeenCalledTimes(1)
    const callArg = fakeCallGemini.mock.calls[0][0]
    expect(callArg.purpose).toBe('scan')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/aiService.test.ts`
Expected: FAIL — `callArg.purpose` is `undefined` (the field isn't sent yet).

- [ ] **Step 3: Add `purpose` to both call sites**

In `src/services/aiService.ts`, in `analyzeTransactionEmailWithAI`, find the `callGemini({...})` call (around line 453-461):

```typescript
    const data = await callGemini({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
        topP: 0.9,
        responseMimeType: 'application/json',
      },
    })
```

Add `purpose: 'scan'` as a sibling field:

```typescript
    const data = await callGemini({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
        topP: 0.9,
        responseMimeType: 'application/json',
      },
      purpose: 'scan',
    })
```

In the same file, in `generateAIInsights`, replace the `callGeminiProxy({...})` call (lines 56-69):

```typescript
    const data = await callGeminiProxy({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800,
        topP: 0.9,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
    })
```

with:

```typescript
    const data = await callGeminiProxy({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 800,
        topP: 0.9,
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
      ],
      purpose: 'insights',
    })
```

(This is technically redundant with the proxy's default-to-`'insights'` behavior from Task 8, but making it explicit here means the behavior doesn't silently depend on a default if the proxy's default ever changes.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/aiService.test.ts`
Expected: PASS.

Run the full suite once more: `npx vitest run`
Expected: PASS — everything green, including Tasks 3-5's `emailScanner.test.ts` tests (which use an injected `askAI: async () => null` and so never exercise this real `callGemini` path, but confirms no import-time breakage).

- [ ] **Step 5: Commit**

```bash
git add src/services/aiService.ts src/services/aiService.test.ts
git commit -m "feat: tag AI proxy calls with their purpose (scan vs insights)

analyzeTransactionEmailWithAI now sends purpose: 'scan' and
generateAIInsights sends purpose: 'insights', so gemini-proxy.ts's new
split quota (previous commit) actually gets used by both features
instead of both silently defaulting to the same counter."
```

---

## Task 10: Full-suite verification and manual scan check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — every test file green, including all changes from Tasks 1-9.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (Check `package.json` for the project's actual typecheck script name first — e.g. `npm run typecheck` — and use that if it differs from a bare `tsc --noEmit` invocation.)

- [ ] **Step 3: Manual verification against the real inbox**

This step requires the app running against real Supabase/Gmail credentials — not part of the automated suite, but required before considering this plan done, per the spec's Testing section.

1. Apply the Task 7 migration to the target Supabase project if not already done.
2. Deploy or run the app locally with the updated `api/gemini-proxy.ts` and `.env` `GEMINI_API_KEY` configured.
3. From the Pending page, trigger a Deep Rescan over a window covering 2026-08-10.
4. Confirm all four transactions (3 Uber trips, 1 Zomato order) appear in the pending list.
5. Confirm a genuine promotional email from Uber or Zomato (if one exists in the inbox) is still not inserted.
6. Confirm `email_scan_rejections` contains rows for anything genuinely rejected (promo/OTP/declined), and that low-confidence or no-direction-signal transactions that *were* inserted are visible in the Pending list rather than only in the rejections log.

- [ ] **Step 4: No commit for this task** — it's verification only. If any manual check in Step 3 fails, return to the relevant task above, fix, and re-run its tests before re-verifying.
