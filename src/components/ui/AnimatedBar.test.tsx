// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/react'
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

afterEach(cleanup)

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

describe('AnimatedBar with motion allowed', () => {
  beforeEach(() => setReducedMotion(false))

  it('glides from the old value to the new one on the same element, never resetting to 0%', async () => {
    const { container, rerender } = render(<AnimatedBar percent={40} duration={0.05} />)
    const bar = container.firstChild as HTMLElement

    rerender(<AnimatedBar percent={75} duration={0.05} />)

    // Same DOM node: a period change updates the existing bar rather than
    // remounting a fresh one that would restart from 0%.
    expect(container.firstChild).toBe(bar)
    await waitFor(() => expect(bar.style.width).toBe('75%'))
  })
})
