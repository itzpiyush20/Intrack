// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AnimatePresence, motion } from 'framer-motion'
import SwipeCard, { type SwipeCardProps } from './SwipeCard'

// Reduced motion collapses every glide to zero duration, so the tests are
// about the action guard, not animation timing.
vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => true,
}))

afterEach(cleanup)

// The buttons are deliberately NOT disabled while leaving here: a disabled
// button swallows the click in React, which would hide a missing guard.
function renderCard(props: Pick<SwipeCardProps, 'onSwipeRight' | 'onSwipeLeft'>) {
  return render(
    <SwipeCard {...props}>
      {({ swipeRight, swipeLeft, leaving }) => (
        <div>
          <button type="button" onClick={swipeRight}>Approve</button>
          <button type="button" onClick={swipeLeft}>Reject</button>
          <span data-testid="leaving">{String(leaving)}</span>
        </div>
      )}
    </SwipeCard>,
  )
}

describe('SwipeCard', () => {
  it('fires the action once when its button is pressed twice', () => {
    const onSwipeRight = vi.fn()
    renderCard({ onSwipeRight, onSwipeLeft: vi.fn() })
    fireEvent.click(screen.getByText('Approve'))
    fireEvent.click(screen.getByText('Approve'))
    expect(onSwipeRight).toHaveBeenCalledTimes(1)
  })

  it('ignores the opposite action once one has been taken', () => {
    const onSwipeRight = vi.fn()
    const onSwipeLeft = vi.fn()
    renderCard({ onSwipeRight, onSwipeLeft })
    fireEvent.click(screen.getByText('Approve'))
    fireEvent.click(screen.getByText('Reject'))
    expect(onSwipeRight).toHaveBeenCalledTimes(1)
    expect(onSwipeLeft).not.toHaveBeenCalled()
  })

  it('acts immediately, not after the exit animation', () => {
    const onSwipeLeft = vi.fn()
    renderCard({ onSwipeRight: vi.fn(), onSwipeLeft })
    fireEvent.click(screen.getByText('Reject'))
    expect(onSwipeLeft).toHaveBeenCalledTimes(1)
  })

  it('exposes leaving once an action is taken', () => {
    renderCard({ onSwipeRight: vi.fn(), onSwipeLeft: vi.fn() })
    expect(screen.getByTestId('leaving').textContent).toBe('false')
    fireEvent.click(screen.getByText('Approve'))
    expect(screen.getByTestId('leaving').textContent).toBe('true')
  })

  it('lets the card act again after the action reports failure with false', async () => {
    const onSwipeRight = vi.fn().mockReturnValueOnce(false)
    renderCard({ onSwipeRight, onSwipeLeft: vi.fn() })
    fireEvent.click(screen.getByText('Approve'))
    await waitFor(() => expect(screen.getByTestId('leaving').textContent).toBe('false'))
    fireEvent.click(screen.getByText('Approve'))
    expect(onSwipeRight).toHaveBeenCalledTimes(2)
  })

  it('lets the card act again after the action resolves false or rejects', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onSwipeLeft = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error('network'))
    renderCard({ onSwipeRight: vi.fn(), onSwipeLeft })

    fireEvent.click(screen.getByText('Reject'))
    await waitFor(() => expect(screen.getByTestId('leaving').textContent).toBe('false'))
    fireEvent.click(screen.getByText('Reject'))
    await waitFor(() => expect(error).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('leaving').textContent).toBe('false'))
    fireEvent.click(screen.getByText('Reject'))

    expect(onSwipeLeft).toHaveBeenCalledTimes(3)
    error.mockRestore()
  })

  it('resets when brought back under the same key while its exit is still running', async () => {
    // A long parent exit keeps the removed card mounted, so bringing it back
    // reuses this very instance (framer's AnimatePresence behaviour).
    const onSwipeRight = vi.fn()
    const tree = (shown: boolean) => (
      <AnimatePresence>
        {shown && (
          <motion.div key="card" exit={{ opacity: 0 }} transition={{ duration: 60 }}>
            <SwipeCard onSwipeRight={onSwipeRight} onSwipeLeft={vi.fn()}>
              {({ swipeRight, leaving }) => (
                <div>
                  <button type="button" onClick={swipeRight}>Approve</button>
                  <span data-testid="leaving">{String(leaving)}</span>
                </div>
              )}
            </SwipeCard>
          </motion.div>
        )}
      </AnimatePresence>
    )
    const { rerender } = render(tree(true))
    fireEvent.click(screen.getByText('Approve'))
    rerender(tree(false))
    expect(screen.getByTestId('leaving').textContent).toBe('true')
    rerender(tree(true))
    await waitFor(() => expect(screen.getByTestId('leaving').textContent).toBe('false'))
    fireEvent.click(screen.getByText('Approve'))
    expect(onSwipeRight).toHaveBeenCalledTimes(2)
  })

  it('stays gone when the action succeeds', async () => {
    const onSwipeRight = vi.fn().mockResolvedValue(true)
    renderCard({ onSwipeRight, onSwipeLeft: vi.fn() })
    fireEvent.click(screen.getByText('Approve'))
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.getByTestId('leaving').textContent).toBe('true')
    fireEvent.click(screen.getByText('Approve'))
    expect(onSwipeRight).toHaveBeenCalledTimes(1)
  })
})
