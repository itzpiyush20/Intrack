# First-run product tour

Requested by the owner 2026-09-05. **No code yet.** Design and decisions only; nothing is
built until the open questions at the end are answered.

The owner's words:

> "whenever a user signs up on the app for the first time, I want a complete tour of every
> functionality of that app so that the user gets to know what the app is capable of doing.
> This should be an optional feature, and the user should be able to skip that tour
> altogether as well."

## What already exists

Not a greenfield. `DashboardPage.tsx:707-762` already renders **"Get set up in 3 steps"** —
add a transaction, set a budget, visit Insights — dismissed into
`intrack_checklist_dismissed_<uid>`, and gated on `isCurrentMonth` so an old month cannot
resurrect it. Its subtitle already calls itself "A quick tour of what makes Intrack useful."

**The checklist stays.** It is a *do* list; the tour is a *tell* list. Building a second
checklist would give a new user two nags on the same screen. What must be settled is which
of them appears first — see Collisions.

## Decision 1 — where "has seen the tour" lives

**A column on `profiles`, mirrored into `localStorage` as a suppressor. Migration `043`.**

```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tour_seen_at TIMESTAMPTZ;
```

One nullable timestamp. NULL means never shown; any value means shown, whether the user
finished it or skipped it. Nothing distinguishes the two, because nothing needs to — both
mean "do not open this again by itself".

Why not localStorage alone: the app is packaged with Capacitor and used mostly on a phone.
A user who signs up on the phone and later opens the web app gets the whole tour again, and
`signOut` (`AuthContext.tsx:462`) already sweeps keys on sign-out. A first-run experience
that fires on the second device is not a first-run experience.

Why the localStorage mirror is still required — this is the trap, not an optimisation:

- `refreshProfile` has **three** fallback branches (`AuthContext.tsx:220`, `:245`, `:361`,
  `:395`) that rebuild `profile` from a fixed literal of six fields. In every one of them
  `profile.tour_seen_at` is `undefined`, which is indistinguishable from NULL. A blocked
  request, an RLS change or a slow network would therefore replay the tour at users who
  finished it a month ago.
- So the trigger condition is **both**: `entitlement.state === 'confirmed'` (meaning the
  `profiles` row was genuinely read, not reconstructed from cache) **and**
  `profile.tour_seen_at == null` **and** no `intrack_tour_seen_<uid>` key locally.
- Write both on skip and on finish. If the `UPDATE` fails, the local key still suppresses
  it on that device — the failure mode is "tour reappears on another device", never
  "tour loops forever".

This is the same shape as the existing `intrack_sub_status_<uid>` caching, deliberately.

**The column must NOT be added to `protect_server_only_profile_columns`**
(`schema.sql:295`). The client writes it directly; adding it there would make every skip
raise `Cannot modify server-managed subscription/admin fields directly`. It is a user
preference, not an entitlement.

Per `CLAUDE.md`, `schema.sql` gets the column **inside** the `CREATE TABLE` *and* an
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the safety-net block, and migration `043`
ships the same `ALTER`. The migration runs and is verified in production **before** any
code that reads the column merges. Two columns have already broken every `UPDATE` on
`profiles` by skipping that step.

## Decision 2 — a self-contained sequence of screens, not anchored tooltips

**A full-screen modal deck. No coach marks, no spotlight cut-outs, no arrows pointing at
live DOM nodes.**

Anchored tooltips are the wrong tool for *this* app specifically, and each reason below is
a real property of this codebase, not a general preference:

- **The anchors are user-configurable.** Dashboard cards are toggled through
  `intrack_dashboard_widgets` (`DashboardPage.tsx:184`). A tour pointing at the Spending
  Breakdown breaks for anyone who switched it off.
- **The first-run Dashboard is mostly empty.** On day one there are no transactions, no
  budgets, no subscriptions. The interesting elements a tour would point at are empty
  states or absent entirely.
- **Half the targets live on other routes,** which are `React.lazy` and wrapped in a 300ms
  entry animation (`App.tsx`, `AnimatedRoutes`). A tour that navigates has to wait on a
  chunk fetch and a mount before it can measure an element, and gets a wrong rectangle if
  it does not. The existing hash-scroll code already polls for 1.2s to work around exactly
  this.
- **It breaks silently.** A renamed class or a moved card leaves the bubble floating over
  nothing. There is no test that catches it and no error in the console. The pages here are
  edited often.
- **375px has nowhere to put a bubble.** A dense card plus a tooltip plus an arrow, above a
  fixed bottom nav, is not a layout.

A modal deck is one component, one z-index, and zero coupling to any other file's DOM. It
cannot rot when a page moves. The cost is honesty: it *describes* the app rather than
standing inside it — which is why the 3-step checklist, which does stand inside it, is kept.

**Illustration policy: icons and short text only.** No screenshots. A screenshot deck is a
second copy of the UI that goes stale without anyone noticing, which is the same failure
mode as anchored tooltips with a slower fuse. Reuse the `lucide-react` icons the pages
themselves use.

## Decision 3 — the steps, with copy

Ten screens. Every claim below is checked against the code; the constraints in `CLAUDE.md`
and the marketing-truth rule apply to tour copy exactly as they apply to `PricingPage`.

**Progress dots at the top. "Skip tour" visible on every screen, including the first.**

---

**1 · Welcome**
> ### Welcome to Intrack
> Two minutes, ten screens, and you will know everything this app does.
> You can skip it now or replay it any time from Settings.

**2 · Log what you spend**  → Expenses
> ### Every transaction, income and expense
> Add anything in a few seconds — amount, merchant, category, date, tags, a note. Search
> and filter by type or category, and see income, expenses and the net for any date range.
> Lent money to someone? Mark it returnable with who owes it and when you expect it back.

**3 · Let your inbox do the typing**  → Pending Alerts
> ### Read your bank alerts instead of retyping them
> Connect Gmail once, then press **Scan Bank Alerts** whenever you want. Intrack reads your
> bank and payment alert emails and pulls out the merchant, the amount and the date.
> **You start every scan.** Intrack never reads your inbox on its own.

**4 · Read-only, and nothing is kept**
> ### What we can and cannot see
> The connection to Gmail is **read-only** — Intrack can read messages and nothing else. No
> copy of your mailbox is stored here. To tell a real transaction from a newsletter, an
> alert's subject and the start of its body pass through our server to Google's Gemini for
> a moment and are discarded. What is saved is the transaction itself.
> We never see your Gmail password, your net-banking login, PINs or OTPs.

**5 · You approve everything**  → Pending Alerts
> ### Nothing is added behind your back
> Every scanned transaction lands in **Pending** and waits for you. Approve it, edit it
> first, or reject it. Nothing is ever written into your expenses automatically — not even
> a merchant Intrack has seen a hundred times before.

**6 · Set limits before you break them**  → Budgets
> ### Budget limits
> Set a monthly limit per category and watch it fill up. Intrack warns you as you approach
> a limit rather than telling you afterwards, and shows the whole month's limits together
> so you can see which one is the problem.

**7 · Understand the pattern**  → Insights
> ### Insights
> Trends over weeks and months, a forecast of where this month is heading, unusual spends
> flagged automatically, your biggest merchants, category-by-category movement, and how
> your spending splits across needs, wants and savings.

**8 · Recurring money**  → Subscriptions
> ### Subscriptions
> Streaming, broadband and other recurring plans are detected from your transactions and
> laid out on a renewal calendar, so a renewal is never a surprise. Add one by hand if
> Intrack has not seen it yet.

**9 · Make it yours**  → Settings
> ### Settings
> Your own categories. Your credit cards. The Gmail connection and the merchant rules
> Intrack has learned, all editable. And your data is yours: an encrypted backup you can
> download and restore, plus a plain export that opens anywhere.

**10 · Your trial**  → close / Pricing
> ### You are on the 7-day trial
> Everything you have just seen is switched on, and no card was needed. There is no free
> version of Intrack — when the trial ends, access stops until you subscribe, and nothing
> you logged is deleted, so paying puts it all back exactly as you left it.
> ₹31 for 30 days, or ₹365 for a year.
>
> **[Start using Intrack]**   **[See plans]**

---

**Copy claims and where each is grounded:**

| Claim | Source |
|---|---|
| Every scan is user-initiated; nothing scans on its own | `plans/remove-auto-sync.md`, `constants/index.ts:104` |
| Nothing auto-approves; everything lands in Pending | `CLAUDE.md` invariant 1 |
| Gmail connection is read-only | `PendingPage.tsx:1374`, `constants/index.ts:109` |
| Subject + body prefix reach Gemini and are discarded | `PendingPage.tsx:1374` |
| No free tier; trial then pay | `constants/index.ts:129`, `PricingPage.tsx:369-385` |
| 7 days, no card | `schema.sql:37`, `PricingPage.tsx:378-385` |
| ₹31 / 30 days, ₹365 / year | `PricingPage.tsx:498, 558` |
| Returnables — who owes, expected return date | `ExpenseForm.tsx:267-274` |
| Settings tabs: Categories, Cards, Scanning, Data | `SettingsPage.tsx:56-61` |
| Encrypted backup + plain export | `SettingsPage.tsx` Data tab |
| Subscriptions detected + renewal calendar | `SubscriptionsPage.tsx:209-213` |

**Deliberately not claimed:**

- **No scan-count numbers.** The allowance (two a day on trial and paid, with a four-hour
  gap) is real but is quota detail, and quoting it in a welcome deck creates a second place
  that has to be updated whenever the limit moves. Pending and Pricing already state it.
- **No "see your available balance".** `plans/accounts-and-balances.md` Phase 2 shipped —
  the Settings **Cards** tab exists — but the Dashboard balances card (Phase 6) has not.
  Screen 9 says "your credit cards", which is true today. It gets a sentence when Phase 6
  lands, not before.
- **No notifications claim.** Recorded as roadmap, not shipped.
- **Nothing about multiple currencies.** Intrack is INR and does not convert.

## Decision 4 — skipping, and getting it back

- **"Skip tour" on every screen**, equal weight to "Next" — not a grey afterthought. The
  owner asked for skippable; a skip control that hides is not one.
- **Skip stamps `tour_seen_at` exactly as finishing does.** A skip that reappears next week
  is a skip that was ignored. No "are you sure?", no "remind me later".
- Closing it any other way — Escape, backdrop, the X — counts as a skip and stamps too.
- **Replay lives on the Settings page header**, beside "Configuration Settings": a
  *Replay product tour* button. One implementation, reachable at every breakpoint through
  the existing Settings link.
  - The tempting alternative — the profile dropdown (`AppLayout.tsx:648`) — needs the same
    entry added **twice**, because the mobile hamburger menu (`:729`) is a separate copy of
    that list. Two copies that must not drift, for one button.
  - Replaying **does not clear** `tour_seen_at`. It just plays. Clearing it would re-arm
    the automatic trigger on the user's other devices.

## Decision 5 — the phone

The app is used mostly on mobile and the layout is already built for it. The tour must be
too, at 375px:

- **A full-screen sheet, not a centred dialog.** Content scrolls inside its own container;
  the page body is scroll-locked behind it.
- **Controls pinned to the bottom**, above `env(safe-area-inset-bottom)` — the pattern the
  bottom nav already uses (`AppLayout.tsx:1079`).
- **z-index above 50.** The mobile bottom nav is `z-50` and the desktop dropdowns are
  `z-40`/`z-50`; a tour at 50 or below is overlapped by the nav it is describing.
- **Tap targets at 44px minimum**, matching the `h-11` inputs and `h-10 w-10` icon buttons
  used across the pages.
- **Transform-only animation, never opacity,** for anything that gates visibility. `App.tsx`
  documents the reason at length: `requestAnimationFrame` is paused in a backgrounded or
  compositor-stalled tab, and a stalled opacity animation leaves a blank screen. A stalled
  transform leaves the panel a few pixels off.
- `MotionConfig reducedMotion="user"` is already global, so reduced-motion is handled if
  framer-motion is used rather than hand-rolled CSS.
- **Ten short screens beat three long ones on a phone.** No screen should need scrolling at
  375×667 — if the copy above does not fit, cut the copy, not the screen count.
- Swipe left/right to move between screens, with the buttons still present. Focus trapped
  in the sheet; `aria-modal`, and the heading announced on each screen change.

## Collisions — what else fights for the first screen

A brand-new user on `/dashboard` can be shown, all at once: the cookie banner
(`CookieConsent`), the PWA install prompt (`AppLayout.tsx:365`), the Gmail-not-connected
banner, the "Get set up in 3 steps" checklist, and now the tour. That is a wall.

Proposed order, to be confirmed: **cookie consent → tour → checklist**, with the PWA
prompt and the connect banner suppressed while the tour is open. The tour must not mount
until the app shell has actually painted — it is the only one of these that covers the
whole screen.

It must also **not** open on `/payment-success`, `/admin`, or any marketing route, and not
while `entitlement.state` is `pending` or `unconfirmed`.

## Open questions for the owner

1. **Existing users — do they get the tour?** A new NULL column reads as "never seen it"
   for every account that already exists, so on the day this ships every current user is
   shown a welcome deck. The alternative is to backfill `tour_seen_at = now()` in migration
   043 so only accounts created after the ship date ever see it. Which?
2. **Ten screens, or fewer?** "Every functionality" is ten. A shorter deck gets finished
   more often. If it should be shorter, which screens go — Insights, Subscriptions and
   Settings are the candidates.
3. **Does finishing the tour dismiss the "Get set up in 3 steps" checklist,** or should the
   checklist still appear afterwards as the do-list? (Recommendation: keep it — the tour
   tells, the checklist does.)
4. **Where should Replay live** — the Settings header (one button, recommended), or the
   profile menu, which means maintaining the same entry in two places?
5. **Should the tour offer anything at the end besides "Start"** — connect Gmail straight
   away, or go to Pricing? Or does it just close?
6. **What happens for a user whose trial has expired** and who signs in for the first time
   on a new device: tour first, or paywall first?
7. **Does the owner want to write the final copy,** or is the wording above approved as
   drafted? Everything in it is checked against the code, but it is marketing text and the
   owner has ruled on tone before.
8. **Should the tour mention the scan allowance** (two a day, four hours apart), or stay
   silent as drafted so there is only one place stating the limit?
9. **Cards and balances:** screen 9 mentions cards only in passing. When
   `plans/accounts-and-balances.md` Phase 6 lands, should the tour gain a balances screen —
   and should it then replay for users who already saw the nine-screen version?

## Build order, once the questions are answered

1. **Migration `043` first**, applied and verified in production, grants checked, before
   any code that reads `tour_seen_at` merges. Non-negotiable per `CLAUDE.md`.
2. `schema.sql`: the column in `CREATE TABLE` *and* in the safety-net `ALTER` block.
   **Not** in `protect_server_only_profile_columns`.
3. The tour component itself — self-contained, no imports from any page.
4. The trigger, in `AppLayout` or `DashboardPage`: `confirmed` entitlement + NULL column +
   no local key.
5. The Settings replay entry.
6. Skip/finish write path, DB write plus local mirror, failure-tolerant.
7. Verify per `CLAUDE.md`: `npx tsc -b`, `npm test -- --run`, `npm run build`, lint counts
   compared against the pre-change baseline on every file touched, and a real browser pass
   at 375px covering skip on screen 1, skip mid-way, finish, replay, and a reload proving
   it does not come back.
