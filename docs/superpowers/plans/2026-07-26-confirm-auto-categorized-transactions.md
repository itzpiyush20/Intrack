# Confirm Auto-Categorized Transactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every transaction the system auto-categorizes and auto-approves without human review must be confirmable by the user via a popup on the Pending Alerts page — persisted in the database, not just shown once from a single scan's in-memory result.

**Architecture:** Add a `category_confirmed_at` column to `transactions`, `NULL` only for transactions the email-scanning engine auto-approves. `PendingPage.tsx` already has an "Auto-Categorization Review Modal" that appears after a manual scan — extend it to also fetch unconfirmed rows from the database on page load (not just from a live scan's return value), and change its per-row interaction from "auto-save on dropdown change" to "pick a category, then explicitly Confirm" (removing the row from the list and marking it confirmed in the DB).

**Tech Stack:** React + TypeScript (Vite), Supabase (Postgres), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-26-confirm-auto-categorized-transactions-design.md`

---

## Testing scope note

`src/services/emailScanner.ts` and `src/pages/PendingPage.tsx` have zero existing automated test coverage today (confirmed: no test file exists for either). Retrofitting full coverage for either is out of scope for this plan — consistent with how the automatic-Gmail-sync plan handled the same file. Verification for the tasks touching these two files is careful self-review plus an explicit manual verification step, not silently skipped.

---

### Task 1: Database migration — `category_confirmed_at` column

**Files:**
- Create: `supabase/007_category_confirmation.sql`
- Modify: `supabase/schema.sql:73-101` (transactions table definition)
- Modify: `src/types/database.ts:62-145` (transactions Row/Insert/Update types)

- [ ] **Step 1: Write the migration file**

```sql
-- ============================================================
-- Migration 007 — Category confirmation tracking
-- (one-time, run once against an existing production database;
-- the objects this creates are already part of supabase/schema.sql
-- for fresh installs)
--
-- Adds category_confirmed_at to transactions: NULL means "the system
-- auto-categorized and auto-approved this without human review, and the
-- user hasn't confirmed the category yet." Every other transaction (manual
-- entries, anything the user explicitly approved via Pending Alerts) has
-- a timestamp here, since those never needed a silent-auto-approval
-- confirmation in the first place.
--
-- Backfill: every transaction that already exists is treated as already
-- confirmed, by explicit product decision — this feature only applies to
-- categorizations made from this point forward, not the historical backlog.
-- ============================================================

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS category_confirmed_at TIMESTAMPTZ DEFAULT now();

UPDATE public.transactions SET category_confirmed_at = now() WHERE category_confirmed_at IS NULL;
```

- [ ] **Step 2: Add the same column to `supabase/schema.sql` for fresh installs**

Find the `transactions` table definition (currently lines 73-101, ending with `settled_by_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,` right before `created_at`). Add the new column right after `settled_by_transaction_id`:

```sql
  settled_by_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  category_confirmed_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);
```

(This replaces the existing `settled_by_transaction_id ... ON DELETE SET NULL,` / `created_at ...` / `updated_at ...` / `);` block — the only change is inserting the one new line between `settled_by_transaction_id` and `created_at`.)

- [ ] **Step 3: Update `src/types/database.ts`**

In the `transactions.Row` type (currently lines 63-93), add the new field right after `settled_by_transaction_id: string | null`:

```typescript
          settled_by_transaction_id: string | null
          category_confirmed_at: string | null
          created_at: string
          updated_at: string
```

In the `transactions.Insert` type (currently lines 94-121), add right after `settled_by_transaction_id?: string | null`:

```typescript
          settled_by_transaction_id?: string | null
          category_confirmed_at?: string | null
```

In the `transactions.Update` type (currently lines 122-144), add right after `settled_by_transaction_id?: string | null`:

```typescript
          settled_by_transaction_id?: string | null
          category_confirmed_at?: string | null
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit -p .`
Expected: PASS (this step only adds an optional/nullable field to existing types — no existing code passes an object incompatible with a new optional field)

Live database verification (manual — no automated SQL test exists in this repo, same as prior migrations): run the contents of `supabase/007_category_confirmation.sql` in the Supabase SQL Editor for the project (`urmxysuwailvwwglxuxn`). Confirm in Table Editor that `transactions.category_confirmed_at` exists, and that existing rows all have a non-null value (the backfill ran).

- [ ] **Step 5: Commit**

```bash
git add supabase/007_category_confirmation.sql supabase/schema.sql src/types/database.ts
git commit -m "feat: add category_confirmed_at column for auto-categorization review"
```

---

### Task 2: Mark auto-approved transactions as unconfirmed at insert time

**Files:**
- Modify: `src/services/emailScanner.ts:1023-1041` (AI-parse `parsedTxn` construction)
- Modify: `src/services/emailScanner.ts:1265-1281` (heuristic-parse `parsedTxn` construction)

This task has no new automated test (see "Testing scope note" above). Verification is a careful self-review of both edits plus the manual check in Step 3.

- [ ] **Step 1: Set `category_confirmed_at` on the AI-parse insert path**

Find (currently lines 1023-1041):

```typescript
              parsedTxn = {
                user_id: user.id,
                amount: aiResult.amount,
                type: aiResult.transaction_type || 'debit',
                category: ruleResult.category,
                merchant: resolvedMerchant,
                description: aiResult.description || `${resolvedMerchant} Transaction`,
                date: aiResult.date || mailDate,
                source: 'email',
                approval_status: approval_status as 'approved' | 'pending' | 'rejected',
                reference_id: aiResult.reference_id,
                payment_mode: (aiResult.payment_mode || 'unknown') as any,
                card_issuer: aiResult.card_issuer,
                card_brand: aiResult.card_brand,
                transaction_time: aiResult.transaction_time,
                confidence_score: aiResult.confidence_score,
                event_type: aiResult.transaction_type || 'debit',
                email_message_id: mailMessageId || null,
              }
```

Add one field, right after `approval_status`:

```typescript
              parsedTxn = {
                user_id: user.id,
                amount: aiResult.amount,
                type: aiResult.transaction_type || 'debit',
                category: ruleResult.category,
                merchant: resolvedMerchant,
                description: aiResult.description || `${resolvedMerchant} Transaction`,
                date: aiResult.date || mailDate,
                source: 'email',
                approval_status: approval_status as 'approved' | 'pending' | 'rejected',
                category_confirmed_at: approval_status === 'approved' ? null : undefined,
                reference_id: aiResult.reference_id,
                payment_mode: (aiResult.payment_mode || 'unknown') as any,
                card_issuer: aiResult.card_issuer,
                card_brand: aiResult.card_brand,
                transaction_time: aiResult.transaction_time,
                confidence_score: aiResult.confidence_score,
                event_type: aiResult.transaction_type || 'debit',
                email_message_id: mailMessageId || null,
              }
```

(`undefined` means the key is dropped before the Supabase insert request is sent, so the column's `DEFAULT now()` applies for `'pending'` transactions — same as every other insert path in the app. Only the `'approved'` case explicitly writes `NULL`.)

- [ ] **Step 2: Set `category_confirmed_at` on the heuristic-parse insert path**

Find (currently lines 1265-1281):

```typescript
        parsedTxn = {
          user_id: user.id,
          amount,
          type: txType,
          category: finalCategory,
          merchant,
          description,
          date: mailDate,
          source: 'email',
          approval_status,
          reference_id,
          payment_mode: paymentMode,
          card_issuer: cardIssuer,
          confidence_score: confidence,
          event_type: eventType,
          email_message_id: mailMessageId || null,
        }
```

Add one field, right after `approval_status`:

```typescript
        parsedTxn = {
          user_id: user.id,
          amount,
          type: txType,
          category: finalCategory,
          merchant,
          description,
          date: mailDate,
          source: 'email',
          approval_status,
          category_confirmed_at: approval_status === 'approved' ? null : undefined,
          reference_id,
          payment_mode: paymentMode,
          card_issuer: cardIssuer,
          confidence_score: confidence,
          event_type: eventType,
          email_message_id: mailMessageId || null,
        }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit -p . && npx vitest run`
Expected: PASS (no existing test exercises these exact object literals' new field, but this confirms nothing else broke and the field is a valid property per Task 1's type change)

Self-review: re-read both edited blocks and confirm `category_confirmed_at` is the only new field, correctly conditioned on that block's own `approval_status`/`approval_status` variable (note the AI-parse path casts to a union type — the condition `=== 'approved'` still works correctly against the cast value).

- [ ] **Step 4: Commit**

```bash
git add src/services/emailScanner.ts
git commit -m "feat: leave auto-approved transactions unconfirmed for user review"
```

---

### Task 3: Fetch unconfirmed transactions on page load, not just after a live scan

**Files:**
- Modify: `src/pages/PendingPage.tsx`

This task has no new automated test (no test file exists for this page today — see "Testing scope note"). Verification is self-review plus the manual check in Step 5.

- [ ] **Step 1: Add a function to fetch unconfirmed auto-categorized transactions**

In `src/pages/PendingPage.tsx`, find `fetchLastScanLog` (currently lines 187-198):

```typescript
  const fetchLastScanLog = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabase
        .from('email_scan_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('scanned_at', { ascending: false })
        .limit(1)
      if (data && data.length > 0) setLastScanLog(data[0])
    } catch {}
  }, [user])
```

Add a new function right after it:

```typescript
  const fetchUnconfirmedCategorizations = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .is('category_confirmed_at', null)
        .order('date', { ascending: false })
      if (data && data.length > 0) {
        setAutoCategorizedTxns(data)
        setShowAutoReviewModal(true)
      }
    } catch (e) {
      console.warn('Failed to fetch unconfirmed categorizations:', e)
    }
  }, [user])
```

- [ ] **Step 2: Call it on page load**

Find the mount effect (currently lines 306-310):

```typescript
  useEffect(() => {
    document.title = 'Pending Alerts | Intrack'
    fetchPendingData()
    fetchLastScanLog()
  }, [fetchPendingData, fetchLastScanLog])
```

Change to:

```typescript
  useEffect(() => {
    document.title = 'Pending Alerts | Intrack'
    fetchPendingData()
    fetchLastScanLog()
    fetchUnconfirmedCategorizations()
  }, [fetchPendingData, fetchLastScanLog, fetchUnconfirmedCategorizations])
```

- [ ] **Step 3: Replace the live-scan-only trigger with the same DB-backed fetch**

Find, inside `handleScan` (currently lines 537-550):

```typescript
      const count = res.data?.transactions?.length || 0
      const autoApproved = res.data?.autoApprovedCount || 0
      const pendingCount = count - autoApproved
      const skipped = (res.data as any)?.skippedConfidence || 0

      // Per-transaction detail already lives in the auto-categorization review
      // modal below — this stays a short, glanceable summary, not a repeat dump.
      setScanSuccessMessage({ total: count, autoApproved, pendingReview: pendingCount, skipped })

      const autoList = res.data?.transactions?.filter((t: any) => t.approval_status === 'approved') || []
      if (autoList.length > 0) {
        setAutoCategorizedTxns(autoList)
        setShowAutoReviewModal(true)
      }

      await fetchPendingData()
      await fetchLastScanLog()
```

Change to:

```typescript
      const count = res.data?.transactions?.length || 0
      const autoApproved = res.data?.autoApprovedCount || 0
      const pendingCount = count - autoApproved
      const skipped = (res.data as any)?.skippedConfidence || 0

      // Per-transaction detail already lives in the auto-categorization review
      // modal below — this stays a short, glanceable summary, not a repeat dump.
      setScanSuccessMessage({ total: count, autoApproved, pendingReview: pendingCount, skipped })

      await fetchPendingData()
      await fetchLastScanLog()
      await fetchUnconfirmedCategorizations()
```

(The modal's data now always comes from the same DB-backed source — whether a row was auto-approved by this browser's own manual scan or by the automatic daily cron running with nobody watching, it shows up the same way, the next time this page loads or a scan completes.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 5: Self-review + manual verification**

Self-review: confirm `fetchUnconfirmedCategorizations` is defined before it's referenced in the mount effect's dependency array (function declaration order in the component). Confirm `handleScan`'s edit removed the `autoList` variable entirely (no longer used) without leaving any other reference to it.

Manual verification (after Task 4 lands, since the modal UI changes there too): with a test account, insert or wait for an auto-approved transaction, load Pending Alerts, confirm the review modal opens automatically without needing to click "Scan Bank Alerts" first.

- [ ] **Step 6: Commit**

```bash
git add src/pages/PendingPage.tsx
git commit -m "feat: fetch unconfirmed auto-categorizations on page load, not just after a scan"
```

---

### Task 4: Per-row Confirm button in the auto-categorization modal

**Files:**
- Modify: `src/pages/PendingPage.tsx`

This task has no new automated test (see "Testing scope note"). Verification is self-review plus the manual check in Step 6.

- [ ] **Step 1: Add local state for each row's in-progress category selection**

Find the existing state declarations near the top of the component (currently around lines 172-174):

```typescript
  const [autoCategorizedTxns, setAutoCategorizedTxns] = useState<any[]>([])
  const [showAutoReviewModal, setShowAutoReviewModal] = useState(false)
  const [autoCategoryUpdatingId, setAutoCategoryUpdatingId] = useState<string | null>(null)
```

Add one more line after them:

```typescript
  const [autoCategorySelections, setAutoCategorySelections] = useState<Record<string, string>>({})
```

- [ ] **Step 2: Initialize per-row selections whenever the list of unconfirmed transactions changes**

Find `fetchUnconfirmedCategorizations` (added in Task 3):

```typescript
  const fetchUnconfirmedCategorizations = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .is('category_confirmed_at', null)
        .order('date', { ascending: false })
      if (data && data.length > 0) {
        setAutoCategorizedTxns(data)
        setShowAutoReviewModal(true)
      }
    } catch (e) {
      console.warn('Failed to fetch unconfirmed categorizations:', e)
    }
  }, [user])
```

Change to initialize the selections map alongside the transaction list:

```typescript
  const fetchUnconfirmedCategorizations = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', user.id)
        .is('category_confirmed_at', null)
        .order('date', { ascending: false })
      if (data && data.length > 0) {
        setAutoCategorizedTxns(data)
        setAutoCategorySelections(
          Object.fromEntries(data.map((t) => [t.id, t.category]))
        )
        setShowAutoReviewModal(true)
      }
    } catch (e) {
      console.warn('Failed to fetch unconfirmed categorizations:', e)
    }
  }, [user])
```

- [ ] **Step 3: Replace `handleAutoCategoryChange` with a selection-update function and a separate confirm function**

Find `handleAutoCategoryChange` (currently lines 469-490):

```typescript
  const handleAutoCategoryChange = async (txnId: string, merchant: string, newCategory: string) => {
    setAutoCategoryUpdatingId(txnId)
    try {
      if (merchant) saveMerchantRule(merchant, newCategory, true)

      const { error: updateErr } = await supabase
        .from('transactions')
        .update({ category: newCategory })
        .eq('id', txnId)

      if (updateErr) throw updateErr

      setAutoCategorizedTxns((prev) =>
        prev.map((t) => (t.id === txnId ? { ...t, category: newCategory } : t))
      )
    } catch (err) {
      console.error('Failed to change auto-categorized transaction:', err)
      showToast('Error updating category. Please try again.', 'error')
    } finally {
      setAutoCategoryUpdatingId(null)
    }
  }
```

Replace with two functions — one that just tracks the dropdown's current value locally (no DB write), and one that commits the confirmation:

```typescript
  const handleAutoCategorySelect = (txnId: string, newCategory: string) => {
    setAutoCategorySelections((prev) => ({ ...prev, [txnId]: newCategory }))
  }

  const handleConfirmCategorization = async (txn: TransactionRow) => {
    const selectedCategory = autoCategorySelections[txn.id] || txn.category
    setAutoCategoryUpdatingId(txn.id)
    try {
      if (selectedCategory !== txn.category && txn.merchant) {
        saveMerchantRule(txn.merchant, selectedCategory, true)
        if (user?.id) {
          saveMerchantRuleToDb(user.id, txn.merchant, selectedCategory, true).catch(console.warn)
        }
      }

      const { error: updateErr } = await supabase
        .from('transactions')
        .update({ category: selectedCategory, category_confirmed_at: new Date().toISOString() })
        .eq('id', txn.id)

      if (updateErr) throw updateErr

      setAutoCategorizedTxns((prev) => prev.filter((t) => t.id !== txn.id))
      setAutoCategorySelections((prev) => {
        const next = { ...prev }
        delete next[txn.id]
        return next
      })
    } catch (err) {
      console.error('Failed to confirm categorization:', err)
      showToast('Error confirming category. Please try again.', 'error')
    } finally {
      setAutoCategoryUpdatingId(null)
    }
  }
```

(Note: `saveMerchantRuleToDb` is already imported at the top of this file — `import { saveMerchantRuleToDb } from '@/services/learningEngine'`, confirmed at line 21 — no new import needed.)

- [ ] **Step 4: Update the modal JSX to use the new functions and add a Confirm button per row**

Find the modal's row rendering (currently lines 1113-1155, inside the `Auto-Categorization Review Modal`):

```typescript
            {autoCategorizedTxns.map((txn) => (
              <div
                key={txn.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-surface-2 border border-border-subtle hover:border-zinc-700/50 transition-all gap-3 animate-fade-in"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white">{txn.merchant || 'Unknown Vendor'}</span>
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/30">
                      {formatDate(txn.date)}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 italic max-w-[280px] truncate">
                    {txn.description || 'No description'}
                  </p>
                </div>

                <div className="flex items-center gap-3 shrink-0 justify-between sm:justify-end">
                  <span className="text-sm font-bold text-[var(--status-positive-text)] font-mono pr-1">
                    {formatCurrency(Number(txn.amount))}
                  </span>

                  <div className="flex items-center gap-1.5 relative">
                    <select
                      value={txn.category}
                      disabled={autoCategoryUpdatingId === txn.id}
                      onChange={(e) => handleAutoCategoryChange(txn.id, txn.merchant || '', e.target.value)}
                      className="bg-surface-3 border border-border-subtle text-xs text-zinc-300 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer font-semibold"
                      aria-label={`Change category for ${txn.merchant}`}
                    >
                      {Object.entries(CATEGORIES).map(([key, cat]) => (
                        <option key={key} value={key}>
                          {(cat as any).emoji} {(cat as any).label}
                        </option>
                      ))}
                    </select>
                    {autoCategoryUpdatingId === txn.id && (
                      <div className="absolute right-2 top-2 h-4 w-4 border-2 border-brand-400 border-t-transparent rounded-full animate-spin" />
                    )}
                  </div>
                </div>
              </div>
            ))}
```

Replace with:

```typescript
            {autoCategorizedTxns.map((txn) => (
              <div
                key={txn.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-2xl bg-surface-2 border border-border-subtle hover:border-zinc-700/50 transition-all gap-3 animate-fade-in"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white">{txn.merchant || 'Unknown Vendor'}</span>
                    <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700/30">
                      {formatDate(txn.date)}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-500 italic max-w-[280px] truncate">
                    {txn.description || 'No description'}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 justify-between sm:justify-end">
                  <span className="text-sm font-bold text-[var(--status-positive-text)] font-mono pr-1">
                    {formatCurrency(Number(txn.amount))}
                  </span>

                  <select
                    value={autoCategorySelections[txn.id] || txn.category}
                    disabled={autoCategoryUpdatingId === txn.id}
                    onChange={(e) => handleAutoCategorySelect(txn.id, e.target.value)}
                    className="bg-surface-3 border border-border-subtle text-xs text-zinc-300 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-400 cursor-pointer font-semibold"
                    aria-label={`Category for ${txn.merchant}`}
                  >
                    {Object.entries(CATEGORIES).map(([key, cat]) => (
                      <option key={key} value={key}>
                        {(cat as any).emoji} {(cat as any).label}
                      </option>
                    ))}
                  </select>

                  <Button
                    size="sm"
                    onClick={() => handleConfirmCategorization(txn)}
                    loading={autoCategoryUpdatingId === txn.id}
                    disabled={autoCategoryUpdatingId === txn.id}
                    className="text-xs font-bold shrink-0"
                  >
                    Confirm
                  </Button>
                </div>
              </div>
            ))}
```

- [ ] **Step 5: Update the modal footer label**

Find the modal footer (currently lines 1086-1102):

```typescript
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-zinc-500 font-medium">
              Showing {autoCategorizedTxns.length} auto-approved entries
            </span>
            <Button
              variant="primary"
              onClick={() => {
                setShowAutoReviewModal(false)
                setAutoCategorizedTxns([])
              }}
              className="font-bold text-xs"
            >
              Close & Save Rules
            </Button>
          </div>
        }
```

Change the button label only (its behavior — close without confirming the rest, they'll reappear next visit — is already correct and doesn't need to change):

```typescript
        footer={
          <div className="flex items-center justify-between w-full">
            <span className="text-xs text-zinc-500 font-medium">
              {autoCategorizedTxns.length} awaiting your confirmation
            </span>
            <Button
              variant="primary"
              onClick={() => {
                setShowAutoReviewModal(false)
                setAutoCategorizedTxns([])
              }}
              className="font-bold text-xs"
            >
              Review Later
            </Button>
          </div>
        }
```

- [ ] **Step 6: Type-check and self-review**

Run: `npx tsc --noEmit -p .`
Expected: PASS

Self-review: grep the file for `handleAutoCategoryChange` — it should have zero remaining references (fully replaced by `handleAutoCategorySelect` + `handleConfirmCategorization`). Confirm the `<select>`'s `value` prop reads from `autoCategorySelections[txn.id] || txn.category` (falls back correctly for a row that hasn't been touched yet). Confirm `handleConfirmCategorization` only calls `saveMerchantRule`/`saveMerchantRuleToDb` when the category actually changed (not on every confirm) — this matches the spec ("Correcting a category here teaches the merchant-rule system... If the category dropdown is unchanged, confirming just sets `category_confirmed_at`").

Manual verification: with a test account that has at least one unconfirmed auto-categorized transaction, load Pending Alerts. Confirm:
1. The modal opens automatically with the transaction listed, category dropdown pre-filled with its current category.
2. Clicking "Confirm" without changing the dropdown removes it from the list and it doesn't reappear on page reload.
3. Changing the dropdown then clicking "Confirm" updates the category (visible on the Expenses page afterward) and removes it from the list.
4. Closing the modal via "Review Later" without confirming everything, then reloading the page, brings the modal back with the still-unconfirmed rows.

- [ ] **Step 7: Commit**

```bash
git add src/pages/PendingPage.tsx
git commit -m "feat: per-row confirm for auto-categorized transactions"
```

---

### Task 5: Full verification pass

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: PASS (all existing tests — no new ones were added by this plan, per the Testing scope note)

- [ ] **Step 2: Run the type checker**

Run: `npx tsc --noEmit -p .`
Expected: PASS

- [ ] **Step 3: Run the real production build**

Run: `npm run build`
Expected: exit 0, produces `dist/`. (This is the actual command Vercel runs — always verify against this, not just `tsc --noEmit`, per the lesson learned during the automatic-Gmail-sync feature: the loose root type-check config does not catch everything the real build enforces.)

- [ ] **Step 4: Run the linter**

Run: `npx eslint src/pages/PendingPage.tsx src/services/emailScanner.ts src/types/database.ts`
Expected: PASS, or only pre-existing warnings unrelated to these changes (this codebase has pre-existing lint debt elsewhere — don't chase unrelated errors, only check nothing new was introduced by this plan's edits).

- [ ] **Step 5: Full manual walkthrough**

1. Apply `supabase/007_category_confirmation.sql` in the Supabase SQL Editor if not already done in Task 1.
2. Trigger an auto-categorized transaction (either via manual "Scan Bank Alerts" on Pending Alerts with an email that matches a high-confidence merchant rule, or by waiting for the daily automatic sync cron).
3. Load (or reload) Pending Alerts and confirm the review modal appears without any manual scan click being required.
4. Confirm one transaction as-is, confirm another after changing its category, and verify both leave the modal and don't return on reload.
5. Confirm a transaction auto-categorized before this feature shipped (if any exist in the test account) does **not** appear in the modal — only new ones do, per the backfill in Task 1.
