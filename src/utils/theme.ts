// ============================================
// Theme — light only
//
// Owner decision, 2026-08-25: the app is light mode for everyone. Dark mode
// and the ability to switch are removed.
//
// This supersedes the previous rule ("explicit choice wins, otherwise follow
// the OS"), which existed to settle a bug where four files each had their own
// answer and disagreed — a visitor on a dark-mode OS got a white flash, then
// dark, and then light the moment they opened a page that mounted AppLayout,
// which also silently persisted 'light' over a preference they had never made.
//
// Light is a `.light { … }` override layer on top of dark `:root` defaults in
// src/index.css. So "light only" is implemented by always applying that class
// and removing every path that could take it off — index.css is untouched, and
// rendering stays identical to what a light-mode user already saw. The dark
// `:root` defaults are NOT dead: every .light rule inherits from them.
//
// index.html applies the class before first paint, so there is no flash. This
// module re-applies it after hydration.
// ============================================

/** The old preference key. Read only to delete it — see clearStoredTheme. */
const LEGACY_THEME_KEY = 'intrack_theme'

/**
 * Paint the light theme, and keep the browser/OS chrome in step so a page does
 * not sit under a dark status bar on mobile.
 */
export function applyLightTheme(): void {
  try {
    document.documentElement.classList.add('light')
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', '#ffffff')
  } catch {
    // A missing meta tag is not worth breaking a render over.
  }
}

/**
 * Remove any theme preference left on the device by the old toggle.
 *
 * Without this, a user who once chose dark keeps carrying a preference the app
 * no longer honours — and the Privacy Policy would still be disclosing a stored
 * theme preference that no longer exists.
 */
export function clearStoredTheme(): void {
  try {
    localStorage.removeItem(LEGACY_THEME_KEY)
  } catch {
    // Private mode / storage disabled. Nothing to clear.
  }
}
