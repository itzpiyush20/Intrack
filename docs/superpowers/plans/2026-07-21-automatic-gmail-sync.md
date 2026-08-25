# Automatic Daily Gmail Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically pull Gmail transactions once a day for eligible (owner/premium/trial) users via a Vercel cron job, without requiring the user to open the app.

**Architecture:** Persist each user's Google refresh token server-side (service-role-only table). Refactor the existing browser-only `scanRealGmailInbox()` scan engine to accept its dependencies (Supabase client, user identity, access token, AI-call function) as optional parameters instead of reading browser globals directly, so a new cron endpoint can drive the exact same parsing/dedup logic used by manual "Sync Now". The cron filters to eligible users, refreshes each one's access token, and runs the shared scan per user with per-user error isolation.

**Tech Stack:** React + TypeScript (Vite), Supabase (Postgres + `@supabase/supabase-js`), Vercel serverless functions (`@vercel/node`), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-21-automatic-gmail-sync-design.md`

---

## Testing scope note

`src/services/emailScanner.ts` (the scan engine) currently has **zero** automated test coverage — it's a 1300+ line function relying on live Gmail API calls, AI parsing, and dozens of regex heuristics. Retrofitting a full test suite for it is out of scope for this plan (a separate, large effort). This plan adds automated tests for every *new* piece of logic it introduces (the injectable-dependency plumbing, the new endpoints), and calls out manual verification steps explicitly wherever a piece can't reasonably be unit tested — never silently skipped.

---

### Task 1: Database migration — `google_oauth_tokens` table

**Files:**
- Create: `supabase/006_google_oauth_tokens.sql`
- Modify: `supabase/schema.sql` (add the table for fresh installs, same pattern as `insurance_policies`)

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- Migration 006 — Server-side Google refresh token storage
-- (one-time, run once against an existing production database;
-- the objects this creates are already part of supabase/schema.sql
-- for fresh installs)
--
-- Stores each user's Google OAuth refresh token so a server-side cron
-- job can sync Gmail without a live browser session. RLS is enabled
-- with NO policies — only the service-role key (used exclusively in
-- /api serverless functions) can read or write this table. The
-- browser's anon/authenticated client has zero access by default-deny.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.google_oauth_tokens (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Add the same table to `supabase/schema.sql` for fresh installs**

Open `supabase/schema.sql` and find the `EMAIL_SCAN_LOGS TABLE` section (currently starting around line 136, right after `insurance_policies`). Insert a new section immediately before it:

```sql
-- ==========================================
-- GOOGLE_OAUTH_TOKENS TABLE
-- Server-side refresh token storage for automatic Gmail sync
-- ==========================================
CREATE TABLE IF NOT EXISTS public.google_oauth_tokens (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  refresh_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

ALTER TABLE public.google_oauth_tokens ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies — service-role only, same pattern documented
-- in migration 006_google_oauth_tokens.sql.

```

- [ ] **Step 3: Verify (manual — no automated SQL test exists in this repo)**

Run the contents of `supabase/006_google_oauth_tokens.sql` in the Supabase SQL Editor for the project (`urmxysuwailvwwglxuxn`). Confirm in Table Editor that `google_oauth_tokens` exists with columns `user_id, refresh_token, updated_at`, and that RLS is enabled with 0 policies listed.

- [ ] **Step 4: Commit**

```bash
git add supabase/006_google_oauth_tokens.sql supabase/schema.sql
git commit -m "feat: add google_oauth_tokens table for server-side Gmail sync"
```

---

### Task 2: Injectable Gemini caller in `aiService.ts`

**Files:**
- Modify: `src/services/aiService.ts:360-366` (and the call to `callGeminiProxy` at line ~443)
- Test: `src/services/aiService.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/aiService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
}))

import { analyzeTransactionEmailWithAI } from './aiService'

describe('analyzeTransactionEmailWithAI', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the injected callGemini function instead of the default proxy call', async () => {
    const fakeCallGemini = vi.fn().mockResolvedValue({
      candidates: [{ content: { parts: [{ text: JSON.stringify({
        is_transaction: true,
        transaction_type: 'debit',
        amount: 450,
        merchant: 'Swiggy',
        category: 'food',
        description: 'Swiggy order',
        payment_mode: 'upi',
        card_issuer: null,
        card_brand: null,
        transaction_time: null,
        reference_id: null,
        date: '2026-07-20',
        confidence_score: 90,
      }) }] } }],
    })

    const result = await analyzeTransactionEmailWithAI(
      'Debited Rs.450',
      'You spent Rs.450 at Swiggy',
      '2026-07-20',
      fakeCallGemini
    )

    expect(fakeCallGemini).toHaveBeenCalledTimes(1)
    expect(result?.merchant).toBe('Swiggy')
    expect(result?.amount).toBe(450)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/aiService.test.ts`
Expected: FAIL — `analyzeTransactionEmailWithAI` doesn't accept a 4th argument yet, so `fakeCallGemini` is never called and the test's `toHaveBeenCalledTimes(1)` assertion fails.

- [ ] **Step 3: Add the injectable parameter**

In `src/services/aiService.ts`, change the function signature at line 360 from:

```typescript
export async function analyzeTransactionEmailWithAI(
  subject: string,
  body: string,
  emailDate: string
): Promise<AITransactionResult | null> {
```

to:

```typescript
export async function analyzeTransactionEmailWithAI(
  subject: string,
  body: string,
  emailDate: string,
  callGemini: (body: Record<string, unknown>) => Promise<any> = callGeminiProxy
): Promise<AITransactionResult | null> {
```

Then find the call site around line 443:

```typescript
    const data = await callGeminiProxy({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
        topP: 0.9,
        responseMimeType: 'application/json',
      },
    })
```

and change `callGeminiProxy(` to `callGemini(` (keep everything else the same).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/aiService.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/aiService.ts src/services/aiService.test.ts
git commit -m "feat: make analyzeTransactionEmailWithAI's Gemini caller injectable"
```

---

### Task 3: Injectable Supabase client in `learningEngine.ts`

**Files:**
- Modify: `src/services/learningEngine.ts:28-40` (`getMerchantRulesFromDB`) and `:151-156` (`applyMerchantRulesFromDB`)
- Test: `src/services/learningEngine.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/learningEngine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const defaultMockOrder = vi.fn()
vi.mock('./supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ order: defaultMockOrder }) }) }),
  },
}))

import { getMerchantRulesFromDB } from './learningEngine'

describe('getMerchantRulesFromDB', () => {
  beforeEach(() => {
    defaultMockOrder.mockReset()
    defaultMockOrder.mockResolvedValue({ data: [], error: null })
  })

  it('uses the injected db client instead of the default module client', async () => {
    const customOrder = vi.fn().mockResolvedValue({
      data: [{
        id: 'r1', user_id: 'u1', merchant_key: 'swiggy', canonical_name: 'Swiggy',
        preferred_category: 'food', card_brand: null, auto_approve: true,
        confidence: 90, times_confirmed: 3, last_updated: '2026-07-01', created_at: '2026-07-01',
      }],
      error: null,
    })
    const customDb: any = {
      from: () => ({ select: () => ({ eq: () => ({ order: customOrder }) }) }),
    }

    const rules = await getMerchantRulesFromDB('u1', customDb)

    expect(customOrder).toHaveBeenCalledTimes(1)
    expect(defaultMockOrder).not.toHaveBeenCalled()
    expect(rules).toHaveLength(1)
    expect(rules[0].merchant_key).toBe('swiggy')
  })

  it('falls back to the default module client when none is passed', async () => {
    await getMerchantRulesFromDB('u1')
    expect(defaultMockOrder).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/learningEngine.test.ts`
Expected: FAIL — `getMerchantRulesFromDB` doesn't accept a second argument yet, so the custom client is never used and `customOrder` is never called.

- [ ] **Step 3: Add the injectable `db` parameter**

In `src/services/learningEngine.ts`, add the type import at the top (after the existing imports around line 9):

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
```

Change `getMerchantRulesFromDB` (line 28) from:

```typescript
export async function getMerchantRulesFromDB(userId: string): Promise<MerchantRuleRow[]> {
  const { data, error } = await supabase
    .from('merchant_rules')
```

to:

```typescript
export async function getMerchantRulesFromDB(userId: string, db: SupabaseClient = supabase): Promise<MerchantRuleRow[]> {
  const { data, error } = await db
    .from('merchant_rules')
```

Change `applyMerchantRulesFromDB` (line 151) from:

```typescript
export async function applyMerchantRulesFromDB(
  userId: string,
  merchant: string,
  snippet: string,
  defaultCategory: string
): Promise<RuleMatchResult> {
  // Normalize the merchant to canonical form for consistent DB lookup
  const normalized = normalizeMerchant(merchant)
  const canonicalName = normalized.isKnown ? normalized.canonical : cleanMerchantName(merchant)
  const merchantKey = getMerchantKey(canonicalName) || cleanMerchantName(merchant).toLowerCase().trim()

  try {
    const rules = await getMerchantRulesFromDB(userId)
```

to:

```typescript
export async function applyMerchantRulesFromDB(
  userId: string,
  merchant: string,
  snippet: string,
  defaultCategory: string,
  db: SupabaseClient = supabase
): Promise<RuleMatchResult> {
  // Normalize the merchant to canonical form for consistent DB lookup
  const normalized = normalizeMerchant(merchant)
  const canonicalName = normalized.isKnown ? normalized.canonical : cleanMerchantName(merchant)
  const merchantKey = getMerchantKey(canonicalName) || cleanMerchantName(merchant).toLowerCase().trim()

  try {
    const rules = await getMerchantRulesFromDB(userId, db)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/learningEngine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/learningEngine.ts src/services/learningEngine.test.ts
git commit -m "feat: make learningEngine's Supabase client injectable"
```

---

### Task 4: Make `scanRealGmailInbox` accept server-side inputs

**Files:**
- Modify: `src/services/emailScanner.ts:684-695` (`getScanLogs`), `:700-718` (token acquisition preamble), `:796-804` (`activeYear`), `:966` (AI call)

This task has no new automated test (see "Testing scope note" above) — it's a plumbing change to an already-uncovered function. Verification is manual, at the end of this task.

- [ ] **Step 1: Alias the module-level import so `getScanLogs` keeps using it directly**

At the top of `src/services/emailScanner.ts`, change line 7 from:

```typescript
import { supabase } from './supabase'
```

to:

```typescript
import { supabase as defaultSupabase } from './supabase'
import type { SupabaseClient } from '@supabase/supabase-js'
```

Then update `getScanLogs()` (currently lines 685-695) to use `defaultSupabase` instead of `supabase`:

```typescript
export async function getScanLogs() {
  const { data: { user } } = await defaultSupabase.auth.getUser()
  if (!user) return { data: null, error: new Error('User not authenticated') }
  const { data, error } = await defaultSupabase
    .from('email_scan_logs')
    .select('*')
    .eq('user_id', user.id)
    .order('scanned_at', { ascending: false })
    .limit(5)
  return { data: data as EmailScanLog[] | null, error }
}
```

- [ ] **Step 2: Run the type checker and existing tests to confirm nothing broke**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS (this step only renamed an import and one function's usages — no behavior change)

- [ ] **Step 3: Add the `ScanGmailOptions` type and opts parameter**

Change the `scanRealGmailInbox` signature (currently line 700):

```typescript
export async function scanRealGmailInbox() {
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user

  let providerToken = getGoogleToken()

  if (!user) return { data: null, error: new Error('User not authenticated') }

  // If access token is expired, silently refresh it before giving up
  if (!providerToken && session?.access_token) {
    providerToken = await tryRefreshGoogleToken(session.access_token)
  }

  if (!providerToken) {
    return {
      data: null,
      error: new Error('Gmail Inbox not connected. Please click "Connect Gmail Inbox" on the Pending Alerts page to authorise Gmail scanning.'),
    }
  }
```

to:

```typescript
export interface ScanGmailOptions {
  /** Supabase client to use for all DB reads/writes during this scan. Defaults to the browser singleton. */
  db?: SupabaseClient
  /** User id/email to scan for. When provided (with accessToken), the browser session lookup is skipped entirely — this is the server-side/cron path. */
  userId?: string
  userEmail?: string
  /** Google API access token to use directly, bypassing localStorage/session lookup. */
  accessToken?: string
  /** Active financial year to scope the scan to. Defaults to the browser's localStorage value (or 2026). */
  activeYear?: number
  /** AI email analyzer to use. Defaults to the proxy-based `analyzeTransactionEmailWithAI`. */
  askAI?: (subject: string, body: string, emailDate: string) => ReturnType<typeof analyzeTransactionEmailWithAI>
}

export async function scanRealGmailInbox(opts?: ScanGmailOptions) {
  const supabase = opts?.db || defaultSupabase
  const askAI = opts?.askAI || analyzeTransactionEmailWithAI

  let user: { id: string; email?: string } | undefined
  let providerToken: string | null = null

  if (opts?.userId && opts?.accessToken) {
    // Server-side path (cron): identity and token are supplied directly, no browser session exists.
    user = { id: opts.userId, email: opts.userEmail }
    providerToken = opts.accessToken
  } else {
    const { data: { session } } = await supabase.auth.getSession()
    user = session?.user

    providerToken = getGoogleToken()

    if (!user) return { data: null, error: new Error('User not authenticated') }

    // If access token is expired, silently refresh it before giving up
    if (!providerToken && session?.access_token) {
      providerToken = await tryRefreshGoogleToken(session.access_token)
    }
  }

  if (!user) return { data: null, error: new Error('User not authenticated') }

  if (!providerToken) {
    return {
      data: null,
      error: new Error('Gmail Inbox not connected. Please click "Connect Gmail Inbox" on the Pending Alerts page to authorise Gmail scanning.'),
    }
  }
```

Note: inside the function body, `const supabase = opts?.db || defaultSupabase` shadows the module import *only within this function's scope* — every existing internal call like `supabase.from('profiles')` (lines 727-772, 787, 818-831, 887-936, 1253-1290, 1315-1321) keeps working completely unchanged, now transparently using the injected client when one is passed.

- [ ] **Step 4: Make `activeYear` overridable**

Find the block (currently lines 796-804):

```typescript
    let activeYear = 2026
    try {
      const storedYear = localStorage.getItem(`intrack_active_financial_year_${user.id}`)
      if (storedYear) {
        activeYear = parseInt(storedYear, 10)
      }
    } catch (e) {
      console.warn('Failed to load active year from localStorage, using default 2026', e)
    }
```

Replace with:

```typescript
    let activeYear = opts?.activeYear ?? 2026
    if (opts?.activeYear === undefined) {
      try {
        const storedYear = localStorage.getItem(`intrack_active_financial_year_${user.id}`)
        if (storedYear) {
          activeYear = parseInt(storedYear, 10)
        }
      } catch (e) {
        console.warn('Failed to load active year from localStorage, using default 2026', e)
      }
    }
```

- [ ] **Step 5: Use the injectable `askAI` instead of calling `analyzeTransactionEmailWithAI` directly**

Find (currently around line 966):

```typescript
          const aiResult = await analyzeTransactionEmailWithAI(subject, bodyText, mailDate)
```

Replace with:

```typescript
          const aiResult = await askAI(subject, bodyText, mailDate)
```

- [ ] **Step 6: Thread `db` into the two `applyMerchantRulesFromDB` calls**

There are two call sites (currently around lines 976 and 1193). Change:

```typescript
                ruleResult = await applyMerchantRulesFromDB(user.id, resolvedMerchant, bodyText, aiResult.category || 'other')
```

to:

```typescript
                ruleResult = await applyMerchantRulesFromDB(user.id, resolvedMerchant, bodyText, aiResult.category || 'other', supabase)
```

and change:

```typescript
          ruleResult = await applyMerchantRulesFromDB(user.id, merchant, emailContentForParsing, category)
```

to:

```typescript
          ruleResult = await applyMerchantRulesFromDB(user.id, merchant, emailContentForParsing, category, supabase)
```

(`supabase` here refers to the function-local shadowed const from Step 3, i.e. `opts?.db || defaultSupabase` — so cron-driven scans correctly use the service-role client for merchant-rule lookups too, instead of silently hitting RLS with no session.)

- [ ] **Step 7: Type-check and run the full test suite**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS — no test currently exercises `scanRealGmailInbox` directly, so this confirms only that nothing else broke.

- [ ] **Step 8: Manual verification**

With a real Gmail-connected dev account, open the app and click "Sync Now" on Pending Alerts — confirm it behaves exactly as before (this exercises the `opts === undefined` branch, i.e. zero behavior change for the existing browser flow).

- [ ] **Step 9: Commit**

```bash
git add src/services/emailScanner.ts
git commit -m "feat: make scanRealGmailInbox accept server-side inputs for cron-driven sync"
```

---

### Task 5: `api/save-google-refresh-token.ts` endpoint

**Files:**
- Create: `api/save-google-refresh-token.ts`
- Test: `api/save-google-refresh-token.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/save-google-refresh-token.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const { mockGetUser, mockUpsert } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockUpsert: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({ upsert: mockUpsert }),
  }),
}))

import handler from './save-google-refresh-token.js'

function makeRes() {
  let statusVal = 200
  let jsonVal: any = null
  const res = {
    setHeader: vi.fn(),
    status: (code: number) => {
      statusVal = code
      return { json: (data: any) => { jsonVal = data }, end: () => {} }
    },
  } as unknown as VercelResponse
  return { res, getStatus: () => statusVal, getJson: () => jsonVal }
}

describe('api/save-google-refresh-token', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.ALLOWED_ORIGIN = 'https://intrack-five.vercel.app'
  })

  it('rejects requests with no Authorization header', async () => {
    const req = { method: 'POST', headers: { origin: 'https://intrack-five.vercel.app' }, body: { refreshToken: 'rt' } } as unknown as VercelRequest
    const { res, getStatus } = makeRes()
    await handler(req, res)
    expect(getStatus()).toBe(401)
  })

  it('rejects requests missing refreshToken', async () => {
    const req = {
      method: 'POST',
      headers: { origin: 'https://intrack-five.vercel.app', authorization: 'Bearer jwt' },
      body: {},
    } as unknown as VercelRequest
    const { res, getStatus } = makeRes()
    await handler(req, res)
    expect(getStatus()).toBe(400)
  })

  it('upserts the refresh token for the authenticated user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-123' } }, error: null })
    mockUpsert.mockResolvedValue({ error: null })

    const req = {
      method: 'POST',
      headers: { origin: 'https://intrack-five.vercel.app', authorization: 'Bearer valid-jwt' },
      body: { refreshToken: 'the-refresh-token' },
    } as unknown as VercelRequest
    const { res, getStatus, getJson } = makeRes()

    await handler(req, res)

    expect(getStatus()).toBe(200)
    expect(getJson()).toEqual({ status: 'ok' })
    expect(mockUpsert).toHaveBeenCalledWith({
      user_id: 'user-123',
      refresh_token: 'the-refresh-token',
      updated_at: expect.any(String),
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/save-google-refresh-token.test.ts`
Expected: FAIL with a module-not-found error for `./save-google-refresh-token.js`.

- [ ] **Step 3: Write the endpoint**

```typescript
// api/save-google-refresh-token.ts
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://intrack-five.vercel.app'

const rateLimitMap = new Map<string, { count: number; resetAt: number }>()
function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 })
    return false
  }
  if (entry.count >= 20) return true
  entry.count++
  return false
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = req.headers.origin || ''
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
  }
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 'unknown'
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { refreshToken } = req.body ?? {}
  if (!refreshToken || typeof refreshToken !== 'string') {
    return res.status(400).json({ error: 'refreshToken required' })
  }

  const jwt = authHeader.slice(7)
  const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  )
  const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(jwt)
  if (userError || !user) return res.status(401).json({ error: 'Unauthorized' })

  const { error: upsertError } = await supabaseAdmin
    .from('google_oauth_tokens')
    .upsert({
      user_id: user.id,
      refresh_token: refreshToken,
      updated_at: new Date().toISOString(),
    })

  if (upsertError) {
    console.error('save-google-refresh-token: upsert failed', upsertError)
    return res.status(500).json({ error: 'Failed to save token' })
  }

  return res.status(200).json({ status: 'ok' })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/save-google-refresh-token.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/save-google-refresh-token.ts api/save-google-refresh-token.test.ts
git commit -m "feat: add endpoint to persist Google refresh tokens server-side"
```

---

### Task 6: Call the new endpoint from the browser after OAuth

**Files:**
- Modify: `src/services/googleAuth.ts` (add `saveGoogleRefreshTokenServerSide`)
- Modify: `src/context/AuthContext.tsx:511-513` and `:570-572`
- Test: `src/services/googleAuth.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

```typescript
// src/services/googleAuth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('saveGoogleRefreshTokenServerSide', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  it('POSTs the refresh token to the save endpoint with the Supabase JWT', async () => {
    const { saveGoogleRefreshTokenServerSide } = await import('./googleAuth')
    await saveGoogleRefreshTokenServerSide('supabase-jwt', 'google-refresh-token')

    expect(fetch).toHaveBeenCalledWith('/api/save-google-refresh-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer supabase-jwt' },
      body: JSON.stringify({ refreshToken: 'google-refresh-token' }),
    })
  })

  it('does not throw when the request fails (fire-and-forget)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const { saveGoogleRefreshTokenServerSide } = await import('./googleAuth')
    await expect(saveGoogleRefreshTokenServerSide('jwt', 'rt')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/googleAuth.test.ts`
Expected: FAIL — `saveGoogleRefreshTokenServerSide` is not exported yet.

- [ ] **Step 3: Add the function**

In `src/services/googleAuth.ts`, add this after the existing `saveGoogleRefreshToken` function (after line 66):

```typescript
/**
 * Persist the Google refresh token server-side so the automatic daily sync
 * cron can use it without a live browser session. Fire-and-forget — a
 * failure here just means the user keeps manual-only sync until their next
 * successful OAuth refresh/login re-attempts the save.
 */
export async function saveGoogleRefreshTokenServerSide(supabaseJwt: string, refreshToken: string): Promise<void> {
  try {
    await fetch('/api/save-google-refresh-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseJwt}` },
      body: JSON.stringify({ refreshToken }),
    })
  } catch (e) {
    console.warn('saveGoogleRefreshTokenServerSide error:', e)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/googleAuth.test.ts`
Expected: PASS

- [ ] **Step 5: Call it from `AuthContext.tsx`**

In `src/context/AuthContext.tsx`, update the import on line 18 from:

```typescript
import { saveGoogleToken, clearGoogleToken, clearAllGoogleTokens, isGoogleConnected, purgeOldTokenKey, validateGoogleToken, saveGoogleRefreshToken, tryRefreshGoogleToken } from '@/services/googleAuth'
```

to:

```typescript
import { saveGoogleToken, clearGoogleToken, clearAllGoogleTokens, isGoogleConnected, purgeOldTokenKey, validateGoogleToken, saveGoogleRefreshToken, saveGoogleRefreshTokenServerSide, tryRefreshGoogleToken } from '@/services/googleAuth'
```

Then find the first call site (currently lines 511-513):

```typescript
      if (session?.provider_refresh_token) {
        saveGoogleRefreshToken(session.provider_refresh_token)
      }
```

Replace with:

```typescript
      if (session?.provider_refresh_token) {
        saveGoogleRefreshToken(session.provider_refresh_token)
        if (session.access_token) {
          saveGoogleRefreshTokenServerSide(session.access_token, session.provider_refresh_token)
        }
      }
```

And the second call site (currently lines 570-572), inside the `onAuthStateChange` callback:

```typescript
        if (session?.provider_refresh_token) {
          saveGoogleRefreshToken(session.provider_refresh_token)
        }
```

Replace with:

```typescript
        if (session?.provider_refresh_token) {
          saveGoogleRefreshToken(session.provider_refresh_token)
          if (session.access_token) {
            saveGoogleRefreshTokenServerSide(session.access_token, session.provider_refresh_token)
          }
        }
```

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 7: Manual verification**

Sign in with a Gmail-connected account in the app, then check the `google_oauth_tokens` table in Supabase's Table Editor — confirm a row exists for that user's id.

- [ ] **Step 8: Commit**

```bash
git add src/services/googleAuth.ts src/services/googleAuth.test.ts src/context/AuthContext.tsx
git commit -m "feat: persist Google refresh token server-side on OAuth sign-in"
```

---

### Task 7: `api/auto-sync-gmail.ts` cron endpoint

**Files:**
- Create: `api/auto-sync-gmail.ts`
- Test: `api/auto-sync-gmail.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/auto-sync-gmail.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const { mockTokensSelect, mockProfilesSelect, mockScanRealGmailInbox, mockTokenDelete, mockLogInsert, mockRefreshFetch } = vi.hoisted(() => ({
  mockTokensSelect: vi.fn(),
  mockProfilesSelect: vi.fn(),
  mockScanRealGmailInbox: vi.fn(),
  mockTokenDelete: vi.fn(),
  mockLogInsert: vi.fn(),
  mockRefreshFetch: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'google_oauth_tokens') {
        return { select: mockTokensSelect, delete: () => ({ eq: mockTokenDelete }) }
      }
      if (table === 'profiles') {
        return { select: () => ({ in: mockProfilesSelect }) }
      }
      if (table === 'email_scan_logs') {
        return { insert: mockLogInsert }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

vi.mock('../src/services/emailScanner.js', () => ({
  scanRealGmailInbox: mockScanRealGmailInbox,
}))

// auto-sync-gmail.ts statically imports aiService.ts, which itself imports the
// real browser Supabase client (src/services/supabase.ts) — that module throws
// at import time if VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY aren't set. Mock it
// out entirely so this test doesn't depend on those env vars being present.
vi.mock('../src/services/aiService.js', () => ({
  analyzeTransactionEmailWithAI: vi.fn(),
}))

vi.stubGlobal('fetch', mockRefreshFetch)

import handler from './auto-sync-gmail.js'

function makeRes() {
  let statusVal = 200
  let jsonVal: any = null
  const res = {
    status: (code: number) => {
      statusVal = code
      return { json: (data: any) => { jsonVal = data } },
    },
  } as unknown as VercelResponse
  return { res, getStatus: () => statusVal, getJson: () => jsonVal }
}

describe('api/auto-sync-gmail', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    process.env.GOOGLE_CLIENT_ID = 'gcid'
    process.env.GOOGLE_CLIENT_SECRET = 'gcsecret'
    mockLogInsert.mockResolvedValue({ error: null })
    mockTokenDelete.mockResolvedValue({ error: null })
  })

  it('rejects requests without the correct cron secret', async () => {
    const req = { method: 'POST', headers: {} } as unknown as VercelRequest
    const { res, getStatus } = makeRes()
    await handler(req, res)
    expect(getStatus()).toBe(401)
  })

  it('skips ineligible users and syncs eligible ones', async () => {
    mockTokensSelect.mockResolvedValue({
      data: [
        { user_id: 'eligible-user', refresh_token: 'rt-1' },
        { user_id: 'free-user', refresh_token: 'rt-2' },
      ],
      error: null,
    })
    mockProfilesSelect.mockResolvedValue({
      data: [
        { id: 'eligible-user', email: 'x@y.com', subscription_status: 'active', subscription_expires_at: null },
        { id: 'free-user', email: 'a@b.com', subscription_status: 'free', subscription_expires_at: null },
      ],
      error: null,
    })
    mockRefreshFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'access-tok', expires_in: 3600 }),
    })
    mockScanRealGmailInbox.mockResolvedValue({
      data: { transactions: [{ id: 't1' }], log: {}, autoApprovedCount: 1 },
      error: null,
    })

    const req = { method: 'POST', headers: { authorization: 'Bearer test-secret' } } as unknown as VercelRequest
    const { res, getStatus, getJson } = makeRes()

    await handler(req, res)

    expect(getStatus()).toBe(200)
    expect(mockScanRealGmailInbox).toHaveBeenCalledTimes(1)
    expect(mockScanRealGmailInbox.mock.calls[0][0]).toMatchObject({ userId: 'eligible-user', accessToken: 'access-tok' })
    expect(getJson()).toMatchObject({ usersProcessed: 1, succeeded: 1, failed: 0 })
  })

  it('deletes the token and logs a failure when the refresh token is revoked', async () => {
    mockTokensSelect.mockResolvedValue({
      data: [{ user_id: 'revoked-user', refresh_token: 'dead-rt' }],
      error: null,
    })
    mockProfilesSelect.mockResolvedValue({
      data: [{ id: 'revoked-user', email: 'z@z.com', subscription_status: 'active', subscription_expires_at: null }],
      error: null,
    })
    mockRefreshFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'invalid_grant' }),
    })

    const req = { method: 'POST', headers: { authorization: 'Bearer test-secret' } } as unknown as VercelRequest
    const { res, getJson } = makeRes()

    await handler(req, res)

    expect(mockTokenDelete).toHaveBeenCalledWith('user_id', 'revoked-user')
    expect(mockLogInsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'revoked-user', status: 'failed' }))
    expect(mockScanRealGmailInbox).not.toHaveBeenCalled()
    expect(getJson()).toMatchObject({ usersProcessed: 1, succeeded: 0, failed: 1 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run api/auto-sync-gmail.test.ts`
Expected: FAIL with a module-not-found error for `./auto-sync-gmail.js`.

- [ ] **Step 3: Write the cron endpoint**

```typescript
// api/auto-sync-gmail.ts
// ============================================================
// auto-sync-gmail.ts — Automatic daily Gmail sync for eligible users
//
// Triggered by Vercel Cron (see vercel.json). Runs scanRealGmailInbox()
// server-side for every user who has a stored Google refresh token AND
// is eligible: the app owner, or an active/unexpired premium or trial
// subscription. Free-tier users keep manual "Sync Now" only — this
// mirrors the cooldown-bypass eligibility already used in
// src/services/emailScanner.ts.
//
// Requires (all already used elsewhere in this app, no new env vars):
//   - CRON_SECRET, VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   - GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (Google token refresh)
//   - GEMINI_API_KEY (direct Gemini call — no per-user proxy quota
//     applies here, since this path is already gated to eligible users)
//   - VITE_OWNER_EMAILS (optional, comma-separated owner bypass list)
// ============================================================

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { scanRealGmailInbox } from '../src/services/emailScanner.js'
import { analyzeTransactionEmailWithAI } from '../src/services/aiService.js'

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

const OWNER_EMAILS = (process.env.VITE_OWNER_EMAILS || '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean)

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''

interface Profile {
  id: string
  email: string | null
  subscription_status: string | null
  subscription_expires_at: string | null
}

function isEligible(profile: Profile): boolean {
  const email = profile.email?.toLowerCase().trim() || ''
  if (OWNER_EMAILS.length > 0 && OWNER_EMAILS.includes(email)) return true

  const notExpired = !profile.subscription_expires_at || new Date(profile.subscription_expires_at).getTime() > Date.now()
  if (profile.subscription_status === 'active' && notExpired) return true
  if (profile.subscription_status === 'trial' && notExpired) return true
  return false
}

async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string } | { revoked: true } | { error: string }> {
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '',
      client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!tokenRes.ok) {
    const err = await tokenRes.json().catch(() => ({})) as Record<string, string>
    if (err.error === 'invalid_grant') return { revoked: true }
    return { error: err.error || 'Token refresh failed' }
  }

  const { access_token } = await tokenRes.json() as { access_token: string }
  return { accessToken: access_token }
}

/** Direct Gemini call for the cron path — never runs in the browser, so it's safe to use GEMINI_API_KEY here. */
async function callGeminiDirect(body: Record<string, unknown>): Promise<any> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  )
  if (!res.ok) throw new Error(`Gemini API error: ${res.status}`)
  return res.json()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { data: tokenRows, error: tokensErr } = await supabaseAdmin
    .from('google_oauth_tokens')
    .select('user_id, refresh_token')

  if (tokensErr) {
    console.error('auto-sync-gmail: failed to load tokens', tokensErr)
    return res.status(500).json({ error: tokensErr.message })
  }
  if (!tokenRows || tokenRows.length === 0) {
    return res.status(200).json({ usersProcessed: 0, succeeded: 0, failed: 0, transactionsFound: 0 })
  }

  const userIds = tokenRows.map((t) => t.user_id)
  const { data: profiles, error: profilesErr } = await supabaseAdmin
    .from('profiles')
    .select('id, email, subscription_status, subscription_expires_at')
    .in('id', userIds)

  if (profilesErr) {
    console.error('auto-sync-gmail: failed to load profiles', profilesErr)
    return res.status(500).json({ error: profilesErr.message })
  }

  const profileById = new Map<string, Profile>((profiles || []).map((p) => [p.id, p as Profile]))

  let succeeded = 0
  let failed = 0
  let transactionsFound = 0
  let usersProcessed = 0

  for (const row of tokenRows) {
    const profile = profileById.get(row.user_id)
    if (!profile || !isEligible(profile)) continue

    usersProcessed++

    try {
      const refreshResult = await refreshAccessToken(row.refresh_token)

      if ('revoked' in refreshResult) {
        await supabaseAdmin.from('google_oauth_tokens').delete().eq('user_id', row.user_id)
        await supabaseAdmin.from('email_scan_logs').insert({
          user_id: row.user_id,
          emails_processed: 0,
          transactions_found: 0,
          status: 'failed',
          error_message: 'Gmail connection revoked — please reconnect Gmail Inbox.',
        })
        failed++
        continue
      }
      if ('error' in refreshResult) throw new Error(refreshResult.error)

      const { data, error } = await scanRealGmailInbox({
        db: supabaseAdmin,
        userId: row.user_id,
        userEmail: profile.email || undefined,
        accessToken: refreshResult.accessToken,
        askAI: (subject, body, emailDate) => analyzeTransactionEmailWithAI(subject, body, emailDate, callGeminiDirect),
      })

      if (error) throw error

      succeeded++
      transactionsFound += data?.transactions?.length || 0
    } catch (err: any) {
      console.error(`auto-sync-gmail: sync failed for user ${row.user_id}`, err)
      await supabaseAdmin.from('email_scan_logs').insert({
        user_id: row.user_id,
        emails_processed: 0,
        transactions_found: 0,
        status: 'failed',
        error_message: err.message || 'Automatic sync failed',
      })
      failed++
    }
  }

  return res.status(200).json({ usersProcessed, succeeded, failed, transactionsFound })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run api/auto-sync-gmail.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check the whole project**

Run: `npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add api/auto-sync-gmail.ts api/auto-sync-gmail.test.ts
git commit -m "feat: add automatic daily Gmail sync cron endpoint"
```

---

### Task 8: Schedule the cron job

**Files:**
- Modify: `vercel.json:1-7`

- [ ] **Step 1: Add the cron entry**

Change:

```json
{
  "crons": [
    {
      "path": "/api/weekly-digest",
      "schedule": "0 6 * * 1"
    }
  ],
```

to:

```json
{
  "crons": [
    {
      "path": "/api/weekly-digest",
      "schedule": "0 6 * * 1"
    },
    {
      "path": "/api/auto-sync-gmail",
      "schedule": "30 21 * * *"
    }
  ],
```

(21:30 UTC = 3:00 AM IST daily.)

- [ ] **Step 2: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('vercel.json', 'utf8')); console.log('valid')"`
Expected: prints `valid`

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat: schedule automatic Gmail sync cron daily at 3am IST"
```

---

### Task 9: Full verification pass

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all existing tests plus the new ones from Tasks 2, 3, 5, 6, 7)

- [ ] **Step 2: Run the type checker**

Run: `npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 3: Run the linter**

Run: `npx eslint .`
Expected: PASS (or only pre-existing warnings unrelated to these changes)

- [ ] **Step 4: Deploy-time manual checklist (post-merge, in Vercel)**

After this is deployed to production:
1. Apply `supabase/006_google_oauth_tokens.sql` in the Supabase SQL Editor (Task 1, if not already done).
2. Confirm `CRON_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are all set in Vercel's project environment variables (all pre-existing, used by other endpoints already).
3. In Vercel's dashboard, trigger `/api/auto-sync-gmail` manually once (Deployments → Functions, or `curl -H "Authorization: Bearer $CRON_SECRET" https://intrack-five.vercel.app/api/auto-sync-gmail`) and confirm the JSON response shows `usersProcessed` matching the number of eligible users with a connected Gmail, and `failed: 0` for accounts with valid tokens.
4. Confirm new `email_scan_logs` rows appear with recent `scanned_at` timestamps for eligible users.
