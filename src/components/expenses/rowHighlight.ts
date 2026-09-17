// ============================================
// Which row to tint after a save
//
// TransactionForm reports only `{ created }`, not the new row's id, and the
// Add popup lives in AppLayout. So the Expenses page remembers what it was
// waiting for before its (already existing) refetch, and picks the row out of
// the refetched list: an edit tints the row it edited; an add tints the row
// whose id was not in the list before. No extra fetch, no change to the form.
// ============================================

/** What the page is waiting to see in the next refetch. */
export type PendingHighlight =
  | { kind: 'edited'; id: string }
  | { kind: 'added'; knownIds: ReadonlySet<string> }

/**
 * The id to tint once `rows` has arrived, or null when there is nothing to
 * show — the saved row falls outside the selected range, or nothing changed.
 */
export function pickHighlightId(
  pending: PendingHighlight | null,
  rows: ReadonlyArray<{ id: string }>,
): string | null {
  if (!pending) return null
  if (pending.kind === 'edited') {
    return rows.some((r) => r.id === pending.id) ? pending.id : null
  }
  return rows.find((r) => !pending.knownIds.has(r.id))?.id ?? null
}

/** How long a row stays marked as new, in ms: a short beat, then the 1.2s fade. */
export const HIGHLIGHT_MS = 2000
