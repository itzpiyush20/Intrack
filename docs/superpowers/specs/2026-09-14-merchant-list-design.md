# Per-user merchant list — design

Owner-approved 2026-09-14. Supersedes the merchant-suggestion part of
`2026-08-09-editable-merchant-field-design.md` (the fixed `KNOWN_MERCHANTS`
brand list as suggestions).

## Problem

`transactions.merchant` is free text. Suggestions in the add/edit forms come
from a fixed built-in brand list (`KNOWN_MERCHANTS`), the same for every user.
"swiggy", "SWIGGY BLR" and "Swiggy order" are three different merchants, so
Insights splits one merchant across rows and months. There is no way to keep,
rename, merge or manage a merchant, and the Pending review screen cannot edit
the merchant at all.

## Owner decisions

1. Each user has their own saved merchant list that persists across all months.
2. Add-merchant asks for **name** (required) and **usual category** (optional).
3. Friends are **not** merchants. Lending keeps its free-text `counterparty`.
4. A credit the user links to a merchant is a **refund**: it lowers that
   merchant's spend, its category's spend and Total Expenses, and is **not
   income**. Credits not linked to a merchant stay income (ruling of
   2026-08-27, amended for linked credits only).
5. Existing merchant text is cleaned up by **proposed groupings the user
   confirms**; nothing is merged silently.
6. The email scanner engine is **not changed**. Pending pre-selects a matching
   saved merchant which the user can change.
7. The uncommitted `getDistinctMerchants` work found in the tree on 2026-09-14
   is discarded and folded into this project (back it up to the scratchpad
   first; `git stash` is unsafe in this repo).

## Worked example

Spend ₹2,000 at Amazon (Shopping), later receive ₹500 and link it to Amazon.

| Shown | Amount |
|---|---|
| Amazon net spend | ₹1,500 |
| Shopping spend | ₹1,500 |
| Total expenses | ₹1,500 |
| Income | ₹0 |

A salary credit with no merchant still counts as income.

## Data model

Migration `supabase/048_merchants.sql`, mirrored in `schema.sql` **and** its
safety-net block (both tables `CREATE TABLE IF NOT EXISTS`, the column
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

- `merchants`
  - `id uuid pk`, `user_id uuid not null → profiles(id) on delete cascade`
  - `name text not null`, `default_category text null`
  - `created_at`, `updated_at`
  - unique `(user_id, name_key)` where `name_key` = lower-cased, whitespace-collapsed name
    (generated column)
- `merchant_aliases`
  - `id`, `user_id`, `merchant_id → merchants(id) on delete cascade`
  - `alias_key text not null`, unique `(user_id, alias_key)`
- `transactions.merchant_id uuid null → merchants(id) on delete set null`,
  indexed `(user_id, merchant_id)`.

RLS on both tables: owner-only `FOR ALL` using `(select auth.uid()) = user_id`
(the initplan form from migration 047). A `merchant_id` on a transaction must
belong to the same user — enforced by a trigger or composite check, verified
against the live policies before code merges.

`transactions.merchant` text stays. When a merchant is picked, the text is set
to the merchant's name at save time. A rename (Settings, plan 3) rewrites the
text on every linked row in the same server-side function, so all existing
display code keeps reading `transactions.merchant` unchanged.

## Linking rules

- A transaction is linked only by an explicit user action: picking a merchant,
  adding one, approving a Pending pre-selection, or confirming a cleanup group.
- Never linked automatically at save, scan or import time.
- Picking a merchant whose typed spelling differs records that spelling as an
  alias.

## Totals — one classifier

Every file that branches on `type === 'credit' / 'debit'` to build a money
total (a 2026-09-14 grep finds the pattern in 22 non-test files; not all are
totals) (headline: `getSummary` in `transactions.ts`; also InsightsPage,
DashboardPage, CashFlowRunway, balances, analytics helpers) must route through
one pure helper, e.g. `classifyForTotals(t)` in a new `src/utils/moneyFlow.ts`:

| Row | Class |
|---|---|
| debit, not credit-card-bill | `expense` |
| debit, credit-card-bill category | `excluded` (unchanged rule) |
| credit, `merchant_id` null | `income` |
| credit, `merchant_id` set | `refund` → subtracts from expenses |

Rules for `refund`:
- Counted in the month of **its own date**, not the purchase's month.
- Subtracts from the category **on the refund row** (the form pre-fills the
  merchant's usual category, so it normally matches the purchase).
- Totals are not clamped. If refunds exceed spend in a period, the figure goes
  below zero and is labelled "refunds exceed spend" rather than hidden.
- Foreign-currency rows follow the same classes inside `other_currency_totals`.

Existing per-feature exclusions (credit-card bills, lending/`is_returnable`,
debt flows) keep precedence over `refund`: a linked credit already classified
by those rules is not re-classified.

Sweep requirement: after the change, no money total may read `type` directly.
A grep for `type === 'credit'` outside `moneyFlow.ts` and display-only code
must be reviewed file by file.

## Merchant balance

Net spend per merchant = Σ debits − Σ credits linked to it, all time and per
selected range. Computed on read, never stored. Negative shows as "₹X in your
favour".

## UI

One shared `MerchantPicker` component replaces the `<datalist>` inputs:

- Type to filter the user's merchants (name + aliases): names starting with
  the typed text first, then other matches, each group A–Z (owner's choice
  2026-09-15 over most-used ordering). Arrow keys and Enter pick; Enter never
  submits the host form while a suggestion is highlighted.
- Last row: **+ Add "<typed text>" as a merchant** → small inline panel under
  the box with name (prefilled) and optional usual category → saved and
  selected.
- Picking a merchant with a usual category pre-fills category if the user has
  not chosen one yet; never overwrites a category already chosen.
- Clearing the picker unlinks (`merchant_id` null) and keeps the typed text.

Used in:
1. `NewTransactionModal.tsx` (Dashboard add)
2. `ExpenseForm.tsx` (Expenses add/edit, Insights drill-down edit)
3. `PendingPage.tsx` review/edit (new — today only category and description)
4. `RecordPlannedPaymentModal.tsx` (Subscriptions)

**Settings → Merchants tab** (next to `CategoryManager`):
- List with net spend; rename, change usual category, merge into another,
  delete (transactions kept, unlinked).
- Merge moves transactions and aliases to the kept merchant, then deletes the
  other, in one server-side function so a half-merge cannot happen.

**One-time cleanup** on the Merchants tab while unlinked approved transactions
with merchant text exist:
- Groups proposed by `normalizeMerchant` canonical name, else the
  lower-cased/collapsed text.
- Per group: **Yes** (create/link, spellings become aliases), **Rename**,
  **Not the same** (dismissed, not proposed again).
- Paged like `fetchAllTransactions`; never a single unbounded select.

**Pending pre-select:** when a pending row's merchant text matches a saved
merchant's name or alias key, the picker starts with that merchant selected.
Approval saves the link. No change to `emailScanner.ts`, `aiService.ts`,
`emailScanGates.ts` or `learningEngine.ts`; nothing auto-approves.

## Removed

- `KNOWN_MERCHANTS` export as a suggestion source (the normalizer's internal
  map stays — `transactionIdentity`, `paymentMerge`, `learningEngine`,
  `statementImporter` use it).
- The uncommitted `getDistinctMerchants` / `rankMerchants` work.

## Error handling

- Picker load failure: picker still accepts free text and saves unlinked;
  a quiet inline note, never a blocked save.
- Add-merchant duplicate (`23505` on `name_key`): select the existing merchant
  instead of erroring.
- Merge/delete failures leave data untouched (single transaction server-side).

## Testing

- `moneyFlow` classifier: every class, including linked credit in a
  credit-card-bill category and lending rows. Prove each test fails against
  the old `type`-only logic.
- `getSummary`: the worked example above; refund in a later month; refunds
  exceeding spend.
- Alias key normalisation and matching.
- Picker: add-merchant flow, category pre-fill never overwrites.
- Merge function: transactions and aliases move; RLS blocks cross-user ids.
- Manual browser check of all four picker screens, Settings tab and cleanup.

## Identity files

Same commits must update `ARCHITECTURE.md` (tables, `moneyFlow`, picker,
Settings tab), `CLAUDE.md` (next migration `049_`), and any user-facing copy
that describes income as "all credits".
