# Mobile link reliability & web-app shell audit — 2026-09-13

Owner report: "links sometimes not working on mobile, have to refresh the page".
Audit of the live site (375×812, Android UA) and a local production build found
nine issues. Owner approved fixing all nine. None touches the email scanner.

## Findings (evidence)

| # | Finding | Evidence |
|---|---------|----------|
| 1 | Tapping the same `/#section` link twice does nothing | Reproduced on prod: FAQ → scroll top → FAQ again stays at y=0. `ScrollToTop` depends on `[pathname, search, hash]`; a same-URL `<Link>` changes only `location.key`. |
| 2 | Cookie banner covers hero CTAs on first mobile visit | `elementFromPoint` at the CTA coordinates hits the banner. Offset `4rem` is for the signed-in bottom nav, which marketing visitors do not have. |
| 3 | A failed lazy chunk ends on "Something went wrong" | Local prod build with `PricingPage-*.js` hidden: one auto-reload, then loop-guard suppression and the error screen. No retry of the import; "Try Again" regex lacks Safari's `Importing a module script failed.`; `vite:preloadError` unhandled. |
| 4 | Service worker stores every update poll | Prod Cache Storage: 6 `/index.html?t=…` entries after ~1 min, unbounded. |
| 5 | SW navigation handler caches non-OK responses as the offline `/` | `sw.js` navigate branch has no `res.ok` check. |
| 6 | Hashed `/assets/*` served `max-age=0, must-revalidate` | `curl -I` on prod. |
| 7 | First visit to a lazy route can blank the whole page | Suspense fallback sits above every page, and each page renders its own `AppLayout`. |
| 8 | Update checker reloads on focus / tab return / route change | Reload on `visibilitychange` wipes an open form after an app switch. |
| 9 | `context-*.js` is 538 kB (160 kB gzip) | `npm run build`. Vendor code (supabase, framer-motion) shares a hash with app code, so every deploy invalidates it. |

## Phases

**Phase 1 — links (1, 2).**
- `ScrollToTop`: add `key` to the effect deps so a same-URL tap re-runs the scroll.
- `CookieConsent`: sit at `1rem + safe-area` by default; lift above the bottom
  nav only while that nav is mounted (`AppLayout` toggles a root class).
  Tighter mobile layout. Copy meaning unchanged (notice, not consent).

**Phase 2 — chunk-load recovery (3, 7).**
- `src/utils/chunkLoad.ts`: `isChunkLoadError(err)` (Chrome, Firefox, Safari,
  CSS preload, MIME) and `lazyWithRetry(factory)` — retries the import after a
  short delay before giving up.
- All `lazy()` routes use `lazyWithRetry`.
- `ErrorBoundary`: shared detector; "Try Again" always hard-reloads a chunk error.
- ~~`vite:preloadError` listener~~ — dropped during implementation: reloading
  there pre-empts the retry. Vite's CSS preload failure rejects the import with
  `Unable to preload CSS`, which `isChunkLoadError` recognises, so the retry
  path already covers it. For the same reason the index.html asset-error
  listener now ignores `<link rel="modulepreload">` failures.
- Prefetch on intent (touchstart / hover / focus on a link) rather than idle
  prefetch of every route, which would spend a marketing visitor's mobile data
  on app pages they cannot open.

**Phase 3 — service worker & headers (4, 5, 6).**
- `sw.js`: ignore `/index.html` polls and `cache: 'no-store'` requests; cache
  navigations only when `res.ok`; bump cache name so `activate` drops the bloated v1.
- `vercel.json`: `Cache-Control: public, max-age=31536000, immutable` on `/assets/(.*)`.

**Phase 4 — deferred update reload (8).**
- Focus / visibility / interval only *detect* a new build. It is applied on the
  next route change by a full navigation to the destination URL, so nothing
  in-progress on the current page is thrown away.

**Phase 5 — vendor chunk split (9).**
- `build.rolldownOptions.output.codeSplitting.groups` for supabase, framer-motion,
  react/react-dom/react-router, sentry. Goal: stable vendor hashes across deploys
  and smaller per-deploy downloads. Record before/after sizes. Deeper size
  reduction (deferring supabase off the landing page) is out of scope.

## Found during implementation

- **SW cached HTML as a JS chunk.** The `/assets/` branch stored any `res.ok`
  response. A `200 text/html` answer to a chunk request (SPA fallback, Wi-Fi
  captive portal, carrier interstitial) was then served cache-first for good,
  and the route stayed broken through reloads. Production Vercel returns 404
  for a missing asset, so it is not reachable there by that path, but the
  portal case is. Fixed: HTML responses are never cached for asset requests.
- **Chrome remembers a failed `import()`.** After a failure, `fetch` of the
  same file returned valid JS while `import()` of the same URL still failed with
  no network request. Retrying in place cannot help in Chrome, so the retry is
  one attempt after 300ms, and the reload is the recovery.
- A "first tap does not scroll" result was a test artefact: smooth scrolling
  does not run in a background browser tab. With the tab in front, every tap
  scrolled.

## Results (local production build, 375×812, Android UA)

| Check | Result |
|-------|--------|
| Same section link tapped 3× | reaches `#faq` each time |
| Hero CTAs under the cookie notice | both hit-test to the button |
| SW cache after a 31s poll cycle | `intrack-cache-v2`, 0 `index.html` entries |
| Old tab, rebuild underneath, tap Pricing | reloads onto new build, Pricing renders |
| Chunk still missing after the reload | error screen; "Try Again" reloads through the loop guard and Pricing renders once the file is back |
| New build detected, focus + visibilitychange | no reload |
| …then tap Pricing | reloads into `/pricing` on the new build |
| Build | largest chunk 230 kB (was 538 kB), no size warning |

Not verified: real iOS Safari; signed-in routes; the `immutable` header, which
only exists once Vercel serves it.

## Verification

Per `CLAUDE.md` "Always double-check before deploying": `npx tsc -b`,
`npm test -- --run`, `npm run build`, lint on touched files vs baseline
(606 errors / 13 warnings before). New tests must fail against the old code.
Re-run the mobile reproductions (1, 2, 3, 4) against a local production build.
Not testable from here: real iOS Safari, signed-in routes on prod.
