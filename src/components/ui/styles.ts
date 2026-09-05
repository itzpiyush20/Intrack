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
 * 36px keeps a comfortable target without crowding a row, and the focus ring is
 * part of the recipe because a keyboard user loses these buttons entirely
 * without one.
 */
export const ACTION_BUTTON =
  'h-9 w-9 rounded-lg flex items-center justify-center text-zinc-400 transition-colors ' +
  'hover:text-zinc-100 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-brand-500/40 cursor-pointer'

/** The same button where the action destroys something. */
export const ACTION_BUTTON_DANGER =
  'h-9 w-9 rounded-lg flex items-center justify-center text-zinc-400 transition-colors ' +
  'hover:text-[var(--status-danger-text)] hover:bg-[var(--status-danger-subtle)] ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--status-danger-border)] cursor-pointer'
