# Design

Visual system for Intrack — "Calm & Trustworthy". Source of truth is
`src/index.css` (CSS custom properties + Tailwind v4 `@theme`). This file is the
human summary; tokens in `index.css` win if they ever diverge.

## Theme

**Light only** (owner decision, 2026-08-25). Dark mode and the toggle are gone.

`:root` still defines the dark values and a `.light` class on `<html>` overrides
them — that structure is unchanged, because every `.light` rule inherits from the
`:root` defaults, so those defaults are not dead code. Light-only is implemented
by applying `.light` unconditionally (in the `index.html` head script, before
first paint) and removing every path that could take it off. Do not "simplify"
`index.css` by deleting the `:root` dark values.

The neutral text ramp (`--zinc-*`) **inverts** between modes: low index = primary
ink in both (light ink in dark mode, dark ink in light mode), so `text-zinc-50 /
300 / 400` are mode-safe for primary / secondary / muted text.

## Color

Strategy: **Restrained** — neutral surfaces + a single evergreen accent.

### Brand (evergreen — money/growth lineage, but deep and grown-up, not neon)
- Light: `--brand-500 #0e7a5d` (primary fill, white text 4.8:1), `--brand-600 #0b6549`,
  `--brand-700 #0a5640` (accent text on white, 6.9:1).
- Dark: `--brand-400 #2fc09a` (accent text/icons), `--brand-500 #138a6c` (fill).

### Primary button (per-mode tokens for AA in both themes)
- Light: deep green `#0e7a5d` + **white** text.
- Dark: vivid `#2fc09a` + **near-black** `#07130e` text (~9:1).
- Tokens: `--btn-primary-bg / -hover / -active / -fg`.

### Surfaces
- Dark: canvas `#0f1115`, card `#161920`, elevated `#1d212a`, sunken `#0c0e12`.
- Light: canvas `#f7f8fa`, card `#ffffff`, elevated `#f1f3f6`, sunken `#e9ecf1`.
- Borders: `--border-subtle / -default / -hover` (hairlines; rgba-white in dark,
  cool grays in light).

### Semantic status (income vs expense vs alerts — never colour-only)
`--status-positive` (green), `--status-danger` (red), `--status-warning` (amber),
`--status-info` (blue). Each has `-text / -subtle / -border / -icon`, tuned per mode
for AA. Expense/over-budget red is preserved for WCAG-critical meaning.

### Marketing tokens (`--sb-*`)
Re-skinned onto the same system so landing/pricing/legal pages adapt light↔dark.
`sb-canvas`, `sb-ink`, `sb-primary`, `sb-card-light`, `sb-btn-primary`, etc.

## Typography

One family: **Inter** with a system fallback stack (`-apple-system, Segoe UI,
Roboto, system-ui`). Zero-dependency, fast, trustworthy. Tabular figures via
`.tnum` (and `tnum`/`ss01`/`cv05` features) for money columns.

- Product UI: fixed rem scale, ~1.2 ratio, headings `font-weight: 650`,
  `letter-spacing: -0.018em`, `text-wrap: balance` on headings, `pretty` on prose.
- Marketing display: `sb-display-*` with `clamp()` (max ~60px), tighter tracking.

## Components

Solid surfaces, hairline borders, soft **neutral** shadows (`--shadow-sm/md/lg` —
no coloured glow). Single card shape (`rounded-2xl`, `border`, `bg-surface-1`); no
nested cards. Inputs/Selects: `bg-surface-1`, `border-default`, brand focus ring
(`ring-brand-500/30`). Every interactive element has hover/focus/active/disabled.
Badges use semantic status tokens. Empty states use a neutral icon tile.

**Form controls are always the shared `Input` / `Select`.** Both render their own
wrapper `div` and pass `className` to the control inside it, so any flex or grid
sizing (`flex-1`, `col-span-2`) must go on a wrapper you add — putting it on the
component styles the `<input>` and does nothing to the layout. Hand-rolled
`<select>` elements are drift: they carried a different focus ring
(`ring-1 brand-400`) for a year before anyone noticed.

**Icon-only row actions** (edit / archive / delete) come from `ACTION_BUTTON` and
`ACTION_BUTTON_DANGER` in `components/ui/styles.ts`. 44px on touch, 36px from
`md` up, `rounded-lg`, with a focus ring in the recipe. Before it existed,
Settings alone had three sizes and three hover colours — and the first version
of the recipe was 36px everywhere, under the WCAG touch minimum, which every
screen then overrode at the call site. When call sites all override the same
thing, the recipe is what's wrong.

**Body copy in app UI is `text-sm`; `text-xs` is for field labels, metadata and
badges only.** Settings was 12px throughout and read as small print.

**Section navigation** (Settings) is a left rail from `md` up — `md:w-52`,
`md:sticky md:top-20` to clear the 64px app header — and a horizontally scrolling
pill strip below it, bleeding to the viewport edge with `-mx-4 px-4 sm:-mx-6
sm:px-6` so it reads as scrollable.

## Motion

Direction (owner, 2026-09-16/17; full design in
`docs/superpowers/specs/2026-09-16-app-motion-design.md`): subtle, smooth glide,
**no bounce or overshoot**, used only where it helps the screen, and never
slower. Animate `transform` and `opacity` (plus framer `layout` for morphs).

**Tokens** (`src/components/ui/motion.ts`): curve `cubic-bezier(0.33, 1, 0.68, 1)`
("Softer", picked in `/motion-lab`), durations `GLIDE` — `fast` 0.22s, `base`
0.33s, `slow` 0.55s, `figure` 0.88s — and `glide(reduce, duration)`. The older
names `EASE_OUT`, `DURATION`, `INDICATOR_SPRING`, `transition()` and the
variants point at the same values, so every screen moves alike. The three CSS
entrance classes in `index.css` (`animate-fade-in`, `-slide-up`, `-scale-up`)
use the same curve. A test in `motion.test.ts` fails if a signed-in screen
hand-types the old curve or a spring.

**In place across the signed-in app:** page changes rise 8px (transform only —
see the note in `App.tsx`); popups rise and fade in, drop and fade out; the
active nav item carries a highlight (`layoutId`) in the desktop sidebar and the
mobile bottom bar — each page mounts its own `AppLayout`, so after a lazy route
load the highlight may simply appear rather than travel;
buttons and tappable cards press to 97%; list rows glide in and slide out,
neighbours closing up via `layout`.

**Home and Insights:** money totals use `RollingNumber` (only changed digits
roll; screen readers get the exact figure); the date filter's Month/Custom
highlight slides (`SlidingIndicator`); bars glide from the old value to the new
one; the budget burn-down line, balance-score ring and cash-flow runway draw in
once on arrival; hovering a bar or category row dims its siblings (pointer
devices only, via `[@media(hover:hover)]`). Block waiting for a later round:
`MorphSurface`.

**Expenses and the Add form:** every Add Transaction button opens the one form
from where the button sits — `Modal`'s optional `origin` (viewport px, from
`openAddTransaction(button)` / `centreOf`) makes the panel grow from 92 % to
full size with its transform-origin on that point, over `GLIDE.slow`, and close
back toward it over `GLIDE.fast`. A bottom sheet on a phone keeps the plain
rise, since scaling would lift it off the screen edge; edit keeps the rise too.
Under reduced motion the popup only fades. On Expenses, the row just added or
edited carries an evergreen wash (`bg-brand-500/10`, behind the row content)
that fades over 1.2s after a short beat; it is opacity only, so it stays under
reduced motion without the beat. Deleting a row removes it as soon as the
delete succeeds; it slides out and its neighbours close up via `layout`.
Refetches after a save, delete, import or split keep the rows on screen rather
than flashing the skeleton, which is what used to make the list jump.

**Pending:** each review card sits in a `SwipeCard`. Approve glides the card
off to the right, Reject to the left (`GLIDE.slow`), and its neighbours close
up at the same time (`AnimatePresence mode="popLayout"` plus `layout`); an
Undo inside that glide brings the same card back, and after it the card rises
back in at the top. "Approve all" and bulk approve/reject glide their rows off
to the matching side. The card's Approve/Reject buttons run through the swipe
itself and are disabled while the card leaves. Swiping is on only for a
coarse pointer (`useCoarsePointer`): with a mouse, dragging inside a card
selects text; buttons work everywhere, and drag never starts from a field,
select or text box (framer-motion's own rule). Every approve and reject goes
through one ledger (`src/pages/pendingActions.ts`), so a row is acted on once
— a second swipe, tap or "Approve all" on it is ignored and the card glides
back. While a scan runs, a 2px line under the Scan button grows from the left
(`scaleX`) through the phases the scanner already reports, never backwards,
and the first number in its status text rolls (`RollingNumber`). Found
transactions still arrive together when the scan ends — the page only gets
them then — so the list rises in once, each card a beat behind (first 12
cards, 0.24s total).

Under `prefers-reduced-motion` movement collapses to `duration: 0`. Marketing
pages (landing, pricing, about) keep their own motion and are outside this brief.

## Retired (do not reintroduce)

Glassmorphism (`glass-card`, backdrop-blur as decoration), gradient text
(`aurora-gradient-text`), glow rings (`aurora-glow-ring`), ambient aurora blobs,
neon glow shadows, the bright-mint `#3ecf8e` everywhere-accent. The corresponding
utility classes still exist in `index.css` but are **neutralized** to the calm
system; prefer plain surface/border/brand tokens for new work.
