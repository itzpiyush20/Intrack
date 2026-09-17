// ============================================
// Pending review: the undo window behind Approve and Reject
//
// Every approve or reject on the Pending page — one card's button, a swipe,
// "Approve all high-confidence", or a bulk action on ticked rows — hides the
// rows at once, waits a few seconds, then writes. Undo inside that window
// cancels the write and brings the rows back.
//
// One action per row. A row is busy from the moment an action is scheduled
// until its write settles (or Undo cancels it), and any later action on a busy
// row is ignored. Without this a swipe and a button tap, a double tap, or a
// single approve followed by "Approve all" (whose list can be a render stale)
// each scheduled a second write for the same transaction, took its amount off
// the pending totals twice, and gave two Undo buttons that each put it back.
//
// Undo restores only rows whose write it actually cancelled. Once the write
// has started the row is approved (or rejected) in the database, so bringing
// it back into Pending would show a decided transaction as undecided. Undo then
// reports 'too-late' so the page can say so instead of doing nothing silently.
//
// A reload during the undo window (a scan finishing, another row's failed
// write) reads every row still `pending` in the database — including the ones
// just hidden, whose write has not run yet. `withoutWaitingRows` keeps those
// out of the reloaded list and count; otherwise the row came back, ignored
// taps (it is busy), and Undo added its amount to the totals a second time.
// Rows whose write is in flight stay IN a reload: a failed write refetches so
// that its row reappears.
// ============================================

export interface PendingActionTarget {
  id: string
}

export interface ScheduleOptions<T extends PendingActionTarget> {
  txns: T[]
  delayMs: number
  /** Take the rows out of view and off the totals. Called once, with only the rows acted on. */
  hide: (txns: T[]) => void
  /** Put the rows back and on the totals. Called at most once. */
  restore: (txns: T[]) => void
  /** The database write. A returned promise keeps the rows busy until it settles. */
  commit: (txns: T[]) => void | Promise<unknown>
}

/** 'undone' when the write was cancelled (or already had been); 'too-late' once it has started. */
export type UndoResult = 'undone' | 'too-late'

export interface ScheduledAction<T extends PendingActionTarget> {
  /** The rows this call actually acted on — busy and duplicate rows left out. */
  acted: T[]
  undo: () => UndoResult
}

export interface PendingActionLedger {
  /** True while an action on this row is waiting out its undo window or writing. */
  isBusy: (id: string) => boolean
  /** True only while this row's undo timer is running — false once its write has started. */
  isWaiting: (id: string) => boolean
  /** Returns `null`, and does nothing at all, when no row in `txns` is free. */
  schedule: <T extends PendingActionTarget>(options: ScheduleOptions<T>) => ScheduledAction<T> | null
}

export function createPendingActionLedger(): PendingActionLedger {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const writing = new Set<string>()

  const isWaiting = (id: string) => timers.has(id)
  const isBusy = (id: string) => timers.has(id) || writing.has(id)

  function schedule<T extends PendingActionTarget>({ txns, delayMs, hide, restore, commit }: ScheduleOptions<T>) {
    const seen = new Set<string>()
    const acted = txns.filter((t) => {
      if (seen.has(t.id) || isBusy(t.id)) return false
      seen.add(t.id)
      return true
    })
    if (acted.length === 0) return null

    hide(acted)

    const release = () => acted.forEach((t) => writing.delete(t.id))
    const timer = setTimeout(() => {
      acted.forEach((t) => {
        timers.delete(t.id)
        writing.add(t.id)
      })
      let result: void | Promise<unknown>
      try {
        result = commit(acted)
      } catch {
        release()
        return
      }
      Promise.resolve(result).then(release, release)
    }, delayMs)
    acted.forEach((t) => timers.set(t.id, timer))

    let undone = false
    const undo = (): UndoResult => {
      if (undone) return 'undone'
      // All rows of one call share one timer, so either all are still waiting
      // or the write has started for all of them.
      if (!acted.every((t) => timers.get(t.id) === timer)) return 'too-late'
      undone = true
      clearTimeout(timer)
      acted.forEach((t) => timers.delete(t.id))
      restore(acted)
      return 'undone'
    }

    return { acted, undo }
  }

  return { isBusy, isWaiting, schedule }
}

/**
 * Rows fetched from the database, minus those still waiting out an undo
 * window (already hidden and already off the totals). `count` is the
 * database's own count, which may cover rows beyond the fetched page; it is
 * reduced by the waiting rows found in `rows`.
 */
export function withoutWaitingRows<T extends PendingActionTarget>(
  rows: T[],
  count: number,
  isWaiting: (id: string) => boolean
): { rows: T[]; count: number } {
  const kept = rows.filter((t) => !isWaiting(t.id))
  return { rows: kept, count: Math.max(0, count - (rows.length - kept.length)) }
}
