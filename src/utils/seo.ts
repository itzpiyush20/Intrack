// ============================================
// SEO — page title, description, canonical and social tags
//
// This is a client-rendered SPA: index.html ships ONE title and ONE
// description for every route, and each page then overwrote document.title in
// its own useEffect. Nothing set a canonical URL, and og:url pointed at the
// site root no matter which page was shared. So /privacy, /terms, /pricing and
// /about were, to any crawler that does not run JavaScript, the same page.
//
// Everything here mutates tags that already exist in index.html where
// possible, and creates them when they do not.
// ============================================

/**
 * The site's public origin.
 *
 * MOVING TO A CUSTOM DOMAIN? The origin appears in four places, and two of
 * them are static files that cannot import this constant. Change all four or
 * the move is half-done — a stale canonical or sitemap is worse than none,
 * because it actively points crawlers at the old host:
 *
 *   1. here                     — canonical + og:url at runtime
 *   2. index.html               — the static canonical/og/twitter defaults
 *   3. public/sitemap.xml       — every <loc>
 *   4. public/robots.txt        — the Sitemap: line
 *
 * Also update the platform URL named in PrivacyPage §1.
 */
export const SITE_ORIGIN = 'https://www.intrack.co.in'

export interface PageMeta {
  /** Full <title>, already including the brand. */
  title: string
  /** ~150-160 chars. Shown in search results and link previews. */
  description: string
  /** Route path for the canonical URL, e.g. '/pricing'. Defaults to the current path. */
  canonicalPath?: string
}

function upsertMeta(selector: string, attr: 'name' | 'property', key: string, content: string): void {
  let el = document.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content)
}

/** Point <link rel="canonical"> and og:url at this route. */
export function setCanonical(path: string): void {
  try {
    // Strip query and hash: ?auth=login and #features are the same document as
    // the bare path, and duplicate canonicals split ranking between them.
    const cleanPath = path.split('?')[0].split('#')[0] || '/'
    const url = cleanPath === '/' ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${cleanPath}`

    let link = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!link) {
      link = document.createElement('link')
      link.rel = 'canonical'
      document.head.appendChild(link)
    }
    link.href = url

    upsertMeta('meta[property="og:url"]', 'property', 'og:url', url)
    upsertMeta('meta[property="twitter:url"]', 'property', 'twitter:url', url)
  } catch {
    // Metadata is never worth breaking a render over.
  }
}

/**
 * Set everything a crawler or a link preview reads for this page.
 * Safe to call from a useEffect on every public route.
 */
export function setPageMeta({ title, description, canonicalPath }: PageMeta): void {
  try {
    document.title = title
    upsertMeta('meta[name="description"]', 'name', 'description', description)
    upsertMeta('meta[property="og:title"]', 'property', 'og:title', title)
    upsertMeta('meta[property="og:description"]', 'property', 'og:description', description)
    upsertMeta('meta[property="twitter:title"]', 'property', 'twitter:title', title)
    upsertMeta('meta[property="twitter:description"]', 'property', 'twitter:description', description)
    setCanonical(canonicalPath ?? window.location.pathname)
  } catch {
    // As above.
  }
}
