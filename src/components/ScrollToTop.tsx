import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

export default function ScrollToTop() {
  const { pathname, search, hash, key } = useLocation()

  useEffect(() => {
    // Check if the change is just an auth modal query param opening/closing
    const params = new URLSearchParams(search)
    // If it has 'auth' and nothing else, ignore. If it has 'auth' and others, or no 'auth', we scroll to top.
    const isOnlyAuthChange = params.has('auth') && Array.from(params.keys()).length === 1
    if (isOnlyAuthChange) return

    // A hash means "take me to that section", which is the opposite of scrolling
    // to the top. Cross-page links like /#features used to be plain <a> tags so
    // the browser handled this with a full page reload; now that they route
    // client-side, the scroll is ours to perform.
    if (hash) {
      // decodeURIComponent THROWS on a lone '%'. This code path runs on every
      // Google OAuth callback, whose hash carries provider tokens and, on
      // failure, an `error_description` of arbitrary text — so an undecodable
      // hash must degrade to the raw string, never take down the sign-in
      // redirect with a URIError.
      let id: string
      try {
        id = decodeURIComponent(hash.slice(1))
      } catch {
        id = hash.slice(1)
      }
      // The target belongs to the route being navigated TO, which may not have
      // mounted yet. So poll rather than checking once.
      //
      // setTimeout, NOT requestAnimationFrame. rAF is paused outright in a
      // backgrounded or non-compositing tab — the same hazard documented on
      // AnimatedRoutes in App.tsx — which would leave the scroll silently undone.
      // A hash carrying key=value pairs is an auth callback payload, not an
      // anchor name. Bail immediately rather than spending 1.2s polling for an
      // element that cannot exist — this runs on every Google sign-in.
      if (!id || id.includes('=') || id.includes('&')) {
        window.scrollTo(0, 0)
        return
      }

      let cancelled = false
      const deadline = Date.now() + 1200
      const tryScroll = () => {
        if (cancelled) return
        const el = document.getElementById(id)
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          return
        }
        if (Date.now() < deadline) {
          setTimeout(tryScroll, 60)
          return
        }
        // Gave up. Normal for a hash that was never an anchor — above all
        // Supabase's OAuth `#access_token=…` callback.
        window.scrollTo(0, 0)
      }
      tryScroll()
      return () => { cancelled = true }
    }

    window.scrollTo(0, 0)
    // `key` is in the deps on purpose. Tapping a link to the URL already in the
    // address bar — "FAQ" again after scrolling away from it — changes nothing
    // but the location key. Without it the effect never re-ran and the tap did
    // nothing, which on mobile read as a dead link.
  }, [pathname, search, hash, key])

  return null
}
