// @vitest-environment jsdom
// ============================================
// ScrollToTop — a section link must work on every tap, not just the first
//
// Reproduced on production at a 375px viewport: open the menu, tap FAQ, scroll
// back up, tap FAQ again — nothing happened. The URL was already /#faq, so
// pathname/search/hash were unchanged and the effect never re-ran.
// ============================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { MemoryRouter, Link } from 'react-router-dom'
import ScrollToTop from './ScrollToTop'

describe('ScrollToTop', () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockReset()
    Element.prototype.scrollIntoView = scrollIntoView
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo
  })
  afterEach(cleanup)

  function renderPage() {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ScrollToTop />
        <Link to="/#faq">FAQ</Link>
        <Link to="/pricing">Pricing</Link>
        <section id="faq">faq</section>
      </MemoryRouter>
    )
  }

  it('scrolls to the section when its link is tapped', () => {
    renderPage()
    fireEvent.click(screen.getByText('FAQ'))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('scrolls to the section again when the same link is tapped a second time', () => {
    renderPage()
    fireEvent.click(screen.getByText('FAQ'))
    fireEvent.click(screen.getByText('FAQ'))
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it('does not scroll when only the auth modal param changes', () => {
    render(
      <MemoryRouter initialEntries={['/pricing']}>
        <ScrollToTop />
        <Link to="/pricing?auth=login">Sign in</Link>
      </MemoryRouter>
    )
    const scrollTo = window.scrollTo as unknown as ReturnType<typeof vi.fn>
    scrollTo.mockClear()
    fireEvent.click(screen.getByText('Sign in'))
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
