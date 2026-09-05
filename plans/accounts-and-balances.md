# Balances: one money figure, credit cards individually, and loans

Designed with the owner 2026-09-04, settled 2026-09-05. **No code yet.** Executed phase by
phase, each phase confirmed before it starts.

The goal, in the owner's words: know the running total of money available, and see on any
day how much is outstanding on each credit card, so it can be matched against that card's
statement.

## Shape

The first draft gave every bank account its own row. The owner removed that:

> "I don't want all those accounts to be separately identified in the app. I will just
> mention... their cumulative bank balance."

So there is **one money figure for the whole user** — labelled *cash in hand and bank
balances*, because it includes both — and **credit cards are individual**, since matching
one card against its statement was the point.

## How money moves

| Event | Available money | Card outstanding |
|---|---|---|
| UPI / debit-card / cash spend | falls | — |
| Spend on a credit card | unchanged | rises |
| Refund to a credit card | unchanged | falls |
| Income | rises | — |
| **Loan, source = credit card** | **rises** | **rises** |
| **Loan, source = bank / family / other** | **rises** | — |
| Credit-card bill payment | falls | falls |
| **Repayment of a non-card loan** | falls | — |

A credit-card spend must not reduce available money — it has not left the bank yet. Paying
the bill is the moment it does, and that one transaction moves both columns.

**Untagged debits are assumed to come from available money.** A card spend you forget to
assign will understate it, which is what the drift correction exists for.

## Loans — how borrowing is recorded

Reached after several wrong turns, all of which are worth not repeating.

A credit-card cash advance is money arriving that is **not income**, against a liability
that is **not an expense**. Treating it as an ordinary card expense leaves the available
figure permanently short by the amount withdrawn — the app sees the repayment but never
saw the money arrive, and the gap accumulates rather than clearing. Worked through with the
owner in full before this design was chosen.

**One default category, `Loan`.** When it is selected, the entry asks a second question —
**Source** — from a fixed list the user cannot extend:

| Source | Effect |
|---|---|
| **Credit card** | user then picks which card; that card's outstanding rises, available money rises |
| **Bank** | available money rises |
| **Family or friend** | available money rises |
| **Other** | available money rises; user types who |

Direction comes from the entry itself, so the one category covers both borrowing and
repaying. **Repayment asks for the source too**, so what is still owed to each lender is
just borrowed minus repaid — meaning per-lender tracking can be added later with no schema
change. That is why no liability module is being built now.

`Loan` carries **no** `needs`/`wants`/`savings`/`income` tag, so borrowing never inflates
income, the savings rate or the 50/30/20 split.

**This also fixes a bug Phase 4 would otherwise have hit.** A credit on a card is normally
a refund and lowers the outstanding; a cash advance is also money in but raises it. The
source field is what tells them apart. Without it the code would have had to guess.

**Borrowing only.** Money the user *lends out* stays with the existing returnables
feature — `transactions.is_returnable` and `counterparty`, surfaced by the Receivables
card. Loan means money coming in that is not income.

Credit-card bill payments are unchanged — already the repayment case for cards, carrying
the existing `credit_card_bill` tag.

**Nothing historical moves.** Existing `Credit Card Withdrawal` rows stay exactly as they
are until the owner chooses to recategorise them.

## Data

```
cards                     (replaces the unused `cards` table, which is dropped)
  id, user_id
  name        the user's own label, e.g. "Axis Flipkart"
  issuer, last4, brand
  is_archived manual only, never automatic
  sort_order, created_at, updated_at

balance_periods           one row per user per month
  id, user_id, month
  opening_amount     cash in hand and bank balances, combined
  is_user_set

card_periods              one row per card per month
  id, user_id, card_id, month
  opening_outstanding
  is_user_set
```

On `transactions`:

- **`card_id`** — the card this sits on. Null means it came from available money.
- **`settles_card_id`** — only on a bill payment: that row lowers available money by its
  amount and lowers *that card's* outstanding. Without a second column a bill payment can
  only express one side of itself.
- **`loan_source`** — `credit_card` | `bank` | `family_friend` | `other`, null unless the
  category is Loan.
- **`loan_source_note`** — free text, only for `other`.

## Settled rules

- **Opening figures are stored per month**, for the money figure and for each card. Each
  month opens at the previous month's close.
- **The user is never asked for a figure as of a past date** (owner, 2026-09-05). Nobody
  can look up what a card owed on the 1st; what they can read off their banking app is
  what it owes *today*. So the UI asks for today's outstanding and the service converts
  it — `opening = today − everything the card did since the 1st` — leaving the stored
  column and all downstream maths anchored to the month opening as above. Until Phase 3
  lets a transaction name a card that delta is always zero. `sumCardMovements` in
  `src/services/cards.ts` owns the signs and is unit-tested.
- **A card requires a name, its last four digits, and today's outstanding.** Bank and
  network are optional; the bank becomes required only when a second card shares the same
  last four, since that pair is the only thing that can tell them apart. Settled with the
  owner 2026-09-05 after considering making the *name* the fixed identity instead: the
  last four win because `issuer + last4` is what the email scanner already records on
  every alert, so Phase 3's bulk-tag pass can only auto-match a card that has them. A card
  with no digits would need every transaction tagged by hand forever.
- **The name is always editable; `last4` and `issuer` freeze at the card's first
  transaction.** Nothing traces by name — rows point at `card_id`, a uuid no user sees —
  so renaming a card to something clearer is free and never touches history. The two match
  fields stay correctable while the card has no history, which is when a typo is noticed,
  and stop moving once history exists. Enforced in `updateCard`, not only in the form, so
  a future caller cannot break the promise; `movesCardIdentity` is unit-tested and treats
  *filling in a blank* as allowed, so a card added before the digits were required can
  still be completed. The UI warns twice — inline while typing, and in a confirmation
  dialog naming the digits before the card is created.
- **Digits may be reused** after a card is deleted. Deletion is already refused whenever
  anything points at the card, so no history can be confused by it.
- **Always editable, never retrospective.** Only the *current* month's opening can be
  edited; past months are read-only. An edit takes effect from that month forward, so a
  report read in September still matches in December. The owner's words: "there would be a
  prospective change, not a retrospective change."
- **Drift correction, both directions and both surfaces.** Typed figure disagrees with
  computed, one tap records the difference — money missing as spending, money extra as
  income. Categories created on first use, so nobody gets categories they never need.
- **The card is chosen by the user** from a dropdown of their own defined cards. No free
  text, no auto-assignment, even though the scanner records issuer and brand.
- **Archiving is manual only, never automatic.** An archived card keeps its history; a card
  with nothing pointing at it can be deleted outright.
- **INR only.** A USD transaction is left out and counted in the visible unaccounted line
  rather than converted at a rate the app would have to invent.
- **Optional throughout.** Enter nothing and none of this appears.
- **Placement:** a Dashboard card to view; Settings to define cards and type opening
  figures.

## Phases

Migration ships and is verified in production **before** any code that calls it, per the
deploy-order rule in CLAUDE.md.

**Phase 1 — Schema (`042`).** Drop `public.cards`, recreate it in the shape above, add
`balance_periods` and `card_periods`, add the four `transactions` columns, seed the `Loan`
category for existing and new users, all with RLS matching the existing per-user pattern.
Mirror everything into `schema.sql` including `ADD COLUMN IF NOT EXISTS` safety-net
entries.

The scanner needs **no change**: `emailScanner.ts:1693` selects `last4, issuer` and both
columns exist in the new table, so its lookup keeps working. It returns an empty map today
and will keep doing so until Phase 2 gives the user a way to create a card.

**Phase 2 — Cards in Settings.** Add, rename, archive, delete-if-unused, opening
outstanding per card.

**Phase 3 — Tagging.** Card dropdown on manual entry, Pending rows and transaction edit.
Loan source field appearing when the Loan category is chosen. `settles_card_id` on bill
payments. A bulk pass over existing history.

**Phase 4 — The maths.** Available money and per-card outstanding, opening figures carried
forward, loan sources feeding both columns.

**Phase 5 — Drift correction.** Both directions, both surfaces.

**Phase 6 — Dashboard card.** Balances, per-card outstanding, and an unaccounted line
naming what the figures could not include.

## Open

- **What the two drift categories are called.** Deferred by the owner. Nothing in the
  migration depends on it, since they are created on first use — settle it at Phase 5.

## Watch for

- `isCreditCardBill` has **three** call sites — DashboardPage, ExpensesPage and
  `transactions.ts`. Any new exclusion must find all three.
- Charges the app never sees — cash-advance fees, interest, annual and late fees — are what
  make a card outstanding drift from the statement. No design avoids that; the per-card
  drift correction is the answer.
- The live outstanding includes spends made after the statement closed, so it will not
  equal the statement total. The owner ruled out statement cycles knowing this.
