# Page heading hand-off — design

**Date:** 2026-09-10
**Status:** implemented

## Problem

Every signed-in page printed its name twice: once small in the sticky top bar
and once as the big in-page heading, both on screen at the same time. The
sidebar's highlighted tab made it a third statement of the same word. The
in-page headings had also drifted apart — `font-extrabold` on some pages and
`font-bold` on others, `text-sb-ink-secondary` against `text-sb-ink-muted`,
`mt-1` against `mt-1.5` — because each page had hand-rolled its own block.

## Decision

Keep the in-page hero (chip, title, one-line description, controls) as the
page's identity, and show the top-bar title **only after that heading has
scrolled out of view**. The two are never visible together, and the top bar
still gives context when scrolling a long list.

## How it works

- `src/components/ui/PageHeader.tsx` is now the one heading block for app
  pages: `eyebrow` chip, `title`, `subtitle`, an `aside` slot for inline
  detail (the dashboard streak), and `actions` for page controls.
- `src/layouts/PageHeaderContext.ts` carries the hand-off. `usePageHeroHandoff`
  puts an `IntersectionObserver` on the heading — with a 72px top margin, so
  the swap happens as the heading slides under the 64px sticky bar — and
  reports `visible` / `hidden` / `none` to `AppLayout`.
- The report includes the heading's own text, so the top bar echoes the page's
  words. **Renaming a page heading renames the top bar with it**; there is no
  second list to keep in step. `getCurrentPageTitle` now reads nav routes
  straight off `navItems` and is only a fallback for the first paint and for
  routes with no `PageHeader`.
- `stickyTitle` covers the one case where the heading is not the page name:
  the dashboard greets you by name and hands the top bar "Home".
- A route that renders no `PageHeader` reports `none`, and the top bar behaves
  exactly as it did before. Without `IntersectionObserver`, the hero stays the
  only title — the failure mode is one title, never two.

## Pages converted

Dashboard, Transactions, Budgets, Pending Alerts, Insights, Planned Payments,
Settings, Profile, Support, Admin. Pricing keeps its centred marketing hero and
calls `usePageHeroHandoff` directly, because signed-in `/pricing` is an app
route and had the same duplication.

Privacy, Terms and Refund are outside `AppLayout` — no sticky title, no
duplication, untouched.

## Verification

`npx tsc -b` clean on every file touched; four new tests in
`src/components/ui/PageHeader.test.tsx`, two of which fail when the hand-off is
reverted to always-visible; lint counts identical to the pre-change baseline on
all eleven modified files.

Not verified: live appearance in a browser. The app does not currently boot —
unfinished landing-page work in the working tree (`WealthTrajectoryVisual` is
not exported from `src/pages/landing/index.ts`, and `LandingPage.tsx` refers to
`rotatingWord`, `FloatingHeroBadges`, `InteractionSimulation` and
`LiveTransactionTicker`, none of which exist) breaks the module graph for every
route. That also blocks `npm run build`. It is unrelated to this change.
