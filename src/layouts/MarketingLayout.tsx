import { useEffect, type ReactNode } from 'react'
import { setPageMeta } from '@/utils/seo'
import { APP_CONFIG } from '@/constants'
import { SiteFooter, MarketingHeader } from '@/components/ui'

interface MarketingLayoutProps {
  children: ReactNode
  title: string
  /**
   * Search-result and link-preview summary for this page. Optional only so the
   * layout keeps working if a future page forgets it — every current caller
   * passes one, because without it the page inherits index.html's generic
   * description and is indistinguishable from every other route.
   */
  description?: string
}

export default function MarketingLayout({ children, title, description }: MarketingLayoutProps) {
  useEffect(() => {
    const fullTitle = `${title} | ${APP_CONFIG.APP_NAME}`
    if (description) setPageMeta({ title: fullTitle, description })
    else document.title = fullTitle
    window.scrollTo(0, 0)
  }, [title, description])

  return (
    <div className="min-h-screen bg-sb-canvas text-sb-ink-secondary flex flex-col">
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>
      {/* Header — shared with the landing page. This used to be a cut-down bar
          with the wordmark and a Sign in link and NOTHING else, so a reader on
          /privacy or /terms had no route to Pricing or Support at all. */}
      <MarketingHeader />

      {/* Main Content */}
      <main id="main-content" className="max-w-4xl mx-auto px-6 py-16 flex-1 w-full">
        {children}
      </main>

      {/* Footer */}
      <SiteFooter className="py-8 px-4" />
    </div>
  )
}
