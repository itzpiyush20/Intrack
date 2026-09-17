// ============================================
// Opening a popup from the button that asked for it
//
// Modal takes an optional `origin` (viewport px). When given, the panel
// scales up from about 92% with its transform-origin placed on that point, so
// the popup reads as coming out of the tapped button, and closes back toward
// it. A true layoutId morph from a 48px button into a full form was rejected:
// the form's content would stretch through the transition, and the popup is
// a portal that already has its own entrance.
//
// The pure pieces live here so they can be tested without a browser layout.
// ============================================

export interface ViewportPoint {
  x: number
  y: number
}

/** Scale a popup opened from a button starts at (and closes back to). */
export const ORIGIN_SCALE = 0.92

/** Centre of an element in viewport px — the point a popup should grow from. */
export function centreOf(el: Element | null | undefined): ViewportPoint | undefined {
  if (!el) return undefined
  const r = el.getBoundingClientRect()
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
}

/**
 * CSS transform-origin that pins a panel's scaling to a viewport point.
 *
 * `centre` is the panel's centre in viewport px and `width`/`height` its
 * untransformed size. Measure the centre while the panel's own origin is the
 * default (its centre): scaling about the centre does not move the centre, so
 * the measurement is correct even mid-animation.
 */
export function transformOriginFor(
  origin: ViewportPoint,
  centre: ViewportPoint,
  width: number,
  height: number,
): string {
  const left = centre.x - width / 2
  const top = centre.y - height / 2
  return `${Math.round(origin.x - left)}px ${Math.round(origin.y - top)}px`
}

/**
 * The event the Add Transaction buttons on Home, Insights and in the nav
 * dispatch; AppLayout opens the one form. Expenses opens its own Modal with
 * `centreOf` instead.
 */
export const OPEN_ADD_TRANSACTION_EVENT = 'intrack:open-add-transaction'

/** Ask AppLayout to open the Add Transaction popup, growing from `from` when given. */
export function openAddTransaction(from?: Element | null) {
  window.dispatchEvent(
    new CustomEvent(OPEN_ADD_TRANSACTION_EVENT, { detail: { origin: centreOf(from) } }),
  )
}

/** Read the origin an `openAddTransaction` event carries, if any. */
export function addTransactionOrigin(event: Event): ViewportPoint | undefined {
  const origin = (event as CustomEvent<{ origin?: ViewportPoint } | null>).detail?.origin
  return origin && Number.isFinite(origin.x) && Number.isFinite(origin.y) ? origin : undefined
}
