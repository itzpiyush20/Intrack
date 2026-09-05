// ============================================
// Shared class recipes
//
// Small pieces of chrome that were being retyped in every section and drifting
// as they went — Settings alone had icon buttons at three different sizes with
// three different hover colours. A recipe here is the fix for that class of
// drift: one definition, imported wherever the affordance appears.
// ============================================

/**
 * A square icon-only button in a list row: edit, archive, delete.
 *
 * 44px on touch, 36px from `md` up. The first version was 36px everywhere,
 * which is under the WCAG touch-target minimum — every screen that used it had
 * to override the size at the call site, which is the signal that the recipe
 * was wrong rather than the call sites. The focus ring is part of the recipe
 * because a keyboard user loses these buttons entirely without one.
 */
export const ACTION_BUTTON =
  'h-11 w-11 md:h-9 md:w-9 rounded-lg flex items-center justify-center text-zinc-400 transition-colors ' +
  'hover:text-zinc-100 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-brand-500/40 cursor-pointer'

/** The same button where the action destroys something. */
export const ACTION_BUTTON_DANGER =
  'h-11 w-11 md:h-9 md:w-9 rounded-lg flex items-center justify-center text-zinc-400 transition-colors ' +
  'hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--status-danger-border)] cursor-pointer'

/**
 * A row inside a section card: a list entry, a rule, a card, a category.
 *
 * Not a nested card — one hairline and a barely-there fill, so the section it
 * sits in stays the only object with real elevation.
 */
export const ROW_TILE =
  'rounded-xl border border-border-subtle/40 bg-surface-2/50 transition-colors hover:border-border-hover'

/** The small uppercase label above a group of rows inside a section. */
export const SECTION_LABEL =
  'text-xs font-bold text-zinc-400 uppercase tracking-wider'
