# Responsive layout audit — Intrack

Date: 2026-09-05. Read-only audit. **No application code was changed.**

## Method, and how much to trust it

Every app page in this repo is behind a login, so **nothing here was rendered.**
This audit is a reading of `className` strings, the Tailwind v4 theme in
`src/index.css`, and `index.html`. That is materially weaker evidence than
looking at the page:

- A className reading cannot see actual text length, so "this will overflow" is
  a prediction from character counts and font sizes, not a measurement.
- It cannot see computed styles from `src/index.css` utility classes
  (`sb-btn-primary`, `sb-caption`, `sb-card`, …) unless that CSS was read; where
  a finding depends on one of those, it is called out.
- It cannot see runtime conditionals — a grid that is `grid-cols-4` may in
  practice only ever hold two children.

**Every finding below should be confirmed in a real browser at the stated width
before anyone writes a fix.** Chrome DevTools device toolbar at 375 / 768 / 1280,
logged in, is about twenty minutes of work and would upgrade all of this from
"likely" to "certain".

Widths checked (by reading breakpoints): **375px** (Android phone, the primary
target), **768px** (tablet, exactly Tailwind's `md` boundary), **1280px** (laptop).

Severity scale:
- **S1 — breaks the screen.** Content unreachable, unreadable, or clipped.
- **S2 — significantly degrades.** Usable but cramped, mis-sized touch targets,
  horizontal scroll on a section.
- **S3 — cosmetic.** Looks off; nothing is lost.

---
## The five worst problems

1. **S1 — The fixed mobile bottom nav covers the bottom of every page.**
   `src/layouts/AppLayout.tsx:1081` renders `fixed bottom-0 … h-16` (64px + safe
   area). `src/layouts/AppLayout.tsx:891` is the only `<main>`, and it is
   `px-4 py-6 sm:px-6 lg:px-8` — 24px of bottom padding and nothing else.
   Nothing in `src/index.css` (checked: `body` at line 272, safe-area helpers at
   504-506) adds a bottom offset either. Dashboard, Pending, Expenses, Insights,
   Budgets and Settings are all long scrolling pages, so on every one of them the
   last ~40-64px of content sits behind the nav on a phone.
   *Fix:* add `pb-24 md:pb-6` (or `pb-[calc(5rem+env(safe-area-inset-bottom))]`)
   to the `<main>` when the bottom nav is rendered. **Size: 1 line.**

2. **S1/S2 — `CategoryFormModal` swatch grids are wider than a 375px modal.**
   `src/components/settings/CategoryFormModal.tsx:174` is `grid-cols-10 gap-1.5`
   with `h-9 w-9` (36px) buttons; line 197 is `grid-cols-12 gap-1.5` with
   `h-7 w-7` (28px) buttons. Inside `Modal` (`src/components/ui/Modal.tsx:40`
   outer `p-4`, line 88 body `px-6`) the content box at 375px is ~295px. The
   grids need 10x36 + 9x6 = **414px** and 12x28 + 11x6 = **402px**. The fixed
   `w-9`/`w-7` overrides the `1fr` track, so the rows overflow by ~110px.
   Because the body is `overflow-y-auto`, overflow-x computes to `auto`, so it
   is probably side-scrollable inside the modal rather than fully clipped — but
   that is an awkward hidden scroll on the two pickers users touch most, and the
   28px colour swatches are far under 44px regardless.
   *Fix:* `grid-cols-6 sm:grid-cols-10` / `grid-cols-8 sm:grid-cols-12`, and
   raise the colour swatch to `h-11 w-11`. **Size: 2 lines + a visual check.**

3. **S2 — `DateFilterPicker` is `shrink-0` and wider than a 375px viewport;
   it appears on all four main app pages.**
   `src/components/ui/DateFilterPicker.tsx:60` root is
   `flex items-center gap-1 … p-1 shrink-0 flex-wrap`. In month mode the row is
   Month/Custom tabs (~130px) + two `h-11 w-11` arrows (88px) + a
   `min-w-[120px] px-3` label (144px) + gaps ≈ **382px** against 343px of usable
   width at 375px. `shrink-0` means the flex parent cannot compress it, and its
   own `flex-wrap` does not reduce its max-content width — so it either forces
   the page to scroll sideways or wraps into a ragged two-row block.
   Used at `src/pages/DashboardPage.tsx:663`, `src/pages/ExpensesPage.tsx:137`,
   `src/pages/BudgetsPage.tsx:190`, `src/pages/InsightsPage.tsx:888`. The
   Insights one is the worst: its parent (`InsightsPage.tsx:886`) is
   `flex items-center justify-end gap-2` with **no** `flex-wrap` and a
   "Advisory period:" label beside it, so there is nowhere for it to go.
   *Fix:* drop `shrink-0`, add `w-full sm:w-auto justify-between`, and make the
   month label `min-w-0 flex-1 sm:min-w-[120px] truncate`; add `flex-wrap` to
   `InsightsPage.tsx:886`. **Size: 2 files, ~4 lines.**

4. **S2 — On a 375px Pending card the merchant name is squeezed to a few
   characters by a decorative badge.**
   `src/pages/PendingPage.tsx:1600-1604`: the row is
   `flex items-center gap-2 overflow-hidden flex-nowrap`; the "Detected Alert"
   badge (line 1601) is `shrink-0 whitespace-nowrap` (~105px) and the merchant
   badge (line 1602) is `truncate max-w-[150px]`. The amount (line 1610) is
   `shrink-0` and takes ~110px from the parent `justify-between` row. Card
   padding is `p-5` (`src/components/ui/Card.tsx:27`), so inner width at 375px is
   ~303px: amount 110 + gap 12 leaves ~181px, minus the 105px static badge and
   the gap leaves roughly **68px for the merchant name** — the single most
   important field on the card.
   *Fix:* hide the "Detected Alert" badge below `sm`, or move the merchant onto
   its own line on mobile. **Size: 1-2 lines.**

5. **S2 — The 768px tablet band has no persistent navigation.**
   The bottom nav is `md:hidden` (`AppLayout.tsx:1081`) so it disappears at
   exactly 768px. The in-app desktop nav is `hidden lg:block`
   (`AppLayout.tsx:451`) so it does not appear until 1024px. Between 768 and
   1023px the only way to move around the app is the hamburger
   (`AppLayout.tsx:718`, `flex lg:hidden`) and its dropdown
   (`AppLayout.tsx:733`, `lg:hidden`). On an Android tablet in portrait — a
   width the owner explicitly listed — the app loses its primary navigation and
   falls back to a phone-style menu.
   *Fix:* move the bottom nav to `lg:hidden` so the two hand-offs meet at the
   same breakpoint. **Size: 1 word, but re-check every `md:` on the app pages.**

---

## Full findings, ranked

### S1 — breaks the screen

| # | File:line | Problem | Fix | Size |
|---|---|---|---|---|
| 1 | `src/layouts/AppLayout.tsx:891` (with `:1081`) | `<main>` reserves no space for the 64px fixed bottom nav; the tail of every long page is covered on mobile. | Add `pb-24 md:pb-6` to `<main>` when the nav renders. | 1 line |
| 2 | `src/components/settings/CategoryFormModal.tsx:174, :197` | `grid-cols-10`/`grid-cols-12` with fixed `w-9`/`w-7` children need 414px/402px inside a ~295px modal at 375px. | Step the column counts by breakpoint. | 2 lines |

### S2 — significantly degrades

| # | File:line | Problem | Fix | Size |
|---|---|---|---|---|
| 3 | `src/components/ui/DateFilterPicker.tsx:60`, `:101` | `shrink-0` on a ~382px-wide control, used on Dashboard/Expenses/Budgets/Insights. | Drop `shrink-0`, make the month label shrinkable. | ~4 lines |
| 4 | `src/pages/InsightsPage.tsx:886` | Label + `shrink-0` picker on a `flex` row with no `flex-wrap` — the likeliest source of page-level horizontal scroll at 375px. | Add `flex-wrap`. | 1 word |
| 5 | `src/pages/PendingPage.tsx:1600-1610` | Static "Detected Alert" badge is `shrink-0` and starves the merchant name at 375px. | `hidden sm:inline-flex` on the static badge. | 1 line |
| 6 | `src/layouts/AppLayout.tsx:1081` vs `:451` | 768-1023px has neither bottom nav nor desktop nav. | Align the two breakpoints on `lg`. | 1 word |
| 7 | `src/components/settings/CategoryFormModal.tsx:197` | 28px colour swatches — well under the 44px touch minimum, and they are round, so the real hit area is smaller still. | `h-11 w-11`. | 1 line |
| 8 | `src/layouts/AppLayout.tsx:1084-1161` | Bottom-nav labels are `text-xs` with no `whitespace-nowrap` in `flex-1` cells. At 375px each cell is ~75px; "Transactions" at 12px is ~88px, so it wraps to two lines inside a fixed `h-16` row and the icon/label block is clipped or misaligned. | Shorten to "Spends"/"Txns" or add `truncate`. | 1 line |
| 9 | `src/layouts/AppLayout.tsx:426` + `:1081` | Sticky 64px header AND fixed 64px bottom nav. On a 375x667 phone that is 128px (19%) of permanent chrome; rotated to landscape (375px tall) it is 34%, leaving ~247px of content. | Hide the header on scroll-down on mobile, or drop it to `h-14`. | Medium — needs design input |
| 10 | `src/pages/SettingsPage.tsx:854-865` | `grid-cols-2` (unconditional) holding two native `type="date"` inputs at `text-xs`. Each cell is ~145px at 375px; Android Chrome's date input has an intrinsic width around 130-150px including the picker glyph, so the control likely clips its own text. **This one is a guess from measurements I could not take — verify on a real Android device before touching it.** | `grid-cols-1 sm:grid-cols-2`. | 1 line |
| 11 | `src/pages/DashboardPage.tsx:898, :917, :938` | Stat amounts are `text-3xl font-bold tracking-tight` with no truncate, and `Card` is `overflow-hidden`. A crore-scale figure (15 chars, roughly 270px at 30px bold) against ~263px of card interior at 375px will be clipped, not wrapped. Indian-format amounts get long fast. | `text-2xl sm:text-3xl` plus `break-words`, or a compact format below `sm`. | 1 line x3 |
| 12 | `src/pages/admin/ScannerTab.tsx:93` | `<table className="w-full text-left text-xs">` with no `overflow-x-auto` wrapper — the only table in the repo missing one (`CouponsTab.tsx:227` and `UsersTab.tsx:111, :292` all have one). Admin-only, hence not higher. | Wrap in `<div className="overflow-x-auto">`. | 1 line |

### S3 — cosmetic

| # | File:line | Problem | Fix | Size |
|---|---|---|---|---|
| 13 | `src/components/ui/Button.tsx:50-51` | `sm` and `md` are both `h-10` (40px), 4px under the 44px touch minimum, and they are the two sizes used almost everywhere. `Input.tsx:45` correctly uses `h-11`. | `h-11` for `md`; leave `sm` for dense desktop rows. | 1 line |
| 14 | `src/pages/InsightsPage.tsx:893, :898` | `md:grid-cols-3` with no `sm:` step — 1 column up to 767px, then 3 columns of ~229px at 768px. | Insert `sm:grid-cols-2`. | 2 lines |
| 15 | `src/pages/SubscriptionsPage.tsx:216, :221` | Same 1-to-3 jump at `md`. | Insert `sm:grid-cols-2`. | 2 lines |
| 16 | `src/pages/InsightsPage.tsx:934` | `md:grid-cols-2` puts the AI insights panel and the scenario simulator (which has numeric inputs) into ~344px each at 768px. | `lg:grid-cols-2`. | 1 word |
| 17 | `src/components/CookieConsent.tsx:40` | Offsets by `4rem + safe-area` for the bottom nav, but the nav only renders when `user` is truthy (`AppLayout.tsx:1080`). Signed-out visitors on a phone get a 64px gap under the banner. | Make the offset conditional, or accept it. | 1 line |
| 18 | `src/pages/SettingsPage.tsx:672` | `grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` — the 4-up rule form only appears at 1280px, so a 1024px laptop gets a 2x2 that reads as a form with a stray row. | Add `lg:grid-cols-4`. | 1 word |
| 19 | `src/pages/analytics/TrendChart.tsx:122`, `CategoryTrendChart.tsx:85`, `CreditCardPaymentTrend.tsx:69` | `min-w-[120px]`/`[140px]` absolutely-positioned tap tooltips. On the leftmost or rightmost bar at 375px they hang off the chart edge; the parent is `overflow-x-auto`, so they get clipped rather than repositioned. | Edge-aware alignment, or accept. | Small |
| 20 | Widespread `text-xs` | `src/pages/DashboardPage.tsx` alone has 62 `text-xs` (12px) usages. Most are genuinely secondary (labels, hints, counts) and that is fine, but a few carry primary content — `DashboardPage.tsx:717` onboarding copy, `SettingsPage.tsx:850` the export explainer, `ExpensesPage.tsx:150` the search input's own value. 12px input text also triggers iOS Safari's zoom-on-focus. | Lift genuine body copy to `text-sm`; inputs to `text-sm` minimum. | Small, many sites |

---

## What is already right (so nobody "fixes" it)

- **Safe areas are handled.** `index.html:57` sets `viewport-fit=cover`;
  `src/index.css:504-506` defines the `safe-area-inset-*` helpers; the bottom nav
  (`AppLayout.tsx:1081`) applies `safe-area-inset-bottom`, and the PWA prompt
  (`AppLayout.tsx:1048`) and cookie banner (`CookieConsent.tsx:40`) both do the
  `calc(4rem + env(safe-area-inset-bottom) + ...)` arithmetic correctly. Nothing
  to do here for notched Android phones.
- **The z-index stack is correct.** `src/index.css:253-258` defines a semantic
  scale; `Modal.tsx:40` uses `z-modal` (60), which correctly sits above the
  bottom nav's `z-50`. Modals will not be overlapped by the nav.
- **Charts and SVGs are responsive.** `BudgetBurndown.tsx:118-121` uses
  `viewBox` + `className="w-full h-20"` + `preserveAspectRatio`;
  `ExpenseBreakdown.tsx:73` sizes its donut in rem with a `sm:` step; the three
  bar charts (`TrendChart.tsx:97`, `CategoryTrendChart.tsx:70`,
  `CreditCardPaymentTrend.tsx:52`) each sit in `overflow-x-auto` with
  `min-w-full sm:min-w-[Npx] md:min-w-0`. This is the best-handled area in the
  codebase — audit item 6 on the brief is essentially a non-issue.
- **Touch targets were clearly swept once already.** `Input.tsx:45` is `h-11`;
  `ExpenseList.tsx:183` wraps a 16px checkbox in an `h-11 w-11` label;
  `PendingPage.tsx:1284, :1311, :1468` use `min-h-[40px]` with negative margins
  to expand small text links. Almost no `h-8`-or-smaller interactive elements
  exist anywhere in the app pages. The exceptions are items 7 and 13 above.
- **`SettingsPage` and `ExpenseList` have had a mobile pass.**
  `SettingsPage.tsx:557-560` carries a comment about exactly this, and the tab
  strip (`:561-566`) uses the `-mx-4 px-4 ... overflow-x-auto` bleed pattern
  correctly. `ExpenseList.tsx:179-231` stacks properly at `sm` with `min-w-0` in
  the right places.
- **Modals size sensibly.** `Modal.tsx:73-75` uses `max-h-[75svh]` / `92svh`
  (`svh`, not `vh` — correct for mobile browser chrome) and has a bottom-sheet
  variant.

---

## Count by severity

- **S1 (breaks the screen): 2**
- **S2 (significantly degrades): 10**
- **S3 (cosmetic): 8**
- **Total: 20**

---

## Coverage — what I did and did not reach

**Read in detail:**
`src/layouts/AppLayout.tsx`, `src/components/ui/Modal.tsx`,
`src/components/ui/Button.tsx`, `src/components/ui/Input.tsx`,
`src/components/ui/Card.tsx`, `src/components/ui/DateFilterPicker.tsx`,
`src/components/settings/CategoryFormModal.tsx`, `src/index.css` (theme block,
z-scale, safe-area helpers, `body`, skip link), `index.html`.

**Read in part** — header/hero/grid/list regions, plus a full `className` dump
and a grid / `min-w-` / fixed-width / `overflow-x` / table / small-height grep of
each: `src/pages/DashboardPage.tsx`, `src/pages/PendingPage.tsx`,
`src/pages/SettingsPage.tsx`, `src/pages/InsightsPage.tsx`,
`src/pages/ExpensesPage.tsx`, `src/pages/BudgetsPage.tsx`,
`src/components/expenses/ExpenseList.tsx`,
`src/pages/analytics/ExpenseBreakdown.tsx`,
`src/pages/analytics/BudgetBurndown.tsx`.

**Covered only by pattern grep** — a finding could easily hide here:
`src/pages/SubscriptionsPage.tsx`, `src/pages/ProfilePage.tsx`, the rest of
`src/pages/analytics/*` (`TrendChart`, `CategoryTrendChart`,
`CreditCardPaymentTrend`, `MerchantLeaderboard`, `SmartWealthTips`,
`BudgetVisualizer`, `ScenarioSimulator`, `AIInsights`, `AnomalyAlerts`,
`ForecastPanel`, `AdherenceDiagnostic`, `DrillDownModal`, `PeriodSelector`),
`src/components/dashboard/*`, `src/components/expenses/ExpenseForm.tsx`,
`src/components/settings/CardManager.tsx`,
`src/components/settings/CategoryManager.tsx`,
`src/components/auth/AuthModal.tsx`, `src/components/auth/AccessEnded.tsx`,
`src/components/ui/Select.tsx`, `Badge.tsx`, `EmptyState.tsx`, `ScrollHint.tsx`,
`UserMenu.tsx`, `TransactionIdentity.tsx`, `ConfirmDialog.tsx`,
`SiteFooter.tsx`, `MarketingHeader.tsx`.

**Not reached at all — no audit of these:**

- `src/pages/admin/*`, beyond noticing the missing table wrapper in
  `ScannerTab.tsx:93`. `UsersTab`, `CouponsTab`, `AdminBarChart` and the rest
  were not looked at.
- The entire marketing and auth surface: `src/pages/LandingPage.tsx`,
  `src/pages/landing/*`, `src/pages/PricingPage.tsx`, `src/pages/AboutPage.tsx`,
  `src/pages/SupportPage.tsx`, `src/pages/TermsPage.tsx`,
  `src/pages/PrivacyPage.tsx`, `src/pages/RefundPage.tsx`,
  `src/pages/PaymentSuccessPage.tsx`, `src/layouts/MarketingLayout.tsx`,
  `src/layouts/AuthLayout.tsx`, `src/pages/ForgotPasswordPage.tsx`,
  `src/pages/ResetPasswordPage.tsx`. These were outside the stated priority
  order and I stopped rather than cover them thinly.
- The bulk of `src/index.css`. Custom utility classes (`sb-btn-primary`,
  `sb-card`, `sb-caption`, `sb-card-light`, `aurora-*`) were **not** inspected,
  so any fixed width or font size defined inside them is invisible to this
  audit. Several findings above would change if one of those sets a width.
- Capacitor-specific behaviour: `capacitor.config.*`, the Android status-bar
  overlay, and keyboard resize mode were not examined. The soft keyboard
  covering a focused input in the native shell is a classic Capacitor problem
  and is not visible from classNames at all.
- No `tailwind.config` breakpoint override was checked for, so every width
  calculation above assumes Tailwind defaults (`sm` 640, `md` 768, `lg` 1024,
  `xl` 1280). If those were customised, the arithmetic shifts.

---

## Recommended next step

Log in on a real Android phone (or Chrome DevTools at 375px with touch
emulation) and walk Dashboard → Pending → Expenses → Settings → the category
modal. Items 1, 2, 3, 5 and 8 should be visible within about five minutes, and
that pass will also confirm or kill items 10 and 11, which are the two findings
here resting most heavily on arithmetic rather than observation.
