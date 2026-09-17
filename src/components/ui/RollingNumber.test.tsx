// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { splitForRolling } from './rollingDigits'
import RollingNumber from './RollingNumber'

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

// framer-motion's real useReducedMotion reads matchMedia lazily and caches
// the result for the life of the module, so flipping matchMedia between
// tests does not reliably flip it back. Mock the hook directly instead —
// `reduced` is vi.hoisted so the mock factory (which vitest hoists above
// these imports) can close over it.
const reduced = vi.hoisted(() => ({ value: false }))

vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => reduced.value,
}))

function setReducedMotion(value: boolean) {
  reduced.value = value
}

afterEach(cleanup)

describe('splitForRolling', () => {
  it('marks digits and keeps other characters as they are', () => {
    expect(splitForRolling('₹4,2')).toEqual([
      { key: 'i3', char: '₹', digit: null },
      { key: 'i2', char: '4', digit: 4 },
      { key: 'i1', char: ',', digit: null },
      { key: 'i0', char: '2', digit: 2 },
    ])
  })

  it('keys from the decimal point (or the end), so the last digits keep their slot when the figure grows', () => {
    // ₹42,350 → ₹1,42,850: the "50" at the end must be the same slots, or
    // React remounts them and every digit rolls instead of only the changed ones.
    const before = splitForRolling('₹42,350')
    const after = splitForRolling('₹1,42,850')
    expect(before.at(-1)).toMatchObject({ key: 'i0', digit: 0 })
    expect(after.at(-1)).toMatchObject({ key: 'i0', digit: 0 })
    expect(before.at(-2)).toMatchObject({ key: 'i1', digit: 5 })
    expect(after.at(-2)).toMatchObject({ key: 'i1', digit: 5 })
  })

  it('keeps every integer-part key identical when a decimal part is added', () => {
    // ₹42,350 → ₹42,350.75: gaining a fractional part must not reshuffle a
    // single integer-part slot.
    const before = splitForRolling('₹42,350')
    const after = splitForRolling('₹42,350.75')
    expect(after.slice(0, before.length)).toEqual(before)
    expect(after.at(-3)).toMatchObject({ key: 'dot', char: '.', digit: null })
    expect(after.at(-2)).toMatchObject({ key: 'f0', char: '7', digit: 7 })
    expect(after.at(-1)).toMatchObject({ key: 'f1', char: '5', digit: 5 })
  })
})

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

    it('hides the rolling digit slots from screen readers', () => {
      const { container } = render(<RollingNumber value={42350} format={rupees} />)
      const hiddenWrapper = container.querySelector('[aria-hidden="true"]')
      expect(hiddenWrapper).not.toBeNull()
      expect(hiddenWrapper?.querySelectorAll('[data-roll-slot]').length).toBe(5)
    })

    it('reports the new figure when the value changes', () => {
      const { rerender } = render(<RollingNumber value={42350} format={rupees} />)
      rerender(<RollingNumber value={142850} format={rupees} />)
      expect(screen.getByText('₹1,42,850')).toBeDefined()
    })

    it('renders a compact figure with a unit letter, e.g. formatCurrencyCompact\'s "₹1.2L"', () => {
      // The unit letter ("L", "Cr", "K") is a non-digit token like ₹ or a
      // comma — splitForRolling must not choke on it or treat it as a digit.
      const compact = (n: number) => `₹${(n / 100000).toFixed(1)}L`
      const { container } = render(<RollingNumber value={120000} format={compact} />)
      expect(screen.getByText('₹1.2L')).toBeDefined()
      // Digit slots: '1' and '2' only — ₹, '.', and 'L' are static tokens.
      expect(container.querySelectorAll('[data-roll-slot]').length).toBe(2)
    })
  })
})
