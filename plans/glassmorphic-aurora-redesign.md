# Intrack — Glassmorphic Aurora Redesign
**Design:** C — Glassmorphic Aurora (user-selected)
**Goal:** Multi-color aurora gradients (emerald #3ecf8e + indigo #6366f1 + cyan #38bdf8), frosted-glass cards, gradient text headings, animated aurora backgrounds across the whole site.
**Constraint:** Visual changes only. All functionality preserved. WCAG 2.1 AA maintained. Works in dark + light mode.

---

## Phase 0 — Documentation Discovery (COMPLETE)

### Allowed APIs & Patterns

**Files consulted:**
- `src/index.css` — existing CSS token system, animation library, utility classes
- `src/components/ui/Card.tsx` — props: `noPadding`, `hoverable`, `glow`
- `src/components/ui/Button.tsx` — variants: `primary|secondary|ghost|danger`, sizes: `sm|md|lg`
- `src/components/ui/Input.tsx` — props: `label`, `error`, `icon`
- `src/components/ui/Select.tsx` — props: `label`, `error`, `options`, `placeholder`
- `src/components/ui/Badge.tsx` — variants: `default|success|warning|danger|info`
- `src/components/ui/EmptyState.tsx` — props: `icon`, `title`, `description`, `action`
- `src/layouts/AppLayout.tsx` — already uses `glass-premium`, `aurora-bg`, `nav-active-indicator`
- `src/components/auth/AuthModal.tsx` — glass modal, gradient logo, tab switcher
- `src/pages/LandingPage.tsx` — uses Supabaze `sb-*` design system (separate from app dark system)

**Existing utilities in index.css (do not recreate):**
- `.aurora-bg` — ambient radial glow (emerald + cyan only; needs indigo added)
- `.glass-premium` — 24px blur + 180% saturate
- `.btn-shimmer` — sweep animation on hover
- `.gradient-border-card` — hover gradient border via `::after`
- `.glow-text-brand` — emerald text shadow
- `.nav-active-indicator` — glowing underline
- `.animate-float`, `.animate-glow-pulse`, `.stagger-1..8`
- Keyframes: `fade-in`, `slide-up`, `scale-up`, `float`, `glow-pulse`, `sweep`, `shimmer`, `aurora-shift`, `spin-slow`

**Gaps to fill:**
- No `--aurora-indigo` or `--aurora-cyan` CSS variables
- No `.aurora-gradient-text` utility (tri-color gradient heading text)
- No `.glass-card` CSS class (frosted surface for non-Card-component elements)
- No `.aurora-glow-ring` (tri-color glowing border ring)
- `aurora-bg` only uses emerald+cyan; needs indigo third gradient
- `gradient-border-card::after` only uses emerald; needs tri-color
- LandingPage `sb-canvas` is pure white/dark; needs aurora treatment

**Anti-patterns (do not do):**
- Do NOT change prop signatures of Card/Button/Input/Select — only className strings
- Do NOT change any TypeScript logic, service calls, or state management
- Do NOT use `!important` overrides on status semantic colors (WCAG-critical)
- Do NOT add inline `style` aurora gradients to every element — use CSS classes
- Do NOT break the `.light` class overrides — light mode must still work

---

## Phase 1 — CSS Foundation (`src/index.css`)

**Goal:** Extend the token system with indigo/cyan aurora variables and add missing utility classes.

**File:** `C:\Users\itzpi\AppData\Local\Temp\dhanrakhshak_deploy\src\index.css`

### Tasks

**1.1 Add aurora accent CSS variables** to `:root` (dark mode) and `.light`:
```css
/* in :root */
--aurora-indigo: #6366f1;
--aurora-cyan: #38bdf8;
--aurora-purple: #a78bfa;
--aurora-indigo-subtle: rgba(99, 102, 241, 0.12);
--aurora-cyan-subtle: rgba(56, 189, 248, 0.10);
```

**1.2 Update `@theme`** to expose aurora colors as Tailwind utilities:
```css
--color-aurora-indigo: var(--aurora-indigo);
--color-aurora-cyan: var(--aurora-cyan);
--color-aurora-purple: var(--aurora-purple);
```

**1.3 Update `.aurora-bg::before`** — add indigo as the third gradient point (currently only emerald + cyan):
```css
radial-gradient(ellipse 70% 50% at 15% 25%,  rgba(62, 207, 142, 0.05) 0%, transparent 100%),
radial-gradient(ellipse 50% 40% at 85% 70%,  rgba(99, 102, 241, 0.06) 0%, transparent 100%),
radial-gradient(ellipse 40% 35% at 50% 100%, rgba(56, 189, 248, 0.04) 0%, transparent 100%);
```

**1.4 Update `.gradient-border-card::after`** — tri-color gradient:
```css
background: linear-gradient(135deg,
  rgba(62, 207, 142, 0.40) 0%,
  rgba(99, 102, 241, 0.25) 50%,
  rgba(56, 189, 248, 0.20) 100%
);
```

**1.5 Add new utility classes:**

`.aurora-gradient-text` — tri-color gradient heading text:
```css
.aurora-gradient-text {
  background: linear-gradient(135deg, #3ecf8e 0%, #818cf8 50%, #38bdf8 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.light .aurora-gradient-text {
  background: linear-gradient(135deg, #059669 0%, #4f46e5 50%, #0284c7 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```

`.glass-card` — frosted glass surface for non-Card JSX elements:
```css
.glass-card {
  background: rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(20px) saturate(150%);
  -webkit-backdrop-filter: blur(20px) saturate(150%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
}
.light .glass-card {
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
```

`.aurora-glow-ring` — tri-color glow border for featured cards:
```css
.aurora-glow-ring {
  box-shadow:
    0 0 0 1px rgba(62, 207, 142, 0.30),
    0 0 20px rgba(62, 207, 142, 0.12),
    0 0 40px rgba(99, 102, 241, 0.08);
}
```

`.aurora-progress` — gradient fill for progress bars:
```css
.aurora-progress-fill {
  background: linear-gradient(90deg, #3ecf8e 0%, #6366f1 60%, #38bdf8 100%);
  border-radius: 99px;
  transition: width 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}
```

**1.6 Update sb-canvas colors** for the landing page aurora treatment:
```css
/* in :root */
--sb-canvas: #0a0a14;
--sb-canvas-soft: #0e0e1c;
/* sb-ink stays light for readability */
```

**1.7 Add `@keyframes aurora-animate`** for slow drifting aurora background:
```css
@keyframes aurora-drift {
  0%, 100% { transform: translateX(0) translateY(0) scale(1); }
  33%       { transform: translateX(2%) translateY(-1%) scale(1.01); }
  66%       { transform: translateX(-1%) translateY(2%) scale(0.99); }
}
.animate-aurora-drift {
  animation: aurora-drift 12s ease-in-out infinite;
}
```

### Verification
- `grep -n 'aurora-indigo\|aurora-cyan\|aurora-gradient-text\|glass-card\|aurora-glow-ring\|aurora-progress' src/index.css` — all must exist
- Visually: dark mode body background should have 3-color aurora glow; gradient-border cards show tri-color on hover

---

## Phase 2 — Core UI Components

**Goal:** Update Card, Button, Input, Select, Badge, EmptyState for glassmorphic aurora aesthetic.

### 2.1 `src/components/ui/Card.tsx`

**Changes:**
- Base shadow: add subtle aurora glow — `shadow-[0_4px_24px_rgba(0,0,0,0.22),0_0_0_1px_rgba(99,102,241,0.04)]`
- Base bg: `bg-surface-1/90` (slight transparency for glass feel)
- Hoverable: tri-color glow — `hover:shadow-[0_16px_48px_rgba(0,0,0,0.28),0_0_0_1px_rgba(62,207,142,0.15),0_0_60px_rgba(99,102,241,0.08)]`
- Default `glow` to `true` — add `gradient-border-card` to all cards by default

**Pattern to follow:** existing `Card.tsx` at `src/components/ui/Card.tsx`

### 2.2 `src/components/ui/Button.tsx`

**Primary variant changes:**
- Gradient: `from-[#3ecf8e] via-[#6366f1] to-[#38bdf8]` (tri-color aurora)
- Or keep emerald→teal gradient but add indigo glow shadow
- Glow shadow: `shadow-[0_4px_18px_rgba(62,207,142,0.25),0_2px_12px_rgba(99,102,241,0.15)]`
- Hover glow: enhanced with indigo component

**Secondary variant changes:**
- Add `backdrop-blur-sm` for glass feel
- `bg-white/5 border-white/10` in dark mode

**Pattern:** existing `Button.tsx`

### 2.3 `src/components/ui/Input.tsx`

**Changes:**
- Base: `bg-white/5 backdrop-blur-sm border-white/10` (glass surface in dark)
- Focus ring: `focus:ring-[rgba(99,102,241,0.35)] focus:border-aurora-indigo/60`
- Label color: `text-zinc-300` → `text-zinc-400` (slightly softer)

### 2.4 `src/components/ui/Select.tsx`

Same glass treatment as Input. Focus ring with indigo.

### 2.5 `src/components/ui/Badge.tsx`

Add `aurora` variant:
```typescript
aurora: 'bg-gradient-to-r from-brand-500/15 to-aurora-indigo/15 border-brand-400/25 text-brand-300'
```

### 2.6 `src/components/ui/EmptyState.tsx`

- Icon container: replace `bg-brand-500/10 border-brand-500/25` with tri-color aurora
  ```
  bg-gradient-to-br from-brand-500/15 to-aurora-indigo/15 border-brand-400/20
  shadow-[0_0_20px_rgba(62,207,142,0.10),0_0_40px_rgba(99,102,241,0.06)]
  ```
- Icon glow: add `glow-text-brand` on icon text

### Verification
- Visual: cards should show frosted glass with tri-color border glow on hover
- Buttons should shimmer and glow with indigo shadow
- `grep -n 'aurora-indigo\|aurora-glow-ring\|glass-card' src/components/ui/*.tsx` — patterns referenced correctly

---

## Phase 3 — App Shell (`src/layouts/AppLayout.tsx`)

**Goal:** Full aurora upgrade for navigation, mobile nav, security splash, FAB.

### 3.1 Header

Already has `glass-premium`. Add tri-color bottom border:
- Replace `shadow-[0_1px_0_rgba(62,207,142,0.08)...]` with:
  `shadow-[0_1px_0_rgba(99,102,241,0.10),0_4px_32px_rgba(0,0,0,0.30)]`
- Logo: add `shadow-[0_0_16px_rgba(62,207,142,0.5),0_0_32px_rgba(99,102,241,0.25)]`

### 3.2 Active Nav Indicator

Current: `.nav-active-indicator` (emerald underline). Update CSS class in index.css:
```css
.nav-active-indicator::after {
  background: linear-gradient(90deg, #3ecf8e, #818cf8, #38bdf8);
  box-shadow: 0 0 8px rgba(99, 102, 241, 0.4), 0 0 16px rgba(62, 207, 142, 0.3);
}
```

### 3.3 Security Splash Overlay

Current: plain dark `#09090b` background. New: full aurora:
- Background: `bg-gradient-to-br from-[#07070f] via-[#0a0a18] to-[#050d12]`
- Add aurora radial glows behind the card (position: absolute, pointer-events: none)
- Progress bar: tri-color `from-brand-500 via-aurora-indigo to-aurora-cyan`
- Entry button: tri-color aurora gradient

### 3.4 Mobile Bottom Nav

Current: `bg-surface-0/95 backdrop-blur-xl`. Enhance:
- Background: `bg-[rgba(10,10,20,0.85)] backdrop-blur-2xl`
- Active tab: add aurora glow dot + gradient text
- Border: gradient `border-t-0` replace with gradient line using `::before`

### 3.5 FAB (Floating Action Button)

Current: emerald gradient. Add indigo to make tri-color:
- `from-brand-500 via-[#6366f1] to-[#38bdf8]`
- Shadow: `shadow-[0_4px_20px_rgba(62,207,142,0.30),0_0_40px_rgba(99,102,241,0.15)]`

### Verification
- Active nav link has tri-color underline glow
- Security splash has aurora gradient behind card
- Mobile bottom nav active tab glows aurora color
- FAB has tri-color gradient

---

## Phase 4 — Landing Page (`src/pages/LandingPage.tsx`)

**Goal:** Full aurora dark redesign. This is the most impactful change.

### 4.1 Page Background

- Remove `bg-sb-canvas` (white/light) from page root
- Add deep midnight dark with aurora: `bg-[#07070f]` or `aurora-bg bg-[#07070f]`
- Add fixed decorative aurora blobs (absolutely positioned, pointer-events-none):
  ```jsx
  <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
    <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-brand-500/8 blur-[120px] animate-aurora-drift" />
    <div className="absolute top-[30%] right-[-10%] w-[500px] h-[500px] rounded-full bg-aurora-indigo/8 blur-[100px] animate-aurora-drift" style={{animationDelay: '4s'}} />
    <div className="absolute bottom-[-10%] left-[30%] w-[400px] h-[400px] rounded-full bg-aurora-cyan/6 blur-[90px] animate-aurora-drift" style={{animationDelay: '8s'}} />
  </div>
  ```

### 4.2 Navbar

Current: `bg-sb-canvas border-sb-hairline`. New:
- `bg-[rgba(7,7,15,0.7)] backdrop-blur-2xl border-b border-white/8`
- Logo: add `shadow-[0_0_16px_rgba(62,207,142,0.5)]`
- Nav links: `text-zinc-400 hover:text-white`
- CTA button: use `.sb-btn-primary` with `aurora-glow-ring`

### 4.3 Hero Section

Current: `sb-display-xl` text on `bg-sb-canvas`. New:
- Heading: apply `aurora-gradient-text` to key words
- Badge: glass pill with aurora glow
- Sub-headline: `text-zinc-400`
- CTA buttons: primary gets aurora gradient, secondary gets glass style
- Right panel (InteractionSimulation): wrap in `glass-card` with aurora glow ring

### 4.4 Section Backgrounds

- Daily Life section: `glass-card` cards instead of `sb-card-light`
- Features section: dark glass cards
- Trust/Security card: `aurora-glow-ring glass-card`
- Install section: dark bg with glass cards
- FAQ section: dark bg, glass accordion items
- Final CTA: `aurora-bg` with gradient heading and glass button
- Footer: dark background, subtle aurora brand color for links

### 4.5 Update `sb-*` canvas variables in index.css to dark aurora

(Already handled in Phase 1.6)

### Verification
- Landing page has dark aurora background (not white)
- Hero heading uses tri-color gradient text
- All cards use glass effect with backdrop-blur
- `grep 'bg-sb-canvas[^-]' src/pages/LandingPage.tsx` — should be 0 (all replaced)

---

## Phase 5 — App Pages

**Note:** Phase 2 (Card/Button upgrades) already propagates glassmorphic style to all app pages. This phase handles page-specific aurora enhancements.

### 5.1 `src/pages/DashboardPage.tsx`

- Stat cards: already use `<Card>` — inherits from Phase 2
- Category breakdown progress bars: replace inline `bg-brand-500` fill with `aurora-progress-fill`
- Month selector: wrap in `glass-card` pill
- Security splash (in AppLayout): handled in Phase 3.3

### 5.2 `src/pages/BudgetsPage.tsx`

- Progress bar fills: replace `bg-brand-500` with `aurora-progress-fill` CSS class
- Budget form: input/select inherit from Phase 2.3/2.4
- Over-budget bar: keep `bg-red-500` (semantic, WCAG-required)

### 5.3 `src/pages/ExpensesPage.tsx`

- Quick stats cards: inherit from Phase 2
- Search + filter bar inputs: inherit from Phase 2.3
- Stats numbers: add `aurora-gradient-text` to income/net values

### 5.4 `src/pages/PendingPage.tsx`

- Alert review modal: backdrop already `glass-premium`; add aurora border
- Auto-categorization review card: `aurora-glow-ring` on the modal inner panel

### 5.5 `src/pages/SubscriptionsPage.tsx`

- Subscription cards: inherit from Phase 2
- Status badge (active/expired): uses Badge component — inherits

### Verification
- `grep -rn 'bg-brand-500\b' src/pages/BudgetsPage.tsx` — progress bars use `aurora-progress-fill`
- Dashboard category bars have gradient fill
- App pages have consistent aurora glassmorphic card style

---

## Phase 6 — Marketing Pages + Auth

### 6.1 `src/pages/PricingPage.tsx`

- Page background: dark aurora (Phase 4.1 pattern)
- Pricing cards: `glass-card aurora-glow-ring` for featured plan
- Plan comparison: glass table rows
- Promo code input: glass input from Phase 2.3

### 6.2 `src/components/auth/AuthModal.tsx`

- Backdrop: replace `bg-black/70` with `bg-[rgba(7,7,15,0.85)] backdrop-blur-2xl`
- Modal card: replace `bg-surface-1` with `glass-card`; add `aurora-glow-ring`
- Logo: add tri-color shadow `shadow-[0_0_20px_rgba(62,207,142,0.5),0_0_40px_rgba(99,102,241,0.25)]`
- Tab switcher active: gradient underline
- Submit button: tri-color aurora gradient

### 6.3 `src/pages/SupportPage.tsx`

- Form card: `glass-card`
- Submit button: aurora primary

### 6.4 `src/pages/PrivacyPage.tsx`, `src/pages/TermsPage.tsx`, `src/pages/AboutPage.tsx`

- Page bg: dark aurora (Phase 4.1 pattern)  
- Section cards: `glass-card`
- Headings: `aurora-gradient-text` on key terms

### Verification
- Auth modal has glass surface with aurora glow ring
- Pricing page has dark bg with glass cards
- Featured pricing plan visually distinct with aurora glow ring

---

## Phase 7 — Sync, Commit, Push

**Goal:** Sync all changes from deploy directory to live dev server, commit to GitHub.

### 7.1 Copy changed files to live dev server

```bash
# Run from bash after all phases complete
DEPLOY="C:/Users/itzpi/AppData/Local/Temp/dhanrakhshak_deploy"
LIVE="C:/Users/itzpi/OneDrive/Desktop/Intrack"

cp "$DEPLOY/src/index.css" "$LIVE/src/index.css"
cp "$DEPLOY/src/components/ui/Card.tsx" "$LIVE/src/components/ui/Card.tsx"
cp "$DEPLOY/src/components/ui/Button.tsx" "$LIVE/src/components/ui/Button.tsx"
cp "$DEPLOY/src/components/ui/Input.tsx" "$LIVE/src/components/ui/Input.tsx"
cp "$DEPLOY/src/components/ui/Select.tsx" "$LIVE/src/components/ui/Select.tsx"
cp "$DEPLOY/src/components/ui/Badge.tsx" "$LIVE/src/components/ui/Badge.tsx"
cp "$DEPLOY/src/components/ui/EmptyState.tsx" "$LIVE/src/components/ui/EmptyState.tsx"
cp "$DEPLOY/src/layouts/AppLayout.tsx" "$LIVE/src/layouts/AppLayout.tsx"
cp "$DEPLOY/src/pages/LandingPage.tsx" "$LIVE/src/pages/LandingPage.tsx"
cp "$DEPLOY/src/pages/DashboardPage.tsx" "$LIVE/src/pages/DashboardPage.tsx"
cp "$DEPLOY/src/pages/ExpensesPage.tsx" "$LIVE/src/pages/ExpensesPage.tsx"
cp "$DEPLOY/src/pages/BudgetsPage.tsx" "$LIVE/src/pages/BudgetsPage.tsx"
cp "$DEPLOY/src/pages/PendingPage.tsx" "$LIVE/src/pages/PendingPage.tsx"
cp "$DEPLOY/src/pages/SubscriptionsPage.tsx" "$LIVE/src/pages/SubscriptionsPage.tsx"
cp "$DEPLOY/src/pages/PricingPage.tsx" "$LIVE/src/pages/PricingPage.tsx"
cp "$DEPLOY/src/pages/SupportPage.tsx" "$LIVE/src/pages/SupportPage.tsx"
cp "$DEPLOY/src/pages/PrivacyPage.tsx" "$LIVE/src/pages/PrivacyPage.tsx"
cp "$DEPLOY/src/pages/TermsPage.tsx" "$LIVE/src/pages/TermsPage.tsx"
cp "$DEPLOY/src/pages/AboutPage.tsx" "$LIVE/src/pages/AboutPage.tsx"
cp "$DEPLOY/src/components/auth/AuthModal.tsx" "$LIVE/src/components/auth/AuthModal.tsx"
```

### 7.2 Verify dev server hot-reload

Check Vite logs for HMR updates. No build errors allowed.

### 7.3 Commit and push from deploy directory

```bash
cd /tmp/dhanrakhshak_deploy
git add -A
git commit -m "feat: glassmorphic aurora redesign — full site

- Tri-color aurora tokens (emerald + indigo + cyan) in index.css
- Glass-card surface, aurora-gradient-text, aurora-glow-ring utilities
- Card/Button/Input/Select/Badge/EmptyState glassmorphic upgrades
- AppLayout: tri-color nav indicator, aurora splash, glass mobile nav
- LandingPage: dark aurora background, gradient hero, glass sections
- App pages: aurora progress bars, glass modals
- PricingPage/AuthModal: glass cards with aurora glow ring

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push origin main
```

### Final Verification Checklist
- [ ] Dark mode: body has tri-color aurora glow background
- [ ] Light mode: crisp white with subtle aurora tints (not full dark flip)
- [ ] Heading text uses aurora gradient on key pages
- [ ] Cards show frosted glass with gradient border glow on hover
- [ ] Primary buttons have tri-color gradient + shimmer
- [ ] Active nav item has tri-color underline glow
- [ ] LandingPage is dark (not white)
- [ ] Auth modal has glass surface with aurora ring
- [ ] Progress bars use aurora gradient fill
- [ ] All status colors (positive/danger/warning) remain unchanged (WCAG)
- [ ] No TypeScript errors in build
- [ ] No missing imports

---

## Execution Order

| Phase | Files | Complexity | Dependency |
|-------|-------|-----------|------------|
| 1 | index.css | Medium | None (do first) |
| 2 | ui/Card, Button, Input, Select, Badge, EmptyState | Medium | Phase 1 |
| 3 | AppLayout.tsx | High | Phase 1 |
| 4 | LandingPage.tsx | Very High | Phase 1 |
| 5 | App pages (5 files) | Medium | Phase 2 |
| 6 | Marketing + Auth (5 files) | Medium | Phase 1, 2 |
| 7 | Sync + push | Low | All phases |

**Total files to change: ~21 files**
**Estimated session breakdown:** Phases 1-2 in one session, Phase 4 alone (largest), Phases 3+5+6 together, Phase 7 at end.
