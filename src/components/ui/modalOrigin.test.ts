// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPEN_ADD_TRANSACTION_EVENT, ORIGIN_SCALE, addTransactionOrigin, centreOf,
  openAddTransaction, transformOriginFor,
} from './modalOrigin'

describe('transformOriginFor', () => {
  it('places the origin on the opener, relative to the panel box', () => {
    // Panel 400x300 centred at (500, 400): box starts at (300, 250).
    expect(transformOriginFor({ x: 350, y: 900 }, { x: 500, y: 400 }, 400, 300)).toBe('50px 650px')
  })

  it('is the panel centre when the opener is the panel centre', () => {
    expect(transformOriginFor({ x: 500, y: 400 }, { x: 500, y: 400 }, 400, 300)).toBe('200px 150px')
  })

  it('rounds to whole pixels', () => {
    expect(transformOriginFor({ x: 10.4, y: 10.6 }, { x: 0, y: 0 }, 0, 0)).toBe('10px 11px')
  })
})

describe('opening the Add form from a button', () => {
  afterEach(() => vi.restoreAllMocks())

  it('scales gently, never from nothing', () => {
    expect(ORIGIN_SCALE).toBeGreaterThanOrEqual(0.9)
    expect(ORIGIN_SCALE).toBeLessThan(1)
  })

  it('carries the tapped button centre in the event', () => {
    const button = document.createElement('button')
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      left: 100, top: 700, width: 48, height: 48, right: 148, bottom: 748, x: 100, y: 700, toJSON: () => ({}),
    })
    expect(centreOf(button)).toEqual({ x: 124, y: 724 })

    const seen = vi.fn()
    const listener = (e: Event) => seen(addTransactionOrigin(e))
    window.addEventListener(OPEN_ADD_TRANSACTION_EVENT, listener)
    openAddTransaction(button)
    openAddTransaction()
    window.removeEventListener(OPEN_ADD_TRANSACTION_EVENT, listener)

    expect(seen).toHaveBeenNthCalledWith(1, { x: 124, y: 724 })
    expect(seen).toHaveBeenNthCalledWith(2, undefined)
  })

  it('ignores an event with no usable origin', () => {
    expect(addTransactionOrigin(new CustomEvent('x'))).toBeUndefined()
    expect(addTransactionOrigin(new CustomEvent('x', { detail: { origin: { x: NaN, y: 1 } } }))).toBeUndefined()
  })
})
