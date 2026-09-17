import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPendingActionLedger, withoutWaitingRows, type ScheduleOptions } from './pendingActions'

type Row = { id: string; amount: number }

const a: Row = { id: 'a', amount: 100 }
const b: Row = { id: 'b', amount: 250 }
const c: Row = { id: 'c', amount: 40 }

/** A stand-in page: a visible list and one outgoing total, as PendingPage keeps them. */
function fakePage(rows: Row[]) {
  const page = {
    visible: rows.slice(),
    total: rows.reduce((s, r) => s + r.amount, 0),
    committed: [] as string[],
  }
  const opts = (txns: Row[], commit?: ScheduleOptions<Row>['commit']): ScheduleOptions<Row> => ({
    txns,
    delayMs: 5000,
    hide: (acted) => {
      page.visible = page.visible.filter((r) => !acted.some((t) => t.id === r.id))
      page.total -= acted.reduce((s, r) => s + r.amount, 0)
    },
    restore: (acted) => {
      page.visible = [...acted, ...page.visible]
      page.total += acted.reduce((s, r) => s + r.amount, 0)
    },
    commit:
      commit ??
      ((acted) => {
        page.committed.push(...acted.map((t) => t.id))
      }),
  })
  return { page, opts }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('pending action ledger — one action per row', () => {
  it('ignores a second approve of the same row (double tap, swipe + button)', () => {
    const ledger = createPendingActionLedger()
    const { page, opts } = fakePage([a, b])

    expect(ledger.schedule(opts([a]))).not.toBeNull()
    expect(ledger.schedule(opts([a]))).toBeNull()

    expect(page.total).toBe(250)
    vi.advanceTimersByTime(5000)
    expect(page.committed).toEqual(['a'])
  })

  it('ignores a reject of a row already being approved', () => {
    const ledger = createPendingActionLedger()
    const { page, opts } = fakePage([a, b])
    const rejected: string[] = []

    ledger.schedule(opts([a]))
    const second = ledger.schedule(opts([a], (acted) => { rejected.push(...acted.map((t) => t.id)) }))

    expect(second).toBeNull()
    vi.advanceTimersByTime(5000)
    expect(page.committed).toEqual(['a'])
    expect(rejected).toEqual([])
  })

  it('leaves out a row already being acted on from "Approve all"', () => {
    const ledger = createPendingActionLedger()
    const { page, opts } = fakePage([a, b, c])

    ledger.schedule(opts([a]))
    // A stale render of the list still holds `a`.
    const all = ledger.schedule(opts([a, b, c]))

    expect(all?.acted.map((t) => t.id)).toEqual(['b', 'c'])
    expect(page.total).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(page.committed.sort()).toEqual(['a', 'b', 'c'])
  })

  it('does nothing when every row is already being acted on', () => {
    const ledger = createPendingActionLedger()
    const { page, opts } = fakePage([a, b])
    ledger.schedule(opts([a, b]))
    expect(ledger.schedule(opts([b, a]))).toBeNull()
    expect(page.total).toBe(0)
  })

  it('counts a row listed twice in one batch once', () => {
    const ledger = createPendingActionLedger()
    const { page, opts } = fakePage([a, b])
    const run = ledger.schedule(opts([a, a, b]))
    expect(run?.acted.map((t) => t.id)).toEqual(['a', 'b'])
    expect(page.total).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(page.committed).toEqual(['a', 'b'])
  })

  it('Undo cancels the write, restores the row and the total once, and frees the row', () => {
    const ledger = createPendingActionLedger()
    const { page, opts } = fakePage([a, b])

    const run = ledger.schedule(opts([a]))!
    expect(run.undo()).toBe('undone')
    expect(run.undo()).toBe('undone')

    expect(page.total).toBe(350)
    expect(page.visible.filter((r) => r.id === 'a')).toHaveLength(1)
    expect(ledger.isBusy('a')).toBe(false)
    vi.advanceTimersByTime(5000)
    expect(page.committed).toEqual([])

    // Free to act on again after Undo.
    expect(ledger.schedule(opts([a]))).not.toBeNull()
  })

  it('Undo after the write has started does not bring back a row that was approved', () => {
    const ledger = createPendingActionLedger()
    const { page, opts } = fakePage([a])
    const run = ledger.schedule(opts([a]))!
    vi.advanceTimersByTime(5000)
    expect(run.undo()).toBe('too-late')
    expect(page.committed).toEqual(['a'])
    expect(page.visible).toEqual([])
    expect(page.total).toBe(0)
  })

  it('keeps a row busy while its write is in flight, and frees it once settled', async () => {
    const ledger = createPendingActionLedger()
    let settle!: () => void
    const { opts } = fakePage([a])
    ledger.schedule(opts([a], () => new Promise<void>((resolve) => { settle = resolve })))

    vi.advanceTimersByTime(5000)
    expect(ledger.isBusy('a')).toBe(true)
    expect(ledger.schedule(opts([a]))).toBeNull()

    settle()
    await vi.runAllTimersAsync()
    expect(ledger.isBusy('a')).toBe(false)
  })

  it('frees a row whose write threw', async () => {
    const ledger = createPendingActionLedger()
    const { opts } = fakePage([a])
    ledger.schedule(opts([a], () => Promise.reject(new Error('network'))))
    vi.advanceTimersByTime(5000)
    await vi.runAllTimersAsync()
    expect(ledger.isBusy('a')).toBe(false)
  })
})

describe('pending reload during the undo window', () => {
  /**
   * PendingPage's fetchPendingData: replace the list, the count and the total
   * with what the database holds, where every row still reads `pending` until
   * its write lands.
   */
  function reload(page: { visible: Row[]; total: number; count: number }, db: Row[], isWaiting: (id: string) => boolean) {
    const fetched = withoutWaitingRows(db, db.length, isWaiting)
    page.visible = fetched.rows
    page.count = fetched.count
    page.total = fetched.rows.reduce((s, r) => s + r.amount, 0)
  }

  function pageWithCount(rows: Row[]) {
    const made = fakePage(rows)
    const page = Object.assign(made.page, { count: rows.length })
    const opts: typeof made.opts = (txns, commit) => {
      const base = made.opts(txns, commit)
      return {
        ...base,
        hide: (acted) => { base.hide(acted); page.count -= acted.length },
        // Filtered first, as PendingPage's restoreRows is.
        restore: (acted) => {
          page.visible = page.visible.filter((r) => !acted.some((t) => t.id === r.id))
          base.restore(acted)
          page.count += acted.length
        },
      }
    }
    return { page, opts }
  }

  it('isWaiting is true only while the undo timer runs, not while the write is in flight', async () => {
    const ledger = createPendingActionLedger()
    let settle!: () => void
    const { opts } = fakePage([a])
    ledger.schedule(opts([a], () => new Promise<void>((resolve) => { settle = resolve })))

    expect(ledger.isWaiting('a')).toBe(true)
    vi.advanceTimersByTime(5000)
    expect(ledger.isWaiting('a')).toBe(false)
    expect(ledger.isBusy('a')).toBe(true)
    settle()
    await vi.runAllTimersAsync()
    expect(ledger.isWaiting('a')).toBe(false)
  })

  it('keeps a row waiting out its undo window out of a reload, its count and its total', () => {
    const ledger = createPendingActionLedger()
    const { page, opts } = pageWithCount([a, b])
    ledger.schedule(opts([a]))

    // A scan finishes; the database still holds `a` as pending.
    reload(page, [a, b, c], ledger.isWaiting)

    expect(page.visible.map((r) => r.id)).toEqual(['b', 'c'])
    expect(page.count).toBe(2)
    expect(page.total).toBe(290)
  })

  it('Undo after a reload restores the row exactly once', () => {
    const ledger = createPendingActionLedger()
    const { page, opts } = pageWithCount([a, b])
    const run = ledger.schedule(opts([a]))!

    reload(page, [a, b], ledger.isWaiting)
    run.undo()

    expect(page.visible.filter((r) => r.id === 'a')).toHaveLength(1)
    expect(page.count).toBe(2)
    expect(page.total).toBe(350)
  })

  it('keeps a row whose write is in flight, or has failed, in a reload', async () => {
    const ledger = createPendingActionLedger()
    const { page, opts } = pageWithCount([a, b])
    let fail!: () => void
    // A failed write refetches while its own row is still marked writing.
    ledger.schedule(opts([a], () => new Promise<void>((_, reject) => { fail = () => reject(new Error('network')) })))
    vi.advanceTimersByTime(5000)

    reload(page, [a, b], ledger.isWaiting)
    expect(page.visible.map((r) => r.id)).toEqual(['a', 'b'])
    expect(page.count).toBe(2)

    fail()
    await vi.runAllTimersAsync()
    reload(page, [a, b], ledger.isWaiting)
    expect(page.visible.map((r) => r.id)).toEqual(['a', 'b'])
    expect(page.total).toBe(350)
  })

  it('takes waiting rows off a count that covers rows beyond the fetched page', () => {
    const waiting = new Set(['a'])
    const result = withoutWaitingRows([a, b], 40, (id) => waiting.has(id))
    expect(result.rows).toEqual([b])
    expect(result.count).toBe(39)
  })
})
