# Mobile UI/UX Review — Design

## Goal

Systematically audit and fix mobile UI/UX issues across the entire Intrack app (a Capacitor + React PWA), targeting the standard modern-phone viewport range of 360–430px width. Deliverable is not just a findings list — issues found are fixed directly.

## Scope

Every page under `src/pages/` (top-level pages + `src/pages/analytics/*` sub-widgets + `src/pages/landing/*`), plus the shared shell in `src/layouts/AppLayout.tsx` and reusable components in `src/components/ui/*` and `src/components/**` that those pages compose. Both logged-out/marketing surfaces (Landing, Pricing, About, Privacy, Terms, Refund, Support) and logged-in app surfaces (Dashboard, Expenses, Budgets, Pending, Insights/Analytics, Subscriptions, Settings, Profile, Payment Success) are in scope.

## Audit criteria

For each page/component, check against this checklist at 360–430px width:

1. **Touch targets** — interactive elements (buttons, links, icon-only controls, list-row actions) should have a comfortable tap area (~40-44px). Flag anything smaller, especially icon buttons and inline row actions.
2. **Layout overflow** — no horizontal scroll/clipping caused by fixed-width elements, unwrapped flex rows, or grids that don't collapse to a single column on narrow screens. Multi-column grids (`md:grid-cols-*`, `sm:flex-row`) need to be checked for what they look like *before* the breakpoint kicks in.
3. **Fixed-position conflicts** — content must not be hidden behind the fixed bottom nav (`h-16` + safe-area) or overlap with floating elements like the PWA install banner. Bottom padding/margin on scrollable content must account for the bottom nav height.
4. **Typography & truncation** — no critical data (amounts, merchant names, dates) silently truncated with no way to see the full value; font sizes stay legible (no sub-11px body text carrying real information).
5. **Forms & modals** — modals fit within mobile viewport height and remain scrollable/usable when the on-screen keyboard is open; form field grids (`grid-cols-2` etc.) collapse appropriately; inputs are reachable and not obscured.
6. **Safe-area handling** — anything fixed to the top/bottom edges respects notch/home-indicator insets consistently with the pattern already used in `AppLayout.tsx` (`safe-area-inset-bottom`).
7. **Cross-page consistency** — patterns that are handled well on one page (e.g. Dashboard's card stacking) but missing on another (e.g. a page still using a fixed-width table with no mobile fallback) should be brought in line.

Out of scope: tablet/desktop breakpoints (≥768px), native Capacitor-specific APIs, backend/data logic changes, non-UI functional bugs, visual redesign/rebranding.

## Methodology

**Audit is code-level**, since the Browser preview pane in this session doesn't render visual screenshots (confirmed via `computer` tool timing out — "Browser pane is not displayed, so the page is not compositing frames"). Verification instead relies on:
- Reading each page's JSX/Tailwind classes directly for responsive-class coverage (missing `sm:`/breakpoint handling, fixed widths, etc.)
- `read_page` / `get_page_text` against the live dev server (`npm run dev`, already configured in `.claude/launch.json`) to confirm actual rendered DOM/structure at a 375×812 viewport
- `read_console_messages` / `preview_logs` for runtime errors introduced by fixes

If the user has the Browser pane visibly open on their side during implementation, screenshot-based visual confirmation becomes possible again and should be used as a supplement, not a replacement, for the code-level checks above.

## Output / fix approach

This is an audit-and-fix pass, not just a report. Findings are fixed inline in the same pass they're discovered, page by page. No separate "approval before fixing" step — per user's answer, ambiguous or judgment-call fixes (e.g. a borderline touch-target size) should follow existing patterns already established elsewhere in the codebase (e.g. `h-11 w-11` buttons already used in `AppLayout.tsx` headers) rather than inventing new conventions.

## Page inventory (for plan decomposition)

Top-level pages (`src/pages/*.tsx`): LandingPage, PricingPage, AboutPage, PrivacyPage, TermsPage, RefundPage, SupportPage, ForgotPasswordPage, ResetPasswordPage, DashboardPage, ExpensesPage, BudgetsPage, PendingPage, AnalyticsPage (+ `analytics/*` sub-widgets), SubscriptionsPage, SettingsPage, ProfilePage, PaymentSuccessPage.

Shared shell/components: `layouts/AppLayout.tsx` (header, mobile sub-nav, bottom nav, install banner, feedback modal), `components/ui/*` (Card, Button, Modal, Input, Select, Badge, EmptyState, ConfirmDialog, DateFilterPicker, etc.), and page-specific components under `components/dashboard/*`, `components/expenses/*`.

The implementation plan should group these into independent batches (e.g. by shared layout pattern or route grouping) so batches can be worked in parallel without touching the same files.
