import { useEffect, useRef, useState } from 'react'
import { getManualScanQuota } from '@/services'

interface UseNextScanOptions {
  /** Skip the lookup entirely when there is no signed-in user. */
  enabled: boolean
  /**
   * Change this to force a re-check. Pass whatever marks "a scan just
   * happened" — completing one is what consumes the allowance.
   */
  refreshKey?: unknown
  /** Fired when the wait elapses, so a page can clear its own banner state. */
  onExpire?: () => void
}

export interface NextScanState {
  /** When the next manual scan becomes possible, or null if one is available. */
  nextScanAt: Date | null
  /**
   * True when the daily allowance itself is spent, false when a scan remains
   * but the 4-hour minimum gap has not elapsed (R7). The two are different
   * refusals and must not be worded the same.
   */
  quotaExhausted: boolean
}

/**
 * Shared by PendingPage and DashboardPage so the two can never disagree about
 * when the next scan is due — they used to hold separate copies of this logic
 * and drifted.
 *
 * Deliberately holds a moment in time rather than a ticking countdown: the UI
 * shows a clock time. That means a single timer firing at the deadline is what
 * releases the page, since there is no per-second tick to notice it passing.
 */
export function useNextScan({ enabled, refreshKey, onExpire }: UseNextScanOptions): NextScanState {
  const [nextScanAt, setNextScanAt] = useState<Date | null>(null)
  const [quotaExhausted, setQuotaExhausted] = useState(false)

  // Held in a ref so a caller passing an inline arrow does not re-run the
  // effect on every render and restart the timer each time. Written in an
  // effect, never during render — a ref write during render is exactly what
  // react-hooks/refs-during-render forbids.
  const onExpireRef = useRef(onExpire)
  useEffect(() => {
    onExpireRef.current = onExpire
  })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const clear = () => {
      setNextScanAt(null)
      setQuotaExhausted(false)
      onExpireRef.current?.()
    }

    ;(async () => {
      const quota = await getManualScanQuota()
      if (cancelled) return

      const nextScanMs = quota?.nextAvailableAt?.getTime() ?? null
      if (!nextScanMs || nextScanMs <= Date.now()) {
        clear()
        return
      }

      setNextScanAt(new Date(nextScanMs))
      setQuotaExhausted(quota!.remaining === 0)
      timer = setTimeout(clear, nextScanMs - Date.now())
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [enabled, refreshKey])

  return { nextScanAt, quotaExhausted }
}
