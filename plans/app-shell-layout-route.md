# Mount the app shell once — `AppLayout` as a layout route

Status: proposed, not started. Written 2026-09-18, after the page-stacking bug
(`f71511d`).

## Why

`AppLayout` is the signed-in shell: sidebar, sticky top bar, mobile tab bar,
notifications, the Add Transaction modal. Eleven pages import it and each one
renders it *inside its own tree*:

```tsx
// src/pages/BudgetsPage.tsx and ten others
return <AppLayout> …page… </AppLayout>
```

So the shell is not one thing that outlives navigation. It is torn down and
rebuilt on every click, and — worse — two copies exist for as long as two pages
overlap. That is what made the stacking bug possible: the sidebar highlight is a
shared `layoutId` (`desktop-sidebar-active`, `mobile-tab-active`,
`SlidingIndicator`), and `AnimatePresence` held a removed subtree that owned one
of those ids so it could hand the highlight to the new page's copy. The hand-off
never resolved, nothing was ever removed, and pages stacked at
`min-height: 100vh` until the app was unusable. `f71511d` removed the overlap;
it did not remove the duplication that gave the overlap teeth.

What the duplication costs even now:

- **Shell state resets on every navigation.** Sidebar scroll position, an open
  user dropdown, the notification panel, the collapsed/expanded state — all
  remount. Anything the shell learns (the notification query) is refetched.
- **Every page pays for the shell.** The sidebar, top bar and mobile bar are
  re-rendered from scratch per click, on a phone, before the page's own content
  is even considered.
- **The hazard is one `layoutId` away from returning.** Any future overlap of
  two shells — a Suspense boundary that keeps the old tree, a transition, a
  modal route — recreates the same class of bug. The fix in `App.tsx` is a
  guard rail, not a floor.

## What good looks like

```tsx
<Route element={<ProtectedRoute />}>
  <Route element={<AppShell />}>        {/* renders AppLayout + <Outlet /> */}
    <Route path="/dashboard" element={<DashboardPage />} />
    …
  </Route>
</Route>
```

One `AppLayout` instance for the whole signed-in session. Pages return their
content and nothing else. `layoutId` animations become what they were meant to
be: the highlight glides between nav items, because there is exactly one nav.

## Phases

**Phase 1 — introduce the layout route, no page changes.**
Add `src/layouts/AppShell.tsx` (`<AppLayout><Outlet /></AppLayout>`) and wrap
the protected routes with it in `App.tsx`. `AppLayout` must tolerate being
nested inside itself for exactly one commit per page converted, or convert every
page in the same commit — decide by reading `AppLayout`'s effects first; a
double shell would mount two notification pollers and two Add Transaction
modals. Converting all eleven at once is probably simpler than making the shell
re-entrant.

**Phase 2 — unwrap the pages.** Remove `<AppLayout>` from the eleven pages
(`Dashboard`, `Expenses`, `Budgets`, `Pending`, `Insights`, `Subscriptions`,
`Settings`, `Profile`, `admin/Admin`, `Pricing`, `Support` — note the last two
render it *conditionally* for signed-in users and need care: they are also
public routes and must keep working signed out). Keep each page's `<PageHeader>`
exactly as is; `PageHeaderContext` already crosses the boundary through context,
so a page reports its hero to the single shell above it without changes.

**Phase 3 — let the shell keep what it now loses.** With one instance, the
notification query, the sidebar scroll and any dropdown state survive
navigation. Check nothing depended on the reset: a dropdown that used to close
because the shell remounted now has to close on a route change deliberately.

**Phase 4 — re-examine the motion.** With one nav, `SlidingIndicator` can
actually animate between items. Confirm the route transition in
`AnimatedRoutes` still reads right when only the content below the shell
changes; the wrapper's `min-height: 100vh` and `y: 8` entry may want to move
down onto the content element instead of the whole page.

## Verification

Tests alone will not catch the failure this refactor is about. Required before
it ships:

1. `npx tsc -b`, `npm test -- --run`, `npm run build`, eslint on every file
   touched, lint count compared against the pre-change baseline.
2. In a real signed-in browser, click every tab in turn and assert the DOM:
   `document.getElementById('root').querySelectorAll(':scope > div')` must hold
   exactly one page wrapper, and `document.querySelectorAll('nav[aria-label="Mobile navigation"]')`
   exactly one shell. This is the check that found the original bug and it is
   the check that proves this refactor.
3. Signed-out `/pricing` and `/support` still render without the shell.
4. Mobile viewport: the bottom tab bar survives navigation and its highlight
   glides rather than jumping.

## Not in scope

The `AnimatePresence` removal in `App.tsx` stays. This refactor removes the
*duplication*; it does not reintroduce a presence wrapper around the routes.
