# Intrack UI/UX Overhaul Plan

> Execution plan derived from a full-app design critique (score 22/40, snapshot at
> `.impeccable/critique/2026-07-17T15-18-08Z__src.md`). Written to be executed by
> Claude Sonnet phase-by-phase. **Read `PRODUCT.md` and `DESIGN.md` before every
> phase** — they define the "Calm & Trustworthy" register; the token system in
> `src/index.css` is the source of truth and is already good. The problem is the
> JSX layer contradicting it. Do not invent a new visual language.

## Ground rules for the executor

- One phase per session/branch. After each phase: `npm run build && npm run lint && npm run test` must pass. Verify visually in the dev server (`npm run dev`, port 5173) in BOTH light and dark mode and at 375px width.
- Never regress WCAG AA contrast. The zinc ramp inverts between modes — `text-zinc-50/300/400` are mode-safe; hardcoded hex or `static-*` colors are not.
- PRODUCT.md bans: gradient text, glow shadows, glassmorphism, decorative motion, neon mint. When you find these, remove — don't restyle.
- Keep diffs surgical. This is a live product; do not rewrite pages wholesale.

---

## Phase 1 — Kill trust-breakers (highest impact, small diff)

1. **Remove the fake security splash** in `src/layouts/AppLayout.tsx` (~lines 257–299 state/effect + 394–465 JSX). Delete the simulated progress bar and its narration ("Deploying local regex transaction scanners…"). If a first-run privacy explainer is worth keeping, replace with a single static dismissible card on the Dashboard (no timer, no fake verification), reusing the four reassurance bullets in plain language.
2. **Fix Pricing page copy** (`src/pages/PricingPage.tsx`): remove/replace "Verify Intrack Financial Security Plans" headline with "Simple, honest pricing"; remove the "🔒 Premium Subscription Required — Dashboard Access Restricted / ACCESS LOCKED" banner for signed-out visitors — replace with the trial framing used on the landing page ("14-day full trial, no card needed"). The pricing page and landing page must tell the same story.
3. **De-jargon copy app-wide**: replace "Zero-Trust Data Integrity Architecture", "RLS policies", "Supabase Isolation", "Financial Security Protocol", "Tester Feedback Engine" with plain language ("Your data stays on your device", "Only you can see your data"). Audience is mixed financial literacy (PRODUCT.md).
4. **Feedback FAB** (`AppLayout.tsx:948–955`): remove the always-on floating "Give Feedback" button. Move feedback to an item in the profile dropdown + Settings. Also delete the `md:pr-44` hack in the footer that existed to dodge it. This fixes the mobile z-collision with the bottom nav (`z-[40]` FAB under `z-50` nav).

**Acceptance**: first app open lands directly on Dashboard; pricing page has no lock-scare banner; no floating FAB; light+dark verified.

## Phase 2 — Typography & legibility floor

1. **Establish a minimum type size of 12px** in app UI. Sweep all `text-[6px]`–`text-[10px]` occurrences (≈100+; worst files: `AppLayout.tsx` ×29, `PendingPage.tsx` ×19, `PricingPage.tsx` ×13, `DashboardPage.tsx` ×12, `SupportPage.tsx` ×10) and promote: labels/captions → `text-xs` (12px), micro-badges → `text-[11px]` minimum. Landing-page simulation graphics (`src/pages/landing/InteractionSimulation.tsx`) may keep 10px only inside the decorative phone mock.
2. **Reduce uppercase-tracked labels**: 74 instances of `uppercase tracking-wide*`. Keep uppercase only for true section eyebrows/column headers (max one per card); convert button labels, nav items, and body-adjacent text to sentence case at normal tracking.
3. **Fix invisible placeholders**: `placeholder:text-zinc-600` (e.g. `ExpensesPage.tsx:133`) inverts to near-white in light mode. Use `placeholder:text-zinc-500` (tokenized, AA in both modes) everywhere; grep for `placeholder:text-zinc-6`/`placeholder:text-zinc-7`.
4. **Money figures**: ensure every currency amount uses the `.tnum` class (tabular figures, per DESIGN.md). Grep `formatCurrency(` call sites and wrap the rendering element.

**Acceptance**: `grep -rE 'text-\[(6|7|8|9|10)px\]' src` returns only landing-simulation files; all placeholders legible in light mode.

## Phase 3 — One component vocabulary

1. **Modals**: replace hand-rolled overlays with the shared `src/components/ui/Modal.tsx`:
   - ExpenseForm overlay in `ExpensesPage.tsx:206–224` (keep the mobile bottom-sheet behavior by extending Modal with a `sheet` variant if needed).
   - Feedback modal in `AppLayout.tsx` (after Phase 1 it opens from Settings).
   - Audit `AuthModal.tsx` for focus trap + Escape parity with Modal.
2. **Confirm dialogs**: replace all 7 native `confirm()`/`window.confirm()` calls (`ExpenseList.tsx:38,61`, `BudgetsPage.tsx:109`, `PendingPage.tsx:454`, `ProfilePage.tsx:118,146`, `SupportPage.tsx:130`) with a small shared `ConfirmDialog` built on Modal (danger variant button, states: default/loading).
3. **Buttons**: pages use three systems — `Button` component, `.sb-btn-*` CSS (marketing), and ad-hoc `className` buttons. Rule: app routes use `Button`; marketing routes use `.sb-btn-*`. Convert ad-hoc primary/secondary buttons in `AppLayout`, `DashboardPage`, `PendingPage`, `SettingsPage` to `Button`. Remove the `glow` prop and `.glow-button` CSS (banned glow shadows).
4. **Icons**: replace emoji-as-icon with lucide equivalents at consistent sizes: mobile bottom nav (🏠💳🔔✦ → Home, CreditCard, Bell, Sparkles in `AppLayout.tsx:1189–1274`), glyph buttons (▼ → ChevronDown, ✕ → X, ★ → Star), notification message prefixes (📬⚠️🔔💸🛡️ → drop from strings; type is already conveyed by the colored container). Category emojis in `CATEGORIES` may stay — they are content, not chrome.
5. **Z-index scale**: define semantic utilities in `index.css` (`--z-dropdown:30, --z-sticky:40, --z-overlay:50, --z-modal:60, --z-toast:70`) and replace `z-[9999]` (×5), `z-[100]`, `z-[40]` accordingly. CursorFollower is deleted in Phase 5.

**Acceptance**: zero native `confirm(` calls; zero `z-[9999]`; one modal implementation; mobile tab bar uses lucide icons.

## Phase 4 — Color-coding & token discipline

1. **Remove banned gradient/glow classes from JSX**: `.aurora-gradient-text` on money figures (`ExpensesPage.tsx:187,199` — income rendered as gradient text) → solid `text-[var(--status-positive-text)]`. Gradient logo text in `AppLayout.tsx:479` and `AuthLayout.tsx:32` → solid brand color ("Dhan" in `--brand-*` accent, "rakshak" in ink). Gradient submit button in the feedback form → `Button` primary. Then delete the now-unused `.aurora-*`, `.shimmer-text`, `.glow-*` rules from `index.css`.
2. **Side-tab borders (9×)**: remove `border-l-4` accent stripes on stat cards (`DashboardPage.tsx:859,875,891`, `ExpensesPage.tsx:185–197`, `PendingPage.tsx:877,882,948`). The status color already lives in the amount text + icon; use the plain Card with `border-border-subtle`.
3. **Semantic color audit**:
   - Total Expenses card uses warning-amber (`DashboardPage.tsx:875–887`) — expenses are neutral facts, not warnings. Use primary ink for the amount; reserve amber for budget-threshold states.
   - Fix detector hits "gray text on colored bg": `SettingsPage.tsx:566,893`, `SubscriptionsPage.tsx:512` (`text-zinc-500` near `bg-red-500` chips) — use `--status-danger-text` on `--status-danger-subtle`.
   - Replace raw Tailwind palette leaks (`text-red-400`, `bg-red-500`, `text-amber-400`, `emerald-*` in AppLayout nav/badges) with `--status-*` / `--brand-*` tokens so both themes stay AA.
4. **Hardcoded `text-white` sweep (80×)**: on brand-500 fills `text-white` is correct in light mode but the dark-mode primary fill is bright mint needing near-black text — use `text-[var(--btn-primary-fg)]` on primary fills; on plain surfaces use `text-text-primary`/`text-zinc-50`.
5. **Notification badge**: red dot on the bell (`AppLayout.tsx:576`) is color-only — add a count (like mobile already has) and an `sr-only` "N unread notifications".

**Acceptance**: detector re-run (`node ~/.claude/skills/impeccable/scripts/detect.mjs src`) reports 0 side-tab, 0 gradient-text, 0 gray-on-color findings; both themes AA.

## Phase 5 — Motion & performance

1. **Delete `CursorFollower`** (`src/components/ui/CursorFollower.tsx`, mounted in `App.tsx:171`) — a custom cursor is a banned invented affordance for a finance product and its springs run rAF continuously.
2. **Landing page motion diet** (`LandingPage.tsx` + `src/pages/landing/*`): remove orb drift (`.hero-orb-*`), hero card float, typewriter cursor, magnetic buttons, scramble text. Keep at most: one marquee (bank logos, add `aria-hidden="true"` to the duplicated half, respect reduced motion), scroll reveals, and the interactive SMS-parser demo (that one earns its motion). During testing the compositor was so busy that screenshot capture timed out — this is a real perf bug, not taste.
3. **Reduced motion for framer-motion**: the CSS `prefers-reduced-motion` block exists but framer-motion ignores it (0 uses of `useReducedMotion`). Wrap the app in `<MotionConfig reducedMotion="user">` in `App.tsx`.
4. **ScrollProgressBar**: keep only on long marketing/legal pages; unmount on app routes (product register: no decorative chrome).
5. Fix layout-property transitions flagged by the detector (`ScrollProgressBar.tsx:26`, `index.css:593` width transition → `transform: scaleX`).

**Acceptance**: no infinite animations on app routes; landing scrolls at 60fps; OS reduced-motion setting disables framer-motion animations.

## Phase 6 — Task-flow gaps (web + mobile)

1. **Month navigation on Expenses** (`ExpensesPage.tsx:27`): `currentMonth` has no setter. Add the same chevron month picker the Dashboard uses (extract it into `src/components/ui/MonthPicker.tsx` and reuse in both, and in Analytics if applicable).
2. **Notifications**: "Clear" (`AppLayout.tsx:590`) only empties local state; the 5-min cache repopulates it. Persist dismissal (e.g. store dismissed hash in localStorage) or relabel to "Hide". Make each notification a link to its page (pending → /pending, budget → /budgets, receivable → /dashboard).
3. **Touch targets**: enforce ≥44px on mobile for header icon buttons (bell/profile/hamburger are 32px), landing nav links, and list-row actions. Use padding, not larger icons.
4. **Desktop nav overflow**: the lg nav (`AppLayout.tsx:499`) uses `overflow-x-auto` — at 1024–1180px items silently clip. Either tighten labels ("Pending Alerts" → "Pending", "Pricing & Plans" → "Pricing") or collapse the tail into a "More" menu; no scrolling primary nav.
5. **Empty/first-run states**: verify every page has a teaching empty state (Dashboard has them; check Budgets, Subscriptions, Pending, Analytics) using `EmptyState` with one clear CTA.

**Acceptance**: user can view any past month on Expenses; cleared notifications stay cleared; no clipped nav at 1024px; all interactive targets ≥44px at 375px width.

## Phase 7 — Accessibility & polish pass

1. Sweep for icon-only buttons missing `aria-label` (54 labels exist; audit dropdown glyphs, close buttons, month chevrons, list actions).
2. Screen-reader announcements: toasts (`ToastContext`) should render in an `aria-live="polite"` region; sync progress and scan-complete states announced.
3. Keyboard: notification + profile dropdowns must close on Escape and trap/return focus; verify tab order through the mobile menu.
4. Forms: inline validation messages tied via `aria-describedby` (`ExpenseForm.tsx`, `AuthModal.tsx`, budget forms); errors must not clear user input.
5. Run a final `/impeccable critique` equivalent: re-run the detector, verify AA contrast on both themes, test at 375/768/1280, and update `DESIGN.md` if any token or component rules changed.

**Acceptance**: detector clean; keyboard-only walkthrough of add-expense, approve-pending, set-budget flows succeeds; score target ≥30/40 on re-critique.

---

## Suggested execution order & sizing

| Phase | Risk | Size | Branch name |
|-------|------|------|-------------|
| 1 Trust-breakers | Low | S | `ui/phase1-trust` |
| 2 Typography | Low | M | `ui/phase2-type` |
| 3 Components | Medium | L | `ui/phase3-components` |
| 4 Color | Medium | M | `ui/phase4-color` |
| 5 Motion/perf | Low | M | `ui/phase5-motion` |
| 6 Task flows | Medium | M | `ui/phase6-flows` |
| 7 A11y polish | Low | M | `ui/phase7-a11y` |

Phases 1, 2, 5 are independent and can go first in any order; 3 before 4 (component consolidation reduces the color-sweep surface); 6 and 7 last.
