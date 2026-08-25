// ============================================
// Theme — the single source of truth for light/dark
//
// There used to be FOUR independent answers to "which theme should a visitor
// with no saved preference get", and they disagreed:
//
//   index.html inline script  stored !== 'dark'            -> light
//   App.tsx                   !stored && prefersLight      -> follow the OS
//   AppLayout.tsx             stored !== null ? … : true   -> light, AND PERSISTED IT
//   SettingsPage.tsx          stored !== 'dark'            -> light
//
// So a visitor on a dark-mode OS got a white flash, then dark, and then — the
// moment they opened /pricing or /support, which mount AppLayout — the theme
// flipped to light and AppLayout WROTE 'light' to localStorage, permanently
// overriding an OS preference the user had never chosen against.
//
// The owner's decision is: follow the OS until the user picks explicitly.
// Everything reads that decision from here.
//
// index.html keeps its own copy of `resolveIsLight`, because it has to run
// before first paint to avoid a flash and cannot import a module. If the rule
// below changes, change the inline script in index.html to match — it is
// marked with a pointer back to this file.
// ============================================

export const THEME_STORAGE_KEY = 'intrack_theme'
export const THEME_CHANGE_EVENT = 'intrack_theme_changed'

export type ThemePreference = 'light' | 'dark'

/** The user's explicit choice, or null when they have never made one. */
export function getStoredTheme(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    // Private mode / storage disabled. Not knowing the preference is fine;
    // failing to render is not.
    return null
  }
}

/**
 * Which theme to show right now: an explicit choice wins, otherwise the OS.
 * Never persists — reading the theme must not create a preference.
 */
export function resolveIsLight(): boolean {
  const stored = getStoredTheme()
  if (stored) return stored === 'light'
  try {
    // Default to light when the OS expresses no preference, matching how the
    // app has always looked out of the box.
    return !window.matchMedia?.('(prefers-color-scheme: dark)').matches
  } catch {
    return true
  }
}

/** Paint the theme. Does not persist — see setThemePreference. */
export function applyTheme(isLight: boolean): void {
  try {
    document.documentElement.classList.toggle('light', isLight)
    // Keep the browser/OS chrome in step, or a dark page keeps a white status
    // bar on mobile.
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', isLight ? '#ffffff' : '#09090b')
  } catch {
    // Nothing to do — a missing meta tag is not worth breaking a render over.
  }
}

/**
 * Record an explicit user choice, paint it, and tell every listening view.
 * This is the ONLY function that writes the preference.
 */
export function setThemePreference(theme: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // Unpersisted is better than unapplied — carry on and paint it.
  }
  applyTheme(theme === 'light')
  try {
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  } catch {
    // Non-DOM environment (tests). The caller already has its own state.
  }
}

/**
 * Fire `onChange` whenever the resolved theme changes — either because the
 * user toggled it, or because the OS switched while they have no explicit
 * preference stored. Returns an unsubscribe function.
 */
export function subscribeToTheme(onChange: (isLight: boolean) => void): () => void {
  const handle = () => onChange(resolveIsLight())

  window.addEventListener(THEME_CHANGE_EVENT, handle)

  let media: MediaQueryList | undefined
  try {
    media = window.matchMedia?.('(prefers-color-scheme: dark)')
    // Only meaningful while the user has made no explicit choice; resolveIsLight
    // ignores the OS once they have, so re-resolving is harmless either way.
    media?.addEventListener?.('change', handle)
  } catch {
    media = undefined
  }

  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, handle)
    try {
      media?.removeEventListener?.('change', handle)
    } catch {
      // Already gone.
    }
  }
}
