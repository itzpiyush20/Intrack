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

Motion says *something changed* and nothing else. The three shapes in use:
a single indicator that travels between tabs (`layoutId`, spring 420/36), a panel
handing over to the next (180ms, `cubic-bezier(0.16, 1, 0.3, 1)`, 6px rise), and
list rows that fade in on arrival and slide out on removal. Every one is gated on
`useReducedMotion()` and collapses to `duration: 0`.

Restrained, state-conveying only: 150–250ms transitions, subtle fade/slide/scale
entrances, list stagger ≤0.24s. **Removed**: float, glow-pulse, aurora-drift,
button shimmer sweep, gradient-border hover (kept as neutralized no-ops so legacy
class references stay safe). `prefers-reduced-motion` collapses all of it.

## Retired (do not reintroduce)

Glassmorphism (`glass-card`, backdrop-blur as decoration), gradient text
(`aurora-gradient-text`), glow rings (`aurora-glow-ring`), ambient aurora blobs,
neon glow shadows, the bright-mint `#3ecf8e` everywhere-accent. The corresponding
utility classes still exist in `index.css` but are **neutralized** to the calm
system; prefer plain surface/border/brand tokens for new work.
