import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * AutoUpdateChecker component
 * Periodically polls the root index.html to check for newly deployed script/style hashes.
 * If a new build is detected (asset hashes mismatch) or if asset load errors occur,
 * it automatically reloads the page to inject the latest update without forcing sign-out.
 */
export default function AutoUpdateChecker() {
  const location = useLocation()
  const checkRef = useRef<() => void>(undefined)

  useEffect(() => {
    // Only verify updates if running in browser environment
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

    const checkForUpdates = async () => {
      try {
        // Query the root index file with a cache-buster query parameter
        const res = await fetch('/index.html?t=' + Date.now(), { cache: 'no-store' })
        if (!res.ok) return
        
        const html = await res.text()

        // Extract script/style hashes from server's latest index.html
        const fetchedJsHash = html.match(/assets\/index-([a-zA-Z0-9_-]+)\.js/)?.[1]
        const fetchedCssHash = html.match(/assets\/index-([a-zA-Z0-9_-]+)\.css/)?.[1]

        let hasUpdate = false

        if (fetchedJsHash && fetchedJsHash !== currentJsHash) {
          hasUpdate = true
        }
        if (fetchedCssHash && fetchedCssHash !== currentCssHash) {
          hasUpdate = true
        }

        if (hasUpdate) {
          console.log('webapp: new update detected! Reloading page to apply updates...')
          try {
            const nowTime = Date.now()
            const lastReload = sessionStorage.getItem('intrack_last_auto_reload')
            if (lastReload && nowTime - Number(lastReload) < 10000) {
              console.warn('webapp: auto-reload loop detected & suppressed.')
              return
            }
            sessionStorage.setItem('intrack_last_auto_reload', String(nowTime))
          } catch (e) {}
          window.location.reload()
        }
      } catch (err) {
        console.warn('webapp: failed to fetch auto-update logs', err)
      }
    }

    checkRef.current = checkForUpdates

    // Check every 30 seconds for fast update propagation
    const interval = setInterval(checkForUpdates, 30000)

    // Check immediately when user refocuses or returns to tab
    const handleTrigger = () => {
      checkForUpdates()
    }
    window.addEventListener('focus', handleTrigger)
    document.addEventListener('visibilitychange', handleTrigger)

    // Error event listener to catch any chunk dynamic loading failures
    const handleAssetLoadError = (e: ErrorEvent) => {
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
        const src = (target as HTMLScriptElement).src || (target as HTMLLinkElement).href
        if (src && (src.includes('/assets/') || src.includes('index-'))) {
          console.warn('webapp: asset loading failed, checking for reload loop...', src)
          try {
            const nowTime = Date.now()
            const lastReload = sessionStorage.getItem('intrack_last_auto_reload')
            if (lastReload && nowTime - Number(lastReload) < 15000) {
              console.warn('webapp: auto-reload loop detected via error listener & suppressed.')
              return
            }
            sessionStorage.setItem('intrack_last_auto_reload', String(nowTime))
          } catch (err) {}
          window.location.reload()
        }
      }
    }
    window.addEventListener('error', handleAssetLoadError, true)

    // Run initial check
    checkForUpdates()

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', handleTrigger)
      document.removeEventListener('visibilitychange', handleTrigger)
      window.removeEventListener('error', handleAssetLoadError, true)
    }
  }, [])

  // Trigger check on every routing change / tab switch
  useEffect(() => {
    if (checkRef.current) {
      checkRef.current()
    }
  }, [location.pathname])

  return null
}
