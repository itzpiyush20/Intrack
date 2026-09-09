// ============================================
// PageHeaderContext — hand-off between the in-page hero title and the
// compact title in the sticky top bar.
//
// Only one of the two is ever on screen: PageHeader reports whether its
// own <h1> is still in view, and AppLayout shows the top-bar title only
// once that heading has scrolled away.
//
// PageHeader also reports the heading text, so the top bar echoes the
// page's own words rather than a second hard-coded list that has to be
// kept in step with it. Rename a page heading and the top bar follows.
// A route with no PageHeader reports nothing, and the top bar falls back
// to getCurrentPageTitle as before.
// ============================================

import { createContext, useContext, useEffect, type RefObject } from 'react'

/** 'none' = no page hero on this route, so the top bar owns the title. */
export type PageHeroState = 'none' | 'visible' | 'hidden'

export interface PageHero {
  state: PageHeroState
  /** The page's own heading, or undefined to fall back to the route map. */
  title?: string
}

interface PageHeaderContextValue {
  /** Called by PageHeader on mount, on scroll and (with 'none') on unmount. */
  setHero: (hero: PageHero) => void
}

export const PageHeaderContext = createContext<PageHeaderContextValue | null>(null)

export function usePageHeroReporter(): PageHeaderContextValue['setHero'] {
  const ctx = useContext(PageHeaderContext)
  // Rendered outside AppLayout (marketing routes, tests) — nothing to report to.
  return ctx?.setHero ?? (() => {})
}

/** Height of the sticky header, so the hand-off happens as the title slides under it. */
const STICKY_HEADER_OFFSET = 72

/**
 * Reports a page heading's visibility to the layout for as long as it is
 * mounted. PageHeader uses this; so does any page whose heading is too
 * distinctive to fold into PageHeader (the centred Pricing hero).
 *
 * `title` is what the top bar should say — usually the heading's own words.
 */
export function usePageHeroHandoff(
  ref: RefObject<HTMLElement | null>,
  title?: string
): void {
  const setHero = usePageHeroReporter()

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      // No observer (older browser, jsdom): keep the hero as the only title.
      setHero({ state: 'visible', title })
      return () => setHero({ state: 'none' })
    }

    const observer = new IntersectionObserver(
      ([entry]) => setHero({ state: entry.isIntersecting ? 'visible' : 'hidden', title }),
      { rootMargin: `-${STICKY_HEADER_OFFSET}px 0px 0px 0px`, threshold: 0 }
    )
    observer.observe(node)

    return () => {
      observer.disconnect()
      setHero({ state: 'none' })
    }
  }, [ref, setHero, title])
}
