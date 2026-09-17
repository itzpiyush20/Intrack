// ============================================
// Scan progress line — reading the scanner's existing progress events
//
// The scanner already reports `{ phase, current, total }` (ScanProgress in
// emailScanner.ts) through `onProgress`. This turns those events into how far
// along a thin line should be, without asking the scanner for anything new.
//
// Phases run listing → preparing → fetching → filtering → analyzing, each with
// its own counter, so each gets a share of the line. `saving` is emitted in
// between as found transactions are flushed, and says nothing about how much
// is left, so it never moves the line. The line only ever grows.
// ============================================

import type { ScanProgress } from '@/services/emailScanner'

/** Where each phase starts and ends on the line, 0..1. */
const PHASE_SPAN: Record<Exclude<ScanProgress['phase'], 'saving'>, readonly [number, number]> = {
  listing: [0.06, 0.06],
  preparing: [0.1, 0.1],
  fetching: [0.1, 0.4],
  filtering: [0.4, 0.55],
  analyzing: [0.55, 0.95],
}

/** How far along the line a single event puts the scan, or `null` for an event that says nothing about it. */
export function scanProgressFraction(p: ScanProgress): number | null {
  if (p.phase === 'saving') return null
  const span = PHASE_SPAN[p.phase]
  if (!span) return null
  const [start, end] = span
  const ratio = p.total > 0 ? Math.min(Math.max(p.current / p.total, 0), 1) : 1
  return start + (end - start) * ratio
}

/** The line's next position: never backwards. */
export function nextScanFraction(previous: number, p: ScanProgress): number {
  const fraction = scanProgressFraction(p)
  return fraction === null ? previous : Math.max(previous, fraction)
}

/**
 * Splits the scanner's own status text around its first number, so that
 * number can roll while the wording stays exactly what `formatScanProgress`
 * wrote. `null` when the text has no number ("Preparing…").
 */
export function splitProgressCount(text: string): { before: string; count: number; after: string } | null {
  const match = /^(\D*)(\d+)([\s\S]*)$/.exec(text)
  if (!match) return null
  return { before: match[1], count: Number(match[2]), after: match[3] }
}
