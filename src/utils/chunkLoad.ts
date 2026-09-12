// ============================================
// chunkLoad — surviving a route chunk that fails to download
//
// Every page is a React.lazy() chunk. On a phone the download fails for two
// ordinary reasons: a network blip, or a tab left open across a deploy so the
// old hashed filename is gone. React.lazy caches the rejected promise, so the
// route stays broken until the page is reloaded — which users experienced as
// "links stop working until I refresh".
//
// So: retry the import once (helps browsers that do not remember a failed
// import; see retryImport), and when that fails, ErrorBoundary reloads once,
// which covers both the blip and the deploy. The reload guard is shared with
// the asset-error handler in index.html and AutoUpdateChecker.
// ============================================

import { lazy, type ComponentType, type LazyExoticComponent } from 'react'

// Chrome, Firefox, Safari, Vite's CSS preload, and a 404 served as HTML.
const CHUNK_ERROR =
  /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|unable to preload css|loading (css )?chunk [\w-]+ failed/i

export function isChunkLoadError(err: unknown): boolean {
  if (!err) return false
  if (typeof err === 'string') return CHUNK_ERROR.test(err)
  const e = err as { name?: unknown; message?: unknown }
  if (e.name === 'ChunkLoadError') return true
  return typeof e.message === 'string' && CHUNK_ERROR.test(e.message)
}

export const RELOAD_GUARD_KEY = 'intrack_last_auto_reload'
const RELOAD_GUARD_MS = 15000

/**
 * Reloads the page unless a reload already happened in the last 15s.
 * Returns whether it reloaded. With storage blocked there is no loop guard, so
 * it does NOT reload — an endless reload loop is worse than an error screen
 * that has its own reload button.
 */
export function reloadOnceForChunkError(now: number = Date.now()): boolean {
  try {
    const last = sessionStorage.getItem(RELOAD_GUARD_KEY)
    if (last && now - Number(last) < RELOAD_GUARD_MS) return false
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(now))
  } catch {
    return false
  }
  window.location.reload()
  return true
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

/**
 * Runs `load`, retrying chunk-load failures only. Other errors throw at once.
 *
 * One short retry, not several. Verified on Chrome (2026-09-13): once an
 * import() of a URL has failed, the document's module map remembers the
 * failure, and a retry of the same URL fails again without touching the
 * network, even after the file is back. So the retry only helps browsers that
 * do not keep failures; in Chrome the reload ErrorBoundary performs afterwards
 * is the real recovery, and a long retry budget would only delay it.
 */
export async function retryImport<T>(
  load: () => Promise<T>,
  retries = 1,
  delayMs = 300,
  sleep: (ms: number) => Promise<void> = wait,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await load()
    } catch (err) {
      if (attempt >= retries || !isChunkLoadError(err)) throw err
      await sleep(delayMs * (attempt + 1))
    }
  }
}

export function lazyWithRetry<T extends ComponentType<object>>(
  load: () => Promise<{ default: T }>,
): LazyExoticComponent<T> {
  return lazy(() => retryImport(load))
}

/**
 * Starts downloading a route's chunk the moment a finger lands on a link to it
 * (or the mouse hovers, or it gains focus), so the tap rarely waits on the
 * network. import() is deduplicated by the browser, so the later lazy() load
 * reuses this download. Returns a cleanup function.
 */
export function prefetchOnIntent(
  routes: Record<string, () => Promise<unknown>>,
  target: Document = document,
): () => void {
  const started = new Set<string>()
  const handler = (event: Event) => {
    const el = event.target
    if (!(el instanceof Element)) return
    const anchor = el.closest('a[href]') as HTMLAnchorElement | null
    if (!anchor) return
    let path: string
    try {
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      path = url.pathname
    } catch {
      return
    }
    const load = routes[path]
    if (!load || started.has(path)) return
    started.add(path)
    // A failed prefetch is not an error the user should see; the real
    // navigation retries on its own. Forget it so the next intent tries again.
    load().catch(() => { started.delete(path) })
  }
  const types = ['touchstart', 'mouseover', 'focusin'] as const
  for (const type of types) target.addEventListener(type, handler, { capture: true, passive: true })
  return () => {
    for (const type of types) target.removeEventListener(type, handler, { capture: true })
  }
}
