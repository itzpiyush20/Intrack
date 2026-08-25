# Light mode only

## Decision

Owner decision, 2026-08-25: **the app is light mode for everyone.** Dark mode and
the ability to switch are removed. This supersedes the previous rule documented
in `src/utils/theme.ts` ("follow the OS until the user picks explicitly").

## Approach: force the class, do not touch the CSS

Light is implemented in `src/index.css` as a `.light { … }` override layer on top
of dark `:root` defaults — 11 rules, at lines 89, 310, 452, 499, 522, 576, 608,
675, 822.

So the safe implementation is to **always apply the `.light` class and remove
every path that could take it off.** `index.css` is not edited at all. Rendering
then stays byte-identical to what a light-mode user sees today, which makes this
change visually risk-free.

Stripping the now-unreachable dark `:root` defaults out of `index.css` is a
separate, larger, and much riskier job — every `.light` rule inherits from them,
so they are not simply dead. Deliberately out of scope.

## Phases

### Phase 1 — `index.html`
The pre-paint script stops reading `intrack_theme` and unconditionally adds
`light`. Static `<meta name="theme-color">` default becomes `#ffffff`.

### Phase 2 — `src/utils/theme.ts`
Collapses to a single `applyLightTheme()`. Deleted: `THEME_STORAGE_KEY`,
`THEME_CHANGE_EVENT`, `ThemePreference`, `getStoredTheme`, `resolveIsLight`,
`setThemePreference`, `subscribeToTheme`.

It also deletes any `intrack_theme` value left on a device, so a user who once
chose dark is not carrying a preference the app no longer honours — this keeps
the Privacy Policy's localStorage disclosure honest.

### Phase 3 — consumers
- `App.tsx` — one `applyLightTheme()` call, no OS subscription.
- `AppLayout.tsx` — `isLight` state removed; the 6 conditionals collapse to their
  light branch. The dead `isStaticLight` prop goes too: no page has ever passed
  it, yet it is wired into 8 conditionals including the logo.
- `SettingsPage.tsx` — the "Night Mode" switch and its state are removed; the
  card is retitled since it no longer configures a theme.
- `SiteFooter.tsx` — `isLight` prop dropped; `muted`/`strong`/border collapse to
  their light values.

### Phase 4 — copy and metadata
- `PrivacyPage.tsx` — drop "Your theme preference" from the localStorage list; it
  is no longer stored.
- `public/manifest.json` — `theme_color` and `background_color` `#09090b` →
  `#ffffff`, so the PWA splash and Android status bar match a light-only app.
  **Visible change to the installed-app experience; flag it to the owner.**
- `DESIGN.md` — replace the theme-mode section with the new rule.

### Phase 5 — verify
`npx tsc -b`, `npm test`, lint delta, and a browser pass confirming the page
renders light with `intrack_theme` seeded to `'dark'`.

## Note

`plans/storage-key-rebrand.md` migrates the old theme key →
`intrack_theme`. That still runs; Phase 2 then deletes the key. Order is
harmless — the shim copies it, the app removes it on next boot.
