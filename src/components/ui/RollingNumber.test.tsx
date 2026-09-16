// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { hasReducedMotionListener } from 'motion-dom'
import { splitForRolling } from './rollingDigits'
import RollingNumber from './RollingNumber'

const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`

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
  // framer-motion's useReducedMotion lazily reads matchMedia exactly once per
  // module instance and caches the result forever (motion-dom's
  // hasReducedMotionListener singleton). Without this reset, whichever
  // describe block renders first in this file would pin every later test to
  // its reduced-motion value regardless of the matchMedia mock above.
  hasReducedMotionListener.current = false
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
