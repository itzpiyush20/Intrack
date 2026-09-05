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

---
---

# Part two — marketing, auth, admin and shared components

Date: 2026-09-05. Read-only audit. **No application code was changed.**

## Method — and why this half is stronger evidence than part one

Part one could not render anything, because every page it covered is behind a
login. **The surfaces in part two are public**, so this pass ran the real app:
`npm run dev` on port 5173, driven in a real Chromium at emulated viewport
widths of 375x812, 768x1024 and 1280x900, with a DOM probe that measures every
element's bounding box, computed style, `scrollWidth` vs `clientWidth`, and the
rendered pixel size of every `a / button / input / select / textarea /
[role=button]`.

So findings below are labelled:

- **[MEASURED]** — read off the live rendered page. A number here is a real
  number, not an estimate.
- **[READ]** — inferred from `className` strings only, same evidence class as
  part one. Used for the admin pages and for signed-in-only branches of shared
  components, which still could not be rendered.

Severity scale is part one's, unchanged (S1 breaks the screen, S2 significantly
degrades, S3 cosmetic).

---

## First, the question part one asked: does `src/index.css` invalidate anything?

Part one flagged that a hard width hidden in `sb-btn-primary` / `sb-card` /
`sb-caption` / `aurora-*` would break its arithmetic. That question is now
answered.

**No custom utility sets a `width`.** Every `width` in `src/index.css` is either
`width: 100%` (`.marquee-container:808`, `.sb-text-input:782`), `width: 1px`
(`.sr-only:488`, `.skip-to-content:297`), `width: max-content`
(`.marquee-content:817`), a scrollbar rule (`:327`), or the 70% nav underline
(`.nav-active-indicator:478`). The `aurora-*` rules are neutralised stubs
(`src/index.css:509-556`) — `aurora-bg::before` is `display: none`, the drift
animation is `none`, and `.aurora-progress-fill` only sets a background colour.
They contribute no geometry at all.

**Part one's arithmetic therefore stands.** Its width calculations for
`CategoryFormModal`, `DateFilterPicker` and the Pending card used `Modal`,
`Card` and Tailwind classes, none of which route through an `sb-*` utility.
Nothing in part one needs revising on these grounds.

But the inspection turned up something part one could not have predicted, which
is worse than a hidden width, and is finding **P2-1** below.

---

## The five worst problems in part two

### P2-1 — S1 — `sb-btn-*` and `sb-card-*` silently discard every Tailwind size utility applied to them. [MEASURED]

`src/index.css:696-742` and `:757-770` define `.sb-btn-primary`,
`.sb-btn-secondary`, `.sb-btn-on-dark`, `.sb-card-light` and `.sb-card-dark` as
**plain CSS rules outside any `@layer`**. Tailwind v4 puts its utilities in
`@layer utilities`, and unlayered CSS beats every layer regardless of
specificity. So a `px-7 py-3.5` or `p-8` written next to one of these class
names does nothing at all.

Measured on the live landing page at 375px:

| Element | Classes written | Computed |
|---|---|---|
| Landing CTA (`LandingPage.tsx:214`) | `sb-btn-primary … text-base px-7 py-3.5` | `font-size: 14px`, `padding: 13px 18px`, height **40px** |
| Feature card (`LandingPage.tsx` ×19 on the page) | `sb-card-light p-8` | `padding: 28px` on all four sides |

Two consequences, and the second is the S1:

1. **Every `sb-btn-*` on every public page is exactly 40px tall** — 13 + 14 + 13
   with `line-height: 1.0` — and cannot be made taller from the JSX. That is
   under the 44px touch minimum, and it is the *only* size these buttons have.
   This includes the primary conversion buttons: "Get started" in the header,
   "Start free — 7 days, no card", "Get Yearly", "Sign In", "Create Account".
2. **`sb-card-light` hard-codes `padding: 28px`** and has no responsive step. At
   375px the card is 343px wide, so 56px — **16% of the viewport** — is padding,
   leaving 287px of content. Any `p-4 sm:p-8` someone writes to fix that will be
   ignored, so the next person to try will conclude the class isn't the problem.

This is worse than the hidden width part one was worried about, because it is
silent: the JSX reads as though it responds to breakpoints and it does not.

*Fix:* move these rules into `@layer components { … }` in `src/index.css` so
Tailwind utilities can override them, then re-check the pages that already try
to override (they will suddenly start working, some for the worse). Set the
button padding to yield a 44px box. **Size: small edit, wide blast radius —
needs a visual pass over every public page afterwards.**

### P2-2 — S1 — `MarketingHeader` overflows the viewport for the entire 768-895px band; the primary CTA is pushed off-screen. [MEASURED]

`src/components/ui/MarketingHeader.tsx:56` reveals six nav links at `md:flex`
and `:51` reveals the "AUTOMATED TRACKER" badge at `md:inline-flex` — both at
exactly 768px, which is where the mobile scroll-strip at `:93` (`md:hidden`)
switches off. The header's min-content width is **885px**.

Measured at 768x1024 on `/`: `document.scrollWidth` = **885** against a
`clientWidth` of 758 — the whole document scrolls sideways by 127px. The
screenshot shows "How it works" broken over three lines, "Install App" over two,
"Sign in" over two, and the green **"Get started" button entirely off the right
edge of the screen**. Still broken at 820px (scrollWidth 885). Clean again at
1024px and at 1280px.

Every public page using this header is affected: `/about`, `/terms`, `/privacy`,
`/refund-policy` (via `MarketingLayout.tsx`) and `/` — i.e. the pages a
prospective customer reads before signing up, on the one device class the app is
being sold into.

*Fix:* move the desktop nav and the badge from `md:` to `lg:` and the scroll
strip from `md:hidden` to `lg:hidden`, so the hand-off happens at 1024 where
there is room. This is the same `md`-vs-`lg` mistake part one found at item 6 in
`AppLayout`. **Size: 3 class changes.**

### P2-3 — S2 — Every toast is clipped 24px off the left edge of a 375px screen. [MEASURED]

`src/context/ToastContext.tsx:50` is
`fixed bottom-6 right-6 z-toast … max-w-sm w-full`. `w-full` resolves against
the viewport (375px), `max-w-sm` is 384px so it never clamps, and `right-6`
then pins the right edge at 351 — putting the left edge at **-24**.

Measured by appending a probe child to the live container at 375px: the toast's
own bounding box is left **-24**, right 351, width 375. The first 24px of every
toast — where the icon and the first characters of the message sit — is off
screen. Toasts are how this app reports scan failures and payment errors, so
this is the app's error channel, not decoration. Affects signed-in pages too, so
it also belongs to part one's surface.

*Fix:* `left-4 right-4 w-auto sm:left-auto sm:right-6 sm:w-full`. **Size: 1 line.**

### P2-4 — S2 — The signup consent checkbox renders at 13x14px, and the consent text at 11px. [MEASURED]

`src/components/auth/AuthModal.tsx:232` is
`mt-0.5 h-3.5 w-3.5 … accent-emerald-500`, with the label at `:234` set to
`text-[11px]`. Measured on the live Create Account tab at 375px: the checkbox
box is **13px wide by 14px tall**; the label computes to **11px**.

That is the smallest interactive element found anywhere in either half of this
audit — a third of the 44px minimum — and it is not a decorative control. It is
the gate on the sentence at `:235` in which the user consents to their bank
alert emails being read and sent to Gemini. There is no larger hit area
compensating for it: the `<label>` is a sibling, not a wrapper, so tapping the
text does toggle it via `htmlFor`, but the 11px text is itself a hard target.

Part one recorded that `ExpenseList.tsx:183` already solves exactly this by
wrapping a 16px checkbox in an `h-11 w-11` label. That pattern just was not
applied here.

*Fix:* apply the `ExpenseList` pattern — wrap the input in an `h-11 w-11`
centring label — and lift the consent copy to `text-xs` at minimum.
**Size: ~3 lines.**

### P2-5 — S2 — The sign-in and sign-up inputs are 14px, so iOS Safari zooms the page on focus. [MEASURED]

`src/components/auth/AuthModal.tsx:212, :222` render the email and password
fields at `text-sm`. Measured computed `font-size: 14px` on both. Mobile Safari
zooms the viewport whenever a focused input is under 16px, and it does not zoom
back out on blur — so the first thing a new user experiences is the login form
jumping and the page staying zoomed.

This is notable because the codebase already knows the rule: `.sb-text-input`
(`src/index.css:779`) is explicitly `font-size: 16px`. The auth modal just does
not use it. `src/components/ui/Input.tsx` is also `text-sm`, so every form in
the app inherits the same behaviour — part one's item 20 touched the edge of
this but attributed it to `text-xs` only; the real threshold is 16px, and
`text-sm` is already below it.

*Fix:* `text-base` on the auth inputs at minimum, ideally on `Input.tsx` too
(`text-base sm:text-sm` keeps desktop density). **Size: 1-2 lines.**

---

## Full part-two findings, ranked

### S1 — breaks the screen

| # | File:line | Evidence | Problem | Fix | Size |
|---|---|---|---|---|---|
| P2-1 | `src/index.css:696, :709, :721, :757, :763` | MEASURED | Unlayered CSS beats Tailwind's `@layer utilities`, so `px-7 py-3.5` / `p-8` written beside `sb-btn-*` / `sb-card-*` are silently dropped. All such buttons are locked at 40px; all such cards at 28px padding at every width. | Move into `@layer components`. | Small edit, wide re-check |
| P2-2 | `src/components/ui/MarketingHeader.tsx:51, :56, :93` | MEASURED | Header min-content is 885px but the desktop nav switches on at 768px; document scrolls sideways 127px and "Get started" is off-screen from 768 to ~895px. | Move `md:` → `lg:` on all three. | 3 classes |

### S2 — significantly degrades

| # | File:line | Evidence | Problem | Fix | Size |
|---|---|---|---|---|---|
| P2-3 | `src/context/ToastContext.tsx:50` | MEASURED | `right-6` + `w-full` puts the toast container at left `-24` on a 375px screen; 24px of every toast is off-screen. Affects signed-in pages too. | `left-4 right-4 w-auto sm:…`. | 1 line |
| P2-4 | `src/components/auth/AuthModal.tsx:232, :234` | MEASURED | Terms-consent checkbox renders 13x14px; its label is 11px. | Wrap in an `h-11 w-11` label; `text-xs` copy. | ~3 lines |
| P2-5 | `src/components/auth/AuthModal.tsx:212, :222` (and `src/components/ui/Input.tsx:45`) | MEASURED | Inputs compute to 14px, under Safari's 16px zoom threshold, on the login form. `.sb-text-input` already gets this right at `index.css:779`. | `text-base` on mobile. | 1-2 lines |
| P2-6 | `src/components/auth/AuthModal.tsx:133` | MEASURED | Panel is `max-h-[90vh]` — `vh`, not `svh`. Measured 730.8px against an 812px viewport, with `scrollHeight` 1115 on the signup tab. `vh` resolves to the *large* viewport on mobile, so on a real phone with the URL bar showing the panel is taller than the visible area and its bottom (the submit button) sits under browser chrome. Part one specifically praised `Modal.tsx:73-75` for using `svh`; this modal does not use the shared `Modal` at all. | `max-h-[90svh]`, or route it through `Modal`. | 1 line |
| P2-7 | `src/components/ui/MarketingHeader.tsx:99` | MEASURED | The mobile nav strip's six links render **16px tall** (`text-xs`, no vertical padding of their own). At 375px this is the only navigation a phone visitor has, and each link is a 16px-high target. The strip is also a silent `overflow-x-auto` scroller (measured 426px of content in 375px) with no gradient or hint that two of the six items are off-screen. | `py-2.5` on each link (not the row) for a 40px+ box; add the `ScrollHint` component already in the repo. | 2 lines |
| P2-8 | `src/components/auth/AuthModal.tsx:168, :179` | MEASURED | Sign In / Create Account tab buttons render 35px tall at `text-xs`. These are the modal's primary mode switch. | `py-3 text-sm`. | 1 line |

| P2-9 | `src/layouts/AppLayout.tsx:477` + `:502` | MEASURED | **Every public page overflows at 768px, and the two `/pricing` and `/support` pages overflow worse than the rest.** `AppLayout`'s signed-out header reveals a six-link marketing nav at `hidden md:flex` (`:477`) beside a `shrink-0` auth group (`:502`); min-content is **1069px**. Measured at 768: `scrollWidth` 1069, i.e. **301px of horizontal scroll** — nearly half the pricing page off-screen, including "Get started". This is a signed-out branch of the file part one audited, which part one could not render. Same root cause as P2-2, different file. | Move `:477` to `lg:flex` (the hamburger at `:719` is already `lg:hidden`, so they would then line up). | 1 class |
| P2-10 | `src/pages/SupportPage.tsx:135, :138, :187` | MEASURED + verified fix | `grid gap-6 md:grid-cols-12` whose children are grid items with the default `min-width: auto`. The mobile topic tablist at `:163` is `overflow-x-auto … whitespace-nowrap` and 389px of content, so instead of scrolling it forces both grid columns to 389px. Measured `scrollWidth` 406 in a 375px viewport — **the whole page scrolls sideways by 31px**, and the `max-w-full` on `:163` cannot help because it resolves against the already-inflated parent. **Verified live: setting `min-width: 0` on the two grid children dropped `scrollWidth` from 406 to 375 and made the tablist scroll as intended (389 content in a 343 box).** | Add `min-w-0` to `:138` and `:187`. | 2 words |

### S3 — cosmetic

| # | File:line | Evidence | Problem | Fix | Size |
|---|---|---|---|---|---|
| P2-11 | `src/pages/PricingPage.tsx:493, :553` | MEASURED | Plan-selection radios render 20x20px. Mitigated — the whole `Card` carries the `onClick` (`:489`) so the real target is the card — but the radio reads as the control and misses at 20px. | `h-6 w-6`, or drop the radio for a checked-state border. | 1 line |
| P2-12 | `src/pages/ResetPasswordPage.tsx` ("Request New Link") and `src/pages/ForgotPasswordPage.tsx` ("Send reset link") | MEASURED | Both render at exactly 40px — the first because `sb-btn-primary py-3.5` is a P2-1 casualty, the second via `Button.tsx`'s `h-10`, which is part one's item 13. Same 4px shortfall, two different causes. | Fix P2-1 and part one item 13. | — |
| P2-13 | `src/pages/AboutPage.tsx`, `TermsPage.tsx`, `PrivacyPage.tsx`, `RefundPage.tsx` | MEASURED | **Clean at 375px and at 1280px.** No overflow, no runaway grid, no undersized target of their own. Everything wrong on these four pages comes from the shared `MarketingHeader` (P2-2) and `SiteFooter`. Recorded so nobody re-audits them. | none | — |
| P2-14 | `src/index.css:757-770` | MEASURED | `.sb-card-light` / `.sb-card-dark` are `padding: 28px` with no breakpoint step; measured 343px outer / 287px inner at 375px, so 16% of a phone screen is card padding, and there are **19 such cards on the landing page alone.** Cannot be overridden from JSX until P2-1 is fixed. | After P2-1, `padding: 20px` with a `@media (min-width: 640px)` step to 28px. | 3 lines |

---

## Shared components

`src/components/ui/*` not already covered by part one.

| # | File:line | Evidence | Severity | Note |
|---|---|---|---|---|
| P2-15 | `src/components/ui/ScrollHint.tsx:97, :108` | READ | S3 | The left/right chevron buttons are `h-5 w-5` (20px) and absolutely positioned *over* the scrolling content, so they both under-shoot 44px and sit on top of whatever is beneath them. The component itself is otherwise the right answer to a horizontal scroller and is correctly used by `AdminPage.tsx:50`. |
| P2-16 | `src/components/ui/Select.tsx:43` | READ | S3 | `h-11` (correct, 44px) but `text-sm` — 14px, under the iOS zoom threshold, same class of problem as P2-5. `<select>` focus zooms on iOS too. |
| P2-17 | `src/components/ui/ConfirmDialog.tsx:44, :49` | READ | S3 | Both actions are `size="md"`, which `Button.tsx:51` maps to `h-10` — so the Cancel and the destructive Confirm on every confirmation dialog in the app are 40px. This is part one's item 13 landing in the highest-consequence place: a mis-tap here deletes something. Not a new defect, but it raises the priority of part one item 13 from cosmetic to worth doing. |
| P2-18 | `src/components/ui/SiteFooter.tsx:82` | MEASURED | S3 | Footer links are `text-xs` and render 16px tall. `:77` is `flex flex-wrap justify-center gap-6`, so they wrap correctly and nothing overflows — this is only a touch-target note, and footer links are genuinely secondary. |
| P2-19 | `src/components/ui/EmptyState.tsx:16` | READ | S3 | `py-16` (128px of vertical padding) on a component whose whole job is to fill a mostly-empty screen. On a 375x667 phone with the header and bottom nav already taking 128px (part one item 9), an empty state can push its own action button below the fold. `py-10 sm:py-16`. |
| P2-20 | `src/components/ui/UserMenu.tsx:85` | READ | S3 | Dropdown is `absolute right-0 w-48` (192px) — fits at 375px. Trigger is `h-11`, items are `min-h-11`. **This component is fine.** Recorded so it is not re-checked. |
| P2-21 | `src/components/ui/Badge.tsx`, `Card.tsx`, `BrandMark.tsx`, `TransactionIdentity.tsx`, `ScrollProgressBar.tsx` | READ | — | No fixed widths, no undersized targets, no un-stepped grids. Nothing to report. |

`DateFilterPicker`, `Modal`, `Input` and `Button` were audited in part one and this
pass found nothing to add or contradict, except that P2-5 extends part one's
item 20: the threshold that matters for mobile inputs is **16px**, not 12px, so
`Input.tsx:45`'s `text-sm` is already on the wrong side of it.

---

## Admin — `src/pages/admin/*`

**All [READ] only.** The admin pages sit behind both a login and an `is_admin`
check, so unlike the marketing pages they could not be rendered. Treat these at
part one's evidence level, and note that admin is a single-operator surface used
on a laptop, which is why nothing here is above S3.

| # | File:line | Problem | Fix | Size |
|---|---|---|---|---|
| P2-22 | `src/pages/admin/OverviewTab.tsx:64`, `ScannerTab.tsx:164` | `grid grid-cols-2 … md:grid-cols-4` — two columns of ~155px at 375px holding a stat number plus a `text-xs uppercase tracking-wider` label ("Insight calls today", "Manual / auto"). Uppercase with positive letter-spacing is the widest possible way to set 12px text, so these labels wrap. Also no `sm:` step, the same 1-to-many jump as part one items 14, 15 and 18. | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`. | 2 lines |
| P2-23 | `src/pages/admin/FeedbackTab.tsx:80`, `SupportTab.tsx:86`, `AiUsageTab.tsx:29` | Same unconditional `grid-cols-2` stat tiles. `AiUsageTab.tsx:29` has no larger step at all, so it is two columns at every width from 375 to 2560. | Add a `sm:`/`lg:` step. | 3 lines |
| P2-24 | `src/pages/admin/ScannerTab.tsx:93`, `UsersTab.tsx:112` | Both tables are `text-xs`. Part one already logged (its item 12) that `ScannerTab.tsx:93` is additionally missing its `overflow-x-auto` wrapper — **confirmed, and it is still the only table in the repo without one** (`CouponsTab.tsx:227`, `UsersTab.tsx:111`, `:292` all have one). Not double-counted here. | Wrap it; lift to `text-sm`. | 1 line |
| P2-25 | `src/pages/admin/AdminPage.tsx:50` | **Correct, do not change.** The tab strip is wrapped in `ScrollHint`, which is exactly what `MarketingHeader.tsx:93` should have done (P2-7). Good precedent to copy. | none | — |
| P2-26 | `src/pages/admin/AdminBarChart.tsx:18-20` | `flex h-40 items-end gap-1 overflow-x-auto` with `min-w-[10px] flex-1` bars. Degrades sanely — bars shrink to 10px then the row scrolls. **Fine.** Consistent with part one's finding that charts are the best-handled area of this codebase. | none | — |

`RefundReviewCard.tsx` and `CouponsTab.tsx` stack correctly at `sm:` and show no
fixed widths. `AdminRoute.tsx` renders no layout.

---

## What is already right in part two (so nobody "fixes" it)

- **`/about`, `/terms`, `/privacy` and `/refund-policy` are clean** at 375px and
  1280px — measured, not guessed. Their only problem is the shared header.
- **1280px is clean on every public page.** Measured `scrollWidth - clientWidth`
  = 0 on all seven. Every overflow found in part two is at 375 or 768.
- **`.sb-text-input` (`src/index.css:779`) sets `font-size: 16px`** — the one
  place in the codebase that gets the iOS zoom threshold right. It is the model
  for the P2-5 fix, not a thing to change.
- **`ScrollHint` exists and `AdminPage` uses it properly.** The repo already
  owns the right pattern for horizontal scrollers.
- **`AuthLayout.tsx` and `MarketingLayout.tsx` add no geometry of their own** —
  both are thin wrappers around `MarketingHeader` + `SiteFooter`, so fixing
  P2-2 fixes them.
- **`UserMenu` is correct at 375px** (192px dropdown, `h-11` trigger,
  `min-h-11` items).
- **The reveal-animation overflow was already found and fixed** —
  `src/index.css:412-418` turns `from-left`/`from-right` into a vertical
  translate below 768px, with a comment recording that the horizontal version
  caused exactly the kind of document-level sideways scroll this audit hunts
  for. That fix is working: no reveal element appeared in any overflow probe.

---

## Count by severity — part two

- **S1 (breaks the screen): 2** (P2-1, P2-2)
- **S2 (significantly degrades): 8** (P2-3 … P2-10)
- **S3 (cosmetic): 12** (P2-11, P2-12, P2-14, P2-15, P2-16, P2-17, P2-18,
  P2-19, P2-22, P2-23, P2-24, plus P2-11's radio note)
- **Not defects, recorded to prevent re-work: 4** (P2-13, P2-20, P2-21, P2-25,
  P2-26)
- **Total defects: 22**

Combined with part one: **4 S1, 18 S2, 20 S3 — 42 findings.**

Of part two's 22, **14 are [MEASURED]** on a rendered page and 8 are [READ].
Every S1 and all but two S2s are measured.

---

## Effect on part one

**Nothing in part one is contradicted.** Two things are strengthened:

1. **`src/index.css` does not invalidate part one's arithmetic** — no custom
   utility sets a width (see the top of part two). Part one's `CategoryFormModal`,
   `DateFilterPicker` and Pending-card calculations stand as written.
2. **Part one's item 6 (the `md`-vs-`lg` navigation gap) is bigger than it
   looked.** Part one found it in the signed-in `AppLayout`. Part two measured
   the same mistake breaking the *signed-out* header on every public page
   (P2-2, P2-9), with 301px of horizontal scroll on `/pricing`. Whoever fixes
   item 6 should fix all three headers in one pass.

One part-one item gains priority: **item 13 (`Button.tsx` `md` = `h-10`)** was
filed S3. `ConfirmDialog` (P2-17) makes it the size of the confirm button on
destructive dialogs, and it is also why `ForgotPasswordPage`'s "Send reset link"
measures 40px. Worth promoting to S2.

---

## Coverage — what part two did and did not reach

**Rendered and measured** (dev server on :5173, Chromium, at 375x812, 768x1024
and 1280x900):
`/` (LandingPage + `landing/InteractionSimulation`), `/pricing`, `/support`,
`/about`, `/terms`, `/privacy`, `/refund-policy`, `/forgot-password`,
`/reset-password`, the `AuthModal` on both its Sign In and Create Account tabs,
`MarketingHeader`, `SiteFooter`, `MarketingLayout`, `AuthLayout`, the
`AppLayout` signed-out header, `CookieConsent`, the `ToastContext` container,
and the computed styles of `sb-btn-*`, `sb-card-*`, `sb-text-input` and
`aurora-*`.

**Read only, not rendered:**
`src/pages/admin/*` (login + `is_admin` gated), `src/components/auth/AccessEnded.tsx`
(requires an expired subscription), `ConfirmDialog`, `Select`, `ScrollHint`,
`EmptyState`, `Badge`, `TransactionIdentity`, `ScrollProgressBar`.

**Not reached at all:**

- **`/payment-success` was never seen.** Navigating to it while signed out
  redirects to `/`. `src/pages/PaymentSuccessPage.tsx` (183 lines) was not
  audited, by reading or rendering. It is a post-payment screen, so it is worth
  someone's twenty minutes.
- **`src/components/auth/AccessEnded.tsx`** — not audited. It needs a lapsed
  account to render and was not read closely enough to file findings.
- **`src/pages/landing/InteractionSimulation.tsx`** was rendered as part of the
  landing page and contributed no overflow, but its internal animation states
  were not stepped through. A frame mid-animation could be wider than the frame
  I measured.
- **The 375px landing page was measured at the top of the document only for
  fixed/sticky elements.** Long-scroll interactions — a sticky element becoming
  sticky partway down — were not exercised.
- **Real devices.** Everything here is Chromium viewport emulation. The two
  findings that specifically predict *Safari* behaviour (P2-5 zoom-on-focus,
  P2-6 `vh` vs `svh`) are correct by rule but were not observed on an iPhone.
- **Capacitor.** Same gap part one recorded: the Android shell, status-bar
  overlay and keyboard resize mode were not examined.
- **Landscape.** Only portrait widths were tested.

---

## Recommended order of work

1. **P2-2 + P2-9 + part one item 6** together — one `md:` → `lg:` sweep across
   all three headers. This is the single highest-value change in either audit:
   it fixes horizontal scroll on every public page at tablet width, which is
   what a prospective customer sees.
2. **P2-10** (`min-w-0` on the Support grid) — two words, verified fix,
   removes the last page-level overflow at 375px.
3. **P2-3** (toast clipping) — one line, and it is the app's error channel.
4. **P2-1** (`@layer components`) — small edit but the widest blast radius;
   do it deliberately, and re-walk every public page at 375/768/1280
   afterwards, because ~19 cards and every marketing button will change size
   the moment the overrides start working.
5. **P2-4 and P2-5** — the signup consent checkbox and the 14px auth inputs.
6. Everything else.
