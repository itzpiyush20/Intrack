# App motion — design

Date: 2026-09-16. Status: approved by owner. Motion kit and `/motion-lab` shipped 2026-09-16; speed and curve tuned 2026-09-17; Rounds 1–2 shipped 2026-09-17; rounds 3–4 not started.

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
- **Haptics: dropped** (2026-09-17). Intrack is a website only; web vibration
  would reach Android Chrome but never iPhones. Revisit if a phone app is built.
- **Test page first**, then a phased rollout.

## Hard limits (from the brief, not from the old rules)

1. **Never slower.** Animate `transform` and `opacity` only, plus framer-motion
   `layout` for morphs. No `filter`, `backdrop-filter`, blur or animated
   shadows/box sizes in the native build. No animation blocks input: a tap
   during an animation acts immediately. Long lists (> ~12 rows) animate only
   the rows on screen on first paint.
2. **Durations:** 200–350 ms for interface feedback, up to ~900 ms for figures
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

- Standard ease: `cubic-bezier(0.33, 1, 0.68, 1)` — "Softer", picked by the owner
  in `/motion-lab` on 2026-09-17. No overshoot anywhere.
- Durations (owner picked 1.1x the first draft): `fast` 0.22 s, `base` 0.33 s,
  `slow` 0.55 s, `figure` 0.88 s.
- Presets: press (scale to 0.97 and back), page rise, row enter, row exit,
  collapse-on-delete, new-row tint, panel swap.
- Every preset takes the `useReducedMotion()` result, as today.

New building blocks in `src/components/ui/`:

| Block | What the user sees |
|---|---|
| `RollingNumber` | Each digit rolls in its own slot to the new amount; digits that didn't change stay still. Tabular figures so width never jumps. Replaced `AnimatedNumber` (deleted in Round 2). |
| `MorphSurface` | A button grows smoothly into the panel or form it opens, and shrinks back on close (framer `layoutId`). |
| `SlidingIndicator` | The highlight on the nav or a tab strip glides to the tapped item. |
| `SwipeCard` | Drag a card sideways; past a threshold it glides away, otherwise it glides back. Buttons remain for keyboard and screen-reader users. |

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

### Round 2 — Home and Insights

- Totals and balances use `RollingNumber`; changing the period rolls only the
  digits that changed.
- Period switch uses `SlidingIndicator` — done on the date filter's Month/Custom
  tabs. The Insights range picker is a native `<select>`, which has no
  highlight to slide, so it is left as is.
- Bars and charts move from old value to new value on period change rather
  than regrowing from zero; line/area charts draw once on first arrival.
- Hovering a bar or category row dims the others (pointer devices only).
- **Dropped when built (2026-09-17):** the drilldown morph — the detail opens as
  a tall bottom sheet, and a thin bar stretched into it reads as distortion,
  not continuity; the sheet already rises with the Round 1 popup motion. The
  80 %/100 % budget colour change — Home and Insights have no spent-vs-limit
  bars (those are on Budgets, which gets the shared basics only).

### Round 3 — Expenses and the Add Transaction form

- The Add button morphs into the Add Transaction popup (`MorphSurface`). Same
  single form everywhere, per the one-form decision.
- A transaction just added gets a brief evergreen tint that fades, so the user
  can see which row is new.
- Delete: row collapses, neighbours slide up.
- Filter chips and tabs glide their highlight.

### Round 4 — Pending and scanning

**Scanner guard:** UI-only. No change to `emailScanner.ts`, `aiService.ts`,
`emailScanGates.ts`, `learningEngine.ts`, gate order, dedup, AI fallback,
rejection logging or approval rules. Owner confirms twice before this round
starts (standing rule for anything near the scanner).

- Approve: card glides out to the right, the Expenses count in the nav ticks up
  with `RollingNumber`.
- Reject: card glides out to the left.
- Mobile: `SwipeCard` — swipe right approves, left rejects. Buttons stay.
  Before wiring it in: `handleApproveWithUndo` (and reject) must ignore a
  transaction id that already has a timer in `pendingCommitTimers`, so a swipe
  and "Approve all" cannot both act on one row; approve/reject callbacks should
  return `false` on failure so the card glides back; check on a real phone that
  a drifting tap on a card button is not read as a swipe.
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
  final value under reduced motion; `SwipeCard`
  threshold decides approve/reject/return.
- Real browser check at phone width and desktop, including reduced motion
  emulated.
- Frame-rate spot check on a throttled CPU (Chrome 4× slowdown) for Home,
  Insights and a long Expenses list — no dropped-frame jank during animations.
