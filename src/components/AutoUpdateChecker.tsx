import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * AutoUpdateChecker component
 *
 * Polls index.html for newly deployed script/style hashes and moves the tab
 * onto the new build — but only at a route change.
 *
 * It used to reload the moment a new build was noticed, including when the tab
 * regained focus. On a phone that is every return from another app, and the
 * reload threw away whatever was open: a half-filled expense form, a scroll
 * position in Pending. Now focus, visibility and the timer only DETECT an
 * update; it is applied on the next navigation, when the page being left is
 * being discarded anyway, by reloading straight into the destination.
 *
 * Asset load failures are handled by the inline listener in index.html and by
 * lazyWithRetry + ErrorBoundary for route chunks.
 */
export default function AutoUpdateChecker() {
  const { pathname } = useLocation()
  const checkRef = useRef<() => Promise<boolean>>(undefined)
  const updatePending = useRef(false)
  const isFirstRoute = useRef(true)

  useEffect(() => {
    if (typeof window === 'undefined') return

    // Extract current script/link hashes from DOM
    const scripts = Array.from(document.querySelectorAll('script'))
    const currentJsHash = scripts
      .map((s) => s.src.match(/assets\/index-([a-zA-Z0-9_-]+)\.js/)?.[1])
      .find(Boolean)

    const links = Array.from(document.querySelectorAll('link'))
    const currentCssHash = links
      .map((l) => l.href.match(/assets\/index-([a-zA-Z0-9_-]+)\.css/)?.[1])
      .find(Boolean)

    // If no compiled index hashes are found, assume we are in development mode and skip check
    if (!currentJsHash && !currentCssHash) {
      return
    }

    const checkForUpdates = async (): Promise<boolean> => {
      if (updatePending.current) return true
      try {
        // The service worker deliberately does not cache this request (see sw.js).
        const res = await fetch('/index.html?t=' + Date.now(), { cache: 'no-store' })
        if (!res.ok) return false

        const html = await res.text()
        const fetchedJsHash = html.match(/assets\/index-([a-zA-Z0-9_-]+)\.js/)?.[1]
        const fetchedCssHash = html.match(/assets\/index-([a-zA-Z0-9_-]+)\.css/)?.[1]

        const hasUpdate =
          (!!fetchedJsHash && fetchedJsHash !== currentJsHash) ||
          (!!fetchedCssHash && fetchedCssHash !== currentCssHash)
        if (hasUpdate) {
          console.log('webapp: new update detected; it will apply on the next navigation.')
          updatePending.current = true
        }
        return hasUpdate
      } catch (err) {
        console.warn('webapp: failed to fetch auto-update logs', err)
        return false
      }
    }

    checkRef.current = checkForUpdates

    // A hidden tab has no one to update for; skip the fetch rather than spend a
    // phone's data and battery on it.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') checkForUpdates()
    }, 30000)

    const handleTrigger = () => {
      if (document.visibilityState === 'visible') checkForUpdates()
    }
    window.addEventListener('focus', handleTrigger)
    document.addEventListener('visibilitychange', handleTrigger)

    checkForUpdates()

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleTrigger)
      document.removeEventListener('visibilitychange', handleTrigger)
    }
  }, [])

  // A route change is the safe moment: the router has already moved to the new
  // URL, nothing on the new page has been touched yet, and reloading loads the
  // destination on the new build.
  useEffect(() => {
    if (isFirstRoute.current) {
      isFirstRoute.current = false
      return
    }
    const apply = () => {
      try {
        const nowTime = Date.now()
        // This key guards THIS reload only. Route-chunk recovery has its own
        // ('intrack_last_chunk_reload', chunkLoad.ts): sharing one key meant an
        // update reload suppressed the chunk reload that had to follow it.
        const lastReload = sessionStorage.getItem('intrack_last_auto_reload')
        if (lastReload && nowTime - Number(lastReload) < 10000) {
          console.warn('webapp: auto-reload loop detected & suppressed.')
          return
        }
        sessionStorage.setItem('intrack_last_auto_reload', String(nowTime))
      } catch { /* sessionStorage blocked; the reload loop-guard fails open. */ }
      window.location.reload()
    }
    if (updatePending.current) {
      apply()
      return
    }
    let cancelled = false
    checkRef.current?.().then((found) => {
      if (found && !cancelled) apply()
    })
    return () => { cancelled = true }
  }, [pathname])

  return null
}
