// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useCoarsePointer } from './useCoarsePointer'

function Probe() {
  return <span data-testid="coarse">{String(useCoarsePointer())}</span>
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function stubMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>()
  const list = {
    matches: initial,
    addEventListener: (_: string, cb: () => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: () => void) => listeners.delete(cb),
  }
  vi.stubGlobal('matchMedia', (query: string) => {
    expect(query).toBe('(pointer: coarse)')
    return list
  })
  return {
    set(value: boolean) {
      list.matches = value
      listeners.forEach((cb) => cb())
    },
  }
}

describe('useCoarsePointer', () => {
  it('is false where matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<Probe />)
    expect(screen.getByTestId('coarse').textContent).toBe('false')
  })

  it('follows the (pointer: coarse) query as it changes', () => {
    const mq = stubMatchMedia(true)
    render(<Probe />)
    expect(screen.getByTestId('coarse').textContent).toBe('true')
    act(() => mq.set(false))
    expect(screen.getByTestId('coarse').textContent).toBe('false')
  })
})
