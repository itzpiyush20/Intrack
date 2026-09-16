# App motion — design

Date: 2026-09-16. Status: approved by owner, not yet built.

## In plain words

Intrack gets small, smooth animations across the signed-in app so it feels
modern and premium. Things glide into place; nothing bounces, flashes or loops.
Every animation exists because it helps on that screen — it shows where
something went, what changed, or that an action worked. The app must never feel
slower because of it.

A hidden test page comes first. The owner tries every animation on a phone,
says what feels right, and only then does it go into the real app, one area at a
time.

## Owner decisions (2026-09-16)

- **Old motion rules are scrapped.** The "motion only reports change, nothing
  decorates" ban in `PRODUCT.md`, `DESIGN.md`, `src/components/ui/motion.ts` and
  `plans/ui-overhaul-2026-09-05.md` no longer applies. This document replaces it.
- **Feel: smooth glide, no bounce.** Chosen from clickable demos. A springy
  version with ~3% overshoot was shown first and rejected as too bouncy. All
  motion eases out and settles without passing its target.
- **Not showy.** Subtle, fitted to what each screen is for.
- **Scope:** Home, Insights, Pending (incl. scanning), Expenses, the Add
  Transaction form, navigation and page changes. Budgets, Subscriptions,
  Settings and Profile get only the shared basics.
- **Haptics: yes**, in the native app only.
- **Test page first**, then a phased rollout.

## Hard limits (from the brief, not from the old rules)

1. **Never slower.** Animate `transform` and `opacity` only, plus framer-motion
   `layout` for morphs. No `filter`, `backdrop-filter`, blur or animated
   shadows/box sizes in the native build. No animation blocks input: a tap
   during an animation acts immediately. Long lists (> ~12 rows) animate only
   the rows on screen on first paint.
2. **Durations:** 200–350 ms for interface feedback, up to ~800 ms for figures
   and charts arriving. Nothing the user waits on exceeds 350 ms.
3. **Reduced motion honoured.** Under `prefers-reduced-motion`, movement is
   removed; short opacity fades may stay. Accessibility, not taste.
4. **Money is exact.** Every animated figure lands on the true value, formatted
   by the existing `formatCurrency`.
5. **Keep the route-wrapper fixes in `src/App.tsx`.** The page transition must
   not animate opacity (a stalled animation once left the app blank after the
   Google OAuth redirect) and must not use `AnimatePresence mode="wait"` (blank
   page on immediate redirects). Page changes move by transform only.

## The motion kit (built first)

`src/components/ui/motion.ts` is rewritten around one curve family:

- Standard ease: `cubic-bezier(0.22, 1, 0.36, 1)` — the curve the owner approved
  in the demo. No overshoot anywhere.
- Durations: `fast` 0.2 s, `base` 0.3 s, `slow` 0.5 s, `figure` 0.8 s.
- Presets: press (scale to 0.97 and back), page rise, row enter, row exit,
  collapse-on-delete, new-row tint, panel swap.
- Every preset takes the `useReducedMotion()` result, as today.

New building blocks in `src/components/ui/`:

| Block | What the user sees |
|---|---|
| `RollingNumber` | Each digit rolls in its own slot to the new amount; digits that didn't change stay still. Tabular figures so width never jumps. Replaces `AnimatedNumber`. |
| `MorphSurface` | A button grows smoothly into the panel or form it opens, and shrinks back on close (framer `layoutId`). |
| `SlidingIndicator` | The highlight on the nav or a tab strip glides to the tapped item. |
| `SwipeCard` | Drag a card sideways; past a threshold it glides away, otherwise it glides back. Buttons remain for keyboard and screen-reader users. |
| `haptics.ts` | `tap()`, `success()`, `warning()`. Uses `@capacitor/haptics` on native; no-op on web. |

`AnimatedBar` stays but uses the new curve, and animates from its previous
value instead of from zero when the value changes.

## Test page

- Route `/motion-lab`, inside `AdminRoute`, never linked from navigation.
- Shows every block above using real app components (a real Card, a real
  Pending card, the real Add Transaction form layout).
- Controls to adjust duration and curve live; the owner's chosen values are
  then written into `motion.ts`.
- Deleted, with its route, at the end of the rollout.

## What moves where

### Round 1 — navigation, page changes, shared basics (all signed-in pages)

- Nav: active highlight glides between items (`SlidingIndicator`), desktop
  sidebar and mobile bottom nav.
- Page change: new page rises ~8 px into place (transform only, see limit 5).
- Popups and sheets (`Modal`): open from the element that opened them where one
  exists, otherwise rise and fade; close in reverse.
- Buttons and tappable cards: gentle press.
- Lists everywhere: added rows glide in; deleted rows collapse and the rows
  below slide up.
- Haptics: `tap()` on primary actions, `success()` on save, `warning()` on
  delete confirmation.

### Round 2 — Home and Insights

- Totals and balances use `RollingNumber`; changing the period rolls only the
  digits that changed.
- Period switch (Week/Month/Year/custom) uses `SlidingIndicator`.
- Bars and charts move from old value to new value on period change rather
  than regrowing from zero; line/area charts draw once on first arrival.
- Chart drilldown: the tapped category bar morphs into its detail panel.
- Hovering or tapping a chart segment brings it forward and dims the others.
- Budget progress changes colour at the moment the fill crosses 80 % / 100 %.

### Round 3 — Expenses and the Add Transaction form

- The Add button morphs into the Add Transaction popup (`MorphSurface`). Same
  single form everywhere, per the one-form decision.
- A transaction just added gets a brief evergreen tint that fades, so the user
  can see which row is new.
- Delete: row collapses, neighbours slide up, `warning()` haptic.
- Filter chips and tabs glide their highlight.

### Round 4 — Pending and scanning

**Scanner guard:** UI-only. No change to `emailScanner.ts`, `aiService.ts`,
`emailScanGates.ts`, `learningEngine.ts`, gate order, dedup, AI fallback,
rejection logging or approval rules. Owner confirms twice before this round
starts (standing rule for anything near the scanner).

- Approve: card glides out to the right, the Expenses count in the nav ticks up
  with `RollingNumber`, `success()` haptic.
- Reject: card glides out to the left.
- Mobile: `SwipeCard` — swipe right approves, left rejects. Buttons stay.
- Scan in progress: thin progress line plus a rolling count of emails checked;
  transactions found appear one at a time as results arrive, replacing the
  spinner. Driven only by progress the scanner already reports.

## Identity files updated alongside

- This commit: `PRODUCT.md` and `DESIGN.md` motion text and
  `plans/ui-overhaul-2026-09-05.md` motion rules are marked superseded by this
  document.
- Round 1 commit: `motion.ts` header rewritten; `DESIGN.md` Motion section
  rewritten to describe the kit as built; `ARCHITECTURE.md` lists new blocks and
  the temporary `/motion-lab` route.
- Final round: `/motion-lab` removed from code and `ARCHITECTURE.md`.

## Verification per round

- `npx tsc -b`, `npm test -- --run`, `npm run build`, lint on touched files
  against the baseline.
- Unit tests: `RollingNumber` lands on the exact formatted value and renders
  final value under reduced motion; `haptics.ts` no-ops on web; `SwipeCard`
  threshold decides approve/reject/return.
- Real browser check at phone width and desktop, including reduced motion
  emulated.
- Frame-rate spot check on a throttled CPU (Chrome 4× slowdown) for Home,
  Insights and a long Expenses list — no dropped-frame jank during animations.
- Native: `@capacitor/haptics` added, app rebuilt, haptics felt on a device
  (owner) — cannot be verified from this machine.
