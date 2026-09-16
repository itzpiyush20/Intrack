# Motion kit and motion lab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared animation toolbox and a hidden admin-only `/motion-lab` page where the owner tunes the feel on a phone. No existing screen changes.

**Architecture:** New "glide" tokens are added to `src/components/ui/motion.ts` next to the old exports, which stay untouched so no current screen moves differently yet (the four rollout rounds migrate them, each in its own plan). New blocks — `RollingNumber`, `SlidingIndicator`, `MorphSurface`, `SwipeCard`, `haptics` — live in `src/components/ui/`, with their decision logic in small pure functions so it can be unit-tested without animation. `MotionLabPage` shows every block with a speed slider and curve picker.

**Tech Stack:** React 19, TypeScript, framer-motion 12, Tailwind v4, Vitest + Testing Library (jsdom), Capacitor 8 (`@capacitor/haptics` 8.0.2).

Spec: `docs/superpowers/specs/2026-09-16-app-motion-design.md`.

**Owner-approved feel:** curve `cubic-bezier(0.22, 1, 0.36, 1)`, no overshoot, no bounce. Nothing in this plan may overshoot.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `src/components/ui/motion.ts` | Modify | Add `GLIDE_EASE`, `GLIDE`, `glide()`, `PRESS_SCALE`; rewrite header comment |
| `src/components/ui/motion.test.ts` | Create | Guards "no overshoot" and reduced-motion collapse |
| `src/components/ui/haptics.ts` | Create | `haptics.tap/success/warning`, native-only, never throws |
| `src/components/ui/haptics.test.ts` | Create | Web no-op, native calls, failure swallowed |
| `src/components/ui/rollingDigits.ts` | Create | Pure: split formatted text into digit/char tokens keyed from the right |
| `src/components/ui/RollingNumber.tsx` | Create | Per-digit rolling figure |
| `src/components/ui/RollingNumber.test.tsx` | Create | Exact text, reduced motion, stable keys |
| `src/components/ui/swipe.ts` | Create | Pure: `swipeOutcome` threshold decision |
| `src/components/ui/swipe.test.ts` | Create | Threshold cases |
| `src/components/ui/SwipeCard.tsx` | Create | Drag-to-dismiss card |
| `src/components/ui/SlidingIndicator.tsx` | Create | Gliding highlight via `layoutId` |
| `src/components/ui/MorphSurface.tsx` | Create | Shared-element morph wrapper |
| `src/components/ui/index.ts` | Modify | Export new blocks and tokens |
| `src/pages/admin/MotionLabPage.tsx` | Create | The test page |
| `src/App.tsx` | Modify | `/motion-lab` route under `AdminRoute` |
| `ARCHITECTURE.md` | Modify | Route + blocks listed |
| `DESIGN.md` | Modify | Superseded note points at the new tokens |
| `package.json`, `package-lock.json` | Modify | `@capacitor/haptics` |

---

### Task 0: Record the lint baseline

- [ ] **Step 1: Count lint problems in the files this plan touches that already exist**

Run:
```bash
npx eslint src/components/ui/motion.ts src/components/ui/index.ts src/App.tsx 2>&1 | tail -3
```
Write the "✖ N problems" line into your task notes. New files must end with zero problems; existing files must not exceed this count.

---

### Task 1: Glide tokens in `motion.ts`

**Files:**
- Modify: `src/components/ui/motion.ts`
- Test: `src/components/ui/motion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/motion.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { GLIDE, GLIDE_EASE, PRESS_SCALE, glide } from './motion'

describe('glide tokens', () => {
  it('uses the owner-approved curve', () => {
    expect([...GLIDE_EASE]).toEqual([0.22, 1, 0.36, 1])
  })

  it('never overshoots: both bezier y control points are at most 1', () => {
    // The owner rejected a bouncy version. A y value above 1 is what makes a
    // cubic-bezier pass its target and come back.
    expect(GLIDE_EASE[1]).toBeLessThanOrEqual(1)
    expect(GLIDE_EASE[3]).toBeLessThanOrEqual(1)
  })

  it('keeps interface feedback within 350ms and figures within 800ms', () => {
    expect(GLIDE.fast).toBeLessThanOrEqual(0.35)
    expect(GLIDE.base).toBeLessThanOrEqual(0.35)
    expect(GLIDE.figure).toBeLessThanOrEqual(0.8)
  })

  it('collapses to nothing under reduced motion', () => {
    expect(glide(true)).toEqual({ duration: 0 })
  })

  it('returns duration and curve when motion is allowed', () => {
    expect(glide(false, 0.5)).toEqual({ duration: 0.5, ease: GLIDE_EASE })
  })

  it('accepts a different curve for the motion lab', () => {
    const softer = [0.33, 1, 0.68, 1] as const
    expect(glide(false, 0.3, softer)).toEqual({ duration: 0.3, ease: softer })
  })

  it('presses gently', () => {
    expect(PRESS_SCALE).toBeGreaterThanOrEqual(0.95)
    expect(PRESS_SCALE).toBeLessThan(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/motion.test.ts`
Expected: FAIL — `GLIDE` / `glide` are not exported.

- [ ] **Step 3: Implement**

In `src/components/ui/motion.ts`, replace the header comment block (lines 1–15, from the first `// ====` to the closing `// ====`) with:
```ts
// ============================================
// Motion vocabulary
//
// One set of durations and curves for the whole app, so every screen moves
// the same way.
//
// Direction (owner, 2026-09-16 — docs/superpowers/specs/2026-09-16-app-motion-design.md):
// subtle, smooth glide, no bounce, fitted to what each screen is for, and
// never slower. Animate transform and opacity; no blur or filters.
//
// The `GLIDE*` tokens below are the new system. The older exports further
// down are still used by existing screens and are migrated to glide one
// rollout round at a time — do not add new uses of them.
//
// Every consumer passes `useReducedMotion()` in, so a visitor who asked for
// less motion gets none.
// ============================================
```

Then, directly below `import type { Transition, Variants } from 'framer-motion'`, add:
```ts

/** A cubic-bezier as framer-motion accepts it. */
export type Bezier = readonly [number, number, number, number]

/**
 * The owner-approved curve: quick start, long soft settle, no overshoot.
 * Chosen from clickable demos on 2026-09-16 after a springy version was
 * rejected as too bouncy. Keep both y values at or below 1.
 */
export const GLIDE_EASE: Bezier = [0.22, 1, 0.36, 1]

/**
 * Seconds. `fast` and `base` are feedback the user may be waiting on;
 * `slow` is a surface moving (a card leaving, a form opening); `figure` is a
 * number or chart arriving, which needs long enough to be seen.
 */
export const GLIDE = { fast: 0.2, base: 0.3, slow: 0.5, figure: 0.8 } as const

/** Scale a pressed button or tappable card sinks to. */
export const PRESS_SCALE = 0.97

/** Glide transition, collapsed to nothing when reduced motion is requested. */
export const glide = (
  reduce: boolean | null,
  duration: number = GLIDE.base,
  ease: Bezier = GLIDE_EASE,
): Transition => (reduce ? { duration: 0 } : { duration, ease })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/motion.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Prove the overshoot guard bites**

Temporarily change `GLIDE_EASE` to `[0.34, 1.3, 0.64, 1]`, run the test, expect FAIL on "never overshoots". Restore `[0.22, 1, 0.36, 1]`, run again, expect PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/motion.ts src/components/ui/motion.test.ts
git commit -m "feat: glide motion tokens (no-overshoot curve)" -- src/components/ui/motion.ts src/components/ui/motion.test.ts
```

---

### Task 2: Haptics

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `src/components/ui/haptics.ts`
- Test: `src/components/ui/haptics.test.ts`

- [ ] **Step 1: Install the plugin**

Run: `npm install @capacitor/haptics@8.0.2`
Expected: `package.json` gains `"@capacitor/haptics": "^8.0.2"`. No `android/` or `ios/` folder is in the repo, so there is no `cap sync` to run here; note in the final report that the native app must be rebuilt for haptics to work.

- [ ] **Step 2: Write the failing test**

Create `src/components/ui/haptics.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({ value: false }))
const impact = vi.hoisted(() => vi.fn())
const notification = vi.hoisted(() => vi.fn())

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
}))

vi.mock('@capacitor/haptics', () => ({
  Haptics: { impact, notification },
  ImpactStyle: { Light: 'LIGHT' },
  NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' },
}))

import { haptics } from './haptics'

beforeEach(() => {
  impact.mockReset()
  notification.mockReset()
})

describe('haptics', () => {
  it('does nothing on the web', async () => {
    native.value = false
    await haptics.tap()
    await haptics.success()
    await haptics.warning()
    expect(impact).not.toHaveBeenCalled()
    expect(notification).not.toHaveBeenCalled()
  })

  it('gives a light impact for a tap in the native app', async () => {
    native.value = true
    await haptics.tap()
    expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' })
  })

  it('uses success and warning notifications in the native app', async () => {
    native.value = true
    await haptics.success()
    await haptics.warning()
    expect(notification).toHaveBeenNthCalledWith(1, { type: 'SUCCESS' })
    expect(notification).toHaveBeenNthCalledWith(2, { type: 'WARNING' })
  })

  it('never lets a haptics failure break the action that triggered it', async () => {
    native.value = true
    impact.mockRejectedValueOnce(new Error('no vibrator'))
    await expect(haptics.tap()).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/components/ui/haptics.test.ts`
Expected: FAIL — cannot resolve `./haptics`.

- [ ] **Step 4: Implement**

Create `src/components/ui/haptics.ts`:
```ts
// ============================================
// Haptics
//
// A light physical tick on key actions in the native app — approve, save,
// delete. On the web every call is a no-op.
//
// Fire-and-forget: callers write `void haptics.success()` and carry on. A
// device without a vibration motor, or a plugin error, must never stop the
// save or approval the tick was decorating.
// ============================================

import { Capacitor } from '@capacitor/core'

type Kind = 'tap' | 'success' | 'warning'

async function fire(kind: Kind): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    // Imported on demand so the web bundle never loads the plugin.
    const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics')
    if (kind === 'tap') {
      await Haptics.impact({ style: ImpactStyle.Light })
    } else {
      await Haptics.notification({
        type: kind === 'success' ? NotificationType.Success : NotificationType.Warning,
      })
    }
  } catch {
    // Deliberately silent: see header.
  }
}

export const haptics = {
  tap: () => fire('tap'),
  success: () => fire('success'),
  warning: () => fire('warning'),
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/ui/haptics.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/ui/haptics.ts src/components/ui/haptics.test.ts
git commit -m "feat: native-only haptics helper" -- package.json package-lock.json src/components/ui/haptics.ts src/components/ui/haptics.test.ts
```

---

### Task 3: Rolling digits logic

**Files:**
- Create: `src/components/ui/rollingDigits.ts`
- Test: `src/components/ui/RollingNumber.test.tsx` (logic part)

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/RollingNumber.test.tsx`:
```tsx
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { splitForRolling } from './rollingDigits'

function setReducedMotion(reduced: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduced && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

afterEach(cleanup)

describe('splitForRolling', () => {
  it('marks digits and keeps other characters as they are', () => {
    expect(splitForRolling('₹4,2')).toEqual([
      { key: 'p3', char: '₹', digit: null },
      { key: 'p2', char: '4', digit: 4 },
      { key: 'p1', char: ',', digit: null },
      { key: 'p0', char: '2', digit: 2 },
    ])
  })

  it('keys from the right, so the last digits keep their slot when the figure grows', () => {
    // ₹42,350 → ₹1,42,850: the "50" at the end must be the same slots, or
    // React remounts them and every digit rolls instead of only the changed ones.
    const before = splitForRolling('₹42,350')
    const after = splitForRolling('₹1,42,850')
    expect(before.at(-1)).toMatchObject({ key: 'p0', digit: 0 })
    expect(after.at(-1)).toMatchObject({ key: 'p0', digit: 0 })
    expect(before.at(-2)).toMatchObject({ key: 'p1', digit: 5 })
    expect(after.at(-2)).toMatchObject({ key: 'p1', digit: 5 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/RollingNumber.test.tsx`
Expected: FAIL — cannot resolve `./rollingDigits`.

- [ ] **Step 3: Implement**

Create `src/components/ui/rollingDigits.ts`:
```ts
/** One character of a formatted figure, as `RollingNumber` renders it. */
export interface RollingToken {
  /** Position counted from the right, so trailing digits keep their slot. */
  key: string
  char: string
  /** 0–9 for a digit that rolls; null for ₹, commas, dots, minus signs. */
  digit: number | null
}

export function splitForRolling(text: string): RollingToken[] {
  const chars = [...text]
  return chars.map((char, index) => ({
    key: `p${chars.length - 1 - index}`,
    char,
    digit: /^[0-9]$/.test(char) ? Number(char) : null,
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/RollingNumber.test.tsx`
Expected: PASS, 2 tests. (`render`, `screen`, `beforeEach`, `setReducedMotion` are used in Task 4; an unused-import lint warning here is expected until then.)

---

### Task 4: `RollingNumber` component

**Files:**
- Create: `src/components/ui/RollingNumber.tsx`
- Test: `src/components/ui/RollingNumber.test.tsx` (append)

- [ ] **Step 1: Append the failing component tests**

Add at the top of `RollingNumber.test.tsx`, below the `splitForRolling` import:
```tsx
import RollingNumber from './RollingNumber'

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`
```
Append at the bottom:
```tsx
describe('RollingNumber', () => {
  describe('with reduced motion requested', () => {
    beforeEach(() => setReducedMotion(true))

    it('renders the exact figure as plain text', () => {
      const { container } = render(<RollingNumber value={42350} format={rupees} />)
      expect(screen.getByText('₹42,350')).toBeDefined()
      expect(container.querySelectorAll('[data-roll-slot]').length).toBe(0)
    })
  })

  describe('with motion allowed', () => {
    beforeEach(() => setReducedMotion(false))

    it('exposes the exact figure to screen readers once, not digit by digit', () => {
      render(<RollingNumber value={42350} format={rupees} />)
      expect(screen.getByText('₹42,350')).toBeDefined()
    })

    it('renders one rolling slot per digit', () => {
      const { container } = render(<RollingNumber value={42350} format={rupees} />)
      expect(container.querySelectorAll('[data-roll-slot]').length).toBe(5)
    })

    it('reports the new figure when the value changes', () => {
      const { rerender } = render(<RollingNumber value={42350} format={rupees} />)
      rerender(<RollingNumber value={142850} format={rupees} />)
      expect(screen.getByText('₹1,42,850')).toBeDefined()
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/RollingNumber.test.tsx`
Expected: FAIL — cannot resolve `./RollingNumber`.

- [ ] **Step 3: Implement**

Create `src/components/ui/RollingNumber.tsx`:
```tsx
// ============================================
// RollingNumber
//
// A money figure whose digits roll into place, each in its own slot, like a
// mechanical counter. When the value changes only the digits that differ
// move — ₹42,350 → ₹42,850 rolls one digit, not five.
//
// Screen readers get the exact formatted figure once, from a visually hidden
// span; the rolling slots are aria-hidden. Under reduced motion it is plain
// text. Slots are keyed from the right (see rollingDigits.ts) so a figure
// gaining a digit does not remount the ones that stayed.
// ============================================

import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/utils'
import { GLIDE, GLIDE_EASE, glide, type Bezier } from './motion'
import { splitForRolling } from './rollingDigits'

/** Height of one digit row, in em. Slightly above 1 so descenders are not clipped. */
const ROW = 1.15
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

export interface RollingNumberProps {
  value: number
  /** Usually `formatCurrency`. The output is what is shown, digit for digit. */
  format: (value: number) => string
  className?: string
  style?: React.CSSProperties
  title?: string
  /** Seconds. Defaults to the figure duration. */
  duration?: number
  /** Curve override, used by the motion lab. */
  ease?: Bezier
  /** Roll up from 0 on first paint. Default true. */
  rollOnMount?: boolean
}

export default function RollingNumber({
  value,
  format,
  className,
  style,
  title,
  duration = GLIDE.figure,
  ease = GLIDE_EASE,
  rollOnMount = true,
}: RollingNumberProps) {
  const reduce = useReducedMotion()
  const text = format(value)

  if (reduce) {
    return (
      <span className={cn('tabular-nums', className)} style={style} title={title}>
        {text}
      </span>
    )
  }

  return (
    <span className={cn('relative inline-flex tabular-nums', className)} style={style} title={title}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex">
        {splitForRolling(text).map((token) =>
          token.digit === null ? (
            <span key={token.key} style={{ lineHeight: `${ROW}em` }}>
              {token.char}
            </span>
          ) : (
            <span
              key={token.key}
              data-roll-slot=""
              className="relative inline-block overflow-hidden"
              style={{ height: `${ROW}em`, lineHeight: `${ROW}em` }}
            >
              <motion.span
                className="block"
                initial={rollOnMount ? { y: '0em' } : false}
                animate={{ y: `${-token.digit * ROW}em` }}
                transition={glide(reduce, duration, ease)}
              >
                {DIGITS.map((d) => (
                  <span key={d} className="block" style={{ height: `${ROW}em` }}>
                    {d}
                  </span>
                ))}
              </motion.span>
            </span>
          ),
        )}
      </span>
    </span>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/RollingNumber.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/rollingDigits.ts src/components/ui/RollingNumber.tsx src/components/ui/RollingNumber.test.tsx
git commit -m "feat: RollingNumber rolls only the digits that change" -- src/components/ui/rollingDigits.ts src/components/ui/RollingNumber.tsx src/components/ui/RollingNumber.test.tsx
```

---

### Task 5: Swipe decision and `SwipeCard`

**Files:**
- Create: `src/components/ui/swipe.ts`, `src/components/ui/SwipeCard.tsx`
- Test: `src/components/ui/swipe.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/swipe.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { SWIPE_DISTANCE_RATIO, SWIPE_VELOCITY, swipeOutcome } from './swipe'

const WIDTH = 400
const past = WIDTH * SWIPE_DISTANCE_RATIO + 1
const short = WIDTH * SWIPE_DISTANCE_RATIO - 1

describe('swipeOutcome', () => {
  it('goes right when dragged past the threshold to the right', () => {
    expect(swipeOutcome(past, 0, WIDTH)).toBe('right')
  })

  it('goes left when dragged past the threshold to the left', () => {
    expect(swipeOutcome(-past, 0, WIDTH)).toBe('left')
  })

  it('returns when the drag stops short, slowly', () => {
    expect(swipeOutcome(short, 0, WIDTH)).toBe('return')
    expect(swipeOutcome(-short, 0, WIDTH)).toBe('return')
  })

  it('accepts a short fast flick', () => {
    expect(swipeOutcome(40, SWIPE_VELOCITY + 1, WIDTH)).toBe('right')
    expect(swipeOutcome(-40, -(SWIPE_VELOCITY + 1), WIDTH)).toBe('left')
  })

  it('does not approve a flick that moves against its own velocity', () => {
    // Dragged left, then flicked right on release: the card is still left of
    // centre. Acting on velocity alone would approve something the user was
    // pulling towards reject.
    expect(swipeOutcome(-40, SWIPE_VELOCITY + 1, WIDTH)).toBe('return')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/ui/swipe.test.ts`
Expected: FAIL — cannot resolve `./swipe`.

- [ ] **Step 3: Implement the decision**

Create `src/components/ui/swipe.ts`:
```ts
/** Fraction of the card's width a drag must travel to count. */
export const SWIPE_DISTANCE_RATIO = 0.35
/** px/s. A flick this fast counts even when short. */
export const SWIPE_VELOCITY = 500

export type SwipeOutcome = 'right' | 'left' | 'return'

export function swipeOutcome(offsetX: number, velocityX: number, width: number): SwipeOutcome {
  const distance = width * SWIPE_DISTANCE_RATIO
  if (offsetX > distance || (offsetX > 0 && velocityX > SWIPE_VELOCITY)) return 'right'
  if (offsetX < -distance || (offsetX < 0 && velocityX < -SWIPE_VELOCITY)) return 'left'
  return 'return'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/ui/swipe.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Implement `SwipeCard`**

Create `src/components/ui/SwipeCard.tsx`:
```tsx
// ============================================
// SwipeCard
//
// A card the user can drag sideways. Past the threshold (or on a fast flick)
// it glides off that side and the matching callback runs; otherwise it glides
// back. The drag has resistance so it reads as a physical card.
//
// Swiping is a shortcut, never the only way: every screen using this keeps
// visible buttons for the same actions, for keyboard and screen-reader users.
// `touch-pan-y` keeps vertical page scrolling working on the card.
// ============================================

import { useRef, type ReactNode } from 'react'
import { motion, useAnimationControls, useReducedMotion, type PanInfo } from 'framer-motion'
import { cn } from '@/utils'
import { GLIDE, GLIDE_EASE, glide, type Bezier } from './motion'
import { swipeOutcome } from './swipe'

export interface SwipeCardProps {
  children: ReactNode
  onSwipeRight: () => void
  onSwipeLeft: () => void
  className?: string
  /** Seconds for the card to leave. */
  duration?: number
  ease?: Bezier
}

export default function SwipeCard({
  children,
  onSwipeRight,
  onSwipeLeft,
  className,
  duration = GLIDE.slow,
  ease = GLIDE_EASE,
}: SwipeCardProps) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  const controls = useAnimationControls()

  async function handleDragEnd(_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
    const width = ref.current?.offsetWidth ?? 320
    const outcome = swipeOutcome(info.offset.x, info.velocity.x, width)
    if (outcome === 'return') {
      void controls.start({ x: 0, transition: glide(reduce, GLIDE.base, ease) })
      return
    }
    const direction = outcome === 'right' ? 1 : -1
    await controls.start({ x: direction * width * 1.1, opacity: 0, transition: glide(reduce, duration, ease) })
    if (outcome === 'right') onSwipeRight()
    else onSwipeLeft()
  }

  return (
    <motion.div
      ref={ref}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.6}
      dragMomentum={false}
      animate={controls}
      onDragEnd={handleDragEnd}
      className={cn('touch-pan-y', className)}
    >
      {children}
    </motion.div>
  )
}
```

- [ ] **Step 6: Type-check**

Run: `npx tsc -b`
Expected: no errors. If framer-motion's `onDragEnd` event type differs, match the signature tsc reports rather than casting to `any`.

- [ ] **Step 7: Commit**

```bash
git add src/components/ui/swipe.ts src/components/ui/swipe.test.ts src/components/ui/SwipeCard.tsx
git commit -m "feat: SwipeCard with tested swipe threshold" -- src/components/ui/swipe.ts src/components/ui/swipe.test.ts src/components/ui/SwipeCard.tsx
```

---

### Task 6: `SlidingIndicator` and `MorphSurface`, exports

**Files:**
- Create: `src/components/ui/SlidingIndicator.tsx`, `src/components/ui/MorphSurface.tsx`
- Modify: `src/components/ui/index.ts`

- [ ] **Step 1: Create `SlidingIndicator`**

```tsx
// ============================================
// SlidingIndicator
//
// The highlight behind the active nav item or tab. Render it inside whichever
// item is active, with the same `layoutId` for the whole group; framer-motion
// glides it from the old item to the new one. The item needs `relative` and
// its label needs `relative z-10` to sit above it.
// ============================================

import { motion, useReducedMotion } from 'framer-motion'
import { cn } from '@/utils'
import { GLIDE, GLIDE_EASE, glide, type Bezier } from './motion'

export interface SlidingIndicatorProps {
  layoutId: string
  className?: string
  duration?: number
  ease?: Bezier
}

export default function SlidingIndicator({
  layoutId,
  className,
  duration = GLIDE.base,
  ease = GLIDE_EASE,
}: SlidingIndicatorProps) {
  const reduce = useReducedMotion()
  return (
    <motion.span
      layoutId={layoutId}
      aria-hidden="true"
      className={cn('absolute inset-0', className)}
      transition={glide(reduce, duration, ease)}
    />
  )
}
```
Save as `src/components/ui/SlidingIndicator.tsx`.

- [ ] **Step 2: Create `MorphSurface`**

```tsx
// ============================================
// MorphSurface
//
// Two elements sharing a `morphId` — the Add button and the form it opens —
// morph into each other: size, position and corner radius glide instead of
// one popping in. Mount exactly one of the pair at a time.
//
// Put inner content in `motion.div layout="position"` so text is not
// stretched while the surface resizes.
// ============================================

import { motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion'
import { GLIDE, GLIDE_EASE, glide, type Bezier } from './motion'

export interface MorphSurfaceProps extends Omit<HTMLMotionProps<'div'>, 'layoutId' | 'transition'> {
  morphId: string
  duration?: number
  ease?: Bezier
}

export default function MorphSurface({
  morphId,
  duration = GLIDE.slow,
  ease = GLIDE_EASE,
  ...rest
}: MorphSurfaceProps) {
  const reduce = useReducedMotion()
  return <motion.div layoutId={morphId} transition={glide(reduce, duration, ease)} {...rest} />
}
```
Save as `src/components/ui/MorphSurface.tsx`.

- [ ] **Step 3: Export everything**

In `src/components/ui/index.ts`, after `export { default as AnimatedBar } from './AnimatedBar'` add:
```ts
export { default as RollingNumber } from './RollingNumber'
export { default as SlidingIndicator } from './SlidingIndicator'
export { default as MorphSurface } from './MorphSurface'
export { default as SwipeCard } from './SwipeCard'
export { haptics } from './haptics'
```
And change the motion export block to:
```ts
export {
  EASE_OUT, DURATION, INDICATOR_SPRING, transition,
  panelVariants, rowVariants, staggerParent, staggerChild,
  GLIDE, GLIDE_EASE, PRESS_SCALE, glide,
} from './motion'
export type { Bezier } from './motion'
```

- [ ] **Step 4: Type-check**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/SlidingIndicator.tsx src/components/ui/MorphSurface.tsx src/components/ui/index.ts
git commit -m "feat: SlidingIndicator and MorphSurface motion blocks" -- src/components/ui/SlidingIndicator.tsx src/components/ui/MorphSurface.tsx src/components/ui/index.ts
```

---

### Task 7: The motion lab page

**Files:**
- Create: `src/pages/admin/MotionLabPage.tsx`
- Modify: `src/App.tsx` (pageImports ~line 79, lazy consts ~line 96, admin route ~line 188)

- [ ] **Step 1: Create the page**

Create `src/pages/admin/MotionLabPage.tsx`:
```tsx
// ============================================
// MotionLabPage — /motion-lab, admins only, not linked anywhere.
//
// Where the owner tries every animation from the motion kit on a phone and
// picks the speed and curve before any real screen changes. The values shown
// at the top are what gets written into motion.ts afterwards.
//
// Temporary: deleted, with its route, when the motion rollout finishes
// (docs/superpowers/specs/2026-09-16-app-motion-design.md).
// ============================================

import { useState } from 'react'
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from 'framer-motion'
import { Check, Plus, Trash2, X } from 'lucide-react'
import {
  Card, GLIDE, MorphSurface, PRESS_SCALE, RollingNumber, SlidingIndicator, SwipeCard,
  glide, haptics, type Bezier,
} from '@/components/ui'
import { formatCurrency } from '@/utils'

const CURVES: Record<string, { label: string; ease: Bezier }> = {
  glide: { label: 'Approved glide', ease: [0.22, 1, 0.36, 1] },
  softer: { label: 'Softer', ease: [0.33, 1, 0.68, 1] },
  quicker: { label: 'Quicker settle', ease: [0.16, 1, 0.3, 1] },
}

const BALANCES = [42350, 42850, 118420, 506900]
const PERIODS = ['Week', 'Month', 'Year'] as const
const SPENDS: Record<(typeof PERIODS)[number], number[]> = {
  Week: [30, 55, 20, 70],
  Month: [60, 40, 85, 35],
  Year: [90, 65, 50, 75],
}
const BAR_LABELS = ['Food', 'Travel', 'Bills', 'Shopping']
const PENDING = [
  { id: 1, merchant: 'Swiggy', source: 'HDFC alert, 14/09/2026', amount: 386 },
  { id: 2, merchant: 'Uber', source: 'ICICI alert, 15/09/2026', amount: 212 },
  { id: 3, merchant: 'Amazon', source: 'Order receipt, 15/09/2026', amount: 1499 },
]
const NEW_ROWS = ['Chai', 'Petrol', 'Movie', 'Groceries', 'Pharmacy']

const sectionLabel = 'text-xs font-bold uppercase tracking-wide text-text-secondary'

export default function MotionLabPage() {
  const reduce = useReducedMotion()
  const [speed, setSpeed] = useState(1)
  const [curveId, setCurveId] = useState('glide')
  const ease = CURVES[curveId].ease
  const t = (seconds: number) => glide(reduce, seconds * speed, ease)

  const [balanceIndex, setBalanceIndex] = useState(0)
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('Month')
  const [formOpen, setFormOpen] = useState(false)
  const [pending, setPending] = useState(PENDING)
  const [exitDirection, setExitDirection] = useState<1 | -1>(1)
  const [rows, setRows] = useState([{ id: 0, label: 'Rent', amount: 18000 }])
  const [nextRow, setNextRow] = useState(1)
  const [newestRow, setNewestRow] = useState<number | null>(null)

  function resolvePending(id: number, direction: 1 | -1) {
    setExitDirection(direction)
    void (direction === 1 ? haptics.success() : haptics.warning())
    setPending((list) => list.filter((item) => item.id !== id))
  }

  function addRow() {
    const id = nextRow
    setRows((list) => [{ id, label: NEW_ROWS[id % NEW_ROWS.length], amount: 50 + id * 37 }, ...list])
    setNextRow(id + 1)
    setNewestRow(id)
    void haptics.success()
  }

  function deleteRow(id: number) {
    void haptics.warning()
    setRows((list) => list.filter((row) => row.id !== id))
  }

  return (
    <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-text-primary">Motion lab</h1>
        <p className="text-sm text-text-secondary">
          Try each animation. Tell Claude the speed and curve that feel right.
        </p>
      </header>

      <Card className="space-y-4">
        <p className={sectionLabel}>Your settings</p>
        <label className="block space-y-2">
          <span className="text-sm text-text-primary">Speed: {speed.toFixed(1)}× {speed < 1 ? '(faster)' : speed > 1 ? '(slower)' : ''}</span>
          <input
            type="range" min={0.5} max={1.6} step={0.1} value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            className="w-full accent-brand-500"
          />
        </label>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Curve">
          {Object.entries(CURVES).map(([id, curve]) => (
            <button
              key={id} type="button" role="radio" aria-checked={curveId === id}
              onClick={() => setCurveId(id)}
              className={`rounded-full border px-3 py-1.5 text-sm ${curveId === id ? 'border-brand-500 bg-brand-500/10 text-brand-700 font-semibold' : 'border-border-subtle text-text-secondary'}`}
            >
              {curve.label}
            </button>
          ))}
        </div>
        {reduce && (
          <p className="text-sm text-amber-700">
            Your device has “reduce motion” on, so animations are switched off here. Turn it off to try them.
          </p>
        )}
      </Card>

      {/* 1. Rolling figure */}
      <Card className="space-y-3">
        <p className={sectionLabel}>1 · Balance changes</p>
        <RollingNumber
          value={BALANCES[balanceIndex]}
          format={(n) => formatCurrency(n)}
          duration={GLIDE.figure * speed}
          ease={ease}
          className="font-display text-3xl font-bold text-text-primary"
        />
        <div>
          <motion.button
            type="button" whileTap={{ scale: PRESS_SCALE }} transition={t(GLIDE.fast)}
            onClick={() => { setBalanceIndex((i) => (i + 1) % BALANCES.length); void haptics.tap() }}
            className="rounded-xl border border-border-subtle px-4 py-2 text-sm font-semibold text-text-primary"
          >
            Change period
          </motion.button>
        </div>
      </Card>

      {/* 2. Period tabs + bars */}
      <Card className="space-y-4">
        <p className={sectionLabel}>2 · Period switch and chart</p>
        <LayoutGroup id="lab-periods">
          <div className="inline-flex rounded-full border border-border-subtle bg-surface-2 p-1" role="tablist">
            {PERIODS.map((p) => (
              <button
                key={p} type="button" role="tab" aria-selected={period === p}
                onClick={() => { setPeriod(p); void haptics.tap() }}
                className={`relative rounded-full px-4 py-1.5 text-sm font-semibold ${period === p ? 'text-white' : 'text-text-secondary'}`}
              >
                {period === p && (
                  <SlidingIndicator layoutId="lab-period-pill" className="rounded-full bg-brand-500" duration={GLIDE.base * speed} ease={ease} />
                )}
                <span className="relative z-10">{p}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
        <div className="space-y-2">
          {SPENDS[period].map((pct, i) => (
            <div key={BAR_LABELS[i]} className="flex items-center gap-3">
              <span className="w-20 text-sm text-text-secondary">{BAR_LABELS[i]}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                <motion.div
                  className="h-full origin-left rounded-full bg-brand-500"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: pct / 100 }}
                  transition={t(GLIDE.figure)}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* 3. Button grows into form */}
      <Card className="space-y-3">
        <p className={sectionLabel}>3 · Add button opens the form</p>
        <LayoutGroup id="lab-morph">
          <div className="min-h-[190px]">
            {!formOpen ? (
              <MorphSurface
                morphId="lab-add" duration={GLIDE.slow * speed} ease={ease}
                onClick={() => { setFormOpen(true); void haptics.tap() }}
                className="inline-flex cursor-pointer items-center gap-2 bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white"
                style={{ borderRadius: 999 }}
                role="button" tabIndex={0}
              >
                <motion.span layout="position" className="inline-flex items-center gap-2">
                  <Plus className="h-4 w-4" aria-hidden="true" /> Add expense
                </motion.span>
              </MorphSurface>
            ) : (
              <MorphSurface
                morphId="lab-add" duration={GLIDE.slow * speed} ease={ease}
                className="space-y-3 border border-border-subtle bg-surface-1 p-4 shadow-[var(--shadow-md)]"
                style={{ borderRadius: 16 }}
              >
                <motion.div
                  layout="position" className="space-y-3"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ ...t(GLIDE.base), delay: reduce ? 0 : GLIDE.fast * speed }}
                >
                  <p className="font-semibold text-text-primary">Add transaction</p>
                  <p className="text-sm text-text-secondary">Amount: ₹450 · Category: Food</p>
                  <button
                    type="button"
                    onClick={() => { setFormOpen(false); void haptics.success() }}
                    className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white"
                  >
                    Save
                  </button>
                </motion.div>
              </MorphSurface>
            )}
          </div>
        </LayoutGroup>
      </Card>

      {/* 4. Pending cards */}
      <Card className="space-y-3">
        <p className={sectionLabel}>4 · Pending: swipe or tap</p>
        <p className="text-sm text-text-secondary">Swipe right to approve, left to reject. On the phone app you also feel a tick.</p>
        <div className="space-y-2 overflow-hidden">
          <AnimatePresence initial={false} custom={exitDirection}>
            {pending.map((item) => (
              <motion.div
                key={item.id}
                layout
                custom={exitDirection}
                variants={{ exit: (direction: number) => ({ x: `${direction * 110}%`, opacity: 0 }) }}
                exit="exit"
                transition={t(GLIDE.slow)}
              >
                <SwipeCard
                  onSwipeRight={() => resolvePending(item.id, 1)}
                  onSwipeLeft={() => resolvePending(item.id, -1)}
                  duration={GLIDE.slow * speed} ease={ease}
                >
                  <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-subtle bg-surface-1 p-3">
                    <div>
                      <p className="font-semibold text-text-primary">{item.merchant}</p>
                      <p className="text-xs text-text-secondary">{item.source}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold tabular-nums text-text-primary">{formatCurrency(item.amount)}</span>
                      <button type="button" aria-label={`Approve ${item.merchant}`} onClick={() => resolvePending(item.id, 1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-brand-700 hover:bg-surface-2">
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button type="button" aria-label={`Reject ${item.merchant}`} onClick={() => resolvePending(item.id, -1)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2">
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </SwipeCard>
              </motion.div>
            ))}
          </AnimatePresence>
          {pending.length === 0 && (
            <button type="button" onClick={() => setPending(PENDING)} className="text-sm font-semibold text-brand-700">
              Bring the cards back
            </button>
          )}
        </div>
      </Card>

      {/* 5. List add / delete */}
      <Card className="space-y-3">
        <p className={sectionLabel}>5 · Adding and deleting rows</p>
        <motion.button
          type="button" whileTap={{ scale: PRESS_SCALE }} transition={t(GLIDE.fast)} onClick={addRow}
          className="inline-flex items-center gap-2 rounded-xl border border-border-subtle px-4 py-2 text-sm font-semibold text-text-primary"
        >
          <Plus className="h-4 w-4" aria-hidden="true" /> Add a row
        </motion.button>
        <ul className="space-y-1">
          <AnimatePresence initial={false}>
            {rows.map((row) => (
              <motion.li
                key={row.id}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -24 }}
                transition={t(GLIDE.base)}
                className="relative flex items-center justify-between rounded-xl px-3 py-2.5"
              >
                {row.id === newestRow && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-xl bg-brand-500/10"
                    initial={{ opacity: 1 }}
                    animate={{ opacity: 0 }}
                    transition={{ ...t(1.2), delay: reduce ? 0 : 0.4 * speed }}
                  />
                )}
                <span className="relative text-sm text-text-primary">{row.label}</span>
                <span className="relative flex items-center gap-2">
                  <span className="text-sm font-semibold tabular-nums text-text-primary">{formatCurrency(row.amount)}</span>
                  <button type="button" aria-label={`Delete ${row.label}`} onClick={() => deleteRow(row.id)} className="flex h-9 w-9 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-2">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </Card>

      {/* 6. Haptics */}
      <Card className="space-y-3">
        <p className={sectionLabel}>6 · Phone vibration (app only)</p>
        <div className="flex flex-wrap gap-2">
          {([['Tap', haptics.tap], ['Success', haptics.success], ['Warning', haptics.warning]] as const).map(([label, fire]) => (
            <motion.button
              key={label} type="button" whileTap={{ scale: PRESS_SCALE }} transition={t(GLIDE.fast)}
              onClick={() => void fire()}
              className="rounded-xl border border-border-subtle px-4 py-2 text-sm font-semibold text-text-primary"
            >
              {label}
            </motion.button>
          ))}
        </div>
      </Card>
    </div>
  )
}
```

Note: the bars animate `scaleX` rather than width, per the spec's transform-only limit. They have fully rounded caps inside an `overflow-hidden` rounded track, so the scaled cap is clipped by the track and the corner stretch is not visible; check this in the browser in Task 9 and report it if it is.

- [ ] **Step 2: Add the route**

In `src/App.tsx`:

After `  '/admin':          () => import('@/pages/admin/AdminPage'),` add:
```ts
  '/motion-lab':     () => import('@/pages/admin/MotionLabPage'),
```
After `const AdminPage         = lazyWithRetry(pageImports['/admin'])` add:
```ts
const MotionLabPage     = lazyWithRetry(pageImports['/motion-lab'])
```
Replace:
```tsx
              <Route path="/admin" element={<AdminPage />} />
```
with:
```tsx
              <Route path="/admin" element={<AdminPage />} />
              {/* Temporary: motion tuning page, removed when the motion rollout ends. */}
              <Route path="/motion-lab" element={<MotionLabPage />} />
```

- [ ] **Step 3: Type-check and build**

Run: `npx tsc -b` then `npm run build`
Expected: both succeed. Check `pageImports` has no type (e.g. a union of known paths) that rejects the new key; if it does, add `'/motion-lab'` to that type.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/MotionLabPage.tsx src/App.tsx
git commit -m "feat: admin-only motion lab for tuning animation feel" -- src/pages/admin/MotionLabPage.tsx src/App.tsx
```

---

### Task 8: Identity files

**Files:**
- Modify: `ARCHITECTURE.md` (§3 Routes, §9 Frontend stack)
- Modify: `DESIGN.md` (Motion superseded note)

- [ ] **Step 1: ARCHITECTURE.md routes**

Replace `redirects to \`/dashboard\`. \`/admin\` is additionally gated on admin status.` with:
```markdown
redirects to `/dashboard`. `/admin` is additionally gated on admin status, as is
`/motion-lab` — a temporary, unlinked page for tuning animations, removed when
the motion rollout in `docs/superpowers/specs/2026-09-16-app-motion-design.md`
finishes.
```

- [ ] **Step 2: ARCHITECTURE.md frontend section**

At the end of section 9 (just before `## 10. Tests and checks`), add:
```markdown
**Motion kit:** `src/components/ui/motion.ts` holds the `GLIDE` tokens and
`glide()` (owner-approved no-overshoot curve). Blocks in `src/components/ui/`:
`RollingNumber`, `SlidingIndicator`, `MorphSurface`, `SwipeCard`, and
`haptics` (native-only via `@capacitor/haptics`). Older motion exports
(`EASE_OUT`, `DURATION`, `rowVariants`…) are still used by existing screens and
are being migrated round by round.
```

- [ ] **Step 3: DESIGN.md**

In the "Superseded 2026-09-16" note under `## Motion`, append one line before the closing of the quote:
```markdown
> The new tokens and blocks already exist (`GLIDE`, `glide()`, `RollingNumber`,
> `SlidingIndicator`, `MorphSurface`, `SwipeCard`, `haptics`); screens adopt them
> round by round.
```

- [ ] **Step 4: Commit**

```bash
git add ARCHITECTURE.md DESIGN.md
git commit -m "docs: list the motion kit and the temporary motion lab route" -- ARCHITECTURE.md DESIGN.md
```

---

### Task 9: Double-check before deploy

- [ ] **Step 1: Full checks**

Run each separately (scanner tests flake when chained under CPU load):
```bash
npx tsc -b
```
```bash
npm test -- --run
```
```bash
npm run build
```
```bash
npx eslint src/components/ui/motion.ts src/components/ui/index.ts src/App.tsx src/components/ui/haptics.ts src/components/ui/rollingDigits.ts src/components/ui/RollingNumber.tsx src/components/ui/swipe.ts src/components/ui/SwipeCard.tsx src/components/ui/SlidingIndicator.tsx src/components/ui/MorphSurface.tsx src/pages/admin/MotionLabPage.tsx src/components/ui/*.test.ts src/components/ui/RollingNumber.test.tsx
```
Expected: tsc clean, all tests pass, build succeeds, lint on new files zero problems and existing files at or below the Task 0 count.

- [ ] **Step 2: Prove new tests fail against wrong behaviour**

- `swipe.ts`: remove `offsetX > 0 &&` from the right-flick branch → "does not approve a flick that moves against its own velocity" goes red → restore.
- `rollingDigits.ts`: change key to `` `p${index}` `` → "keys from the right" goes red → restore.
- `haptics.ts`: remove the `try/catch` → "never lets a haptics failure break" goes red → restore.

- [ ] **Step 3: Existing screens unchanged**

Run: `git diff <commit before Task 1>..HEAD --stat -- src/pages src/components src/layouts ':!src/components/ui' ':!src/pages/admin/MotionLabPage.tsx'`
Expected: no output — no existing screen was touched.

- [ ] **Step 4: Real browser check**

Start the dev server with the Browser pane (`preview_start`), sign in as an admin, open `/motion-lab`:
- Each of the 6 sections animates; console has no errors.
- Speed slider and curve buttons change the feel.
- At mobile width (375px): no horizontal page scroll; pending cards swipe with the mouse; the page still scrolls vertically.
- Bars: rounded caps don't look stretched during the grow.
- Reduced motion: the Browser pane cannot emulate `prefers-reduced-motion`. Rely on the unit tests and say so in the report.
- Open `/motion-lab` as a non-admin (or signed out): redirected away.
- Screenshot for the owner.

- [ ] **Step 5: Ask the owner before pushing**

Pushing `main` deploys to production. The lab is admin-only and changes no existing screen, but ask the owner in chat before `git push`. After deploy, the owner opens `https://<production domain>/motion-lab` on their phone.

Report what was verified and what was not: haptics cannot be felt from this machine and need a native rebuild; reduced motion checked by unit tests (and in browser only if Step 4 managed it).

---

## After this plan

The owner reports the chosen speed and curve. Those values are written into
`GLIDE` / `GLIDE_EASE` (with the `motion.test.ts` expectations updated), then
Round 1 (navigation, page changes, shared basics) gets its own plan.
