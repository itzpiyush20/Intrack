# Admin Panel Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a read-only `/admin` section, visible only to accounts with `profiles.is_admin = true`, showing business, engagement, scanner, AI and feedback metrics.

**Architecture:** Aggregation happens in Postgres. Migration `022` adds `SECURITY DEFINER` functions that each refuse non-admin callers, so the browser receives a few numbers instead of thousands of rows and admins never gain blanket read of other users' transactions. React calls them with `supabase.rpc`. Display maths (approximate revenue, success rates, percentages) lives in tested TypeScript rather than SQL, because this repo can test TypeScript and cannot test SQL.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind 4, Supabase JS, vitest. No new dependencies.

**Source spec:** `docs/superpowers/specs/2026-08-15-admin-panel-design.md`

---

## Constraints that shape this plan

**The scanner is untouchable.** No task modifies `src/services/emailScanner.ts`, `aiService.ts`, `emailScanGates.ts`, `learningEngine.ts`, `api/gemini-proxy.ts`, or `api/auto-sync-gmail.ts`. The panel reads `email_scan_logs` and `email_scan_rejections` through `SELECT`-only functions. If a task appears to require a scanner-path edit, stop and ask.

**No component testing exists.** There is no `@testing-library/react` and no jsdom. Every test in this repo is a pure-function test (see `src/pages/InsightsPage.test.ts`). Therefore all logic worth testing is extracted into plain functions, and components stay thin. Do not add a testing library.

**SQL cannot be tested automatically here.** There is no local Postgres, no Docker, no Supabase CLI. The migration is verified by hand in the Supabase SQL editor using the script in Task 13. Do not write a test that pretends to exercise SQL.

**The live database drifts from `schema.sql`.** Migration `021` had to repair a missing column. Task 13 verifies `is_admin` actually exists on the live table before anything else is trusted.

## File structure

**Create:**

| File | Responsibility |
|---|---|
| `supabase/022_admin_metrics.sql` | All nine admin functions, each admin-guarded |
| `src/services/adminAccess.ts` | Pure: may this profile see the admin section? |
| `src/services/adminAccess.test.ts` | Tests for the above |
| `src/pages/admin/adminMetrics.ts` | Pure display maths: revenue, rates, percentages |
| `src/pages/admin/adminMetrics.test.ts` | Tests for the above |
| `src/pages/admin/useAdminQuery.ts` | Shared loading/error/data hook for RPC calls |
| `src/pages/admin/AdminBarChart.tsx` | Minimal count-over-time bar chart |
| `src/pages/admin/AdminPage.tsx` | Tab shell |
| `src/pages/admin/OverviewTab.tsx` | Headline numbers + signup chart |
| `src/pages/admin/UsersTab.tsx` | Searchable, paginated account list |
| `src/pages/admin/ScannerTab.tsx` | Scan volume, outcomes, failures, gates |
| `src/pages/admin/AiUsageTab.tsx` | Gemini call counts |
| `src/pages/admin/FeedbackTab.tsx` | Feedback list and summary |
| `src/components/auth/AdminRoute.tsx` | Route guard |

**Modify:**

| File | Change |
|---|---|
| `src/types/database.ts` | Add `is_admin` to profiles; add a `Functions` block |
| `src/components/auth/ProtectedRoute.tsx:31` | Add `/admin` to the exemption list |
| `src/App.tsx` | Lazy-import `AdminPage`; add the guarded route |
| `src/layouts/AppLayout.tsx` | Two menu entries, desktop and mobile |
| `TRANSFER_GUIDE.md` | Document granting admin |
| `CLAUDE.md` | Correct the stale "next migration is 020_" line |

---

## Task 1: Type definitions

Nothing compiles without this. `is_admin` arrives at runtime via `select('*')` but the type omits it, and there is no `Functions` block to type `supabase.rpc` against.

**Files:**
- Modify: `src/types/database.ts`

- [ ] **Step 1: Add `is_admin` to the profiles Row**

In the `profiles` `Row` block, after `subscription_plan_type: string | null`, add:

```ts
          is_admin: boolean
          ai_calls_count: number
          ai_scan_calls_count: number
```

In the `Insert` and `Update` blocks of `profiles`, add the same three as optional:

```ts
          is_admin?: boolean
          ai_calls_count?: number
          ai_scan_calls_count?: number
```

- [ ] **Step 2: Add the Functions block**

At the end of the `public` object in `Database`, as a sibling of `Tables`, add:

```ts
      Functions: {
        admin_overview_stats: {
          Args: Record<string, never>
          Returns: {
            total_accounts: number
            signups_7d: number
            signups_30d: number
            paying_monthly: number
            paying_annual: number
            expiring_7d: number
            signins_7d: number
            signins_30d: number
            transactions_7d: number
            transactions_30d: number
            transactions_pending: number
          }[]
        }
        admin_growth_series: {
          Args: { days: number }
          Returns: { day: string; signups: number; signins: number }[]
        }
        admin_user_list: {
          Args: { search: string; lim: number; off: number }
          Returns: {
            id: string
            email: string
            subscription_status: string | null
            subscription_plan_type: string | null
            subscription_expires_at: string | null
            created_at: string
            last_signin_at: string | null
            scans_30d: number
            total_count: number
          }[]
        }
        admin_scanner_stats: {
          Args: { days: number }
          Returns: {
            day: string
            manual_scans: number
            scheduled_scans: number
            succeeded: number
            partial: number
            failed: number
            emails_processed: number
            transactions_found: number
          }[]
        }
        admin_scan_failures: {
          Args: { lim: number }
          Returns: { scanned_at: string; email: string; error_message: string | null; scan_mode: string | null }[]
        }
        admin_rejection_gates: {
          Args: { days: number }
          Returns: { gate: string; rejections: number }[]
        }
        admin_ai_usage: {
          Args: Record<string, never>
          Returns: { email: string; ai_calls_count: number; ai_scan_calls_count: number }[]
        }
        admin_feedback_summary: {
          Args: Record<string, never>
          Returns: { total: number; average_rating: number; bug: number; feature_request: number; ui_ux: number; other: number }[]
        }
        admin_feedback_list: {
          Args: { lim: number; off: number }
          Returns: {
            id: string
            email: string
            rating: number
            category: string
            message: string
            created_at: string
            total_count: number
          }[]
        }
      }
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc -b`
Expected: exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add src/types/database.ts
git commit -m "feat: type is_admin and the admin metric functions"
```

---

## Task 2: Access decision (pure, tested)

**Files:**
- Create: `src/services/adminAccess.ts`
- Test: `src/services/adminAccess.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/adminAccess.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { canAccessAdmin } from './adminAccess'

describe('canAccessAdmin', () => {
  it('allows a profile flagged as admin', () => {
    expect(canAccessAdmin({ is_admin: true })).toBe(true)
  })

  it('refuses a profile not flagged as admin', () => {
    expect(canAccessAdmin({ is_admin: false })).toBe(false)
  })

  // The offline fallback in AuthContext rebuilds the profile from localStorage,
  // which carries no is_admin. Undefined must fail closed, not open.
  it('refuses a profile with no is_admin field at all', () => {
    expect(canAccessAdmin({})).toBe(false)
  })

  it('refuses when there is no profile yet', () => {
    expect(canAccessAdmin(null)).toBe(false)
    expect(canAccessAdmin(undefined)).toBe(false)
  })

  // Defensive: a truthy non-boolean must not be treated as permission.
  it('refuses a non-boolean truthy value', () => {
    expect(canAccessAdmin({ is_admin: 'yes' as unknown as boolean })).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/services/adminAccess.test.ts`
Expected: FAIL — cannot find module `./adminAccess`.

- [ ] **Step 3: Write the implementation**

Create `src/services/adminAccess.ts`:

```ts
// ============================================
// Admin access — the browser-side half of the gate.
//
// This decides what is DISPLAYED, not what is PERMITTED. A user can edit their
// own JavaScript and make the admin page render; they still get nothing back,
// because every admin SQL function re-checks is_admin server-side and raises.
// Treat this as cosmetic and keep the real guard in the database.
// ============================================

export function canAccessAdmin(
  profile: { is_admin?: boolean } | null | undefined
): boolean {
  return profile?.is_admin === true
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/services/adminAccess.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/services/adminAccess.ts src/services/adminAccess.test.ts
git commit -m "feat: add the browser-side admin access check"
```

---

## Task 3: Display maths (pure, tested)

Revenue and rates live here, not in SQL, so they can be tested.

**Files:**
- Create: `src/pages/admin/adminMetrics.ts`
- Test: `src/pages/admin/adminMetrics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/pages/admin/adminMetrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { approximateMonthlyRevenue, scanSuccessRate, percentOf } from './adminMetrics'

describe('approximateMonthlyRevenue', () => {
  it('counts a monthly subscriber at the monthly price', () => {
    expect(approximateMonthlyRevenue(10, 0)).toBe(310)
  })

  it('spreads an annual subscription across twelve months', () => {
    // 365 / 12 = 30.4166..., rounded to 30.42 for one subscriber
    expect(approximateMonthlyRevenue(0, 1)).toBe(30.42)
  })

  it('adds both plan types together', () => {
    expect(approximateMonthlyRevenue(2, 3)).toBe(153.25)
  })

  it('returns zero when nobody is paying', () => {
    expect(approximateMonthlyRevenue(0, 0)).toBe(0)
  })
})

describe('scanSuccessRate', () => {
  it('counts partial scans as successful, since transactions were still found', () => {
    expect(scanSuccessRate({ succeeded: 7, partial: 1, failed: 2 })).toBe(80)
  })

  it('returns 100 when nothing failed', () => {
    expect(scanSuccessRate({ succeeded: 5, partial: 0, failed: 0 })).toBe(100)
  })

  // A fresh install has no scans. Zero divided by zero must not reach the UI.
  it('returns null when no scans have run at all', () => {
    expect(scanSuccessRate({ succeeded: 0, partial: 0, failed: 0 })).toBeNull()
  })
})

describe('percentOf', () => {
  it('computes a whole-number percentage', () => {
    expect(percentOf(25, 200)).toBe(13)
  })

  it('returns null rather than dividing by zero', () => {
    expect(percentOf(5, 0)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/pages/admin/adminMetrics.test.ts`
Expected: FAIL — cannot find module `./adminMetrics`.

- [ ] **Step 3: Write the implementation**

Create `src/pages/admin/adminMetrics.ts`:

```ts
// ============================================
// Admin display maths.
//
// Deliberately in TypeScript rather than SQL: this repo can test TypeScript and
// has no harness for Postgres, and these are the numbers most likely to be shown
// to an investor. SQL returns raw counts; the derivations happen here.
// ============================================

/** Live prices from the pricing page. Update both together if they ever change. */
const MONTHLY_PRICE_INR = 31
const ANNUAL_PRICE_INR = 365

/**
 * Approximate monthly recurring revenue from the plans people hold RIGHT NOW.
 *
 * This is not historic revenue. No payments table exists, so past receipts were
 * never recorded and cannot be reconstructed. Always label this as approximate
 * in the UI.
 */
export function approximateMonthlyRevenue(monthlyCount: number, annualCount: number): number {
  const fromMonthly = monthlyCount * MONTHLY_PRICE_INR
  const fromAnnual = annualCount * (ANNUAL_PRICE_INR / 12)
  return Math.round((fromMonthly + fromAnnual) * 100) / 100
}

/**
 * Share of scans that produced something, as a whole-number percentage.
 * Partial scans count as successes: they still returned transactions.
 * Returns null when no scans exist, so the UI can show "no data" not "0%".
 */
export function scanSuccessRate(counts: { succeeded: number; partial: number; failed: number }): number | null {
  const total = counts.succeeded + counts.partial + counts.failed
  if (total === 0) return null
  return Math.round(((counts.succeeded + counts.partial) / total) * 100)
}

/** Whole-number percentage, or null when the denominator is zero. */
export function percentOf(part: number, whole: number): number | null {
  if (whole === 0) return null
  return Math.round((part / whole) * 100)
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run src/pages/admin/adminMetrics.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/adminMetrics.ts src/pages/admin/adminMetrics.test.ts
git commit -m "feat: add tested display maths for the admin panel"
```

---

## Task 4: The migration

Nine functions, each opening with the same guard. This is the only thing standing between a non-admin and every user's data, so the guard is repeated in full in each function rather than being assumed.

**Files:**
- Create: `supabase/022_admin_metrics.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/022_admin_metrics.sql`:

```sql
-- 022_admin_metrics.sql
--
-- Read-only aggregate functions behind the /admin section.
--
-- Every function is SECURITY DEFINER so it can read across users regardless of
-- RLS, and every function therefore opens with the same is_admin() guard. That
-- guard is the ONLY thing making this safe: without it any signed-in user could
-- call these and read the whole business. Do not remove it, and do not add a
-- function here without it.
--
-- Nothing here writes. Admin operations that modify data belong in serverless
-- endpoints using the service-role key (phase 2), because the
-- protect_server_only_profile_columns trigger blocks browser writes by design.

BEGIN;

-- 1. Headline numbers -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_overview_stats()
RETURNS TABLE (
  total_accounts BIGINT,
  signups_7d BIGINT,
  signups_30d BIGINT,
  paying_monthly BIGINT,
  paying_annual BIGINT,
  expiring_7d BIGINT,
  signins_7d BIGINT,
  signins_30d BIGINT,
  transactions_7d BIGINT,
  transactions_30d BIGINT,
  transactions_pending BIGINT
) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.profiles),
    (SELECT count(*) FROM public.profiles WHERE created_at > now() - interval '7 days'),
    (SELECT count(*) FROM public.profiles WHERE created_at > now() - interval '30 days'),
    (SELECT count(*) FROM public.profiles
      WHERE subscription_status = 'active'
        AND subscription_plan_type = 'monthly'
        AND (subscription_expires_at IS NULL OR subscription_expires_at > now())),
    (SELECT count(*) FROM public.profiles
      WHERE subscription_status = 'active'
        AND subscription_plan_type = 'annual'
        AND (subscription_expires_at IS NULL OR subscription_expires_at > now())),
    (SELECT count(*) FROM public.profiles
      WHERE subscription_status = 'active'
        AND subscription_expires_at BETWEEN now() AND now() + interval '7 days'),
    (SELECT count(DISTINCT user_id) FROM public.signin_logs WHERE created_at > now() - interval '7 days'),
    (SELECT count(DISTINCT user_id) FROM public.signin_logs WHERE created_at > now() - interval '30 days'),
    (SELECT count(*) FROM public.transactions WHERE created_at > now() - interval '7 days'),
    (SELECT count(*) FROM public.transactions WHERE created_at > now() - interval '30 days'),
    (SELECT count(*) FROM public.transactions WHERE approval_status = 'pending');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Signups and sign-ins per day ------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_growth_series(days INT)
RETURNS TABLE (day DATE, signups BIGINT, signins BIGINT) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  WITH span AS (
    SELECT generate_series(
      (now() - (days || ' days')::interval)::date,
      now()::date,
      '1 day'
    )::date AS day
  )
  SELECT
    s.day,
    (SELECT count(*) FROM public.profiles p WHERE p.created_at::date = s.day),
    (SELECT count(DISTINCT l.user_id) FROM public.signin_logs l WHERE l.created_at::date = s.day)
  FROM span s
  ORDER BY s.day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. Account list ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_user_list(search TEXT, lim INT, off INT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  subscription_status TEXT,
  subscription_plan_type TEXT,
  subscription_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  last_signin_at TIMESTAMPTZ,
  scans_30d BIGINT,
  total_count BIGINT
) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  WITH matched AS (
    SELECT p.* FROM public.profiles p
    WHERE search IS NULL OR search = '' OR p.email ILIKE '%' || search || '%'
  )
  SELECT
    m.id,
    m.email,
    m.subscription_status,
    m.subscription_plan_type,
    m.subscription_expires_at,
    m.created_at,
    (SELECT max(l.created_at) FROM public.signin_logs l WHERE l.user_id = m.id),
    (SELECT count(*) FROM public.email_scan_logs g
      WHERE g.user_id = m.id AND g.scanned_at > now() - interval '30 days'),
    (SELECT count(*) FROM matched)
  FROM matched m
  ORDER BY m.created_at DESC
  LIMIT lim OFFSET off;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Scanner volume and outcomes -------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_scanner_stats(days INT)
RETURNS TABLE (
  day DATE,
  manual_scans BIGINT,
  scheduled_scans BIGINT,
  succeeded BIGINT,
  partial BIGINT,
  failed BIGINT,
  emails_processed BIGINT,
  transactions_found BIGINT
) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    l.scanned_at::date AS day,
    count(*) FILTER (WHERE l.scan_mode = 'manual'),
    count(*) FILTER (WHERE l.scan_mode = 'scheduled'),
    count(*) FILTER (WHERE l.status = 'success'),
    count(*) FILTER (WHERE l.status = 'partial'),
    count(*) FILTER (WHERE l.status = 'failed'),
    COALESCE(sum(l.emails_processed), 0),
    COALESCE(sum(l.transactions_found), 0)
  FROM public.email_scan_logs l
  WHERE l.scanned_at > now() - (days || ' days')::interval
  GROUP BY l.scanned_at::date
  ORDER BY day;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Recent failures -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_scan_failures(lim INT)
RETURNS TABLE (scanned_at TIMESTAMPTZ, email TEXT, error_message TEXT, scan_mode TEXT) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT l.scanned_at, p.email, l.error_message, l.scan_mode
  FROM public.email_scan_logs l
  JOIN public.profiles p ON p.id = l.user_id
  WHERE l.status = 'failed'
  ORDER BY l.scanned_at DESC
  LIMIT lim;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 6. Which gates are rejecting --------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_rejection_gates(days INT)
RETURNS TABLE (gate TEXT, rejections BIGINT) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT r.gate, count(*)
  FROM public.email_scan_rejections r
  WHERE r.rejected_at > now() - (days || ' days')::interval
  GROUP BY r.gate
  ORDER BY count(*) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 7. AI call volume --------------------------------------------------------
-- Raw counts only. The daily caps are constants inside api/gemini-proxy.ts and
-- are deliberately NOT duplicated here: a second copy would disagree with the
-- proxy the first time a cap changed, and a wrong percentage is worse than none.
CREATE OR REPLACE FUNCTION public.admin_ai_usage()
RETURNS TABLE (email TEXT, ai_calls_count INT, ai_scan_calls_count INT) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT p.email, p.ai_calls_count, p.ai_scan_calls_count
  FROM public.profiles p
  WHERE p.ai_calls_count > 0 OR p.ai_scan_calls_count > 0
  ORDER BY (p.ai_calls_count + p.ai_scan_calls_count) DESC
  LIMIT 50;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 8. Feedback summary ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_feedback_summary()
RETURNS TABLE (
  total BIGINT,
  average_rating NUMERIC,
  bug BIGINT,
  feature_request BIGINT,
  ui_ux BIGINT,
  other BIGINT
) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT
    count(*),
    COALESCE(round(avg(f.rating), 2), 0),
    count(*) FILTER (WHERE f.category = 'bug'),
    count(*) FILTER (WHERE f.category = 'feature_request'),
    count(*) FILTER (WHERE f.category = 'ui_ux'),
    count(*) FILTER (WHERE f.category = 'other')
  FROM public.feedback f;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 9. Feedback list ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_feedback_list(lim INT, off INT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  rating INT,
  category TEXT,
  message TEXT,
  created_at TIMESTAMPTZ,
  total_count BIGINT
) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  RETURN QUERY
  SELECT f.id, f.email, f.rating, f.category, f.message, f.created_at,
         (SELECT count(*) FROM public.feedback)
  FROM public.feedback f
  ORDER BY f.created_at DESC
  LIMIT lim OFFSET off;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMIT;
```

- [ ] **Step 2: Commit (do not run it yet — Task 13 verifies it against the live database)**

```bash
git add supabase/022_admin_metrics.sql
git commit -m "feat: add admin-guarded metric functions in migration 022"
```

---

## Task 5: Route guard and route

**Files:**
- Create: `src/components/auth/AdminRoute.tsx`
- Modify: `src/components/auth/ProtectedRoute.tsx:31`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create the guard**

Create `src/components/auth/AdminRoute.tsx`:

```tsx
// ============================================
// AdminRoute — hides the admin section from non-admins.
//
// Cosmetic by design: the real gate is the is_admin() check inside every admin
// SQL function. Defeating this in a browser yields an empty page.
// ============================================

import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { canAccessAdmin } from '@/services/adminAccess'

export default function AdminRoute() {
  const { profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-0">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-400 border-t-transparent" />
      </div>
    )
  }

  if (!canAccessAdmin(profile)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
```

- [ ] **Step 2: Exempt `/admin` from the subscription redirect**

In `src/components/auth/ProtectedRoute.tsx`, the exemption list currently reads:

```tsx
  const isExempted = ['/settings', '/profile', '/support', '/pricing'].includes(location.pathname)
```

Replace it with:

```tsx
  // /admin is exempt so an owner or buyer can always reach operational tooling,
  // even if their own subscription has lapsed. AdminRoute still gates it.
  const isExempted = ['/settings', '/profile', '/support', '/pricing', '/admin'].includes(location.pathname)
```

- [ ] **Step 3: Add the route**

In `src/App.tsx`, alongside the other lazy imports, add:

```tsx
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'))
```

Import the guard beside `ProtectedRoute`:

```tsx
import AdminRoute from '@/components/auth/AdminRoute'
```

Inside the existing `<Route element={<ProtectedRoute />}>` block, after the `/payment-success` route, add:

```tsx
            <Route element={<AdminRoute />}>
              <Route path="/admin" element={<AdminPage />} />
            </Route>
```

- [ ] **Step 4: Verify it compiles (AdminPage arrives in Task 7 — expect this to fail until then)**

Run: `npx tsc -b`
Expected: FAIL — cannot find module `@/pages/admin/AdminPage`. This is expected; Task 7 resolves it. Do not stub the file to silence it.

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/AdminRoute.tsx src/components/auth/ProtectedRoute.tsx src/App.tsx
git commit -m "feat: add the admin route guard and /admin route"
```

---

## Task 6: The query hook

Every tab needs the same loading, error and empty handling. One hook, used five times.

**Files:**
- Create: `src/pages/admin/useAdminQuery.ts`

- [ ] **Step 1: Write the hook**

Create `src/pages/admin/useAdminQuery.ts`:

```ts
// ============================================
// useAdminQuery — one RPC call, with loading and error state.
//
// Each tab calls this independently so a failure in one tab cannot blank the
// others. A non-admin caller gets a Postgres exception here, which surfaces as
// an ordinary error state rather than a crash.
// ============================================

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/services/supabase'

interface AdminQueryState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

export function useAdminQuery<T>(
  fn: string,
  args: Record<string, unknown> = {},
  deps: unknown[] = []
): AdminQueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  const reload = useCallback(() => setNonce((n) => n + 1), [])

  const argsKey = JSON.stringify(args)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase.rpc as any)(fn, args)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .then(({ data: rows, error: rpcError }: { data: any; error: any }) => {
        if (cancelled) return
        if (rpcError) setError(rpcError.message)
        else setData(rows as T)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn, argsKey, nonce, ...deps])

  return { data, loading, error, reload }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -b`
Expected: still only the missing-`AdminPage` error from Task 5.

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/useAdminQuery.ts
git commit -m "feat: add the shared admin query hook"
```

---

## Task 7: Page shell with tabs

**Files:**
- Create: `src/pages/admin/AdminPage.tsx`

- [ ] **Step 1: Write the shell**

Create `src/pages/admin/AdminPage.tsx`:

```tsx
// ============================================
// AdminPage — tab shell for the read-only admin section.
//
// Nothing in this section writes. See
// docs/superpowers/specs/2026-08-15-admin-panel-design.md.
// ============================================

import { useEffect, useState } from 'react'
import OverviewTab from './OverviewTab'
import UsersTab from './UsersTab'
import ScannerTab from './ScannerTab'
import AiUsageTab from './AiUsageTab'
import FeedbackTab from './FeedbackTab'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'scanner', label: 'Scanner' },
  { id: 'ai', label: 'AI' },
  { id: 'feedback', label: 'Feedback' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function AdminPage() {
  const [tab, setTab] = useState<TabId>('overview')

  useEffect(() => { document.title = 'Admin | Intrack' }, [])

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-zinc-100">Admin</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Read-only. Nothing on this page can change user data.
        </p>
      </header>

      <div className="mb-6 flex gap-1 overflow-x-auto border-b border-border-subtle">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              tab === t.id
                ? 'whitespace-nowrap border-b-2 border-brand-400 px-4 py-2 text-sm font-semibold text-zinc-100'
                : 'whitespace-nowrap border-b-2 border-transparent px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200'
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'scanner' && <ScannerTab />}
      {tab === 'ai' && <AiUsageTab />}
      {tab === 'feedback' && <FeedbackTab />}
    </main>
  )
}
```

- [ ] **Step 2: Commit (tabs arrive in Tasks 8–12; compilation completes then)**

```bash
git add src/pages/admin/AdminPage.tsx
git commit -m "feat: add the admin page shell"
```

---

## Task 8: Bar chart and Overview tab

**Files:**
- Create: `src/pages/admin/AdminBarChart.tsx`
- Create: `src/pages/admin/OverviewTab.tsx`

The existing charts in `src/pages/analytics/` cannot be reused — they are built around income, expenses and savings, and format values as currency. This is a plain count chart.

- [ ] **Step 1: Write the chart**

Create `src/pages/admin/AdminBarChart.tsx`:

```tsx
// ============================================
// AdminBarChart — counts over time, no dependency.
// ============================================

interface Props {
  data: { label: string; value: number }[]
  emptyMessage: string
}

export default function AdminBarChart({ data, emptyMessage }: Props) {
  if (data.length === 0) {
    return <p className="py-8 text-center text-sm text-zinc-500">{emptyMessage}</p>
  }

  const max = Math.max(...data.map((d) => d.value), 1)

  return (
    <div className="flex h-40 items-end gap-1 overflow-x-auto">
      {data.map((d) => (
        <div key={d.label} className="flex min-w-[10px] flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-brand-400/70"
            style={{ height: `${(d.value / max) * 100}%` }}
            title={`${d.label}: ${d.value}`}
          />
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Write the Overview tab**

Create `src/pages/admin/OverviewTab.tsx`:

```tsx
import { Card } from '@/components/ui'
import { useAdminQuery } from './useAdminQuery'
import { approximateMonthlyRevenue } from './adminMetrics'
import AdminBarChart from './AdminBarChart'

interface OverviewRow {
  total_accounts: number
  signups_7d: number
  signups_30d: number
  paying_monthly: number
  paying_annual: number
  expiring_7d: number
  signins_7d: number
  signins_30d: number
  transactions_7d: number
  transactions_30d: number
  transactions_pending: number
}

interface GrowthRow {
  day: string
  signups: number
  signins: number
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-zinc-100">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </Card>
  )
}

export default function OverviewTab() {
  const stats = useAdminQuery<OverviewRow[]>('admin_overview_stats')
  const growth = useAdminQuery<GrowthRow[]>('admin_growth_series', { days: 30 })

  if (stats.loading) return <p className="py-8 text-sm text-zinc-400">Loading…</p>
  if (stats.error) {
    return (
      <div className="py-8">
        <p className="text-sm text-red-400">Could not load overview: {stats.error}</p>
        <button onClick={stats.reload} className="mt-2 text-sm text-brand-400 underline">Retry</button>
      </div>
    )
  }

  const s = stats.data?.[0]
  if (!s) return <p className="py-8 text-sm text-zinc-400">No data yet.</p>

  const paying = s.paying_monthly + s.paying_annual
  const mrr = approximateMonthlyRevenue(s.paying_monthly, s.paying_annual)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total accounts" value={String(s.total_accounts)} hint={`+${s.signups_7d} this week`} />
        <Stat label="Paying" value={String(paying)} hint={`${s.paying_monthly} monthly · ${s.paying_annual} yearly`} />
        <Stat label="Approx. revenue" value={`₹${mrr.toLocaleString('en-IN')}`} hint="per month, from current plans" />
        <Stat label="Expiring in 7 days" value={String(s.expiring_7d)} hint="churn risk" />
        <Stat label="Signed in (7d)" value={String(s.signins_7d)} hint={`${s.signins_30d} in 30 days`} />
        <Stat label="New signups (30d)" value={String(s.signups_30d)} />
        <Stat label="Transactions (30d)" value={String(s.transactions_30d)} hint={`${s.transactions_7d} this week`} />
        <Stat label="Awaiting approval" value={String(s.transactions_pending)} hint="sitting in Pending" />
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Signups per day (30 days)</h2>
        {growth.loading ? (
          <p className="py-8 text-center text-sm text-zinc-500">Loading…</p>
        ) : growth.error ? (
          <p className="py-8 text-center text-sm text-red-400">{growth.error}</p>
        ) : (
          <AdminBarChart
            data={(growth.data ?? []).map((g) => ({ label: g.day, value: g.signups }))}
            emptyMessage="No signups yet."
          />
        )}
      </Card>

      <p className="text-xs text-zinc-500">
        Revenue is approximate — derived from the plans people hold today, not from payment
        records. No payments table exists yet, so historic revenue cannot be shown.
      </p>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/admin/AdminBarChart.tsx src/pages/admin/OverviewTab.tsx
git commit -m "feat: add the admin overview tab"
```

---

## Task 9: Users tab

**Files:**
- Create: `src/pages/admin/UsersTab.tsx`

- [ ] **Step 1: Write the tab**

Create `src/pages/admin/UsersTab.tsx`:

```tsx
import { useState } from 'react'
import { Card, Input } from '@/components/ui'
import { useAdminQuery } from './useAdminQuery'

interface UserRow {
  id: string
  email: string
  subscription_status: string | null
  subscription_plan_type: string | null
  subscription_expires_at: string | null
  created_at: string
  last_signin_at: string | null
  scans_30d: number
  total_count: number
}

const PAGE_SIZE = 25

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN')
}

export default function UsersTab() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  const { data, loading, error, reload } = useAdminQuery<UserRow[]>('admin_user_list', {
    search,
    lim: PAGE_SIZE,
    off: page * PAGE_SIZE,
  })

  const total = data?.[0]?.total_count ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-4">
      <Input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setPage(0) }}
        placeholder="Search by email"
      />

      {loading && <p className="py-8 text-sm text-zinc-400">Loading…</p>}

      {error && (
        <div className="py-8">
          <p className="text-sm text-red-400">Could not load users: {error}</p>
          <button onClick={reload} className="mt-2 text-sm text-brand-400 underline">Retry</button>
        </div>
      )}

      {!loading && !error && (data?.length ?? 0) === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500">
          {search ? 'No accounts match that search.' : 'No accounts yet.'}
        </p>
      )}

      {!loading && !error && (data?.length ?? 0) > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-subtle text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Joined</th>
                <th className="px-4 py-3">Last seen</th>
                <th className="px-4 py-3">Scans 30d</th>
              </tr>
            </thead>
            <tbody>
              {data!.map((u) => (
                <tr key={u.id} className="border-b border-border-subtle/50">
                  <td className="px-4 py-3 text-zinc-200">{u.email}</td>
                  <td className="px-4 py-3 text-zinc-400">{u.subscription_status ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-400">{u.subscription_plan_type ?? '—'}</td>
                  <td className="px-4 py-3 text-zinc-400">{formatDate(u.subscription_expires_at)}</td>
                  <td className="px-4 py-3 text-zinc-400">{formatDate(u.created_at)}</td>
                  <td className="px-4 py-3 text-zinc-400">{formatDate(u.last_signin_at)}</td>
                  <td className="px-4 py-3 text-zinc-400">{u.scans_30d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
            className="disabled:opacity-40"
          >
            Previous
          </button>
          <span>Page {page + 1} of {pages} · {total} accounts</span>
          <button
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
            className="disabled:opacity-40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/admin/UsersTab.tsx
git commit -m "feat: add the admin users tab"
```

---

## Task 10: Scanner tab

**Files:**
- Create: `src/pages/admin/ScannerTab.tsx`

This tab only *reads* scanner tables. It does not import or modify any scanner code.

- [ ] **Step 1: Write the tab**

Create `src/pages/admin/ScannerTab.tsx`:

```tsx
import { Card } from '@/components/ui'
import { useAdminQuery } from './useAdminQuery'
import { scanSuccessRate } from './adminMetrics'
import AdminBarChart from './AdminBarChart'

interface ScannerRow {
  day: string
  manual_scans: number
  scheduled_scans: number
  succeeded: number
  partial: number
  failed: number
  emails_processed: number
  transactions_found: number
}

interface FailureRow {
  scanned_at: string
  email: string
  error_message: string | null
  scan_mode: string | null
}

interface GateRow {
  gate: string
  rejections: number
}

export default function ScannerTab() {
  const stats = useAdminQuery<ScannerRow[]>('admin_scanner_stats', { days: 30 })
  const failures = useAdminQuery<FailureRow[]>('admin_scan_failures', { lim: 20 })
  const gates = useAdminQuery<GateRow[]>('admin_rejection_gates', { days: 30 })

  if (stats.loading) return <p className="py-8 text-sm text-zinc-400">Loading…</p>
  if (stats.error) {
    return (
      <div className="py-8">
        <p className="text-sm text-red-400">Could not load scanner stats: {stats.error}</p>
        <button onClick={stats.reload} className="mt-2 text-sm text-brand-400 underline">Retry</button>
      </div>
    )
  }

  const rows = stats.data ?? []
  const totals = rows.reduce(
    (acc, r) => ({
      succeeded: acc.succeeded + r.succeeded,
      partial: acc.partial + r.partial,
      failed: acc.failed + r.failed,
      manual: acc.manual + r.manual_scans,
      scheduled: acc.scheduled + r.scheduled_scans,
      emails: acc.emails + r.emails_processed,
      found: acc.found + r.transactions_found,
    }),
    { succeeded: 0, partial: 0, failed: 0, manual: 0, scheduled: 0, emails: 0, found: 0 }
  )

  const rate = scanSuccessRate(totals)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Success rate</p>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{rate === null ? '—' : `${rate}%`}</p>
          <p className="mt-1 text-xs text-zinc-500">partial counts as success</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Failed scans</p>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{totals.failed}</p>
          <p className="mt-1 text-xs text-zinc-500">last 30 days</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Manual / auto</p>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{totals.manual} / {totals.scheduled}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Txns found</p>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{totals.found}</p>
          <p className="mt-1 text-xs text-zinc-500">from {totals.emails} emails</p>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Scans per day (30 days)</h2>
        <AdminBarChart
          data={rows.map((r) => ({ label: r.day, value: r.manual_scans + r.scheduled_scans }))}
          emptyMessage="No scans yet."
        />
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Rejections by gate (30 days)</h2>
        {gates.loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (gates.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-500">No rejections recorded.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {gates.data!.map((g) => (
              <li key={g.gate} className="flex justify-between text-zinc-300">
                <span>{g.gate}</span>
                <span className="text-zinc-500">{g.rejections}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Recent failures</h2>
        {failures.loading ? (
          <p className="text-sm text-zinc-500">Loading…</p>
        ) : (failures.data?.length ?? 0) === 0 ? (
          <p className="text-sm text-zinc-500">No failed scans. Good.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {failures.data!.map((f, i) => (
              <li key={i} className="border-b border-border-subtle/50 pb-2">
                <p className="text-zinc-300">{f.email} · {f.scan_mode ?? 'unknown'}</p>
                <p className="text-xs text-zinc-500">
                  {new Date(f.scanned_at).toLocaleString('en-IN')} — {f.error_message ?? 'no message'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/admin/ScannerTab.tsx
git commit -m "feat: add the admin scanner health tab"
```

---

## Task 11: AI usage tab

**Files:**
- Create: `src/pages/admin/AiUsageTab.tsx`

No cap percentages: the limits live in `api/gemini-proxy.ts`, which this phase does not touch.

- [ ] **Step 1: Write the tab**

Create `src/pages/admin/AiUsageTab.tsx`:

```tsx
import { Card } from '@/components/ui'
import { useAdminQuery } from './useAdminQuery'

interface AiRow {
  email: string
  ai_calls_count: number
  ai_scan_calls_count: number
}

export default function AiUsageTab() {
  const { data, loading, error, reload } = useAdminQuery<AiRow[]>('admin_ai_usage')

  if (loading) return <p className="py-8 text-sm text-zinc-400">Loading…</p>
  if (error) {
    return (
      <div className="py-8">
        <p className="text-sm text-red-400">Could not load AI usage: {error}</p>
        <button onClick={reload} className="mt-2 text-sm text-brand-400 underline">Retry</button>
      </div>
    )
  }

  const rows = data ?? []
  const totalInsight = rows.reduce((sum, r) => sum + r.ai_calls_count, 0)
  const totalScan = rows.reduce((sum, r) => sum + r.ai_scan_calls_count, 0)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Insight calls today</p>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{totalInsight}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wider text-zinc-500">Scan calls today</p>
          <p className="mt-2 text-2xl font-bold text-zinc-100">{totalScan}</p>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-zinc-200">Heaviest users</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-500">No AI calls recorded today.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {rows.map((r) => (
              <li key={r.email} className="flex justify-between text-zinc-300">
                <span>{r.email}</span>
                <span className="text-zinc-500">{r.ai_calls_count} insight · {r.ai_scan_calls_count} scan</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-xs text-zinc-500">
        Counts reset daily. Percentages against the daily cap are not shown: the caps are
        constants inside the AI proxy, and duplicating them here would drift from the real
        limit.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/pages/admin/AiUsageTab.tsx
git commit -m "feat: add the admin AI usage tab"
```

---

## Task 12: Feedback tab

**Files:**
- Create: `src/pages/admin/FeedbackTab.tsx`

- [ ] **Step 1: Write the tab**

Create `src/pages/admin/FeedbackTab.tsx`:

```tsx
import { useState } from 'react'
import { Card } from '@/components/ui'
import { useAdminQuery } from './useAdminQuery'

interface SummaryRow {
  total: number
  average_rating: number
  bug: number
  feature_request: number
  ui_ux: number
  other: number
}

interface FeedbackRow {
  id: string
  email: string
  rating: number
  category: string
  message: string
  created_at: string
  total_count: number
}

const PAGE_SIZE = 20

export default function FeedbackTab() {
  const [page, setPage] = useState(0)
  const summary = useAdminQuery<SummaryRow[]>('admin_feedback_summary')
  const list = useAdminQuery<FeedbackRow[]>('admin_feedback_list', {
    lim: PAGE_SIZE,
    off: page * PAGE_SIZE,
  })

  const s = summary.data?.[0]
  const rows = list.data ?? []
  const total = rows[0]?.total_count ?? 0
  const pages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-6">
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Average rating</p>
            <p className="mt-2 text-2xl font-bold text-zinc-100">
              {s.total === 0 ? '—' : `${s.average_rating} / 5`}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Total feedback</p>
            <p className="mt-2 text-2xl font-bold text-zinc-100">{s.total}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">Breakdown</p>
            <p className="mt-2 text-sm text-zinc-300">
              {s.bug} bugs · {s.feature_request} features · {s.ui_ux} UI · {s.other} other
            </p>
          </Card>
        </div>
      )}

      {list.loading && <p className="py-8 text-sm text-zinc-400">Loading…</p>}

      {list.error && (
        <div className="py-8">
          <p className="text-sm text-red-400">Could not load feedback: {list.error}</p>
          <button onClick={list.reload} className="mt-2 text-sm text-brand-400 underline">Retry</button>
        </div>
      )}

      {!list.loading && !list.error && rows.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500">No feedback submitted yet.</p>
      )}

      {rows.map((f) => (
        <Card key={f.id} className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-zinc-200">{f.email}</p>
              <p className="text-xs text-zinc-500">
                {f.category} · {new Date(f.created_at).toLocaleDateString('en-IN')}
              </p>
            </div>
            <span className="shrink-0 text-sm text-zinc-400">{f.rating}/5</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm text-zinc-300">{f.message}</p>
        </Card>
      ))}

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40">
            Previous
          </button>
          <span>Page {page + 1} of {pages}</span>
          <button disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40">
            Next
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the whole thing compiles now**

Run: `npx tsc -b`
Expected: exit 0. The missing-`AdminPage` error from Task 5 is resolved.

- [ ] **Step 3: Run the full build and test suite**

Run: `npm run build`
Expected: succeeds.

Run: `npm test`
Expected: all tests pass, including the new `adminAccess` and `adminMetrics` files.

- [ ] **Step 4: Commit**

```bash
git add src/pages/admin/FeedbackTab.tsx
git commit -m "feat: add the admin feedback tab"
```

---

## Task 13: Verify the migration against the live database

The SQL has never run. There is no local Postgres, so this is done by hand.

**Files:** none changed.

- [ ] **Step 1: Confirm `is_admin` exists on the live table**

In the Supabase SQL editor:

```sql
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_admin';
```

Expected: one row. If zero rows, the live database has drifted from `schema.sql` — stop and run:

```sql
alter table public.profiles add column if not exists is_admin boolean not null default false;
```

- [ ] **Step 2: Apply the migration**

Paste the whole of `supabase/022_admin_metrics.sql` into the SQL editor and run it.
Expected: success. It is wrapped in a transaction, so any error leaves the database unchanged.

- [ ] **Step 3: Confirm all nine functions exist**

```sql
select routine_name from information_schema.routines
 where routine_schema = 'public' and routine_name like 'admin_%'
 order by routine_name;
```

Expected: nine rows.

- [ ] **Step 4: Grant yourself admin**

```sql
update public.profiles set is_admin = true where email = '<your email>';
```

- [ ] **Step 5: Prove the guard actually refuses a non-admin**

This is the most important check in the plan. In the SQL editor, run as an ordinary user:

```sql
set local role authenticated;
select public.admin_overview_stats();
```

Expected: `ERROR: admin only`. If it returns data instead, STOP — the guard is not working, and the panel must not ship.

Reset with `reset role;`.

- [ ] **Step 6: Sanity-check the output as admin**

```sql
select * from public.admin_overview_stats();
```

Expected: one row of counts consistent with what you know about the app.

---

## Task 14: Menu entries and documentation

**Files:**
- Modify: `src/layouts/AppLayout.tsx`
- Modify: `TRANSFER_GUIDE.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Import the access check in AppLayout**

Near the other imports in `src/layouts/AppLayout.tsx`:

```tsx
import { canAccessAdmin } from '@/services/adminAccess'
import { ShieldCheck } from 'lucide-react'
```

- [ ] **Step 2: Add the desktop menu item**

In the desktop profile dropdown, immediately after the `Link` to `/settings` that renders "Settings Section" (around line 692), add:

```tsx
                        {canAccessAdmin(profile) && (
                          <Link
                            to="/admin"
                            onClick={() => setProfileDropdownOpen(false)}
                            className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors", isStaticLight ? "text-sb-ink hover:bg-sb-canvas-soft" : "text-zinc-400 hover:bg-surface-2 hover:text-zinc-100")}
                          >
                            <ShieldCheck className="h-3.5 w-3.5 text-zinc-500 shrink-0" /> Admin Section
                          </Link>
                        )}
```

- [ ] **Step 3: Add the mobile menu item**

In the mobile menu, immediately after the `Link` to `/settings` (around line 784), add:

```tsx
                {canAccessAdmin(profile) && (
                  <Link
                    to="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                      location.pathname === '/admin' ? 'font-bold' : ''
                    )}
                  >
                    <ShieldCheck className="h-4 w-4 mr-2 text-zinc-500 shrink-0" /> Admin Section
                  </Link>
                )}
```

Note: `profile` is already in scope in this component — it is used by the plan badge. Do not add a second `useAuth()` call.

- [ ] **Step 4: Document granting admin**

Append to `TRANSFER_GUIDE.md`:

```markdown
## Granting admin access

The admin section at `/admin` is visible only to accounts whose `profiles.is_admin`
column is `true`. There is deliberately no button for this — an app that can hand out
admin rights from its own interface is one compromised session away from losing
everything.

To make an account admin, run this once in the Supabase SQL editor:

```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```

To revoke, set it back to `false`. The change takes effect the next time that user's
profile loads.
```

- [ ] **Step 5: Fix the stale migration counter**

In `CLAUDE.md`, the conventions section reads "Supabase migrations are numbered sequentially in `supabase/` (next is `020_`)". That is now two migrations out of date. Replace `020_` with `023_`.

- [ ] **Step 6: Final verification**

Run: `npm run build`
Expected: succeeds.

Run: `npm test`
Expected: all pass.

Run: `npm run lint`
Expected: no NEW errors. This repo has a large pre-existing baseline of `no-explicit-any` and `setState`-in-effect errors; compare against `git stash` output if unsure.

- [ ] **Step 7: Commit**

```bash
git add src/layouts/AppLayout.tsx TRANSFER_GUIDE.md CLAUDE.md
git commit -m "feat: add the admin menu entry and document granting admin"
```

---

## Manual acceptance check

Run through this in the browser before calling the feature done:

- [ ] As an admin: the profile menu shows "Admin Section"; `/admin` loads; all five tabs render without console errors.
- [ ] As a non-admin (or with `is_admin` temporarily set to false): the menu item is absent, and typing `/admin` directly redirects to `/dashboard`.
- [ ] With an expired subscription and `is_admin = true`: `/admin` still loads rather than bouncing to `/pricing`.
- [ ] Empty states: on a tab with no data, a sentence appears rather than a blank card or a stray `0`.
- [ ] The scanner still works: run a manual scan and confirm it completes as before. Nothing in this feature touches that path, but verify rather than assume.

## Self-review notes

**Spec coverage:** access control (Tasks 2, 5, 13), the nine functions (Task 4), all five tabs (Tasks 8–12), prerequisite type changes (Task 1), error and empty states (in each tab), transfer documentation (Task 14). The spec's "render for an admin" UI test is deliberately replaced by the pure `canAccessAdmin` tests plus the manual check above, because no component-testing setup exists.

**Deviation from the spec worth noting:** the spec put approximate MRR and success rate inside SQL. This plan computes them in TypeScript instead, so they can be tested — SQL cannot be tested in this repo. The SQL returns raw counts.

**Type consistency:** the `Functions` block in Task 1 defines the return shape of every function; each tab's local interface matches those fields exactly. `admin_ai_usage` returns raw counts and no cap, consistent with the scanner constraint.
