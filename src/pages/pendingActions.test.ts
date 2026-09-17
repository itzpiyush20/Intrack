import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPendingActionLedger, type ScheduleOptions } from './pendingActions'

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
    run.undo()
    run.undo()

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
    run.undo()
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
