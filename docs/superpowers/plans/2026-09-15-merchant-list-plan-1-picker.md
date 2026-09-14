# Merchant List — Plan 1: saved merchants and the picker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user gets a saved merchant list, and one merchant picker with "+ Add merchant" replaces the free-text merchant box on all four transaction screens.

**Architecture:** New `merchants` and `merchant_aliases` tables plus a nullable `transactions.merchant_id` (migration 048). A pure helper module does key normalisation and matching; a small service reads and writes the tables; one `MerchantPicker` component is dropped into NewTransactionModal, ExpenseForm, RecordPlannedPaymentModal and PendingPage. Totals are NOT changed in this plan.

**Tech Stack:** React + TypeScript + Vite, Supabase (Postgres, RLS), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-14-merchant-list-design.md`

**This is plan 1 of 3.** Each ships on its own:
- **Plan 1 (this):** tables, service, picker on four screens, Pending pre-select.
- **Plan 2:** `moneyFlow` classifier — linked credits become refunds in every total.
  Written after plan 1 merges. Until then a linked credit still counts as income,
  exactly as today, so plan 1 changes no number anywhere.
- **Plan 3:** Settings → Merchants tab (net spend, rename, merge, delete) and the
  one-time cleanup of old merchant text.

---

## Rules that apply to every task

- Run commands from the repo root: `C:/Users/itzpi/OneDrive/Desktop/Projects/Intrack`.
- **Commit by pathspec only** (`git commit -- <paths>`). Other sessions share this
  checkout; a bare `git commit` sweeps up their staged work.
- **Never `git stash`** in this repo — it half-fails. Back files up to the scratchpad.
- Lint has a large pre-existing baseline. Don't add new errors in touched files.
- `src/services/emailScanner.ts`, `aiService.ts`, `emailScanGates.ts`,
  `learningEngine.ts` are **not touched** by this plan.
- Task 9 edits `PendingPage.tsx`, a scanner UI entry point. **Get the owner's
  second confirmation before starting Task 9.**

## File map

| File | Status | Responsibility |
|---|---|---|
| `supabase/048_merchants.sql` | create | tables, RLS, owner-check trigger, column |
| `supabase/schema.sql` | modify | same objects for fresh installs + safety net |
| `src/types/database.ts` | modify | `merchants`, `merchant_aliases`, `merchant_id` types |
| `src/utils/merchantKey.ts` | create | pure: key, match, filter |
| `src/utils/merchantKey.test.ts` | create | tests |
| `src/services/merchants.ts` | create | list / create / add alias |
| `src/services/merchants.test.ts` | create | tests |
| `src/components/merchants/MerchantPicker.tsx` | create | combobox + inline add-merchant panel |
| `src/components/merchants/MerchantPicker.test.tsx` | create | tests |
| `src/components/dashboard/NewTransactionModal.tsx` (+ test) | modify | use picker |
| `src/components/expenses/ExpenseForm.tsx` | modify | use picker |
| `src/components/subscriptions/RecordPlannedPaymentModal.tsx` | modify | use picker |
| `src/pages/PendingPage.tsx` | modify | merchant field, pre-select, save link |
| `ARCHITECTURE.md`, `CLAUDE.md` | modify | identity files |

---

### Task 0: Clear the discarded work and record the lint baseline

The owner chose (2026-09-14) to discard the uncommitted `getDistinctMerchants`
work. Its diffs touch only merchant suggestions.

**Files:** the eight modified files in `git status`.

- [ ] **Step 1: Confirm the tree still holds only that work**

Run: `git status --short`
Expected exactly these eight, nothing else modified:
```
 M ARCHITECTURE.md
 M src/components/dashboard/NewTransactionModal.test.tsx
 M src/components/dashboard/NewTransactionModal.tsx
 M src/components/expenses/ExpenseForm.tsx
 M src/services/index.ts
 M src/services/merchantNormalizer.ts
 M src/services/transactions.test.ts
 M src/services/transactions.ts
```
If anything else is modified, or `git diff` for these files shows changes beyond
`getDistinctMerchants` / `rankMerchants` / the suggestion datalists, **stop and ask
the owner** — another session is working.

- [ ] **Step 2: Back up, then restore**

```bash
BK="C:/Users/itzpi/AppData/Local/Temp/claude/C--Users-itzpi-OneDrive-Desktop-Projects-Intrack/607b1553-8c9e-4d76-b171-ab3f842dbf6c/scratchpad/wip-getDistinctMerchants"
mkdir -p "$BK" && git diff > "$BK/wip.patch" && ls -la "$BK/wip.patch"
git checkout -- ARCHITECTURE.md src/components/dashboard/NewTransactionModal.test.tsx src/components/dashboard/NewTransactionModal.tsx src/components/expenses/ExpenseForm.tsx src/services/index.ts src/services/merchantNormalizer.ts src/services/transactions.test.ts src/services/transactions.ts
git status --short
```
Expected: patch file non-empty; `git status --short` prints nothing.

- [ ] **Step 3: Record the lint baseline for files this plan touches**

```bash
npx eslint src/components/dashboard/NewTransactionModal.tsx src/components/expenses/ExpenseForm.tsx src/components/subscriptions/RecordPlannedPaymentModal.tsx src/pages/PendingPage.tsx src/types/database.ts 2>&1 | tail -3
```
Write the problem count down. Task 11 compares against it.

---

### Task 1: Migration 048

**Files:**
- Create: `supabase/048_merchants.sql`

- [ ] **Step 1: Write the migration**

-- 048_merchants.sql
--
-- A saved merchant list per user (spec: docs/superpowers/specs/
-- 2026-09-14-merchant-list-design.md).
--
-- transactions.merchant stays free text. merchant_id is an optional link to a
-- row here, set only when the user picks a merchant. Nothing in this file
-- links an existing transaction.
--
-- name_key is the normalised form used for uniqueness and matching. It must
-- stay identical to merchantKey() in src/utils/merchantKey.ts: collapse runs of
-- whitespace to one space, strip the leading/trailing space, lower-case. The
-- whitespace class below is spelled out explicitly (not \s) so it does not
-- depend on the database's locale/ICU and equals JavaScript's \s, which
-- merchantKey() uses.

BEGIN;

CREATE TABLE IF NOT EXISTS public.merchants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name             TEXT NOT NULL CHECK (char_length(name) <= 80),
  name_key         TEXT GENERATED ALWAYS AS (
                     lower(regexp_replace(regexp_replace(name, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), '^ | $', '', 'g'))
                   ) STORED,
  default_category TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (name_key <> ''),
  UNIQUE (user_id, name_key),
  -- Target of the composite FK from merchant_aliases and from transactions.
  UNIQUE (id, user_id)
);

ALTER TABLE public.merchants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own merchants" ON public.merchants;
CREATE POLICY "Users can manage own merchants"
  ON public.merchants FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

DROP TRIGGER IF EXISTS set_updated_at_merchants ON public.merchants;
CREATE TRIGGER set_updated_at_merchants
  BEFORE UPDATE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE IF NOT EXISTS public.merchant_aliases (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  merchant_id UUID NOT NULL,
  -- alias_key must already be normalised, or it could never match.
  alias_key   TEXT NOT NULL CHECK (
                 char_length(alias_key) BETWEEN 1 AND 120
                 AND alias_key = lower(regexp_replace(regexp_replace(alias_key, '[\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+', ' ', 'g'), '^ | $', '', 'g'))
               ),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, alias_key),
  -- Composite FK: an alias can only point at a merchant of the same user.
  FOREIGN KEY (merchant_id, user_id)
    REFERENCES public.merchants(id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_merchant_aliases_merchant
  ON public.merchant_aliases(merchant_id);

ALTER TABLE public.merchant_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own merchant aliases" ON public.merchant_aliases;
CREATE POLICY "Users can manage own merchant aliases"
  ON public.merchant_aliases FOR ALL TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS merchant_id UUID;

-- Composite FK: a transaction can only link a merchant of the same user, for
-- every role including service_role. Deleting a merchant clears only
-- merchant_id (PG15+ column list), never user_id. Added in a DO block so a
-- re-run does not create a second constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'transactions_merchant_id_owner_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_merchant_id_owner_fkey
      FOREIGN KEY (merchant_id, user_id)
      REFERENCES public.merchants(id, user_id)
      ON DELETE SET NULL (merchant_id);
  END IF;
END$$;

-- Covers the FK: deleting a merchant looks up transactions by merchant_id.
CREATE INDEX IF NOT EXISTS idx_transactions_merchant
  ON public.transactions(merchant_id, user_id)
  WHERE merchant_id IS NOT NULL;

COMMIT;

- [ ] **Step 2: Commit**

```bash
git add -- supabase/048_merchants.sql
git commit -m "feat: add merchants tables and transactions.merchant_id" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- supabase/048_merchants.sql
```

The migration is **not applied** here. Task 11 applies it before any merge.

---

### Task 2: schema.sql for fresh installs

**Files:**
- Modify: `supabase/schema.sql` — append after the `-- 018 —` block (ends near line 767,
  `idx_transactions_possible_duplicate_of`), before the `-- 019 —` comment.

- [ ] **Step 1: Insert the block**

Paste the body of `048_merchants.sql` from `CREATE TABLE IF NOT EXISTS public.merchants`
through the `REVOKE` line (no `BEGIN;`/`COMMIT;`), headed by:

```sql
-- 048 — per-user saved merchants. transactions.merchant stays free text;
-- merchant_id links a row only when the user picked a merchant. The ADD COLUMN
-- IF NOT EXISTS below is the safety net for databases created before 048.
```

The file's `transactions` table must **not** gain `merchant_id` inline — the
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the pasted block is what delivers it,
matching how 042's `card_id` is done in this file.

- [ ] **Step 2: Check it parses as one file order**

Run: `git grep -n "public.merchants" -- supabase/schema.sql`
Expected: the `CREATE TABLE` line appears **before** the `ADD COLUMN IF NOT EXISTS merchant_id` line.

- [ ] **Step 3: Commit**

```bash
git add -- supabase/schema.sql
git commit -m "feat: deliver merchants tables in schema.sql" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- supabase/schema.sql
```

---

### Task 3: Database types

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add `merchant_id` to transactions**

In `transactions.Row` after `loan_source_note: string | null` (line ~113) add:
```ts
          /** Link to a saved merchant (migration 048). Set only by an explicit user pick. */
          merchant_id: string | null
```
In `transactions.Insert` after `loan_source_note?: string | null` (line ~152) and in
`transactions.Update` after `loan_source_note?: string | null` (line ~184) add:
```ts
          merchant_id?: string | null
```

- [ ] **Step 2: Add the two tables**

Directly after the closing `}` of `merchant_rules` (line ~320), add:
```ts
      merchants: {
        Row: {
          id: string
          user_id: string
          name: string
          /** Generated by Postgres — never written by the client. */
          name_key: string
          default_category: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          user_id: string
          name: string
          default_category?: string | null
        }
        Update: {
          name?: string
          default_category?: string | null
        }
      }
      merchant_aliases: {
        Row: {
          id: string
          user_id: string
          merchant_id: string
          alias_key: string
          created_at: string
        }
        Insert: {
          user_id: string
          merchant_id: string
          alias_key: string
        }
        Update: {
          alias_key?: string
        }
      }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc -b`
Expected: exit 0. If the typed client needs `Relationships: []` on each table
(check how `cards` is declared a few lines below and copy exactly what it has),
add it and re-run.

- [ ] **Step 4: Commit**

```bash
git add -- src/types/database.ts
git commit -m "feat: type merchants tables and merchant_id" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- src/types/database.ts
```

---

### Task 4: Pure helpers — key, match, filter

**Files:**
- Create: `src/utils/merchantKey.ts`
- Test: `src/utils/merchantKey.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { merchantKey, matchMerchant, filterMerchants, type MerchantOption } from './merchantKey'

const m = (id: string, name: string, aliases: string[] = []): MerchantOption => ({
  id,
  name,
  default_category: null,
  aliases,
})

describe('merchantKey', () => {
  it('lower-cases, trims and collapses spaces — same rule as name_key in 048', () => {
    expect(merchantKey('  Sharma   Kirana ')).toBe('sharma kirana')
  })
  it('treats null and blank as empty', () => {
    expect(merchantKey(null)).toBe('')
    expect(merchantKey('   ')).toBe('')
  })
  it('collapses tabs and newlines too', () => {
    expect(merchantKey('Swiggy\t\nBLR')).toBe('swiggy blr')
  })
})

describe('matchMerchant', () => {
  const list = [m('1', 'Swiggy', ['swiggy blr', 'swiggy order']), m('2', 'Amazon')]

  it('matches the name regardless of case and spacing', () => {
    expect(matchMerchant(' AMAZON ', list)?.id).toBe('2')
  })
  it('matches a saved alias', () => {
    expect(matchMerchant('SWIGGY  BLR', list)?.id).toBe('1')
  })
  it('does not match a mere substring', () => {
    expect(matchMerchant('Swiggy Instamart', list)).toBeNull()
  })
  it('returns null for empty text', () => {
    expect(matchMerchant('', list)).toBeNull()
  })
})

describe('filterMerchants', () => {
  const list = [
    m('1', 'Zepto'),
    m('2', 'Amazon'),
    m('3', 'Big Bazaar', ['bb store']),
    m('4', 'Amazon Pay'),
    m('5', 'Nazara'),
  ]

  it('returns everything alphabetically for an empty query, capped by limit', () => {
    expect(filterMerchants('', list, 3).map((x) => x.name)).toEqual(['Amazon', 'Amazon Pay', 'Big Bazaar'])
  })
  it('puts name prefix matches before substring matches', () => {
    expect(filterMerchants('az', list).map((x) => x.name)).toEqual(['Amazon', 'Amazon Pay', 'Big Bazaar', 'Nazara'])
    expect(filterMerchants('ama', list).map((x) => x.name)).toEqual(['Amazon', 'Amazon Pay'])
  })
  it('finds a merchant through an alias', () => {
    expect(filterMerchants('bb st', list).map((x) => x.name)).toEqual(['Big Bazaar'])
  })
})
```

Note on the `'az'` case: no name *starts* with "az", so all four are substring
matches, sorted alphabetically.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/utils/merchantKey.test.ts`
Expected: FAIL — cannot resolve `./merchantKey`.

- [ ] **Step 3: Implement**

```ts
// ============================================
// merchantKey — how merchant names are compared.
//
// merchantKey() must stay byte-for-byte the same rule as the generated
// `name_key` column in supabase/048_merchants.sql, or a merchant the database
// calls a duplicate would look new here (and the reverse).
// ============================================

export interface MerchantOption {
  id: string
  name: string
  default_category: string | null
  /** alias_key values — already normalised. */
  aliases: string[]
}

export function merchantKey(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** Exact match on a merchant's name or one of its aliases. Never a substring. */
export function matchMerchant(text: string | null | undefined, merchants: MerchantOption[]): MerchantOption | null {
  const key = merchantKey(text)
  if (!key) return null
  return (
    merchants.find((m) => merchantKey(m.name) === key) ??
    merchants.find((m) => m.aliases.includes(key)) ??
    null
  )
}

const byName = (a: MerchantOption, b: MerchantOption) => a.name.localeCompare(b.name)

/** Picker suggestions: name-prefix matches first, then name/alias substring matches. */
export function filterMerchants(query: string, merchants: MerchantOption[], limit = 8): MerchantOption[] {
  const q = merchantKey(query)
  if (!q) return [...merchants].sort(byName).slice(0, limit)

  const prefix: MerchantOption[] = []
  const contains: MerchantOption[] = []
  for (const m of merchants) {
    const name = merchantKey(m.name)
    if (name.startsWith(q)) prefix.push(m)
    else if (name.includes(q) || m.aliases.some((a) => a.includes(q))) contains.push(m)
  }
  return [...prefix.sort(byName), ...contains.sort(byName)].slice(0, limit)
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/utils/merchantKey.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add -- src/utils/merchantKey.ts src/utils/merchantKey.test.ts
git commit -m "feat: merchant key, match and filter helpers" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- src/utils/merchantKey.ts src/utils/merchantKey.test.ts
```

---

### Task 5: Merchants service

**Files:**
- Create: `src/services/merchants.ts`
- Test: `src/services/merchants.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Each call to supabase.from(table) takes the next scripted response for that
// table. Every builder method returns the same chain; awaiting the chain (or
// calling .single()) resolves the scripted value.
const script: Record<string, Array<{ data: unknown; error: unknown }>> = {}
const inserts: Array<{ table: string; row: unknown }> = []

function chainFor(table: string) {
  const next = () => (script[table] ?? []).shift() ?? { data: null, error: null }
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: () => chain,
    insert: (row: unknown) => {
      inserts.push({ table, row })
      return chain
    },
    single: () => Promise.resolve(next()),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(next()).then(resolve, reject),
  }
  return chain
}

vi.mock('./supabase', () => ({
  supabase: { from: (table: string) => chainFor(table) },
}))

import { listMerchants, createMerchant, addMerchantAlias } from './merchants'

beforeEach(() => {
  for (const k of Object.keys(script)) delete script[k]
  inserts.length = 0
})

describe('listMerchants', () => {
  it('joins aliases onto their merchants', async () => {
    script.merchants = [{ data: [{ id: 'm1', name: 'Swiggy', default_category: 'Food & Dining' }], error: null }]
    script.merchant_aliases = [{ data: [{ merchant_id: 'm1', alias_key: 'swiggy blr' }], error: null }]

    const { data, error } = await listMerchants()
    expect(error).toBeNull()
    expect(data).toEqual([{ id: 'm1', name: 'Swiggy', default_category: 'Food & Dining', aliases: ['swiggy blr'] }])
  })

  it('returns an empty list and the error when the read fails', async () => {
    script.merchants = [{ data: null, error: { message: 'boom' } }]
    const { data, error } = await listMerchants()
    expect(data).toEqual([])
    expect(error).toEqual({ message: 'boom' })
  })
})

describe('createMerchant', () => {
  it('saves a tidied name and returns the new merchant', async () => {
    script.merchants = [{ data: { id: 'm9', name: 'Sharma Kirana', default_category: null }, error: null }]
    const { data } = await createMerchant('u1', '  Sharma   Kirana ', null)
    expect(inserts[0]).toEqual({ table: 'merchants', row: { user_id: 'u1', name: 'Sharma Kirana', default_category: null } })
    expect(data).toEqual({ id: 'm9', name: 'Sharma Kirana', default_category: null, aliases: [] })
  })

  it('returns the existing merchant on a duplicate name instead of failing', async () => {
    script.merchants = [
      { data: null, error: { code: '23505', message: 'duplicate' } },
      { data: { id: 'm1', name: 'Swiggy', default_category: 'Food & Dining' }, error: null },
    ]
    const { data, error } = await createMerchant('u1', 'swiggy', null)
    expect(error).toBeNull()
    expect(data?.id).toBe('m1')
  })

  it('refuses a blank name without calling the database', async () => {
    const { data, error } = await createMerchant('u1', '   ', null)
    expect(data).toBeNull()
    expect(error).toBeInstanceOf(Error)
    expect(inserts).toHaveLength(0)
  })
})

describe('addMerchantAlias', () => {
  const swiggy = { id: 'm1', name: 'Swiggy', default_category: null, aliases: ['swiggy blr'] }

  it('stores a new spelling as a normalised alias', async () => {
    await addMerchantAlias('u1', swiggy, 'SWIGGY  Order')
    expect(inserts).toEqual([{ table: 'merchant_aliases', row: { user_id: 'u1', merchant_id: 'm1', alias_key: 'swiggy order' } }])
  })

  it('skips the name itself and aliases it already has', async () => {
    await addMerchantAlias('u1', swiggy, ' swiggy ')
    await addMerchantAlias('u1', swiggy, 'Swiggy BLR')
    await addMerchantAlias('u1', swiggy, '')
    expect(inserts).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/services/merchants.test.ts`
Expected: FAIL — cannot resolve `./merchants`.

- [ ] **Step 3: Implement**

```ts
// ============================================
// Merchants service — the user's saved merchant list (migration 048).
//
// RLS scopes every read to the signed-in user. Aliases are read in a second
// query and joined here rather than as an embedded select, so this does not
// depend on relationship metadata in the generated types.
// ============================================

import { supabase } from './supabase'
import { merchantKey, type MerchantOption } from '@/utils/merchantKey'

/** Rows per page — PostgREST silently stops at db-max-rows otherwise. */
const PAGE_SIZE = 1000

async function readAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = []
  for (let offset = 0; ; ) {
    const { data, error } = await build(offset, offset + PAGE_SIZE - 1)
    if (error) return { rows, error }
    const page = data ?? []
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { rows, error: null }
    offset += page.length
  }
}

export async function listMerchants(): Promise<{ data: MerchantOption[]; error: unknown }> {
  const merchants = await readAll<{ id: string; name: string; default_category: string | null }>((from, to) =>
    supabase.from('merchants').select('id, name, default_category').order('id', { ascending: true }).range(from, to)
  )
  if (merchants.error) return { data: [], error: merchants.error }

  const aliases = await readAll<{ merchant_id: string; alias_key: string }>((from, to) =>
    supabase.from('merchant_aliases').select('merchant_id, alias_key').order('id', { ascending: true }).range(from, to)
  )
  // Aliases only widen matching; without them the list still works.
  const byMerchant = new Map<string, string[]>()
  for (const a of aliases.rows) {
    byMerchant.set(a.merchant_id, [...(byMerchant.get(a.merchant_id) ?? []), a.alias_key])
  }

  return {
    data: merchants.rows.map((m) => ({ ...m, aliases: byMerchant.get(m.id) ?? [] })),
    error: null,
  }
}

export async function createMerchant(
  userId: string,
  name: string,
  defaultCategory: string | null
): Promise<{ data: MerchantOption | null; error: unknown }> {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (!clean) return { data: null, error: new Error('Merchant name is empty') }

  const { data, error } = await supabase
    .from('merchants')
    .insert({ user_id: userId, name: clean, default_category: defaultCategory })
    .select('id, name, default_category')
    .single()

  if (!error && data) return { data: { ...data, aliases: [] }, error: null }

  // Same name already saved (UNIQUE user_id, name_key): use that one.
  if ((error as { code?: string } | null)?.code === '23505') {
    const existing = await supabase
      .from('merchants')
      .select('id, name, default_category')
      .eq('user_id', userId)
      .eq('name_key', merchantKey(clean))
      .single()
    if (existing.data) return { data: { ...existing.data, aliases: [] }, error: null }
    return { data: null, error: existing.error }
  }
  return { data: null, error }
}

/**
 * Remember another spelling for a merchant the user just picked. Best effort:
 * a failure only means this spelling won't pre-match next time.
 */
export async function addMerchantAlias(userId: string, merchant: MerchantOption, typed: string): Promise<void> {
  const key = merchantKey(typed)
  if (!key || key === merchantKey(merchant.name) || merchant.aliases.includes(key)) return
  await supabase.from('merchant_aliases').insert({ user_id: userId, merchant_id: merchant.id, alias_key: key })
}
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/services/merchants.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Type-check**

Run: `npx tsc -b`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add -- src/services/merchants.ts src/services/merchants.test.ts
git commit -m "feat: merchants service" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- src/services/merchants.ts src/services/merchants.test.ts
```

---

### Task 6: MerchantPicker component

**Behaviour:**
- Typing shows up to 8 saved merchants (`filterMerchants`).
- Typing a saved merchant's exact name or alias links it (it is the same merchant
  by definition — the name is unique per user). Anything else is unlinked text.
- Last dropdown row when the text is not an exact match: **+ Add "<text>" as a merchant**.
  It opens an inline panel under the box: Name (prefilled), Usual category (optional),
  Save / Cancel. Save creates, selects, closes.
- Picking a merchant from the list after typing a different spelling stores that
  spelling as an alias.
- The picker never changes category itself; it passes `defaultCategory` up.

**Files:**
- Create: `src/components/merchants/MerchantPicker.tsx`
- Test: `src/components/merchants/MerchantPicker.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import MerchantPicker, { type MerchantPickerValue } from './MerchantPicker'

const listMerchants = vi.fn()
const createMerchant = vi.fn()
const addMerchantAlias = vi.fn()

vi.mock('@/services/merchants', () => ({
  listMerchants: (...a: unknown[]) => listMerchants(...a),
  createMerchant: (...a: unknown[]) => createMerchant(...a),
  addMerchantAlias: (...a: unknown[]) => addMerchantAlias(...a),
}))

vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

vi.mock('@/context/CategoriesContext', () => ({
  useCategories: () => ({
    categories: [
      { id: '1', name: 'Food & Dining', emoji: '🍔' },
      { id: '2', name: 'Shopping', emoji: '🛍️' },
    ],
  }),
}))

const SWIGGY = { id: 'm1', name: 'Swiggy', default_category: 'Food & Dining', aliases: ['swiggy blr'] }
const AMAZON = { id: 'm2', name: 'Amazon', default_category: null, aliases: [] }

function Harness({ onChange }: { onChange: (v: MerchantPickerValue) => void }) {
  return <MerchantPicker id="mp" label="Merchant" value={{ text: '', merchantId: null }} onChange={onChange} />
}

beforeEach(() => {
  vi.clearAllMocks()
  listMerchants.mockResolvedValue({ data: [SWIGGY, AMAZON], error: null })
  addMerchantAlias.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('MerchantPicker', () => {
  it('lists saved merchants matching what is typed', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    expect(await screen.findByRole('option', { name: /Swiggy/ })).toBeDefined()
    expect(screen.queryByRole('option', { name: /Amazon/ })).toBeNull()
  })

  it('links the merchant and passes its usual category when picked', async () => {
    const onChange = vi.fn()
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Swiggy/ }))
    expect(onChange).toHaveBeenLastCalledWith({ text: 'Swiggy', merchantId: 'm1', defaultCategory: 'Food & Dining' })
  })

  it('remembers the typed spelling as an alias when it differs', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'swi', merchantId: null }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Swiggy/ }))
    expect(addMerchantAlias).toHaveBeenCalledWith('u1', SWIGGY, 'swi')
  })

  it('links on an exact typed name, and unlinks on anything else', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    // Wait until the saved list is in state: with an empty query every merchant shows.
    fireEvent.focus(screen.getByLabelText('Merchant'))
    await screen.findByRole('option', { name: /Swiggy/ })

    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'swiggy blr' } })
    expect(onChange).toHaveBeenLastCalledWith({ text: 'swiggy blr', merchantId: 'm1', defaultCategory: 'Food & Dining' })

    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'Swiggy Instamart' } })
    expect(onChange).toHaveBeenLastCalledWith({ text: 'Swiggy Instamart', merchantId: null, defaultCategory: null })
  })

  it('adds a new merchant through the inline panel and selects it', async () => {
    createMerchant.mockResolvedValue({
      data: { id: 'm3', name: 'Sharma Kirana', default_category: 'Shopping', aliases: [] },
      error: null,
    })
    const onChange = vi.fn()
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'Sharma Kirana', merchantId: null }} onChange={onChange} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Add "Sharma Kirana" as a merchant/ }))

    expect((screen.getByLabelText('Merchant name') as HTMLInputElement).value).toBe('Sharma Kirana')
    fireEvent.change(screen.getByLabelText('Usual category (optional)'), { target: { value: 'Shopping' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save merchant' }))

    await waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({ text: 'Sharma Kirana', merchantId: 'm3', defaultCategory: 'Shopping' })
    )
    expect(createMerchant).toHaveBeenCalledWith('u1', 'Sharma Kirana', 'Shopping')
    expect(screen.queryByLabelText('Merchant name')).toBeNull()
  })

  it('does not offer "Add" when the text already is a saved merchant', async () => {
    render(<MerchantPicker id="mp" label="Merchant" value={{ text: 'Amazon', merchantId: 'm2' }} onChange={vi.fn()} />)
    fireEvent.focus(screen.getByLabelText('Merchant'))
    await screen.findByRole('option', { name: /Amazon/ })
    expect(screen.queryByRole('option', { name: /as a merchant/ })).toBeNull()
  })

  it('still accepts free text when the list fails to load', async () => {
    listMerchants.mockResolvedValue({ data: [], error: { message: 'offline' } })
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Merchant'), { target: { value: 'Chai Point' } })
    expect(onChange).toHaveBeenLastCalledWith({ text: 'Chai Point', merchantId: null, defaultCategory: null })
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/merchants/MerchantPicker.test.tsx`
Expected: FAIL — cannot resolve `./MerchantPicker`.

- [ ] **Step 3: Implement**

```tsx
// ============================================
// MerchantPicker — pick a saved merchant, or add one, in one box.
//
// The only place the app links a transaction to a merchant (spec
// 2026-09-14-merchant-list-design.md). Free text is always accepted: a failed
// list load or an unsaved name never blocks saving the transaction.
// ============================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Store } from 'lucide-react'
import { Button, Input, Select } from '@/components/ui'
import { useAuth } from '@/context/AuthContext'
import { useCategories } from '@/context/CategoriesContext'
import { addMerchantAlias, createMerchant, listMerchants } from '@/services/merchants'
import { filterMerchants, matchMerchant, merchantKey, type MerchantOption } from '@/utils/merchantKey'
import { cn } from '@/utils'

export interface MerchantPickerValue {
  text: string
  merchantId: string | null
  /** The picked merchant's usual category, for the parent to pre-fill. Only on change. */
  defaultCategory?: string | null
}

interface MerchantPickerProps {
  id: string
  label?: string
  placeholder?: string
  value: MerchantPickerValue
  onChange: (next: Required<MerchantPickerValue>) => void
  className?: string
}

export default function MerchantPicker({ id, label, placeholder = 'e.g. Swiggy', value, onChange, className }: MerchantPickerProps) {
  const { user } = useAuth()
  const { categories } = useCategories()
  const [merchants, setMerchants] = useState<MerchantOption[]>([])
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    listMerchants().then(({ data }) => {
      if (alive) setMerchants(data)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const suggestions = useMemo(() => filterMerchants(value.text, merchants), [value.text, merchants])
  const exact = useMemo(() => matchMerchant(value.text, merchants), [value.text, merchants])
  const canAdd = merchantKey(value.text) !== '' && !exact

  const emit = (text: string, merchant: MerchantOption | null) =>
    onChange({ text, merchantId: merchant?.id ?? null, defaultCategory: merchant?.default_category ?? null })

  const handleType = (text: string) => {
    setOpen(true)
    emit(text, matchMerchant(text, merchants))
  }

  const pick = (merchant: MerchantOption) => {
    if (user) void addMerchantAlias(user.id, merchant, value.text)
    emit(merchant.name, merchant)
    setOpen(false)
  }

  const startAdd = () => {
    setNewName(value.text.replace(/\s+/g, ' ').trim())
    setNewCategory('')
    setAddError('')
    setAdding(true)
    setOpen(false)
  }

  const saveNew = async () => {
    if (!user) return
    setSaving(true)
    const { data, error } = await createMerchant(user.id, newName, newCategory || null)
    setSaving(false)
    if (!data) {
      setAddError(error instanceof Error ? error.message : 'Could not save this merchant. Try again.')
      return
    }
    setMerchants((prev) => (prev.some((m) => m.id === data.id) ? prev : [...prev, data]))
    emit(data.name, data)
    setAdding(false)
  }

  const listId = `${id}-options`

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Input
        id={id}
        label={label}
        placeholder={placeholder}
        value={value.text}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => handleType(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {value.merchantId && (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-sb-ink-muted">
          <Store className="h-3 w-3" aria-hidden="true" /> Saved merchant
        </p>
      )}

      {open && (suggestions.length > 0 || canAdd) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-sb-hairline bg-surface-1 p-1.5 shadow-xl"
        >
          {suggestions.map((m) => (
            <li
              key={m.id}
              role="option"
              aria-selected={m.id === value.merchantId}
              // mouseDown, not click: fires before the input blurs.
              onMouseDown={(e) => {
                e.preventDefault()
                pick(m)
              }}
              className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-lg px-3 text-sm text-sb-ink hover:bg-surface-2"
            >
              <span className="truncate">{m.name}</span>
              {m.default_category && <span className="shrink-0 text-[11px] text-sb-ink-muted">{m.default_category}</span>}
            </li>
          ))}
          {canAdd && (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => {
                e.preventDefault()
                startAdd()
              }}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-sm font-medium text-brand-700 hover:bg-brand-500/10"
            >
              <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="truncate">Add "{value.text.trim()}" as a merchant</span>
            </li>
          )}
        </ul>
      )}

      {adding && (
        <div className="mt-2 space-y-3 rounded-xl border border-sb-hairline bg-surface-2/40 p-3">
          <Input
            id={`${id}-new-name`}
            label="Merchant name"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={80}
          />
          <Select
            id={`${id}-new-category`}
            label="Usual category (optional)"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            options={[
              { value: '', label: 'No usual category' },
              ...categories.map((c) => ({ value: c.name, label: `${c.emoji} ${c.name}` })),
            ]}
          />
          {addError && (
            <p role="alert" className="text-xs text-[var(--status-danger-text)]">
              {addError}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" onClick={saveNew} loading={saving} disabled={!merchantKey(newName)}>
              Save merchant
            </Button>
            <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
```

Before running: open `src/components/ui/Select.tsx` and `Button.tsx` and confirm
`Select` accepts `label` + `options` and `Button` accepts `variant="ghost"` and
`loading`. If a prop name differs, use the real one (e.g. `variant="secondary"`)
in both the component and nothing else — the tests don't depend on it.

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/components/merchants/MerchantPicker.test.tsx`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the key tests guard real behaviour**

Temporarily change `handleType` to `emit(text, null)`. Re-run: the
"links on an exact typed name" test must FAIL. Restore. Temporarily delete the
`addMerchantAlias` line in `pick`. Re-run: the alias test must FAIL. Restore and
re-run: PASS.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc -b && npx eslint src/components/merchants/`
Expected: exit 0, no problems.

- [ ] **Step 7: Commit**

```bash
git add -- src/components/merchants/MerchantPicker.tsx src/components/merchants/MerchantPicker.test.tsx
git commit -m "feat: merchant picker with add-merchant panel" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- src/components/merchants/MerchantPicker.tsx src/components/merchants/MerchantPicker.test.tsx
```

---

### Task 7: NewTransactionModal (Dashboard add)

**Files:**
- Modify: `src/components/dashboard/NewTransactionModal.tsx`
- Modify: `src/components/dashboard/NewTransactionModal.test.tsx`

Line numbers below are from the committed file restored in Task 0.

- [ ] **Step 1: Update the test first**

Replace the `'renders merchant input with autocomplete datalist'` test with:
```tsx
  it('uses the saved-merchant picker for the merchant field', () => {
    render(<NewTransactionModal open={true} onClose={mockOnClose} onAdded={mockOnAdded} />)
    expect(screen.getByRole('combobox', { name: 'Merchant' })).toBeDefined()
    expect(document.getElementById('modal-merchant-suggestions')).toBeNull()
  })

  it('pre-fills the category from a picked merchant, and saves the link', async () => {
    render(<NewTransactionModal open={true} onClose={mockOnClose} onAdded={mockOnAdded} />)
    fireEvent.change(screen.getByPlaceholderText(/Amount/), { target: { value: '250' } })
    const box = screen.getByRole('combobox', { name: 'Merchant' })
    fireEvent.focus(box)
    fireEvent.mouseDown(await screen.findByRole('option', { name: /Swiggy/ }))
    fireEvent.click(screen.getByRole('button', { name: /Add Transaction/i }))

    const { createTransaction } = await import('@/services/transactions')
    await waitFor(() =>
      expect(createTransaction).toHaveBeenCalledWith(
        expect.objectContaining({ merchant: 'Swiggy', merchant_id: 'm1', category: 'Food & Dining' })
      )
    )
  })
```
Add mocks next to the existing ones:
```tsx
vi.mock('@/services/merchants', () => ({
  listMerchants: vi.fn().mockResolvedValue({
    data: [{ id: 'm1', name: 'Swiggy', default_category: 'Food & Dining', aliases: [] }],
    error: null,
  }),
  createMerchant: vi.fn(),
  addMerchantAlias: vi.fn().mockResolvedValue(undefined),
}))
```
If the committed test mocks `getDistinctMerchants` or asserts on a `KNOWN_MERCHANTS`
datalist, delete those lines — that source is gone.

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run src/components/dashboard/NewTransactionModal.test.tsx`
Expected: FAIL — no combobox named "Merchant".

- [ ] **Step 3: Implement**

1. Imports: remove `import { KNOWN_MERCHANTS } from '@/services/merchantNormalizer'`; add
   `import MerchantPicker from '@/components/merchants/MerchantPicker'`.
2. State: after `const [merchant, setMerchant] = useState('')` add
   `const [merchantId, setMerchantId] = useState<string | null>(null)`.
3. `resetForm`: after `setMerchant('')` add `setMerchantId(null)`.
4. `createTransaction({...})`: after the `merchant:` line add
   `merchant_id: merchantId,`.
5. Replace the merchant `<div className="min-w-0 flex-1"> … </div>` (the `Input` with
   `list="modal-merchant-suggestions"` and its `<datalist>`) with:
```tsx
          <div className="min-w-0 flex-1">
            <MerchantPicker
              id="ntm-merchant"
              label="Merchant"
              placeholder="Merchant (e.g. Swiggy, Amazon)"
              value={{ text: merchant, merchantId }}
              onChange={({ text, merchantId: id, defaultCategory }) => {
                setMerchant(text)
                setMerchantId(id)
                // Fill only an empty category — never overwrite the user's pick.
                if (defaultCategory && !category) setCategory(defaultCategory)
              }}
            />
          </div>
```

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run src/components/dashboard/NewTransactionModal.test.tsx`
Expected: PASS (all tests in file).

- [ ] **Step 5: Commit**

```bash
git add -- src/components/dashboard/NewTransactionModal.tsx src/components/dashboard/NewTransactionModal.test.tsx
git commit -m "feat: saved-merchant picker in the add transaction popup" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- src/components/dashboard/NewTransactionModal.tsx src/components/dashboard/NewTransactionModal.test.tsx
```

---

### Task 8: ExpenseForm (Expenses add/edit, Insights drill-down edit)

No test file exists for this form (see `2026-08-09-editable-merchant-field-design.md`);
it is covered by the picker tests plus the browser check in Task 11.

**Files:**
- Modify: `src/components/expenses/ExpenseForm.tsx`

- [ ] **Step 1: Implement**

1. Imports: remove `import { KNOWN_MERCHANTS } from '@/services/merchantNormalizer'`; add
   `import MerchantPicker from '@/components/merchants/MerchantPicker'`.
2. After `const [merchant, setMerchant] = useState(editingTransaction?.merchant || '')` add:
```tsx
  const [merchantId, setMerchantId] = useState<string | null>(editingTransaction?.merchant_id ?? null)
  // An edit already has a chosen category; a new form has only the default.
  const [categoryTouched, setCategoryTouched] = useState(Boolean(editingTransaction))
```
3. Wherever the Category `Select` calls `setCategory(e.target.value)`, change its
   `onChange` to `(e) => { setCategory(e.target.value); setCategoryTouched(true) }`.
4. In **both** `updateTransaction({...})` and `createTransaction({...})`, after
   `merchant: merchant.trim() || null,` add `merchant_id: merchantId,`.
5. In the `if (!isEditing) { … }` reset block, after `setMerchant('')` add
   `setMerchantId(null)` and `setCategoryTouched(false)`.
6. Replace the merchant `<div>` (the `Input` with `list="merchant-suggestions"` and
   its `<datalist>`) with:
```tsx
            <MerchantPicker
              id="txn-merchant"
              label="Merchant"
              placeholder="e.g. Swiggy"
              value={{ text: merchant, merchantId }}
              onChange={({ text, merchantId: id, defaultCategory }) => {
                setMerchant(text)
                setMerchantId(id)
                if (defaultCategory && !categoryTouched) setCategory(defaultCategory)
              }}
            />
```

- [ ] **Step 2: Type-check and run the full suite**

Run: `npx tsc -b && npx vitest run`
Expected: exit 0; all tests pass. (If a scanner test fails on a `Date.now()`
assertion, re-run that file alone before investigating — known CPU-contention flake.)

- [ ] **Step 3: Commit**

```bash
git add -- src/components/expenses/ExpenseForm.tsx
git commit -m "feat: saved-merchant picker in the expense form" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- src/components/expenses/ExpenseForm.tsx
```

---

### Task 9: PendingPage — merchant field, pre-select, save link

**STOP: get the owner's second confirmation before this task** (scanner UI entry
point). Nothing in the scanner engine changes; only what the review card shows and
what approval writes.

**Files:**
- Modify: `src/pages/PendingPage.tsx`

- [ ] **Step 1: Widen the editable fields type**

Define once near the top of the component file (above the component):
```tsx
type ReviewFields = { category: string; description: string; merchant: string; merchantId: string | null }
```
Replace every `{ category: string; description: string }` in this file with
`ReviewFields` (lines ~229, ~417, ~507). Replace each fallback object
`{ category: txn.category, description: txn.description || '' }` (lines ~546, ~592,
~765, and `localFields` at ~1633) with:
```tsx
{ category: txn.category, description: txn.description || '', merchant: txn.merchant || '', merchantId: txn.merchant_id ?? null }
```
Run `git grep -n "description: string }" -- src/pages/PendingPage.tsx` — expected: no output.

- [ ] **Step 2: Select `merchant_id` and seed the fields**

At line ~340 add `merchant_id` to the select string:
`.select('id, amount, type, category, currency, date, merchant, merchant_id, description, possible_duplicate_of')`
and, if the row type there is a `Pick<…>` (line ~91), add `'merchant_id'` to it.

In the `fieldsMap` loop (~417) add to each entry:
```tsx
          merchant: t.merchant || '',
          merchantId: t.merchant_id ?? null,
```

- [ ] **Step 3: Pre-select a matching saved merchant**

Add imports:
```tsx
import MerchantPicker from '@/components/merchants/MerchantPicker'
import { listMerchants } from '@/services/merchants'
import { matchMerchant, type MerchantOption } from '@/utils/merchantKey'
```
After the `editingFields` state add:
```tsx
  // Saved merchants, only to PRE-SELECT one on each card. The user still sees
  // it and can change or clear it; approving is what saves the link.
  const [savedMerchants, setSavedMerchants] = useState<MerchantOption[]>([])
  useEffect(() => {
    listMerchants().then(({ data }) => setSavedMerchants(data))
  }, [])
  useEffect(() => {
    if (savedMerchants.length === 0) return
    setEditingFields((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [id, f] of Object.entries(prev)) {
        if (f.merchantId) continue
        const hit = matchMerchant(f.merchant, savedMerchants)
        if (hit) {
          next[id] = { ...f, merchant: hit.name, merchantId: hit.id }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [savedMerchants, editingFields])
```

- [ ] **Step 4: Save the merchant on approval**

In `commitApproval`'s `updateTransaction(txn.id, { … })` (~511) add after `description`:
```tsx
        merchant: fields.merchant.trim() || null,
        merchant_id: fields.merchantId,
```

- [ ] **Step 5: Add the field to the card**

`handleFieldChange` (~482) only takes `'category' | 'description'`. Add beside it:
```tsx
  const handleMerchantChange = (id: string, merchant: string, merchantId: string | null) => {
    setEditingFields((prev) => ({ ...prev, [id]: { ...prev[id], merchant, merchantId } }))
  }
```
In the card grid (~1795) change `sm:grid-cols-2` to `sm:grid-cols-3` and insert as the
first child, before the Category `<div>`:
```tsx
                    <MerchantPicker
                      id={`merchant-${txn.id}`}
                      label="Merchant"
                      placeholder="e.g. Swiggy"
                      value={{ text: localFields.merchant, merchantId: localFields.merchantId }}
                      // Category is not pre-filled here: the categoriser already chose one.
                      onChange={({ text, merchantId }) => handleMerchantChange(txn.id, text, merchantId)}
                    />
```
The picker's label is `text-sm`-styled by `Input`; the neighbours use a hand-written
`text-xs` label. Check in the browser (Task 11) that the three align; if not, pass no
`label` and add a matching hand-written `<label htmlFor={`merchant-${txn.id}`}>` above.

- [ ] **Step 6: Type-check, lint, test**

```bash
npx tsc -b && npx eslint src/pages/PendingPage.tsx 2>&1 | tail -3 && npx vitest run
```
Expected: tsc exit 0; lint count for this file ≤ Task 0 baseline; tests pass.

- [ ] **Step 7: Commit**

```bash
git add -- src/pages/PendingPage.tsx
git commit -m "feat: merchant field and saved-merchant pre-select on Pending" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- src/pages/PendingPage.tsx
```

---

### Task 10: RecordPlannedPaymentModal (Subscriptions)

**Files:**
- Modify: `src/components/subscriptions/RecordPlannedPaymentModal.tsx`

- [ ] **Step 1: Implement**

1. Add `import MerchantPicker from '@/components/merchants/MerchantPicker'`.
2. After `const [merchant, setMerchant] = useState<string>(displayName)` (line 56) add
   `const [merchantId, setMerchantId] = useState<string | null>(null)`.
3. In `handleLogNew`'s `createTransaction({...})` (line ~112) add after `merchant:`:
   `merchant_id: merchantId,`
4. Replace the `Input` with `id="plan-merchant"` (line ~291) and its label wrapper with:
```tsx
            <MerchantPicker
              id="plan-merchant"
              label="Merchant"
              value={{ text: merchant, merchantId }}
              // Category is fixed by the planned payment; never pre-filled from the merchant.
              onChange={({ text, merchantId: id }) => {
                setMerchant(text)
                setMerchantId(id)
              }}
            />
```
The "match existing" tab is unchanged: it edits an existing row's category and keeps
that row's merchant link as it is.

- [ ] **Step 2: Type-check and test**

Run: `npx tsc -b && npx vitest run`
Expected: exit 0; tests pass.

- [ ] **Step 3: Commit**

```bash
git add -- src/components/subscriptions/RecordPlannedPaymentModal.tsx
git commit -m "feat: saved-merchant picker when recording a planned payment" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- src/components/subscriptions/RecordPlannedPaymentModal.tsx
```

---

### Task 11: Identity files, full verification, migration, ship

**Files:**
- Modify: `ARCHITECTURE.md`, `CLAUDE.md`, `docs/superpowers/specs/2026-09-14-merchant-list-design.md`

- [ ] **Step 1: Sweep for stale claims**

```bash
git grep -n -i "KNOWN_MERCHANTS\|merchant-suggestions\|getDistinctMerchants\|next is \`048_\`" -- . ':!docs/superpowers/specs/2026-08-09-*'
```
Expected remaining hits only: `merchantNormalizer.ts` (export still used by its own
test), `merchantNormalizer.test.ts`, `emailScanner.ts` (its own unrelated local
constant), the new spec/plan. Anything else is stale — fix it.

- [ ] **Step 2: Update ARCHITECTURE.md**

- In the services list, add after `learningEngine.ts` entry:
  `` `merchants.ts` (the user's saved merchant list and spellings — migration 048), ``
- In the table list (the `| merchant_rules |` row, ~line 208) add below it:
  ```
  | `merchants` | The user's saved merchants (name, usual category) |
  | `merchant_aliases` | Other spellings that mean a saved merchant |
  ```
- Where components are listed, add `components/merchants/MerchantPicker.tsx` — the one
  place a transaction is linked to a merchant (`transactions.merchant_id`), used on the
  add popup, expense form, Pending and planned payments.

- [ ] **Step 3: Update CLAUDE.md**

Change "Supabase migrations are numbered sequentially in `supabase/` (next is `048_`)."
to "(next is `049_`)."

- [ ] **Step 4: Update the spec's linking rule to match what was built**

In `## Linking rules` replace the first bullet with:
```
- A transaction is linked only by an explicit user action: picking a merchant,
  typing a saved merchant's exact name or saved spelling, adding one, approving a
  Pending pre-selection, or confirming a cleanup group.
```

- [ ] **Step 5: Full checks**

```bash
npx tsc -b
npx vitest run
npm run build
npx eslint src/components/dashboard/NewTransactionModal.tsx src/components/expenses/ExpenseForm.tsx src/components/subscriptions/RecordPlannedPaymentModal.tsx src/pages/PendingPage.tsx src/types/database.ts src/components/merchants src/services/merchants.ts src/utils/merchantKey.ts 2>&1 | tail -3
```
Expected: tsc exit 0; all tests pass; build succeeds; lint count ≤ Task 0 baseline
(new files contribute zero).

- [ ] **Step 6: Commit docs**

```bash
git add -- ARCHITECTURE.md CLAUDE.md docs/superpowers/specs/2026-09-14-merchant-list-design.md
git commit -m "docs: record the saved merchant list" -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- ARCHITECTURE.md CLAUDE.md docs/superpowers/specs/2026-09-14-merchant-list-design.md
```

- [ ] **Step 7: Apply migration 048 to production — owner confirms first**

Ask the owner. On yes, apply `supabase/048_merchants.sql` with the Supabase MCP
`apply_migration` (name `048_merchants`) on project `dhanrakshak-497806`'s database.
Then verify with `execute_sql`:
```sql
select table_name from information_schema.tables where table_schema='public' and table_name in ('merchants','merchant_aliases');
select column_name from information_schema.columns where table_name='transactions' and column_name='merchant_id';
select policyname, roles, qual from pg_policies where tablename in ('merchants','merchant_aliases');
select grantee, privilege_type from information_schema.routine_privileges where routine_name='check_transaction_merchant_owner';
select name, name_key from (values ('  Sharma   Kirana ')) v(name), lateral (select lower(regexp_replace(regexp_replace(v.name, '\s+', ' ', 'g'), '^ | $', '', 'g')) as name_key) k;
```
Expected: both tables; the column; two policies scoped to `authenticated`; no
`anon`/`authenticated` EXECUTE rows; `name_key` = `sharma kirana` (same as `merchantKey`).

Then prove the owner check from the SQL editor as a real user id is not possible
here, so run it as a data check instead:
```sql
select count(*) from public.transactions t join public.merchants m on m.id = t.merchant_id where m.user_id <> t.user_id;
```
Expected: `0`.

- [ ] **Step 8: Verify in the real app (local dev, against the migrated DB)**

Start the dev server with the Browser pane (`preview_start`). As a signed-in user:
1. Dashboard → Add Transaction → type a new name → "+ Add … as a merchant" → pick a
   category → Save → category chip fills → add. Reopen: the merchant is listed.
2. Type a different case/spacing of that name → "Saved merchant" hint shows.
3. Expenses → edit that transaction → picker shows the merchant; change it; save.
4. Pending (if any rows) → merchant field present, aligned with Category/Description;
   a row whose merchant text matches a saved merchant is pre-selected; approve; the
   row in Expenses keeps the merchant.
5. Subscriptions → record a planned payment with a picked merchant.
6. Check `read_console_messages` for errors; screenshot at desktop and 375px width.
Report what was and was not verified.

- [ ] **Step 9: Ship — owner confirms the push**

Only after Step 7 is applied and verified and Step 8 passed, ask the owner to push
`main` (push deploys). Do not push without that yes.
