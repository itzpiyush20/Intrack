# Subscriptions: from a list to something that changes a decision

Decided with the owner 2026-09-05. **No code yet.**

Their objection, and it was fair: *"right now it just shows my subscriptions. There is no
functionality or added functionality that it is providing."* The page detects recurring
merchants, lets you add one by hand, search, filter and hide. All of it tells you what you
already knew.

## What exists

`src/pages/SubscriptionsPage.tsx` with `src/services/subscriptionDetection.ts`. Detection
looks back `SUBSCRIPTION_LOOKBACK_MONTHS = 24`, keys on a normalised merchant, and stores
ignored keys in localStorage per user. There is a `subscription` analytics tag on
categories, and `Subscriptions` is a seeded default category.

Everything below is derived from data the app already holds. None of it needs a new table.

## The four capabilities

### 1. Annual cost beside the monthly one

₹649 reads as small. **₹7,788 a year** does not. One derived figure per subscription and
one total, from the amount and the detected frequency.

Cheapest of the four and the biggest change in how the page reads.

### 2. Price-rise detection

Compare each subscription's latest charge against the one before it across the 24 months
already loaded. Flag increases: *"Spotify went from ₹119 to ₹149 in March."*

This is the one a user genuinely cannot do for themselves — banks never tell you, and
nobody reads twelve statements looking for a ₹30 change. Needs care against false
positives: a partial month, a plan change the user made deliberately, and currency
differences all look like a rise.

### 3. Renewal warnings, before the money moves

The renewal day and the amount are both known. *"Netflix takes ₹649 in 3 days"* while
there is still time to cancel is worth more than recording the charge afterwards.

**This is what forces the split below.** A warning that lives in Settings warns nobody.

### 4. Burn as a share of income

*"Subscriptions are 8% of what you earn."* Income already comes from the `income`
analytics tag and subscription spend from the `subscription` tag, so this is a
calculation and a sentence.

## Placement — split, deliberately

The owner first asked for Settings beside Cards, then chose to split once it was clear the
warnings pull the other way. Three homes, by what each thing is for:

| Where | What | Why |
|---|---|---|
| **Settings**, beside Cards | The list you maintain: add, rename, hide, set renewal day | Configuration you visit on purpose |
| **Home** | Renewal warnings for the next few days | Has to find you; nobody opens Settings to be warned |
| **Insights** | Annual cost, price rises, burn as a share of income | Analysis belongs with the other analysis |

The cost is that one feature appears in three places, and each must not drift from the
others. The alternative — one page carrying all three jobs — is what made it a list nobody
needed.

## Phases

1. **Annual cost.** Pure derivation, no new state. Ships alone.
2. **Burn as a share of income.** Same, and it lands on Insights.
3. **Price-rise detection.** The false-positive work is the real cost here, not the
   comparison.
4. **Renewal warnings on Home.** Needs a card and a decision about how loud it is.
5. **Move the maintenance list into Settings** and retire the standalone page, once the
   other three have somewhere to live.

Phase 5 last on purpose: removing the page before its contents have homes would lose
features.

## Open

- **Manual subscriptions vs detected ones.** Detected ones are derived from transactions;
  manual ones are stored. Price-rise detection can only work on the detected kind. Decide
  what a manual subscription shows instead of a comparison.
- **How loud the renewal warning is.** A card, a badge, or a notification the app cannot
  currently send.
- **Whether hiding a subscription should also hide it from the burn calculation.** Hidden
  today means "stop showing me this", which is not the same as "this is not a
  subscription".
