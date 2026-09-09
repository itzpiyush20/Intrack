// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import AnimatedNumber from './AnimatedNumber'
import AnimatedBar from './AnimatedBar'

/**
 * `useReducedMotion` reads `matchMedia`, which jsdom does not implement.
 * Every test says explicitly which kind of visitor it is rendering for.
 */
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

const rupees = (n: number) => `₹${Math.round(n)}`

afterEach(cleanup)

describe('AnimatedNumber', () => {
  describe('with reduced motion requested', () => {
    beforeEach(() => setReducedMotion(true))

    it('shows the exact value with no count-up at all', () => {
      render(<AnimatedNumber value={4200} format={rupees} />)
      expect(screen.getByText('₹4200')).toBeDefined()
    })

    it('shows the new value immediately when it changes', () => {
      const { rerender } = render(<AnimatedNumber value={4200} format={rupees} />)
      rerender(<AnimatedNumber value={900} format={rupees} />)
      expect(screen.getByText('₹900')).toBeDefined()
    })
  })

  describe('with motion allowed', () => {
    beforeEach(() => setReducedMotion(false))

    it('lands exactly on the value rather than near it', async () => {
      render(<AnimatedNumber value={4200} format={rupees} duration={0.05} />)
      // A count-up that stops one frame short of an eased tween would render
      // ₹4199 forever, which is simply a wrong figure on the card.
      await waitFor(() => expect(screen.getByText('₹4200')).toBeDefined())
    })

    it('counts to the new value when the period changes', async () => {
      const { rerender } = render(<AnimatedNumber value={4200} format={rupees} duration={0.05} />)
      await waitFor(() => expect(screen.getByText('₹4200')).toBeDefined())

      rerender(<AnimatedNumber value={900} format={rupees} duration={0.05} />)
      await waitFor(() => expect(screen.getByText('₹900')).toBeDefined())
    })
  })
})

describe('AnimatedBar', () => {
  beforeEach(() => setReducedMotion(true))

  it('is decorative, because the bar always sits beside its labelled figure', () => {
    const { container } = render(<AnimatedBar percent={40} />)
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })

  it('clamps a share that overshoots or is not a number', () => {
    const { container: over } = render(<AnimatedBar percent={140} />)
    expect((over.firstChild as HTMLElement).style.width).toBe('100%')

    cleanup()

    const { container: nan } = render(<AnimatedBar percent={Number.NaN} />)
    expect((nan.firstChild as HTMLElement).style.width).toBe('0%')
  })

  it('grows a column by height rather than width', () => {
    const { container } = render(<AnimatedBar percent={60} orientation="vertical" />)
    const bar = container.firstChild as HTMLElement
    expect(bar.style.height).toBe('60%')
  })
})
