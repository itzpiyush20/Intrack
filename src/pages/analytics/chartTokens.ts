// ============================================
// Chart tokens — one visual language for every chart on Insights
//
// Before this file each chart picked its own colours and its own axis-label
// class, so green meant "income" in one chart and "on track" in another, the
// credit-card chart was drawn in a hardcoded `slate-500` that exists in no
// token, and half the axis labels were `text-zinc-500` on a tinted surface.
//
// Two rules this encodes, both from PRODUCT.md:
//
//  1. **Colour is never the only carrier of meaning.** Every coloured mark on
//     this page sits next to a word — a legend entry, a row label, a tooltip
//     line. The colour is a shortcut for someone who already knows the key,
//     never the key itself.
//  2. **Four roles, page-wide.** Money in, money out, essentials, and
//     everything-else/reference. A fifth colour would mean the reader has to
//     re-learn the key on every card.
//
// Category colours are deliberately NOT defined here: they come from each
// category's own `color` column via `useCategories().getStyle`, which is
// already the one source shared by the donut, the category trend and the
// burn-down. This file covers only the non-categorical series.
//
// A note on the neutral. `var(--zinc-600)` was used for "Other" segments and
// for the burn-down's ideal-pace line. The zinc ramp inverts between themes,
// so in light mode `--zinc-600` is #dde1e8 — a near-white hairline on a white
// card. Those marks were invisible. The neutral here is `--zinc-400` (#5a6271
// in light, 6.4:1 on white), which reads as a real grey in both directions.
// ============================================

/** A non-categorical data series: its colour and the word that names it. */
export interface ChartSeries {
  /** CSS colour for the mark. Always paired with `label` somewhere visible. */
  color: string
  /** The word a reader sees. Plain language, not accounting vocabulary. */
  label: string
}

export const SERIES = {
  /** Credits — salary, refunds, transfers in. */
  income: { color: 'var(--status-positive-text)', label: 'Money in' },
  /** Debits counted in the expense total. */
  expense: { color: 'var(--status-warning-text)', label: 'Money out' },
  /** 50/30/20 essentials. Blue reads as "structural", not as an alarm. */
  needs: { color: 'var(--status-info-text)', label: 'Needs' },
  /** 50/30/20 discretionary — the same amber as money out, which is what it is. */
  wants: { color: 'var(--status-warning-text)', label: 'Wants' },
  /** Money moved into savings and investments. */
  savings: { color: 'var(--status-positive-text)', label: 'Savings' },
} as const satisfies Record<string, ChartSeries>

/**
 * The neutral. Used for anything deliberately outside the totals: the "Other"
 * roll-up in the category trend, the even-pace reference line in the
 * burn-down, and credit-card bill payments — which are money out but are
 * excluded from every expense total on this page, so drawing them in the
 * money-out amber would contradict the sentence sitting above them.
 */
export const NEUTRAL_MARK = 'var(--zinc-400)'

/**
 * Axis ticks, series legends and bucket labels.
 *
 * `zinc-400` rather than `zinc-500`: 6.4:1 on a white card against 4.9:1, and
 * the 4.9 figure is measured on `--surface-1`. Half these labels sit on
 * `surface-2`, where `zinc-500` slips under the 4.5:1 floor. Tabular figures
 * because a good third of them are amounts.
 */
export const AXIS_LABEL = 'text-xs font-medium text-sb-ink-muted tnum'

/** A bucket label under a bar. Darkens on hover/focus of its column. */
export const BUCKET_LABEL =
  'text-xs font-medium text-sb-ink-muted tnum transition-colors group-hover:text-sb-ink group-focus-visible:text-sb-ink'

/** The horizontal reference lines behind a plot area. */
export const GRIDLINE = 'w-full border-t border-sb-hairline h-0'

/**
 * A chart tooltip. Solid elevated surface with a luxury card border and shadow.
 */
export const TOOLTIP =
  'absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-10 min-w-[9.5rem] rounded-xl ' +
  'border border-sb-hairline bg-surface-1 p-3 text-left shadow-card ' +
  'pointer-events-none transition-opacity duration-150'

/**
 * A whole bar column that opens a drill-down. A real `<button>`, so it is
 * reachable by keyboard and announced as an action; the focus ring is part of
 * the recipe because a chart with an invisible focus ring is a chart a
 * keyboard user cannot navigate.
 */
export const CHART_COLUMN =
  'group relative flex h-full min-w-11 flex-1 cursor-pointer flex-col items-center justify-end ' +
  'rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40'

/** Wide content scrolls inside itself; the page body never scrolls sideways. */
export const CHART_SCROLLER = 'w-full overflow-x-auto scrollbar-none pb-1'

/** A card's title row: icon, heading, one line of plain-language description. */
export const CARD_TITLE = 'text-base font-semibold text-sb-ink flex items-center gap-2'
export const CARD_SUBTITLE = 'mt-1 text-sm text-sb-ink-muted leading-relaxed'
