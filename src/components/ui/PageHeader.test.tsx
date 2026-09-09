// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import PageHeader, { PageHeaderChip } from './PageHeader'
import { PageHeaderContext, type PageHero } from '@/layouts/PageHeaderContext'

afterEach(cleanup)

/** Captures the observer callback so a test can drive the scroll hand-off. */
function stubIntersectionObserver() {
  let trigger: ((entries: { isIntersecting: boolean }[]) => void) | undefined
  const disconnect = vi.fn()
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
        trigger = cb
      }
      observe() {}
      disconnect = disconnect
      unobserve() {}
      takeRecords() {
        return []
      }
      root = null
      rootMargin = ''
      thresholds = []
    }
  )
  return {
    fire: (isIntersecting: boolean) => trigger?.([{ isIntersecting }]),
    disconnect,
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('PageHeader', () => {
  it('renders the page name once, as the only h1', () => {
    render(
      <PageHeader
        title="Transactions"
        eyebrow={<PageHeaderChip>Bank Alert Engine Active</PageHeaderChip>}
        subtitle="Every rupee in and out, for the range you pick."
        actions={<button>Add Transaction</button>}
      />
    )

    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0].textContent).toBe('Transactions')
    expect(screen.getByText('Bank Alert Engine Active')).toBeDefined()
    expect(screen.getByText('Every rupee in and out, for the range you pick.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Add Transaction' })).toBeDefined()
  })

  it('tells the layout the hero is visible, then hidden once it scrolls away', () => {
    const observer = stubIntersectionObserver()
    const reports: PageHero[] = []

    render(
      <PageHeaderContext.Provider value={{ setHero: (h) => reports.push(h) }}>
        <PageHeader title="Budgets" />
      </PageHeaderContext.Provider>
    )

    observer.fire(true)
    expect(reports.at(-1)).toEqual({ state: 'visible', title: 'Budgets' })

    observer.fire(false)
    expect(reports.at(-1)).toEqual({ state: 'hidden', title: 'Budgets' })
  })

  it('reports stickyTitle when the heading itself is not the page name', () => {
    const observer = stubIntersectionObserver()
    const reports: PageHero[] = []

    render(
      <PageHeaderContext.Provider value={{ setHero: (h) => reports.push(h) }}>
        <PageHeader title="Hello, Priya" stickyTitle="Home" />
      </PageHeaderContext.Provider>
    )

    observer.fire(false)
    expect(reports.at(-1)).toEqual({ state: 'hidden', title: 'Home' })
  })

  it('releases the title back to the layout when the page unmounts', () => {
    stubIntersectionObserver()
    const reports: PageHero[] = []

    const { unmount } = render(
      <PageHeaderContext.Provider value={{ setHero: (h) => reports.push(h) }}>
        <PageHeader title="Insights" />
      </PageHeaderContext.Provider>
    )
    unmount()

    expect(reports.at(-1)).toEqual({ state: 'none' })
  })
})
