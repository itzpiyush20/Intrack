# Full-app UI/UX overhaul — agent brief

Owner asked for a complete makeover of every screen except Settings (already done
2026-09-05), executed by parallel agents. This is the contract every agent works to.
Read it fully before touching a file.

## What "done" means

The bar is the Settings page, rebuilt earlier today — read
`src/pages/SettingsPage.tsx` and `src/components/settings/CardManager.tsx` first;
they are the reference implementation, not just an example.

A screen is finished when a person fluent in Linear, Stripe or Notion would sit
down at it and trust it. Not "it has animations now".

## Owner's decisions (2026-09-05) — do not relitigate

1. **Marketing pages get a distinct brand voice inside the same palette.** Real
   editorial confidence — display type, asymmetric layout, a hero that is not a
   centred headline over a screenshot — while staying inside the evergreen palette
   and the restraint `PRODUCT.md` defines. App UI stays quietly functional.
2. **PendingPage: restyle only, zero logic changes.** Visual, layout, states,
   motion. Nothing that touches gates, dedup, the AI fallback, approval, or what a
   transaction becomes. See the invariants in `CLAUDE.md`.
3. **In scope:** admin pages, UX copy rewriting, structural changes to page
   composition, and loading/empty states everywhere.
4. **Untouchable this pass:** `src/pages/SettingsPage.tsx`,
   `src/components/settings/**`, `src/pages/RefundPage.tsx`,
   `src/pages/TermsPage.tsx`. The last two have uncommitted owner edits in the
   working tree; editing them would tangle two diffs.

## The system you are building in

`DESIGN.md` and `PRODUCT.md` at the repo root are authoritative. The short version:

- **Light only.** Never edit `src/index.css`. Never reintroduce a theme toggle.
- **Restrained colour:** neutral surfaces, one evergreen accent for primary
  actions, current selection and state. Not decoration.
- **Tokens, never hex.** `surface-0/1/2/3`, `border-subtle/default/hover`,
  `zinc-*` (the ramp inverts, so `zinc-50/100` is primary ink, `400` is muted),
  `brand-400/500`, and `--status-positive|danger|warning|info-{text,subtle,border}`.
- **Body copy is `text-sm`.** `text-xs` is for field labels, metadata and badges
  only. This was the single biggest thing making Settings look a decade old.
- **Money uses `.tnum`** (tabular figures) — always, everywhere.
- **One family, Inter**, fixed rem scale. No display fonts in UI labels.

### Shared primitives — use these, do not reinvent

From `@/components/ui`:

- `Card`, `Button` (primary/secondary/ghost/danger), `Input`, `Select`, `Badge`,
  `Modal`, `ConfirmDialog`, `EmptyState`, `Skeleton`, `PageSkeleton`.
- `ACTION_BUTTON` / `ACTION_BUTTON_DANGER` — icon-only row actions.
- `ROW_TILE` — a row inside a section card. `SECTION_LABEL` — the small caps label.
- Motion vocabulary: `transition`, `panelVariants`, `rowVariants`,
  `staggerParent`, `staggerChild`, `INDICATOR_SPRING`, `EASE_OUT`, `DURATION`.

**The `Input`/`Select` trap:** both render their own wrapper `div` and pass
`className` to the control inside it. Any flex or grid sizing (`flex-1`,
`col-span-2`) must go on a wrapper you add, or it styles the `<input>` and does
nothing to the layout. This has bitten twice already.

## Motion rules

`framer-motion` is a dependency. Motion reports that **something changed** —
nothing decorates. Use the shared variants so every screen moves identically:

```tsx
const reduce = useReducedMotion()
<motion.li variants={rowVariants(reduce)} initial="initial" animate="animate" exit="exit"
           transition={transition(reduce)} />
```

Every animation must collapse under `useReducedMotion()`. **Banned** (all were
tried and rejected — see `DESIGN.md` "Retired"): glassmorphism, backdrop-blur as
decoration, gradient text, glow rings, aurora blobs, bounce/elastic easing,
orchestrated page-load choreography, animated section reveals that gate content
visibility.

## Responsive rules

The owner asked specifically that everything adapt to any device.

- Mobile-first. Every screen must work at **360px** wide with no horizontal
  scroll on `body`. Wide content (tables, charts, code) scrolls inside its own
  `overflow-x-auto` container.
- Breakpoints in use: `sm:640 md:768 lg:1024 xl:1280`. The app shell has a 64px
  sticky header and a mobile bottom nav — content already carries `pb-28 lg:pb-6`
  from `AppLayout`; do not fight it.
- Touch targets ≥44px on mobile. `h-11` is the house input height.
- Grids: `repeat(auto-fit, minmax(280px, 1fr))` or explicit breakpoint columns.
  Never a fixed multi-column grid that cannot collapse.
- Test the real copy at every width — headings overflow at tablet more than
  anywhere else.

## Accessibility (non-negotiable, WCAG 2.1 AA)

Body text ≥4.5:1, large/bold ≥3:1, **placeholders too**. Visible focus rings on
everything interactive (`focus-visible:ring-2 focus-visible:ring-brand-500/40`).
Status never by colour alone — pair with an icon or a word. Real `<button>` and
`<label>` elements; `aria-label` on every icon-only control. Lists are `<ul>/<li>`
— and a `<p>` is not valid inside a `<ul>`.

## Hard rules for parallel work

Agents run concurrently in **one shared working tree**. Collisions are the main
risk, so:

1. **Edit only the files your assignment names.** If you believe a file outside
   your list needs changing, report it — do not edit it.
2. **Never edit** `src/components/ui/**`, `src/index.css`, `src/App.tsx`,
   `src/services/**`, `src/context/**`, `tailwind.config.*`, or any `*.test.ts`.
   Those are shared or out of scope. Need a new shared primitive? Build it locally
   in your own file and say so in your report; it gets promoted afterwards.
3. **No behaviour changes.** No touching data fetching, state logic, services,
   auth, payments, or the scanner. Rewriting user-visible copy is in scope;
   changing what code does is not.
4. **Do not run** `npm run build`, `npm test`, or `npx tsc -b` — they write shared
   output (`dist/`, `node_modules/.tmp/*.tsbuildinfo`) and would fight each other.
   Verify with `npx eslint <your files>` only. The main session runs the full
   build, type-check and test suite once every agent is done.
5. **Do not commit, stage, stash, or run any git command that writes.** The main
   session owns the commit.
6. **Lint must not regress.** The repo has a documented baseline of
   `@typescript-eslint/no-explicit-any` and `set-state-in-effect` errors. Do not
   add new ones; you are not required to fix old ones.

## Reporting back

Return: files changed, what changed on each screen and why, anything you found but
did not fix (with the file and line), any shared primitive you had to inline, and
anything you could not verify.
